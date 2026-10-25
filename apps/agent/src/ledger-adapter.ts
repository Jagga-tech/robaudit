import fs from 'node:fs';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import type { DbConnection } from '@keel/ledger-client';
import { extract, extractBoth } from './extract.js';
import { explain } from './explain.js';
import { readForecastDocument } from './azure-di.js';
import { geminiReview } from './agents/reviewer.js';
import type { Deps, Ledger, SourceRow } from './loop.js';

// The stage agent's real wiring, shared by main.ts and scripts/demo.ts. No connections at import time.
export function ledgerDeps(conn: DbConnection): Ledger {
  const r = conn.reducers, d = conn.db;
  return {
    state: () => ({
      projects: [...d.project.iter()], sources: [...d.source.iter()], conventions: [...d.convention.iter()],
      workItems: [...d.workItem.iter()], calculations: [...d.calculation.iter()], extractions: [...d.extraction.iter()],
      milestones: [...d.contractMilestone.iter()], clarificationRefs: [...d.clarificationRef.iter()], proposals: [...d.proposal.iter()],
      approvals: [...d.approval.iter()],
    }),
    onSourceInsert: (cb) => d.source.onInsert((_ctx, row) => cb(row)),
    onApprovalInsert: (cb) => d.approval.onInsert((_ctx, row) => cb(row)),
    recordExtraction: (a) => r.recordExtraction(a), openClarification: (a) => r.openClarification(a),
    resolveClarification: (a) => r.resolveClarification(a), recordCalculation: (a) => r.recordCalculation(a),
    propose: (a) => r.propose(a), openWorkItem: (a) => r.openWorkItem(a), markMilestoneMet: (a) => r.markMilestoneMet(a),
    logAgentEvent: (a) => r.logAgentEvent(a),
  };
}

export function agentDeps(conn: DbConnection, cvx: ConvexHttpClient): Deps {
  return {
    ledger: ledgerDeps(conn),
    convex: {
      ask: (a) => cvx.mutation(anyApi.clarifications.ask, a),
      byWorkItem: (workItemId) => cvx.query(anyApi.clarifications.byWorkItem, { workItemId }),
      fallbackText: (id) => cvx.mutation(anyApi.clarifications.fallbackText, { id }),
    },
    extract, extractBoth, explain, readForecastDocument, review: geminiReview,
    fetchDocument: async (storageId) => {
      const url: string | null = await cvx.query(anyApi.clarifications.audioUrl, { storageId }); // any storageId, despite the name
      if (!url) throw new Error(`convex storage ${storageId} not found`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`convex storage ${storageId}: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

// Seed sources (S0, re-inserted by reset_demo) are history, not new evidence.
const SEED = JSON.parse(fs.readFileSync(new URL('../../../demo/seed.json', import.meta.url), 'utf8')) as { sources: { text: string }[] };
const seedTexts = new Set(SEED.sources.map((s) => s.text));
export const isSeed = (s: SourceRow) => s.kind !== 'commissioning_log' && seedTexts.has(s.text);
