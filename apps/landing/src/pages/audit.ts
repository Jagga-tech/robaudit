// Audit trail: the append-only history_event log, newest first, joined to approval and posting rows.
import type { Page } from '../lib/app';
import { usd } from '../lib/ledger';
import './pages.css';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const when = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });

type Row = { time: Date; actor: string; agent: boolean; kind: string; summary: string; ref: string; detail: string };

const page: Page = {
  route: /^\/workbench\/audit$/,
  title: 'Audit trail',
  render(root, ctx) {
    let actor = '', kind = '';
    let visible: Row[] = [];

    function rows(): Row[] {
      const d = ctx.conn.db;
      const agents = new Set([...d.user.iter()].filter((u) => u.role === 'agent').map((u) => u.name));
      const approvals = [...d.approval.iter()];
      return [...d.historyEvent.iter()].sort((a, b) => (a.id < b.id ? 1 : -1)).map((e) => {
        const agent = e.actor === 'Keel Agent' || agents.has(e.actor);
        let detail = '';
        if (e.kind.startsWith('decision_')) {
          // decide() logs refId = proposalId in the same transaction, so the approval shares the event timestamp
          const a = approvals.find((x) => x.proposalId === e.refId && x.at.microsSinceUnixEpoch === e.at.microsSinceUnixEpoch)
            ?? approvals.filter((x) => x.proposalId === e.refId).pop();
          if (a) detail = `${a.decision} by ${a.by}${a.reason ? ` — ${a.reason}` : ''}`;
        } else if (e.kind === 'posted') {
          const p = d.posting.id.find(e.refId);
          if (p) {
            let lines: { account: string; debit: string; credit: string }[] = [];
            try { lines = JSON.parse(p.linesJson); } catch {}
            detail = `${p.postingRef}: ` + lines.map((l) => `${BigInt(l.debit) ? 'Dr' : 'Cr'} ${l.account} ${usd(BigInt(l.debit) || BigInt(l.credit))}`).join(' · ');
          }
        }
        return { time: e.at.toDate(), actor: agent ? 'Summo' : e.actor, agent, kind: e.kind, summary: e.summary, ref: e.refId ? `#${e.refId}` : '', detail };
      });
    }

    function draw() {
      const d = ctx.conn.db;
      const all = rows();
      visible = all.filter((r) => (!actor || r.actor === actor) && (!kind || r.kind === kind));
      const opts = (vals: string[], cur: string, label: string) =>
        `<option value="">${label}</option>` + [...new Set(vals)].sort().map((v) => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
      const stat = (n: number, l: string) => `<div><b>${n}</b><span>${l}</span></div>`;
      root.innerHTML = `<div class="pg">
        <p class="lede">Every action the ledger recorded, newest first. Nothing here can be edited or deleted.</p>
        <div class="strip">
          ${stat([...d.posting.iter()].length, 'entries posted')}
          ${stat([...d.approval.iter()].filter((a) => a.decision === 'approve').length, 'approvals')}
          ${stat([...d.clarificationRef.iter()].length, 'questions asked')}
          ${stat(new Set([...d.extraction.iter()].map((x) => x.sourceId)).size, 'documents read')}
        </div>
        <div class="toolbar">
          <select data-f="actor" aria-label="Actor">${opts(all.map((r) => r.actor), actor, 'All actors')}</select>
          <select data-f="kind" aria-label="Kind">${opts(all.map((r) => r.kind), kind, 'All kinds')}</select>
          <span class="grow"></span><span class="muted">${visible.length} rows</span>
          <button class="btn" data-csv>Export CSV</button>
        </div>
        ${visible.length ? `<div class="tbl-wrap"><table>
          <thead><tr><th>Time</th><th>Actor</th><th>Kind</th><th>Summary</th><th class="num">Ref</th></tr></thead>
          <tbody>${visible.map((r) => `<tr>
            <td class="mono muted">${when(r.time)}</td>
            <td class="${r.agent ? 'summo' : ''}">${esc(r.actor)}</td>
            <td class="mono">${esc(r.kind)}</td>
            <td>${esc(r.summary)}${r.detail ? `<div class="mono muted">${esc(r.detail)}</div>` : ''}</td>
            <td class="num">${r.ref}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No events match.</p>'}
      </div>`;
    }

    function csv() {
      const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const body = [['time', 'actor', 'kind', 'summary', 'ref', 'detail'], ...visible.map((r) => [r.time.toISOString(), r.actor, r.kind, r.summary, r.ref, r.detail])]
        .map((r) => r.map(cell).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
      a.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      ctx.toast(`Exported ${visible.length} rows`, 'ok');
    }

    root.onchange = (e) => {
      const s = e.target as HTMLSelectElement;
      if (s.dataset.f === 'actor') actor = s.value; else if (s.dataset.f === 'kind') kind = s.value;
      draw();
    };
    root.onclick = (e) => { if ((e.target as HTMLElement).closest('[data-csv]')) csv(); };
    draw();
    let raf = 0;
    const off = ctx.onChange(() => { raf ||= requestAnimationFrame(() => { raf = 0; draw(); }); });
    return () => { off(); cancelAnimationFrame(raf); root.onclick = null; root.onchange = null; };
  },
};
export default page;
