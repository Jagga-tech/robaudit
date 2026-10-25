import fs from 'node:fs';
import { ConvexHttpClient } from 'convex/browser';
import { connectAs } from '@keel/ledger-client';
import { agentDeps, isSeed } from './ledger-adapter.js';
import { log, startLoop } from './loop.js';

// CONVEX_URL from env, else .env.local / .env at the repo root (.env is also loaded by claude.ts).
for (const f of ['.env.local', '.env']) {
  try {
    const m = fs.readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8').match(/^CONVEX_URL\s*=\s*(\S+)/m);
    if (m) process.env.CONVEX_URL ??= m[1];
  } catch {}
}
if (!process.env.CONVEX_URL) throw new Error('CONVEX_URL unset (run `npx convex dev` to create .env.local)');

const conn = await connectAs('agent');
// ponytail: connectAs owns the builder, so hook the connection's disconnect emitter (TS-private, public at runtime). Run under a restart loop.
(conn as unknown as { onDisconnect(cb: () => void): void }).onDisconnect(() => { log('ledger disconnected'); process.exit(1); });
const stop = startLoop(agentDeps(conn, new ConvexHttpClient(process.env.CONVEX_URL)), { isSeed });
log(`running as ${conn.identity?.toHexString().slice(0, 12)}…, convex ${process.env.CONVEX_URL}. Ctrl-C to stop.`);
process.on('SIGINT', () => { log('stopping'); stop(); process.exit(0); }); // exiting closes the socket; disconnect() would fire the exit(1) hook
