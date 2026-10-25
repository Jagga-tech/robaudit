import { applyUpdate, adjustment, buildEntry, buildInvoiceEntry, buildOpeningEntry, compute, type Convention, type EntryLine } from '@keel/engine';
import { say, type Agent } from '../bus.js';
import type { Deps, LedgerState } from '../loop.js';

// The engine agent: deterministic math over @keel/engine, no model, writes nothing.
const NAME = 'engine', MAY = [] as const;

export const usd = (c: bigint) => `${c < 0n ? '-' : ''}$${(c < 0n ? -c : c) / 100n}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const abs = (c: bigint) => (c < 0n ? -c : c);
export const maxBy = <T extends { id: bigint }>(rows: T[]) => rows.reduce<T | undefined>((m, r) => (!m || r.id > m.id ? r : m), undefined);
const entryJson = (lines: EntryLine[]) => JSON.stringify(lines.map((l) => ({ account: l.account, debit: String(l.debit), credit: String(l.credit) })));
export type Snapshot = { contractValue: bigint; incurred: bigint; remaining: bigint; billed: bigint };

// Baseline = newest calculation with an approved/posted proposal (its inputsJson carries the snapshot), else the oldest (seed) one.
export function baseline(s: LedgerState, projectId: bigint): { workItemId: bigint; snap: Snapshot } {
  const wis = new Set(s.workItems.filter((w) => w.projectId === projectId).map((w) => w.id));
  const calcs = s.calculations.filter((x) => wis.has(x.workItemId));
  const ok = new Set(s.proposals.filter((p) => p.status === 'approved' || p.status === 'posted').map((p) => p.calculationId));
  const c = maxBy(calcs.filter((x) => ok.has(x.id))) ?? calcs.reduce<(typeof calcs)[number] | undefined>((m, r) => (!m || r.id < m.id ? r : m), undefined);
  if (!c) throw new Error(`no baseline calculation for project ${projectId}`);
  const i = JSON.parse(c.inputsJson) as Record<string, string>;
  return {
    workItemId: c.workItemId,
    snap: { contractValue: BigInt(i.contractValueCents), incurred: BigInt(i.incurredCents), remaining: BigInt(i.remainingCents), billed: BigInt(i.billedCents) },
  };
}

/** Apply a remaining-forecast update to the snapshot and compute before/after and the revenue adjustment. */
async function forecast(deps: Deps, projectId: bigint, sourceId: bigint, snap: Snapshot, amount: bigint, convention: Convention) {
  const next = { ...snap, remaining: applyUpdate(snap.remaining, amount, convention) };
  if (next.remaining < 0n) return { next };
  const before = compute(snap), after = compute(next);
  const adj = adjustment(before.cumRevenue, after.cumRevenue);
  await say(deps.ledger, NAME, projectId, 'compute', `remaining ${usd(snap.remaining)} -> ${usd(next.remaining)} (${convention}); progress ${after.progressBp} bp, cum revenue ${usd(after.cumRevenue)}, adjustment ${usd(adj)}${after.margin.lossWarning ? ', loss warning' : ''}`, 'source', sourceId);
  return { next, calc: { before, after, adj } };
}

export const engine = {
  name: NAME, seat: 'calculator', may: MAY,
  handlers: { forecast, revenueEntry: (adj: bigint) => entryJson(buildEntry(adj)), invoiceEntry: (amount: bigint) => entryJson(buildInvoiceEntry(amount)),
    openingEntry: (cumRevenue: bigint, billed: bigint) => entryJson(buildOpeningEntry(cumRevenue, billed)) },
} satisfies Agent<unknown>;
