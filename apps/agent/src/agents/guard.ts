import { parseAmountCents } from '../extract.js';
import { guardedLedger, log, say, type Agent } from '../bus.js';
import type { Deps, SourceRow } from '../loop.js';
import { baseline, usd } from './engine.js';

// Guard (seat: input control). Deterministic code, no model. Screens untrusted source text before any reader sees it.
// Flagged -> its own extraction row (reader 'guard') + a 'flag' event; summo then skips the source. Clean -> a 'pass' event only.
const NAME = 'guard', MAY = ['recordExtraction'] as const;
export const GUARD_READER = 'guard';

// ponytail: regex screen, not a classifier; paraphrased injections slip through (the readers and the no-post may-lists are the backstop)
const TEXT_RULES: [string, RegExp][] = [
  ['instruction', /\b(ignore|disregard|override|bypass)\b.*\b(previous|prior|above|instructions?|policy|rules?|controls?)\b/i],
  ['post_now', /\b(post|approve|book|record)\b[^.]{0,40}\b(immediately|now|without|directly|skip)\b/i],
  // "you are"/"assistant" only in prompt-talk shapes, so "you are going to see a bump" or "site assistant" stay clean
  ['system_talk', /\bsystem prompt\b|\bas an ai\b|\byou are (now )?(an? |the )?(ai|assistant|model|bot|system|controller)\b|\bassistant\s*:/i],
  ['mark_posted', /\b(mark|set)\b.*\b(posted|approved)\b/i],
  ['markup', /<\s*script|`[^`]+`|\{\s*"/i],
  ['link', /\bhttps?:\/\//i],
  ['role_claim', /\b(this is|i am|i'm) (the )?(controller|dana)\b|\b(approved|signed off) by (dana|the controller)\b|\bdana (approved|signed off)\b/i],
];
// $-figures (with k/m), bare "75k", "80 grand"; parseAmountCents decides the value (and refuses word multipliers)
const FIGURE = /(?:(?<=^|\s)-)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM](?![A-Za-z])|\s(?:million|thousand)\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:[kK](?![A-Za-z])|grand\b)/g;
const WORDS: Record<string, bigint> = { million: 1000000n, thousand: 1000n };
const cents = (fig: string) => {
  const w = fig.match(/^(.*?)\s(million|thousand)$/i);
  const c = parseAmountCents(w ? w[1] : fig);
  return c == null ? null : w ? c * WORDS[w[2].toLowerCase()] : c;
};

export type Verdict = { flagged: boolean; reasons: string[]; amounts: string[] };

/** Pure screen. contract/remaining are the project's current snapshot (cents). */
export function screen(text: string, kind: string, contract: bigint, remaining: bigint): Verdict {
  const reasons = TEXT_RULES.filter(([, re]) => re.test(text)).map(([n]) => n);
  const figs = [...text.matchAll(FIGURE)].map((m) => cents(m[0])).filter((c): c is bigint => c != null);
  const mags = figs.map((c) => (c < 0n ? -c : c));
  if (mags.some((c) => c > contract)) reasons.push('over_contract');
  if (remaining > 0n && mags.some((c) => c > 5n * remaining)) reasons.push('over_5x_remaining');
  // ponytail: only an explicitly negative figure counts; "saved more than is left" is a real-world slip summo already asks about
  if (figs.some((c) => c < 0n) && !/\b(less|under|saved|savings?|lower|cheaper)\b/i.test(text)) reasons.push('negative_remaining');
  if (kind === 'note' && new Set(mags.map(String)).size > 3) reasons.push('too_many_figures');
  return { flagged: reasons.length > 0, reasons, amounts: mags.map(usd) };
}

/** true = flagged (caller must not read it). Never throws: an error logs 'error' and lets the chain continue (fail-open for reading only). */
async function check(deps: Deps, src: SourceRow): Promise<boolean> {
  const ledger = guardedLedger(deps.ledger, NAME, MAY);
  try {
    const { snap } = baseline(ledger.state(), src.projectId);
    const v = screen(src.text, src.kind, snap.contractValue, snap.remaining);
    if (!v.flagged) { await say(ledger, NAME, src.projectId, 'pass', 'no injection, markup or absurd figures', 'source', src.id); return false; }
    await ledger.recordExtraction({ sourceId: src.id, reader: GUARD_READER, factsJson: JSON.stringify(v), ambiguityFlag: false, ambiguityText: `flagged input: ${v.reasons.join(', ')}` });
    await say(ledger, NAME, src.projectId, 'flag', v.reasons.join(', '), 'source', src.id);
    log(`source ${src.id}: guard flagged (${v.reasons.join(', ')})`);
    return true;
  } catch (e: any) {
    await say(ledger, NAME, src.projectId, 'error', String(e?.message ?? e), 'source', src.id);
    return false;
  }
}

export const guard = { name: NAME, seat: 'input control', may: MAY, handlers: { check, screen } } satisfies Agent<unknown>;
