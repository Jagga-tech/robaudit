import { resumeClarification, type Deps } from './loop.js';

/** For each open clarification_ref, ask Convex whether it is confirmed; resolve each convexId once. */
export async function pollConfirmed(deps: Deps, handled: Set<string>): Promise<void> {
  const open = deps.ledger.state().clarificationRefs.filter((c) => c.status === 'open' && !handled.has(c.convexId));
  for (const workItemId of new Set(open.map((c) => c.workItemId))) {
    const rows = await deps.convex.byWorkItem(String(workItemId));
    for (const ref of open.filter((c) => c.workItemId === workItemId)) {
      const row = rows.find((r) => r._id === ref.convexId && r.status === 'confirmed');
      if (!row) continue;
      handled.add(ref.convexId);
      await resumeClarification(ref, row, deps);
    }
  }
}
