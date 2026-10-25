import { applyUpdate, adjustment, buildEntry, buildInvoiceEntry, compute, type Convention, type EntryLine } from '@keel/engine';
import { parseAmountCents } from './extract.js';
import type { Extraction, Explanation } from './schemas.js';
import type { ExplainInput } from './explain.js';
import { pollConfirmed } from './bridge.js';
import { ocrNote, type ForecastDoc } from './azure-di.js';

// Structural row types: only the fields the agent reads (real binding rows are supersets).
export type SourceRow = { id: bigint; projectId: bigint; kind: string; text: string };
type ConventionRow = { template: string; key: string; value: string; policyVersion: number };
type WorkItemRow = { id: bigint; projectId: bigint; title: string };
type CalculationRow = { id: bigint; workItemId: bigint; inputsJson: string; forecastSourceId: bigint };
type ExtractionRow = { sourceId: bigint; reader: string; factsJson: string; ambiguityFlag: boolean };
type ProposalRow = { calculationId: bigint; status: string };
type MilestoneRow = { id: bigint; projectId: bigint; name: string; amountCents: bigint; status: string };
export type ClarificationRefRow = { id: bigint; workItemId: bigint; sourceId: bigint; convexId: string; status: string; answer: string; speaker: string; audioStorageId: string };
export type LedgerState = {
  projects: { id: bigint; contractValueCents: bigint }[];
  sources: (SourceRow & { parentSourceId: bigint })[];
  conventions: ConventionRow[]; workItems: WorkItemRow[]; calculations: CalculationRow[];
  extractions: ExtractionRow[]; milestones: MilestoneRow[]; clarificationRefs: ClarificationRefRow[]; proposals: ProposalRow[];
};

// Reducer calls take the generated bindings' camelCase arg objects, so the real adapter is `conn.reducers`.
export type Ledger = {
  state(): LedgerState;
  onSourceInsert(cb: (s: SourceRow) => void): void;
  recordExtraction(a: { sourceId: bigint; reader: string; factsJson: string; ambiguityFlag: boolean; ambiguityText: string }): Promise<void>;
  openClarification(a: { workItemId: bigint; convexId: string; question: string }): Promise<void>;
  resolveClarification(a: { clarificationId: bigint; answer: string; speaker: string; audioStorageId: string }): Promise<void>;
  recordCalculation(a: { workItemId: bigint; forecastSourceId: bigint; inputsJson: string; progressBp: number; cumRevenueCents: bigint; contractAssetCents: bigint; marginCents: bigint; lossWarning: boolean }): Promise<void>;
  propose(a: { workItemId: bigint; calculationId: bigint; entryJson: string; explanation: string; evidenceSourceIdsCsv: string; pendingConventionJson: string }): Promise<void>;
  openWorkItem(a: { projectId: bigint; title: string; assignedRole: string }): Promise<void>;
  markMilestoneMet(a: { milestoneId: bigint; evidenceSourceId: bigint }): Promise<void>;
};
export type ConvexClarification = { _id: string; status: string; answer?: string; speaker?: string; answerAudioId?: string };
export type Deps = {
  ledger: Ledger;
  convex: { ask(a: { workItemId: string; question: string; options: string[] }): Promise<string>; byWorkItem(workItemId: string): Promise<ConvexClarification[]>; fallbackText(id: string): Promise<unknown> };
  extract(text: string, sourceId: number): Promise<Extraction>;
  /** Two-reader extraction (Claude + Gemini). Absent = `extract` as the only reader. */
  extractBoth?(text: string, sourceId: number): Promise<{ claude: Extraction; gemini: Extraction | null; agreed: boolean; merged: Extraction }>;
  explain(input: ExplainInput): Promise<Explanation>;
  /** scanned_forecast only: bytes of a Convex storage object, and the OCR reader (Azure Document Intelligence). */
  fetchDocument?(storageId: string): Promise<Uint8Array>;
  readForecastDocument?(bytes: Uint8Array, contentType: string): Promise<ForecastDoc>;
};

