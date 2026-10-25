import type { Convention } from '@keel/engine';
import { parseAmountCents } from '../extract.js';
import type { Extraction } from '../schemas.js';
import type { Disagreement, ExplainInput } from '../explain.js';
import { attempt, createBus, guardedLedger, log, say, type Agent } from '../bus.js';
import type { ClarificationRefRow, Deps, LedgerState, SourceRow } from '../loop.js';
import { abs, baseline, engine, maxBy, usd } from './engine.js';
import { explainer, disagreementSentence } from './explainer.js';
import { documentReader } from './document-reader.js';
import { readerClaude, READER } from './reader-claude.js';
import { readerGemini } from './reader-gemini.js';
import { fieldLiaison } from './field-liaison.js';
import { reviewer } from './reviewer.js';

// Summo, the coordinator (seat: project accountant). Watches the ledger, routes each source through the other agents,
// and is the only agent that writes calculations and proposals. It never posts: a human approves.
const NAME = 'summo', MAY = ['recordCalculation', 'propose', 'openWorkItem', 'markMilestoneMet'] as const;
const ledgerOf = (deps: Deps) => guardedLedger(deps.ledger, NAME, MAY);
const MILESTONE_TITLE = 'Milestone invoice: acceptance';
const CALC_WAIT_MS = 5_000;

// ponytail: keyword heuristic backing up Claude's flag; misses paraphrases ("on top of", "bump by"), upgrade = stricter extract prompt or a second classifier
export const isAdditiveWording = (text: string): boolean =>
  /\b(another|additional|more|extra|add(ed)?|grand|bump(ed)?|over budget|overrun)\b/i.test(text) && !/\b(new total|total remaining|remaining (is|of|now)|new number|is now|now expect|down to)\b/i.test(text);

// ponytail: keyword heuristic for savings. "down to" names the new total; "less/under/saved" lowers the remaining (negative additional, no question).
export const isReductionWording = (text: string): Convention | null =>
  /\b(came )?down to\b/i.test(text) ? 'new_total' : /\b(less|under|saved|savings?|lower|cheaper)\b/i.test(text) ? 'additional' : null;

// Reduction read from the fact's quote, the model's minus sign, or (only when the note has no additive wording) the whole note.
const reductionOf = (f: Extraction['facts'][number], noteText: string): Convention | null =>
  isReductionWording(f.quote) ?? (/^\s*(-|−|minus\b)/i.test(f.amountText) ? 'additional' : null)
    ?? (isAdditiveWording(noteText) ? null : isReductionWording(noteText));
/** Signed update for a convention: negative only for an additive reduction ("50k less"); a total is always the magnitude. */
const signed = (mag: bigint, convention: Convention, red: Convention | null) => (convention === 'additional' && red === 'additional' ? -mag : mag);

// Amount comes from the quote (verified to be in the note); Claude's amountText only if it also appears in the note.
const factAmount = (f: Extraction['facts'][number] | undefined, noteText: string) =>
  f ? parseAmountCents(f.quote) ?? (f.amountText && noteText.includes(f.amountText) ? parseAmountCents(f.amountText) : null) : null;

// Facts are the amount source: remaining_update first; else (additive wording / additional_vs_total) the first fact with a parseable amount,
// because the model sometimes files "another $50,000 for conveyor rework" as cost/other.
function amountFact(facts: Extraction['facts'], noteText: string, additive: boolean) {
  return facts.find((f) => f.kind === 'remaining_update') ?? (additive ? facts.find((f) => factAmount(f, noteText) != null) : undefined);
}

/** Downstream state exists for this source, so it was fully handled (an extraction row alone does not count). */
function handled(s: LedgerState, src: SourceRow): boolean {
  if (s.calculations.some((c) => c.forecastSourceId === src.id) || s.clarificationRefs.some((c) => c.sourceId === src.id)) return true;
  return src.kind === 'commissioning_log' && s.milestones.some((m) => m.projectId === src.projectId && m.name === 'acceptance' && m.status === 'met');
}

