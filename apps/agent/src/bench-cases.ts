// Data only: the 20 field-note phrasings and their expected readings, shared by test/phrasings.test.ts and scripts/bench.ts.
// Baseline S0: incurred $400,000, remaining $400,000 (fake-deps seed). Expected: remaining_update kind (or other), signed cents, flag.
export type Want = { kind: 'remaining_update' | 'cost' | 'milestone' | 'none'; cents?: bigint | null; flag: boolean };
export const PHRASES: [string, Want][] = [
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
