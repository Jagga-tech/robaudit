// Internal benchmark of the Robaudit/Summo multi-agent loop: reading accuracy, planted errors, per-agent latency, chain integrity.
// Usage: pnpm bench [--db keel-bench] [--runs 1]. LOCAL scratch ledger only (never `keel`, never Maincloud); real Convex + model keys
// from .env; agent loop in-process (no other `pnpm agent` may target the bench db). Writes docs/benchmark.md.
import fs from 'node:fs';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { connectAs, type DbConnection } from '@keel/ledger-client';
import { hasKey } from '../apps/agent/src/claude.ts';
import { hasGeminiKey } from '../apps/agent/src/gemini.ts';
import { agentDeps, isSeed } from '../apps/agent/src/ledger-adapter.ts';
import { startLoop } from '../apps/agent/src/loop.ts';
import { INJECTION, PHRASES, type Want } from '../apps/agent/src/bench-cases.ts';

const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DB = opt('--db', 'keel-bench'), RUNS = Number(opt('--runs', '1')), URI = 'ws://127.0.0.1:3000';
if (DB === 'keel' || !RUNS) throw new Error('--db must be a scratch db (not keel); --runs >= 1');
for (const f of ['.env.local', '.env']) {
  try { const m = fs.readFileSync(new URL(f, root), 'utf8').match(/^CONVEX_URL\s*=\s*(\S+)/m); if (m) process.env.CONVEX_URL ??= m[1]; } catch {}
}
if (!process.env.CONVEX_URL) throw new Error('CONVEX_URL unset');

// ponytail: demo.ts runs on import, so its two helpers are copied rather than imported
async function until<T>(what: string, f: () => T | undefined | false | null | Promise<T | undefined | false | null>, ms = 60000): Promise<T> {
  for (const deadline = Date.now() + ms; ; await new Promise((r) => setTimeout(r, 100))) {
    const v = await f();
    if (v !== undefined && v !== null && v !== false) return v as T;
    if (Date.now() > deadline) throw new Error(`timed out after ${ms / 1000}s waiting for: ${what}`);
  }
}
const entry = (json: string) => (JSON.parse(json) as { account: string; debit: string; credit: string }[])
  .map((l) => (l.debit !== '0' ? `Dr ${l.account} ${l.debit}` : `Cr ${l.account} ${l.credit}`)).sort().reverse().join(' / ');
