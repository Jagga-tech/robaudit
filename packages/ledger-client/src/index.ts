import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocket as NodeWS } from 'ws';
import { DbConnection } from '@keel/bindings';

export { DbConnection };
export type Role = 'accountant' | 'deployment_manager' | 'controller' | 'agent';

// ponytail: Node 20 has no global WebSocket; the SDK calls `new WebSocket(url, protocol)`, which `ws` satisfies.
(globalThis as any).WebSocket ??= NodeWS;

export const STDB_URI = process.env.STDB_URI ?? 'http://127.0.0.1:3000';
export const STDB_DB = process.env.STDB_DB ?? 'keel';
const IDS_FILE = fileURLToPath(new URL('../../../demo/identities.json', import.meta.url));
const NAMES: Record<Role, string> = {
  accountant: 'Priya', deployment_manager: 'Matt', controller: 'Dana', agent: 'Summo',
};
const TABLES = [
  'user', 'project', 'policy', 'convention', 'source', 'extraction', 'clarification_ref', 'work_item',
  'calculation', 'proposal', 'approval', 'posting', 'contract_milestone', 'history_event',
];

const readIds = (): Record<string, string> => (existsSync(IDS_FILE) ? JSON.parse(readFileSync(IDS_FILE, 'utf8')) : {});

/** Connect with the role's saved token (created and saved on first connect), subscribe to all tables, register the user only if missing or name/role differ (registerDemoUser logs a history_event each call). */
export async function connectAs(role: Role, opts: { uri?: string; db?: string } = {}): Promise<DbConnection> {
  // container mode: STDB_AGENT_TOKEN supplies the agent identity; no file read/write
  const envTok = role === 'agent' ? process.env.STDB_AGENT_TOKEN : undefined;
  const saved = envTok ?? readIds()[role];
  const conn = await new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder()
      .withUri(opts.uri ?? STDB_URI)
      .withDatabaseName(opts.db ?? STDB_DB)
      .withToken(saved)
      .onConnect((c, _identity, token) => {
        if (!envTok && token !== saved) {
          const ids = readIds(); // re-read so concurrent role connects don't clobber each other
          ids[role] = token;
          writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2) + '\n');
        }
        resolve(c);
      })
      .onConnectError((_ctx, err) => reject(err))
      .build();
  });
  await new Promise<void>((resolve, reject) => {
    conn.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject((ctx as any).event ?? new Error('subscription failed')))
      .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`));
  });
  const me = conn.db.user.identity.find(conn.identity!);
  if (!me || me.role !== role || me.name !== NAMES[role]) await conn.reducers.registerDemoUser({ name: NAMES[role], role });
  return conn;
}

/** Resolve with the first non-undefined value of `pred`, polling the client cache; reject after `ms`. */
export function waitFor<T>(_conn: DbConnection, pred: () => T | undefined, ms = 5000): Promise<T> {
  // ponytail: 20ms polling, switch to table onInsert/onUpdate hooks if latency matters
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      const v = pred();
      if (v !== undefined) return resolve(v);
      if (Date.now() > deadline) return reject(new Error(`waitFor timed out after ${ms}ms`));
      setTimeout(tick, 20);
    };
    tick();
  });
}
