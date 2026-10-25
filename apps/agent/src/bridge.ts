import { attempt, log, normalizeAnswer, proposeFromClarification, resumeClarification, type Deps } from './loop.js';

/** For each open clarification_ref, ask Convex whether it is confirmed; resolve each convexId once (retried on failure, see attempt()).
 *  Also finishes confirmed refs whose source has no calculation yet (crash after resolve_clarification). */
export async function pollConfirmed(deps: Deps, handled: Set<string>, attempts = new Map<string, number>()): Promise<void> {
  const s = deps.ledger.state();
  for (const ref of s.clarificationRefs.filter((c) => c.status === 'confirmed' && !handled.has(c.convexId) && !s.calculations.some((x) => x.forecastSourceId === c.sourceId))) {
    const answer = normalizeAnswer(ref.answer);
    if (!answer) { handled.add(ref.convexId); continue; }
    await attempt(ref.convexId, handled, attempts, () => proposeFromClarification(ref, answer, deps));
  }
  const open = s.clarificationRefs.filter((c) => c.status === 'open' && !handled.has(c.convexId));
  for (const workItemId of new Set(open.map((c) => c.workItemId))) {
    const rows = await deps.convex.byWorkItem(String(workItemId));
    for (const ref of open.filter((c) => c.workItemId === workItemId)) {
      const row = rows.find((r) => r._id === ref.convexId && r.status === 'confirmed');
      if (!row) continue;
      if (!normalizeAnswer(row.answer ?? '')) {
        // not marked handled: once re-confirmed by text it is picked up again
        log(`clarification ${ref.id}: answer unclear, re-asking as text ("${row.answer}")`);
        await deps.convex.fallbackText(ref.convexId);
        continue;
      }
      await attempt(ref.convexId, handled, attempts, () => resumeClarification(ref, row, deps));
    }
  }
}
