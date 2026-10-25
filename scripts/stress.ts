// Stress workflow for the RoboAudit/Summo loop: hostile inputs, races, resets and restarts against a LOCAL scratch ledger.
// Usage: pnpm stress [--db keel-stress] [--rounds 1] [--convex URL] [--ids demo/identities.local.json]. Publishes the module to the scratch db (data wiped), real Convex + model keys
// from .env, agent loop in-process. Writes docs/stress.md and logs/stress-<ts>.jsonl (the agent's file log for this run).
// Afterwards: STDB_DB=keel-stress pnpm demo --reset-only
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { DbConnection } from '@keel/ledger-client';
import { hasKey } from '../apps/agent/src/claude.ts';
import { hasGeminiKey } from '../apps/agent/src/gemini.ts';
import { isAzureDiReal } from '../apps/agent/src/azure-di.ts';
import { agentDeps, isSeed } from '../apps/agent/src/ledger-adapter.ts';
import { startLoop } from '../apps/agent/src/loop.ts';
import { appendLog, errCode, startFileLog } from '../apps/agent/src/logfile.ts';
import { INJECTION } from '../apps/agent/src/bench-cases.ts';

const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DB = opt('--db', 'keel-stress'), ROUNDS = Number(opt('--rounds', '1')), URI = 'ws://127.0.0.1:3000';
if (DB === 'keel' || !ROUNDS) throw new Error('--db must be a scratch db (not keel); --rounds >= 1');
if (args.includes('--convex')) process.env.CONVEX_URL = opt('--convex', ''); // e.g. a dev deployment when prod Convex can't take confirms
for (const f of ['.env', '.env.local']) { // .env (prod Convex) wins, per the stress brief
  try { const m = fs.readFileSync(new URL(f, root), 'utf8').match(/^CONVEX_URL\s*=\s*(\S+)/m); if (m) process.env.CONVEX_URL ??= m[1]; } catch {}
}
if (!process.env.CONVEX_URL) throw new Error('CONVEX_URL unset');
const out = (s: string) => process.stdout.write(s + '\n'); // not mirrored into the agent log on purpose

const pub = spawnSync('spacetime', ['publish', DB, '--server', 'local', '--yes', '--delete-data=always', '--module-path', 'spacetimedb'], { cwd: fileURLToPath(root), encoding: 'utf8' });
if (pub.status !== 0) throw new Error(`spacetime publish ${DB} failed:\n${pub.stderr}`);
out(`published module to local/${DB}`);

const startedAt = new Date();
const LOG = fileURLToPath(new URL(`logs/stress-${startedAt.toISOString().replace(/[:.]/g, '-')}.jsonl`, root));
const on = (b: boolean) => (b ? 'REAL' : 'OFF');
startFileLog({ ledger: `${URI}/${DB}`, convex: process.env.CONVEX_URL, readers: { claude: on(hasKey), gemini: on(hasGeminiKey), azure_di: on(isAzureDiReal) } }, LOG);
const logLines = () => fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);

