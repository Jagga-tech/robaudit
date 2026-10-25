import fs from 'node:fs';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { connectAs, type DbConnection } from '@keel/ledger-client';
import { extract, extractBoth } from './extract.js';
import { explain } from './explain.js';
import { log, startLoop, type Deps, type Ledger, type SourceRow } from './loop.js';

// CONVEX_URL from env, else .env.local / .env at the repo root (.env is also loaded by claude.ts).
for (const f of ['.env.local', '.env']) {
  try {
    const m = fs.readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8').match(/^CONVEX_URL\s*=\s*(\S+)/m);
    if (m) process.env.CONVEX_URL ??= m[1];
  } catch {}
}
if (!process.env.CONVEX_URL) throw new Error('CONVEX_URL unset (run `npx convex dev` to create .env.local)');

const SEED = JSON.parse(fs.readFileSync(new URL('../../../demo/seed.json', import.meta.url), 'utf8')) as { sources: { text: string }[] };
const seedTexts = new Set(SEED.sources.map((s) => s.text));

export function ledgerDeps(conn: DbConnection): Ledger {
  const r = conn.reducers, d = conn.db;
  return {
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
}

const conn = await connectAs('agent');
const cvx = new ConvexHttpClient(process.env.CONVEX_URL);
const deps: Deps = {
  ledger: ledgerDeps(conn),
  convex: {
    ask: (a) => cvx.mutation(anyApi.clarifications.ask, a),
    byWorkItem: (workItemId) => cvx.query(anyApi.clarifications.byWorkItem, { workItemId }),
  },
  extract, extractBoth, explain,
};
// Seed sources (S0, re-inserted by reset_demo) are history, not new evidence.
const stop = startLoop(deps, { isSeed: (s: SourceRow) => s.kind !== 'commissioning_log' && seedTexts.has(s.text) });
log(`running as ${conn.identity?.toHexString().slice(0, 12)}…, convex ${process.env.CONVEX_URL}. Ctrl-C to stop.`);
process.on('SIGINT', () => { log('stopping'); stop(); conn.disconnect(); process.exit(0); });
