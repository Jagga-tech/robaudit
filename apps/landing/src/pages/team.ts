// Team: the ledger's registered users and the roles its reducers enforce, plus the judge on the phone (Convex managers.current).
import type { Page } from '../lib/app';
import './pages.css';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ROLE: Record<string, [string, string]> = {
  controller: ['Controller', 'Approves and posts. The only role the ledger lets call decide, post, closePeriod and saveConvention.'],
  accountant: ['Accountant', 'Adds sources: contracts, cost exports, forecasts, invoices.'],
  deployment_manager: ['Deployment manager', 'Answers Summo’s questions from the field and adds site notes and photos.'],
  agent: ['Agent', 'Reads sources and proposes entries with evidence. Never posts: the ledger refuses it.'],
};
const ORDER = ['controller', 'accountant', 'deployment_manager', 'agent'];

const page: Page = {
  route: /^\/workbench\/team$/,
  title: 'Team',
  render(root, ctx) {
    let judge: { name: string; joinedAt: number } | null = null;
    function draw() {
      // ponytail: one row per name+role; every browser/session registers its own identity under the same demo name
      const seen = new Set<string>();
      const users = [...ctx.conn.db.user.iter()].filter((u) => !seen.has(u.name + '|' + u.role) && !!seen.add(u.name + '|' + u.role)).sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role) || a.name.localeCompare(b.name));
      const onPhone = (u: { name: string; role: string }) => !!judge && u.role === 'deployment_manager' && u.name === judge.name;
      const phone = ' <span class="ok">(on phone)</span>';
      const row = (name: string, role: string, extra = '') => {
        const [label, what] = ROLE[role] ?? [role, ''];
        return `<tr><td class="${role === 'agent' ? 'summo' : ''}">${esc(name)}</td><td>${esc(label)}${extra}</td><td class="muted">${esc(what)}</td></tr>`;
      };
      root.innerHTML = `<div class="pg">
        <p class="lede">Who can do what. Roles are checked by the ledger’s reducers, not by this page.</p>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Name</th><th>Role</th><th>What the ledger allows</th></tr></thead>
          <tbody>
            ${users.map((u) => row(u.role === 'agent' ? 'Summo' : u.name, u.role, onPhone(u) ? phone : '')).join('')}
            ${judge && !users.some(onPhone) ? row(judge.name, 'deployment_manager', phone) : ''}
          </tbody>
        </table></div>
        ${judge ? '' : '<p class="muted">No deployment manager on the phone right now.</p>'}
        <p class="note">In this demo one controller reviews and approves; in production those are two people and the ledger already enforces the roles.</p>
      </div>`;
    }
    draw();
    let raf = 0;
    const later = () => { raf ||= requestAnimationFrame(() => { raf = 0; draw(); }); };
    const off = ctx.onChange(later);
    const offJudge = ctx.convex.onUpdate(ctx.api.managers.current, {}, (m) => { judge = m; later(); });
    return () => { off(); offJudge(); cancelAnimationFrame(raf); };
  },
};
export default page;
