import { compute } from '@keel/engine';
import { parseAmountCents } from '../extract.js';
import { guardedLedger, log, say, type Agent } from '../bus.js';
import type { ClarificationRefRow, ConvexClarification, Deps, LedgerState } from '../loop.js';
import { engine, maxBy, usd } from './engine.js';
import { fieldLiaison } from './field-liaison.js';
import { guard } from './guard.js';
import { waitFor } from './summo.js';

// Intake (seat: onboarding accountant). A new project (work item 'Onboarding intake') has no baseline: ask the site lead four figures,
// one open question at a time, then record the opening calculation and propose the opening entry. Restart-safe: the ledger's
// intake sources say which figures are in, an open ref on the work item means a question is out.
// After the proposal, notes on the project take summo's normal path; baseline() uses the opening calculation until a later one is approved.
const NAME = 'intake', MAY = ['recordIntake', 'recordCalculation', 'propose'] as const; // questions go through the field liaison
export const INTAKE_TITLE = 'Onboarding intake';
const FIELDS = ['contract', 'incurred', 'remaining', 'billed'] as const;
type Field = (typeof FIELDS)[number];
const QUESTIONS: Record<Field, string> = {
  contract: 'Welcome. What is this contract worth in total?',
  incurred: 'What have you spent on it so far?',
  remaining: 'What will it take to finish from here?',
  billed: 'What have you billed the customer to date?',
};
export const REASK = "I didn't catch the figure. Say it as a number, like 1,000,000.";
const WAIT_MS = 5_000;
const NO_LIMIT = 1n << 62n; // intake figures have no baseline to be absurd against; the guard screens text only

export const isIntakeWorkItem = (s: LedgerState, id: bigint) => s.workItems.some((w) => w.id === id && (w.status === 'intake' || w.title === INTAKE_TITLE));

/** Recorded figures for a project, from intake sources (`${field}=${cents} | ...`). */
function figures(s: LedgerState, projectId: bigint): Partial<Record<Field, { id: bigint; cents: bigint }>> {
  const out: Partial<Record<Field, { id: bigint; cents: bigint }>> = {};
  for (const src of s.sources) {
    const m = src.projectId === projectId && src.kind === 'intake' ? src.text.match(/^(\w+)=(-?\d+)/) : null;
    if (m) out[m[1] as Field] = { id: src.id, cents: BigInt(m[2]) };
  }
  return out;
}

// ponytail: a bare digit string is the phone's cents; anything else is spoken/typed dollars. A typed "1000000" therefore reads as $10,000.
export const amountOf = (a: string): bigint | null => (/^\d+$/.test(a.trim()) ? BigInt(a.trim()) : parseAmountCents(a));

async function askOne(deps: Deps, projectId: bigint, workItemId: bigint, question: string) {
  await fieldLiaison.handlers.ask(deps, projectId, workItemId, question, [], '', 'amount');
  await waitFor('intake question ref', () => deps.ledger.state().clarificationRefs.find((c) => c.workItemId === workItemId && c.status === 'open'), WAIT_MS);
}

/** Confirmed amount answer on an intake work item: record it and ask the next figure, or re-ask. */
async function answer(ref: ClarificationRefRow, c: ConvexClarification, deps: Deps): Promise<void> {
  const ledger = guardedLedger(deps.ledger, NAME, MAY);
  const w = ledger.state().workItems.find((x) => x.id === ref.workItemId);
  if (!w) throw new Error(`intake: work item ${ref.workItemId} not found`);
  const field = FIELDS.find((f) => !figures(ledger.state(), w.projectId)[f]);
  const text = c.answer ?? '';
  const closed = () => waitFor(`ref ${ref.id} closed`, () => ledger.state().clarificationRefs.find((x) => x.id === ref.id && x.status !== 'open'), WAIT_MS);
  if (!field) return fieldLiaison.handlers.close(deps, ref, c, text); // stray answer after intake finished
  const v = guard.handlers.screen(text, 'intake', NO_LIMIT, 0n);
  await say(ledger, guard.name, w.projectId, v.flagged ? 'flag' : 'pass', v.flagged ? v.reasons.join(', ') : 'no injection, markup or absurd figures', 'clarification_ref', ref.id);
  const cents = v.flagged ? null : amountOf(text);
  if (cents == null || cents < 0n) {
    log(`intake ${field}: answer "${text}" not a figure; re-asking`);
    await fieldLiaison.handlers.close(deps, ref, c, text);
    await closed();
    return askOne(deps, w.projectId, w.id, REASK);
  }
  // record before resolve: a crash in between leaves the ref open and the retry re-records (idempotent per field)
  await ledger.recordIntake!({ projectId: w.projectId, field, cents, speaker: c.speaker ?? '', text });
  await waitFor(`intake ${field}`, () => (figures(ledger.state(), w.projectId)[field]?.cents === cents ? true : undefined), WAIT_MS);
  await fieldLiaison.handlers.close(deps, ref, c, String(cents));
  await closed();
  await say(ledger, NAME, w.projectId, 'intake', `${field} = ${usd(cents)} from ${c.speaker || 'site lead'}`, 'work_item', w.id);
  log(`intake ${field} = ${usd(cents)} from ${c.speaker}`);
  return step(deps, w);
}

