import { describe, expect, it } from 'vitest';
import { parseSpokenCents } from '../src/extract.js';

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
  ])('%s', (text, cents) => expect(parseSpokenCents(text)).toBe(cents));
  it.each(['a lot', 'not sure yet', '', '2 to 3 million', '800k or 900k', 'ten percent of a million'])('no figure: %s', (t) => expect(parseSpokenCents(t)).toBeNull());
});