// ---- helpers (bench.ts and demo.ts run on import, so these few are copied, not imported) ----
async function until<T>(what: string, f: () => T | undefined | false | null | Promise<T | undefined | false | null>, ms = 120000): Promise<T> {
  for (const deadline = Date.now() + ms; ; await new Promise((r) => setTimeout(r, 100))) {
    const v = await f();
    if (v !== undefined && v !== null && v !== false) return v as T;
    if (Date.now() > deadline) throw new Error(`timed out after ${ms / 1000}s waiting for: ${what}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cvx = new ConvexHttpClient(process.env.CONVEX_URL);
let anon = 'ok';
try { const r: any = await cvx.action(anyApi.auth.signIn, { provider: 'anonymous' }); cvx.setAuth(r.tokens.token); } // Convex Auth for confirm
catch (e: any) { anon = `unavailable (${String(e?.message ?? e).slice(0, 60)}); continuing without a session`; out(`convex anonymous sign-in ${anon}`); }
// ponytail: own connect instead of connectAs, which reads/writes demo/identities.json, a file other sessions swap between
// local and Maincloud tokens. Stress reads local tokens from --ids (default demo/identities.local.json) and never writes them.
const IDS = JSON.parse(fs.readFileSync(new URL(opt('--ids', fs.existsSync(new URL('demo/identities.local.json', root)) ? 'demo/identities.local.json' : 'demo/identities.json'), root), 'utf8')) as Record<string, string>;
const NAMES: Record<string, string> = { accountant: 'Priya', controller: 'Dana', agent: 'Summo' };
async function connectAs(role: 'controller' | 'accountant' | 'agent') {
  const c = await new Promise<DbConnection>((res, rej) => DbConnection.builder().withUri(URI).withDatabaseName(DB).withToken(IDS[role])
    .onConnect((x) => res(x)).onConnectError((_x, e) => rej(e)).build());
  await new Promise<void>((res, rej) => c.subscriptionBuilder().onApplied(() => res()).onError((x) => rej((x as any).event ?? new Error('subscribe failed'))).subscribeToAllTables());
  const me = c.db.user.identity.find(c.identity!);
  if (!me || me.role !== role) await c.reducers.registerDemoUser({ name: NAMES[role], role });
  return c;
}
const controller = await connectAs('controller'), accountant = await connectAs('accountant');
let agent = await connectAs('agent');
let stop = startLoop(agentDeps(agent, cvx), { isSeed });
const db = controller.db;
out(`stress: stdb ${URI}/${DB}, convex ${process.env.CONVEX_URL}, claude=${on(hasKey)} gemini=${on(hasGeminiKey)} azure_di=${on(isAzureDiReal)}, rounds=${ROUNDS}, log ${LOG}`);

type Ev = { id: bigint; agent: string; kind: string; summary: string; refTable: string; refId: bigint };
const events = (): Ev[] => [...db.agentEvent.iter()].sort((a, b) => (a.id < b.id ? -1 : 1));
const oak = () => [...db.project.iter()].find((p) => p.name === 'Oakland deployment')!;
const wi = () => [...db.workItem.iter()].find((w) => w.projectId === oak().id && !w.title.startsWith('Milestone'))!;
const proposals = () => [...db.proposal.iter()].filter((p) => p.workItemId === wi().id);
const calcsOf = (srcId: bigint) => [...db.calculation.iter()].filter((c) => c.forecastSourceId === srcId);
const refsOf = (srcId: bigint) => [...db.clarificationRef.iter()].filter((c) => c.sourceId === srcId);
const remainingOf = (srcId: bigint) => { const c = calcsOf(srcId).at(-1); return c ? BigInt(JSON.parse(c.inputsJson).remainingCents) : undefined; };
const propsFrom = (srcId: bigint) => proposals().filter((p) => db.calculation.id.find(p.calculationId)?.forecastSourceId === srcId);
const errorsNow = () => events().filter((e) => e.kind === 'error');
const refusals: Record<string, number> = {};
/** '' = accepted, else the refusal message; every refusal is tallied by SenderError code. */
const ok = <T>(p: Promise<T>) => p.then(() => '', (e: any) => {
  const m = String(e?.message ?? e);
  const c = errCode(m) ?? 'other';
  refusals[c] = (refusals[c] ?? 0) + 1;
  return m;
});
const confirm = (id: string, answer: string, speaker: string) => cvx.mutation(anyApi.clarifications.confirm, { id, answer, speaker });

const evCounts: Record<string, number> = {};
const tallyEvents = () => events().forEach((e) => { const k = `${e.agent} ${e.kind}`; evCounts[k] = (evCounts[k] ?? 0) + 1; });
async function reset() {
  tallyEvents(); // reset_demo wipes agent_event, so count what this scenario produced first
  await controller.reducers.resetDemo({});
  await cvx.mutation(anyApi.clarifications.resetOpen, {});
  for (const c of [controller, accountant, agent]) await until('S0 visible', () => [...c.db.proposal.iter()].length === 1 && [...c.db.agentEvent.iter()].length === 0, 10000);
}
async function add(text: string, kind = 'note') {
  await accountant.reducers.addSource({ projectId: oak().id, kind, text, parentSourceId: 0n, version: 1 });
  return until('source row', () => [...db.source.iter()].filter((s) => s.text === text).sort((a, b) => (a.id < b.id ? 1 : -1))[0], 10000);
}
/** A source reached a terminal state: proposed/skipped on its calculation, else asked, skipped (incl. guard flag), or given up (3 errors). */
function doneSrc(id: bigint) {
  const evs = events(), calc = calcsOf(id).at(-1);
  if (calc) return evs.some((e) => e.agent === 'summo' && e.refTable === 'calculation' && e.refId === calc.id); // asked and answered: wait for the proposal
  return refsOf(id).length > 0 || evs.some((e) => e.agent === 'summo' && e.kind === 'skip' && e.refTable === 'source' && e.refId === id)
    || evs.filter((e) => e.agent === 'summo' && e.kind === 'error' && e.refId === id).length >= 3;
}
/** Every listed source is terminal and no agent_event has landed for `ms` (reviewer, ask rows). */
async function quiet(ids: bigint[], ms = 3000, max = 300000) {
  let n = -1, last = Date.now();
  await until('agent idle', () => {
    const k = events().length;
    if (k !== n) { n = k; last = Date.now(); }
    return ids.every(doneSrc) && Date.now() - last > ms;
  }, max);
}
const openRef = (srcId: bigint) => until(`open clarification for source ${srcId}`, () => refsOf(srcId).find((r) => r.status === 'open'));
/** Fresh calculation + proposal written directly as the agent (no model): for checks that need a proposal with a chosen entry. */
async function manualProposal(entryJson: string) {
  const maxCalc = [...db.calculation.iter()].reduce((m, c) => (c.id > m ? c.id : m), 0n);
  await agent.reducers.recordCalculation({ workItemId: wi().id, forecastSourceId: 0n, inputsJson: '{}', progressBp: 5000, cumRevenueCents: 50000000n, contractAssetCents: 0n, marginCents: 0n, lossWarning: false });
  const c = await until('manual calculation', () => [...db.calculation.iter()].find((x) => x.id > maxCalc), 10000);
  await agent.reducers.propose({ workItemId: wi().id, calculationId: c.id, entryJson, explanation: 'stress: manual proposal', evidenceSourceIdsCsv: '', pendingConventionJson: '' });
  return until('manual proposal', () => proposals().find((p) => p.calculationId === c.id), 10000);
}
const approve = (p: { id: bigint; revision: number }) => ok(controller.reducers.decide({ proposalId: p.id, revision: p.revision, decision: 'approve', reason: '' }));
const post = (c: DbConnection, p: { id: bigint; revision: number }, ref: string) => ok(c.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: ref }));
const postingsOf = (id: bigint) => [...db.posting.iter()].filter((x) => x.proposalId === id);

// Chain per forecast proposal (as bench.ts D): [convention skip | ask, answer] between agree and compute.
const CHAIN = /^(document-reader read,reconciler (disagree|reconcile),)?guard pass,reader-claude read,reader-gemini (read|skip),summo (agree|disagree),(field-liaison ask,field-liaison answer,|summo skip,)?engine compute,explainer explain,summo propose,reviewer (review|skip)$/;
function chainViolations() {
  const evs = events(), bad: string[] = [];
  evs.forEach((e, i) => {
    if (!(e.agent === 'summo' && e.kind === 'propose' && !e.summary.startsWith('milestone'))) return;
    let s = evs.slice(0, i + 1).findLastIndex((x) => x.agent === 'reader-claude' && x.kind === 'read');
    if (s >= 1 && evs[s - 1].agent === 'guard') s -= 1;
    const got = evs.slice(s, i + 2).map((x) => `${x.agent} ${x.kind}`).join(',');
    if (s < 0 || !CHAIN.test(got)) bad.push(got);
  });
  return bad;
}

// ---- scenarios ----
const AMBIG = 'we need another $200,000 to finish';
const CHATTER = 'Crew on site, rain held us up Tuesday, morale is good.';
const UNBAL = '[{"account":"Revenue","debit":"10000000","credit":"0"},{"account":"ContractAsset","debit":"0","credit":"9999900"}]';
const NEG = '[{"account":"Revenue","debit":"-10000000","credit":"0"},{"account":"ContractAsset","debit":"0","credit":"-10000000"}]';
const BAL = '[{"account":"ContractAsset","debit":"100","credit":"0"},{"account":"Revenue","debit":"0","credit":"100"}]';
type Check = [string, boolean];
type Scenario = { id: string; what: string; expected: string; run: () => Promise<Check[]> };

const SCENARIOS: Scenario[] = [
  { id: 'a', what: 'Unbalanced entry, then a negative line', expected: 'post refused `unbalanced`, then `bad_input`; no posting', run: async () => {
    const seeded = proposals()[0];
    const noop = await ok(agent.reducers.propose({ workItemId: wi().id, calculationId: seeded.calculationId, entryJson: UNBAL, explanation: 'stress: unbalanced', evidenceSourceIdsCsv: '', pendingConventionJson: '' }));
    await sleep(300);
    const after = proposals().length;
    const p = await manualProposal(UNBAL);
    const d = await approve(p), r = await post(controller, p, 'STRESS-UNBAL');
    const q = await manualProposal(NEG);
    const d2 = await approve(q), r2 = await post(controller, q, 'STRESS-NEG');
    return [[`propose on the seeded calculation is an idempotent no-op (${noop || 'accepted'}, proposals still ${after})`, !noop && after === 1],
      [`unbalanced: approve ok, post refused (${r.slice(0, 60)})`, !d && r.startsWith('unbalanced')], ['no posting for the unbalanced proposal', postingsOf(p.id).length === 0],
      [`negative line: approve ok, post refused (${r2.slice(0, 40)})`, !d2 && r2.startsWith('bad_input')], ['no posting for the negative proposal', postingsOf(q.id).length === 0]];
  } },
  { id: 'b', what: 'Rapid fire: 5 notes in < 1 s (valid, additive, savings, injection, chatter)', expected: 'all handled; one ask per ambiguous note; guard flags injection; no errors; chain intact', run: async () => {
    const notes: [string, string][] = [['valid', 'the new total remaining is $600,000'], ['additive', AMBIG], ['savings', 'we found savings, finishing should cost 50k less'], ['injection', INJECTION], ['chatter', CHATTER]];
    const t = Date.now();
    await Promise.all(notes.map(([, x]) => accountant.reducers.addSource({ projectId: oak().id, kind: 'note', text: x, parentSourceId: 0n, version: 1 })));
    const fired = Date.now() - t;
    const srcs = await Promise.all(notes.map(([, x]) => until('source', () => [...db.source.iter()].find((s) => s.text === x), 10000)));
    await quiet(srcs.map((s) => s.id));
    const flagged = (id: bigint) => [...db.extraction.iter()].some((e) => e.sourceId === id && e.reader === 'claude' && e.ambiguityFlag);
    const asks = srcs.map((s, i) => `${notes[i][0]}:${refsOf(s.id).length}${flagged(s.id) ? '*' : ''}`).join(' ');
    const g = [...db.extraction.iter()].find((e) => e.sourceId === srcs[3].id && e.reader === 'guard');
    const v = chainViolations();
    return [[`5 notes sent in ${fired} ms`, fired < 1000], ['every note reached a terminal state', srcs.every((s) => doneSrc(s.id))],
      [`asks per note ${asks} (* = flagged ambiguous)`, srcs.every((s) => refsOf(s.id).length === (flagged(s.id) ? 1 : 0)) && refsOf(srcs[1].id).length === 1],
      [`guard flagged the injection (${g?.ambiguityText ?? 'no guard row'})`, !!g && JSON.parse(g.factsJson).flagged === true],
      ['no calculation from injection or chatter', !calcsOf(srcs[3].id).length && !calcsOf(srcs[4].id).length],
      [`no summo error events (${errorsNow().length})`, errorsNow().length === 0], [`chain integrity (${v.length} violations${v.length ? `: ${v.join(' | ')}` : ''})`, v.length === 0]];
  } },
  { id: 'c', what: 'Double confirm race: same clarification, two answers at once', expected: 'one calculation and one proposal; first committed answer wins', run: async () => {
    const src = await add(AMBIG), ref = await openRef(src.id);
    const rs = await Promise.allSettled([confirm(ref.convexId, 'additional', 'Racer A'), confirm(ref.convexId, 'new_total', 'Racer B')]);
    const rejected = rs.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (rejected) throw new Error(`confirm rejected: ${String(rejected.reason?.message ?? rejected.reason).slice(0, 80)}`);
    const row = ((await cvx.query(anyApi.clarifications.byWorkItem, { workItemId: String(ref.workItemId) })) as { _id: string; answer?: string; speaker?: string }[]).find((r) => r._id === ref.convexId);
    await until('calculation', () => calcsOf(src.id).length > 0);
    await quiet([src.id]);
    const led = db.clarificationRef.id.find(ref.id);
    return [[`both confirm calls returned (${rs.map((r) => r.status).join(', ')})`, rs.every((r) => r.status === 'fulfilled')],
      [`Convex kept ${row?.speaker}: ${row?.answer}; ledger ${led?.speaker}: ${led?.answer}`, !!row?.answer && led?.answer === row.answer && led?.speaker === row.speaker],
      [`calculations for the note: ${calcsOf(src.id).length}`, calcsOf(src.id).length === 1], [`proposals from the note: ${propsFrom(src.id).length}`, propsFrom(src.id).length === 1],
      [`no summo error events (${errorsNow().length})`, errorsNow().length === 0]];
  } },
  { id: 'd', what: 'Reset mid-flight: ask open, reset_demo + resetOpen, same note again', expected: 'loop recovers; new ask on the new source; nothing done for the old one', run: async () => {
    const s1 = await add(AMBIG), r1 = await openRef(s1.id);
    await until('ask event', () => events().some((e) => e.kind === 'ask'));
    await reset();
    const s2 = await add(AMBIG); // same text, new id: the loop's seen-key must not swallow it
    const r2 = await openRef(s2.id);
    await quiet([s2.id]);
    const active = (await cvx.query(anyApi.clarifications.active, {})) as { _id: string } | null;
    return [[`new source id ${s2.id} != old ${s1.id}`, s2.id !== s1.id], [`new ask on source ${s2.id}`, refsOf(s2.id).length === 1],
      [`old clarification gone from the ledger (${refsOf(s1.id).length} rows) and not ringing`, refsOf(s1.id).length === 0 && active?._id !== r1.convexId],
      [`Convex active clarification is the new one`, active?._id === r2.convexId], ['no calculation for either note', !calcsOf(s1.id).length && !calcsOf(s2.id).length],
      [`no summo error events (${errorsNow().length})`, errorsNow().length === 0]];
  } },
  { id: 'e', what: 'Giant note: 5,000 chars with "the new total remaining is $600,000" buried mid-way', expected: 'read correctly (remaining $600,000) or asked; no error', run: async () => {
    const pad = 'Safety briefing done, forklift inspection passed, tote racks labelled, crew lunch at noon. ';
    const fill = (n: number) => pad.repeat(Math.ceil(n / pad.length)).slice(0, n);
    const mid = ' Update for accounting: the new total remaining is $600,000. ';
    const text = fill(2500 - mid.length) + mid + fill(2500);
    const src = await add(text);
    await quiet([src.id]);
    const rem = remainingOf(src.id), asked = refsOf(src.id).length;
    return [[`note length ${text.length}`, text.length === 5000], [`outcome: ${rem != null ? `remaining $${rem / 100n}` : asked ? 'asked' : 'neither'}`, rem === 60000000n || asked === 1],
      [`no summo error events (${errorsNow().length})`, errorsNow().length === 0]];
  } },
  { id: 'f', what: 'Wrong-role spree', expected: 'accountant decide/post/closePeriod/saveConvention and agent post all refused `role`', run: async () => {
    const p = proposals()[0];
    const rs = {
      'accountant decide': await ok(accountant.reducers.decide({ proposalId: p.id, revision: p.revision, decision: 'approve', reason: '' })),
      'accountant post': await post(accountant, p, 'STRESS-ROLE-A'),
      'accountant closePeriod': await ok(accountant.reducers.closePeriod({ projectId: oak().id })),
      'accountant saveConvention': await ok(accountant.reducers.saveConvention({ template: 'forecast', key: 'another_means', value: 'new_total', exampleSourceIdsCsv: '', policyVersion: 1 })),
      'agent post': await post(agent, p, 'STRESS-ROLE-G'),
    };
    return [...Object.entries(rs).map(([k, v]): Check => [`${k}: ${v.slice(0, 50) || 'ACCEPTED'}`, v.startsWith('role')]),
      ['period still open, no new convention', oak().periodOpen && ![...db.convention.iter()].some((c) => c.key === 'another_means')]];
  } },
  { id: 'g', what: 'Duplicate storm: 3 concurrent posts, same ref', expected: 'one posting, two `duplicate_posting`', run: async () => {
    const p = await manualProposal(BAL);
    const d = await approve(p);
    const rs = await Promise.all([1, 2, 3].map(() => post(controller, p, 'STRESS-DUP')));
    await sleep(300);
    return [['approved', !d], [`results: ${rs.map((r) => r.split(':')[0] || 'posted').join(', ')}`, rs.filter((r) => !r).length === 1 && rs.filter((r) => r.startsWith('duplicate_posting')).length === 2],
      [`postings for the proposal: ${postingsOf(p.id).length}`, postingsOf(p.id).length === 1]];
  } },
  { id: 'h', what: 'Agent restart: kill the loop after the ask, confirm while down, start a new loop', expected: 'answer still processed after restart (one calculation, one proposal)', run: async () => {
    const src = await add(AMBIG), ref = await openRef(src.id);
    await until('ask event', () => events().some((e) => e.kind === 'ask'));
    stop(); agent.disconnect();
    let whileDown = -1;
    try {
      await confirm(ref.convexId, 'additional', 'Restart');
      await sleep(3000);
      whileDown = calcsOf(src.id).length;
    } finally { // always bring the agent back, or every later reset waits on a dead connection
      agent = await connectAs('agent');
      stop = startLoop(agentDeps(agent, cvx), { isSeed });
    }
    await until('calculation after restart', () => calcsOf(src.id).length > 0);
    await quiet([src.id]);
    const led = db.clarificationRef.id.find(ref.id);
    return [[`no calculation while the agent was down (${whileDown})`, whileDown === 0], [`clarification ${led?.status}: ${led?.answer}`, led?.status === 'confirmed' && led.answer === 'additional'],
      [`calculations ${calcsOf(src.id).length}, proposals ${propsFrom(src.id).length}`, calcsOf(src.id).length === 1 && propsFrom(src.id).length === 1],
      ['field-liaison answer event after restart', events().some((e) => e.agent === 'field-liaison' && e.kind === 'answer')], [`no summo error events (${errorsNow().length})`, errorsNow().length === 0]];
  } },
];

// ---- run ----
type Result = { id: string; round: number; checks: Check[]; pass: boolean; secs: number; lines: string[] };
const results: Result[] = [];
let code = 0;
try {
  for (let round = 1; round <= ROUNDS; round++) {
    for (const s of SCENARIOS) {
      await reset();
      const n0 = logLines().length, t = Date.now();
      appendLog({ level: 'info', agent: 'stress', kind: 'scenario', summary: `round ${round} scenario ${s.id} start: ${s.what}` });
      const checks = await s.run().catch((e: any): Check[] => [[`threw: ${e?.message ?? e}`, false]]);
      const pass = checks.every(([, v]) => v), secs = (Date.now() - t) / 1000;
      appendLog({ level: pass ? 'info' : 'error', agent: 'stress', kind: 'scenario', summary: `round ${round} scenario ${s.id} ${pass ? 'PASS' : 'FAIL'} in ${secs.toFixed(1)} s` });
      results.push({ id: s.id, round, checks, pass, secs, lines: logLines().slice(n0) });
      out(`${pass ? 'PASS' : 'FAIL'} r${round} ${s.id} ${s.what} (${secs.toFixed(1)} s)`);
      checks.forEach(([k, v]) => out(`     ${v ? 'ok  ' : 'FAIL'} ${k}`));
    }
  }
  await reset(); // tallies the last scenario's events
} catch (e: any) { code = 1; out(`stress aborted: ${e?.stack ?? e}`); }
stop();
await cvx.mutation(anyApi.clarifications.resetOpen, {}).catch(() => {}); // nothing left ringing on the shared phone

// ---- report ----
const all = logLines().map((l) => JSON.parse(l) as { level: string; agent: string; kind: string });
const byLevel = (lv: string) => all.filter((l) => l.level === lv).length;
const lineKinds = (ls: string[]) => {
  const k: Record<string, number> = {};
  ls.map((l) => JSON.parse(l)).filter((l) => l.agent !== 'stress').forEach((l) => { const key = `${l.agent}/${l.kind}${l.level !== 'info' ? `(${l.level})` : ''}`; k[key] = (k[key] ?? 0) + 1; });
  return Object.entries(k).map(([a, b]) => `${a} ${b}`).join(', ') || 'none';
};
const cell = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');
const passed = SCENARIOS.filter((s) => results.filter((r) => r.id === s.id).every((r) => r.pass)).length;
const rows = SCENARIOS.map((s) => {
  const rs = results.filter((r) => r.id === s.id), last = rs.at(-1);
  const obs = last ? last.checks.map(([k, v]) => `${v ? '' : '**FAIL** '}${k}`).join('; ') : 'not run';
  return `| ${s.id} | ${cell(s.what)} | ${cell(s.expected)} | ${cell(obs)} | ${rs.filter((r) => r.pass).length}/${rs.length} | ${last ? last.secs.toFixed(1) : '-'} s |`;
});
const logRows = results.map((r) => `| ${r.id} (r${r.round}) | ${r.lines.length} | ${cell(lineKinds(r.lines))} |`);
const evRows = Object.entries(evCounts).sort().map(([k, v]) => `| ${k.replace(' ', ' | ')} | ${v} |`);
const refRows = Object.entries(refusals).sort().map(([k, v]) => `| ${k} | ${v} |`);
const fails = results.filter((r) => !r.pass).map((r) => `- ${r.id} (round ${r.round}): ${r.checks.filter(([, v]) => !v).map(([k]) => k).join('; ')}`);
const md = `# Stress run: Summo multi-agent loop

Generated ${startedAt.toISOString()} by \`pnpm stress ${args.join(' ') || `--db ${DB} --rounds ${ROUNDS}`}\`. Result: **${passed}/${SCENARIOS.length} scenarios passed**${ROUNDS > 1 ? ' in every round' : ''}.

**Stack.** Local SpacetimeDB \`${URI}\`, scratch db \`${DB}\` (published fresh, data wiped), Convex \`${process.env.CONVEX_URL}\`, agent loop in-process
(same wiring as \`pnpm agent\`). Models: Claude ${on(hasKey)}, Gemini ${on(hasGeminiKey)}, Azure DI ${on(isAzureDiReal)}. Every scenario starts from \`reset_demo\` (S0) + Convex \`resetOpen\`. Convex anonymous sign-in: ${anon}.

**Log of this run:** \`${LOG.replace(fileURLToPath(root), '')}\` (${all.length} lines; ${byLevel('error')} error, ${byLevel('warn')} warn). Read it with
\`pnpm logs --file ${LOG.replace(fileURLToPath(root), '')}\`; each scenario is bracketed by \`stress/scenario\` lines.

## Scenarios

| # | what | expected | observed (last round) | pass | time |
|---|---|---|---|---|---|
${rows.join('\n')}

${fails.length ? `### Failures\n\n${fails.join('\n')}\n` : 'No failures.\n'}
## Log lines per scenario (agent JSONL, excluding the stress brackets)

| scenario | lines | agent/kind |
|---|---|---|
${logRows.join('\n')}

## Refusals by code (reducer calls the stress driver made that the ledger refused)

| code | count |
|---|---|
${refRows.join('\n')}

## agent_event rows by agent and kind (all scenarios)

| agent | kind | count |
|---|---|---|
${evRows.join('\n')}

## Notes

- Scenario a: \`propose\` with the seeded calculation id is a silent no-op (the reducer is idempotent per calculation and the S0 proposal already uses it), so the driver records a fresh calculation as the agent and proposes on that. Same for g. These proposals bypass the models on purpose: the point is the ledger's checks, not the reading.
- Scenario c: Convex mutations are serialized, so "first" means first committed; which racer wins varies run to run. The check is that the ledger answer matches the one Convex kept and that exactly one calculation and proposal follow.
- Scenario d re-adds the same note text after the reset; source ids are not reused by \`reset_demo\` (autoinc keeps counting), so the loop's id+text seen-key does not swallow it.
- Scenario h stops the loop and disconnects the agent connection (an in-process stand-in for killing \`pnpm agent\`); the confirm lands while nothing is polling, and the new loop finds it through \`pollConfirmed\`.
- Convex is the shared deployment from \`.env\`: stress clarifications briefly appear there (keyed by scratch-db work item ids) and are closed with \`resetOpen\` at every reset and at the end. Run it when nobody is on the phone page.
- Simulated: the site lead (Convex \`confirm\`), controller and accountant (reducer calls with demo identities). Real: Claude, Gemini, Azure DI, Convex, SpacetimeDB. Model output varies run to run; one round is a smoke test, not a rate.
- Regenerate: \`pnpm stress --db ${DB} --rounds ${ROUNDS}\`, then \`STDB_DB=${DB} pnpm demo --reset-only\`.
`;
fs.writeFileSync(new URL('docs/stress.md', root), md);
out(`\n${passed}/${SCENARIOS.length} scenarios passed; log ${LOG} (${all.length} lines); wrote docs/stress.md`);
[controller, accountant, agent].forEach((c) => c.disconnect());
process.exit(code || (passed === SCENARIOS.length ? 0 : 1)); // ponytail: abandons any in-flight agent chain, as bench/demo do
