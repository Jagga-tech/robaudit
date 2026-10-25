import { beforeAll, describe, expect, it } from 'vitest';
import { extract, parseAmountCents } from '../src/extract';
import { hasKey } from '../src/claude';
import { handleNewSource, isAdditiveWording, isReductionWording } from '../src/loop';
import { pollConfirmed } from '../src/bridge';
import type { Extraction } from '../src/schemas';
import { fake } from './fake-deps';

// Baseline S0: incurred $400,000, remaining $400,000 (fake-deps seed). Expected: remaining_update kind (or other), signed cents, flag.
type Want = { kind: 'remaining_update' | 'cost' | 'milestone' | 'none'; cents?: bigint | null; flag: boolean };
const PHRASES: [string, Want][] = [
  ['we need another $200,000 to finish', { kind: 'remaining_update', cents: 20000000n, flag: true }],
  ['conveyor rework is going to run another 80 grand', { kind: 'remaining_update', cents: 8000000n, flag: true }],
  ['add 75k to the forecast', { kind: 'remaining_update', cents: 7500000n, flag: true }],
  ["it'll take $120,000 more than we thought", { kind: 'remaining_update', cents: 12000000n, flag: true }],
  ['the new total remaining is $600,000', { kind: 'remaining_update', cents: 60000000n, flag: false }],
  ['the new number to finish is 550k', { kind: 'remaining_update', cents: 55000000n, flag: false }],
  ['we now expect $700,000 to complete', { kind: 'remaining_update', cents: 70000000n, flag: false }],
  ['cost to complete is now $650,000', { kind: 'remaining_update', cents: 65000000n, flag: false }],
  ['we found savings, finishing should cost 50k less', { kind: 'remaining_update', cents: -5000000n, flag: false }],
  ["we're $60,000 under on electrical", { kind: 'remaining_update', cents: -6000000n, flag: false }],
  ['remaining came down to $350,000', { kind: 'remaining_update', cents: 35000000n, flag: false }],
  ["we're $75,000 over budget on conveyors", { kind: 'remaining_update', cents: 7500000n, flag: true }],
  ['Crew on site, rain held us up Tuesday, morale is good.', { kind: 'none', flag: false }],
  ['commissioning complete, throughput test passed', { kind: 'milestone', flag: false }],
  ['we spent 20k on cranes and need another 100k to finish', { kind: 'remaining_update', cents: 10000000n, flag: true }],
  ['we need another two hundred thousand to finish', { kind: 'remaining_update', cents: null, flag: true }],
  ["we'll need an extra $45,000 for the sorter install", { kind: 'remaining_update', cents: 4500000n, flag: true }],
  ['bump the cost to finish by $30k', { kind: 'remaining_update', cents: 3000000n, flag: true }],
  ['we saved $25,000 on the remaining scope', { kind: 'remaining_update', cents: -2500000n, flag: false }],
  ['paid the $40,000 electrical invoice today', { kind: 'cost', flag: false }],
];

/** One line per mismatch, empty when the extraction matches. */
export function check(x: Extraction, w: Want): string[] {
  const bad: string[] = [];
  if (x.ambiguity.flag !== w.flag) bad.push(`flag ${x.ambiguity.flag}`);
  if (w.flag && (x.ambiguity.kind !== 'additional_vs_total' || x.ambiguity.options.join() !== 'additional,new_total')) bad.push(`ambiguity ${x.ambiguity.kind} ${x.ambiguity.options}`);
  if (w.kind === 'none') { if (x.facts.length) bad.push(`facts ${x.facts.map((f) => f.kind)}`); return bad; }
  if (w.kind !== 'remaining_update' && x.facts.some((f) => f.kind === 'remaining_update')) bad.push('unexpected remaining_update');
  const f = x.facts.find((f) => f.kind === w.kind);
  if (!f) return [...bad, `no ${w.kind} fact (${x.facts.map((f) => f.kind)})`];
  if (w.cents !== undefined) { const c = parseAmountCents(f.amountText); if (c !== w.cents) bad.push(`amount ${f.amountText} -> ${c}`); }
  return bad;
}

