import { applyUpdate, adjustment, buildEntry, buildInvoiceEntry, compute, type Convention, type EntryLine } from '@keel/engine';
import { parseAmountCents } from './extract.js';
import type { Extraction, Explanation } from './schemas.js';
import type { ComputeOut } from './explain.js';
import { pollConfirmed } from './bridge.js';

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
  convex: { ask(a: { workItemId: string; question: string; options: string[] }): Promise<string>; byWorkItem(workItemId: string): Promise<ConvexClarification[]> };
  extract(text: string, sourceId: number): Promise<Extraction>;
  explain(input: { before: ComputeOut; after: ComputeOut; adjustmentCents: bigint; convention: string; evidence: string[] }): Promise<Explanation>;
};

export const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[agent]', ...a);
const READER = 'claude';
const MILESTONE_TITLE = 'Milestone invoice: acceptance';
const maxBy = <T extends { id: bigint }>(rows: T[]) => rows.reduce<T | undefined>((m, r) => (!m || r.id > m.id ? r : m), undefined);
const usd = (c: bigint) => `${c < 0n ? '-' : ''}$${(c < 0n ? -c : c) / 100n}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const entryJson = (lines: EntryLine[]) => JSON.stringify(lines.map((l) => ({ account: l.account, debit: String(l.debit), credit: String(l.credit) })));

// ponytail: keyword heuristic backing up Claude's flag; misses paraphrases ("on top of", "bump by"), upgrade = stricter extract prompt or a second classifier
export const isAdditiveWording = (text: string): boolean =>
  /\b(another|additional|more|extra)\b/i.test(text) && !/\b(new total|total remaining|remaining (is|of|now))\b/i.test(text);

// Amount comes from the quote (verified to be in the note); Claude's amountText only if it also appears in the note.
const factAmount = (f: Extraction['facts'][number] | undefined, noteText: string) =>
  f ? parseAmountCents(f.quote) ?? (f.amountText && noteText.includes(f.amountText) ? parseAmountCents(f.amountText) : null) : null;

/** Downstream state exists for this source, so it was fully handled (an extraction row alone does not count). */
function handled(s: LedgerState, src: SourceRow): boolean {
  if (s.calculations.some((c) => c.forecastSourceId === src.id) || s.clarificationRefs.some((c) => c.sourceId === src.id)) return true;
  return src.kind === 'commissioning_log' && s.milestones.some((m) => m.projectId === src.projectId && m.name === 'acceptance' && m.status === 'met');
}

export async function handleNewSource(src: SourceRow, deps: Deps): Promise<void> {
  const { ledger } = deps;
  if (!['note', 'forecast', 'commissioning_log'].includes(src.kind)) return;
  if (handled(ledger.state(), src)) return; // restart-safe
  log(`source ${src.id} (${src.kind}) -> extract`);
  const x = await deps.extract(src.text, Number(src.id));
  const fact = x.facts.find((f) => f.kind === 'remaining_update');
  const amount = factAmount(fact, src.text);
  const claudeFlag = x.ambiguity.flag;
  const ambiguous = claudeFlag || (src.kind !== 'commissioning_log' && amount != null && isAdditiveWording(fact!.quote || src.text));
  const question = claudeFlag ? x.ambiguity.question : 'Is the $X additional to the current remaining forecast, or the new total remaining?';
  const options = claudeFlag ? x.ambiguity.options : ['additional', 'new_total'];
  // ambiguityFlag must match what we act on: open_clarification binds to the newest flagged extraction.
  await ledger.recordExtraction({ sourceId: src.id, reader: READER, factsJson: JSON.stringify(x.facts), ambiguityFlag: ambiguous, ambiguityText: ambiguous ? question : x.ambiguity.question });
  log(`extraction recorded: ${x.facts.length} fact(s), ambiguous=${ambiguous}`);

  if (src.kind === 'commissioning_log') return milestoneInvoice(src, x, deps);
  if (amount == null) return log(`source ${src.id}: no remaining_update amount, nothing to propose`);
  if (!ambiguous) return proposeForecast(src, amount, 'new_total', [], '', deps);
  const conv = ledger.state().conventions.find((c) => c.template === 'forecast' && c.key === 'another_means');
  if (conv) {
    log(`convention another_means = ${conv.value} (policy v${conv.policyVersion}) applies; no question`);
    return proposeForecast(src, amount, conv.value as Convention, [`Convention v${conv.policyVersion}: another_means = ${conv.value}`], '', deps);
  }
  const workItemId = baseline(ledger.state(), src.projectId).workItemId;
  const convexId = await deps.convex.ask({ workItemId: String(workItemId), question, options });
  await ledger.openClarification({ workItemId, convexId, question });
  log(`clarification opened on work item ${workItemId} (convex ${convexId}): ${question}`);
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
  const fact = ext && (JSON.parse(ext.factsJson) as Extraction['facts']).find((f) => f.kind === 'remaining_update');
  const amount = note && factAmount(fact, note.text);
  if (!note || amount == null) return log(`clarification ${ref.id}: source ${ref.sourceId} has no amount; nothing to propose`);
  const clar = maxBy(s.sources.filter((x) => x.kind === 'clarification' && x.parentSourceId === note.id));
  await proposeForecast(note, amount, answer, clar ? [clar.text] : [], JSON.stringify({ template: 'forecast', key: 'another_means', value: answer }), deps, clar?.id);
}

export function normalizeAnswer(a: string): Convention | null {
  if (/new[\s_-]*total|\btotal\b/i.test(a)) return 'new_total';
  if (/addition|on top|\bmore\b|\bextra\b/i.test(a)) return 'additional';
  return null;
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
  const before = compute(snap), after = compute(next);
  const adj = adjustment(before.cumRevenue, after.cumRevenue);
  // explain first: a Claude failure must not leave an orphan calculation
  const x = await deps.explain({ before, after, adjustmentCents: adj, convention, evidence: [...citations, src.text] });
  await ledger.recordCalculation({
    workItemId, forecastSourceId: src.id,
    inputsJson: JSON.stringify({ contractValueCents: String(next.contractValue), incurredCents: String(next.incurred), remainingCents: String(next.remaining), billedCents: String(next.billed) }),
    progressBp: after.progressBp, cumRevenueCents: after.cumRevenue, contractAssetCents: after.contractAsset, marginCents: after.margin.amount, lossWarning: after.margin.lossWarning,
  });
  const calc = maxBy(ledger.state().calculations.filter((c) => c.workItemId === workItemId))!;
  log(`calculation ${calc.id}: remaining ${usd(next.remaining)} (${convention}), progress ${after.progressBp} bp, cum revenue ${usd(after.cumRevenue)}, adjustment ${usd(adj)}${after.margin.lossWarning ? ', LOSS WARNING' : ''}`);

  const escalation = after.margin.lossWarning
    ? `ESCALATION: expected margin ${usd(after.margin.amount)} on contract ${usd(next.contractValue)} (estimated total cost ${usd(after.estTotal)}); loss contract, controller review required.`
    : '';
  const explanation = [escalation, ...citations, x.summary, x.whyRevenueMoved, x.whatDidNotChange].filter(Boolean).join('\n');
  const evidence = [src.id, ...(extraEvidenceId ? [extraEvidenceId] : [])].join(',');
  await ledger.propose({ workItemId, calculationId: calc.id, entryJson: entryJson(buildEntry(adj)), explanation, evidenceSourceIdsCsv: evidence, pendingConventionJson });
  log(`proposal on work item ${workItemId}: adjustment ${usd(adj)}${escalation ? ' (ESCALATION)' : ''}`);
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
  const seen = new Set<string>(), handledConvex = new Set<string>();
  let chain = Promise.resolve();
  const serial = (what: string, f: () => Promise<void>) => (chain = chain.then(f).catch((e) => log(`ERROR ${what}:`, e?.message ?? e)));
  const onSource = (s: SourceRow) => {
    const key = `${s.id}:${s.text}`; // ponytail: text in key guards against id reuse after reset_demo
    if (seen.has(key) || opts.isSeed?.(s)) return;
    seen.add(key);
    serial(`source ${s.id}`, () => handleNewSource(s, deps));
  };
  deps.ledger.onSourceInsert(onSource);
  deps.ledger.state().sources.forEach(onSource); // catch up on anything added while the agent was down
  let polling = false;
  const timer = setInterval(() => {
    if (polling) return;
    polling = true;
    serial('convex poll', () => pollConfirmed(deps, handledConvex)).finally(() => (polling = false));
  }, opts.pollMs ?? 1000);
  return () => clearInterval(timer);
}
