// Evidence: every `source` row across projects, newest first, with the readers that read it and where it was used.
import type { Ctx, Page } from '../lib/app';
import { ids, pct } from '../lib/ledger';
import { disagreement, disagreeLine, trustedLabel, DISAGREE, tag, usd } from '../lib/ui';
import './pages.css';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const when = (t: { toDate(): Date }) => t.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const KINDS = ['contract', 'cost_export', 'forecast', 'scanned_forecast', 'note', 'clarification', 'commissioning_log', 'invoice'];
const LABEL: Record<string, string> = {
  contract: 'Contract', cost_export: 'Cost export', forecast: 'Forecast', scanned_forecast: 'Forecast sheet (photo)', note: 'Site note',
  clarification: 'Clarification', commissioning_log: 'Commissioning log', invoice: 'Invoice',
};

/** Convex storage id → URL (shared by image and audio), cached; fires `done` once resolved. */
const urls = new Map<string, string | null>();
function storageUrl(ctx: Ctx, id: string, done: () => void): string | null | undefined {
  if (!id) return null;
  if (!urls.has(id)) {
    urls.set(id, undefined as any);
    ctx.convex.query(ctx.api.clarifications.audioUrl, { storageId: id as any })
      .then((u) => { urls.set(id, u); done(); }, () => { urls.set(id, null); done(); });
  }
  return urls.get(id);
}

