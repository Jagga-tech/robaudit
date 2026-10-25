import { describe, expect, it } from 'vitest';
import { guardedLedger } from '../src/bus';
import { handleNewSource } from '../src/loop';
import { pollConfirmed } from '../src/agents/field-liaison';
import { summo } from '../src/agents/summo';
import { readerClaude } from '../src/agents/reader-claude';
import { readerGemini } from '../src/agents/reader-gemini';
import { documentReader } from '../src/agents/document-reader';
import { reconciler } from '../src/agents/reconciler';
import { fieldLiaison } from '../src/agents/field-liaison';
import { engine } from '../src/agents/engine';
import { explainer } from '../src/agents/explainer';
import { learner } from '../src/agents/learner';
import { reviewer } from '../src/agents/reviewer';
import { ambiguous, fake, unflagged } from './fake-deps';

const AGENTS = [summo, readerClaude, readerGemini, documentReader, reconciler, fieldLiaison, engine, explainer, learner, reviewer];
const chain = (f: ReturnType<typeof fake>) => f.events.map((e) => `${e.agent} ${e.kind}`);

describe('agent limits (may lists)', () => {
  it('may lists are the seats: readers write extractions, liaison clarifications, summo calculations/proposals, the rest nothing', () => {
    expect(Object.fromEntries(AGENTS.map((a) => [a.name, [...a.may]]))).toEqual({
      summo: ['recordCalculation', 'propose', 'openWorkItem', 'markMilestoneMet'],
      'reader-claude': ['recordExtraction'], 'reader-gemini': ['recordExtraction'], 'document-reader': ['recordExtraction'],
      reconciler: [], 'field-liaison': ['openClarification', 'resolveClarification'], engine: [], explainer: [], learner: [], reviewer: [],
    });
  });

  it('a reader calling propose throws; nobody may post; allowed calls go through', async () => {
    const f = fake(ambiguous('$1'));
    const reader = guardedLedger(f.deps.ledger, readerClaude.name, readerClaude.may);
    expect(() => reader.propose({} as any)).toThrow(/reader-claude may not call propose/);
    for (const a of AGENTS) expect(() => (guardedLedger(f.deps.ledger, a.name, a.may) as any).post({})).toThrow(/may not call post/);
    expect(() => (guardedLedger(f.deps.ledger, summo.name, summo.may) as any).post({})).toThrow(/summo may not call post/);
    expect(() => guardedLedger(f.deps.ledger, explainer.name, explainer.may).recordExtraction({} as any)).toThrow();
    await reader.recordExtraction({ sourceId: 1n, reader: 'claude', factsJson: '[]', ambiguityFlag: false, ambiguityText: '' });
    expect(f.named('recordExtraction')).toHaveLength(1);
  });
});

