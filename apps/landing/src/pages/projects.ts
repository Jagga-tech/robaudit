// Projects (/workbench/projects): one row per project with its latest calculation and proposal.
import type { Page } from '../lib/app';
import { esc, all, byId, tag, usd, pct, project, proposalStatus, statusTone, live, head, customerOf, intakeOf, onboarding } from '../lib/ui';

const page: Page = {
  route: /^\/workbench\/projects\/?$/,
  title: 'Projects',
  render(root, ctx) {
    const d = ctx.conn.db;
    const draw = () => {
      const ps = all(d.project.iter()).sort(byId).map((p) => project(d, p.id)!);
      head({ sub: `${ps.length} active contract${ps.length === 1 ? '' : 's'} · cost-to-cost revenue, recalculated on every source.` });
      root.innerHTML = `<table class="tbl rows"><thead><tr><th>Project</th><th>Customer</th><th class="num">Contract</th><th class="num">Complete</th><th class="num">Revenue recognized</th><th class="num">Margin</th><th>Latest proposal</th></tr></thead><tbody>${ps.map((x) => {
        const c = x.cur, p = x.main && x.latestOf(x.main.id), st = p ? proposalStatus(p, x.postingOf) : '';
        const intake = x.items.some((w) => onboarding(d, w)) ? intakeOf(d, x.proj.id) : null;
        return `<tr data-href="/workbench/projects/${x.proj.id}"><td><a href="/workbench/projects/${x.proj.id}">${esc(x.proj.name)}</a></td><td>${esc(customerOf(x.proj) || '—')}</td><td class="num">${usd(x.proj.contractValueCents)}</td>` +
          `<td class="num">${c ? pct(c.progressBp) : '—'}</td><td class="num">${c ? usd(c.cumRevenueCents) : '—'}</td>` +
          `<td class="num${c?.lossWarning ? ' amber' : ''}">${c ? usd(c.marginCents) : '—'}${c?.lossWarning ? ' ' + tag('loss', 'amber') : ''}</td>` +
          `<td>${intake ? tag(`Onboarding · ${intake.n} of 4 answered`, 'amber') : p ? `rev ${p.revision} ${tag(st === 'open' ? 'awaiting Dana' : st, st === 'open' ? 'amber' : statusTone(st))}` : '—'}</td></tr>`;
      }).join('')}</tbody></table>`;
    };
    const stop = live(ctx, draw);
    const onClick = (e: MouseEvent) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-href]');
      if (tr && !(e.target as HTMLElement).closest('a')) ctx.navigate(tr.dataset.href!);
    };
    root.addEventListener('click', onClick);
    return () => { stop(); root.removeEventListener('click', onClick); };
  },
};
export default page;
