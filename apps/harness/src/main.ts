import { DbConnection } from '@keel/bindings';
import { ConvexClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';

type Role = 'accountant' | 'deployment_manager' | 'controller' | 'agent';
const NAMES: Record<Role, string> = { accountant: 'Priya', deployment_manager: 'Matt', controller: 'Dana', agent: 'Keel Agent' };
const TABLES = ['user', 'project', 'policy', 'convention', 'source', 'extraction', 'clarification_ref', 'work_item',
  'calculation', 'proposal', 'approval', 'posting', 'contract_milestone', 'history_event'];

const $ = (id: string) => document.getElementById(id)!;
const roleSel = $('role') as HTMLSelectElement;
const statusEl = $('status');
const setStatus = (s: string) => (statusEl.textContent = s);
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 1);

let conn: DbConnection | undefined;
let active: any = null;
let transcript: any = null;
const convex = new ConvexClient(import.meta.env.VITE_CONVEX_URL ?? import.meta.env.CONVEX_URL);
let unsubTranscript = () => {};
convex.onUpdate(api.clarifications.active, {}, (c: any) => {
  active = c;
  unsubTranscript();
  transcript = null;
  if (c) unsubTranscript = convex.onUpdate(api.transcript.byClarification, { id: c._id }, (t: any) => { transcript = t; render(); });
  render();
});

const rows = <T,>(it: Iterable<T>) => [...it];
const latest = <T extends { id: bigint }>(xs: T[]) => xs.reduce<T | undefined>((m, r) => (!m || r.id > m.id ? r : m), undefined);

function render() {
  if (!conn) return;
  const d = conn.db;
  const dump = {
    work_item: rows(d.workItem.iter()),
    proposal: rows(d.proposal.iter()).map((p) => ({ id: p.id, workItemId: p.workItemId, revision: p.revision, status: p.status, entryJson: p.entryJson, explanation: p.explanation })),
    calculation: rows(d.calculation.iter()).map((c) => ({ id: c.id, progressBp: c.progressBp, cumRevenueCents: c.cumRevenueCents, contractAssetCents: c.contractAssetCents, marginCents: c.marginCents, lossWarning: c.lossWarning })),
    posting: rows(d.posting.iter()),
    history_event: rows(d.historyEvent.iter()).sort((a, b) => Number(b.id - a.id)).slice(0, 15),
    convention: rows(d.convention.iter()),
    convex_active: active,
    convex_transcript: transcript,
  };
  $('dump').textContent = json(dump);
}

async function connect(role: Role) {
  conn?.disconnect();
  conn = undefined;
  const key = `keel-token-${role}`;
  const c = await new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder()
      .withUri('ws://127.0.0.1:3000')
      .withDatabaseName('keel')
      .withToken(localStorage.getItem(key) ?? undefined)
      .onConnect((c, _id, token) => { localStorage.setItem(key, token); resolve(c); })
      .onConnectError((_ctx, e) => reject(e))
      .build();
  });
  await new Promise<void>((resolve, reject) => {
    c.subscriptionBuilder().onApplied(() => resolve()).onError((ctx) => reject((ctx as any).event ?? new Error('subscription failed')))
      .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`));
  });
  const me = c.db.user.identity.find(c.identity!);
  if (!me || me.role !== role) await c.reducers.registerDemoUser({ name: NAMES[role], role });
  for (const t of TABLES) {
    const tbl = (c.db as any)[t.replace(/_(\w)/g, (_, x) => x.toUpperCase())];
    tbl.onInsert(render); tbl.onUpdate?.(render); tbl.onDelete(render);
  }
  conn = c;
  render();
}

const projectId = () => rows(conn!.db.project.iter())[0].id;
const openProposal = () => latest(rows(conn!.db.proposal.iter()).filter((p) => p.status === 'open'));
const addSource = (kind: string, text: string) => conn!.reducers.addSource({ projectId: projectId(), kind, text, parentSourceId: 0n, version: 1 });
const confirmAs = (answer: string) => {
  if (!active) throw new Error('no active clarification');
  return convex.mutation(api.clarifications.confirm, { id: active._id, answer, speaker: roleSel.value });
};

const actions: Record<string, () => unknown> = {
  Reset: async () => {
    await conn!.reducers.resetDemo({});
    // ponytail: resetOpen may not be deployed yet; a missing function must not break Reset
    const resetOpen = (api.clarifications as any)?.resetOpen;
    if (resetOpen) await convex.mutation(resetOpen, {}).catch((e: any) => console.warn('resetOpen failed', e));
  },
  'Add $200k note': () => addSource('note', 'we need another $200,000 to finish'),
  'Confirm "additional"': () => confirmAs('additional'),
  'Confirm "new total"': () => confirmAs('new total'),
  'Approve latest': () => {
    const p = openProposal();
    if (!p) throw new Error('no open proposal');
    return conn!.reducers.decide({ proposalId: p.id, revision: p.revision, decision: 'approve', reason: 'ok' });
  },
  'Post latest': () => {
    const p = latest(rows(conn!.db.proposal.iter()).filter((p) => p.status === 'approved'));
    if (!p) throw new Error('no approved proposal');
    return conn!.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: `OAK-WI${p.workItemId}-R${p.revision}` });
  },
  'Add commissioning log': () => addSource('commissioning_log', 'Commissioning complete: 48 of 48 units commissioned, throughput test passed 1,200 totes/hr, acceptance criteria met.'),
  'Add month-3 note': () => addSource('note', 'another $50,000 for conveyor rework'),
  'Save convention': () => conn!.reducers.saveConvention({
    template: 'forecast', key: 'another_means', value: 'additional', exampleSourceIdsCsv: '',
    policyVersion: rows(conn!.db.policy.iter())[0]?.version ?? 0,
  }),
};
for (const [label, fn] of Object.entries(actions)) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = async () => {
    try { setStatus(`${label}...`); await fn(); setStatus(`${label}: ok`); } catch (e: any) { setStatus(`${label}: ERROR ${e?.message ?? e}`); }
  };
  $('buttons').append(b);
}

const go = () => connect(roleSel.value as Role).then(() => setStatus(`connected as ${roleSel.value}`), (e) => setStatus(`connect ERROR ${e?.message ?? e}`));
roleSel.onchange = go;
go();
