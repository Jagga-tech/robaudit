import { schema, table, t } from 'spacetimedb/server';

const id = () => t.u64().primaryKey().autoInc();

const user = table({ name: 'user', public: true }, {
  identity: t.identity().primaryKey(),
  name: t.string(),
  role: t.string(), // accountant | deployment_manager | controller | agent
});

const project = table({ name: 'project', public: true }, {
  id: id(),
  name: t.string(),
  contractValueCents: t.i64(),
  periodOpen: t.bool(),
});

const policy = table({ name: 'policy', public: true }, {
  id: id(),
  version: t.u32(),
  text: t.string(),
  approvedBy: t.string(),
  approvedAt: t.timestamp(),
});

const convention = table({ name: 'convention', public: true }, {
  id: id(),
  projectCompanyScope: t.string(),
  template: t.string(),
  key: t.string(),
  value: t.string(),
  exampleSourceIds: t.string(), // csv
  policyVersion: t.u32(),
  approvedBy: t.string(),
});

const source = table({ name: 'source', public: true }, {
  id: id(),
  projectId: t.u64().index('btree'),
  kind: t.string(), // contract | cost_export | forecast | note | clarification | commissioning_log | invoice
  version: t.u32(),
  text: t.string(),
  parentSourceId: t.u64(), // 0 = none
  hash: t.string(),
  createdAt: t.timestamp(),
});

const extraction = table({ name: 'extraction', public: true }, {
  id: id(),
  sourceId: t.u64().index('btree'),
  reader: t.string(), // claude | gemini
  factsJson: t.string(),
  ambiguityFlag: t.bool(),
  ambiguityText: t.string(),
});

const clarificationRef = table({ name: 'clarification_ref', public: true }, {
  id: id(),
  workItemId: t.u64(),
  sourceId: t.u64(), // ambiguous source that triggered the question; 0 = unknown
  convexId: t.string(),
  question: t.string(),
  status: t.string(), // open | confirmed
  answer: t.string(),
  speaker: t.string(),
  confirmedAt: t.timestamp(), // UNIX_EPOCH until confirmed
  audioStorageId: t.string(),
});

const workItem = table({ name: 'work_item', public: true }, {
  id: id(),
  projectId: t.u64(),
  title: t.string(),
  status: t.string(), // open | awaiting_clarification | proposed | approved | posted | returned | held | stale
  assignedRole: t.string(),
});

const calculation = table({ name: 'calculation', public: true }, {
  id: id(),
  workItemId: t.u64(),
  forecastSourceId: t.u64(),
  inputsJson: t.string(),
  progressBp: t.u32(),
  cumRevenueCents: t.i64(),
  contractAssetCents: t.i64(),
  marginCents: t.i64(),
  lossWarning: t.bool(),
});

const proposal = table({
  name: 'proposal', public: true,
  indexes: [{ accessor: 'by_work_item', algorithm: 'btree', columns: ['workItemId'] }],
}, {
  id: id(),
  workItemId: t.u64(),
  calculationId: t.u64(),
  revision: t.u32(),
  entryJson: t.string(),
  explanation: t.string(),
  evidenceSourceIds: t.string(), // csv
  pendingConventionJson: t.string(), // '' when none
  status: t.string(), // open | stale | approved | returned | held (S0 seed: posted)
});

const approval = table({ name: 'approval', public: true }, {
  id: id(),
  proposalId: t.u64(),
  revision: t.u32(),
  decision: t.string(), // approve | return | hold
  by: t.string(),
  reason: t.string(),
  at: t.timestamp(),
});

const posting = table({ name: 'posting', public: true }, {
  id: id(),
  proposalId: t.u64(),
  revision: t.u32(),
  postingRef: t.string().unique(),
  linesJson: t.string(),
  postedBy: t.string(),
  postedAt: t.timestamp(),
});

const contractMilestone = table({ name: 'contract_milestone', public: true }, {
  id: id(),
  projectId: t.u64(),
  name: t.string(),
  amountCents: t.i64(),
  status: t.string(), // pending | met | invoiced
});

const historyEvent = table({ name: 'history_event', public: true }, {
  id: id(),
  projectId: t.u64(),
  kind: t.string(),
  refId: t.u64(),
  summary: t.string(),
  actor: t.string(),
  at: t.timestamp(),
});

const spacetimedb = schema({
  user, project, policy, convention, source, extraction, clarificationRef, workItem,
  calculation, proposal, approval, posting, contractMilestone, historyEvent,
});
export default spacetimedb;
