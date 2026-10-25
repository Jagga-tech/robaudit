import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend } from './demoBackend';
import { caseView, postingRef } from './select';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

async function toClarification(b: DemoBackend) {
  await b.addSource('note', 'we need another $200,000 to finish');
  await vi.runAllTimersAsync();
  return b.getSnapshot().call!;
}

describe('DemoBackend (mirrors reducers + agent loop, arithmetic from @keel/engine)', () => {
  let b: DemoBackend;
  beforeEach(() => { vi.useFakeTimers(); b = new DemoBackend(new MemoryStorage()); });
  afterEach(() => vi.useRealTimers());

  it('starts at S0: posted at 50%, $500,000 recognized', () => {
    const v = caseView(b.getSnapshot());
    expect(v.stage).toBe('idle');
    expect(v.before?.progressBp).toBe(5000);
    expect(v.before?.cumRevenueCents).toBe(50_000_000n);
  });

  it('flags "another $200,000" as ambiguous, asks the manager, and previews both readings', async () => {
    const call = await toClarification(b);
    const v = caseView(b.getSnapshot());
    expect(v.stage).toBe('awaiting_clarification');
    expect(call.question).toBe('Is the $200,000 additional to the current remaining forecast, or the new total remaining?');
    expect(v.readings?.additional.adjustment).toBe(-10_000_000n);
    expect(v.readings?.new_total.adjustment).toBe(16_666_700n);
    expect(b.getSnapshot().proposals.filter((p) => p.status === 'open')).toHaveLength(0);
  });

  it('main branch: "additional" → 40%, $400,000, Dr Revenue / Cr ContractAsset $100,000, then posts once', async () => {
    const call = await toClarification(b);
    await b.confirm(call.id, 'additional', 'Matt');
    await vi.runAllTimersAsync();
    let v = caseView(b.getSnapshot());
    expect(v.stage).toBe('proposed');
    expect(v.after?.progressBp).toBe(4000);
    expect(v.after?.cumRevenueCents).toBe(40_000_000n);
    expect(v.after?.contractAssetCents).toBe(10_000_000n);
    expect(v.adjustmentCents).toBe(-10_000_000n);
    expect(v.entry).toEqual([
      { account: 'Revenue', debit: 10_000_000n, credit: 0n },
      { account: 'ContractAsset', debit: 0n, credit: 10_000_000n },
    ]);

    expect((await b.decide(v.latest!, 'approve', '')).ok).toBe(false); // accountant cannot approve
    await b.setRole('controller');
    expect(await b.decide(v.latest!, 'approve', '')).toEqual({ ok: true });
    expect(await b.post({ ...v.latest!, status: 'approved' }, postingRef(v.latest!))).toEqual({ ok: true });
    v = caseView(b.getSnapshot());
    expect(v.stage).toBe('posted');
    expect(b.getSnapshot().conventions.some((c) => c.key === 'another_means' && c.value === 'additional')).toBe(true);

    const replay = await b.post(v.latest!, postingRef(v.latest!));
    expect(replay).toMatchObject({ ok: false, code: 'duplicate_posting' });
    expect(b.getSnapshot().postings.filter((p) => p.proposalId === v.latest!.id)).toHaveLength(1);
  });

  it('second branch: "new total" → 66.67% and a positive catch-up of $166,667', async () => {
    const call = await toClarification(b);
    await b.confirm(call.id, 'new_total', 'Matt');
    await vi.runAllTimersAsync();
    const v = caseView(b.getSnapshot());
    expect(v.after?.progressBp).toBe(6667);
    expect(v.after?.cumRevenueCents).toBe(66_666_700n);
    expect(v.adjustmentCents).toBe(16_666_700n);
    expect(v.entry[0]).toEqual({ account: 'ContractAsset', debit: 16_666_700n, credit: 0n });
  });

  it('third branch: "not sure" keeps the forecast on hold with nothing to post', async () => {
    const call = await toClarification(b);
    await b.decline(call.id, 'not sure');
    await vi.runAllTimersAsync();
    const s = b.getSnapshot();
    expect(caseView(s).stage).toBe('unconfirmed');
    expect(s.proposals.filter((p) => p.status === 'open')).toHaveLength(0);
    expect(s.postings).toHaveLength(1); // only the S0 posting
  });

  it('applies the learned convention on month 3 without asking again', async () => {
    const call = await toClarification(b);
    await b.confirm(call.id, 'additional', 'Matt');
    await vi.runAllTimersAsync();
    await b.setRole('controller');
    const p = caseView(b.getSnapshot()).latest!;
    await b.decide(p, 'approve', '');
    await b.post({ ...p, status: 'approved' }, postingRef(p));
    await b.addSource('note', 'another $50,000 for conveyor rework');
    await vi.runAllTimersAsync();
    const v = caseView(b.getSnapshot());
    expect(v.ref).toBeNull();
    expect(v.after?.progressBp).toBe(3810);
    expect(v.adjustmentCents).toBe(-1_904_800n);
  });

  it('reset restores S0', async () => {
    await toClarification(b);
    await b.reset();
    expect(caseView(b.getSnapshot()).stage).toBe('idle');
    expect(b.getSnapshot().call).toBeNull();
  });
});

describe('DemoBackend recovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('finishes the agent step when the tab that confirmed navigated away', async () => {
    const storage = new MemoryStorage();
    const phoneTab = new DemoBackend(storage);
    const call = await toClarification(phoneTab);
    await phoneTab.confirm(call.id, 'additional', 'Matt');
    vi.clearAllTimers(); // phone tab navigates away before the agent resumes
    const desk = new DemoBackend(storage);
    await vi.runAllTimersAsync();
    expect(caseView(desk.getSnapshot()).stage).toBe('proposed');
    expect(desk.getSnapshot().calculations.filter((c) => c.progressBp === 4000)).toHaveLength(1);
  });
});
