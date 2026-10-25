// Agents: who does what (roster with seats, tools and permissions), the live agent_event chain, and the architecture strip.
// agent_event rides a separate subscription (lib/ledger subscribeExtra): a ledger without the table still renders the roster.
import type { Page } from '../lib/app';
import { subscribeExtra } from '../lib/ledger';
import { esc, ago } from '../lib/ui';
import './pages.css';

type Agent = { name: string; seat: string; tools: string; may: string[] };
const ROSTER: Agent[] = [
  { name: 'summo', seat: 'Coordinator · project accountant', tools: 'Claude Opus 5.5', may: ['record_calculation', 'propose', 'open_work_item', 'mark_milestone_met'] },
  { name: 'reader-claude', seat: 'Reader A · junior accountant reading the mail', tools: 'Claude Opus 5.5', may: ['record_extraction'] },
  { name: 'reader-gemini', seat: 'Reader B · junior accountant reading the mail', tools: 'Gemini 3.5 Flash Lite', may: ['record_extraction'] },
  { name: 'document-reader', seat: 'Scanning clerk', tools: 'Azure Document Intelligence', may: ['record_extraction'] },
  { name: 'reconciler', seat: 'Reconciliation', tools: 'Claude Opus 5.5', may: ['record_extraction (disagreement record)'] },
  { name: 'field-liaison', seat: 'The person who chases the site', tools: 'Convex + Cartesia', may: ['open_clarification', 'resolve_clarification'] },
  { name: 'engine', seat: 'Deterministic calculator', tools: '@keel/engine', may: [] },
  { name: 'explainer', seat: 'Writes the memo', tools: 'Claude Opus 5.5', may: [] },
  { name: 'learner', seat: 'Policy analyst', tools: 'Claude Opus 5.5', may: ['save pending conventions'] },
];
const NOTHING: Record<string, string> = { engine: 'nothing · returns numbers', explainer: 'nothing · text only' };
const TONE: Record<string, string> = { disagree: 'amb', ask: 'amb', skip: 'amb', error: 'err' };

const STRIP = `<div class="arch" aria-label="Architecture: sources flow through readers, reconciler, Summo, engine, explainer, proposal and the posting guard to the ledger">
  <div class="n">Sources</div><i></i>
  <div class="n">Readers<small>A · B · Document</small></div><i></i>
  <div class="n">Reconciler</div><i></i>
  <div class="stack"><div class="n summo-n">Summo</div><b></b><div class="n">Field liaison</div><b></b><div class="n">Phone</div></div><i></i>
  <div class="n">Engine</div><i></i>
  <div class="n">Explainer</div><i></i>
  <div class="n">Proposal</div><i></i>
  <div class="n guard">Posting guard</div><i></i>
  <div class="n">Ledger</div>
</div>
<p class="arch-line">One coordinator, eight specialists, one human. No agent can post.</p>`;

