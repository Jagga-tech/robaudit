import { describe, expect, it } from 'vitest';
import { parseSpokenCents, parseSpokenTotal } from '../src/extract.js';

describe('parseSpokenCents (phone answers)', () => {
  it.each([
    [" It's gonna be 5 million in total cost.", 500000000n],
    [' I think it\'s gonna be 5 million in dollars for 7 months.', 500000000n],
    [' I think it\'s gonna be 50,000 dollars.', 5000000n],
    [' 25000 dollars uh on rent the robot.', 2500000n],
    ['one million', 100000000n],
    ['a million dollars', 100000000n],
    ['four hundred thousand', 40000000n],
    ['two hundred and fifty thousand', 25000000n],
    ['400k', 40000000n],
    ['$1,000,000', 100000000n],
    ['1.5 million', 150000000n],
    ['three hundred', 30000n],
    ['half a million', 50000000n],
    ['it will take half a million dollars more', 50000000n],
    ['a quarter of a million', 25000000n],
    ['two and a half million', 250000000n],
    ['one and a half million', 150000000n],
    ['one point five million', 150000000n],
    ['two point two five million', 225000000n],
    ['400 000', 40000000n],
    ['1 200 000 dollars', 120000000n],
    ['a million and a half', 150000000n],
    ['1/2 million', 50000000n],
    ['we haven\'t billed anything yet', 0n],
    ['nothing yet', 0n],
    ['none so far', 0n],
    ['one million two hundred thousand', 120000000n],
    ['um, maybe 300 grand', 30000000n],
    ['about 400,000', 40000000n],
    ['we need another two hundred thousand to finish', 20000000n],
    ["we'll need another 2 million to finish", 200000000n],
    ['half a million to go', 50000000n],
  ])('%s', (text, cents) => expect(parseSpokenCents(text)).toBe(cents));
  it.each(['a lot', 'not sure yet', '', '2 to 3 million', '800k or 900k', 'ten percent of a million', 'between 700 and 800 thousand'])('no figure: %s', (t) => expect(parseSpokenCents(t)).toBeNull());
});

describe('parseSpokenTotal (rates)', () => {
  it.each([
    ['half a million a month for seven months', 350000000n, '$500,000 a month for 7 months'],
    ['we spent 50k per month over 8 months', 40000000n, '$50,000 a month for 8 months'],
    ['about 2 million a year for two years', 400000000n, '$2,000,000 a year for 2 years'],
    ['four hundred thousand', 40000000n, ''],
    ['1,000,000', 100000000n, ''],
  ])('%s', (text, cents, note) => expect(parseSpokenTotal(text)).toEqual({ cents, note }));
  it.each([
    ['half a million a month', 'That sounds like a monthly figure. What is the total?'],
    ['roughly 50k monthly', 'That sounds like a monthly figure. What is the total?'],
    ['10k a week', 'That sounds like a weekly figure. What is the total?'],
  ])('rate without duration re-asks: %s', (text, note) => expect(parseSpokenTotal(text)).toEqual({ cents: null, note }));
});

import { normalizeAnswer } from '../src/agents/field-liaison.js';
describe('normalizeAnswer with mixed words', () => {
  it.each([
    ["it's extra", 'additional'], ['the new total is 600', 'new_total'], ['yes', null], ['sure', null],
    ['extra on top of the total', null], // both kinds, no explicit phrase: ask
    ['not additional, it is the new total', 'new_total'],
    ['additional, not a new total', 'additional'],
    ['extra, so the new total is 600', 'new_total'],
  ])('%s', (a, want) => expect(normalizeAnswer(a)).toBe(want));
});
