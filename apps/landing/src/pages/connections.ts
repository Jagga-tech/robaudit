// Connections: what Summo and this workbench are connected to, each with one honest status line read from live state.
import type { Page } from '../lib/app';
import { STDB_URI, STDB_DB } from '../lib/ledger';
import { CONVEX_URL } from '../lib/convex';
import './pages.css';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ago = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const page: Page = {
  route: /^\/workbench\/connections$/,
  title: 'Connections',
  render(root, ctx) {
    function draw() {
      const d = ctx.conn.db;
      const exs = [...d.extraction.iter()];
      const n = (r: string) => exs.filter((x) => x.reader === r).length;
      const refs = [...d.clarificationRef.iter()];
      const lastClar = Math.max(0, ...refs.map((r) => Number(r.confirmedAt.toMillis())));
      const lastEv = Math.max(0, ...[...d.historyEvent.iter()].map((e) => Number(e.at.toMillis())));
      const agents = [...d.user.iter()].filter((u) => u.role === 'agent');
      const stdbUp = ctx.conn.isActive, cvx = ctx.convex.connectionState().isWebSocketConnected;
      const item = (live: boolean | null, name: string, line: string) =>
        `<li><span class="dot${live ? ' live' : live === false ? ' off' : ''}" title="${live ? 'live' : live === false ? 'down' : 'no data yet'}"></span><div><b>${name}</b><p>${line}</p></div></li>`;
      const reader = (r: string) => n(r) ? `${n(r)} extraction${n(r) === 1 ? '' : 's'} in the ledger` : 'no extractions yet';
      const running = lastEv && Date.now() - lastEv < 60_000;

      root.innerHTML = `<div class="pg">
        <p class="lede">What the agent and this workbench are connected to, read from live state. Counts come from rows in the ledger.</p>
        <ul class="list">
          ${item(stdbUp, 'Ledger · SpacetimeDB', `<span class="mono">${esc(STDB_URI)}</span> · database <span class="mono">${esc(STDB_DB)}</span> · ${stdbUp ? 'connected' : 'disconnected'} as <span class="mono">${esc(ctx.conn.identity?.toHexString().slice(0, 16) ?? '—')}…</span>`)}
          ${item(cvx, 'Field channel · Convex', `<span class="mono">${esc(CONVEX_URL)}</span> · ${cvx ? 'connected' : 'reconnecting'} · ${lastClar ? `last clarification confirmed ${ago(lastClar)}` : 'no clarification confirmed yet'}`)}
          ${item(n('claude') ? true : null, 'Reader · Claude', reader('claude'))}
          ${item(n('gemini') ? true : null, 'Reader · Gemini', reader('gemini'))}
          ${item(n('azure-di') ? true : null, 'Document reader · Azure Document Intelligence', reader('azure-di'))}
          ${item(refs.some((r) => r.audioStorageId) ? true : null, 'Voice · Cartesia', `${refs.filter((r) => r.audioStorageId).length} recorded answer${refs.filter((r) => r.audioStorageId).length === 1 ? '' : 's'} of ${refs.length} question${refs.length === 1 ? '' : 's'}`)}
          ${item(running ? true : null, '<span class="summo">Agent · Summo</span>', `${running ? 'running' : 'idle'} · ${lastEv ? `last ledger event ${ago(lastEv)}` : 'no events yet'}${agents.length ? ` · registered as ${[...new Set(agents.map((a) => esc(a.name)))].join(', ')}` : ''}`)}
        </ul>
      </div>`;
    }
    draw();
    let raf = 0;
    const later = () => { raf ||= requestAnimationFrame(() => { raf = 0; draw(); }); };
    const off = ctx.onChange(later);
    const offCvx = ctx.convex.subscribeToConnectionState(later);
    const tick = setInterval(later, 5000); // "x s ago" and running/idle age with the clock
    return () => { off(); offCvx(); clearInterval(tick); cancelAnimationFrame(raf); };
  },
};
export default page;
