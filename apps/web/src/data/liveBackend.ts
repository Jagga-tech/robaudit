// Live backend: SpacetimeDB ledger (via @keel/bindings) + Convex clarification channel.
// Follows docs/frontend-guide.md. The UI calls only addSource / decide / post / resetDemo; the phone talks to Convex.
import { DbConnection } from '@keel/bindings';
import { ConvexClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  EMPTY_SNAPSHOT, ROLE_NAMES, toResult, type CallStatus, type ClarificationAnswer, type ClarificationCall, type ConnectionState,
  type KeelBackend, type Proposal, type Result, type Role, type Snapshot, type SourceKind,
} from './model';

const TABLES = ['user', 'project', 'policy', 'convention', 'source', 'extraction', 'clarification_ref', 'work_item',
  'calculation', 'proposal', 'approval', 'posting', 'contract_milestone', 'history_event'];
const camel = (t: string) => t.replace(/_(\w)/g, (_: string, x: string) => x.toUpperCase());
const ROLE_KEY = 'keel-live-role';

const STDB_URI = (import.meta.env.VITE_STDB_URI ?? import.meta.env.STDB_URI ?? 'ws://127.0.0.1:3000') as string;
const STDB_DB = (import.meta.env.VITE_STDB_DB ?? import.meta.env.STDB_DB ?? 'keel') as string;
export const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL ?? import.meta.env.CONVEX_URL) as string | undefined;

type Ts = { toDate(): Date };
const d = (t: Ts) => t.toDate();

type ConvexRow = {
  _id: string; _creationTime: number; workItemId: string; question: string; options: string[]; status: CallStatus;
  answer?: string; speaker?: string; reason?: string; confirmedAt?: number;
};

export class LiveBackend implements KeelBackend {
  readonly mode = 'live' as const;
  private conn: DbConnection | null = null;
  private convex: ConvexClient | null = null;
  private snapshot: Snapshot = EMPTY_SNAPSHOT;
  private state: ConnectionState = 'connecting';
  private listeners = new Set<() => void>();
  private currentRole: Role = (localStorage.getItem(ROLE_KEY) as Role) || 'accountant';
  private call: ClarificationCall | null = null;
  private busySourceId: bigint | null = null;

