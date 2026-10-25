// Shared helpers for the workbench shell and its pages (moved out of the old single-page workbench.ts).
import type { DbConnection } from '@keel/bindings';
import { usd, dollars, pct } from './ledger';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const clip = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const all = <T>(it: Iterable<T>) => [...it];
export const byId = (a: { id: bigint }, b: { id: bigint }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const last = <T>(xs: T[]) => xs[xs.length - 1] as T | undefined;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
export { usd, dollars, pct };

export const ICON: Record<string, string> = {
  note: 'M4 5h16v10H9l-5 4z',
  readers: 'M12 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 8v4l3 2M3 12h2M19 12h2',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  calc: 'M5 3h14v18H5zM8 7h8M8 12h3M13 12h3M8 16h3M13 16h3',
  check: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-4',
  doc: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3',
};
export const KIND: Record<string, string> = {
  contract: 'Contract', cost_export: 'Cost export', forecast: 'Forecast', invoice: 'Invoice', note: 'Site note',
  clarification: 'Clarification', commissioning_log: 'Commissioning log', scanned_forecast: 'Forecast sheet (photo)',
};
export const READER: Record<string, string> = { claude: 'Claude', gemini: 'Gemini', 'azure-di': 'Azure Document Intelligence' };
export const ACCOUNT: Record<string, string> = { Revenue: 'Revenue', ContractAsset: 'Contract asset', AccountsReceivable: 'Accounts receivable' };

/** Ruled activity row (icon, title, sub line, tag). */
export function card(ic: string, title: string, sub: string, tag: string, tone = '') {
  return `<li class="card"><div class="ibox"><svg viewBox="0 0 24 24"><path d="${ICON[ic] ?? ICON.doc}"/></svg></div>` +
    `<div><b>${esc(title)}</b><i>${esc(sub)}</i></div><span class="tag ${tone}">${esc(tag)}</span></li>`;
}
export const tag = (text: string, tone = '') => `<span class="tag ${tone}">${esc(text)}</span>`;

export function sourceLabel(s: { kind: string; version: number; text: string }) {
  if (s.kind === 'forecast') return `Forecast v${s.version}`;
  if (s.kind === 'note') return `Site note · “${clip(s.text, 30)}”`;
  if (s.kind === 'clarification') {
    const who = s.text.match(/Clarification from ([^:]+):/)?.[1] ?? 'Manager', a = s.text.match(/A: (.*)$/)?.[1] ?? '';
    return `${who}: “${a}”`;
  }
  return KIND[s.kind] ?? s.kind;
}

export function ago(d: Date | undefined) {
  if (!d) return '';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
}

type Db = DbConnection['db'];
/** Latest proposal per work item, the posting for a proposal, and the work item's latest calculation. */
export function project(d: Db, projectId: bigint) {
  const proj = d.project.id.find(projectId);
  if (!proj) return null;
  const items = all(d.workItem.iter()).filter((w) => w.projectId === projectId).sort(byId);
  const wids = new Set(items.map((w) => w.id));
  const proposals = all(d.proposal.iter()).filter((p) => wids.has(p.workItemId)).sort((a, b) => a.revision - b.revision || byId(a, b));
  const postings = all(d.posting.iter()).sort(byId);
  const pids = new Set(proposals.map((p) => p.id));
  const calcs = all(d.calculation.iter()).filter((c) => wids.has(c.workItemId)).sort(byId);
  const postingOf = (pid: bigint) => postings.find((x) => x.proposalId === pid);
  const latestOf = (wid: bigint) => last(proposals.filter((p) => p.workItemId === wid));
  // the revenue work item: titled after the project (the invoice item is opened later by Summo)
  const main = items.find((w) => w.title.startsWith(proj.name)) ?? items[0];
  return { proj, items, main, proposals, postings: postings.filter((x) => pids.has(x.proposalId)), calcs, cur: last(calcs.filter((c) => c.workItemId === main?.id)), postingOf, latestOf };
}

/** Status shown for a proposal: posted wins over the stored status (a live post leaves it 'approved'). */
export const proposalStatus = (p: { id: bigint; status: string }, postingOf: (id: bigint) => unknown) => (postingOf(p.id) ? 'posted' : p.status);
export const statusTone = (s: string) => (s === 'posted' || s === 'approved' ? 'ok' : s === 'stale' || s === 'awaiting_clarification' || s === 'held' || s === 'returned' ? 'amber' : '');

export const INBOX = ['awaiting_clarification', 'proposed', 'held', 'returned', 'stale'];
/** Work items waiting on a person, newest activity first. */
export function inbox(d: Db, judge: string | undefined) {
  const events = all(d.historyEvent.iter());
  const refs = all(d.clarificationRef.iter()), props = all(d.proposal.iter());
  return all(d.workItem.iter()).filter((w) => INBOX.includes(w.status)).map((w) => {
    // age = the last event that touched this work item (opened, asked, proposed, decided, went stale)
    const mine = (e: (typeof events)[number]) =>
      (e.kind === 'work_item_opened' && e.refId === w.id) ||
      (e.kind === 'clarification_opened' && refs.some((r) => r.id === e.refId && r.workItemId === w.id)) ||
      (/^(proposed|proposal_stale|decision_)/.test(e.kind) && props.some((p) => p.id === e.refId && p.workItemId === w.id));
    const at = events.filter(mine).sort(byId).pop()?.at.toDate();
    return { w, who: w.status === 'awaiting_clarification' ? judge ?? 'the manager' : 'Dana', at };
  }).sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}

/** Draw now and again (once per frame) on every ledger change; returns the unsubscribe. */
export function live(ctx: { onChange: (cb: () => void) => () => void }, draw: () => void) {
  let queued = false;
  draw();
  return ctx.onChange(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } });
}

