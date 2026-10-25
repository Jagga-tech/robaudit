// Browser SpacetimeDB connection, one identity per role (docs/frontend-guide.md §3–4). Never import @keel/ledger-client here (Node-only).
import { DbConnection } from '@keel/bindings';

export { DbConnection };
export const STDB_URI = import.meta.env.VITE_STDB_URI ?? 'wss://maincloud.spacetimedb.com';
export const STDB_DB = import.meta.env.VITE_STDB_DB ?? 'keel';
export type Role = 'accountant' | 'deployment_manager' | 'controller';
const NAMES: Record<Role, string> = { controller: 'Dana', accountant: 'Priya', deployment_manager: 'Matt' };
export const TABLES = ['user', 'project', 'policy', 'convention', 'source', 'extraction', 'clarification_ref', 'work_item',
  'calculation', 'proposal', 'approval', 'posting', 'contract_milestone', 'history_event'];

const listeners = new Set<() => void>();
/** Called after any row insert/update/delete on any connection. Returns an unsubscribe. */
export function onChange(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
const bump = () => listeners.forEach((f) => f());

/** Connect with the token saved under `keel-token-<role>`, subscribe, and register the demo user once. */
export async function connect(role: Role, name = NAMES[role], tables = TABLES): Promise<DbConnection> {
  const key = `keel-token-${role}`;
  const conn = await new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder()
      .withUri(STDB_URI)
      .withDatabaseName(STDB_DB)
      .withToken(localStorage.getItem(key) ?? undefined)
      .onConnect((c, _id, token) => { localStorage.setItem(key, token); resolve(c); })
      .onConnectError((_ctx, e) => reject(e))
      .build();
  });
  await new Promise<void>((resolve, reject) => {
    conn.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject((ctx as any).event ?? new Error('subscription failed')))
      .subscribe(tables.map((t) => `SELECT * FROM ${t}`));
  });
  const me = conn.db.user.identity.find(conn.identity!);
  if (!me || me.role !== role || me.name !== name) await conn.reducers.registerDemoUser({ name, role });
  for (const t of tables) {
    const tbl = (conn.db as any)[t.replace(/_(\w)/g, (_: string, x: string) => x.toUpperCase())];
    tbl.onInsert(bump); tbl.onUpdate?.(bump); tbl.onDelete(bump);
  }
  return conn;
}

/** A separate subscription for tables production may not have yet (agent_event): the main TABLES subscription
 *  must not fail because of them. onError fires when the server rejects the query (table missing). */
const hooked = new Set<string>();
export function subscribeExtra(conn: DbConnection, tables: string[], onApplied: () => void, onError: (e: unknown) => void) {
  return conn.subscriptionBuilder()
    .onApplied(() => {
      for (const t of tables) {
        if (hooked.has(t)) continue;
        hooked.add(t);
        const tbl = (conn.db as any)[t.replace(/_(\w)/g, (_: string, x: string) => x.toUpperCase())];
        tbl.onInsert(bump); tbl.onUpdate?.(bump); tbl.onDelete(bump);
      }
      bump(); onApplied();
    })
    .onError((ctx) => onError((ctx as any).event ?? new Error('subscription failed')))
    .subscribe(tables.map((t) => `SELECT * FROM ${t}`));
}

/** Await a reducer call: null when it succeeded, otherwise the SenderError message ("code: message"). */
export async function call(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e: any) { return String(e?.message ?? e); }
}

const CODES = ['role', 'revision', 'stale', 'period_closed', 'unbalanced', 'duplicate_posting', 'not_approved', 'not_found', 'bad_input'];
export const codeOf = (msg: string) => CODES.find((c) => new RegExp(`\\b${c}:`).test(msg)) ?? 'unknown';

// Formatting (cents are bigint, progress is basis points).
export const usd = (c: bigint) => {
  const a = c < 0n ? -c : c, cents = a % 100n;
  return `${c < 0n ? '−' : ''}$${(a / 100n).toLocaleString('en-US')}${cents ? '.' + String(cents).padStart(2, '0') : ''}`;
};
export const dollars = (c: number) => `${c < 0 ? '−' : ''}$${Math.round(Math.abs(c) / 100).toLocaleString('en-US')}`; // hero figures, whole dollars
export const pct = (bp: number) => `${+(bp / 100).toFixed(2)}%`; // 4000 -> "40%", 3636 -> "36.36%"
export const ids = (csv: string) => csv.split(',').filter(Boolean).map((x) => BigInt(x.trim()));
