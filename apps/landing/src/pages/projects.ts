// Projects (/workbench/projects): one row per project with its latest calculation and proposal.
import type { Page } from '../lib/app';
import { esc, all, byId, tag, usd, pct, project, proposalStatus, statusTone, live, head, customerOf, intakeOf, onboarding } from '../lib/ui';
import { call } from '../lib/ledger';

const page: Page = {
  route: /^\/workbench\/projects\/?$/,
  title: 'Projects',
  render(root, ctx) {
    const d = ctx.conn.db;
    const draw = () => {
      const ps = all(d.project.iter()).sort(byId).map((p) => project(d, p.id)!);
      head({ sub: `${ps.length} active contract${ps.length === 1 ? '' : 's'} · cost-to-cost revenue, recalculated on every source.` });
      root.innerHTML = `<table class="tbl rows"><thead><tr><th>Project</th><th>Customer</th><th class="num">Contract</th><th class="num">Complete</th><th class="num">Revenue recognized</th><th class="num">Margin</th><th>Latest proposal</th><th></th></tr></thead><tbody>${ps.map((x) => {
        const c = x.cur, p = x.main && x.latestOf(x.main.id), st = p ? proposalStatus(p, x.postingOf) : '';
        const intake = x.items.some((w) => onboarding(d, w)) ? intakeOf(d, x.proj.id) : null;
        return `<tr data-href="/workbench/projects/${x.proj.id}"><td><a href="/workbench/projects/${x.proj.id}">${esc(x.proj.name)}</a></td><td>${esc(customerOf(x.proj) || '—')}</td><td class="num">${usd(x.proj.contractValueCents)}</td>` +
          `<td class="num">${c ? pct(c.progressBp) : '—'}</td><td class="num">${c ? usd(c.cumRevenueCents) : '—'}</td>` +
          `<td class="num${c?.lossWarning ? ' amber' : ''}">${c ? usd(c.marginCents) : '—'}${c?.lossWarning ? ' ' + tag('loss', 'amber') : ''}</td>` +
          `<td>${intake ? tag(`Onboarding · ${intake.n} of 4 answered`, 'amber') : p ? `rev ${p.revision} ${tag(st === 'open' ? 'awaiting Dana' : st, st === 'open' ? 'amber' : statusTone(st))}` : '—'}</td>` +
          `<td class="num"><button class="pill quiet small-btn" data-del="${x.proj.id}" title="Delete this project and its records">Delete</button></td></tr>`;
      }).join('')}</tbody></table>`;
    };
    const stop = live(ctx, draw);
    const onClick = (e: MouseEvent) => {
      const del = (e.target as HTMLElement).closest<HTMLElement>('button[data-del]');
      if (del) {
        const id = BigInt(del.dataset.del!), name = d.project.id.find(id)?.name ?? 'this project';
        if (!confirm(`Delete ${name} and every record under it? This cannot be undone.`)) return;
        void call(ctx.conn.reducers.deleteProject({ projectId: id })).then((err) => ctx.toast(err ? `Refused · ${err}` : `${name} deleted`, err ? 'error' : 'ok'));
        return;
      }
      const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-href]');
      if (tr && !(e.target as HTMLElement).closest('a')) ctx.navigate(tr.dataset.href!);
    };
    root.addEventListener('click', onClick);
    return () => { stop(); root.removeEventListener('click', onClick); };
  },
};
export default page;
