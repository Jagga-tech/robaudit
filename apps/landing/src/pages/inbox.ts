// Inbox (/workbench): work items waiting on a person. Default route.
import type { Page } from '../lib/app';
import { ids, subscribeExtra } from '../lib/ledger';
import { esc, all, ago, tag, inbox, live, head, disagreement, decisionOf, decisionText, guardFlag, jiraFor, jiraChip } from '../lib/ui';
import './pages.css';

const LABEL: Record<string, string> = { awaiting_clarification: 'awaiting answer', proposed: 'proposed', held: 'held', returned: 'returned', stale: 'stale' };

const page: Page = {
  route: /^\/workbench\/?$/,
  title: 'Inbox',
  render(root, ctx) {
    const d = ctx.conn.db;
    const draw = () => {
      const rows = inbox(d, ctx.judge()?.name);
      const n = all(d.project.iter()).length;
      // one sub line per row: why it was returned/held, or how many sources disagree behind an open proposal
      const sub = (w: (typeof rows)[number]['w']) => {
        const a = decisionOf(d, w);
        if (a) return `${decisionText(a)} · waiting for new evidence`;
        if (!all(d.proposal.iter()).some((p) => p.workItemId === w.id && p.status === 'open')) return '';
        const k = all(d.source.iter()).filter((s) => s.projectId === w.projectId && disagreement(d, s.id)).length;
        return k ? `${k} source disagreement${k === 1 ? '' : 's'}` : '';
      };
      // flagged input: a guard-flagged source no proposal cites; Summo took no action, so it is not a work item
      const props = all(d.proposal.iter());
      const flags = all(d.source.iter()).map((s) => ({ s, g: guardFlag(d, s.id) })).filter(({ s, g }) => g && !props.some((p) => ids(p.evidenceSourceIds).includes(s.id))).reverse();
      const flagRow = ({ s, g }: (typeof flags)[number]) => `<tr data-href="/workbench/projects/${s.projectId}/sources"><td><a href="/workbench/projects/${s.projectId}/sources">Flagged input · ${esc(g!.reasons[0] ?? 'flagged')}</a><p class="small amber">Summo did not act on it. Dana decides.</p></td><td>Dana</td><td class="mono">${ago(s.createdAt.toDate())}</td><td>${tag('flagged', 'amber')}</td></tr>`;
      const total = rows.length + flags.length;
      head({ sub: total ? `${total} ${total === 1 ? 'item waits' : 'items wait'} on a person.` : 'Everything Summo proposes lands here first.' });
      root.innerHTML = total
        ? `<table class="tbl rows"><thead><tr><th>Work item</th><th>Waiting on</th><th>Age</th><th>Status</th></tr></thead><tbody>${flags.map(flagRow).join('')}${rows.map(({ w, who, at }) => { const a = decisionOf(d, w), line = sub(w); return (
            `<tr data-href="/workbench/projects/${w.projectId}"><td><a href="/workbench/projects/${w.projectId}">${esc(w.title)}</a>${jiraChip(jiraFor(ctx.conn, w.id))}${line ? `<p class="small${a ? ' amber' : ''}">${esc(line)}</p>` : ''}</td><td>${a ? 'waiting for new evidence' : `waiting on ${esc(who)}`}</td><td class="mono">${ago(at)}</td>` +
            `<td>${tag(LABEL[w.status] ?? w.status, w.status === 'proposed' ? '' : 'amber')}</td></tr>`); }).join('')}</tbody></table>`
        : `<p class="empty big">Nothing waits on a person. Summo is watching ${n} project${n === 1 ? '' : 's'}.</p>`;
    };
    const extra = subscribeExtra(ctx.conn, ['agent_event'], () => {}, () => {}); // Jira chips; a ledger without the table shows none
    const stop = live(ctx, draw);
    const stopJudge = ctx.convex.onUpdate(ctx.api.managers.current, {}, () => draw());
    const tick = setInterval(draw, 15000); // ages
    const onClick = (e: MouseEvent) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-href]');
      if (tr && !(e.target as HTMLElement).closest('a')) ctx.navigate(tr.dataset.href!);
    };
    root.addEventListener('click', onClick);
    return () => { stop(); try { extra.unsubscribe(); } catch {} stopJudge(); clearInterval(tick); root.removeEventListener('click', onClick); };
  },
};
export default page;
