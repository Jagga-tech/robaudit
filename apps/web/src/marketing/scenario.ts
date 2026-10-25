// The landing page's figures, derived the same way the offline demo derives them:
// seed ledger (demo/seed.json) → the manager's message → @keel/engine. No marketing-only arithmetic.
import { adjustment, applyUpdate, buildEntry, compute, type Convention } from '@keel/engine';
import seed from '../../../../demo/seed.json';
import { parseAmountCents } from '../data/demoBackend';

export const BRAND = 'RoboAudit';
export const AGENT = 'Summo';

export const MESSAGE = 'We need another $200,000 to finish.';
export const PHRASE = 'another $200,000';
export const COMPANY = seed.project.company;
export const PROJECT = seed.project.name;

function sourceCents(kind: string, key: 'incurredCents' | 'remainingCents' | 'billedCents'): bigint {
  const v = (seed.sources.find((s) => s.kind === kind) as Record<string, unknown> | undefined)?.[key];
  if (typeof v !== 'number') throw new Error(`demo/seed.json: no ${key} on the ${kind} source`);
  return BigInt(v);
}

export const BEFORE = {
  contractValue: BigInt(seed.project.contractValueCents),
  incurred: sourceCents('cost_export', 'incurredCents'),
  remaining: sourceCents('forecast', 'remainingCents'),
  billed: sourceCents('invoice', 'billedCents'),
};
export const UPDATE = parseAmountCents(MESSAGE)!;
export const PRIOR = compute(BEFORE);

export interface Reading {
  convention: Convention;
  remaining: bigint;
  estTotal: bigint;
  progressBp: number;
  cumRevenue: bigint;
  margin: bigint;
  adjustment: bigint;
  entry: ReturnType<typeof buildEntry>;
}

function read(convention: Convention): Reading {
  const next = { ...BEFORE, remaining: applyUpdate(BEFORE.remaining, UPDATE, convention) };
  const r = compute(next);
  const adj = adjustment(PRIOR.cumRevenue, r.cumRevenue);
  return { convention, remaining: next.remaining, estTotal: r.estTotal, progressBp: r.progressBp, cumRevenue: r.cumRevenue, margin: r.margin.amount, adjustment: adj, entry: buildEntry(adj) };
}

export const READINGS: Record<Convention, Reading> = { additional: read('additional'), new_total: read('new_total') };
export const SWING = READINGS.new_total.adjustment - READINGS.additional.adjustment;
