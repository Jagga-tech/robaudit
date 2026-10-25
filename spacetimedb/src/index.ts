import { SenderError, t } from 'spacetimedb/server';
import { Timestamp } from 'spacetimedb';
import spacetimedb from './schema';
import { hash, log, requireRole, type Ctx } from './guards';
import { COMPANY, seedS0 } from './seed';

export { default } from './schema';

const fail = (code: string, msg: string): never => { throw new SenderError(`${code}: ${msg}`); };

function getWorkItem(ctx: Ctx, id: bigint) {
  return ctx.db.workItem.id.find(id) ?? fail('not_found', `work item ${id}`);
}
function setWorkItemStatus(ctx: Ctx, id: bigint, status: string) {
  const w = getWorkItem(ctx, id);
  ctx.db.workItem.id.update({ ...w, status });
  return w;
}
function latestRevision(ctx: Ctx, workItemId: bigint) {
  let max = 0;
  for (const p of ctx.db.proposal.by_work_item.filter(workItemId)) if (p.revision > max) max = p.revision;
  return max;
}
// Proposal must exist, be the latest revision, match the caller's revision, and not be stale.
function currentProposal(ctx: Ctx, proposalId: bigint, revision: number) {
  const p = ctx.db.proposal.id.find(proposalId) ?? fail('not_found', `proposal ${proposalId}`);
  if (p.status === 'stale') fail('stale', `proposal ${proposalId} is stale`);
  if (p.revision !== revision || latestRevision(ctx, p.workItemId) !== revision) {
    fail('revision', `proposal ${proposalId} revision ${p.revision}, caller sent ${revision}`);
  }
  return p;
}
function saveConventionRow(ctx: Ctx, template: string, key: string, value: string, exampleSourceIds: string, policyVersion: number, approvedBy: string) {
  return ctx.db.convention.insert({ id: 0n, projectCompanyScope: COMPANY, template, key, value, exampleSourceIds, policyVersion, approvedBy });
}

export const seed = spacetimedb.reducer((ctx) => { seedS0(ctx); });

export const resetDemo = spacetimedb.reducer((ctx) => {
  const projectId = seedS0(ctx);
  log(ctx, projectId, 'reset', projectId, 'Demo reset to S0');
});

export const registerDemoUser = spacetimedb.reducer(
  { name: t.string(), role: t.string() },
  (ctx, { name, role }) => {
    const roles = ['accountant', 'deployment_manager', 'controller', 'agent'];
    if (!roles.includes(role)) fail('role', `unknown role ${role}`);
    const row = { identity: ctx.sender, name, role };
    if (ctx.db.user.identity.find(ctx.sender)) ctx.db.user.identity.update(row); else ctx.db.user.insert(row);
    log(ctx, 0n, 'register_user', 0n, `${name} registered as ${role}`);
  }
);

export const logAgentEvent = spacetimedb.reducer(
  { projectId: t.u64(), agent: t.string(), kind: t.string(), summary: t.string(), refTable: t.string(), refId: t.u64() },
  (ctx, { projectId, agent, kind, summary, refTable, refId }) => {
    requireRole(ctx, 'agent');
    ctx.db.agentEvent.insert({ id: 0n, projectId, agent, kind, summary, refTable, refId, at: ctx.timestamp });
  }
);

// Failed attempts: a rejected reducer rolls back, so the caller records the refusal here. Any registered role may; actor is the caller.
export const recordRejection = spacetimedb.reducer(
  { projectId: t.u64(), reducer: t.string(), message: t.string() },
  (ctx, { projectId, reducer, message }) => {
    requireRole(ctx, 'accountant', 'deployment_manager', 'controller', 'agent');
    const pid = projectId !== 0n ? projectId : ctx.db.project.iter().next().value?.id ?? 0n; // ponytail: 0 = the demo's single project
    log(ctx, pid, 'rejected', 0n, `${reducer ? reducer + ' ' : ''}rejected: ${message.slice(0, 300)}`);
  }
);

