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
  ])('%s', (text, cents) => expect(parseSpokenCents(text)).toBe(cents));
  it.each(['a lot', 'not sure yet', ''])('no figure: %s', (t) => expect(parseSpokenCents(t)).toBeNull());
});