const skip = (deps: Deps, src: SourceRow, why: string) => say(deps.ledger, NAME, src.projectId, 'skip', why, 'source', src.id).then(() => log(`source ${src.id}: ${why}`));

export async function handleNewSource(src: SourceRow, deps: Deps): Promise<void> {
  if (!['note', 'forecast', 'commissioning_log', 'scanned_forecast'].includes(src.kind)) return;
  if (handled(deps.ledger.state(), src)) return; // restart-safe
  try { await route(src, deps); } catch (e: any) {
    await say(deps.ledger, NAME, src.projectId, 'error', String(e?.message ?? e), 'source', src.id);
    throw e;
  }
}

async function route(src: SourceRow, deps: Deps): Promise<void> {
  const { ledger } = deps;
  // ponytail: text swap means a clarification on a scanned forecast reads amounts from the fact quote only (note.text is the storageId)
  let disagreement: Disagreement | undefined;
  if (src.kind === 'scanned_forecast') ({ src, disagreement } = await documentReader.handlers.read(src, deps));
  log(`source ${src.id} (${src.kind}) -> extract`);
  const both = deps.extractBoth
    ? await deps.extractBoth(src.text, Number(src.id))
    : await deps.extract(src.text, Number(src.id)).then((c) => ({ claude: c, gemini: null, agreed: true, merged: c }));
  if (!both.agreed) log(`source ${src.id}: readers disagree -> ${both.merged.ambiguity.question}`);
  const x = both.merged;
  const fact = amountFact(x.facts, src.text, x.ambiguity.kind === 'additional_vs_total' || isAdditiveWording(src.text));
  const parsed = factAmount(fact, src.text);
  const amount = parsed == null ? null : abs(parsed); // magnitude; direction comes from reductionOf
  const red = fact && src.kind !== 'commissioning_log' ? reductionOf(fact, src.text) : null;
  // Seeded convention remaining_estimate_means=future_costs_only: a "Remaining Estimate" figure is the new total remaining, no question.
  const reConv = ledger.state().conventions.find((c) => c.template === 'forecast' && c.key === 'remaining_estimate_means');
  const remainingEstimate = !!(reConv && fact && amount != null && both.agreed && !isAdditiveWording(src.text)
    && /remaining estimate/i.test(`${src.text.slice(Math.max(0, fact.charStart - 40), Math.max(0, fact.charStart))} ${fact.quote}`));
  // A savings cut bigger than what is left can't be "less": ask instead of booking a negative remaining.
  const remainingNow = red === 'additional' && amount != null ? baseline(ledger.state(), src.projectId).snap.remaining : null;
  const overdrawn = remainingNow != null && remainingNow - amount! < 0n;
  // Reduction wording settles the reading (unless readers disagree on the amount); otherwise Claude's flag or the additive guard.
  const claudeFlag = x.ambiguity.flag && !remainingEstimate && !(red && both.agreed && amount != null);
  const ambiguous = overdrawn || claudeFlag || (!red && src.kind !== 'commissioning_log' && amount != null && isAdditiveWording(`${fact!.quote} ${src.text}`));
  const noAmount = amount == null ? ' (Amount not stated in figures in the note.)' : '';
  const question = overdrawn
    ? `The note lowers the cost to finish by ${usd(amount!)}, but only ${usd(remainingNow!)} remains. Is ${usd(amount!)} additional (a reduction) or the new total remaining?`
    : (claudeFlag ? x.ambiguity.question : `Is the ${amount != null ? usd(amount) : 'amount'} additional to the current remaining forecast, or the new total remaining?`) + noAmount;
  const options = claudeFlag && !overdrawn ? x.ambiguity.options : ['additional', 'new_total'];
  // ambiguityFlag must match what we act on: open_clarification binds to the newest flagged extraction.
  await readerClaude.handlers.record(deps, src, x, ambiguous, ambiguous ? question : x.ambiguity.question);
  const g = both.gemini;
  await readerGemini.handlers.record(deps, src, g);
  await say(ledger, NAME, src.projectId, both.agreed ? 'agree' : 'disagree',
    !g ? 'one reader (Claude); nothing to compare' : both.agreed ? `readers agree${ambiguous ? '; reading is ambiguous' : ''}` : x.ambiguity.question, 'source', src.id);
  log(`extraction recorded: ${x.facts.length} fact(s), ambiguous=${ambiguous}${g ? `, second reader ${both.agreed ? 'agrees' : 'disagrees'}` : ''}`);

  if (src.kind === 'commissioning_log') return milestoneInvoice(src, x, deps);
  if (amount == null && !ambiguous) return skip(deps, src, 'no remaining_update amount, nothing to propose');
  if (amount != null && remainingEstimate) return proposeForecast(src, amount, 'new_total', [`Convention v${reConv!.policyVersion}: remaining_estimate_means = ${reConv!.value} (a Remaining Estimate is the new total remaining)`], '', deps, undefined, disagreement);
  if (amount != null && !ambiguous) return proposeForecast(src, signed(amount, red ?? 'new_total', red), red ?? 'new_total', [], '', deps, undefined, disagreement);
  const conv = ledger.state().conventions.find((c) => c.template === 'forecast' && c.key === 'another_means');
  if (conv && both.agreed && amount != null && !overdrawn) { // readers disagreeing on the amount is not something a convention can answer
    log(`convention another_means = ${conv.value} (policy v${conv.policyVersion}) applies; no question`);
    await say(ledger, NAME, src.projectId, 'skip', `convention another_means = ${conv.value} (policy v${conv.policyVersion}) applies; no question`, 'source', src.id);
    return proposeForecast(src, signed(amount, conv.value as Convention, red), conv.value as Convention, [`Convention v${conv.policyVersion}: another_means = ${conv.value}`], '', deps);
  }
  const workItemId = baseline(ledger.state(), src.projectId).workItemId;
  await fieldLiaison.handlers.ask(deps, src.projectId, workItemId, question, options, amount == null ? ' [amount unknown]' : '');
}

