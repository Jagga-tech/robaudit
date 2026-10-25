import { vi } from 'vitest';
import type { Deps, LedgerState, SourceRow } from '../src/loop';
import type { Extraction } from '../src/schemas';

export const P = 1n;
export const ambiguous = (amt: string): Extraction => ({
  facts: [{ kind: 'remaining_update', amountText: amt, quote: amt, charStart: 0, charEnd: amt.length }],
  ambiguity: { flag: true, kind: 'additional_vs_total', question: 'Added to remaining, or new total?', options: ['additional', 'new_total'] },
});
export const unflagged = (quote: string, amt: string): Extraction => ({
  facts: [{ kind: 'remaining_update', amountText: amt, quote, charStart: 0, charEnd: quote.length }],
  ambiguity: { flag: false, kind: 'none', question: '', options: [] },
});
export const inputs = (remaining: bigint) => JSON.stringify({ contractValueCents: '100000000', incurredCents: '40000000', remainingCents: String(remaining), billedCents: '30000000' });

// In-memory ledger mirroring the reducers' row effects; every call is recorded.
export function fake(extraction: Extraction, opts: { remaining?: bigint; convention?: boolean; confirmed?: { answer: string; speaker: string }; explain?: () => Promise<any>; extract?: () => Promise<Extraction>; extractBoth?: Deps['extractBoth'] } = {}) {
  let n = 100n;
  const nid = () => ++n;
  const s: LedgerState = {
    projects: [{ id: P, contractValueCents: 100000000n }],
    sources: [],
    conventions: opts.convention ? [{ template: 'forecast', key: 'another_means', value: 'additional', policyVersion: 3 }] : [],
    workItems: [{ id: 10n, projectId: P, title: 'Oakland deployment: forecast v1 close' }],
    calculations: [{ id: 20n, workItemId: 10n, forecastSourceId: 3n, inputsJson: inputs(opts.remaining ?? 40000000n) }],
    extractions: [], clarificationRefs: [], proposals: [{ calculationId: 20n, status: 'posted' }],
    milestones: [{ id: 30n, projectId: P, name: 'acceptance', amountCents: 20000000n, status: 'pending' }],
  };
  const calls: [string, any][] = [];
  let onInsert: (x: SourceRow) => void = () => {};
  const rec = (name: string, f: (a: any) => void = () => {}) => async (a: any) => { calls.push([name, a]); f(a); };
  const deps: Deps = {
    ledger: {
      state: () => s,
      onSourceInsert: (cb) => { onInsert = cb; },
      recordExtraction: rec('recordExtraction', (a) => s.extractions.push({ sourceId: a.sourceId, reader: a.reader, factsJson: a.factsJson, ambiguityFlag: a.ambiguityFlag })),
      // like the real reducer: bind to the newest source on the project whose extraction is flagged ambiguous
      openClarification: rec('openClarification', (a) => {
        const sourceId = s.extractions.filter((e) => e.ambiguityFlag).reduce((m, e) => (e.sourceId > m ? e.sourceId : m), 0n);
        s.clarificationRefs.push({ id: nid(), workItemId: a.workItemId, convexId: a.convexId, status: 'open', sourceId, answer: '', speaker: '', audioStorageId: '' });
      }),
      resolveClarification: rec('resolveClarification', (a) => {
        const c = s.clarificationRefs.find((x) => x.id === a.clarificationId)!;
        Object.assign(c, { status: 'confirmed', answer: a.answer, speaker: a.speaker });
        s.sources.push({ id: nid(), projectId: P, kind: 'clarification', text: `Clarification from ${a.speaker}: A: ${a.answer}`, parentSourceId: c.sourceId });
      }),
      recordCalculation: rec('recordCalculation', (a) => s.calculations.push({ id: nid(), workItemId: a.workItemId, forecastSourceId: a.forecastSourceId, inputsJson: a.inputsJson })),
      propose: rec('propose', (a) => s.proposals.push({ calculationId: a.calculationId, status: 'open' })),
      openWorkItem: rec('openWorkItem', (a) => s.workItems.push({ id: nid(), projectId: a.projectId, title: a.title })),
      markMilestoneMet: rec('markMilestoneMet', (a) => { s.milestones.find((m) => m.id === a.milestoneId)!.status = 'met'; }),
    },
    convex: {
      ask: async (a) => { calls.push(['ask', a]); return 'cvx1'; },
      byWorkItem: async (w) => (opts.confirmed && w === '10' ? [{ _id: 'cvx1', status: 'confirmed', ...opts.confirmed }] : []),
      fallbackText: async (id) => { calls.push(['fallbackText', id]); },
    },
    extract: vi.fn(opts.extract ?? (async () => extraction)),
    extractBoth: opts.extractBoth,
    explain: opts.explain ?? (async () => ({ summary: 'S.', whyRevenueMoved: 'W.', whatDidNotChange: 'N.' })),
  };
  const add = (kind: string, text: string) => { const r = { id: nid(), projectId: P, kind, text, parentSourceId: 0n }; s.sources.push(r); return r; };
  const named = (name: string) => calls.filter((c) => c[0] === name).map((c) => c[1]);
  return { deps, s, calls, add, named, insert: (x: SourceRow) => onInsert(x) };
}
