// Pure: ledger rows for one work item -> the event the Forge web trigger understands. No I/O, so it is the tested part.
export type Rows = {
  projects: { id: bigint; name: string }[];
  proposals: { id: bigint; workItemId: bigint; calculationId: bigint; revision: number; entryJson: string; explanation: string; status: string }[];
  calculations: { id: bigint; lossWarning: boolean; progressBp: number; marginCents: bigint }[];
  clarificationRefs: { workItemId: bigint; question: string; status: string }[];
  approvals: { proposalId: bigint; revision: number; decision: string; by: string; reason: string }[];
  postings: { proposalId: bigint; revision: number; postingRef: string; postedBy: string }[];
};
export type WorkItem = { id: bigint; projectId: bigint; title: string; status: string };
export type JiraEvent = { workItemId: string; title: string; project: string; status: string; headline: string; detail?: string; explanation?: string; entry?: string; actor?: string; labels: string[] };

const dollars = (cents: string | bigint) => `$${(Number(cents) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const entryText = (entryJson: string) => {
  try { return (JSON.parse(entryJson) as { account: string; debit: string; credit: string }[]).map((l) => (BigInt(l.debit) > 0n ? `Dr ${l.account} ${dollars(l.debit)}` : `Cr ${l.account} ${dollars(l.credit)}`)).join('\n'); }
  catch { return entryJson; }
};

export function buildEvent(r: Rows, w: WorkItem): JiraEvent {
  const project = r.projects.find((p) => p.id === w.projectId)?.name ?? `project ${w.projectId}`;
  const prop = r.proposals.filter((p) => p.workItemId === w.id).sort((a, b) => b.revision - a.revision)[0];
  const calc = prop && r.calculations.find((c) => c.id === prop.calculationId);
  const appr = prop && r.approvals.filter((a) => a.proposalId === prop.id && a.revision === prop.revision).at(-1);
  const post = prop && r.postings.find((p) => p.proposalId === prop.id && p.revision === prop.revision);
  const ev: JiraEvent = { workItemId: String(w.id), title: w.title, project, status: w.status, headline: `Status: ${w.status}`, labels: [] };
  switch (w.status) {
    case 'awaiting_clarification': {
      const q = r.clarificationRefs.filter((c) => c.workItemId === w.id).at(-1);
      ev.headline = 'Summo asked the deployment manager instead of guessing';
      ev.detail = q?.question;
      break;
    }
    case 'proposed':
      if (prop) {
        ev.headline = `Proposal rev ${prop.revision} for the controller`;
        ev.entry = entryText(prop.entryJson);
        ev.explanation = prop.explanation;
        if (calc) { ev.detail = `Progress ${(calc.progressBp / 100).toFixed(2)}%, expected margin ${dollars(calc.marginCents)}`; if (calc.lossWarning) ev.labels.push('loss-warning'); }
      }
      break;
    case 'approved': ev.headline = `Rev ${prop?.revision ?? '?'} approved`; ev.actor = appr?.by; ev.detail = appr?.reason || undefined; break;
    case 'returned': case 'held': ev.headline = `Rev ${prop?.revision ?? '?'} ${w.status} by the controller`; ev.actor = appr?.by; ev.detail = appr?.reason || undefined; ev.labels.push('needs-rework'); break;
    case 'posted': ev.headline = `Posted to the ledger, ref ${post?.postingRef ?? '?'}`; ev.actor = post?.postedBy; ev.entry = prop && entryText(prop.entryJson); break;
    case 'stale': ev.headline = 'Proposal stale: new evidence arrived before the decision'; break;
  }
  return ev;
}

// Pure: the agent_event summary the workbench shows next to a work item.
export const mirrorSummary = (issueKey: string, headline: string) => `${issueKey} · ${headline}`;
