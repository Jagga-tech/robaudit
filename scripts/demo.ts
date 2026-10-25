// End-to-end judge demo against the live backend (SpacetimeDB keel + local Convex), asserting the answer key.
// Usage: pnpm demo [--reset-only] [--require-real]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { connectAs, type DbConnection } from '@keel/ledger-client';
import { hasKey } from '../apps/agent/src/claude.ts';
import { extract } from '../apps/agent/src/extract.ts';
import { explain } from '../apps/agent/src/explain.ts';
import { startLoop, type Deps, type Ledger, type SourceRow } from '../apps/agent/src/loop.ts';

const root = new URL('../', import.meta.url);
for (const f of ['.env.local', '.env']) {
  try {
    const m = fs.readFileSync(new URL(f, root), 'utf8').match(/^CONVEX_URL\s*=\s*(\S+)/m);
    if (m) process.env.CONVEX_URL ??= m[1];
  } catch {}
}
if (!process.env.CONVEX_URL) throw new Error('CONVEX_URL unset (run `npx convex dev`)');
const args = process.argv.slice(2);
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(2);
const beats: [string, string][] = [];
const beat = (name: string) => { const s = secs(); beats.push([name, s]); console.log(`[+${s}s] beat ${name}`); };

class Mismatch extends Error {}
function eq(what: string, actual: unknown, expected: unknown) {
  if (String(actual) !== String(expected)) throw new Mismatch(`${what}\n  expected: ${expected}\n  actual:   ${actual}`);
}
function ok(what: string, cond: unknown) { if (!cond) throw new Mismatch(`${what}: expected true`); }
async function until<T>(what: string, f: () => T | undefined | Promise<T | undefined>, ms = 15000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v !== undefined && v !== null && v !== false) return v;
    if (Date.now() > deadline) throw new Mismatch(`timed out after ${ms / 1000}s waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
const entry = (json: string) => (JSON.parse(json) as { account: string; debit: string; credit: string }[])
  .map((l) => (l.debit !== '0' ? `Dr ${l.account} ${l.debit}` : `Cr ${l.account} ${l.credit}`))
  .sort().reverse().join(' / '); // ponytail: "Dr" sorts after "Cr", reverse puts debits first

const controller = await connectAs('controller');
const conns: DbConnection[] = [controller];
let stop = () => {};
let code = 0;
try {
  const db = controller.db;
  const oakland = () => [...db.project.iter()].find((p) => p.name === 'Oakland deployment')!;
  const reset = async () => {
    await controller.reducers.resetDemo({});
    const p = oakland();
    const items = [...db.workItem.iter()].filter((w) => w.projectId === p.id);
    eq('S0 work items', items.length, 1);
    const props = [...db.proposal.iter()].filter((x) => x.workItemId === items[0].id);
    eq('S0 proposals', props.length, 1);
    eq('S0 proposal status', props[0].status, 'posted');
    eq('S0 calculation progressBp', db.calculation.id.find(props[0].calculationId)?.progressBp, 5000);
    return items[0].id;
  };

  // 0. mode check (before any reset)
  const cvxEnv = spawnSync('npx', ['convex', 'env', 'list'], { cwd: root, encoding: 'utf8' }).stdout ?? '';
  const realCartesia = /^CARTESIA_API_KEY(=\S|\s*$)/m.test(cvxEnv); // never printed; CLI may list names only
  console.log(`modes: claude=${hasKey ? 'REAL' : 'MOCK'} cartesia=${realCartesia ? 'REAL' : 'MOCK'}`);
  if (args.includes('--require-real') && !(hasKey && realCartesia)) throw new Mismatch('--require-real: a mock is active');

  // 1. reset
  const oak = await reset();
  beat('1 reset_demo -> S0 (1 posted proposal, 5000 bp)');
  if (args.includes('--reset-only')) throw 'done';

  // 2. agent loop in-process
  const [agent, accountant] = await Promise.all([connectAs('agent'), connectAs('accountant')]);
  conns.push(agent, accountant);
  await until('agent/accountant see reset', () => agent.db.workItem.id.find(oak) && accountant.db.workItem.id.find(oak), 5000);
  const cvx = new ConvexHttpClient(process.env.CONVEX_URL);
  const r = agent.reducers, d = agent.db;
  const ledger: Ledger = {
    state: () => ({
      projects: [...d.project.iter()], sources: [...d.source.iter()], conventions: [...d.convention.iter()],
      workItems: [...d.workItem.iter()], calculations: [...d.calculation.iter()], extractions: [...d.extraction.iter()],
      milestones: [...d.contractMilestone.iter()], clarificationRefs: [...d.clarificationRef.iter()], proposals: [...d.proposal.iter()],
    }),
    onSourceInsert: (cb) => d.source.onInsert((_ctx, row) => cb(row)),
    recordExtraction: (a) => r.recordExtraction(a), openClarification: (a) => r.openClarification(a),
    resolveClarification: (a) => r.resolveClarification(a), recordCalculation: (a) => r.recordCalculation(a),
    propose: (a) => r.propose(a), openWorkItem: (a) => r.openWorkItem(a), markMilestoneMet: (a) => r.markMilestoneMet(a),
  };
  const deps: Deps = {
    ledger, extract, explain,
    convex: {
      ask: (a) => cvx.mutation(anyApi.clarifications.ask, a),
      byWorkItem: (workItemId) => cvx.query(anyApi.clarifications.byWorkItem, { workItemId }),
    },
  };
  const seedTexts = new Set((JSON.parse(fs.readFileSync(new URL('demo/seed.json', root), 'utf8')) as { sources: { text: string }[] }).sources.map((s) => s.text));
  stop = startLoop(deps, { isSeed: (s: SourceRow) => s.kind !== 'commissioning_log' && seedTexts.has(s.text) });
  beat('2 agent loop started');

  const projectId = oakland().id;
  const addSource = (kind: string, text: string) => accountant.reducers.addSource({ projectId, kind, text, parentSourceId: 0n, version: 1 });
  const proposalOn = (wi: bigint, rev: number) => [...db.proposal.iter()].find((p) => p.workItemId === wi && p.revision === rev);
  const clarCount = async () => ((await cvx.query(anyApi.clarifications.byWorkItem, { workItemId: String(oak) })) as unknown[]).length;

  // 3-4. ambiguous note -> phone rings
  await addSource('note', 'we need another $200,000 to finish');
  beat('3 note "another $200,000" added');
  const clar = await until('Convex active clarification ringing for Oakland', async () => {
    const c = await cvx.query(anyApi.clarifications.active, {});
    return c && c.workItemId === String(oak) && ['ringing', 'answering'].includes(c.status) ? c : undefined;
  });
  await until('work item awaiting_clarification', () => db.workItem.id.find(oak)?.status === 'awaiting_clarification');
  beat(`4 phone ringing (${clar.status}), work item awaiting_clarification`);

  // 5. manager answers
  await cvx.mutation(anyApi.clarifications.confirm, { id: clar._id, answer: 'additional', speaker: 'Matt' });
  const clarAfter5 = await clarCount();
  beat('5 Matt confirmed "additional"');

  // 6. rev 2 numbers move
  const p2 = await until('proposal revision 2 on Oakland', () => proposalOn(oak, 2));
  const c2 = db.calculation.id.find(p2.calculationId)!;
  eq('rev2 progressBp', c2.progressBp, 4000);
  eq('rev2 cumRevenueCents', c2.cumRevenueCents, 40000000n);
  eq('rev2 contractAssetCents', c2.contractAssetCents, 10000000n);
  eq('rev2 marginCents', c2.marginCents, 0n);
  eq('rev2 lossWarning', c2.lossWarning, true);
  eq('rev2 entry', entry(p2.entryJson), 'Dr Revenue 10000000 / Cr ContractAsset 10000000');
  ok('rev2 explanation non-empty', p2.explanation.trim());
  const pc = JSON.parse(p2.pendingConventionJson) as { template?: string; key?: string; value?: string };
  eq('rev2 pending convention template', pc.template, 'forecast');
  eq('rev2 pending convention key', pc.key, 'another_means');
  eq('rev2 pending convention value', pc.value, 'additional');
  beat('6 rev 2: 40%, $400k revenue, $100k asset, $0 margin, loss warning');

  // 7. controller approves and posts
  await controller.reducers.decide({ proposalId: p2.id, revision: 2, decision: 'approve', reason: '' });
  await controller.reducers.post({ proposalId: p2.id, revision: 2, postingRef: 'OAK-R2' });
  await until('posting OAK-R2 exists', () => [...db.posting.iter()].some((x) => x.proposalId === p2.id && x.postingRef === 'OAK-R2'));
  await until('convention another_means=additional approved', () => [...db.convention.iter()].some((c) => c.template === 'forecast' && c.key === 'another_means' && c.value === 'additional' && c.approvedBy));
  beat('7 approved + posted OAK-R2, convention saved');

  // 8. commissioning log -> milestone invoice
  const maxWi = [...db.workItem.iter()].reduce((m, w) => (w.id > m ? w.id : m), 0n);
  await addSource('commissioning_log', 'Commissioning complete: 48 of 48 units commissioned, throughput test passed 1,200 totes/hr, acceptance criteria met.');
  const inv = await until('work item "Milestone invoice: acceptance"', () => [...db.workItem.iter()].find((w) => w.id > maxWi && w.title === 'Milestone invoice: acceptance'));
  const pInv = await until('invoice proposal', () => proposalOn(inv.id, 1));
  eq('invoice entry', entry(pInv.entryJson), 'Dr AccountsReceivable 20000000 / Cr ContractAsset 20000000');
  await until('acceptance milestone met', () => [...db.contractMilestone.iter()].find((m) => m.projectId === projectId && m.name === 'acceptance')?.status === 'met');
  beat('8 acceptance met -> invoice Dr AR 200,000 / Cr ContractAsset 200,000');

  // 9. month 3: convention applies, no call
  const before = Math.max(...[...db.proposal.iter()].filter((p) => p.workItemId === oak).map((p) => p.revision));
  await addSource('note', 'another $50,000 for conveyor rework');
  const p3 = await until('new Oakland proposal (revision > before) with progressBp 3810', () => [...db.proposal.iter()].find((p) => p.workItemId === oak && p.revision > before && db.calculation.id.find(p.calculationId)?.progressBp === 3810));
  eq('Convex clarifications for Oakland (no new call)', await clarCount(), clarAfter5);
  ok(`rev ${p3.revision} explanation cites another_means`, p3.explanation.includes('another_means'));
  beat(`9 month 3: rev ${p3.revision} 3810 bp, no call, convention cited`);
} catch (e) {
  if (e !== 'done') {
    code = 1;
    console.error(e instanceof Mismatch ? `MISMATCH: ${e.message}` : e);
  }
}
stop();
conns.forEach((c) => c.disconnect());
console.log('\nbeat'.padEnd(72) + 'elapsed');
for (const [n, s] of beats) console.log(n.padEnd(70) + `${s}s`);
console.log(code ? 'DEMO FAILED' : 'DEMO OK');
process.exit(code); // ponytail: the agent's in-flight serial chain is abandoned on purpose