const page: Page = {
  route: /^\/workbench\/agents$/,
  title: 'Agents',
  render(root, ctx) {
    let state: 'loading' | 'ok' | 'missing' = 'loading';
    let fProject = '', fAgent = '';
    const sub = subscribeExtra(ctx.conn, ['agent_event'], () => { state = 'ok'; later(); }, () => { state = 'missing'; later(); });

    // where an event's ref lives in the workbench
    function link(e: { projectId: bigint; refTable: string; refId: bigint }) {
      const d = ctx.conn.db, p = `/workbench/projects/${e.projectId}`;
      if (!e.refId) return '';
      const to = ({
        proposal: `${p}/proposals`,
        calculation: `${p}/calculations`,
        source: `/workbench/evidence?source=${e.refId}`,
        extraction: (() => { const x = d.extraction.id.find(e.refId); return x ? `/workbench/evidence?source=${x.sourceId}` : `${p}/sources`; })(),
        clarification_ref: p,
      } as Record<string, string>)[e.refTable];
      return to ? `<a class="go" href="${to}" title="${esc(e.refTable)} #${e.refId}" aria-label="Open ${esc(e.refTable)} ${e.refId}">→</a>` : '';
    }

    function draw() {
      const d = ctx.conn.db;
      const evs = [...d.agentEvent.iter()].sort((a, b) => (a.id < b.id ? 1 : -1));
      const now = Date.now();
      const lastOf = (n: string) => evs.find((e) => e.agent === n);
      const row = (a: Agent) => {
        const e = lastOf(a.name), live = !!e && now - e.at.toDate().getTime() < 60_000;
        const may = a.may.length ? a.may.map((m) => `<code class="may">${esc(m)}</code>`).join('') : `<span class="muted">${NOTHING[a.name]}</span>`;
        return `<tr><td><span class="dot${live ? ' live' : ''}" title="${live ? 'active in the last minute' : 'quiet'}"></span></td>
          <td><b class="${a.name === 'summo' ? 'summo' : ''}">${a.name}</b><div class="muted">${esc(a.seat)}</div></td>
          <td>${esc(a.tools)}</td><td class="mays">${may}</td>
          <td>${e ? `<span class="mono ${TONE[e.kind] ?? ''}">${esc(e.kind)}</span> ${esc(e.summary)} <span class="muted">· ${ago(e.at.toDate())}</span>` : '<span class="muted">—</span>'}</td></tr>`;
      };
      const projects = [...d.project.iter()];
      const shown = evs.filter((e) => (!fProject || String(e.projectId) === fProject) && (!fAgent || e.agent === fAgent));
      const chain = shown.map((e, i) => {
        const t = e.at.toDate(), prev = shown[i - 1];
        const gap = prev && prev.at.toDate().getTime() - t.getTime() > 20_000; // newest first: a new run starts after a > 20 s pause
        return `${gap ? '<li class="run" aria-hidden="true"></li>' : ''}<li class="ev">
          <span class="mono muted">${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
          <span class="${e.agent === 'summo' ? 'summo' : ''}">${esc(e.agent)}</span>
          <span class="mono ${TONE[e.kind] ?? ''}">${esc(e.kind)}</span>
          <span class="sum">${esc(e.summary)}</span>${link(e)}</li>`;
      }).join('');
      const opt = (v: string, label: string, cur: string) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;

      root.innerHTML = `<div class="pg">
        ${STRIP}
        <h2>Roster</h2>
        <div class="tbl-wrap"><table class="roster">
          <thead><tr><th></th><th>Agent</th><th>Tools</th><th>May</th><th>Last event</th></tr></thead>
          <tbody>${ROSTER.map(row).join('')}
          <tr class="guardrow"><td><span class="lock" aria-hidden="true"></span></td>
            <td><b>Posting guard</b><div class="muted">Control, not an agent · the ledger's <code>post</code> reducer</div></td>
            <td>ledger reducer</td><td class="mays"><code class="may">postings</code></td>
            <td class="muted">Only on the controller's approval. Nobody else posts.</td></tr>
          </tbody></table></div>
        <h2>Live chain</h2>
        ${state === 'missing' ? '<p class="empty amb">Agent log not available on this ledger yet.</p>' : `
        <div class="toolbar">
          <select data-f="project" aria-label="Project">${opt('', 'All projects', fProject)}${projects.map((p) => opt(String(p.id), p.name, fProject)).join('')}</select>
          <select data-f="agent" aria-label="Agent">${opt('', 'All agents', fAgent)}${ROSTER.map((a) => opt(a.name, a.name, fAgent)).join('')}</select>
          <span class="grow"></span><span class="muted">${shown.length} events</span>
        </div>
        ${state === 'loading' ? '<p class="empty">Loading the agent log…</p>' : shown.length ? `<ol class="chain">${chain}</ol>` : '<p class="empty">No agent events yet.</p>'}`}
      </div>`;
    }

    let raf = 0;
    function later() { raf ||= requestAnimationFrame(() => { raf = 0; draw(); }); }
    root.onchange = (e) => {
      const s = e.target as HTMLSelectElement;
      if (s.dataset.f === 'project') fProject = s.value; else if (s.dataset.f === 'agent') fAgent = s.value;
      draw();
    };
    draw();
    const off = ctx.onChange(later);
    const tick = setInterval(later, 5000); // live dots and "x s ago" age with the clock
    return () => { off(); clearInterval(tick); cancelAnimationFrame(raf); root.onchange = null; try { sub.unsubscribe(); } catch {} };
  },
};
export default page;
