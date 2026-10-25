import { describe, expect, it, vi } from 'vitest';
import { handleNewSource, isAdditiveWording, normalizeAnswer, startLoop, type Deps, type LedgerState, type SourceRow } from '../src/loop';
import { pollConfirmed } from '../src/bridge';
import type { Extraction } from '../src/schemas';
import { ambiguous, fake, inputs, unflagged } from './fake-deps';

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
    const src = f.add('note', 'another $50,000 for conveyor rework'); // caught up at startup
    const stop = startLoop(f.deps, { pollMs: 10_000 });
    f.insert(src); f.insert(src);
    await new Promise((r) => setTimeout(r, 50));
    await handleNewSource(src, f.deps); // restart: calculation for this source already exists
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

  it('quote is just the amount, note says "another" -> guard still fires (convention applies / clarification asked)', async () => {
    const note = 'another $50,000 for conveyor rework';
    const withConv = fake(unflagged('$50,000', '$50,000'), { remaining: 60000000n, convention: true });
    await handleNewSource(withConv.add('note', note), withConv.deps);
    expect(withConv.named('ask')).toHaveLength(0);
    expect(withConv.named('openClarification')).toHaveLength(0);
    expect(withConv.named('recordCalculation')[0]).toMatchObject({ progressBp: 3810 });
    expect(withConv.named('propose')).toHaveLength(1);
    const noConv = fake(unflagged('$50,000', '$50,000'), { remaining: 60000000n });
    await handleNewSource(noConv.add('note', note), noConv.deps);
    expect(noConv.named('openClarification')).toHaveLength(1);
    expect(noConv.named('propose')).toHaveLength(0);
  });

  it('(f) unflagged "another $50,000", no convention -> clarification bound to this note, no propose', async () => {
    const f = fake(unflagged('another $50,000', '$50,000'), { remaining: 60000000n });
    f.s.extractions.push({ sourceId: 5n, reader: 'claude', factsJson: '[]', ambiguityFlag: true }); // older ambiguous source
    const src = f.add('note', 'another $50,000 for conveyor rework');
    await handleNewSource(src, f.deps);
    expect(f.named('recordExtraction')[0]).toMatchObject({ ambiguityFlag: true, ambiguityText: expect.stringContaining('additional') });
    expect(f.s.clarificationRefs[0].sourceId).toBe(src.id);
    expect(f.named('openClarification')).toHaveLength(1);
    expect(f.named('ask')[0]).toMatchObject({ question: 'Is the $50,000 additional to the current remaining forecast, or the new total remaining?', options: ['additional', 'new_total'] });
    expect(f.named('propose')).toHaveLength(0);
  });

  it('(g) unflagged "another $50,000" with convention -> no clarification, 3810 bp', async () => {
    const f = fake(unflagged('another $50,000', '$50,000'), { remaining: 60000000n, convention: true });
    await handleNewSource(f.add('note', 'another $50,000 for conveyor rework'), f.deps);
    expect(f.named('openClarification')).toHaveLength(0);
    expect(f.named('recordCalculation')[0]).toMatchObject({ progressBp: 3810 });
    expect(f.named('propose')).toHaveLength(1);
  });

  it('(h0) forecast leaving remaining unchanged -> calculation recorded, no propose', async () => {
    const f = fake(unflagged('the new total remaining is $400,000', '$400,000'));
    await handleNewSource(f.add('note', 'the new total remaining is $400,000'), f.deps);
    expect(f.named('recordCalculation')).toHaveLength(1);
    expect(f.named('propose')).toHaveLength(0);
  });

  it('(h) unflagged "new total remaining is $600,000" -> no clarification, new_total', async () => {
    const f = fake(unflagged('the new total remaining is $600,000', '$600,000'));
    await handleNewSource(f.add('note', 'the new total remaining is $600,000'), f.deps);
    expect(f.named('openClarification')).toHaveLength(0);
    expect(JSON.parse(f.named('recordCalculation')[0].inputsJson).remainingCents).toBe('60000000');
    expect(f.named('propose')).toHaveLength(1);
  });

  it('amount comes from the quote, not a mismatched amountText', async () => {
    const f = fake(unflagged('$200,000', '$300,000'));
    await handleNewSource(f.add('note', 'the new total remaining is $200,000'), f.deps);
    expect(JSON.parse(f.named('recordCalculation')[0].inputsJson).remainingCents).toBe('20000000');
  });

  it('explain throws -> calculation recorded first, propose with the template explanation', async () => {
    const f = fake(unflagged('the new total remaining is $600,000', '$600,000'), { explain: async () => { throw new Error('claude down'); } });
    await handleNewSource(f.add('note', 'the new total remaining is $600,000'), f.deps);
    expect(f.named('recordCalculation')).toHaveLength(1);
    const names = f.calls.map((c) => c[0]);
    expect(names.indexOf('recordCalculation')).toBeLessThan(names.indexOf('propose'));
    const [p] = f.named('propose');
    expect(p.calculationId).toBe(f.s.calculations.at(-1)!.id);
    expect(p.explanation).toContain('The estimate to finish rose from $400,000 to $600,000');
    expect(p.explanation).toContain('This is an estimate update, not an error or a restatement.');
  });

  it('explain cites a number not derived from the inputs -> template replaces it', async () => {
    const f = fake(unflagged('the new total remaining is $600,000', '$600,000'), { explain: async () => ({ summary: 'Revenue fell by $123,456.', whyRevenueMoved: 'W.', whatDidNotChange: 'N.' }) });
    await handleNewSource(f.add('note', 'the new total remaining is $600,000'), f.deps);
    const [p] = f.named('propose');
    expect(p.explanation).not.toContain('$123,456');
    expect(p.explanation).toContain('The estimate to finish rose from $400,000 to $600,000');
  });

  it('explain with only input-derived figures is kept', async () => {
    const f = fake(unflagged('the new total remaining is $600,000', '$600,000'), { explain: async () => ({ summary: 'The estimate to finish rose from $400,000 to $600,000; revenue reversed $100,000.', whyRevenueMoved: 'W.', whatDidNotChange: 'N.' }) });
    await handleNewSource(f.add('note', 'the new total remaining is $600,000'), f.deps);
    expect(f.named('propose')[0].explanation).toContain('revenue reversed $100,000.');
  });

  it('extract rejects once then succeeds -> retried on the next poll, one proposal', async () => {
    let n = 0;
    const x = unflagged('the new total remaining is $600,000', '$600,000');
    const f = fake(x, { extract: async () => { if (n++ === 0) throw new Error('529 overloaded'); return x; } });
    f.add('note', 'the new total remaining is $600,000');
    const stop = startLoop(f.deps, { pollMs: 5 });
    await new Promise((r) => setTimeout(r, 100));
    stop();
    expect(f.deps.extract).toHaveBeenCalledTimes(2);
    expect(f.named('propose')).toHaveLength(1);
  });

  it('extract always fails -> gives up after 3 attempts', async () => {
    const f = fake(ambiguous('$1'), { extract: async () => { throw new Error('down'); } });
    f.add('note', 'the new total remaining is $600,000');
    const stop = startLoop(f.deps, { pollMs: 5 });
    await new Promise((r) => setTimeout(r, 150));
    stop();
    expect(f.deps.extract).toHaveBeenCalledTimes(3);
  });

  it('month-3 note filed as cost (no remaining_update) -> additive fallback still uses the convention, 3810 bp', async () => {
    const asCost: Extraction = { facts: [{ kind: 'cost', amountText: '$50,000', quote: '$50,000', charStart: 8, charEnd: 15 }], ambiguity: { flag: false, kind: 'none', question: '', options: [] } };
    const f = fake(asCost, { remaining: 60000000n, convention: true });
    await handleNewSource(f.add('note', 'another $50,000 for conveyor rework'), f.deps);
    expect(f.named('recordCalculation')[0]).toMatchObject({ progressBp: 3810 });
    expect(f.named('propose')).toHaveLength(1);
  });

  it('readers disagree on the amount -> convention skipped, disagreement question asked', async () => {
    const merged: Extraction = { ...ambiguous('$50,000'), ambiguity: { flag: true, kind: 'other', question: 'Two independent readers disagree on this note: Claude read $50,000, Gemini read $500,000. Which is right?', options: ['additional', 'new_total'] } };
    const f = fake(ambiguous('$50,000'), { remaining: 60000000n, convention: true,
      extractBoth: async () => ({ claude: ambiguous('$50,000'), gemini: ambiguous('$500,000'), agreed: false, merged }) });
    await handleNewSource(f.add('note', 'another $50,000 for conveyor rework'), f.deps);
    expect(f.named('propose')).toHaveLength(0);
    expect(f.named('ask')[0].question).toMatch(/readers disagree/);
  });

  it('normalizeAnswer', () => {
    expect(normalizeAnswer("it's additional")).toBe('additional');
    expect(normalizeAnswer('new total')).toBe('new_total');
    expect(normalizeAnswer('additional, not a new total')).toBeNull();
    expect(normalizeAnswer('no idea')).toBeNull();
  });

  it('unclear Convex answer -> fallbackText, not resolved; re-confirmed later -> resolved', async () => {
    const f = fake(ambiguous('$200,000'), { confirmed: { answer: 'additional, not a new total', speaker: 'Matt' } });
    await handleNewSource(f.add('note', 'we need another $200,000 to finish'), f.deps);
    const handled = new Set<string>();
    await pollConfirmed(f.deps, handled);
    expect(f.named('fallbackText')).toEqual(['cvx1']);
    expect(f.named('resolveClarification')).toHaveLength(0);
    expect(handled.has('cvx1')).toBe(false);
    f.deps.convex.byWorkItem = async () => [{ _id: 'cvx1', status: 'confirmed', answer: 'additional', speaker: 'Matt' }];
    await pollConfirmed(f.deps, handled);
    expect(f.named('resolveClarification')).toHaveLength(1);
    expect(f.named('propose')).toHaveLength(1);
  });

  it('startup: extraction row but no calculation/clarification -> processed again', async () => {
    const f = fake(ambiguous('$200,000'));
    const src = f.add('note', 'we need another $200,000 to finish');
    f.s.extractions.push({ sourceId: src.id, reader: 'claude', factsJson: '[]', ambiguityFlag: true }); // convex ask failed last run
    const stop = startLoop(f.deps, { pollMs: 10_000 });
    await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(f.deps.extract).toHaveBeenCalledTimes(1);
    expect(f.named('openClarification')).toHaveLength(1);
  });

  it('startup: confirmed clarification with no calculation -> recordCalculation + propose', async () => {
    const f = fake(ambiguous('$200,000'));
    const src = f.add('note', 'we need another $200,000 to finish');
    f.s.extractions.push({ sourceId: src.id, reader: 'claude', factsJson: JSON.stringify(ambiguous('$200,000').facts), ambiguityFlag: true });
    f.s.clarificationRefs.push({ id: 50n, workItemId: 10n, sourceId: src.id, convexId: 'cvx9', status: 'confirmed', answer: 'additional', speaker: 'Matt', audioStorageId: '' });
    const stop = startLoop(f.deps, { pollMs: 5 });
    await new Promise((r) => setTimeout(r, 50));
    stop();
    expect(f.deps.extract).not.toHaveBeenCalled();
    expect(f.named('resolveClarification')).toHaveLength(0);
    expect(f.named('recordCalculation')).toHaveLength(1);
    expect(f.named('propose')).toHaveLength(1);
    expect(f.named('recordCalculation')[0]).toMatchObject({ progressBp: 4000 });
  });

  it('baseline skips a returned proposal and uses the last approved/posted one', async () => {
    const f = fake(ambiguous('$50,000'), { convention: true }); // seed remaining 400k
    f.s.calculations.push({ id: 21n, workItemId: 10n, forecastSourceId: 4n, inputsJson: inputs(60000000n) });
    f.s.proposals.push({ calculationId: 21n, status: 'returned' });
    await handleNewSource(f.add('note', 'another $50,000 for conveyor rework'), f.deps);
    expect(JSON.parse(f.named('recordCalculation')[0].inputsJson).remainingCents).toBe('45000000');
  });

  it('note with no dollar figure -> no ask, no propose', async () => {
    const f = fake({ facts: [], ambiguity: { flag: false, kind: 'none', question: '', options: [] } });
    await handleNewSource(f.add('note', 'we need more time on site'), f.deps);
    expect(f.named('ask')).toHaveLength(0);
    expect(f.named('propose')).toHaveLength(0);
  });

  it('isAdditiveWording', () => {
    expect(isAdditiveWording('another $50,000')).toBe(true);
    expect(isAdditiveWording('we need another $200,000 to finish')).toBe(true);
    expect(isAdditiveWording('the new total remaining is $600,000')).toBe(false);
    expect(isAdditiveWording('remaining is now $600,000')).toBe(false);
  });

  it('scanned sheet disagrees with the cost export on incurred -> disagreement on the azure-di row, explanation names the system of record', async () => {
    const f = fake(unflagged('Remaining Estimate: $600,000', '$600,000'));
    f.s.conventions.push({ template: 'forecast', key: 'remaining_estimate_means', value: 'future_costs_only', policyVersion: 3 });
    f.deps.fetchDocument = async () => new Uint8Array([1]);
    f.deps.readForecastDocument = async () => ({ text: 'Costs incurred to date: $420,000\nRemaining Estimate: $600,000', tables: [] });
    await handleNewSource(f.add('scanned_forecast', 'kg2x'), f.deps);
    const ocr = f.named('recordExtraction').find((e) => e.reader === 'azure-di');
    expect(JSON.parse(ocr.factsJson).disagreement).toMatchObject({ document: '42000000', ledger: '40000000' });
    expect(f.named('propose')[0].explanation).toContain('system of record');
  });
});
