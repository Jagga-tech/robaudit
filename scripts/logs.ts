// Read the agent's JSONL log, or export the ledger's audit tables to CSV.
// pnpm logs [--follow] [--agent X] [--kind Y] [--since 10m] [--file path]
// pnpm logs:export [--db keel-local] [--out logs/agent_event-<ts>.csv]   (history_event goes next to it)
import fs from 'node:fs';
import path from 'node:path';
import { defaultLogFile } from '../apps/agent/src/logfile.ts';

const args = process.argv.slice(2);
process.stdout.on('error', () => process.exit(0)); // `pnpm logs | head` closes the pipe early
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);

if (args[0] === 'export') {
  const db = opt('--db');
  if (db) process.env.STDB_DB = db; // before the client reads it
  const { DbConnection, STDB_DB, STDB_URI } = await import('@keel/ledger-client');
  // Read-only, anonymous identity: needs no demo token (tables are public) and registers nobody.
  const conn = await new Promise<InstanceType<typeof DbConnection>>((res, rej) => DbConnection.builder().withUri(STDB_URI).withDatabaseName(STDB_DB)
    .onConnect((c) => res(c)).onConnectError((_c, e) => rej(e)).build());
  await new Promise<void>((res, rej) => conn.subscriptionBuilder().onApplied(() => res()).onError((x) => rej((x as any).event ?? new Error('subscribe failed'))).subscribeToAllTables());
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const out = opt('--out') ?? `logs/agent_event-${ts}.csv`;
  const cell = (v: unknown) => {
    const s = typeof v === 'object' && v && '__timestamp_micros_since_unix_epoch__' in v
      ? new Date(Number((v as any).__timestamp_micros_since_unix_epoch__ / 1000n)).toISOString() : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const dump = (rows: Record<string, unknown>[], file: string) => {
    rows.sort((a, b) => (BigInt(a.id as bigint) < BigInt(b.id as bigint) ? -1 : 1));
    const cols = Object.keys(rows[0] ?? { id: 0 });
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');
    console.log(`${rows.length} rows -> ${file}`);
  };
  console.log(`ledger ${STDB_URI}/${STDB_DB}`);
  dump([...conn.db.agentEvent.iter()] as any, out);
  dump([...conn.db.historyEvent.iter()] as any, out.includes('agent_event') ? out.replace('agent_event', 'history_event') : out.replace(/(\.csv)?$/, '.history_event.csv'));
  conn.disconnect();
  process.exit(0);
}

const file = opt('--file') ?? defaultLogFile();
const sinceArg = opt('--since');
const unit = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 } as Record<string, number>;
const since = sinceArg ? Date.now() - Number(sinceArg.slice(0, -1)) * (unit[sinceArg.slice(-1)] ?? NaN) : 0;
if (Number.isNaN(since)) throw new Error('--since takes 30s, 10m, 2h or 1d');
const agent = opt('--agent'), kind = opt('--kind');
const mark = { info: ' ', warn: '!', error: 'X' } as Record<string, string>;

function show(line: string) {
  if (!line.trim()) return;
  let r: any;
  try { r = JSON.parse(line); } catch { return console.log(`? ${line}`); }
  if ((agent && r.agent !== agent) || (kind && r.kind !== kind) || Date.parse(r.ts) < since) return;
  const ref = r.refTable ? ` [${r.refTable} ${r.refId}]` : '';
  const extra = [r.err && `err=${r.err}`, r.latencyMs != null && `${r.latencyMs}ms`].filter(Boolean).join(' ');
  console.log(`${mark[r.level] ?? '?'} ${r.ts.slice(11, 23)}  ${r.agent.padEnd(15)} ${r.kind.padEnd(10)} ${r.summary}${ref}${extra ? `  (${extra})` : ''}`);
}

if (!fs.existsSync(file)) { console.log(`no log at ${file}`); if (!args.includes('--follow')) process.exit(0); }
let pos = 0, rest = '';
const read = () => {
  if (!fs.existsSync(file)) return;
  const size = fs.statSync(file).size;
  if (size <= pos) return;
  const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(size - pos);
  fs.readSync(fd, buf, 0, buf.length, pos);
  fs.closeSync(fd);
  pos = size;
  const lines = (rest + buf.toString('utf8')).split('\n');
  rest = lines.pop()!;
  lines.forEach(show);
};
read();
if (args.includes('--follow')) setInterval(read, 500); // ponytail: 500 ms poll, fs.watch if it ever matters
