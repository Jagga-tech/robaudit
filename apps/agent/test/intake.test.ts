import { describe, expect, it } from 'vitest';
import { pollConfirmed } from '../src/agents/field-liaison';
import { intake, INTAKE_TITLE, REASK } from '../src/agents/intake';
import type { ConvexClarification } from '../src/loop';
import { ambiguous, fake } from './fake-deps';

const P2 = 2n, WI = 50n;
// A fresh project (createProject's rows) plus a Convex fake that records questions and lets the test confirm the newest one.
function setup() {
  const f = fake(ambiguous('$1'));
  f.s.projects.push({ id: P2, contractValueCents: 0n });
  f.s.workItems.push({ id: WI, projectId: P2, title: INTAKE_TITLE, status: 'intake' });
  const rows: (ConvexClarification & { workItemId: string; question: string; options: string[] })[] = [];
  f.deps.convex = {
    ask: async (a) => { f.calls.push(['ask', a]); const _id = `q${rows.length + 1}`; rows.push({ _id, status: 'ringing', ...a }); return _id; },
    byWorkItem: async (w) => rows.filter((r) => r.workItemId === w),
    fallbackText: async (id) => { f.calls.push(['fallbackText', id]); },
  };
  let handled = new Set<string>();
  const cycle = async () => { await pollConfirmed(f.deps, handled); await intake.handlers.tick(f.deps); }; // what the bus does each poll
  const say = async (answer: string, speaker = 'Matt') => { Object.assign(rows.at(-1)!, { status: 'confirmed', answer, speaker }); await cycle(); };
  return { f, rows, cycle, say, restart: () => { handled = new Set(); } };
}
const questions = (f: ReturnType<typeof fake>) => f.named('ask').map((a) => a.question);

describe('intake agent', () => {
  it('asks the contract value first as an amount question, one at a time', async () => {
    const { f, cycle } = setup();
    await cycle();
    await cycle();
    expect(f.named('ask')).toEqual([{ workItemId: '50', question: 'Welcome. What is this contract worth in total?', options: [], answerType: 'amount' }]);
    expect(f.named('openClarification')).toHaveLength(1);
  });

  it('"not sure yet, a lot" is re-asked; "$1,000,000" records the contract and asks the next figure', async () => {
    const { f, cycle, say } = setup();
    await cycle();
    await say('not sure yet, a lot');
    expect(f.named('recordIntake')).toHaveLength(0);
    expect(f.named('fallbackText')).toHaveLength(0); // amount answers never go through normalizeAnswer's re-ask
    expect(questions(f).at(-1)).toBe(REASK);
    await say('$1,000,000');
    expect(f.named('recordIntake')).toEqual([{ projectId: P2, field: 'contract', cents: 100000000n, speaker: 'Matt', text: '$1,000,000' }]);
    expect(f.events.find((e) => e.agent === 'intake')).toMatchObject({ kind: 'intake', summary: 'contract = $1,000,000 from Matt' });
    expect(questions(f).at(-1)).toBe('What have you spent on it so far?');
  });

  it('four phone answers -> opening calculation 5000 bp and the opening proposal', async () => {
    const { f, cycle, say } = setup();
    await cycle();
    for (const cents of ['100000000', '40000000', '40000000', '30000000']) await say(cents);
    const intakeIds = f.s.sources.filter((s) => s.kind === 'intake').map((s) => s.id);
    const remainingId = f.s.sources.find((s) => s.text.startsWith('remaining='))!.id;
    const [calc] = f.named('recordCalculation');
    expect(calc).toMatchObject({ workItemId: WI, forecastSourceId: remainingId, progressBp: 5000, cumRevenueCents: 50000000n, contractAssetCents: 20000000n });
    expect(JSON.parse(calc.inputsJson)).toEqual({ contractValueCents: '100000000', incurredCents: '40000000', remainingCents: '40000000', billedCents: '30000000' });
    const [p] = f.named('propose');
    expect(JSON.parse(p.entryJson)).toEqual([
      { account: 'AccountsReceivable', debit: '30000000', credit: '0' },
      { account: 'ContractAsset', debit: '20000000', credit: '0' },
      { account: 'Revenue', debit: '0', credit: '50000000' },
    ]);
    expect(p.evidenceSourceIdsCsv).toBe(intakeIds.join(','));
    expect(p.pendingConventionJson).toBe('');
    const chain = f.events.map((e) => `${e.agent} ${e.kind}`);
    expect(chain.slice(0, 5)).toEqual(['field-liaison ask', 'guard pass', 'field-liaison answer', 'intake intake', 'field-liaison ask']);
    expect(chain.slice(-7)).toEqual(['guard pass', 'field-liaison answer', 'intake intake', 'engine compute', 'explainer explain', 'intake propose', 'intake handoff']);
    expect(f.events.at(-2)!.summary).toBe('opening revenue recognition');
    expect(f.events.at(-1)!.summary).toBe('intake complete; listening for site updates');
    await cycle(); // done: nothing more
    expect(f.named('propose')).toHaveLength(1);
    expect(f.named('ask')).toHaveLength(4);
  });

  it('restart mid-intake resumes: open question is not re-asked; answered fields are skipped', async () => {
    const { f, cycle, say, restart } = setup();
    await cycle();
    await say('100000000');
    await say('40000000');
    restart();
    await cycle();
    expect(questions(f)).toEqual(['Welcome. What is this contract worth in total?', 'What have you spent on it so far?', 'What will it take to finish from here?']);
    // crash after the answer was recorded but before the next question went out
    f.s.clarificationRefs.forEach((c) => (c.status = 'confirmed'));
    restart();
    await cycle();
    expect(questions(f).at(-1)).toBe('What will it take to finish from here?');
    await say('40000000');
    expect(f.named('recordIntake').map((a) => a.field)).toEqual(['contract', 'incurred', 'remaining']);
  });
});