  getSnapshot = () => this.snapshot;
  getState = () => this.state;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => this.listeners.delete(l); };
  role = () => this.currentRole;

  /** Resolves once the ledger subscription is applied; rejects (after `timeoutMs`) if it is unreachable. */
  async connect(timeoutMs = 2500): Promise<void> {
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('unavailable: SpacetimeDB not reachable')), timeoutMs));
    this.conn = await Promise.race([this.open(this.currentRole), timeout]);
    if (CONVEX_URL) {
      this.convex = new ConvexClient(CONVEX_URL);
      this.convex.onUpdate(api.clarifications.active, {}, (row) => {
        if (row) this.call = this.mapCall(row as unknown as ConvexRow);
        else if (this.call) this.refreshCall(this.call.workItemId);
        this.rebuild();
      });
    }
    this.state = 'ready';
    this.rebuild();
  }

  async setRole(role: Role) {
    this.currentRole = role;
    localStorage.setItem(ROLE_KEY, role);
    this.conn?.disconnect();
    this.conn = await this.open(role); // one identity per role, as in the harness
    this.rebuild();
  }

  addSource(kind: SourceKind, text: string, parentSourceId = 0n): Promise<Result> {
    return this.reduce(async (c) => {
      const project = [...c.db.project.iter()].find((p) => p.name === 'Oakland deployment');
      if (!project) throw new Error('not_found: Oakland deployment');
      const version = kind === 'forecast' ? Math.max(0, ...[...c.db.source.iter()].filter((s) => s.kind === kind).map((s) => s.version)) + 1 : 1;
      await c.reducers.addSource({ projectId: project.id, kind, text, parentSourceId, version });
    });
  }

  decide(p: Proposal, decision: 'approve' | 'return' | 'hold', reason: string) {
    return this.reduce((c) => c.reducers.decide({ proposalId: p.id, revision: p.revision, decision, reason }));
  }

  post(p: Proposal, postingRef: string) {
    return this.reduce((c) => c.reducers.post({ proposalId: p.id, revision: p.revision, postingRef }));
  }

  async reset(): Promise<Result> {
    // convex/clarifications.ts has no resetOpen yet, so close a leftover open call with the existing decline mutation.
    if (this.convex && this.call && ['ringing', 'answering', 'fallback_text'].includes(this.call.status)) {
      await this.convex.mutation(api.clarifications.decline, { id: this.call.id as Id<'clarifications'>, reason: 'demo reset' }).catch(() => undefined);
    }
    this.call = null;
    return this.reduce((c) => c.reducers.resetDemo({}));
  }

  startAnswer(callId: string) {
    return this.convexCall(() => this.convex!.mutation(api.clarifications.startAnswer, { id: callId as Id<'clarifications'> }));
  }
  confirm(callId: string, answer: ClarificationAnswer, speaker: string) {
    return this.convexCall(() => this.convex!.mutation(api.clarifications.confirm, { id: callId as Id<'clarifications'>, answer, speaker }));
  }
  decline(callId: string, reason: string) {
    return this.convexCall(() => this.convex!.mutation(api.clarifications.decline, { id: callId as Id<'clarifications'>, reason }));
  }

  // ---- internals ----

  private async open(role: Role): Promise<DbConnection> {
    const key = `keel-token-${role}`;
    const conn = await new Promise<DbConnection>((resolve, reject) => {
      DbConnection.builder()
        .withUri(STDB_URI)
        .withDatabaseName(STDB_DB)
        .withToken(localStorage.getItem(key) ?? undefined)
        .onConnect((c, _identity, token) => { localStorage.setItem(key, token); resolve(c); })
        .onConnectError((_ctx, e) => reject(e))
        .build();
    });
    await new Promise<void>((resolve, reject) => {
      conn.subscriptionBuilder()
        .onApplied(() => resolve())
        .onError((ctx) => reject((ctx as unknown as { event?: Error }).event ?? new Error('subscription failed')))
        .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`));
    });
    const me = conn.db.user.identity.find(conn.identity!);
    if (!me || me.role !== role) await conn.reducers.registerDemoUser({ name: ROLE_NAMES[role], role });
    for (const t of TABLES) {
      const tbl = (conn.db as unknown as Record<string, { onInsert(f: () => void): void; onUpdate?(f: () => void): void; onDelete(f: () => void): void }>)[camel(t)];
      tbl.onInsert(() => this.rebuild()); tbl.onUpdate?.(() => this.rebuild()); tbl.onDelete(() => this.rebuild());
    }
    return conn;
  }

  private async reduce(f: (c: DbConnection) => Promise<unknown>): Promise<Result> {
    if (!this.conn) return { ok: false, code: 'unavailable', message: 'Not connected to the ledger' };
    try { await f(this.conn); return { ok: true }; } catch (e) { return toResult(e); }
  }

  private async convexCall(f: () => Promise<unknown>): Promise<Result> {
    if (!this.convex) return { ok: false, code: 'unavailable', message: 'CONVEX_URL is not configured' };
    try { await f(); return { ok: true }; } catch (e) { return toResult(e); }
  }

  private async refreshCall(workItemId: string) {
    const rows = (await this.convex?.query(api.clarifications.byWorkItem, { workItemId })) as unknown as ConvexRow[] | undefined;
    const last = rows?.sort((a, b) => b._creationTime - a._creationTime)[0];
    if (last) { this.call = this.mapCall(last); this.rebuild(); }
  }

  private mapCall(r: ConvexRow): ClarificationCall {
    return { id: r._id, workItemId: r.workItemId, question: r.question, options: r.options, status: r.status, answer: r.answer, speaker: r.speaker, reason: r.reason, confirmedAt: r.confirmedAt, createdAt: r._creationTime };
  }

  private rebuild() {
    const c = this.conn;
    if (!c) return;
    const db = c.db;
    const history = [...db.historyEvent.iter()].map((h) => ({ ...h, at: d(h.at) }));
    // "Keel is reading" from source_added until that source produces an outcome event (guide §7).
    const lastAdded = [...history].reverse().find((h) => h.kind === 'source_added');
    const outcome = lastAdded && history.some((h) => h.id > lastAdded.id && ['calculation', 'proposed', 'clarification_opened', 'milestone_met'].includes(h.kind));
    const src = lastAdded && db.source.id.find(lastAdded.refId);
    this.busySourceId = lastAdded && !outcome && src && ['note', 'commissioning_log'].includes(src.kind) ? lastAdded.refId : null;
    this.snapshot = {
      projects: [...db.project.iter()],
      policies: [...db.policy.iter()].map((p) => ({ ...p, approvedAt: d(p.approvedAt) })),
      conventions: [...db.convention.iter()],
      sources: [...db.source.iter()].map((s) => ({ ...s, createdAt: d(s.createdAt) })),
      extractions: [...db.extraction.iter()],
      clarificationRefs: [...db.clarificationRef.iter()].map((r) => {
        const at = d(r.confirmedAt);
        return { ...r, confirmedAt: at.getTime() === 0 ? null : at };
      }),
      workItems: [...db.workItem.iter()],
      calculations: [...db.calculation.iter()],
      proposals: [...db.proposal.iter()],
      approvals: [...db.approval.iter()].map((a) => ({ ...a, at: d(a.at) })),
      postings: [...db.posting.iter()].map((p) => ({ ...p, postedAt: d(p.postedAt) })),
      milestones: [...db.contractMilestone.iter()],
      history,
      call: this.call,
      agentBusy: this.busySourceId !== null,
    };
    this.listeners.forEach((l) => l());
  }
}
