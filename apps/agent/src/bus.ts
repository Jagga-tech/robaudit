import type { Ledger, SourceRow } from './loop.js';

export const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[agent]', ...a);
const MAX_ATTEMPTS = 3;

/** Run f once per key; on failure forget the key (so the next poll retries) until MAX_ATTEMPTS, then give up. Rethrows. */
export async function attempt(key: string, done: Set<string>, attempts: Map<string, number>, f: () => Promise<void>): Promise<void> {
  done.add(key);
  try { await f(); } catch (e) {
    const n = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, n);
    if (n < MAX_ATTEMPTS) done.delete(key); else log(`giving up on ${key} after ${n} attempts`);
    throw e;
  }
}

// ---- bus: typed events, handlers run one event at a time (serial), errors logged and swallowed ----
export type BusEvent = { kind: 'source'; source: SourceRow; key: string } | { kind: 'poll' };
type Handler<K extends BusEvent['kind']> = (e: Extract<BusEvent, { kind: K }>) => Promise<void>;

export function createBus() {
  const handlers = new Map<string, Handler<any>[]>();
  let chain = Promise.resolve();
  return {
    on<K extends BusEvent['kind']>(kind: K, h: Handler<K>) { handlers.set(kind, [...(handlers.get(kind) ?? []), h]); },
    emit(e: BusEvent): Promise<void> {
      const what = e.kind === 'source' ? `source ${e.source.id}` : 'convex poll';
      return (chain = chain.then(async () => { for (const h of handlers.get(e.kind) ?? []) await h(e); })
        .catch((err) => log(`ERROR ${what}:`, err?.message ?? err)));
    },
  };
}

// ---- agents: a name, a seat, the reducers it may call, its handlers; every action is logged to agent_event ----
export type Kind = 'read' | 'agree' | 'disagree' | 'reconcile' | 'ask' | 'answer' | 'compute' | 'explain' | 'propose' | 'review' | 'learn' | 'skip' | 'error' | 'flag' | 'pass';
export type Agent<H> = { name: string; seat: string; may: readonly string[]; handlers: H };

/** Every ledger reducer an agent could reach for, `post` included (a human approval; no agent may call it). */
const REDUCERS = ['recordExtraction', 'openClarification', 'resolveClarification', 'recordCalculation', 'propose', 'openWorkItem', 'markMilestoneMet', 'post'] as const;

/** The ledger as one agent sees it: reads and logAgentEvent always, reducers only from its `may` list (anything else throws). */
export function guardedLedger(ledger: Ledger, agent: string, may: readonly string[]): Ledger {
  const g: Record<string, unknown> = { state: () => ledger.state(), onSourceInsert: (cb: never) => ledger.onSourceInsert(cb), logAgentEvent: ledger.logAgentEvent && ((a: never) => ledger.logAgentEvent!(a)) };
  for (const r of REDUCERS) {
    g[r] = may.includes(r)
      ? (a: never) => (ledger as unknown as Record<string, (a: never) => Promise<void>>)[r](a)
      : () => { throw new Error(`agent ${agent} may not call ${r}`); };
  }
  return g as unknown as Ledger;
}

/** One agent_event row. Best effort: a logging failure never breaks the flow (and a ledger without the reducer just skips it). */
export async function say(ledger: Ledger, agent: string, projectId: bigint, kind: Kind, summary: string, refTable = '', refId = 0n): Promise<void> {
  try { await ledger.logAgentEvent?.({ projectId, agent, kind, summary, refTable, refId }); } catch (e: any) { log(`agent_event ${agent} ${kind} not logged: ${e?.message ?? e}`); }
}
