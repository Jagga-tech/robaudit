import { z } from 'zod';
import { geminiJson } from '../gemini.js';
import { log, say, type Agent } from '../bus.js';
import type { Deps } from '../loop.js';

// The reviewer agent (Gemini): a second model checks the explanation against the calculation before Dana sees it.
// It never changes numbers or text; a flag only adds a trailing line. Writes nothing but its log.
const NAME = 'reviewer', MAY = [] as const;
const REVIEW_TIMEOUT_MS = 5_000;

export const Review = z.object({ consistent: z.boolean(), note: z.string() });
export type Review = z.infer<typeof Review>;
/** Cents and basis points as decimal strings; entry lines as posted JSON. */
export type ReviewInput = {
  incurredCents: string; remainingBeforeCents: string; remainingAfterCents: string; estTotalBeforeCents: string; estTotalAfterCents: string;
  progressBpBefore: string; progressBpAfter: string; cumRevenueBeforeCents: string; cumRevenueAfterCents: string; adjustmentCents: string;
  entryLines: { account: string; debit: string; credit: string }[]; conventionCited: string; explanation: string;
};

const SYSTEM = `You review a revenue-recognition proposal before a controller approves it. All money is integer cents; *Bp is basis points.
Check: every dollar figure in the explanation matches the calculation numbers (whole dollars = cents/100); the entry lines balance (total debit = total credit) and their size equals |adjustmentCents|; if conventionCited is non-empty, the explanation is consistent with it.
Return consistent=true only if all checks pass. note: one sentence, at most 140 characters, plain text, e.g. "Figures match the calculation; entry balanced; convention v3 cited." or what is wrong.`;

/** Real reviewer: Gemini with JSON-schema output (throws without GEMINI_API_KEY = reviewer off). */
export const geminiReview = (input: ReviewInput): Promise<Review> => geminiJson(Review, SYSTEM, JSON.stringify(input, null, 2));

/** Verdict within 5 s, or null (off / error / timeout) so the proposal is never delayed further. */
async function check(deps: Deps, input: ReviewInput): Promise<{ verdict: Review | null; why: string }> {
  if (!deps.review) return { verdict: null, why: 'reviewer off' };
  let timer: NodeJS.Timeout | undefined;
  try {
    const r = await Promise.race([deps.review(input), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('review timeout')), REVIEW_TIMEOUT_MS); })]);
    return { verdict: { consistent: r.consistent, note: r.note.replace(/\s+/g, ' ').trim().slice(0, 140) }, why: '' };
  } catch (e: any) {
    const why = e?.message === 'no GEMINI_API_KEY' ? 'reviewer off (no GEMINI_API_KEY)' : `reviewer unavailable (${e?.message ?? e})`;
    log(why);
    return { verdict: null, why };
  } finally { clearTimeout(timer); }
}

const report = (deps: Deps, projectId: bigint, r: { verdict: Review | null; why: string }, refTable: string, refId: bigint) =>
  say(deps.ledger, NAME, projectId, r.verdict ? 'review' : 'skip', r.verdict ? `${r.verdict.consistent ? 'consistent' : 'flag'}: ${r.verdict.note}` : r.why, refTable, refId);

export const reviewer = { name: NAME, seat: 'reviewer', may: MAY, handlers: { check, report } } satisfies Agent<unknown>;
