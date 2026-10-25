// Pure selectors from ledger snapshot → screen view models. Every financial figure shown in the UI
// is either a ledger value (calculation / proposal / posting rows) or an engine preview computed here.
import { adjustment, applyUpdate, compute } from '@keel/engine';
import { ids, lines, type Line } from '../lib/format';
import { parseAmountCents } from './demoBackend';
import type { Calculation, ClarificationRef, Posting, Proposal, Snapshot, Source, Approval, ClarificationAnswer } from './model';

export type Inputs = { contractValue: bigint; incurred: bigint; remaining: bigint; billed: bigint };
export const inputsOf = (c: Calculation): Inputs => {
  const i = JSON.parse(c.inputsJson) as Record<string, string>;
  return { contractValue: BigInt(i.contractValueCents), incurred: BigInt(i.incurredCents), remaining: BigInt(i.remainingCents), billed: BigInt(i.billedCents) };
};

export type Stage = 'idle' | 'reading' | 'awaiting_clarification' | 'unconfirmed' | 'calculating' | 'proposed' | 'approved' | 'posted' | 'returned' | 'held' | 'stale';
export type StepState = 'done' | 'now' | 'todo' | 'blocked';
export interface Step { key: string; label: string; actor: 'Agent' | 'Manager' | 'Engine' | 'Controller' | 'Ledger'; state: StepState }

export interface Reading { remaining: bigint; estTotal: bigint; progressBp: number; cumRevenue: bigint; contractAsset: bigint; margin: bigint; adjustment: bigint }

export interface CaseView {
  stage: Stage;
  workItemId: bigint | null;
  note: Source | null;
  noteAmount: bigint | null;
  latest: Proposal | null;
  before: Calculation | null;
  after: Calculation | null;
  beforeInputs: Inputs | null;
  afterInputs: Inputs | null;
  adjustmentCents: bigint | null;
  entry: Line[];
  posting: Posting | null;
  approval: Approval | null;
  ref: ClarificationRef | null;
  clarificationSource: Source | null;
  readings: Record<ClarificationAnswer, Reading> | null;
  steps: Step[];
  escalation: string | null;
  explanation: string[];
  evidence: Source[];
  pendingConvention: { template: string; key: string; value: string } | null;
}

const maxBy = <T,>(xs: T[], k: (x: T) => bigint | number) => xs.reduce<T | null>((m, r) => (m === null || k(r) > k(m) ? r : m), null);

export const oakland = (s: Snapshot) => s.projects.find((p) => p.name === 'Oakland deployment') ?? s.projects[0] ?? null;

/** The six prior-close notes that taught the seed convention (guide §5 "Learns screen"). */
export function priorCloseNotes(s: Snapshot): Source[] {
  const seedConv = s.conventions.reduce<Snapshot['conventions'][number] | null>((m, c) => (!m || c.id < m.id ? c : m), null);
  const set = new Set(seedConv ? ids(seedConv.exampleSourceIds).map(String) : []);
  return s.sources.filter((x) => set.has(String(x.id)));
}

/** Notes added during this close (not the seed's prior-close notes). */
export function liveNotes(s: Snapshot): Source[] {
  const prior = new Set(priorCloseNotes(s).map((x) => String(x.id)));
  return s.sources.filter((x) => x.kind === 'note' && !prior.has(String(x.id))).sort((a, b) => Number(a.id - b.id));
}

export function revenueWorkItemId(s: Snapshot): bigint | null {
  const calcWis = new Set(s.calculations.map((c) => String(c.workItemId)));
  return s.workItems.find((w) => calcWis.has(String(w.id)))?.id ?? null;
}

export function noteAmount(s: Snapshot, note: Source): bigint | null {
  const ext = s.extractions.find((e) => e.sourceId === note.id && e.reader === 'claude');
  if (ext) {
    try {
      const fact = (JSON.parse(ext.factsJson) as { kind: string; amountCents?: string | number }[]).find((f) => f.kind === 'remaining_update');
      if (fact?.amountCents != null) return BigInt(fact.amountCents);
    } catch { /* fall back to text */ }
  }
  return parseAmountCents(note.text);
}

