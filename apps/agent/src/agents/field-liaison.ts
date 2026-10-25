import type { Convention } from '@keel/engine';
import { attempt, guardedLedger, log, say, type Agent } from '../bus.js';
import type { AnswerType, ClarificationRefRow, ConvexClarification, Deps } from '../loop.js';
import { summo } from './summo.js';
import { intake, isIntakeWorkItem } from './intake.js';

// The field liaison agent: asks the site lead through Convex (voice/text) and brings the answer back. May only write clarifications.
const NAME = 'field-liaison', MAY = ['openClarification', 'resolveClarification'] as const;
const ledgerOf = (deps: Deps) => guardedLedger(deps.ledger, NAME, MAY);
const projectOf = (deps: Deps, workItemId: bigint) => deps.ledger.state().workItems.find((w) => w.id === workItemId)?.projectId ?? 0n;

/** Both or neither pattern ("additional, not a new total") = unclear -> null, the caller re-asks as text. */
export function normalizeAnswer(a: string): Convention | null {
  const total = /new[\s_-]*total|\btotal\b/i.test(a), add = /addition|on top|\bmore\b|\bextra\b/i.test(a);
  if (total && add) return /\bnot\b[^.]{0,20}new[\s_-]*total/i.test(a) ? 'additional' : /new[\s_-]*total/i.test(a) ? 'new_total' : null; // "extra on top of the total" still asks; an explicit "new total" decides
  return total === add ? null : total ? 'new_total' : 'additional';
}

async function ask(deps: Deps, projectId: bigint, workItemId: bigint, question: string, options: string[], note: string, answerType?: AnswerType) {
  const ledger = ledgerOf(deps);
  const convexId = await deps.convex.ask({ workItemId: String(workItemId), question, options, ...(answerType && { answerType }) });
  await ledger.openClarification({ workItemId, convexId, question });
  await say(ledger, NAME, projectId, 'ask', question, 'work_item', workItemId);
  log(`clarification opened on work item ${workItemId} (convex ${convexId}): ${question}${note}`);
}

/** Resolve the ledger ref with this answer and log it (no follow-up). */
async function close(deps: Deps, ref: ClarificationRefRow, c: ConvexClarification, answer: string): Promise<void> {
  const ledger = ledgerOf(deps);
  await ledger.resolveClarification({ clarificationId: ref.id, answer, speaker: c.speaker ?? '', audioStorageId: c.answerAudioId ?? '' });
  await say(ledger, NAME, projectOf(deps, ref.workItemId), 'answer', `${c.speaker || 'site lead'}: ${answer}`, 'clarification_ref', ref.id);
  log(`clarification ${ref.id} resolved: ${answer} (${c.speaker})`);
}

/** Called once Convex reports the clarification confirmed. */
export async function resumeClarification(ref: ClarificationRefRow, c: ConvexClarification, deps: Deps): Promise<void> {
  const ledger = ledgerOf(deps), projectId = projectOf(deps, ref.workItemId);
  const answer = normalizeAnswer(c.answer ?? '');
  if (!answer) {
    await say(ledger, NAME, projectId, 'skip', `answer "${c.answer}" is neither additional nor new_total; left open`, 'clarification_ref', ref.id);
    return log(`clarification ${ref.id}: answer "${c.answer}" is neither additional nor new_total; left open`);
  }
  await close(deps, ref, c, answer);
  return summo.handlers.proposeFromClarification(ref, answer, deps);
}

/** For each open clarification_ref, ask Convex whether it is confirmed; resolve each convexId once (retried on failure, see attempt()).
 *  Also finishes confirmed refs whose source has no calculation yet (crash after resolve_clarification). */
export async function pollConfirmed(deps: Deps, handled: Set<string>, attempts = new Map<string, number>()): Promise<void> {
  const s = deps.ledger.state();
  for (const ref of s.clarificationRefs.filter((c) => c.status === 'confirmed' && !handled.has(c.convexId) && !isIntakeWorkItem(s, c.workItemId) && !s.calculations.some((x) => x.forecastSourceId === c.sourceId))) {
    const answer = normalizeAnswer(ref.answer);
    if (!answer) { handled.add(ref.convexId); continue; }
    await attempt(ref.convexId, handled, attempts, async () => {
      await say(deps.ledger, NAME, projectOf(deps, ref.workItemId), 'answer', `confirmed earlier: ${answer}; resuming`, 'clarification_ref', ref.id);
      await summo.handlers.proposeFromClarification(ref, answer, deps);
    });
  }
  const open = s.clarificationRefs.filter((c) => c.status === 'open' && !handled.has(c.convexId));
  for (const workItemId of new Set(open.map((c) => c.workItemId))) {
    const rows = await deps.convex.byWorkItem(String(workItemId));
    for (const ref of open.filter((c) => c.workItemId === workItemId)) {
      const row = rows.find((r) => r._id === ref.convexId && r.status === 'confirmed');
      if (!row) continue;
      if (row.answerType === 'amount') { await attempt(ref.convexId, handled, attempts, () => intake.handlers.answer(ref, row, deps)); continue; } // never normalizeAnswer'd
      if (!normalizeAnswer(row.answer ?? '')) {
        // not marked handled: once re-confirmed by text it is picked up again
        log(`clarification ${ref.id}: answer unclear, re-asking as text ("${row.answer}")`);
        await deps.convex.fallbackText(ref.convexId);
        await say(deps.ledger, NAME, projectOf(deps, workItemId), 'ask', `answer "${row.answer}" unclear; re-asking as text`, 'clarification_ref', ref.id);
        continue;
      }
      await attempt(ref.convexId, handled, attempts, () => resumeClarification(ref, row, deps));
    }
  }
}

export const fieldLiaison = { name: NAME, seat: 'field liaison', may: MAY, handlers: { ask, close, poll: pollConfirmed, resume: resumeClarification } } satisfies Agent<unknown>;