export const addSource = spacetimedb.reducer(
  { projectId: t.u64(), kind: t.string(), text: t.string(), parentSourceId: t.u64(), version: t.u32() },
  (ctx, { projectId, kind, text, parentSourceId, version }) => {
    if (!ctx.db.project.id.find(projectId)) fail('not_found', `project ${projectId}`);
    const s = ctx.db.source.insert({ id: 0n, projectId, kind, version, text, parentSourceId, hash: hash(text), createdAt: ctx.timestamp });
    log(ctx, projectId, 'source_added', s.id, `${kind} v${version} added`);
    // New evidence invalidates any open proposal on this project.
    for (const w of [...ctx.db.workItem.iter()]) {
      if (w.projectId !== projectId) continue;
      // Only revenue proposals (calculationId != 0) go stale: a forecast change invalidates revenue estimates, not a met billing milestone.
      for (const p of [...ctx.db.proposal.by_work_item.filter(w.id)]) {
        if (p.status !== 'open' || p.calculationId === 0n) continue;
        ctx.db.proposal.id.update({ ...p, status: 'stale' });
        ctx.db.workItem.id.update({ ...w, status: 'stale' });
        log(ctx, projectId, 'proposal_stale', p.id, `Proposal rev ${p.revision} stale: new ${kind} source ${s.id}`);
      }
    }
  }
);

export const recordExtraction = spacetimedb.reducer(
  { sourceId: t.u64(), reader: t.string(), factsJson: t.string(), ambiguityFlag: t.bool(), ambiguityText: t.string() },
  (ctx, { sourceId, reader, factsJson, ambiguityFlag, ambiguityText }) => {
    requireRole(ctx, 'agent');
    const s = ctx.db.source.id.find(sourceId) ?? fail('not_found', `source ${sourceId}`);
    const e = ctx.db.extraction.insert({ id: 0n, sourceId, reader, factsJson, ambiguityFlag, ambiguityText });
    log(ctx, s.projectId, 'extraction', e.id, `${reader} read source ${sourceId}${ambiguityFlag ? ' (ambiguous)' : ''}`);
  }
);

export const openClarification = spacetimedb.reducer(
  { workItemId: t.u64(), convexId: t.string(), question: t.string() },
  (ctx, { workItemId, convexId, question }) => {
    requireRole(ctx, 'agent');
    const w = getWorkItem(ctx, workItemId);
    // The question is about the most recent ambiguous source on this project.
    let sourceId = 0n;
    for (const e of ctx.db.extraction.iter()) {
      if (!e.ambiguityFlag || e.sourceId <= sourceId) continue;
      if (ctx.db.source.id.find(e.sourceId)?.projectId === w.projectId) sourceId = e.sourceId;
    }
    if (sourceId !== 0n) for (const x of ctx.db.clarificationRef.iter()) if (x.sourceId === sourceId) return; // idempotent per source
    setWorkItemStatus(ctx, workItemId, 'awaiting_clarification');
    const c = ctx.db.clarificationRef.insert({
      id: 0n, workItemId, sourceId, convexId, question, status: 'open', answer: '', speaker: '',
      confirmedAt: Timestamp.UNIX_EPOCH, audioStorageId: '',
    });
    log(ctx, w.projectId, 'clarification_opened', c.id, question);
  }
);

export const resolveClarification = spacetimedb.reducer(
  { clarificationId: t.u64(), answer: t.string(), speaker: t.string(), audioStorageId: t.string() },
  (ctx, { clarificationId, answer, speaker, audioStorageId }) => {
    requireRole(ctx, 'agent');
    const c = ctx.db.clarificationRef.id.find(clarificationId) ?? fail('not_found', `clarification ${clarificationId}`);
    if (c.status !== 'open') return;
    const w = setWorkItemStatus(ctx, c.workItemId, 'open');
    const text = `Clarification from ${speaker}: Q: ${c.question} A: ${answer}`;
    const s = ctx.db.source.insert({ id: 0n, projectId: w.projectId, kind: 'clarification', version: 1, text, parentSourceId: c.sourceId, hash: hash(text), createdAt: ctx.timestamp });
    ctx.db.clarificationRef.id.update({ ...c, status: 'confirmed', answer, speaker, audioStorageId, confirmedAt: ctx.timestamp });
    log(ctx, w.projectId, 'clarification_confirmed', c.id, `${speaker}: ${answer} (source ${s.id})`);
  }
);