/** Forecast proposal for an already-confirmed clarification (also the restart path when resolve succeeded but no calculation followed). */
export async function proposeFromClarification(ref: ClarificationRefRow, answer: Convention, deps: Deps): Promise<void> {
  const s = deps.ledger.state();
  const note = s.sources.find((x) => x.id === ref.sourceId);
  const ext = s.extractions.find((e) => e.sourceId === ref.sourceId && e.reader === READER);
  const fact = ext && note && amountFact(JSON.parse(ext.factsJson) as Extraction['facts'], note.text, true); // a clarification was asked, so it was additive
  const parsed = note && factAmount(fact, note.text);
  // ponytail: "amount not stated" is a log line + skip event only; a ledger history note needs a reducer (spacetimedb is out of this module's scope)
  if (!note || parsed == null) {
    if (note) await say(deps.ledger, NAME, note.projectId, 'skip', `amount not stated in source ${ref.sourceId}; no proposal`, 'source', note.id);
    return log(`clarification ${ref.id}: amount not stated in source ${ref.sourceId}; no proposal`);
  }
  const red = reductionOf(fact!, note.text);
  const clar = maxBy(s.sources.filter((x) => x.kind === 'clarification' && x.parentSourceId === note.id));
  await proposeForecast(note, signed(abs(parsed), answer, red), answer, clar ? [clar.text] : [], JSON.stringify({ template: 'forecast', key: 'another_means', value: answer }), deps, clar?.id);
}

