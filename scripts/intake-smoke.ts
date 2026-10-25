// Intake smoke: create a project, answer the four phone questions through Convex, check the opening proposal.
// Usage: STDB_URI=... STDB_DB=... pnpm tsx scripts/intake-smoke.ts   (a Summo agent must be connected to the ledger)
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { connectAs } from '@keel/ledger-client';
const cvx = new ConvexHttpClient(process.env.CONVEX_URL!);
const r: any = await cvx.action(anyApi.auth.signIn, { provider: 'anonymous' }); cvx.setAuth(r.tokens.token);
const dm = await connectAs('deployment_manager');
const name = `Riverside smoke ${Date.now() % 100000}`;
await (dm.reducers as any).createProject({ name, customer: 'Aster Robotics' });
const until = async <T>(what: string, f: () => T | undefined | Promise<T | undefined>, ms = 60000): Promise<T> => { const d = Date.now() + ms; for (;;) { const v = await f(); if (v) return v; if (Date.now() > d) throw new Error('timeout: ' + what); await new Promise((x) => setTimeout(x, 300)); } };
const proj = await until('project', () => [...dm.db.project.iter()].find((p) => p.name === name));
const wi = await until('work item', () => [...dm.db.workItem.iter()].find((w) => w.projectId === proj.id));
console.log('project', proj.id, 'work item', wi.id, wi.status);
const answers = ['100000000', '40000000', '40000000', '30000000'];
let lastId = '';
for (const a of answers) {
  const t0 = Date.now();
  const q: any = await until('amount question', async () => { const c: any = await cvx.query(anyApi.clarifications.active, {}); return c && c.workItemId === String(wi.id) && c._id !== lastId && ['ringing', 'answering'].includes(c.status) ? c : undefined; });
  lastId = q._id;
  console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] Q (${q.answerType}) ${q.question}`);
  await cvx.mutation(anyApi.clarifications.confirm, { id: q._id, answer: a, speaker: 'Smoke' });
}
const prop = await until('opening proposal', () => [...dm.db.proposal.iter()].find((p) => p.workItemId === wi.id));
const calc = dm.db.calculation.id.find(prop.calculationId)!;
console.log('calc', calc.progressBp, 'bp, revenue', calc.cumRevenueCents, 'asset', calc.contractAssetCents);
console.log('entry', prop.entryJson);
console.log('project contract', dm.db.project.id.find(proj.id)?.contractValueCents, 'work item', dm.db.workItem.id.find(wi.id)?.status);
const intake = [...dm.db.source.iter()].filter((s) => s.projectId === proj.id && s.kind === 'intake').map((s) => s.text.split(' | ')[0]);
console.log('intake sources', intake.join(', '));
dm.disconnect(); process.exit(0);