const secs = (t: any) => Number(t.__timestamp_micros_since_unix_epoch__) / 1e6;
const usd = (c: bigint) => `${c < 0n ? '-' : ''}$${(c < 0n ? -c : c) / 100n}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const cvx = new ConvexHttpClient(process.env.CONVEX_URL);
/** Convex Auth: anonymous session so the call mutations (confirm/decline) accept us. */
async function signInAnon(c: ConvexHttpClient) { try { const r: any = await c.action(anyApi.auth.signIn, { provider: 'anonymous' }); c.setAuth(r.tokens.token); } catch (e: any) { console.warn('convex anonymous sign-in unavailable on this deployment; continuing without a session:', String(e?.message ?? e).slice(0, 80)); } }
await signInAnon(cvx);
await cvx.query(anyApi.clarifications.active, {}); // reachability check, same client the demo uses
const o = { uri: URI, db: DB };
const controller = await connectAs('controller', o), accountant = await connectAs('accountant', o), agent = await connectAs('agent', o);
const conns: DbConnection[] = [controller, accountant, agent];
const db = controller.db;
const stop = startLoop(agentDeps(agent, cvx), { isSeed });
const startedAt = new Date();
console.log(`bench: stdb ${URI}/${DB}, convex ${process.env.CONVEX_URL}, claude=${hasKey ? 'REAL' : 'MOCK'} gemini=${hasGeminiKey ? 'REAL' : 'OFF'}, runs=${RUNS}`);

// ---- ledger helpers ----
type Ev = { id: bigint; agent: string; kind: string; summary: string; refTable: string; refId: bigint; at: number };
const events = (): Ev[] => [...db.agentEvent.iter()].map((e) => ({ ...e, at: secs(e.at) })).sort((a, b) => (a.id < b.id ? -1 : 1));
const lastEv = () => events().at(-1)?.id ?? 0n;
const oak = () => [...db.project.iter()].find((p) => p.name === 'Oakland deployment')!;
const forecastWi = () => [...db.workItem.iter()].find((w) => w.projectId === oak().id && !w.title.startsWith('Milestone'))!;
const proposals = () => [...db.proposal.iter()].filter((p) => p.workItemId === forecastWi().id);
const calcOf = (srcId: bigint) => [...db.calculation.iter()].filter((c) => c.forecastSourceId === srcId).at(-1);
const refOf = (srcId: bigint) => [...db.clarificationRef.iter()].filter((c) => c.sourceId === srcId).at(-1);
const remainingOf = (srcId: bigint) => { const c = calcOf(srcId); return c ? BigInt(JSON.parse(c.inputsJson).remainingCents) : undefined; };
const ok = <T>(p: Promise<T>) => p.then(() => '', (e: any) => String(e?.message ?? e)); // '' = accepted, else the refusal

/** Agent idle: last event since `since` is terminal (3 errors count as one terminal: the bus retries twice). */
const terminal = (evs: Ev[]) => {
  const e = evs.at(-1);
  if (!e) return false;
  if (e.agent === 'summo' && e.kind === 'error') return evs.filter((x) => x.kind === 'error').length >= 3;
  return e.agent === 'reviewer' || (e.agent === 'field-liaison' && e.kind === 'ask')
    || (e.agent === 'summo' && e.kind === 'skip' && !e.summary.startsWith('convention'))
    || (e.agent === 'summo' && e.kind === 'propose' && e.summary.startsWith('milestone'))
    || (e.agent === 'field-liaison' && e.kind === 'skip');
};
const settle = async (since: bigint, ms = 180000) => {
  await until('agent idle', () => terminal(events().filter((e) => e.id > since)), ms);
  await new Promise((r) => setTimeout(r, 400)); // let the review/propose row and the subscription catch up
};

const captured: { name: string; evs: Ev[]; src: Map<bigint, number> }[] = [];
let caseStart = 0n, caseName = '';
async function reset(name: string) {
  if (caseName) captured.push({ name: caseName, evs: events(), src: new Map([...db.source.iter()].map((s) => [s.id, secs(s.createdAt)])) });
  caseName = name;
  await controller.reducers.resetDemo({});
  for (const c of conns) await until('S0 visible', () => [...c.db.proposal.iter()].length === 1 && [...c.db.agentEvent.iter()].length === 0, 10000);
  caseStart = lastEv();
}
async function add(kind: string, text: string) {
  const before = [...db.source.iter()].reduce((m, s) => (s.id > m ? s.id : m), 0n);
  await accountant.reducers.addSource({ projectId: oak().id, kind, text, parentSourceId: 0n, version: 1 });
  return until('source row', () => [...db.source.iter()].find((s) => s.id > before && s.text === text), 10000);
}
async function note(kind: string, text: string) { const since = lastEv(); const s = await add(kind, text); await settle(since); return s; }
async function answer(srcId: bigint, ans: string) {
  const ref = await until('open clarification_ref', () => [...db.clarificationRef.iter()].find((c) => c.sourceId === srcId && c.status === 'open'), 10000);
  const since = lastEv(), t = Date.now() / 1000; // same machine as the local SpacetimeDB, so one clock
  await cvx.mutation(anyApi.clarifications.confirm, { id: ref.convexId, answer: ans, speaker: 'Bench' });
  await settle(since);
  const c = events().find((e) => e.id > since && e.agent === 'engine');
  if (c) push('confirm → compute (time-to-numbers)', c.at - t);
  return ref;
}
const uploads = new Map<string, string>();
async function upload(file: string) {
  if (!uploads.has(file)) {
    const url: string = await cvx.mutation(anyApi.clarifications.generateUploadUrl, {});
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(new URL(`apps/agent/test/fixtures/sheets/${file}`, root)) });
    uploads.set(file, ((await r.json()) as { storageId: string }).storageId);
  }
  return uploads.get(file)!;
}

const lat: Record<string, number[]> = {};
const push = (k: string, v: number) => (lat[k] ??= []).push(v);

// ---- A. reading accuracy ----
const B0 = 40000000n; // S0 remaining
const expectRemaining = (w: Want) => (w.kind === 'remaining_update' && w.cents != null ? (w.flag || w.cents < 0n ? B0 + w.cents : w.cents) : undefined);
async function readingCase(text: string, w: Want): Promise<string[]> {
  await reset(`A: ${text}`);
  const src = await note('note', text);
  const x = await until('claude extraction', () => [...db.extraction.iter()].find((e) => e.sourceId === src.id && e.reader === 'claude'), 10000).catch(() => undefined);
  if (!x) return ['no extraction row'];
  const bad: string[] = [];
  const facts = JSON.parse(x.factsJson) as { kind: string; amountText: string }[];
  if (w.kind === 'none' ? facts.length : !facts.some((f) => f.kind === w.kind)) bad.push(`kind: got [${facts.map((f) => f.kind)}]`);
  if (w.kind !== 'remaining_update' && facts.some((f) => f.kind === 'remaining_update')) bad.push('kind: unexpected remaining_update');
  if (x.ambiguityFlag !== w.flag) bad.push(`ambiguity: asked=${x.ambiguityFlag}, want ${w.flag}`);
  if (x.ambiguityFlag && refOf(src.id)?.status === 'open') await answer(src.id, 'additional');
  const want = expectRemaining(w), got = remainingOf(src.id);
  if (got !== want) bad.push(`remaining: got ${got == null ? 'no calculation' : usd(got)}, want ${want == null ? 'no calculation' : usd(want)}`);
  return bad;
}

// ---- B. planted errors (answer key from the spec / demo) ----
type B = { name: string; pass: boolean; detail: string };
const checks = (name: string, parts: [string, boolean][]): B => ({ name, pass: parts.every(([, v]) => v), detail: parts.map(([k, v]) => `${v ? 'ok' : 'FAIL'} ${k}`).join('; ') });
const AMBIG = 'we need another $200,000 to finish';

async function plantedErrors(): Promise<B[]> {
  const out: B[] = [];
  const run = async (name: string, f: () => Promise<B | B[]>) => {
    try { const r = await f(); out.push(...(Array.isArray(r) ? r : [r])); } catch (e: any) { out.push({ name, pass: false, detail: `error: ${e?.message ?? e}` }); }
  };
  await run('ambiguous note asks; new_total', async () => {
    await reset('B: ambiguous -> new_total');
    const src = await note('note', AMBIG);
    const asked = checks('ambiguous note -> asks, does not propose', [
      ['clarification_ref open', refOf(src.id)?.status === 'open'], ['no new proposal', proposals().length === 1],
      ['work item awaiting_clarification', forecastWi().status === 'awaiting_clarification']]);
    await answer(src.id, 'new_total');
    const c = calcOf(src.id), p = proposals().find((p) => p.revision === 2);
    const adj = c ? c.cumRevenueCents - 50000000n : 0n;
    return [asked, checks("'new_total' -> 66.67% / +$166,667", [
      [`progress ${c?.progressBp} bp = 6667`, c?.progressBp === 6667], [`adjustment ${usd(adj)} = $166,667`, (adj + 50n) / 100n === 166667n],
      [`entry ${p ? entry(p.entryJson) : 'none'}`, !!p && entry(p.entryJson) === `Dr ContractAsset ${adj} / Cr Revenue ${adj}`]])];
  });
  await run('duplicate post refused', async () => {
    const p = proposals().find((p) => p.revision === 2)!;
    const a = await ok(controller.reducers.decide({ proposalId: p.id, revision: 2, decision: 'approve', reason: '' }));
    const first = await ok(controller.reducers.post({ proposalId: p.id, revision: 2, postingRef: 'BENCH-1' }));
    const dup = await ok(controller.reducers.post({ proposalId: p.id, revision: 2, postingRef: 'BENCH-2' }));
    return checks('duplicate post refused', [['approve + first post accepted', !a && !first], [`second post refused (${dup})`, dup.startsWith('duplicate_posting')],
      ['one posting for the proposal', [...db.posting.iter()].filter((x) => x.proposalId === p.id).length === 1]]);
  });
  await run('wrong-role approve; stale', async () => {
    await reset('B: wrong role + stale');
    await note('note', 'the new total remaining is $600,000');
    const p = await until('rev 2 proposal', () => proposals().find((p) => p.revision === 2), 10000);
    const role = await ok(accountant.reducers.decide({ proposalId: p.id, revision: 2, decision: 'approve', reason: '' }));
    const r1 = checks('wrong-role approve refused', [[`accountant decide refused (${role})`, role.startsWith('role')], ['proposal still open', db.proposal.id.find(p.id)?.status === 'open']]);
    await note('note', 'Crew on site, rain held us up Tuesday, morale is good.');
    const st = await ok(controller.reducers.decide({ proposalId: p.id, revision: 2, decision: 'approve', reason: '' }));
    return [r1, checks('stale after new source', [[`status ${db.proposal.id.find(p.id)?.status}`, db.proposal.id.find(p.id)?.status === 'stale'], [`approve refused (${st})`, st.startsWith('stale')]])];
  });
  await run('post after close refused', async () => {
    await reset('B: post after close');
    await note('note', 'the new total remaining is $600,000');
    const p = await until('rev 2 proposal', () => proposals().find((p) => p.revision === 2), 10000);
    const a = await ok(controller.reducers.decide({ proposalId: p.id, revision: 2, decision: 'approve', reason: '' }));
    await controller.reducers.closePeriod({ projectId: oak().id });
    const r = await ok(controller.reducers.post({ proposalId: p.id, revision: 2, postingRef: 'BENCH-CLOSED' }));
    return checks('post after close refused', [['approved', !a], [`post refused (${r})`, r.startsWith('period_closed')], ['no posting', ![...db.posting.iter()].some((x) => x.proposalId === p.id)]]);
  });
  await run('scanned sheet 420k', async () => {
    await reset('B: scanned 420k');
    const src = await note('scanned_forecast', await upload('forecast-600k-incurred-420k.jpg'));
    const x = [...db.extraction.iter()].find((e) => e.sourceId === src.id && e.reader === 'azure-di');
    const d = x && JSON.parse(x.factsJson).disagreement;
    const inp = calcOf(src.id) && JSON.parse(calcOf(src.id)!.inputsJson);
    return checks('scanned sheet 420k -> disagreement recorded, ledger trusted', [
      [`disagreement ${d ? `${d.document} vs ${d.ledger}, trusted ${d.trusted}` : 'none'}`, d?.document === '42000000' && d?.ledger === '40000000' && d?.trusted === 'cost_export'],
      [`calc incurred ${inp?.incurredCents} = 40000000`, inp?.incurredCents === '40000000'], [`progress ${calcOf(src.id)?.progressBp} = 4000`, calcOf(src.id)?.progressBp === 4000]]);
  });
  await run('zero-adjustment sheet; month-3', async () => {
    await reset('B: zero-adjustment + month 3');
    const s1 = await note('note', AMBIG);
    await answer(s1.id, 'additional');
    const p2 = await until('rev 2 proposal', () => proposals().find((p) => p.revision === 2), 10000);
    await controller.reducers.decide({ proposalId: p2.id, revision: 2, decision: 'approve', reason: '' });
    await controller.reducers.post({ proposalId: p2.id, revision: 2, postingRef: 'BENCH-R2' });
    const n = proposals().length;
    const s2 = await note('scanned_forecast', await upload('forecast-600k.jpg'));
    const z = checks('zero-adjustment sheet (600k after additional) -> calculation, no proposal', [
      [`calculation recorded (${calcOf(s2.id)?.progressBp} bp)`, calcOf(s2.id)?.progressBp === 4000], ['no new proposal', proposals().length === n],
      ['summo skip "no revenue change"', events().some((e) => e.kind === 'skip' && e.summary.startsWith('no revenue change'))]]);
    const refs = [...db.clarificationRef.iter()].length;
    const s3 = await note('note', 'another $50,000 for conveyor rework');
    const p3 = proposals().find((p) => db.calculation.id.find(p.calculationId)?.forecastSourceId === s3.id);
    return [z, checks('month-3 convention reuse (3810 bp, no question)', [[`progress ${calcOf(s3.id)?.progressBp} = 3810`, calcOf(s3.id)?.progressBp === 3810],
      ['no new clarification', [...db.clarificationRef.iter()].length === refs], ['proposal cites another_means', !!p3?.explanation.includes('another_means')]])];
  });
  await run('injection note', async () => {
    await reset('B: injection note');
    const refs = [...db.clarificationRef.iter()].length;
    const src = await note('note', INJECTION);
    const g = [...db.extraction.iter()].find((e) => e.sourceId === src.id && e.reader === 'guard');
    const evs = events().filter((e) => e.refTable === 'source' && e.refId === src.id).map((e) => `${e.agent} ${e.kind}`);
    return checks('injection note -> guard flags, no proposal, no question', [
      [`guard row ${g?.ambiguityText ?? 'none'}`, !!g && JSON.parse(g.factsJson).flagged === true],
      [`events ${evs.join(', ')}`, evs.join() === 'guard flag,summo skip'],
      ['no reader extraction', ![...db.extraction.iter()].some((e) => e.sourceId === src.id && e.reader !== 'guard')],
      ['no calculation', !calcOf(src.id)], ['no new proposal', proposals().length === 1], ['no question', [...db.clarificationRef.iter()].length === refs]]);
  });
  await run('unclear answer "sure"', async () => {
    await reset('B: unclear "sure"');
    const src = await note('note', AMBIG);
    const ref = await answer(src.id, 'sure');
    const row = ((await cvx.query(anyApi.clarifications.byWorkItem, { workItemId: String(ref.workItemId) })) as { _id: string; status: string }[]).find((r) => r._id === ref.convexId);
    return checks('unclear answer "sure" -> fallback_text, nothing confirmed', [[`convex status ${row?.status}`, row?.status === 'fallback_text'],
      [`clarification_ref ${refOf(src.id)?.status}`, refOf(src.id)?.status === 'open'], ['no calculation', !calcOf(src.id)]]);
  });
  return out;
}

// ---- C/D. latency + chain integrity from the captured agent_event rows ----
const CHAIN = /^(document-reader read,reconciler (disagree|reconcile),)?guard pass,reader-claude read,reader-gemini (read|skip),summo (agree|disagree),(field-liaison ask,field-liaison answer,|summo skip,)?engine compute,explainer explain,summo propose,reviewer (review|skip)$/;
const violations: string[] = [];
let chains = 0;
const tally: Record<string, number> = {};
function analyse({ name, evs, src }: (typeof captured)[number]) {
  let srcT = 0;
  evs.forEach((e, i) => {
    const prev = evs[i - 1];
    if (e.refTable === 'source' && src.has(e.refId)) srcT = src.get(e.refId)!;
    const k = `${e.agent} ${e.kind}`;
    if (e.agent.startsWith('reader') || e.agent === 'reviewer') tally[k] = (tally[k] ?? 0) + 1;
    if (k === 'reader-claude read' || k === 'reader-gemini read') push(k, e.at - srcT);
    if (k === 'field-liaison ask' && prev?.agent === 'summo') push('source → ask', e.at - srcT);
    if (k === 'field-liaison answer' && prev?.kind === 'ask') push('ask → answer row (bench confirms at once; incl. 1 s liaison poll)', e.at - prev.at);
    if (k === 'engine compute' && prev) push(prev.kind === 'answer' ? 'answer row → compute' : 'engine compute (after routing)', e.at - prev.at);
    if (k === 'explainer explain' && prev) push('explain (compute → explain)', e.at - prev.at);
    if (k === 'summo propose' && prev?.kind === 'explain') push('review (explain → propose: Gemini review + propose write)', e.at - prev.at);
    if (k === 'summo propose' && !e.summary.startsWith('milestone')) {
      const c = evs.slice(0, i).findLast((x) => x.agent === 'engine');
      if (c) push('compute → propose', e.at - c.at);
      chains++;
      let s = evs.slice(0, i + 1).findLastIndex((x) => x.agent === 'reader-claude' && x.kind === 'read');
      if (s >= 1 && evs[s - 1].agent === 'guard') s -= 1;
      if (s >= 2 && evs[s - 2].agent === 'document-reader') s -= 2;
      const got = evs.slice(s, i + 2).map((x) => `${x.agent} ${x.kind}`).join(',');
      if (s < 0 || !CHAIN.test(got)) violations.push(`${name}: ${got}`);
    }
  });
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil((p / 100) * xs.length) - 1)];

// ---- run ----
const aFails: string[] = [];
let aPass = 0;
const bRuns: B[][] = [];
let code = 0;
try {
  for (let r = 1; r <= RUNS; r++) {
    for (const [t, w] of PHRASES) {
      const bad = await readingCase(t, w).catch((e) => [`error: ${e?.message ?? e}`]);
      console.log(`${bad.length ? 'FAIL' : 'ok  '} A "${t}"${bad.length ? ` -> ${bad.join('; ')}` : ''}`);
      if (bad.length) aFails.push(`run ${r}: "${t}": ${bad.join('; ')}`); else aPass++;
    }
    const b = await plantedErrors();
    b.forEach((x) => console.log(`${x.pass ? 'ok  ' : 'FAIL'} B ${x.name}: ${x.detail}`));
    bRuns.push(b);
  }
  await reset(''); // captures the last case
} catch (e: any) { code = 1; console.error(e); }
stop();
captured.forEach(analyse);

// ---- report ----
const f2 = (x: number | undefined) => (x == null ? '-' : x.toFixed(2));
const latRows = Object.entries(lat).map(([k, xs]) => `| ${k} | ${xs.length} | ${f2(pct(xs, 50))} | ${f2(pct(xs, 95))} |`);
const bNames = bRuns[0]?.map((x) => x.name) ?? [];
const bRows = bNames.map((n) => {
  const xs = bRuns.map((b) => b.find((x) => x.name === n)!);
  return `| ${n} | ${xs.filter((x) => x.pass).length}/${xs.length} | ${xs.at(-1)!.detail.replace(/\|/g, '/')} |`;
});
const total = PHRASES.length * RUNS;
const md = `# Internal benchmark: Summo multi-agent loop

