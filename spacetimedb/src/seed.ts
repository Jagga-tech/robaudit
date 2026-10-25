import S from '../../demo/seed.json';
import { hash, log, type Ctx } from './guards';

export const COMPANY = S.project.company;

export function seedS0(ctx: Ctx) {
  const d = ctx.db;
  // ponytail: `user` rows survive a reset so registered demo identities keep their roles
  for (const tbl of [d.project, d.policy, d.convention, d.source, d.extraction, d.clarificationRef, d.workItem,
    d.calculation, d.proposal, d.approval, d.posting, d.contractMilestone, d.historyEvent]) tbl.clear();

  const now = ctx.timestamp;
  const p = d.project.insert({ id: 0n, name: S.project.name, contractValueCents: BigInt(S.project.contractValueCents), periodOpen: S.project.periodOpen });
  d.policy.insert({ id: 0n, version: S.policy.version, text: S.policy.text, approvedBy: S.policy.approvedBy, approvedAt: now });

  const srcIds: Record<string, bigint> = {};
  const noteIds: bigint[] = [];
  for (const s of S.sources) {
    const row = d.source.insert({ id: 0n, projectId: p.id, kind: s.kind, version: s.version, text: s.text, parentSourceId: 0n, hash: hash(s.text), createdAt: now });
    if (s.kind === 'note') noteIds.push(row.id); else srcIds[s.kind] = row.id;
  }

  d.convention.insert({ id: 0n, projectCompanyScope: COMPANY, ...S.convention, exampleSourceIds: noteIds.join(',') });
  d.contractMilestone.insert({ id: 0n, projectId: p.id, name: S.milestone.name, amountCents: BigInt(S.milestone.amountCents), status: S.milestone.status });

  const w = d.workItem.insert({ id: 0n, projectId: p.id, ...S.workItem });
  const c = S.calculation;
  const calc = d.calculation.insert({
    id: 0n, workItemId: w.id, forecastSourceId: srcIds.forecast,
    inputsJson: JSON.stringify({
      contractValueCents: String(S.project.contractValueCents), incurredCents: String(S.sources[1].incurredCents),
      remainingCents: String(S.sources[2].remainingCents), billedCents: String(S.sources[3].billedCents),
    }),
    progressBp: c.progressBp, cumRevenueCents: BigInt(c.cumRevenueCents), contractAssetCents: BigInt(c.contractAssetCents),
    marginCents: BigInt(c.marginCents), lossWarning: c.lossWarning,
  });
  const pr = S.proposal;
  const entryJson = JSON.stringify(pr.entry);
  const prop = d.proposal.insert({
    id: 0n, workItemId: w.id, calculationId: calc.id, revision: pr.revision, entryJson, explanation: pr.explanation,
    evidenceSourceIds: [srcIds.contract, srcIds.cost_export, srcIds.forecast, srcIds.invoice].join(','),
    pendingConventionJson: '', status: pr.status,
  });
  d.approval.insert({ id: 0n, proposalId: prop.id, revision: pr.revision, decision: 'approve', by: pr.postedBy, reason: 'S0 seed', at: now });
  d.posting.insert({ id: 0n, proposalId: prop.id, revision: pr.revision, postingRef: pr.postingRef, linesJson: entryJson, postedBy: pr.postedBy, postedAt: now });
  log(ctx, p.id, 'seed', p.id, 'S0 seeded');
  return p.id;
}