const page: Page = {
  route: /^\/workbench\/evidence$/,
  title: 'Evidence',
  render(root, ctx) {
    let kind = '';
    let sel: bigint | null = null;
    const q = new URLSearchParams(location.search).get('source');
    if (q && /^\d+$/.test(q)) sel = BigInt(q);
    let audio: HTMLAudioElement | null = null;

    function draw() {
      const d = ctx.conn.db;
      const projects = new Map([...d.project.iter()].map((p) => [p.id, p.name]));
      const sources = [...d.source.iter()].sort((a, b) => (a.id < b.id ? 1 : -1));
      const exs = [...d.extraction.iter()];
      const counts = new Map<string, number>();
      for (const s of sources) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
      const shown = kind ? sources.filter((s) => s.kind === kind) : sources;
      const chip = (k: string, label: string, n: number) =>
        `<button class="chip" data-kind="${k}" aria-pressed="${kind === k}">${label}<b>${n}</b></button>`;
      const preview = (s: (typeof sources)[number]) => s.kind === 'scanned_forecast'
        ? '<span class="muted">Photographed sheet</span>' + (exs.find((x) => x.sourceId === s.id && x.reader === 'azure-di') ? '' : ' <span class="muted">· not read yet</span>')
        : esc(s.text.length > 120 ? s.text.slice(0, 119) + '…' : s.text);

      root.innerHTML = `<div class="pg">
        <p class="lede">Every document the ledger holds, newest first. Click a row for the full text, what each reader extracted, and where it was used.</p>
        <div class="chips">${chip('', 'All', sources.length)}${KINDS.map((k) => chip(k, LABEL[k], counts.get(k) ?? 0)).join('')}</div>
        ${shown.length ? `<div class="tbl-wrap"><table>
          <thead><tr><th>Kind</th><th class="num">Ver</th><th>Project</th><th>Text</th><th>Added</th><th>Read by</th><th>Ambiguity</th></tr></thead>
          <tbody>${shown.map((s) => {
            const mine = exs.filter((x) => x.sourceId === s.id);
            const amb = mine.some((x) => x.ambiguityFlag), g = disagreement(d, s.id);
            return `<tr class="click${sel === s.id ? ' sel' : ''}" data-id="${s.id}">
              <td>${LABEL[s.kind] ?? esc(s.kind)}</td><td class="num">v${s.version}</td>
              <td>${esc(projects.get(s.projectId) ?? '—')}</td><td class="text">${preview(s)}${g ? `<div class="muted">${esc(disagreeLine(g))}</div>` : ''}</td>
              <td class="mono muted">${when(s.createdAt)}</td>
              <td class="mono">${[...new Set(mine.map((x) => x.reader))].join(', ') || '<span class="muted">—</span>'}</td>
              <td>${g ? tag(DISAGREE, 'amber') : amb ? '<span class="amb">ambiguous</span>' : ''}</td></tr>`;
          }).join('')}</tbody></table></div>` : '<p class="empty">No sources of this kind yet.</p>'}
      </div>${sel !== null ? sheet(sel) : ''}`;
    }

    function sheet(id: bigint): string {
      const d = ctx.conn.db;
      const s = d.source.id.find(id);
      if (!s) return '';
      const exs = [...d.extraction.iter()].filter((x) => x.sourceId === id);
      const parts: string[] = [`<aside class="pg-sheet" role="dialog" aria-label="Source ${id}">
        <button class="close" data-close>Close</button>
        <h2>${LABEL[s.kind] ?? esc(s.kind)} v${s.version}</h2>
        <div class="muted mono">source ${s.id} · ${when(s.createdAt)} · ${esc(d.project.id.find(s.projectId)?.name ?? '')}${s.parentSourceId ? ` · answers source ${s.parentSourceId}` : ''}</div>`];

      if (s.kind === 'scanned_forecast') {
        const url = storageUrl(ctx, s.text, draw);
        parts.push('<h3>Page image</h3>', url ? `<img src="${esc(url)}" alt="Photographed forecast sheet">` : `<p class="muted">${url === null ? 'Image unavailable.' : 'Loading image…'}</p>`);
        const di = exs.find((x) => x.reader === 'azure-di');
        if (di) {
          let f: { text?: string; tables?: string[][][] } = {};
          try { f = JSON.parse(di.factsJson); } catch {}
          parts.push('<h3>Azure Document Intelligence text</h3>', `<pre>${esc(f.text ?? '')}</pre>`);
          for (const t of f.tables ?? []) parts.push(`<table>${t.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`);
        } else parts.push('<p class="muted">Reading document…</p>');
      } else if (s.kind === 'clarification') {
        const ref = [...d.clarificationRef.iter()].find((r) => r.sourceId === s.parentSourceId && r.status === 'confirmed')
          ?? [...d.clarificationRef.iter()].find((r) => r.sourceId === s.parentSourceId);
        if (ref) {
          parts.push('<h3>Question</h3>', `<p>${esc(ref.question)}</p>`, '<h3>Answer</h3>',
            `<p>${esc(ref.answer || s.text)} <span class="muted">— ${esc(ref.speaker)}</span></p>`);
          if (ref.audioStorageId) parts.push(`<button class="play" data-play="${esc(ref.audioStorageId)}">▶ Play the answer</button>`);
        }
        parts.push('<h3>Recorded text</h3>', `<pre>${esc(s.text)}</pre>`);
      } else parts.push('<h3>Full text</h3>', `<pre>${esc(s.text)}</pre>`);

      const g = disagreement(d, id);
      if (g) {
        const doc = g.trusted !== 'cost_export', mark = tag('trusted', 'ok');
        parts.push(`<h3>Sources disagree ${tag(DISAGREE, 'amber')}</h3>`,
          `<table class="cmp"><tr><th>Document${doc ? ' ' + mark : ''}</th><th>Ledger · cost export${doc ? '' : ' ' + mark}</th></tr>` +
          `<tr><td class="mono${doc ? ' trusted' : ''}">${usd(g.document)}</td><td class="mono${doc ? '' : ' trusted'}">${usd(g.ledger)}</td></tr></table>`,
          `<p>${esc(g.reason || `Trusting the ${trustedLabel(g)}.`)}</p>`);
      }
      for (const x of exs.filter((x) => x.reader !== 'azure-di')) {
        let facts: { quote?: string; amountText?: string }[] = [];
        try { const f = JSON.parse(x.factsJson); if (Array.isArray(f)) facts = f; } catch {}
        parts.push(`<h3>Read by ${esc(x.reader)}</h3>`,
          facts.length ? `<ul>${facts.map((f) => `<li><span class="mono">${esc(f.amountText ?? '')}</span> “${esc(f.quote ?? '')}”</li>`).join('')}</ul>` : '<p class="muted">No facts extracted.</p>',
          x.ambiguityFlag ? `<p class="amb">${esc(x.ambiguityText || 'Wording ambiguous')}</p>` : '');
      }

      const items = new Map([...d.workItem.iter()].map((w) => [w.id, w.title]));
      const calcs = [...d.calculation.iter()].filter((c) => c.forecastSourceId === id);
      const props = [...d.proposal.iter()].filter((p) => ids(p.evidenceSourceIds).includes(id));
      parts.push('<h3>Used in</h3>', calcs.length + props.length ? `<ul>${[
        ...calcs.map((c) => `<li>Calculation <span class="mono">#${c.id}</span> · ${esc(items.get(c.workItemId) ?? '')} · ${pct(c.progressBp)} complete</li>`),
        ...props.map((p) => `<li>Proposal <span class="mono">#${p.id} rev ${p.revision}</span> · ${esc(items.get(p.workItemId) ?? '')} · ${esc(p.status)}</li>`),
      ].join('')}</ul>` : '<p class="muted">Not cited by any calculation or proposal yet.</p>', '</aside>');
      return parts.join('');
    }

    function playAudio(id: string) {
      const url = storageUrl(ctx, id, () => playAudio(id));
      if (url) { audio?.pause(); audio = new Audio(url); audio.play().catch(() => ctx.toast('Could not play the recording', 'error')); }
      else if (url === null) ctx.toast('Recording unavailable', 'warn');
    }

    root.onclick = (e) => {
      const t = e.target as HTMLElement;
      const chip = t.closest<HTMLElement>('[data-kind]');
      if (chip) { kind = chip.dataset.kind!; return draw(); }
      if (t.closest('[data-close]')) { sel = null; return draw(); }
      const play = t.closest<HTMLElement>('[data-play]');
      if (play) return playAudio(play.dataset.play!);
      const row = t.closest<HTMLElement>('tr[data-id]');
      if (row) { sel = BigInt(row.dataset.id!); draw(); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && sel !== null) { sel = null; draw(); } };
    document.addEventListener('keydown', onKey);
    draw();
    let raf = 0; // coalesce bursts of row callbacks (resetDemo) into one draw per frame
    const off = ctx.onChange(() => { raf ||= requestAnimationFrame(() => { raf = 0; draw(); }); });
    return () => { off(); cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey); root.onclick = null; audio?.pause(); };
  },
};
export default page;
