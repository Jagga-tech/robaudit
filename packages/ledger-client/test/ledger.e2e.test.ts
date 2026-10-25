import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAs, waitFor, STDB_URI, type DbConnection } from '../src/index';

const up = await fetch(new URL('/v1/ping', STDB_URI.replace(/^ws(s?):/, 'http$1:'))).then((r) => r.ok, () => false);
if (!up) console.warn(`[ledger e2e] SKIPPED: SpacetimeDB not reachable at ${STDB_URI}. Run \`spacetime start\` and \`pnpm stdb:publish\`.`);

const ENTRY = JSON.stringify([
  { account: 'Revenue', debit: '10000000', credit: '0' },
  { account: 'ContractAsset', debit: '0', credit: '10000000' },
]);
const maxBy = <T extends { id: bigint }>(rows: Iterable<T>) => [...rows].reduce<T | undefined>((m, r) => (!m || r.id > m.id ? r : m), undefined);

describe.skipIf(!up)('ledger controls (live SpacetimeDB)', () => {
  let controller: DbConnection, agent: DbConnection, accountant: DbConnection;
  let projectId: bigint, seededWorkItemId: bigint;

  beforeAll(async () => {
    [controller, agent, accountant] = await Promise.all([connectAs('controller'), connectAs('agent'), connectAs('accountant')]);
  });
  afterAll(async () => {
    await controller?.reducers.resetDemo({}); // leave the shared db at S0 for the demo
    [controller, agent, accountant].forEach((c) => c?.disconnect());
  });

  beforeEach(async () => {
    await controller.reducers.resetDemo({});
    const project = [...controller.db.project.iter()].find((p) => p.name === 'Oakland deployment')!;
    projectId = project.id;
    seededWorkItemId = [...controller.db.workItem.iter()].find((w) => w.projectId === projectId)!.id;
    // Other connections see the reset asynchronously.
    await Promise.all([agent, accountant].map((c) => waitFor(c, () => c.db.workItem.id.find(seededWorkItemId))));
  });

  async function newWorkItem(title = `test ${Math.random()}`) {
    await agent.reducers.openWorkItem({ projectId, title, assignedRole: 'controller' });
    return [...agent.db.workItem.iter()].find((w) => w.title === title)!;
  }
  async function newCalculation(workItemId: bigint) {
    await agent.reducers.recordCalculation({
      workItemId, forecastSourceId: 0n, inputsJson: '{}', progressBp: 6000,
      cumRevenueCents: 60000000n, contractAssetCents: 10000000n, marginCents: 24000000n, lossWarning: false,
    });
    return maxBy([...agent.db.calculation.iter()].filter((c) => c.workItemId === workItemId))!;
  }
  async function proposeOn(workItemId: bigint, calculationId: bigint) {
    await agent.reducers.propose({
      workItemId, calculationId, entryJson: ENTRY, explanation: 'test', evidenceSourceIdsCsv: '', pendingConventionJson: '',
    });
    return [...agent.db.proposal.iter()].find((p) => p.workItemId === workItemId && p.calculationId === calculationId)!;
  }
  async function approvedProposal() {
    const w = await newWorkItem();
    const p = await proposeOn(w.id, (await newCalculation(w.id)).id);
    await waitFor(controller, () => controller.db.proposal.id.find(p.id));
    await controller.reducers.decide({ proposalId: p.id, revision: p.revision, decision: 'approve', reason: '' });
    return p;
  }

  it('control 2: ambiguous note -> awaiting_clarification, no new proposal', async () => {
    const w = await newWorkItem();
    const proposalsBefore = agent.db.proposal.count();
    const text = 'we need another $200,000 to finish';
    await agent.reducers.addSource({ projectId, kind: 'note', text, parentSourceId: 0n, version: 1 });
    const src = maxBy([...agent.db.source.iter()].filter((s) => s.text === text))!;
    await agent.reducers.recordExtraction({ sourceId: src.id, reader: 'claude', factsJson: '{}', ambiguityFlag: true, ambiguityText: 'additional or total?' });
    await agent.reducers.openClarification({ workItemId: w.id, convexId: 'test', question: 'Is the $200,000 additional to the remaining estimate?' });
    expect(agent.db.workItem.id.find(w.id)!.status).toBe('awaiting_clarification');
    expect(agent.db.proposal.count()).toBe(proposalsBefore);
    const ref = [...agent.db.clarificationRef.iter()].find((c) => c.workItemId === w.id)!;
    expect(ref.sourceId).toBe(src.id);
  });

  it('control 3: same postingRef twice -> duplicate_posting', async () => {
    const p = await approvedProposal();
    await controller.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: 'TEST-R1' });
    const err = await controller.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: 'TEST-R1' }).then(() => '', (e) => String(e.message));
    expect(err).toMatch(/duplicate_posting/);
    // the refusal is recorded by the caller (rollback leaves no row otherwise)
    await controller.reducers.recordRejection({ projectId: 0n, reducer: 'post', message: err });
    const row = await waitFor(controller, () => [...controller.db.historyEvent.iter()].find((h) => h.kind === 'rejected' && h.summary.includes('duplicate_posting')));
    expect(row.actor).toBe('Dana');
  });

  it('control 4: post as accountant -> role', async () => {
    const p = await approvedProposal();
    await expect(accountant.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: 'TEST-ACC' })).rejects.toThrow(/role: requires controller/);
  });

  it('control 5: new source after propose -> stale; decide rejects stale', async () => {
    const p2 = await proposeOn(seededWorkItemId, (await newCalculation(seededWorkItemId)).id);
    expect(p2.revision).toBe(2);
    await agent.reducers.addSource({ projectId, kind: 'forecast', text: 'forecast v3', parentSourceId: 0n, version: 3 });
    expect(agent.db.proposal.id.find(p2.id)!.status).toBe('stale');
    await waitFor(controller, () => (controller.db.proposal.id.find(p2.id)?.status === 'stale' ? true : undefined));
    await expect(controller.reducers.decide({ proposalId: p2.id, revision: 2, decision: 'approve', reason: '' })).rejects.toThrow(/stale/);
  });

  it('propose is idempotent per calculationId', async () => {
    const w = await newWorkItem();
    const c = await newCalculation(w.id);
    await proposeOn(w.id, c.id);
    await proposeOn(w.id, c.id);
    expect([...agent.db.proposal.iter()].filter((p) => p.workItemId === w.id).length).toBe(1);
  });

  it('addSource: invoice proposal (calculationId 0) survives, revenue proposal goes stale', async () => {
    const inv = await newWorkItem();
    const rev = await newWorkItem();
    const pi = await proposeOn(inv.id, 0n);
    const pr = await proposeOn(rev.id, (await newCalculation(rev.id)).id);
    await agent.reducers.addSource({ projectId, kind: 'forecast', text: 'forecast v4', parentSourceId: 0n, version: 4 });
    expect(agent.db.proposal.id.find(pi.id)!.status).toBe('open');
    expect(agent.db.workItem.id.find(inv.id)!.status).not.toBe('stale');
    expect(agent.db.proposal.id.find(pr.id)!.status).toBe('stale');
  });

  it('closePeriod then post -> period_closed', async () => {
    const p = await approvedProposal();
    await controller.reducers.closePeriod({ projectId });
    await expect(controller.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: 'TEST-CLOSED' })).rejects.toThrow(/period_closed/);
  });

  it('recordCalculation is idempotent per (workItem, forecastSource)', async () => {
    const w = await newWorkItem();
    const args = { workItemId: w.id, forecastSourceId: 7n, inputsJson: '{}', progressBp: 6000, cumRevenueCents: 1n, contractAssetCents: 1n, marginCents: 1n, lossWarning: false };
    await agent.reducers.recordCalculation(args);
    await agent.reducers.recordCalculation(args);
    expect([...agent.db.calculation.iter()].filter((c) => c.workItemId === w.id).length).toBe(1);
  });

  it('openClarification twice -> one ref; resolveClarification twice -> one clarification source', async () => {
    const w = await newWorkItem();
    const text = `ambiguous ${Math.random()}`;
    await agent.reducers.addSource({ projectId, kind: 'note', text, parentSourceId: 0n, version: 1 });
    const src = maxBy([...agent.db.source.iter()].filter((s) => s.text === text))!;
    await agent.reducers.recordExtraction({ sourceId: src.id, reader: 'claude', factsJson: '{}', ambiguityFlag: true, ambiguityText: 'x' });
    await agent.reducers.openClarification({ workItemId: w.id, convexId: 'a', question: 'q?' });
    await agent.reducers.openClarification({ workItemId: w.id, convexId: 'b', question: 'q?' });
    const refs = [...agent.db.clarificationRef.iter()].filter((c) => c.sourceId === src.id);
    expect(refs.length).toBe(1);
    const before = agent.db.source.count();
    await agent.reducers.resolveClarification({ clarificationId: refs[0].id, answer: 'additional', speaker: 'owner', audioStorageId: '' });
    await agent.reducers.resolveClarification({ clarificationId: refs[0].id, answer: 'additional', speaker: 'owner', audioStorageId: '' });
    expect(agent.db.source.count()).toBe(before + 1n);
    expect([...agent.db.source.iter()].filter((s) => s.kind === 'clarification' && s.parentSourceId === src.id).length).toBe(1);
  });

  it('post with negative line -> bad_input', async () => {
    const w = await newWorkItem();
    const calc = await newCalculation(w.id);
    const bad = JSON.stringify([{ account: 'A', debit: '-5', credit: '0' }, { account: 'B', debit: '0', credit: '-5' }]);
    await agent.reducers.propose({ workItemId: w.id, calculationId: calc.id, entryJson: bad, explanation: 't', evidenceSourceIdsCsv: '', pendingConventionJson: '' });
    const p = [...agent.db.proposal.iter()].find((x) => x.workItemId === w.id)!;
    await waitFor(controller, () => controller.db.proposal.id.find(p.id));
    await controller.reducers.decide({ proposalId: p.id, revision: p.revision, decision: 'approve', reason: '' });
    await expect(controller.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: 'TEST-NEG' })).rejects.toThrow(/bad_input/);
  });

  it('logAgentEvent: agent inserts one row, accountant -> role', async () => {
    const summary = `ev-${Date.now()}`;
    await agent.reducers.logAgentEvent({ projectId, agent: 'summo', kind: 'read', summary, refTable: 'source', refId: 7n });
    await waitFor(agent, () => [...agent.db.agentEvent.iter()].find((e) => e.summary === summary));
    const rows = [...agent.db.agentEvent.iter()].filter((e) => e.summary === summary);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ projectId, agent: 'summo', kind: 'read', refTable: 'source', refId: 7n });
    await expect(accountant.reducers.logAgentEvent({ projectId, agent: 'x', kind: 'read', summary: 'n', refTable: '', refId: 0n })).rejects.toThrow(/role: requires agent/);
  });
  it('createProject is idempotent per name and opens an intake work item', async () => {
    const name = `Intake ${Math.random()}`;
    await accountant.reducers.createProject({ name, customer: 'Acme' });
    await accountant.reducers.createProject({ name, customer: 'Acme' });
    const ps = [...accountant.db.project.iter()].filter((p) => p.name === name);
    expect(ps.length).toBe(1);
    expect(ps[0]).toMatchObject({ customer: 'Acme', contractValueCents: 0n, periodOpen: true });
    const ws = [...accountant.db.workItem.iter()].filter((w) => w.projectId === ps[0].id);
    expect(ws.length).toBe(1);
    expect(ws[0]).toMatchObject({ title: 'Onboarding intake', status: 'intake', assignedRole: 'agent' });
    expect([...accountant.db.project.iter()].find((p) => p.name === 'Oakland deployment')!.customer).toBe('Aster Robotics');
  });

  it('recordIntake x4 + repeat; bad field; accountant -> role; propose on intake item -> proposed', async () => {
    const name = `Intake ${Math.random()}`;
    await agent.reducers.createProject({ name, customer: 'Acme' });
    const pid = [...agent.db.project.iter()].find((p) => p.name === name)!.id;
    const w = [...agent.db.workItem.iter()].find((x) => x.projectId === pid)!;
    const rec = (field: string, cents: bigint) => agent.reducers.recordIntake({ projectId: pid, field, cents, speaker: 'owner', text: `${field} said` });
    await rec('contract', 100000000n);
    await rec('incurred', 40000000n);
    await rec('remaining', 40000000n);
    await rec('billed', 30000000n);
    await rec('contract', 120000000n); // repeat updates in place
    const intake = [...agent.db.source.iter()].filter((s) => s.projectId === pid && s.kind === 'intake');
    expect(intake.length).toBe(4);
    expect(intake.find((s) => s.text.startsWith('contract='))!.text).toBe('contract=120000000 | owner: contract said');
    expect(agent.db.project.id.find(pid)!.contractValueCents).toBe(120000000n);
    await expect(rec('bogus', 1n)).rejects.toThrow(/bad_input/);
    await expect(accountant.reducers.recordIntake({ projectId: pid, field: 'billed', cents: 1n, speaker: 'x', text: '' })).rejects.toThrow(/role: requires agent/);
    await agent.reducers.addSource({ projectId: pid, kind: 'note', text: 'intake note', parentSourceId: 0n, version: 1 });
    expect(agent.db.workItem.id.find(w.id)!.status).toBe('intake');
    await proposeOn(w.id, (await newCalculation(w.id)).id);
    expect(agent.db.workItem.id.find(w.id)!.status).toBe('proposed');
  });

  it('resetDemo removes created projects, work items and sources', async () => {
    const name = `Intake ${Math.random()}`;
    await agent.reducers.createProject({ name, customer: 'Acme' });
    const pid = [...agent.db.project.iter()].find((p) => p.name === name)!.id;
    await agent.reducers.recordIntake({ projectId: pid, field: 'billed', cents: 1n, speaker: 'x', text: '' });
    await agent.reducers.resetDemo({});
    expect([...agent.db.project.iter()].map((p) => p.name)).toEqual(['Oakland deployment']);
    expect([...agent.db.workItem.iter()].some((w) => w.projectId === pid)).toBe(false);
    expect([...agent.db.source.iter()].some((s) => s.projectId === pid)).toBe(false);
  });
});
