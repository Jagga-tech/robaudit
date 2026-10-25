// Inbox (/workbench): work items waiting on a person. Default route.
import type { Page } from '../lib/app';
import { esc, all, ago, tag, inbox, live, head } from '../lib/ui';

const LABEL: Record<string, string> = { awaiting_clarification: 'awaiting answer', proposed: 'proposed', held: 'held', returned: 'returned', stale: 'stale' };

const page: Page = {
  route: /^\/workbench\/?$/,
  title: 'Inbox',
  render(root, ctx) {
    const d = ctx.conn.db;
    const draw = () => {
      const rows = inbox(d, ctx.judge()?.name);
      const n = all(d.project.iter()).length;
      head({ sub: rows.length ? `${rows.length} ${rows.length === 1 ? 'item waits' : 'items wait'} on a person.` : 'Everything Summo proposes lands here first.' });
      root.innerHTML = rows.length
        ? `<table class="tbl rows"><thead><tr><th>Work item</th><th>Waiting on</th><th>Age</th><th>Status</th></tr></thead><tbody>${rows.map(({ w, who, at }) =>
            `<tr data-href="/workbench/projects/${w.projectId}"><td><a href="/workbench/projects/${w.projectId}">${esc(w.title)}</a></td><td>waiting on ${esc(who)}</td><td class="mono">${ago(at)}</td>` +
            `<td>${tag(LABEL[w.status] ?? w.status, w.status === 'proposed' ? '' : 'amber')}</td></tr>`).join('')}</tbody></table>`
        : `<p class="empty big">Nothing waits on a person. Summo is watching ${n} project${n === 1 ? '' : 's'}.</p>`;
    };
    const stop = live(ctx, draw);
    const stopJudge = ctx.convex.onUpdate(ctx.api.managers.current, {}, () => draw());
    const tick = setInterval(draw, 15000); // ages
    const onClick = (e: MouseEvent) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-href]');
      if (tr && !(e.target as HTMLElement).closest('a')) ctx.navigate(tr.dataset.href!);
    };
    root.addEventListener('click', onClick);
    return () => { stop(); stopJudge(); clearInterval(tick); root.removeEventListener('click', onClick); };
  },
};
export default page;
