import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectAs, waitFor, STDB_URI, type DbConnection } from '../src/index';

const up = await fetch(new URL('/v1/ping', STDB_URI)).then((r) => r.ok, () => false);
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
    await expect(controller.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: 'TEST-R1' })).rejects.toThrow(/duplicate_posting/);
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

  it('closePeriod then post -> period_closed', async () => {
    const p = await approvedProposal();
    await controller.reducers.closePeriod({ projectId });
    await expect(controller.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: 'TEST-CLOSED' })).rejects.toThrow(/period_closed/);
  });
});