export const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[agent]', ...a);
const READER = 'claude';
const MILESTONE_TITLE = 'Milestone invoice: acceptance';
const maxBy = <T extends { id: bigint }>(rows: T[]) => rows.reduce<T | undefined>((m, r) => (!m || r.id > m.id ? r : m), undefined);
const usd = (c: bigint) => `${c < 0n ? '-' : ''}$${(c < 0n ? -c : c) / 100n}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const EXPLAIN_TIMEOUT_MS = 20_000, CALC_WAIT_MS = 5_000, MAX_ATTEMPTS = 3;
const entryJson = (lines: EntryLine[]) => JSON.stringify(lines.map((l) => ({ account: l.account, debit: String(l.debit), credit: String(l.credit) })));

// ponytail: keyword heuristic backing up Claude's flag; misses paraphrases ("on top of", "bump by"), upgrade = stricter extract prompt or a second classifier
export const isAdditiveWording = (text: string): boolean =>
  /\b(another|additional|more|extra|add(ed)?|grand|bump(ed)?|over budget|overrun)\b/i.test(text) && !/\b(new total|total remaining|remaining (is|of|now)|new number|is now|now expect|down to)\b/i.test(text);

// ponytail: keyword heuristic for savings. "down to" names the new total; "less/under/saved" lowers the remaining (negative additional, no question).
export const isReductionWording = (text: string): Convention | null =>
  /\b(came )?down to\b/i.test(text) ? 'new_total' : /\b(less|under|saved|savings?|lower|cheaper)\b/i.test(text) ? 'additional' : null;

// Reduction read from the fact's quote, the model's minus sign, or (only when the note has no additive wording) the whole note.
const reductionOf = (f: Extraction['facts'][number], noteText: string): Convention | null =>
  isReductionWording(f.quote) ?? (/^\s*(-|\u2212|minus\b)/i.test(f.amountText) ? 'additional' : null)
    ?? (isAdditiveWording(noteText) ? null : isReductionWording(noteText));
const abs = (c: bigint) => (c < 0n ? -c : c);
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

/** OCR a scanned forecast once (the azure-di extraction row is the cache on retry); returns the source with its OCR note as text. */
async function readScanned(src: SourceRow, deps: Deps): Promise<SourceRow> {
  const prior = deps.ledger.state().extractions.find((e) => e.sourceId === src.id && e.reader === 'azure-di');
  let doc = prior && (JSON.parse(prior.factsJson) as ForecastDoc);
  if (!doc) {
    if (!deps.fetchDocument || !deps.readForecastDocument) throw new Error('scanned_forecast needs fetchDocument + readForecastDocument deps');
    const bytes = await deps.fetchDocument(src.text);
    doc = await deps.readForecastDocument(bytes, 'application/octet-stream');
    await deps.ledger.recordExtraction({ sourceId: src.id, reader: 'azure-di', factsJson: JSON.stringify(doc), ambiguityFlag: false, ambiguityText: '' });
    log(`source ${src.id}: azure-di read ${bytes.length} bytes, ${doc.tables.length} table(s)`);
  }
  return { ...src, text: ocrNote(doc) };
}

export async function handleNewSource(src: SourceRow, deps: Deps): Promise<void> {
  const { ledger } = deps;
  if (!['note', 'forecast', 'commissioning_log', 'scanned_forecast'].includes(src.kind)) return;
  if (handled(ledger.state(), src)) return; // restart-safe
  // ponytail: text swap means a clarification on a scanned forecast reads amounts from the fact quote only (note.text is the storageId)
  if (src.kind === 'scanned_forecast') src = await readScanned(src, deps);
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
  await ledger.recordExtraction({ sourceId: src.id, reader: READER, factsJson: JSON.stringify(x.facts), ambiguityFlag: ambiguous, ambiguityText: ambiguous ? question : x.ambiguity.question });
  const g = both.gemini;
  if (g) await ledger.recordExtraction({ sourceId: src.id, reader: 'gemini', factsJson: JSON.stringify(g.facts), ambiguityFlag: g.ambiguity.flag, ambiguityText: g.ambiguity.question });
  log(`extraction recorded: ${x.facts.length} fact(s), ambiguous=${ambiguous}${g ? `, second reader ${both.agreed ? 'agrees' : 'disagrees'}` : ''}`);

  if (src.kind === 'commissioning_log') return milestoneInvoice(src, x, deps);
  if (amount == null && !ambiguous) return log(`source ${src.id}: no remaining_update amount, nothing to propose`);
  if (amount != null && remainingEstimate) return proposeForecast(src, amount, 'new_total', [`Convention v${reConv!.policyVersion}: remaining_estimate_means = ${reConv!.value} (a Remaining Estimate is the new total remaining)`], '', deps);
  if (amount != null && !ambiguous) return proposeForecast(src, signed(amount, red ?? 'new_total', red), red ?? 'new_total', [], '', deps);
  const conv = ledger.state().conventions.find((c) => c.template === 'forecast' && c.key === 'another_means');
  if (conv && both.agreed && amount != null && !overdrawn) { // readers disagreeing on the amount is not something a convention can answer
    log(`convention another_means = ${conv.value} (policy v${conv.policyVersion}) applies; no question`);
    return proposeForecast(src, signed(amount, conv.value as Convention, red), conv.value as Convention, [`Convention v${conv.policyVersion}: another_means = ${conv.value}`], '', deps);
  }
  const workItemId = baseline(ledger.state(), src.projectId).workItemId;
  const convexId = await deps.convex.ask({ workItemId: String(workItemId), question, options });
  await ledger.openClarification({ workItemId, convexId, question });
  log(`clarification opened on work item ${workItemId} (convex ${convexId}): ${question}${amount == null ? ' [amount unknown]' : ''}`);
}

/** Called by the bridge once Convex reports the clarification confirmed. */
export async function resumeClarification(ref: ClarificationRefRow, c: ConvexClarification, deps: Deps): Promise<void> {
  const answer = normalizeAnswer(c.answer ?? '');
  if (!answer) return log(`clarification ${ref.id}: answer "${c.answer}" is neither additional nor new_total; left open`);
  await deps.ledger.resolveClarification({ clarificationId: ref.id, answer, speaker: c.speaker ?? '', audioStorageId: c.answerAudioId ?? '' });
  log(`clarification ${ref.id} resolved: ${answer} (${c.speaker})`);
  return proposeFromClarification(ref, answer, deps);
}

/** Forecast proposal for an already-confirmed clarification (also the restart path when resolve succeeded but no calculation followed). */
export async function proposeFromClarification(ref: ClarificationRefRow, answer: Convention, deps: Deps): Promise<void> {
  const s = deps.ledger.state();
  const note = s.sources.find((x) => x.id === ref.sourceId);
  const ext = s.extractions.find((e) => e.sourceId === ref.sourceId && e.reader === READER);
  const fact = ext && note && amountFact(JSON.parse(ext.factsJson) as Extraction['facts'], note.text, true); // a clarification was asked, so it was additive
  const parsed = note && factAmount(fact, note.text);
  // ponytail: "amount not stated" is a log line only; a ledger history note needs a reducer (spacetimedb is out of this module's scope)
  if (!note || parsed == null) return log(`clarification ${ref.id}: amount not stated in source ${ref.sourceId}; no proposal`);
  const red = reductionOf(fact!, note.text);
  const clar = maxBy(s.sources.filter((x) => x.kind === 'clarification' && x.parentSourceId === note.id));
  await proposeForecast(note, signed(abs(parsed), answer, red), answer, clar ? [clar.text] : [], JSON.stringify({ template: 'forecast', key: 'another_means', value: answer }), deps, clar?.id);
}

/** Both or neither pattern ("additional, not a new total") = unclear -> null, the caller re-asks as text. */
export function normalizeAnswer(a: string): Convention | null {
  const total = /new[\s_-]*total|\btotal\b/i.test(a), add = /addition|on top|\bmore\b|\bextra\b/i.test(a);
  return total === add ? null : total ? 'new_total' : 'additional';
}

// Baseline = newest calculation with an approved/posted proposal (its inputsJson carries the snapshot), else the oldest (seed) one.
function baseline(s: LedgerState, projectId: bigint) {
  const wis = new Set(s.workItems.filter((w) => w.projectId === projectId).map((w) => w.id));
  const calcs = s.calculations.filter((x) => wis.has(x.workItemId));
  const ok = new Set(s.proposals.filter((p) => p.status === 'approved' || p.status === 'posted').map((p) => p.calculationId));
  const c = maxBy(calcs.filter((x) => ok.has(x.id))) ?? calcs.reduce<CalculationRow | undefined>((m, r) => (!m || r.id < m.id ? r : m), undefined);
  if (!c) throw new Error(`no baseline calculation for project ${projectId}`);
  const i = JSON.parse(c.inputsJson) as Record<string, string>;
  return {
    workItemId: c.workItemId,
    snap: { contractValue: BigInt(i.contractValueCents), incurred: BigInt(i.incurredCents), remaining: BigInt(i.remainingCents), billed: BigInt(i.billedCents) },
  };
}

async function proposeForecast(src: SourceRow, amount: bigint, convention: Convention, citations: string[], pendingConventionJson: string, deps: Deps, extraEvidenceId?: bigint) {
  const { ledger } = deps;
  const { workItemId, snap } = baseline(ledger.state(), src.projectId);
  const next = { ...snap, remaining: applyUpdate(snap.remaining, amount, convention) };
  if (next.remaining < 0n) return log(`source ${src.id}: ${convention} ${usd(amount)} would make remaining ${usd(next.remaining)}; not proposed`);
  const before = compute(snap), after = compute(next);
  const adj = adjustment(before.cumRevenue, after.cumRevenue);
  const input: ExplainInput = {
    before, after, adjustmentCents: adj, convention, evidence: [...citations, src.text],
    contractValueCents: snap.contractValue, incurredCents: snap.incurred, remainingBeforeCents: snap.remaining, remainingAfterCents: next.remaining,
  };
  // Numbers first (the UI shows them within seconds of confirm); explain can only degrade to the template, never orphan this row.
  await ledger.recordCalculation({
    workItemId, forecastSourceId: src.id,
    inputsJson: JSON.stringify({ contractValueCents: String(next.contractValue), incurredCents: String(next.incurred), remainingCents: String(next.remaining), billedCents: String(next.billed) }),
    progressBp: after.progressBp, cumRevenueCents: after.cumRevenue, contractAssetCents: after.contractAsset, marginCents: after.margin.amount, lossWarning: after.margin.lossWarning,
  });
  const calc = await waitFor(`calculation for source ${src.id}`, () => maxBy(ledger.state().calculations.filter((c) => c.forecastSourceId === src.id)), CALC_WAIT_MS);
  log(`calculation ${calc.id}: remaining ${usd(next.remaining)} (${convention}), progress ${after.progressBp} bp, cum revenue ${usd(after.cumRevenue)}, adjustment ${usd(adj)}${after.margin.lossWarning ? ', LOSS WARNING' : ''}`);
  const x = await checkedExplain(input, amount, deps);

  const escalation = after.margin.lossWarning
    ? `ESCALATION: expected margin ${usd(after.margin.amount)} on contract ${usd(next.contractValue)} (estimated total cost ${usd(after.estTotal)}); loss contract, controller review required.`
    : '';
  const explanation = [escalation, ...citations, x.summary, x.whyRevenueMoved, x.whatDidNotChange].filter(Boolean).join('\n');
  const evidence = [src.id, ...(extraEvidenceId ? [extraEvidenceId] : [])].join(',');
  await ledger.propose({ workItemId, calculationId: calc.id, entryJson: entryJson(buildEntry(adj)), explanation, evidenceSourceIdsCsv: evidence, pendingConventionJson });
  log(`proposal on work item ${workItemId}: adjustment ${usd(adj)}${escalation ? ' (ESCALATION)' : ''}`);
}

async function waitFor<T>(what: string, f: () => T | undefined, ms: number): Promise<T> {
  for (const deadline = Date.now() + ms; ; await new Promise((r) => setTimeout(r, 50))) {
    const v = f();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
  }
}

const pct = (bp: bigint | number) => `${Number(bp) / 100}%`;
export function templateExplanation(i: ExplainInput): Explanation {
  const { before: b, after: a } = i;
  const dir = i.remainingAfterCents > i.remainingBeforeCents ? 'rose' : i.remainingAfterCents < i.remainingBeforeCents ? 'fell' : 'stayed';
  return {
    summary: `The estimate to finish ${dir} from ${usd(i.remainingBeforeCents)} to ${usd(i.remainingAfterCents)} (read as ${i.convention}), so estimated total cost is now ${usd(a.estTotal)} (was ${usd(b.estTotal)}). Cumulative revenue recognised moves from ${usd(b.cumRevenue)} to ${usd(a.cumRevenue)}, a journal entry of ${usd(i.adjustmentCents)}. Expected margin is now ${usd(a.margin.amount)} (was ${usd(b.margin.amount)}).`,
    whyRevenueMoved: `Progress is cost incurred (${usd(i.incurredCents)}) over estimated total cost, so the new estimate moves progress from ${pct(b.progressBp)} to ${pct(a.progressBp)}, and revenue on the ${usd(i.contractValueCents)} contract follows progress. Evidence: ${i.evidence.map((e) => `"${e}"`).join('; ')}.`,
    whatDidNotChange: `Cash and the customer invoice are unchanged; the contract asset moves from ${usd(b.contractAsset)} to ${usd(a.contractAsset)}. This is an estimate update, not an error or a restatement.`,
  };
}

const FIGURE = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?(?:\s*(?:million|billion|thousand|mm|bn)\b)?/gi;
/** First $-figure in the explanation that is not one of the input-derived values (exact or whole-dollar), else undefined. */
export function unverifiedFigure(x: Explanation, i: ExplainInput, updateAmount: bigint): string | undefined {
  const vals = [i.contractValueCents, i.incurredCents, i.remainingBeforeCents, i.remainingAfterCents, i.before.estTotal, i.after.estTotal,
    i.before.cumRevenue, i.after.cumRevenue, i.before.contractAsset, i.after.contractAsset, i.adjustmentCents, i.before.margin.amount, i.after.margin.amount, updateAmount]
    .map((v) => (v < 0n ? -v : v));
  const ok = new Set(vals.flatMap((v) => [v, (v / 100n) * 100n, ((v + 50n) / 100n) * 100n]));
  return [x.summary, x.whyRevenueMoved, x.whatDidNotChange].join('\n').match(FIGURE)?.find((m) => { const c = parseAmountCents(m); return c == null || !ok.has(c); });
}

async function checkedExplain(input: ExplainInput, updateAmount: bigint, deps: Deps): Promise<Explanation> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const x = await Promise.race([deps.explain(input), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('explain timeout')), EXPLAIN_TIMEOUT_MS); })]);
    const bad = unverifiedFigure(x, input, updateAmount);
    if (!bad) return x;
    log(`explanation replaced: unverified number ${bad}`);
  } catch (e: any) {
    log(`explain failed (${e?.message ?? e}); using template explanation`);
  } finally { clearTimeout(timer); }
  return templateExplanation(input);
}

/** Run f once per key; on failure forget the key (so the next poll retries) until MAX_ATTEMPTS, then give up. Rethrows. */
export async function attempt(key: string, done: Set<string>, attempts: Map<string, number>, f: () => Promise<void>): Promise<void> {
  done.add(key);
  try { await f(); } catch (e) {
    const n = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, n);
    if (n < MAX_ATTEMPTS) done.delete(key); else log(`giving up on ${key} after ${n} attempts`);
    throw e;
  }
}

async function milestoneInvoice(src: SourceRow, x: Extraction, deps: Deps) {
  const { ledger } = deps;
  if (!x.facts.some((f) => f.kind === 'milestone')) return log(`commissioning log ${src.id}: no milestone fact`);
  const m = ledger.state().milestones.find((r) => r.projectId === src.projectId && r.name === 'acceptance' && r.status === 'pending');
  if (!m) return log(`commissioning log ${src.id}: no pending acceptance milestone`);
  await ledger.markMilestoneMet({ milestoneId: m.id, evidenceSourceId: src.id });
  await ledger.openWorkItem({ projectId: src.projectId, title: MILESTONE_TITLE, assignedRole: 'controller' });
  const w = maxBy(ledger.state().workItems.filter((r) => r.projectId === src.projectId && r.title === MILESTONE_TITLE))!;
  // ponytail: calculationId 0 = no calculation; invoices need none (one invoice work item per milestone)
  await ledger.propose({
    workItemId: w.id, calculationId: 0n, entryJson: entryJson(buildInvoiceEntry(m.amountCents)),
    explanation: `Acceptance milestone met per commissioning log (source ${src.id}). Contract milestone billing of ${usd(m.amountCents)} is now invoiceable: reclassify from contract asset to accounts receivable. Revenue is unchanged.`,
    evidenceSourceIdsCsv: String(src.id), pendingConventionJson: '',
  });
  log(`milestone ${m.name} met; work item ${w.id} proposed invoice ${usd(m.amountCents)}`);
}

/** Subscribe to new sources (deduped, processed one at a time) and poll Convex for confirmations every second. Returns stop(). */
export function startLoop(deps: Deps, opts: { isSeed?: (s: SourceRow) => boolean; pollMs?: number } = {}): () => void {
  const seen = new Set<string>(), handledConvex = new Set<string>(), attempts = new Map<string, number>();
  let chain = Promise.resolve();
  const serial = (what: string, f: () => Promise<void>) => (chain = chain.then(f).catch((e) => log(`ERROR ${what}:`, e?.message ?? e)));
  const onSource = (s: SourceRow) => {
    const key = `${s.id}:${s.text}`; // ponytail: text in key guards against id reuse after reset_demo
    if (seen.has(key) || opts.isSeed?.(s)) return;
    seen.add(key);
    serial(`source ${s.id}`, () => attempt(key, seen, attempts, () => handleNewSource(s, deps)));
  };
  deps.ledger.onSourceInsert(onSource);
  deps.ledger.state().sources.forEach(onSource); // catch up on anything added while the agent was down
  let polling = false;
  const timer = setInterval(() => {
    deps.ledger.state().sources.forEach(onSource); // re-queues sources whose last attempt failed
    if (polling) return;
    polling = true;
    serial('convex poll', () => pollConfirmed(deps, handledConvex, attempts)).finally(() => (polling = false));
  }, opts.pollMs ?? 1000);
  return () => clearInterval(timer);
}
