import { parseAmountCents } from '../extract.js';
import type { Explanation } from '../schemas.js';
import type { Disagreement, ExplainInput } from '../explain.js';
import { log, say, type Agent } from '../bus.js';
import type { Deps } from '../loop.js';
import { usd } from './engine.js';

// The explainer agent: Claude writes the narrative, every $-figure is checked against the inputs, template on any doubt. Writes nothing.
const NAME = 'explainer', MAY = [] as const;
const EXPLAIN_TIMEOUT_MS = 20_000;

export const disagreementSentence = (d: Disagreement) =>
  `The sheet shows ${usd(BigInt(d.document))} incurred; the cost export, our system of record, shows ${usd(BigInt(d.ledger))}, so we booked on ${usd(BigInt(d.ledger))}.`;

const pct = (bp: bigint | number) => `${Number(bp) / 100}%`;
export function templateExplanation(i: ExplainInput): Explanation {
  const { before: b, after: a } = i;
  const dir = i.remainingAfterCents > i.remainingBeforeCents ? 'rose' : i.remainingAfterCents < i.remainingBeforeCents ? 'fell' : 'stayed';
  return {
    summary: `The estimate to finish ${dir} from ${usd(i.remainingBeforeCents)} to ${usd(i.remainingAfterCents)} (read as ${i.convention}), so estimated total cost is now ${usd(a.estTotal)} (was ${usd(b.estTotal)}). Cumulative revenue recognised moves from ${usd(b.cumRevenue)} to ${usd(a.cumRevenue)}, a journal entry of ${usd(i.adjustmentCents)}. Expected margin is now ${usd(a.margin.amount)} (was ${usd(b.margin.amount)}).`,
    whyRevenueMoved: `Progress is cost incurred (${usd(i.incurredCents)}) over estimated total cost, so the new estimate moves progress from ${pct(b.progressBp)} to ${pct(a.progressBp)}, and revenue on the ${usd(i.contractValueCents)} contract follows progress. Evidence: ${i.evidence.map((e) => `"${e}"`).join('; ')}.${i.disagreement ? ` ${disagreementSentence(i.disagreement)}` : ''}`,
    whatDidNotChange: `Cash and the customer invoice are unchanged; the contract asset moves from ${usd(b.contractAsset)} to ${usd(a.contractAsset)}. This is an estimate update, not an error or a restatement.`,
  };
}

const FIGURE = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?(?:\s*(?:million|billion|thousand|mm|bn)\b)?/gi;
/** First $-figure in the explanation that is not one of the input-derived values (exact or whole-dollar), else undefined. */
export function unverifiedFigure(x: Explanation, i: ExplainInput, updateAmount: bigint): string | undefined {
  const vals = [i.contractValueCents, i.incurredCents, i.remainingBeforeCents, i.remainingAfterCents, i.before.estTotal, i.after.estTotal,
    i.before.cumRevenue, i.after.cumRevenue, i.before.contractAsset, i.after.contractAsset, i.adjustmentCents, i.before.margin.amount, i.after.margin.amount, updateAmount, ...(i.disagreement ? [BigInt(i.disagreement.document)] : [])]
    .map((v) => (v < 0n ? -v : v));
  const ok = new Set(vals.flatMap((v) => [v, (v / 100n) * 100n, ((v + 50n) / 100n) * 100n]));
  return [x.summary, x.whyRevenueMoved, x.whatDidNotChange].join('\n').match(FIGURE)?.find((m) => { const c = parseAmountCents(m); return c == null || !ok.has(c); });
}

async function checkedExplain(deps: Deps, projectId: bigint, sourceId: bigint, input: ExplainInput, updateAmount: bigint): Promise<Explanation> {
  let timer: NodeJS.Timeout | undefined, why = "";
  try {
    const x = await Promise.race([deps.explain(input), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('explain timeout')), EXPLAIN_TIMEOUT_MS); })]);
    const bad = unverifiedFigure(x, input, updateAmount);
    if (!bad) { await say(deps.ledger, NAME, projectId, 'explain', 'model explanation; every figure traced to the inputs', 'source', sourceId); return x; }
    log(why = `explanation replaced: unverified number ${bad}`);
  } catch (e: any) {
    log(why = `explain failed (${e?.message ?? e}); using template explanation`);
  } finally { clearTimeout(timer); }
  await say(deps.ledger, NAME, projectId, 'explain', `template explanation (${why})`, 'source', sourceId);
  return templateExplanation(input);
}

export const explainer = { name: NAME, seat: 'narrator', may: MAY, handlers: { explain: checkedExplain } } satisfies Agent<unknown>;
