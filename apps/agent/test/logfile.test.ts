import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendLog, errCode } from '../src/logfile';

describe('logfile', () => {
  it('creates the dir, writes one JSONL line, redacts keys', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'summo-')), 'nested', 'x.jsonl');
    appendLog({ level: 'error', agent: 'summo', kind: 'error', summary: 'boom sk-ant-abc123 AQ.Ab9-x Bearer eyJ.hdr', refTable: 'source', refId: 7n, projectId: 1n, sourceId: 7n, err: errCode('unbalanced: debits 1 != credits 2') }, file);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const r = JSON.parse(lines[0]);
    expect(r).toMatchObject({ level: 'error', agent: 'summo', kind: 'error', refTable: 'source', refId: '7', projectId: '1', sourceId: '7', err: 'unbalanced' });
    expect(r.summary).toBe('boom [redacted] [redacted] [redacted]');
    expect(Date.parse(r.ts)).toBeGreaterThan(0);
  });
});
