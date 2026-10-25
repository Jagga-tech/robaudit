import { describe, expect, it, vi } from 'vitest';
import { handleNewSource, isAdditiveWording, startLoop, type Deps, type LedgerState, type SourceRow } from '../src/loop';
import { pollConfirmed } from '../src/bridge';
import type { Extraction } from '../src/schemas';

const P = 1n;
const ambiguous = (amt: string): Extraction => ({
  facts: [{ kind: 'remaining_update', amountText: amt, quote: amt, charStart: 0, charEnd: amt.length }],
  ambiguity: { flag: true, kind: 'additional_vs_total', question: 'Added to remaining, or new total?', options: ['additional', 'new_total'] },
});
const unflagged = (quote: string, amt: string): Extraction => ({
  facts: [{ kind: 'remaining_update', amountText: amt, quote, charStart: 0, charEnd: quote.length }],
  ambiguity: { flag: false, kind: 'none', question: '', options: [] },
});
const inputs = (remaining: bigint) => JSON.stringify({ contractValueCents: '100000000', incurredCents: '40000000', remainingCents: String(remaining), billedCents: '30000000' });

// In-memory ledger mirroring the reducers' row effects; every call is recorded.
function fake(extraction: Extraction, opts: { remaining?: bigint; convention?: boolean; confirmed?: { answer: string; speaker: string } } = {}) {
  let n = 100n;
  const nid = () => ++n;
  const s: LedgerState = {
    projects: [{ id: P, contractValueCents: 100000000n }],
    sources: [],
    conventions: opts.convention ? [{ template: 'forecast', key: 'another_means', value: 'additional', policyVersion: 3 }] : [],
    workItems: [{ id: 10n, projectId: P, title: 'Oakland deployment: forecast v1 close' }],
    calculations: [{ id: 20n, workItemId: 10n, forecastSourceId: 3n, inputsJson: inputs(opts.remaining ?? 40000000n) }],
    extractions: [], clarificationRefs: [],
    milestones: [{ id: 30n, projectId: P, name: 'acceptance', amountCents: 20000000n, status: 'pending' }],
  };
  const calls: [string, any][] = [];
  let onInsert: (x: SourceRow) => void = () => {};
  const rec = (name: string, f: (a: any) => void = () => {}) => async (a: any) => { calls.push([name, a]); f(a); };
  const deps: Deps = {
    ledger: {
      state: () => s,
      onSourceInsert: (cb) => { onInsert = cb; },
      recordExtraction: rec('recordExtraction', (a) => s.extractions.push({ sourceId: a.sourceId, reader: a.reader, factsJson: a.factsJson })),
      openClarification: rec('openClarification', (a) => s.clarificationRefs.push({ id: nid(), workItemId: a.workItemId, convexId: a.convexId, status: 'open', sourceId: maxSourceId() })),
      resolveClarification: rec('resolveClarification', (a) => {
        const c = s.clarificationRefs.find((x) => x.id === a.clarificationId)!;
        c.status = 'confirmed';
        s.sources.push({ id: nid(), projectId: P, kind: 'clarification', text: `Clarification from ${a.speaker}: A: ${a.answer}`, parentSourceId: c.sourceId });
      }),
      recordCalculation: rec('recordCalculation', (a) => s.calculations.push({ id: nid(), workItemId: a.workItemId, forecastSourceId: a.forecastSourceId, inputsJson: a.inputsJson })),
      propose: rec('propose'),
      openWorkItem: rec('openWorkItem', (a) => s.workItems.push({ id: nid(), projectId: a.projectId, title: a.title })),
      markMilestoneMet: rec('markMilestoneMet', (a) => { s.milestones.find((m) => m.id === a.milestoneId)!.status = 'met'; }),
    },
    convex: {
      ask: async (a) => { calls.push(['ask', a]); return 'cvx1'; },
      byWorkItem: async (w) => (opts.confirmed && w === '10' ? [{ _id: 'cvx1', status: 'confirmed', ...opts.confirmed }] : []),
    },
    extract: vi.fn(async () => extraction),
    explain: async () => ({ summary: 'S.', whyRevenueMoved: 'W.', whatDidNotChange: 'N.' }),
  };
  const maxSourceId = () => s.sources.reduce((m, x) => (x.id > m ? x.id : m), 0n);
  const add = (kind: string, text: string) => { const r = { id: nid(), projectId: P, kind, text, parentSourceId: 0n }; s.sources.push(r); return r; };
  const named = (name: string) => calls.filter((c) => c[0] === name).map((c) => c[1]);
  return { deps, s, calls, add, named, insert: (x: SourceRow) => onInsert(x) };
}

