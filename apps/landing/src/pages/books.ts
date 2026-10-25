// Books (/workbench/books): trial balance per project from POSTED entries only (posting.linesJson, the approved
// proposal's entryJson), then the journal. "Include unposted proposals" adds the open/approved latest revisions in grey.
import type { Page } from '../lib/app';
import { esc, all, byId, usd, project, live, head, setHtml, lines, ACCOUNT, customerOf, type Entry } from '../lib/ui';
import './pages.css';

const ACCOUNTS = ['Revenue', 'ContractAsset', 'AccountsReceivable', 'ContractLiability'];
let chosen: bigint | undefined, withPending = false; // survive re-mounts
    try { const q = new URLSearchParams(location.search).get('project'); if (q) chosen = BigInt(q); } catch {} // deep link ?project=<id>

const page: Page = {
  route: /^\/workbench\/books\/?$/,
  title: 'Books',
  render(root, ctx) {
    const d = ctx.conn.db;
    root.innerHTML = `<div class="books"><div class="bbar"><label>Project <select data-f="proj"></select></label><label class="tgl"><input type="checkbox" data-f="pend"${withPending ? ' checked' : ''}> Include unposted proposals</label></div><div data-f="body"></div></div>`;
    const sel = root.querySelector<HTMLSelectElement>('[data-f=proj]')!, out = root.querySelector<HTMLElement>('[data-f=body]')!;

    const draw = () => {
      const projs = all(d.project.iter()).sort(byId);
      // default: the project with the latest activity
      const latest = all(d.historyEvent.iter()).filter((e) => e.projectId !== 0n).sort(byId).pop()?.projectId;
      const pid = projs.some((p) => p.id === chosen) ? chosen! : latest ?? projs[0]?.id;
      setHtml(sel, projs.map((p) => `<option value="${p.id}"${p.id === pid ? ' selected' : ''}>${esc(p.name)}</option>`).join(''));
      const x = pid !== undefined ? project(d, pid) : null;
      if (!x) { head({ sub: 'No projects in the ledger.' }); setHtml(out, '<p class="empty">Nothing to show.</p>'); return; }
      head({ sub: `${x.proj.name}${customerOf(x.proj) ? ' · ' + customerOf(x.proj) : ''} · trial balance from posted entries` });

      const posted = x.postings.map((pg) => {
        const p = x.proposals.find((y) => y.id === pg.proposalId);
        const ls = lines(pg.linesJson);
        return { ref: pg.postingRef, at: pg.postedAt.toDate() as Date | undefined, by: pg.postedBy, ls: ls.length ? ls : lines(p?.entryJson ?? ''), pending: false };
      });
      const pending = x.items.map((w) => x.latestOf(w.id)).filter((p) => !!p && (p.status === 'open' || p.status === 'approved') && !x.postingOf(p.id))
        .map((p) => ({ ref: `Rev ${p!.revision} · unposted`, at: undefined as Date | undefined, by: p!.status === 'open' ? 'awaiting Dana' : 'approved', ls: lines(p!.entryJson), pending: true }));

      const net = (es: { ls: Entry[] }[]) => {
        const m = new Map<string, bigint>(ACCOUNTS.map((a) => [a, 0n]));
        for (const e of es) for (const l of e.ls) m.set(l.account, (m.get(l.account) ?? 0n) + l.debit - l.credit);
        return m;
      };
      const base = net(posted), all2 = net([...posted, ...pending]);
      const cols = (v: bigint) => `<td class="num">${v > 0n ? usd(v) : ''}</td><td class="num">${v < 0n ? usd(-v) : ''}</td>`;
      const tot = (m: Map<string, bigint>) => [...m.values()].reduce((a, v) => [a[0] + (v > 0n ? v : 0n), a[1] + (v < 0n ? -v : 0n)], [0n, 0n]);
      const [dr, cr] = tot(base), [pdr, pcr] = tot(all2);
      const pcols = (v: bigint) => (withPending ? `<td class="num grey">${v > 0n ? usd(v) : ''}</td><td class="num grey">${v < 0n ? usd(-v) : ''}</td>` : '');
      const balanced = dr === cr;

      // cost of revenue = incurred to date (latest calculation, else the intake answer); booked in the cost system, not this ledger
      let incurred: bigint | undefined;
      try { if (x.cur) incurred = BigInt(JSON.parse(x.cur.inputsJson).incurredCents); } catch {}
      if (incurred === undefined) { const s = all(d.source.iter()).filter((s) => s.projectId === x.proj.id && s.kind === 'intake' && s.text.startsWith('incurred=')).pop(); const m = s && /^incurred=(-?\d+)/.exec(s.text); if (m) incurred = BigInt(m[1]); }

      const entryRows = (e: (typeof posted)[number]) => e.ls.map((l, i) => `<tr class="${e.pending ? 'grey' : ''}${i === 0 ? ' first' : ''}">` +
        (i === 0 ? `<td class="mono" rowspan="${e.ls.length}">${esc(e.ref)}</td><td class="mono" rowspan="${e.ls.length}">${e.at ? e.at.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td><td rowspan="${e.ls.length}">${esc(e.by)}</td>` : '') +
        `<td class="${l.credit > 0n ? 'cracct' : ''}">${esc(ACCOUNT[l.account] ?? l.account)}</td><td class="num">${l.debit > 0n ? usd(l.debit) : ''}</td><td class="num">${l.credit > 0n ? usd(l.credit) : ''}</td></tr>`).join('');
      const journal = [...posted, ...(withPending ? pending : [])].filter((e) => e.ls.length);

      setHtml(out, `<h2>Trial balance</h2><table class="tbl tb"><thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th>${withPending ? '<th class="num grey">Debit incl. unposted</th><th class="num grey">Credit incl. unposted</th>' : ''}</tr></thead><tbody>` +
        [...all2.keys()].map((a) => `<tr><td>${esc(ACCOUNT[a] ?? a)}</td>${cols(base.get(a) ?? 0n)}${pcols(all2.get(a)!)}</tr>`).join('') +
        `<tr class="total"><td>Total</td><td class="num">${usd(dr)}</td><td class="num">${usd(cr)}</td>${withPending ? `<td class="num grey">${usd(pdr)}</td><td class="num grey">${usd(pcr)}</td>` : ''}</tr></tbody></table>` +
        (dr === 0n && cr === 0n ? `<p class="small">Nothing posted on this project yet. Approve the open proposal, or tick “Include unposted proposals” to preview the position.</p>`
          : `<p class="balcheck ${balanced ? 'ok' : 'bad'}">${balanced ? `Balanced: debits = credits · ${usd(dr)}` : `Not balanced: debits ${usd(dr)} ≠ credits ${usd(cr)}`}</p>`) +
        `<p class="small memo">Memo · Cost of revenue ${incurred !== undefined ? usd(incurred) : '—'} (costs incurred to date, from the cost export) is booked in the cost system, not in these entries. Cash and bank are outside this ledger.</p>` +
        `<h2>Journal</h2>` + (journal.length ? `<table class="tbl journal"><thead><tr><th>Ref</th><th>Date</th><th>Approver</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>${journal.map(entryRows).join('')}</tbody></table>` : '<p class="empty">Nothing posted yet.</p>'));
    };
    const onChange = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t === sel) { chosen = BigInt(sel.value); draw(); }
      else if ((t as HTMLInputElement).dataset.f === 'pend') { withPending = (t as HTMLInputElement).checked; draw(); }
    };
    root.addEventListener('change', onChange);
    const stop = live(ctx, draw);
    return () => { stop(); root.removeEventListener('change', onChange); };
  },
};
export default page;
