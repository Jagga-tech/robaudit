import { existsSync, readFileSync } from 'node:fs';
import { connectAs } from '@keel/ledger-client';
import { buildEvent, mirrorSummary, type Rows } from './event.js';

// Mirrors the ledger into Jira: subscribes to work_item and POSTs each status change to the Forge web trigger.
// Observer that writes only its own log (agent role: logAgentEvent). Calls no money reducer.
for (const f of ['.env', '../../.env']) if (existsSync(f)) for (const line of readFileSync(f, 'utf8').split('\n')) { // ponytail: 4-line .env loader
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const URL = process.env.JIRA_WEBTRIGGER_URL ?? (() => { throw new Error('JIRA_WEBTRIGGER_URL missing (forge webtrigger -f main)'); })();
const SECRET = process.env.SUMMO_WEBHOOK_SECRET ?? '';

const conn = await connectAs('agent');
const d = conn.db;
const rows = (): Rows => ({
  projects: [...d.project.iter()], proposals: [...d.proposal.iter()], calculations: [...d.calculation.iter()],
  clarificationRefs: [...d.clarificationRef.iter()], approvals: [...d.approval.iter()], postings: [...d.posting.iter()],
});
let chain = Promise.resolve(); // one POST at a time, in ledger order
const send = (w: { id: bigint; projectId: bigint; title: string; status: string }) => {
  chain = chain.then(async () => {
    // ponytail: 300 ms so the proposal/approval row that lands with the status change is in the cache; event-sourcing it is the upgrade
    await new Promise((r) => setTimeout(r, 300));
    const ev = buildEvent(rows(), w);
    const log = (kind: string, summary: string) => conn.reducers.logAgentEvent({ projectId: w.projectId, agent: 'jira-mirror', kind, summary, refTable: 'work_item', refId: w.id });
    try {
      const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-summo-secret': SECRET }, body: JSON.stringify(ev) });
      const text = await res.text();
      console.log(`${new Date().toISOString()} work item ${w.id} ${w.status} -> ${res.status} ${text.slice(0, 80)}`);
      const issueKey = res.ok ? (JSON.parse(text) as { issueKey?: string }).issueKey : undefined;
      if (issueKey) log('mirror', mirrorSummary(issueKey, ev.headline)); else log('error', `jira: ${res.status}`);
    } catch (e) { log('error', `jira: ${(e as Error)?.message ?? e}`.slice(0, 200)); throw e; }
  }).catch((e) => console.error(`jira-bridge: ${e?.message ?? e}`));
};
// Rows already on the ledger at startup are not replayed; only changes from now on. (Restart = resume, no duplicates.)
d.workItem.onInsert((_ctx, w) => send(w));
d.workItem.onUpdate((_ctx, old, w) => { if (old.status !== w.status) send(w); });
console.log(`jira-bridge: watching work items on ${process.env.STDB_DB ?? 'keel'}, posting to Forge`);
