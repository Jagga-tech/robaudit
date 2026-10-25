// Close (/workbench/close): period status per project, what was posted, what is still unposted, and closePeriod.
// The ledger has no reopen reducer; after closing, post() refuses with period_closed until a demo reset re-seeds.
import type { Page } from '../lib/app';
import { call, codeOf, type DbConnection } from '../lib/ledger';
import { esc, all, byId, last, tag, usd, project, live, head } from '../lib/ui';

type Line = { account: string; debit: string; credit: string };
const amount = (json: string) => { try { return (JSON.parse(json) as Line[]).reduce((n, l) => n + BigInt(l.debit), 0n); } catch { return 0n; } };

const page: Page = {
  route: /^\/workbench\/close\/?$/,
  title: 'Close',
  render(root, ctx) {
    const d: DbConnection['db'] = ctx.conn.db;
    const proof = new Map<bigint, string>(); // projectId -> last "Try to post" result
    const draw = () => {
      const ps = all(d.project.iter()).sort(byId).map((p) => project(d, p.id)!);
      const open = ps.filter((x) => x.proj.periodOpen).length;
      head({ sub: `${open} of ${ps.length} period${ps.length === 1 ? '' : 's'} open · September 2026` });
      root.innerHTML = ps.map((x) => {
        const unposted = x.proposals.filter((p) => (p.status === 'open' || p.status === 'approved') && !x.postingOf(p.id));
        const closed = !x.proj.periodOpen;
        return `<section class="closeblock"><div class="ctitle"><h2>${esc(x.proj.name)}</h2>${closed ? tag('period closed') : tag('period open', 'ok')}</div>` +
          `<h3>Entries posted this period</h3>` +
          (x.postings.length ? `<table class="tbl"><thead><tr><th>Ref</th><th class="num">Amount</th><th>Approver</th><th>Time</th></tr></thead><tbody>${[...x.postings].reverse().map((pg) =>
            `<tr><td class="mono">${esc(pg.postingRef)}</td><td class="num">${usd(amount(pg.linesJson))}</td><td>${esc(pg.postedBy)}</td><td class="mono">${pg.postedAt.toDate().toLocaleString()}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Nothing posted yet.</p>') +
          `<h3>Unposted proposals</h3>` +
          (unposted.length ? `<ul class="plain">${unposted.map((p) => `<li><a href="/workbench/projects/${x.proj.id}/proposals">Rev ${p.revision} · ${esc(x.items.find((w) => w.id === p.workItemId)?.title ?? '')}</a> ${tag(p.status === 'open' ? 'awaiting Dana' : p.status, 'amber')}</li>`).join('')}</ul>` : '<p class="empty">None. Every proposal is posted, returned, held or superseded.</p>') +
          `<div class="acts">` + (closed
            ? `<button class="pill outline sm" type="button" data-try="${x.proj.id}">Try to post</button>`
            : `<button class="pill dark sm" type="button" data-close="${x.proj.id}">Close period</button>`) + `</div>` +
          (closed ? `<p class="small">The period is closed. <code>post</code> now refuses every entry for this project with <code>period_closed</code>. The ledger has no reopen: only a demo reset opens it again.</p>`
            : unposted.length ? `<p class="small warnline">${unposted.length} proposal${unposted.length === 1 ? '' : 's'} still unposted. Closing now leaves ${unposted.length === 1 ? 'it' : 'them'} out of this period.</p>`
            : `<p class="small">Closing is final in this ledger: there is no reopen.</p>`) +
          (proof.get(x.proj.id) ?? '') + `</section>`;
      }).join('');
    };

    const onClick = async (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-close],[data-try]');
      if (!t) return;
      t.disabled = true;
      if (t.dataset.close) {
        const x = project(d, BigInt(t.dataset.close))!;
        if (!confirm(`Close the period for ${x.proj.name}? The ledger cannot reopen it.`)) { t.disabled = false; return; }
        const err = await call(ctx.conn.reducers.closePeriod({ projectId: x.proj.id }));
        if (err) { ctx.toast(`Refused · ${err}`, 'error'); ctx.summo('refused', codeOf(err)); } else ctx.toast(`Period closed for ${x.proj.name}`, 'ok');
      } else {
        // post() checks the period before the duplicate ref, so re-posting the latest approved revision under a fresh ref isolates the period check
        const x = project(d, BigInt(t.dataset.try!))!;
        const p = last(x.items.map((w) => x.latestOf(w.id)).filter((p) => !!p && (p.status === 'approved' || p.status === 'posted')).sort(byId as any));
        if (!p) { proof.set(x.proj.id, '<p class="refusal info">No approved proposal to try.</p>'); draw(); return; }
        const err = await call(ctx.conn.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: `TRY-${Date.now()}` }));
        proof.set(x.proj.id, err ? `<p class="refusal"><b>Refused ·</b> ${esc(err)}</p>` : '<p class="refusal info">Accepted: the ledger did not refuse this.</p>');
        if (err) { ctx.summo('refused', codeOf(err)); ctx.toast(`Refused · ${err}`, 'error'); }
        draw();
      }
    };
    root.addEventListener('click', onClick);
    const stop = live(ctx, draw);
    return () => { stop(); root.removeEventListener('click', onClick); };
  },
};
export default page;