/** Next move for one intake work item: ask the first missing figure (unless one is out), or finish. */
async function step(deps: Deps, w: { id: bigint; projectId: bigint }): Promise<void> {
  const s = deps.ledger.state(), fig = figures(s, w.projectId);
  const field = FIELDS.find((f) => !fig[f]);
  if (!field) return finish(deps, w, fig as Record<Field, { id: bigint; cents: bigint }>);
  if (s.clarificationRefs.some((c) => c.workItemId === w.id && c.status === 'open')) return; // one at a time
  return askOne(deps, w.projectId, w.id, QUESTIONS[field]);
}

async function finish(deps: Deps, w: { id: bigint; projectId: bigint }, fig: Record<Field, { id: bigint; cents: bigint }>) {
  const ledger = guardedLedger(deps.ledger, NAME, MAY);
  const rem = fig.remaining.id;
  const mine = () => maxBy(ledger.state().calculations.filter((c) => c.workItemId === w.id && c.forecastSourceId === rem));
  let calc = mine();
  const had = !!calc;
  if (calc && ledger.state().proposals.some((p) => p.calculationId === calc!.id)) return; // done
  const snap = { contractValue: fig.contract.cents, incurred: fig.incurred.cents, remaining: fig.remaining.cents, billed: fig.billed.cents };
  const r = compute(snap);
  if (!calc) {
    await say(ledger, engine.name, w.projectId, 'compute', `opening: progress ${r.progressBp} bp, cum revenue ${usd(r.cumRevenue)}, contract asset ${usd(r.contractAsset)}${r.margin.lossWarning ? ', loss warning' : ''}`, 'work_item', w.id);
    await ledger.recordCalculation({
      workItemId: w.id, forecastSourceId: rem,
      inputsJson: JSON.stringify({ contractValueCents: String(snap.contractValue), incurredCents: String(snap.incurred), remainingCents: String(snap.remaining), billedCents: String(snap.billed) }),
      progressBp: r.progressBp, cumRevenueCents: r.cumRevenue, contractAssetCents: r.contractAsset, marginCents: r.margin.amount, lossWarning: r.margin.lossWarning,
    });
    calc = await waitFor('opening calculation', mine, WAIT_MS);
  }
  const entryJson = engine.handlers.openingEntry(r.cumRevenue, snap.billed);
  if (entryJson === '[]') return had ? undefined : say(ledger, NAME, w.projectId, 'skip', 'nothing earned or billed yet; no opening entry', 'calculation', calc.id);
  // ponytail: template only; the model explainer's checks are built around a before/after forecast change, not an opening
  const ca = r.cumRevenue - snap.billed;
  const explanation = [
    r.margin.lossWarning ? `ESCALATION: expected margin ${usd(r.margin.amount)} on contract ${usd(snap.contractValue)}; loss contract, controller review required.` : '',
    `Opening position from onboarding intake: contract ${usd(snap.contractValue)}, cost incurred to date ${usd(snap.incurred)}, cost to finish ${usd(snap.remaining)}, billed to date ${usd(snap.billed)}.`,
    `Progress is cost incurred over estimated total cost (${usd(r.estTotal)}), ${r.progressBp / 100}%, so revenue recognised to date is ${usd(r.cumRevenue)}.`,
    `Billings of ${usd(snap.billed)} are receivable; the ${usd(ca < 0n ? -ca : ca)} difference is a contract ${ca < 0n ? 'liability' : 'asset'}. Expected margin is ${usd(r.margin.amount)}.`,
  ].filter(Boolean).join('\n');
  await say(ledger, 'explainer', w.projectId, 'explain', 'template explanation (opening position)', 'calculation', calc.id);
  await ledger.propose({ workItemId: w.id, calculationId: calc.id, entryJson, explanation, evidenceSourceIdsCsv: FIELDS.map((f) => fig[f].id).join(','), pendingConventionJson: '' });
  await waitFor('opening proposal', () => ledger.state().proposals.find((p) => p.calculationId === calc!.id), WAIT_MS);
  await say(ledger, NAME, w.projectId, 'propose', 'opening revenue recognition', 'calculation', calc.id);
  await say(ledger, NAME, w.projectId, 'handoff', 'intake complete; listening for site updates', 'work_item', w.id);
  log(`intake complete on work item ${w.id}: opening revenue ${usd(r.cumRevenue)} proposed`);
}

/** Each poll: advance every intake work item (no-op once its opening proposal exists). */
async function tick(deps: Deps): Promise<void> {
  const s = deps.ledger.state();
  for (const w of s.workItems.filter((x) => isIntakeWorkItem(s, x.id))) await step(deps, w);
}

export const intake = { name: NAME, seat: 'onboarding accountant', may: MAY, handlers: { tick, answer, step } } satisfies Agent<unknown>;