describe('phrasings: helpers (mock)', () => {
  it.each([
    ['-$50,000', -5000000n], ['-50k', -5000000n], ['minus $60,000', -6000000n], ['80 grand', 8000000n], ['$80 grand', 8000000n], ['100k', 10000000n],
  ])('parseAmountCents(%s) = %s', (t, want) => expect(parseAmountCents(t)).toBe(want));

  it('wording classifiers', () => {
    for (const [t] of PHRASES.filter(([, w]) => w.flag)) expect(isAdditiveWording(t), t).toBe(true);
    for (const t of ['the new total remaining is $600,000', 'the new number to finish is 550k', 'we now expect $700,000 to complete', 'cost to complete is now $650,000'])
      expect(isAdditiveWording(t), t).toBe(false);
    expect(isReductionWording('finishing should cost 50k less')).toBe('additional');
    expect(isReductionWording("we're $60,000 under on electrical")).toBe('additional');
    expect(isReductionWording('we saved $25,000 on the remaining scope')).toBe('additional');
    expect(isReductionWording('remaining came down to $350,000')).toBe('new_total');
    expect(isReductionWording('we need another $200,000 to finish')).toBe(null);
  });
});

const ru = (quote: string, amountText: string, flag: boolean): Extraction => ({
  facts: [{ kind: 'remaining_update', amountText, quote, charStart: 0, charEnd: quote.length }],
  ambiguity: flag ? { flag, kind: 'additional_vs_total', question: 'On top, or new total?', options: ['additional', 'new_total'] } : { flag, kind: 'none', question: '', options: [] },
});
const remainingOf = (f: ReturnType<typeof fake>) => JSON.parse(f.named('recordCalculation')[0].inputsJson).remainingCents;

describe('phrasings: loop paths (mock deps)', () => {
  it('"another $200,000" -> asks, no proposal', async () => {
    const f = fake(ru('another $200,000', '$200,000', true));
    await handleNewSource(f.add('note', 'we need another $200,000 to finish'), f.deps);
    expect(f.named('ask')).toHaveLength(1);
    expect(f.named('propose')).toHaveLength(0);
  });

  it('"50k less" (even if flagged) -> negative additional, remaining 400k -> 350k, no question', async () => {
    const f = fake(ru('finishing should cost 50k less', '-50k', true));
    await handleNewSource(f.add('note', 'we found savings, finishing should cost 50k less'), f.deps);
    expect(f.named('ask')).toHaveLength(0);
    expect(remainingOf(f)).toBe('35000000');
    expect(f.named('propose')).toHaveLength(1);
  });

  it('"$60,000 under" with a bare-amount quote -> sign from amountText, remaining 340k', async () => {
    const f = fake(ru('$60,000', '-$60,000', false));
    await handleNewSource(f.add('note', "we're $60,000 under on electrical"), f.deps);
    expect(remainingOf(f)).toBe('34000000');
  });

  it('"came down to $350,000" -> new_total 350k', async () => {
    const f = fake(ru('remaining came down to $350,000', '$350,000', false));
    await handleNewSource(f.add('note', 'remaining came down to $350,000'), f.deps);
    expect(f.named('ask')).toHaveLength(0);
    expect(remainingOf(f)).toBe('35000000');
  });

  it('a cut larger than the remaining -> asked, not booked negative; "additional" answer is refused', async () => {
    const f = fake(ru('$500,000 less', '-$500,000', false), { confirmed: { answer: 'additional', speaker: 'Matt' } });
    await handleNewSource(f.add('note', 'finishing will cost $500,000 less'), f.deps);
    expect(f.named('ask')[0].question).toMatch(/only \$400,000 remains/);
    await pollConfirmed(f.deps, new Set());
    expect(f.named('recordCalculation')).toHaveLength(0);
  });

  it('"over budget" unflagged -> additive guard asks', async () => {
    const f = fake(ru('$75,000 over budget on conveyors', '$75,000', false));
    await handleNewSource(f.add('note', "we're $75,000 over budget on conveyors"), f.deps);
    expect(f.named('ask')).toHaveLength(1);
  });

  it('spelled-out amount -> asks with "amount not stated"; on confirm no proposal, no crash', async () => {
    const f = fake(ru('another two hundred thousand', 'two hundred thousand', true), { confirmed: { answer: 'additional', speaker: 'Matt' } });
    await handleNewSource(f.add('note', 'we need another two hundred thousand to finish'), f.deps);
    expect(f.named('ask')[0].question).toMatch(/Amount not stated/);
    expect(f.named('recordExtraction')[0].ambiguityText).toMatch(/Amount not stated/);
    await pollConfirmed(f.deps, new Set());
    expect(f.named('resolveClarification')).toHaveLength(1);
    expect(f.named('propose')).toHaveLength(0);
  });
});

describe.skipIf(!hasKey)('phrasings: real Claude extraction', () => {
  const got = new Map<string, Extraction>();
  beforeAll(async () => {
    await Promise.all(PHRASES.map(async ([t], i) => got.set(t, await extract(t, 100 + i))));
  }, 180_000);
  it.each(PHRASES)('%s', (t, w) => expect(check(got.get(t)!, w), JSON.stringify(got.get(t))).toEqual([]));
});