/** Fill the shell's page title row (title, one-line subtitle, actions html). */
export function head(o: { title?: string; sub?: string; actions?: string }) {
  const ph = document.querySelector('.ph');
  if (!ph) return;
  if (o.title !== undefined) ph.querySelector('h1')!.textContent = o.title;
  if (o.sub !== undefined) ph.querySelector('.sub')!.textContent = o.sub;
  if (o.actions !== undefined) ph.querySelector('.pacts')!.innerHTML = o.actions;
}

/** Replace innerHTML only when it changed (keeps focus and avoids replaying entry animations on unrelated ledger changes). */
export function setHtml(el: HTMLElement, html: string) {
  if ((el as any)._html !== html) { (el as any)._html = html; el.innerHTML = html; }
}

/** A document-vs-ledger disagreement the agent recorded on a source's azure-di extraction (latest wins); null when none or unparsable. */
export type Disagreement = { document: bigint; ledger: bigint; trusted: string; reason: string };
export function disagreement(d: Db, sourceId: bigint): Disagreement | null {
  const x = all(d.extraction.iter()).filter((e) => e.sourceId === sourceId && e.reader === 'azure-di').sort(byId).pop();
  if (!x) return null;
  try {
    const g = JSON.parse(x.factsJson)?.disagreement;
    if (!g || g.document == null || g.ledger == null) return null;
    return { document: BigInt(g.document), ledger: BigInt(g.ledger), trusted: String(g.trusted ?? ''), reason: String(g.reason ?? '') };
  } catch { return null; }
}
export const trustedLabel = (g: Disagreement) => (g.trusted === 'cost_export' ? 'cost export' : 'sheet');
export const disagreeLine = (g: Disagreement) => `Sheet ${usd(g.document)} · cost export ${usd(g.ledger)} · trusted: ${trustedLabel(g)}`;
export const DISAGREE = 'sources disagree';

/** The return/hold decision behind a returned or held work item (the approval row on its latest proposal). */
export function decisionOf(d: Db, w: { id: bigint; status: string }) {
  if (w.status !== 'returned' && w.status !== 'held') return null;
  const pids = new Set(all(d.proposal.iter()).filter((p) => p.workItemId === w.id).map((p) => p.id));
  const a = all(d.approval.iter()).filter((x) => pids.has(x.proposalId) && (x.decision === 'return' || x.decision === 'hold')).sort(byId).pop();
  return a ? { by: a.by, reason: a.reason, held: a.decision === 'hold', proposalId: a.proposalId } : null;
}
/** "Returned by Dana: <reason>" / "On hold by Dana: <reason>". */
export const decisionText = (a: { by: string; reason: string; held: boolean }) => `${a.held ? 'On hold' : 'Returned'} by ${a.by}${a.reason ? ': ' + a.reason : ''}`;

/** The input guard's flag on a source (extraction reader `guard`, factsJson { flagged, reasons }); null when not flagged. */
export function guardFlag(d: Db, sourceId: bigint): { reasons: string[] } | null {
  const x = all(d.extraction.iter()).filter((e) => e.sourceId === sourceId && e.reader === 'guard').sort(byId).pop();
  if (!x) return null;
  try { const f = JSON.parse(x.factsJson); return f?.flagged ? { reasons: Array.isArray(f.reasons) ? f.reasons.map(String) : [] } : null; } catch { return null; }
}

/** Jira mirror (apps/jira-bridge logs agent_event agent 'jira-mirror', kind 'mirror', summary '<KEY> · <headline>', ref work_item). */
export const JIRA_SITE: string = import.meta.env.VITE_JIRA_SITE ?? 'https://one-atlas-udgh.atlassian.net';
export const jiraUrl = (key: string) => `${JIRA_SITE}/browse/${encodeURIComponent(key)}`;
export const jiraKey = (summary: string) => { const i = summary.indexOf(' · '); return (i < 0 ? summary : summary.slice(0, i)).trim(); };
/** jira-mirror rows, oldest first; [] when the ledger has no agent_event table (or it is not subscribed yet). */
export function jiraEvents(d: Db) {
  try { return all(d.agentEvent.iter()).filter((e) => e.agent === 'jira-mirror').sort(byId); } catch { return []; }
}
/** Latest mirror event for a work item → its Jira issue; null when none. */
export function jiraFor(conn: DbConnection, workItemId: bigint) {
  const e = last(jiraEvents(conn.db).filter((x) => x.kind === 'mirror' && x.refTable === 'work_item' && x.refId === workItemId));
  if (!e) return null;
  const key = jiraKey(e.summary), i = e.summary.indexOf(' · ');
  return key ? { key, url: jiraUrl(key), headline: i < 0 ? '' : e.summary.slice(i + 3), at: e.at.toDate() } : null;
}
export const jiraChip = (j: { key: string; url: string } | null) =>
  j ? `<a class="jira" href="${esc(j.url)}" target="_blank" rel="noopener" title="Open ${esc(j.key)} in Jira">${esc(j.key)} ↗</a>` : '';
