import type { Disagreement } from '../explain.js';
import { say, type Agent } from '../bus.js';
import type { Deps, SourceRow } from '../loop.js';
import { abs, baseline, usd } from './engine.js';

// The reconciler agent: sheet vs cost export on incurred. The cost export is the system of record; incurred is never taken from the sheet. Writes nothing.
const NAME = 'reconciler', MAY = [] as const;

/** Sheet vs cost export: any incurred difference above this (cents) is a source disagreement. 0 = every difference; raise it to add a materiality threshold. */
export const DISAGREE_THRESHOLD_CENTS = 0n;
const TRUST_REASON = 'Cost system export is the system of record for incurred cost; the forecast sheet is a human copy.';

/** The disagreement (if any) plus the extraction's ambiguityText (empty when the sources agree). */
async function reconcile(deps: Deps, src: SourceRow, incurredCents: bigint | undefined): Promise<{ disagreement?: Disagreement; text: string }> {
  const ledgerIncurred = baseline(deps.ledger.state(), src.projectId).snap.incurred;
  if (incurredCents == null || abs(incurredCents - ledgerIncurred) <= DISAGREE_THRESHOLD_CENTS) {
    await say(deps.ledger, NAME, src.projectId, 'reconcile', incurredCents == null ? 'no incurred figure on the sheet; cost export stands' : `sheet and cost export agree on incurred ${usd(ledgerIncurred)}`, 'source', src.id);
    return { text: '' };
  }
  // Not an ambiguity (no question): a resolved conflict, so the flag stays false and the text says which source we trusted.
  const text = `sources disagree: incurred ${usd(incurredCents)} on the sheet vs ${usd(ledgerIncurred)} in the cost export; trusting the cost export`;
  await say(deps.ledger, NAME, src.projectId, 'disagree', text, 'source', src.id);
  return { disagreement: { field: 'incurred', document: String(incurredCents), ledger: String(ledgerIncurred), trusted: 'cost_export', reason: TRUST_REASON }, text };
}

export const reconciler = { name: NAME, seat: 'reconciliation', may: MAY, handlers: { reconcile } } satisfies Agent<unknown>;