export const recordCalculation = spacetimedb.reducer(
  {
    workItemId: t.u64(), forecastSourceId: t.u64(), inputsJson: t.string(), progressBp: t.u32(),
    cumRevenueCents: t.i64(), contractAssetCents: t.i64(), marginCents: t.i64(), lossWarning: t.bool(),
  },
  (ctx, args) => {
    requireRole(ctx, 'agent');
    const w = getWorkItem(ctx, args.workItemId);
    if (args.forecastSourceId !== 0n) {
      for (const x of ctx.db.calculation.iter()) if (x.workItemId === args.workItemId && x.forecastSourceId === args.forecastSourceId) return; // idempotent per source
    }
    const c = ctx.db.calculation.insert({ id: 0n, ...args });
    log(ctx, w.projectId, 'calculation', c.id, `Progress ${args.progressBp} bp, cum revenue ${args.cumRevenueCents} cents${args.lossWarning ? ', LOSS' : ''}`);
  }
);

export const propose = spacetimedb.reducer(
  {
    workItemId: t.u64(), calculationId: t.u64(), entryJson: t.string(), explanation: t.string(),
    evidenceSourceIdsCsv: t.string(), pendingConventionJson: t.string(),
  },
  (ctx, { workItemId, calculationId, entryJson, explanation, evidenceSourceIdsCsv, pendingConventionJson }) => {
    requireRole(ctx, 'agent');
    if (calculationId !== 0n && ctx.db.calculation.id.find(calculationId)?.workItemId !== workItemId) fail('not_found', 'calculation');
    const existing = [...ctx.db.proposal.by_work_item.filter(workItemId)];
    if (existing.some((p) => p.calculationId === calculationId)) return; // idempotent retry
    const fsrc = calculationId !== 0n ? ctx.db.calculation.id.find(calculationId)?.forecastSourceId ?? 0n : 0n;
    if (fsrc !== 0n && existing.some((p) => p.status !== 'stale' && p.calculationId !== 0n && ctx.db.calculation.id.find(p.calculationId)?.forecastSourceId === fsrc)) return; // same source already proposed
    for (const p of existing) if (p.status === 'open') ctx.db.proposal.id.update({ ...p, status: 'stale' });
    const revision = existing.reduce((m, p) => Math.max(m, p.revision), 0) + 1;
    const w = setWorkItemStatus(ctx, workItemId, 'proposed');
    const p = ctx.db.proposal.insert({
      id: 0n, workItemId, calculationId, revision, entryJson, explanation,
      evidenceSourceIds: evidenceSourceIdsCsv, pendingConventionJson, status: 'open',
    });
    log(ctx, w.projectId, 'proposed', p.id, `Proposal rev ${revision} for ${w.title}`);
  }
);

export const decide = spacetimedb.reducer(
  { proposalId: t.u64(), revision: t.u32(), decision: t.string(), reason: t.string() },
  (ctx, { proposalId, revision, decision, reason }) => {
    const u = requireRole(ctx, 'controller');
    const status = ({ approve: 'approved', return: 'returned', hold: 'held' } as Record<string, string>)[decision]
      ?? fail('bad_input', 'unknown decision');
    const p = currentProposal(ctx, proposalId, revision);
    if (p.status !== 'open') fail('revision', `proposal ${proposalId} already ${p.status}`);
    ctx.db.proposal.id.update({ ...p, status });
    const w = setWorkItemStatus(ctx, p.workItemId, status);
    ctx.db.approval.insert({ id: 0n, proposalId, revision, decision, by: u.name, reason, at: ctx.timestamp });
    log(ctx, w.projectId, `decision_${decision}`, proposalId, `Rev ${revision} ${status} by ${u.name}${reason ? ': ' + reason : ''}`);
    if (decision === 'approve' && p.pendingConventionJson) {
      let c: { template: string; key: string; value: string };
      try { c = JSON.parse(p.pendingConventionJson); } catch { return fail('bad_input', 'pendingConventionJson is not valid JSON'); }
      const conv = saveConventionRow(ctx, c.template, c.key, c.value, p.evidenceSourceIds,
        ctx.db.policy.iter().next().value?.version ?? 0, u.name);
      log(ctx, w.projectId, 'convention_saved', conv.id, `${c.template}.${c.key} = ${c.value}`);
    }
  }
);

