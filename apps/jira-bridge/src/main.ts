import { existsSync, readFileSync } from 'node:fs';
import { connectAs } from '@keel/ledger-client';
import { buildEvent, type Rows } from './event.js';

// Mirrors the ledger into Jira: subscribes to work_item and POSTs each status change to the Forge web trigger.
// Read-only observer (accountant role). Never calls a money reducer.
for (const f of ['.env', '../../.env']) if (existsSync(f)) for (const line of readFileSync(f, 'utf8').split('\n')) { // ponytail: 4-line .env loader
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const URL = process.env.JIRA_WEBTRIGGER_URL ?? (() => { throw new Error('JIRA_WEBTRIGGER_URL missing (forge webtrigger -f main)'); })();
const SECRET = process.env.SUMMO_WEBHOOK_SECRET ?? '';

const conn = await connectAs('accountant');
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
    const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-summo-secret': SECRET }, body: JSON.stringify(ev) });
    console.log(`${new Date().toISOString()} work item ${w.id} ${w.status} -> ${res.status} ${(await res.text()).slice(0, 80)}`);
  }).catch((e) => console.error(`jira-bridge: ${e?.message ?? e}`));
};
// Rows already on the ledger at startup are not replayed; only changes from now on. (Restart = resume, no duplicates.)
d.workItem.onInsert((_ctx, w) => send(w));
d.workItem.onUpdate((_ctx, old, w) => { if (old.status !== w.status) send(w); });
console.log(`jira-bridge: watching work items on ${process.env.STDB_DB ?? 'keel'}, posting to Forge`);