async function proposeForecast(src: SourceRow, amount: bigint, convention: Convention, citations: string[], pendingConventionJson: string, deps: Deps, extraEvidenceId?: bigint, disagreement?: Disagreement) {
  const ledger = ledgerOf(deps);
  const { workItemId, snap } = baseline(ledger.state(), src.projectId);
  const { next, calc: math } = await engine.handlers.forecast(deps, src.projectId, src.id, snap, amount, convention);
  if (!math) return skip(deps, src, `${convention} ${usd(amount)} would make remaining ${usd(next.remaining)}; not proposed`);
  const { before, after, adj } = math;
  const input: ExplainInput = {
    before, after, adjustmentCents: adj, convention, evidence: [...citations, src.text],
    contractValueCents: snap.contractValue, incurredCents: snap.incurred, remainingBeforeCents: snap.remaining, remainingAfterCents: next.remaining, disagreement,
  };
  // Numbers first (the UI shows them within seconds of confirm); explain can only degrade to the template, never orphan this row.
  await ledger.recordCalculation({
    workItemId, forecastSourceId: src.id,
    inputsJson: JSON.stringify({ contractValueCents: String(next.contractValue), incurredCents: String(next.incurred), remainingCents: String(next.remaining), billedCents: String(next.billed) }),
    progressBp: after.progressBp, cumRevenueCents: after.cumRevenue, contractAssetCents: after.contractAsset, marginCents: after.margin.amount, lossWarning: after.margin.lossWarning,
  });
  const calc = await waitFor(`calculation for source ${src.id}`, () => maxBy(ledger.state().calculations.filter((c) => c.forecastSourceId === src.id)), CALC_WAIT_MS);
  log(`calculation ${calc.id}: remaining ${usd(next.remaining)} (${convention}), progress ${after.progressBp} bp, cum revenue ${usd(after.cumRevenue)}, adjustment ${usd(adj)}${after.margin.lossWarning ? ', LOSS WARNING' : ''}`);
  if (adj === 0n) { // an empty entry would fail post as unbalanced
    await say(ledger, NAME, src.projectId, 'skip', `no revenue change: cumulative revenue unchanged at ${usd(after.cumRevenue)}`, 'calculation', calc.id);
    return log(`no revenue change: cumulative revenue unchanged at ${usd(after.cumRevenue)}`);
  }
  const x = await explainer.handlers.explain(deps, src.projectId, src.id, input, amount);

  const escalation = after.margin.lossWarning
    ? `ESCALATION: expected margin ${usd(after.margin.amount)} on contract ${usd(next.contractValue)} (estimated total cost ${usd(after.estTotal)}); loss contract, controller review required.`
    : '';
  // The source disagreement is always stated, whether or not the model wrote it.
  const said = disagreement && !/system of record/i.test(`${x.summary} ${x.whyRevenueMoved}`) ? disagreementSentence(disagreement) : '';
  const explanation = [escalation, ...citations, x.summary, x.whyRevenueMoved, said, x.whatDidNotChange].filter(Boolean).join('\n');
  const evidence = [src.id, ...(extraEvidenceId ? [extraEvidenceId] : [])].join(',');
  const entry = engine.handlers.revenueEntry(adj);
  // Reviewer reads the finished proposal; a flag only appends a line (Dana decides), it never blocks or rewrites.
  const review = await reviewer.handlers.check(deps, {
    incurredCents: String(snap.incurred), remainingBeforeCents: String(snap.remaining), remainingAfterCents: String(next.remaining),
    estTotalBeforeCents: String(before.estTotal), estTotalAfterCents: String(after.estTotal), progressBpBefore: String(before.progressBp), progressBpAfter: String(after.progressBp),
    cumRevenueBeforeCents: String(before.cumRevenue), cumRevenueAfterCents: String(after.cumRevenue), adjustmentCents: String(adj),
    entryLines: JSON.parse(entry), conventionCited: citations.filter((c) => c.startsWith('Convention')).join('; '), explanation,
  });
  const flag = review.verdict && !review.verdict.consistent ? `\nReviewer flag: ${review.verdict.note}` : '';
  await ledger.propose({ workItemId, calculationId: calc.id, entryJson: entry, explanation: explanation + flag, evidenceSourceIdsCsv: evidence, pendingConventionJson });
  await say(ledger, NAME, src.projectId, 'propose', `revenue adjustment ${usd(adj)} for approval${escalation ? ' (escalation: loss contract)' : ''}`, 'calculation', calc.id);
  const proposalId = ledger.state().proposals.find((p) => p.calculationId === calc.id)?.id;
  await reviewer.handlers.report(deps, src.projectId, review, proposalId != null ? 'proposal' : 'calculation', proposalId ?? calc.id);
  log(`proposal on work item ${workItemId}: adjustment ${usd(adj)}${escalation ? ' (ESCALATION)' : ''}`);
}

