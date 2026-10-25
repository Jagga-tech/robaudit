import { describe, expect, it } from 'vitest';
import { buildEvent, type Rows } from '../src/event.js';

const rows: Rows = {
  projects: [{ id: 1n, name: 'Oakland' }],
  proposals: [{ id: 7n, workItemId: 3n, calculationId: 9n, revision: 2, entryJson: JSON.stringify([{ account: 'Revenue', debit: '10000000', credit: '0' }, { account: 'Contract asset', debit: '0', credit: '10000000' }]), explanation: 'ESCALATION: margin is zero', status: 'open' }],
  calculations: [{ id: 9n, lossWarning: true, progressBp: 4000, marginCents: 0n }],
  clarificationRefs: [{ workItemId: 3n, question: 'Additional, or the new total?', status: 'open' }],
  approvals: [{ proposalId: 7n, revision: 2, decision: 'return', by: 'Dana', reason: 'check the forecast date' }],
  postings: [],
};
const wi = (status: string) => ({ id: 3n, projectId: 1n, title: 'Revenue close', status });

describe('buildEvent', () => {
  it('proposed: entry, explanation, loss label', () => {
    const e = buildEvent(rows, wi('proposed'));
    expect(e).toMatchObject({ workItemId: '3', project: 'Oakland', labels: ['loss-warning'] });
    expect(e.entry).toBe('Dr Revenue $100,000\nCr Contract asset $100,000');
    expect(e.detail).toContain('40.00%');
  });
  it('awaiting_clarification carries the question; returned carries actor and reason', () => {
    expect(buildEvent(rows, wi('awaiting_clarification')).detail).toBe('Additional, or the new total?');
    expect(buildEvent(rows, wi('returned'))).toMatchObject({ actor: 'Dana', detail: 'check the forecast date', labels: ['needs-rework'] });
  });
});
