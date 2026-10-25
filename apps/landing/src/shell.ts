// The workbench shell: sidebar, page title row, toasts, Summo's badge, routing under /workbench (history API).
// One user: Dana, controller. Pages read the SpacetimeDB client cache on each render (docs/frontend-guide.md §7, §10).
import { connect, onChange, call, subscribeExtra, STDB_URI, type DbConnection } from './lib/ledger';
import { convex, api } from './lib/convex';
import type { Ctx } from './lib/app';
import { SIDE, subTabs, sideKey, resolve, navKey } from './router';
import { esc, all, byId, last, inbox, onboarding } from './lib/ui';

type Summo = Parameters<Ctx['summo']>[0];
const $ = (id: string) => document.getElementById(id)!;

let conn: DbConnection | undefined;
let manager: { _id: any; name: string } | null = null;
let override: { state: Summo; detail?: string; until: number } | null = null;
let seenProp: bigint | undefined, seenPosting: bigint | undefined;
let unmount: (() => void) | void;

// ---- sidebar ----
$('nav').innerHTML = SIDE.map((n) => `<a href="${n.path}" data-key="${n.key}"><span>${n.label}</span><b data-count="${n.key}"></b></a>`).join('');

function badgeState(d: DbConnection['db']): string {
  if (override && Date.now() < override.until) return override.state === 'asking' ? `asking ${manager?.name ?? 'the manager'}` : override.state;
  const asking = `asking ${manager?.name ?? 'the manager'}`;
  if (all(d.workItem.iter()).some((w) => w.status === 'awaiting_clarification')) return asking;
  const e = all(d.historyEvent.iter()).filter((x) => x.projectId !== 0n).sort(byId).pop();
  switch (e?.kind) {
    case 'source_added': case 'extraction': return 'reading';
    case 'clarification_opened': return asking;
    case 'clarification_confirmed': case 'calculation': case 'proposed': case 'proposal_stale': return 'proposing';
    case 'posted': case 'convention_saved': return 'posted';
    default: return 'watching';
  }
}

function play(cls: 'spin' | 'wiggle') {
  const a = $('avatar');
  a.classList.remove('spin', 'wiggle'); void a.offsetWidth; a.classList.add(cls);
}

function renderSide() {
  $('presence').innerHTML = manager ? `<i class="dot"></i>${esc(manager.name)} · deployment manager, on phone` : 'No deployment manager yet';
  if (!conn) return;
  const d = conn.db;
  const state = badgeState(d);
  $('badgeText').textContent = `Summo · ${state}`;
  $('badgeDetail').textContent = override && Date.now() < override.until ? override.detail ?? '' : '';
  $('badge').classList.toggle('refused', state === 'refused');
  const posted = new Set(all(d.posting.iter()).map((p) => p.proposalId));
  const counts: Record<string, number> = {
    inbox: inbox(d, manager?.name).filter(({ w }) => !onboarding(d, w)).length + all(d.workItem.iter()).filter((w) => onboarding(d, w)).length,
    agents: all(d.agentEvent.iter()).filter((e) => Date.now() - e.at.toDate().getTime() < 600_000).length,
    projects: all(d.project.iter()).length,
    close: all(d.proposal.iter()).filter((p) => (p.status === 'open' || p.status === 'approved') && !posted.has(p.id)).length,
    evidence: all(d.source.iter()).length,
    audit: all(d.historyEvent.iter()).length,
    policies: all(d.convention.iter()).length + all(d.policy.iter()).length,
    team: new Set(all(d.user.iter()).filter((u) => u.role !== 'agent').map((u) => u.name + '|' + u.role)).size, // distinct people, not identities
  };
  for (const el of document.querySelectorAll<HTMLElement>('[data-count]')) {
    const k = el.dataset.count!;
    el.textContent = k === 'connections' || (k === 'agents' && !counts.agents) ? '' : String(counts[k] ?? '');
    el.classList.toggle('hot', k === 'inbox' && counts.inbox > 0);
  }
  $('liveDot').hidden = false;
  // Summo spins once when a new proposal lands, wiggles on posted (refusals wiggle in ctx.summo).
  const p = last(all(d.proposal.iter()).sort(byId)), pg = last(all(d.posting.iter()).sort(byId));
  if (seenProp !== undefined && p && p.id !== seenProp && p.status === 'open') play('spin');
  if (seenPosting !== undefined && pg && pg.id !== seenPosting) play('wiggle');
  seenProp = p?.id ?? 0n; seenPosting = pg?.id ?? 0n;
}
let queued = false;
const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; renderSide(); }); } };