export function caseView(s: Snapshot): CaseView {
  const wiId = revenueWorkItemId(s);
  const props = s.proposals.filter((p) => p.workItemId === wiId).sort((a, b) => a.revision - b.revision);
  const latest = props[props.length - 1] ?? null;
  const calc = (id: bigint | undefined) => (id ? s.calculations.find((c) => c.id === id) ?? null : null);
  const note = liveNotes(s).at(-1) ?? null;
  const amount = note ? noteAmount(s, note) : null;

  // "Before" = highest-revision approved/posted proposal below the latest (mirrors loop.ts baseline).
  const baseProp = maxBy(props.filter((p) => latest && p.revision < latest.revision && (p.status === 'approved' || p.status === 'posted')), (p) => p.revision);
  const latestIsForNote = !!(note && latest && calc(latest.calculationId)?.forecastSourceId === note.id);
  const after = latestIsForNote ? calc(latest!.calculationId) : null;
  const before = latestIsForNote ? calc(baseProp?.calculationId) : calc(latest?.calculationId);
  const beforeInputs = before ? inputsOf(before) : null;
  const ref = note ? maxBy(s.clarificationRefs.filter((r) => r.sourceId === note.id), (r) => r.id) : null;
  const clarificationSource = note ? maxBy(s.sources.filter((x) => x.kind === 'clarification' && x.parentSourceId === note.id), (x) => x.id) : null;
  const posting = latest && (latestIsForNote || !note) ? s.postings.find((p) => p.proposalId === latest.id) ?? null : null;
  const approval = latest ? maxBy(s.approvals.filter((a) => a.proposalId === latest.id), (a) => a.id) : null;
  const call = s.call && ref && s.call.id === ref.convexId ? s.call : null;

  let stage: Stage = 'idle';
  if (note) {
    if (latestIsForNote) {
      stage = posting ? 'posted' : ({ open: 'proposed', approved: 'approved', returned: 'returned', held: 'held', stale: 'stale' } as Record<string, Stage>)[latest!.status] ?? 'proposed';
    } else if (ref?.status === 'open') stage = call?.status === 'unconfirmed' ? 'unconfirmed' : 'awaiting_clarification';
    else if (ref?.status === 'confirmed' || s.agentBusy) stage = ref ? 'calculating' : 'reading';
    else stage = 'reading';
  }

  // Engine preview of both readings while the answer is unknown (not recorded on the ledger).
  let readings: CaseView['readings'] = null;
  if (beforeInputs && amount != null && note) {
    const b = compute(beforeInputs);
    const mk = (c: ClarificationAnswer): Reading => {
      const next = { ...beforeInputs, remaining: applyUpdate(beforeInputs.remaining, amount, c) };
      const a = compute(next);
      return { remaining: next.remaining, estTotal: a.estTotal, progressBp: a.progressBp, cumRevenue: a.cumRevenue, contractAsset: a.contractAsset, margin: a.margin.amount, adjustment: adjustment(b.cumRevenue, a.cumRevenue) };
    };
    readings = { additional: mk('additional'), new_total: mk('new_total') };
  }

  const explanation = latestIsForNote ? latest!.explanation.split('\n').filter(Boolean) : [];
  const escalation = explanation[0]?.startsWith('ESCALATION:') ? explanation[0].replace(/^ESCALATION:\s*/, '') : null;
  const evidence = latestIsForNote ? ids(latest!.evidenceSourceIds).map((id) => s.sources.find((x) => x.id === id)).filter((x): x is Source => !!x) : [];
  let pendingConvention: CaseView['pendingConvention'] = null;
  if (latestIsForNote && latest!.pendingConventionJson) { try { pendingConvention = JSON.parse(latest!.pendingConventionJson); } catch { /* ignore */ } }

  const order: Stage[] = ['reading', 'awaiting_clarification', 'calculating', 'proposed', 'approved', 'posted'];
  const at = stage === 'idle' ? -1 : stage === 'unconfirmed' ? 1 : ['returned', 'held', 'stale'].includes(stage) ? 3 : order.indexOf(stage);
  const usedClarification = !!ref;
  const st = (i: number): StepState => (stage === 'unconfirmed' && i === 1 ? 'blocked' : at > i || stage === 'posted' ? 'done' : at === i ? 'now' : 'todo');
  const steps: Step[] = note ? [
    { key: 'detected', label: 'Detected', actor: 'Agent', state: 'done' },
    { key: 'reviewed', label: 'Evidence reviewed', actor: 'Agent', state: stage === 'reading' ? 'now' : 'done' },
    { key: 'clarify', label: usedClarification || stage === 'reading' ? 'Clarification' : 'Convention applied', actor: usedClarification || stage === 'reading' ? 'Manager' : 'Agent', state: st(1) },
    { key: 'calc', label: 'Recalculated', actor: 'Engine', state: st(2) },
    { key: 'approve', label: 'Controller approval', actor: 'Controller', state: st(3) },
    { key: 'post', label: 'Posted', actor: 'Ledger', state: st(5) },
  ] : [];
  if (steps[4] && stage === 'approved') steps[4].state = 'done';
  if (steps[5] && stage === 'approved') steps[5].state = 'now';

  return {
    stage, workItemId: wiId, note, noteAmount: amount, latest, before, after, beforeInputs, afterInputs: after ? inputsOf(after) : null,
    adjustmentCents: before && after ? after.cumRevenueCents - before.cumRevenueCents : null,
    entry: latestIsForNote ? lines(latest!.entryJson) : [], posting, approval, ref, clarificationSource, readings, steps, escalation, explanation, evidence, pendingConvention,
  };
}

export const postingRef = (p: Proposal) => `OAK-WI${p.workItemId}-R${p.revision}`;