describe('agent_event chain', () => {
  it('nine beats: two readers -> agree -> ask -> answer -> compute -> explain -> propose', async () => {
    const f = fake(ambiguous('$200,000'), { confirmed: { answer: 'additional', speaker: 'Matt' },
      extractBoth: async () => ({ claude: ambiguous('$200,000'), gemini: ambiguous('$200,000'), agreed: true, merged: ambiguous('$200,000') }) });
    const src = f.add('note', 'we need another $200,000 to finish');
    await handleNewSource(src, f.deps);
    await pollConfirmed(f.deps, new Set());
    expect(chain(f)).toEqual(['reader-claude read', 'reader-gemini read', 'summo agree', 'field-liaison ask', 'field-liaison answer', 'engine compute', 'explainer explain', 'summo propose', 'reviewer skip']);
    expect(f.events.every((e) => typeof e.summary === 'string' && e.summary.length > 0)).toBe(true);
    expect(f.events[0]).toMatchObject({ refTable: 'source', refId: src.id });
  });

  it('second reader off -> reader-gemini skip; readers disagree -> summo disagree', async () => {
    const off = fake(ambiguous('$200,000'));
    await handleNewSource(off.add('note', 'we need another $200,000 to finish'), off.deps);
    expect(chain(off)).toEqual(['reader-claude read', 'reader-gemini skip', 'summo agree', 'field-liaison ask']);
    const dis = fake(ambiguous('$50,000'), { extractBoth: async () => ({ claude: ambiguous('$50,000'), gemini: ambiguous('$500,000'), agreed: false, merged: ambiguous('$50,000') }) });
    await handleNewSource(dis.add('note', 'another $50,000 for conveyor rework'), dis.deps);
    expect(chain(dis).slice(0, 3)).toEqual(['reader-claude read', 'reader-gemini read', 'summo disagree']);
  });

  it('scanned forecast: document-reader read + reconciler disagree come first', async () => {
    const f = fake(unflagged('Remaining Estimate: $600,000', '$600,000'));
    f.s.conventions.push({ template: 'forecast', key: 'remaining_estimate_means', value: 'future_costs_only', policyVersion: 3 });
    f.deps.fetchDocument = async () => new Uint8Array([1]);
    f.deps.readForecastDocument = async () => ({ text: 'Costs incurred to date: $420,000\nRemaining Estimate: $600,000', tables: [] });
    await handleNewSource(f.add('scanned_forecast', 'kg2x'), f.deps);
    expect(chain(f)).toEqual(['document-reader read', 'reconciler disagree', 'reader-claude read', 'reader-gemini skip', 'summo agree', 'engine compute', 'explainer explain', 'summo propose', 'reviewer skip']);
    f.deps.readForecastDocument = async () => ({ text: 'Costs incurred to date: $400,000\nRemaining Estimate: $600,000', tables: [] });
    const g = fake(unflagged('Remaining Estimate: $600,000', '$600,000'));
    g.deps.fetchDocument = f.deps.fetchDocument; g.deps.readForecastDocument = f.deps.readForecastDocument;
    await handleNewSource(g.add('scanned_forecast', 'kg2y'), g.deps);
    expect(chain(g).slice(0, 2)).toEqual(['document-reader read', 'reconciler reconcile']);
  });

  it('reviewer: flag appends a line and logs review; consistent leaves text alone; error -> skip', async () => {
    const run = async (review: any) => {
      const f = fake(unflagged('the new total remaining is $600,000', '$600,000'));
      f.deps.review = review;
      await handleNewSource(f.add('note', 'the new total remaining is $600,000'), f.deps);
      return { f, p: f.named('propose')[0], last: f.events.at(-1)! };
    };
    const flagged = await run(async (i: any) => { expect(i).toMatchObject({ adjustmentCents: '-10000000', remainingAfterCents: '60000000' }); return { consistent: false, note: 'Summary cites $999 not in the calculation.' }; });
    expect(flagged.p.explanation.endsWith('\nReviewer flag: Summary cites $999 not in the calculation.')).toBe(true);
    expect(chain(flagged.f).slice(-3)).toEqual(['explainer explain', 'summo propose', 'reviewer review']);
    expect(flagged.last).toMatchObject({ summary: 'flag: Summary cites $999 not in the calculation.', refTable: 'calculation' }); // fake proposals carry no id
    const ok = await run(async () => ({ consistent: true, note: 'Figures match the calculation; entry balanced.' }));
    expect(ok.p.explanation).not.toContain('Reviewer flag');
    expect(ok.last).toMatchObject({ kind: 'review', summary: 'consistent: Figures match the calculation; entry balanced.' });
    const down = await run(async () => { throw new Error('503'); });
    expect(down.last).toMatchObject({ kind: 'skip', summary: 'reviewer unavailable (503)' });
    expect(down.p.explanation).toBe(ok.p.explanation);
  });

  it('a failing step logs summo error and still rethrows (retry semantics unchanged)', async () => {
    const f = fake(ambiguous('$1'), { extract: async () => { throw new Error('down'); } });
    await expect(handleNewSource(f.add('note', 'x $1'), f.deps)).rejects.toThrow('down');
    expect(chain(f)).toEqual(['summo error']);
  });
});
