// Promptfoo custom provider: runs the real RoboAudit reader + Summo decision code (TypeScript, loaded through tsx).
// config.reader: 'claude' | 'gemini' -> read the note, then route it through the real loop on an in-memory ledger.
// config.reader: 'engine'            -> deterministic engine / answer-mapping cases (vars.op), no model.
import { tsImport } from 'tsx/esm/api';

const src = (p) => tsImport(new URL(`../${p}`, import.meta.url).href, import.meta.url);
const [{ extract, parseAmountCents }, { extractWithGemini }, { hasKey }, loop, eng] = await Promise.all([
  src('apps/agent/src/extract.ts'), src('apps/agent/src/gemini.ts'), src('apps/agent/src/claude.ts'), src('apps/agent/src/loop.ts'), src('packages/engine/src/index.ts'),
]);
const S0 = { contractValue: 100000000n, incurred: 40000000n, remaining: 40000000n, billed: 30000000n }; // $1M contract, $400k in, $400k left
const json = (o) => JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? String(v) : v));

// ponytail: minimal copy of apps/agent/test/fake-deps.ts (that file imports vitest, which won't load outside the runner)
function ledger(extraction, remaining) {
  let n = 100n;
  const s = {
    projects: [{ id: 1n, contractValueCents: S0.contractValue }], sources: [], conventions: [],
    workItems: [{ id: 10n, projectId: 1n, title: 'forecast' }],
    calculations: [{ id: 20n, workItemId: 10n, forecastSourceId: 3n, inputsJson: JSON.stringify({ contractValueCents: String(S0.contractValue), incurredCents: String(S0.incurred), remainingCents: String(remaining), billedCents: String(S0.billed) }) }],
    extractions: [], clarificationRefs: [], proposals: [{ calculationId: 20n, status: 'posted' }],
    milestones: [{ id: 30n, projectId: 1n, name: 'acceptance', amountCents: 20000000n, status: 'pending' }],
  };
  const calls = [];
  const rec = (name, f = () => {}) => async (a) => { calls.push([name, a]); f(a); };
  const deps = {
    ledger: {
      state: () => s, onSourceInsert() {},
      recordExtraction: rec('recordExtraction', (a) => s.extractions.push(a)),
      openClarification: rec('openClarification'),
      resolveClarification: rec('resolveClarification'),
      recordCalculation: rec('recordCalculation', (a) => s.calculations.push({ id: ++n, ...a })),
      propose: rec('propose', (a) => s.proposals.push({ calculationId: a.calculationId, status: 'open' })),
      openWorkItem: rec('openWorkItem'), markMilestoneMet: rec('markMilestoneMet'), logAgentEvent: async () => {},
    },
    convex: { ask: async (a) => { calls.push(['ask', a]); return 'cvx1'; }, byWorkItem: async () => [], fallbackText: async () => {} },
    extract: async () => extraction,
    explain: async () => ({ summary: 'S.', whyRevenueMoved: 'W.', whatDidNotChange: 'N.' }), // explainer is not under test here
  };
  const note = { id: ++n, projectId: 1n, kind: 'note', text: '', parentSourceId: 0n };
  return { deps, s, calls, note };
}

async function read(reader, note, remaining) {
  if (reader === 'claude' && !hasKey) throw new Error('no ANTHROPIC_API_KEY: refusing to grade the mock reader');
  const x = reader === 'gemini' ? await extractWithGemini(note) : await extract(note, 1);
  const f = x.facts.find((f) => f.kind === 'remaining_update');
  const red = loop.isReductionWording(note);
  const direction = !f ? 'none' : red === 'additional' ? 'reduction' : red === 'new_total' ? 'new_total' : loop.isAdditiveWording(note) ? 'additive' : 'new_total';
  const L = ledger(x, remaining);
  L.note.text = note; L.s.sources.push(L.note);
  await loop.handleNewSource(L.note, L.deps);
  const named = (k) => L.calls.filter((c) => c[0] === k).map((c) => c[1]);
  const asks = named('ask'), calc = named('recordCalculation')[0];
  const decision = asks.length ? 'ask' : calc ? 'book' : 'none';
  return {
    facts: x.facts.map(({ kind, amountText, quote }) => ({ kind, amountText, quote })), ambiguity: x.ambiguity,
    amountCents: f ? parseAmountCents(f.amountText) : null, direction, decision,
    question: asks[0]?.question ?? null, remainingAfterCents: calc ? JSON.parse(calc.inputsJson).remainingCents : null, proposals: named('propose').length,
  };
}

function engine(v) {
  if (v.op === 'answer') return { answer: loop.normalizeAnswer(v.answer) };
  const next = { ...S0, remaining: eng.applyUpdate(S0.remaining, BigInt(v.update), v.convention) };
  const before = eng.compute(S0), after = eng.compute(next);
  const adj = eng.adjustment(before.cumRevenue, after.cumRevenue);
  return { remaining: next.remaining, progressBp: after.progressBp, cumRevenue: after.cumRevenue, adjustment: adj, entryLines: eng.buildEntry(adj).length };
}

export default class Provider {
  constructor(options) { this.reader = options.config?.reader ?? 'claude'; this.label = options.label; }
  id() { return `roboaudit:${this.reader}`; }
  async callApi(prompt, context) {
    const v = context?.vars ?? {};
    try {
      const out = this.reader === 'engine' ? engine(v) : await read(this.reader, prompt, BigInt(v.remaining ?? S0.remaining));
      return { output: json(out) };
    } catch (e) { return { error: `${this.reader}: ${e?.message ?? e}` }; }
  }
}