export const post = spacetimedb.reducer(
  { proposalId: t.u64(), revision: t.u32(), postingRef: t.string() },
  (ctx, { proposalId, revision, postingRef }) => {
    // Checks in spec order: role, approved, revision current, period open, balanced, unique ref.
    const u = requireRole(ctx, 'controller');
    const p0 = ctx.db.proposal.id.find(proposalId) ?? fail('not_approved', `proposal ${proposalId} not found`);
    // 'posted' only occurs on the S0 seeded proposal; live posts leave status 'approved'.
    if (p0.status !== 'approved' && p0.status !== 'posted') fail('not_approved', `proposal ${proposalId} is ${p0.status}`);
    const p = currentProposal(ctx, proposalId, revision);
    const w = getWorkItem(ctx, p.workItemId);
    const proj = ctx.db.project.id.find(w.projectId) ?? fail('not_found', `project ${w.projectId}`);
    if (!proj.periodOpen) fail('period_closed', `period closed for ${proj.name}`);
    let lines: { account: string; debit: string; credit: string }[];
    let dr = 0n, cr = 0n;
    try {
      lines = JSON.parse(p.entryJson);
      for (const l of lines) {
        const d = BigInt(l.debit), c = BigInt(l.credit);
        if (d < 0n || c < 0n) throw new Error('negative');
        dr += d; cr += c;
      }
    } catch { return fail('bad_input', 'entryJson'); }
    if (lines.length === 0 || dr !== cr) fail('unbalanced', `debits ${dr} != credits ${cr}`);
    if (ctx.db.posting.postingRef.find(postingRef)) fail('duplicate_posting', `postingRef ${postingRef} already posted`);
    for (const x of ctx.db.posting.iter()) if (x.proposalId === proposalId) fail('duplicate_posting', `proposal ${proposalId} already posted as ${x.postingRef}`);
    const pg = ctx.db.posting.insert({ id: 0n, proposalId, revision, postingRef, linesJson: p.entryJson, postedBy: u.name, postedAt: ctx.timestamp });
    ctx.db.workItem.id.update({ ...w, status: 'posted' });
    log(ctx, w.projectId, 'posted', pg.id, `${postingRef} posted (rev ${revision}) by ${u.name}`);
  }
);

export const openWorkItem = spacetimedb.reducer(
  { projectId: t.u64(), title: t.string(), assignedRole: t.string() },
  (ctx, { projectId, title, assignedRole }) => {
    requireRole(ctx, 'agent');
    if (!ctx.db.project.id.find(projectId)) fail('not_found', `project ${projectId}`);
    const w = ctx.db.workItem.insert({ id: 0n, projectId, title, status: 'open', assignedRole });
    log(ctx, projectId, 'work_item_opened', w.id, title);
  }
);

export const markMilestoneMet = spacetimedb.reducer(
  { milestoneId: t.u64(), evidenceSourceId: t.u64() },
  (ctx, { milestoneId, evidenceSourceId }) => {
    requireRole(ctx, 'agent');
    const m = ctx.db.contractMilestone.id.find(milestoneId) ?? fail('not_found', `milestone ${milestoneId}`);
    ctx.db.contractMilestone.id.update({ ...m, status: 'met' });
    log(ctx, m.projectId, 'milestone_met', milestoneId, `${m.name} met (evidence source ${evidenceSourceId})`);
  }
);

export const closePeriod = spacetimedb.reducer(
  { projectId: t.u64() },
  (ctx, { projectId }) => {
    requireRole(ctx, 'controller');
    const proj = ctx.db.project.id.find(projectId) ?? fail('not_found', `project ${projectId}`);
    ctx.db.project.id.update({ ...proj, periodOpen: false });
    log(ctx, projectId, 'period_closed', projectId, `Period closed for ${proj.name}`);
  }
);

export const saveConvention = spacetimedb.reducer(
  { template: t.string(), key: t.string(), value: t.string(), exampleSourceIdsCsv: t.string(), policyVersion: t.u32() },
  (ctx, { template, key, value, exampleSourceIdsCsv, policyVersion }) => {
    const u = requireRole(ctx, 'controller');
    const c = saveConventionRow(ctx, template, key, value, exampleSourceIdsCsv, policyVersion, u.name);
    log(ctx, 0n, 'convention_saved', c.id, `${template}.${key} = ${value}`);
  }
);
