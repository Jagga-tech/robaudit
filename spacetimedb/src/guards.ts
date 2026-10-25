import { SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import spacetimedb from './schema';

export type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

export function requireRole(ctx: Ctx, ...roles: string[]) {
  const u = ctx.db.user.identity.find(ctx.sender);
  if (!u || !roles.includes(u.role)) {
    throw new SenderError(`role: requires ${roles.join(' or ')}, caller is ${u ? u.role : 'unregistered'}`);
  }
  return u;
}

export function log(ctx: Ctx, projectId: bigint, kind: string, refId: bigint, summary: string) {
  const actor = ctx.db.user.identity.find(ctx.sender)?.name ?? 'system';
  ctx.db.historyEvent.insert({ id: 0n, projectId, kind, refId, summary, actor, at: ctx.timestamp });
}

// ponytail: FNV-1a 32-bit, change detection only; swap for sha256 if hashes must be tamper-evident
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