// ---- toasts ----
function toast(text: string, kind: 'info' | 'ok' | 'warn' | 'error' = 'info') {
  const el = document.createElement('p');
  el.className = `toast ${kind}`; el.setAttribute('role', kind === 'error' ? 'alert' : 'status'); el.textContent = text;
  $('toasts').append(el);
  while ($('toasts').children.length > 3) $('toasts').firstElementChild!.remove(); // newest three
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 4500);
}

// ---- routing ----
function navigate(path: string) {
  if (!path.startsWith('/workbench')) { location.href = path; return; }
  if (path !== location.pathname) history.pushState(null, '', path);
  mount();
}

function mount() {
  try { unmount?.(); } catch {}
  unmount = undefined;
  const path = location.pathname;
  const key = navKey(path);
  for (const a of document.querySelectorAll<HTMLElement>('#nav a')) a.classList.toggle('on', a.dataset.key === sideKey(key));
  const host = $('page');
  host.replaceChildren();
  // grouped pages (Team) get a tab strip above the page; the page renders into its own element below it
  const tabs = subTabs(key);
  let root: HTMLElement = host;
  if (tabs.length) {
    host.innerHTML = `<nav class="tabs">${tabs.map((t) => `<a href="${t.path}" class="${t.key === key ? 'on' : ''}">${t.label}</a>`).join('')}</nav><div class="tabbody"></div>`;
    root = host.querySelector<HTMLElement>('.tabbody')!;
  }
  $('sheet').hidden = true;
  const { page, params } = resolve(path);
  $('ptitle').textContent = page.title;
  $('psub').textContent = '';
  $('pacts').innerHTML = '';
  document.title = `${page.title} · Robaudit`;
  if (!conn) { root.innerHTML = '<p class="empty">Connecting to the ledger…</p>'; return; }
  try { unmount = page.render(root, ctx, params); }
  catch (e: any) { root.innerHTML = `<p class="empty err">This page failed to render: ${esc(String(e?.message ?? e))}</p>`; console.error(e); }
}

addEventListener('popstate', mount);
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/workbench"]');
  if (!a || a.target) return;
  e.preventDefault();
  navigate(a.getAttribute('href')!);
});
$('sheetClose').addEventListener('click', () => { $('sheet').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('sheet').hidden = true; });

// ---- Reset (frontend-guide §10): ledger, open calls, presence; then back to the landing page's QR poster ----
$('resetBtn').addEventListener('click', async () => {
  if (!conn) return;
  const btn = $('resetBtn') as HTMLButtonElement;
  btn.disabled = true;
  const err = await call(conn.reducers.resetDemo({}));
  if (err) { btn.disabled = false; toast(`Refused · ${err}`, 'error'); return; }
  await convex.mutation(api.clarifications.resetOpen, {}).catch(() => {});
  const cur = await convex.query(api.managers.current, {}).catch(() => null);
  if (cur) await convex.mutation(api.managers.leave, { id: cur._id }).catch(() => {});
  navigate('/');
});

const ctx: Ctx = {
  get conn() { return conn!; },
  convex, api, navigate, onChange, toast,
  judge: () => manager,
  summo(state, detail) {
    override = { state, detail, until: Date.now() + 4000 };
    if (state === 'refused') play('wiggle');
    schedule();
  },
};

convex.onUpdate(api.managers.current, {}, (m) => { manager = m; schedule(); });
setInterval(() => { if (override && Date.now() > override.until) { override = null; schedule(); } }, 500); // badge leaves a transient state
mount();
connect('controller', 'Dana').then((c) => {
  conn = c; onChange(schedule);
  subscribeExtra(c, ['agent_event'], () => {}, (e) => console.warn('agent_event not on this ledger', e)); // separate: prod may lack the table
  renderSide(); mount();
}, (e) => {
  $('page').innerHTML = `<p class="empty err">Cannot reach the ledger at ${esc(STDB_URI)}: ${esc(String(e?.message ?? e))}</p>`;
});
