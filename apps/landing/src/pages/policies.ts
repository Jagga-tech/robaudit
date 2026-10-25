// Policies and conventions (the Learns screen): what Summo has learned, newest first, and the policy versions it works under.
import type { Page } from '../lib/app';
import { ids } from '../lib/ledger';
import './pages.css';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const words = (s: string) => s.replace(/_/g, ' ');
const EXPLAIN: Record<string, string> = {
  'another_means=additional': 'At this company “another $X” adds to the remaining forecast.',
  'another_means=new_total': 'At this company “another $X” replaces the remaining forecast as the new total.',
  'remaining_estimate_means=future_costs_only': 'A “Remaining Estimate” figure is the cost still to come; costs already incurred are not in it.',
};
// ponytail: fixed explainer table; unknown keys get a plain generic sentence
const explain = (key: string, value: string, template: string) =>
  EXPLAIN[`${key}=${value}`] ?? `In a ${words(template)}, “${words(key.replace(/_means$/, ''))}” is read as ${words(value)}.`;

const page: Page = {
  route: /^\/workbench\/policies$/,
  title: 'Policies and conventions',
  render(root, ctx) {
    function draw() {
      const d = ctx.conn.db;
      const policies = [...d.policy.iter()].sort((a, b) => b.version - a.version);
      const approved = [...d.convention.iter()].sort((a, b) => (a.id < b.id ? 1 : -1));
      const pending = [...d.proposal.iter()].filter((p) => p.status === 'open' && p.pendingConventionJson).sort((a, b) => (a.id < b.id ? 1 : -1));
      const links = (csv: string) => ids(csv).map((id) => `<a data-src="${id}">#${id}</a>`).join(' ') || '—';
      const conv = (rule: string, why: string, meta: string, cls = '') =>
        `<div class="conv ${cls}"><div class="rule">${esc(rule)}</div><p class="why">${esc(why)}</p><div class="meta">${meta}</div></div>`;

      root.innerHTML = `<div class="pg">
        <p class="lede">How Summo reads this company's documents. A convention is saved only when the controller approves a proposal that carries it; after that the same wording is handled with no phone call.</p>
        <h2>Approved conventions</h2>
        ${approved.length ? approved.map((c, i) => conv(`${c.template}.${c.key} = ${c.value}`, explain(c.key, c.value, c.template),
          `policy v${c.policyVersion} · approved by ${esc(c.approvedBy)} · ${esc(c.projectCompanyScope)} · examples ${links(c.exampleSourceIds)}`, i === 0 ? 'newest' : '')).join('')
          : '<p class="empty">None yet.</p>'}
        <h2>Pending approval</h2>
        ${pending.length ? pending.map((p) => {
          let c = { template: '', key: '', value: '' };
          try { c = JSON.parse(p.pendingConventionJson); } catch {}
          return conv(`${c.template}.${c.key} = ${c.value}`, explain(c.key, c.value, c.template),
            `<span class="amb">waiting for the controller</span> · proposal #${p.id} rev ${p.revision} · policy v${policies[0]?.version ?? '—'} · evidence ${links(p.evidenceSourceIds)}`);
        }).join('') : '<p class="empty">Nothing waiting.</p>'}
        <h2>Policy</h2>
        ${policies.length ? `<div class="tbl-wrap"><table>
          <thead><tr><th class="num">Version</th><th>Text</th><th>Approved by</th><th>Approved</th></tr></thead>
          <tbody>${policies.map((p) => `<tr><td class="num">v${p.version}</td><td><p class="policy">${esc(p.text)}</p></td><td>${esc(p.approvedBy)}</td>
            <td class="mono muted">${p.approvedAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty">No policy rows.</p>'}
      </div>`;
    }
    root.onclick = (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-src]');
      if (a) ctx.navigate(`/workbench/evidence?source=${a.dataset.src}`);
    };
    draw();
    let raf = 0;
    const off = ctx.onChange(() => { raf ||= requestAnimationFrame(() => { raf = 0; draw(); }); });
    return () => { off(); cancelAnimationFrame(raf); root.onclick = null; };
  },
};
export default page;
