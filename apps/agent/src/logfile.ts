import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Durable agent log: one JSON object per line, append-only, never rotated. Off until startFileLog() (tests and scripts stay quiet).
export type LogLine = {
  level: 'info' | 'warn' | 'error'; agent: string; kind: string; summary: string;
  refTable?: string; refId?: bigint | string; projectId?: bigint | string;
  sourceId?: bigint | string; workItemId?: bigint | string; latencyMs?: number; err?: string;
};

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const defaultLogFile = () => process.env.SUMMO_LOG_FILE ?? path.join(ROOT, 'logs', `summo-${new Date().toISOString().slice(0, 10)}.jsonl`);
/** Anything that looks like an API key or bearer token never reaches the file. */
export const redact = (s: string) => s.replace(/sk-[\w-]+|AQ\.[\w.-]+|Bearer\s+[\w.~+/=-]+/g, '[redacted]');
const CODES = /\b(role|not_approved|revision|period_closed|unbalanced|duplicate_posting|bad_input|not_found|stale)\b:/;
/** The SenderError code inside a reducer failure message, if any. */
export const errCode = (msg: string) => msg.match(CODES)?.[1];

let active: string | null = null;
export const logFile = () => active;

export function appendLog(r: LogLine, file: string | null = active): void {
  if (!file) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), refTable: '', refId: '0', projectId: '0', ...r },
    (_k, v) => (typeof v === 'bigint' ? String(v) : typeof v === 'string' ? redact(v) : v));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line + '\n');
}

const gitSha = () => {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown'; } catch { return 'unknown'; }
};

/** Turn the file log on, mirror console.log/warn/error into it (so the file is the single record), write the start-up line. */
export function startFileLog(meta: { ledger: string; convex: string; readers: Record<string, string> }, file = defaultLogFile()): string {
  active = file;
  for (const m of ['log', 'warn', 'error'] as const) {
    const orig = console[m].bind(console);
    console[m] = (...a: unknown[]) => {
      orig(...a);
      const summary = format(...a).replace(/^\S+Z \[agent\] /, ''); // bus.log prefix; ts is already on the line
      const err = errCode(summary);
      appendLog({ level: m === 'error' || /\bERROR\b|giving up/.test(summary) ? 'error' : m === 'warn' || /not logged|MOCK/.test(summary) ? 'warn' : 'info', agent: 'agent', kind: 'console', summary, ...(err && { err }) });
    };
  }
  const readers = Object.entries(meta.readers).map(([k, v]) => `${k}=${v}`).join(' ');
  appendLog({ level: 'info', agent: 'agent', kind: 'start', summary: `start git ${gitSha()} node ${process.version} ledger ${meta.ledger} convex ${meta.convex} ${readers}` });
  return file;
}
