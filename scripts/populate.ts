// Populate a second, phone-onboarded project for screenshots: intake (billed-ahead branch), opening post, an
// ambiguous update answered by phone, second post, and a convention-answered note left open for the Close tab.
// Run `pnpm demo --require-real --remote` first for Oakland.
// Usage: STDB_URI=... STDB_DB=... pnpm tsx scripts/populate.ts   (a Summo agent must be connected)
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { connectAs } from '@keel/ledger-client';
const cvx = new ConvexHttpClient(process.env.CONVEX_URL!);
const r: any = await cvx.action(anyApi.auth.signIn, { provider: 'anonymous' }); cvx.setAuth(r.tokens.token);
const dm = await connectAs('deployment_manager');
const ctl = await connectAs('controller');
const until = async <T>(what: string, f: () => T | undefined | Promise<T | undefined>, ms = 90000): Promise<T> => { const d = Date.now() + ms; for (;;) { const v = await f(); if (v) return v; if (Date.now() > d) throw new Error('timeout: ' + what); await new Promise((x) => setTimeout(x, 300)); } };
const SPEAKER = 'Jordan', NAME = 'Sacramento depot', CUSTOMER = 'Northline Mobility';
await (dm.reducers as any).createProject({ name: NAME, customer: CUSTOMER });
const proj = await until('project', () => [...dm.db.project.iter()].find((p) => p.name === NAME));
const wi = await until('work item', () => [...dm.db.workItem.iter()].find((w) => w.projectId === proj.id));
console.log('project', proj.id, 'work item', wi.id);
let lastId = '';
const answerNext = async (answer: string) => {
  const q: any = await until('question', async () => { const c: any = await cvx.query(anyApi.clarifications.active, {}); return c && c.workItemId === String(wi.id) && c._id !== lastId && ['ringing', 'answering'].includes(c.status) ? c : undefined; });
  lastId = q._id;
  console.log('Q:', q.question, '->', answer);
  await cvx.mutation(anyApi.clarifications.confirm, { id: q._id, answer, speaker: SPEAKER });
};
// contract 1.2M, spent 450k, to finish 750k, billed 600k: 37.5%, revenue 450k, billed ahead -> contract liability 150k, margin 0 (loss warning)
for (const a of ['120000000', '45000000', '75000000', '60000000']) await answerNext(a);
const p1 = await until('opening proposal', () => [...ctl.db.proposal.iter()].find((p) => p.workItemId === wi.id && p.status === 'open'));
console.log('opening entry', p1.entryJson);
await ctl.reducers.decide({ proposalId: p1.id, revision: p1.revision, decision: 'approve', reason: '' });
await ctl.reducers.post({ proposalId: p1.id, revision: p1.revision, postingRef: `SAC-WI${wi.id}-R${p1.revision}` });
await until('posted R1', () => [...ctl.db.posting.iter()].some((x) => x.proposalId === p1.id));
console.log('posted opening');
await dm.reducers.addSource({ projectId: proj.id, kind: 'note', text: 'Charger bay rework is going to run another $250,000 before the depot can go live', parentSourceId: 0n, version: 1 });
// If the Oakland run already saved the convention another_means = additional, Summo proposes without calling.
const rev2 = () => [...ctl.db.proposal.iter()].find((p) => p.workItemId === wi.id && p.revision > p1.revision && p.status === 'open');
const ring: any = await until('question or rev 2', async () => rev2() ? 'proposed' : (async () => { const c: any = await cvx.query(anyApi.clarifications.active, {}); return c && c.workItemId === String(wi.id) && ['ringing', 'answering'].includes(c.status) ? c : undefined; })());
if (ring !== 'proposed') { console.log('Q:', ring.question, '-> additional'); await cvx.mutation(anyApi.clarifications.confirm, { id: ring._id, answer: 'additional', speaker: SPEAKER }); } else console.log('convention applied; no call');
const p2 = await until('rev 2 proposal', rev2);
const c2 = ctl.db.calculation.id.find(p2.calculationId)!;
console.log('rev', p2.revision, 'progress', c2.progressBp, 'bp revenue', c2.cumRevenueCents, 'entry', p2.entryJson);
await ctl.reducers.decide({ proposalId: p2.id, revision: p2.revision, decision: 'approve', reason: '' });
await ctl.reducers.post({ proposalId: p2.id, revision: p2.revision, postingRef: `SAC-WI${wi.id}-R${p2.revision}` });
await until('posted R2', () => [...ctl.db.posting.iter()].some((x) => x.proposalId === p2.id));
console.log('posted rev', p2.revision);
await dm.reducers.addSource({ projectId: proj.id, kind: 'note', text: 'Fire marshal wants another $40,000 of conduit before sign-off', parentSourceId: 0n, version: 2 });
const p3 = await until('rev 3 proposal', () => [...ctl.db.proposal.iter()].find((p) => p.workItemId === wi.id && p.revision > p2.revision));
console.log('rev', p3.revision, 'left open for the Close tab; cites convention:', p3.explanation.includes('another_means'));
dm.disconnect(); ctl.disconnect(); process.exit(0);