describe('agent loop', () => {
  it('(a) ambiguous note -> openClarification + convex ask, no propose', async () => {
    const f = fake(ambiguous('$200,000'));
    await handleNewSource(f.add('note', 'we need another $200,000 to finish'), f.deps);
    expect(f.named('ask')).toHaveLength(1);
    expect(f.named('openClarification')[0]).toMatchObject({ workItemId: 10n, convexId: 'cvx1' });
    expect(f.named('propose')).toHaveLength(0);
  });

  it('(b) confirmed clarification -> resolve, 4000 bp, propose -100,000 with pending convention', async () => {
    const f = fake(ambiguous('$200,000'), { confirmed: { answer: 'additional', speaker: 'Matt' } });
    await handleNewSource(f.add('note', 'we need another $200,000 to finish'), f.deps);
    const handled = new Set<string>();
    await pollConfirmed(f.deps, handled);
    await pollConfirmed(f.deps, handled); // second poll is a no-op
    const names = f.calls.map((c) => c[0]);
    expect(names.indexOf('resolveClarification')).toBeLessThan(names.indexOf('recordCalculation'));
    expect(f.named('resolveClarification')).toEqual([{ clarificationId: expect.any(BigInt), answer: 'additional', speaker: 'Matt', audioStorageId: '' }]);
    expect(f.named('recordCalculation')[0]).toMatchObject({ progressBp: 4000, cumRevenueCents: 40000000n, contractAssetCents: 10000000n, marginCents: 0n, lossWarning: true });
    const [p] = f.named('propose');
    expect(f.named('propose')).toHaveLength(1);
    expect(JSON.parse(p.entryJson)).toEqual([{ account: 'Revenue', debit: '10000000', credit: '0' }, { account: 'ContractAsset', debit: '0', credit: '10000000' }]);
    expect(JSON.parse(p.pendingConventionJson)).toEqual({ template: 'forecast', key: 'another_means', value: 'additional' });
    expect(p.explanation).toMatch(/^ESCALATION:/); // margin 0 = loss warning per spec
  });

  it('(c) saved convention -> month-3 note proposes 3810 bp with no question', async () => {
    const f = fake(ambiguous('$50,000'), { remaining: 60000000n, convention: true });
    await handleNewSource(f.add('note', 'another $50,000 for conveyor rework'), f.deps);
    expect(f.named('openClarification')).toHaveLength(0);
    expect(f.named('recordCalculation')[0]).toMatchObject({ progressBp: 3810, cumRevenueCents: 38095200n, marginCents: -5000000n, lossWarning: true });
    const [p] = f.named('propose');
    expect(JSON.parse(p.entryJson)[0]).toEqual({ account: 'Revenue', debit: '1904800', credit: '0' });
    expect(p.explanation).toMatch(/^ESCALATION:/);
    expect(p.explanation).toContain('Convention v3: another_means = additional');
    expect(p.pendingConventionJson).toBe('');
  });

  it('(d) same source delivered twice -> one propose', async () => {
    const f = fake(ambiguous('$50,000'), { remaining: 60000000n, convention: true });
    const stop = startLoop(f.deps, { pollMs: 10_000 });
    const src = f.add('note', 'another $50,000 for conveyor rework'); // also caught up at startup
    f.insert(src); f.insert(src);
    await new Promise((r) => setTimeout(r, 50));
    await handleNewSource(src, f.deps); // restart: extraction row already exists
    stop();
    expect(f.named('propose')).toHaveLength(1);
    expect(f.deps.extract).toHaveBeenCalledTimes(1);
  });

  it('(e) commissioning log -> milestone met, new work item, invoice entry 200,000', async () => {
    const f = fake({ facts: [{ kind: 'milestone', amountText: '', quote: 'acceptance', charStart: 0, charEnd: 10 }], ambiguity: { flag: false, kind: 'none', question: '', options: [] } });
    const log = f.add('commissioning_log', 'Site acceptance test signed');
    await handleNewSource(log, f.deps);
    expect(f.named('markMilestoneMet')).toEqual([{ milestoneId: 30n, evidenceSourceId: log.id }]);
    expect(f.named('openWorkItem')[0]).toMatchObject({ title: 'Milestone invoice: acceptance', assignedRole: 'controller' });
    const [p] = f.named('propose');
    expect(p.workItemId).toBe(f.s.workItems.at(-1)!.id);
    expect(JSON.parse(p.entryJson)).toEqual([{ account: 'AccountsReceivable', debit: '20000000', credit: '0' }, { account: 'ContractAsset', debit: '0', credit: '20000000' }]);
    expect(p.evidenceSourceIdsCsv).toBe(String(log.id));
  });

  it('(f) unflagged "another $50,000", no convention -> clarification, no propose', async () => {
    const f = fake(unflagged('another $50,000', '$50,000'), { remaining: 60000000n });
    await handleNewSource(f.add('note', 'another $50,000 for conveyor rework'), f.deps);
    expect(f.named('openClarification')).toHaveLength(1);
    expect(f.named('ask')[0]).toMatchObject({ question: 'Is the $X additional to the current remaining forecast, or the new total remaining?', options: ['additional', 'new_total'] });
    expect(f.named('propose')).toHaveLength(0);
  });

  it('(g) unflagged "another $50,000" with convention -> no clarification, 3810 bp', async () => {
    const f = fake(unflagged('another $50,000', '$50,000'), { remaining: 60000000n, convention: true });
    await handleNewSource(f.add('note', 'another $50,000 for conveyor rework'), f.deps);
    expect(f.named('openClarification')).toHaveLength(0);
    expect(f.named('recordCalculation')[0]).toMatchObject({ progressBp: 3810 });
    expect(f.named('propose')).toHaveLength(1);
  });

  it('(h) unflagged "new total remaining is $600,000" -> no clarification, new_total', async () => {
    const f = fake(unflagged('the new total remaining is $600,000', '$600,000'));
    await handleNewSource(f.add('note', 'the new total remaining is $600,000'), f.deps);
    expect(f.named('openClarification')).toHaveLength(0);
    expect(JSON.parse(f.named('recordCalculation')[0].inputsJson).remainingCents).toBe('60000000');
    expect(f.named('propose')).toHaveLength(1);
  });

  it('isAdditiveWording', () => {
    expect(isAdditiveWording('another $50,000')).toBe(true);
    expect(isAdditiveWording('we need another $200,000 to finish')).toBe(true);
    expect(isAdditiveWording('the new total remaining is $600,000')).toBe(false);
    expect(isAdditiveWording('remaining is now $600,000')).toBe(false);
  });
});