async function waitFor<T>(what: string, f: () => T | undefined, ms: number): Promise<T> {
  for (const deadline = Date.now() + ms; ; await new Promise((r) => setTimeout(r, 50))) {
    const v = f();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
  }
}

async function milestoneInvoice(src: SourceRow, x: Extraction, deps: Deps) {
  const ledger = ledgerOf(deps);
  if (!x.facts.some((f) => f.kind === 'milestone')) return skip(deps, src, 'commissioning log: no milestone fact');
  const m = ledger.state().milestones.find((r) => r.projectId === src.projectId && r.name === 'acceptance' && r.status === 'pending');
  if (!m) return skip(deps, src, 'commissioning log: no pending acceptance milestone');
  await ledger.markMilestoneMet({ milestoneId: m.id, evidenceSourceId: src.id });
  await ledger.openWorkItem({ projectId: src.projectId, title: MILESTONE_TITLE, assignedRole: 'controller' });
  const w = maxBy(ledger.state().workItems.filter((r) => r.projectId === src.projectId && r.title === MILESTONE_TITLE))!;
  // ponytail: calculationId 0 = no calculation; invoices need none (one invoice work item per milestone)
  await ledger.propose({
    workItemId: w.id, calculationId: 0n, entryJson: engine.handlers.invoiceEntry(m.amountCents),
    explanation: `Acceptance milestone met per commissioning log (source ${src.id}). Contract milestone billing of ${usd(m.amountCents)} is now invoiceable: reclassify from contract asset to accounts receivable. Revenue is unchanged.`,
    evidenceSourceIdsCsv: String(src.id), pendingConventionJson: '',
  });
  await say(ledger, NAME, src.projectId, 'propose', `milestone ${m.name} met; invoice ${usd(m.amountCents)} for approval`, 'work_item', w.id);
  log(`milestone ${m.name} met; work item ${w.id} proposed invoice ${usd(m.amountCents)}`);
}

/** Subscribe to new sources (deduped, one event at a time on the bus) and poll Convex for confirmations every second. Returns stop(). */
export function start(deps: Deps, opts: { isSeed?: (s: SourceRow) => boolean; pollMs?: number } = {}): () => void {
  const seen = new Set<string>(), handledConvex = new Set<string>(), attempts = new Map<string, number>();
  const bus = createBus();
  bus.on('source', (e) => attempt(e.key, seen, attempts, () => handleNewSource(e.source, deps)));
  bus.on('poll', () => fieldLiaison.handlers.poll(deps, handledConvex, attempts));
  const onSource = (s: SourceRow) => {
    const key = `${s.id}:${s.text}`; // ponytail: text in key guards against id reuse after reset_demo
    if (seen.has(key) || opts.isSeed?.(s)) return;
    seen.add(key);
    bus.emit({ kind: 'source', source: s, key });
  };
  deps.ledger.onSourceInsert(onSource);
  deps.ledger.state().sources.forEach(onSource); // catch up on anything added while the agent was down
  let polling = false;
  const timer = setInterval(() => {
    deps.ledger.state().sources.forEach(onSource); // re-queues sources whose last attempt failed
    if (polling) return;
    polling = true;
    bus.emit({ kind: 'poll' }).finally(() => (polling = false));
  }, opts.pollMs ?? 1000);
  return () => clearInterval(timer);
}

export const summo = {
  name: NAME, seat: 'project accountant', may: MAY,
  handlers: { source: handleNewSource, proposeFromClarification, start },
} satisfies Agent<unknown>;