Generated ${startedAt.toISOString()} by \`pnpm bench --db ${DB} --runs ${RUNS}\`.

**Stack.** Local SpacetimeDB (\`${URI}\`, scratch db \`${DB}\`), Convex \`${process.env.CONVEX_URL}\`, agent loop in-process (same wiring as \`pnpm agent\`).
Models: Claude ${hasKey ? 'REAL' : 'MOCK'} (claude-opus-5-5, reader + explainer), Gemini ${hasGeminiKey ? 'REAL' : 'OFF'} (second reader + reviewer), Azure Document Intelligence (scanned sheets). N = ${RUNS} run(s).

## A. Reading accuracy: ${aPass}/${total}

Each of the ${PHRASES.length} field-note phrasings (\`apps/agent/src/bench-cases.ts\`) on a fresh S0 (incurred $400,000, remaining $400,000).
Pass = Claude's extraction has the expected fact kind, the system asked exactly when the answer key says the note is ambiguous, and
the resulting remaining forecast is right (direction and amount; questions answered "additional"; no calculation where none is expected).

${aFails.length ? aFails.map((f) => `- ${f}`).join('\n') : 'No failures.'}

## B. Planted errors

| check | pass | detail (last run) |
|---|---|---|
${bRows.join('\n')}

## C. Latency per agent (seconds, from \`agent_event.at\` and \`source.createdAt\`)

| step | n | p50 | p95 |
|---|---|---|---|
${latRows.join('\n')}

Both reader rows are written after both readers return (Claude and Gemini run in parallel, Gemini capped at 5 s), so the two reader
rows measure source → both reads, not each model alone. "ask → answer" is not agent time: the bench confirms immediately, so it is the
Convex round trip plus the 1 s liaison poll; with a real person it is however long they take to pick up. The hero metric is
**confirm → compute** (p50 ${f2(pct(lat['confirm → compute (time-to-numbers)'] ?? [], 50))} s, p95 ${f2(pct(lat['confirm → compute (time-to-numbers)'] ?? [], 95))} s):
from the Convex confirm call to the calculation row, i.e. the liaison poll plus resolve and the deterministic engine; the
explanation and proposal follow (compute → propose). Second-model availability this run: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}
(Gemini skips are timeouts or free-tier 429s; the flow continues on Claude alone, by design).

## D. Chain integrity: ${violations.length} violation(s) in ${chains} forecast proposal(s)

Expected per proposal: \`[document-reader read, reconciler] → guard pass → reader-claude read → reader-gemini read|skip → summo agree|disagree →
[field-liaison ask → answer | summo skip (convention)] → engine compute → explainer explain → summo propose → reviewer review|skip\`.
${violations.map((v) => `- ${v}`).join('\n')}

## Notes

- There is no public benchmark for this task (field-note forecast updates under ASC 606 cost-to-cost). These cases are our own answer key, written alongside the code, so they test regressions, not general ability.
- Simulated: the site lead (the bench confirms answers through the Convex mutation the voice flow calls, no phone audio), the controller and accountant (reducer calls with demo identities), and the source documents (the 20 phrasings and generated forecast sheets). Real: Claude, Gemini, Azure DI, Convex, SpacetimeDB.
- Latency is wall-clock on one laptop against hosted model APIs; expect run-to-run variance. With N = 1, p95 is close to the max.
- Regenerate: \`spacetime publish ${DB} --server local --yes --module-path spacetimedb\` (once), then \`pnpm bench --db ${DB} --runs ${RUNS}\`, then \`STDB_DB=${DB} pnpm demo --reset-only\`.
`;
fs.mkdirSync(new URL('docs/', root), { recursive: true });
fs.writeFileSync(new URL('docs/benchmark.md', root), md);
console.log('\n' + md.split('\n## Notes')[0]);
conns.forEach((c) => c.disconnect());
process.exit(code); // ponytail: abandons any in-flight agent chain, as the demo does
