// One project (/workbench/projects/:id[/tab]): the old single-page workbench, reorganised into tabs.
// Overview = figures + margin + the proposal panel + activity; Sources; Calculations; Proposals (+ "break it").
import type { Page } from '../lib/app';
import { connect, call, codeOf, ids, type DbConnection } from '../lib/ledger';
import { esc, clip, all, byId, last, sleep, reduceMotion, usd, dollars, pct, card, tag, sourceLabel, KIND, READER, ACCOUNT, project, proposalStatus, statusTone, live, head, setHtml } from '../lib/ui';

declare const qrcode: any; // qrcode-generator 1.4.4, classic script from cdnjs (workbench.html)

type M = NonNullable<ReturnType<typeof project>>;
type Line = { account: string; debit: string; credit: string };
const TABS = ['overview', 'sources', 'calculations', 'proposals'] as const;
// post() checks in its own order (spacetimedb/src/index.ts); a refusal code maps to the check that failed.
const CHECK_OF: Record<string, number> = { role: 0, not_approved: 1, revision: 1, stale: 1, period_closed: 2, unbalanced: 3, bad_input: 3, duplicate_posting: 4 };

// Survive tab switches and re-mounts: the figures animate once per NEW calculation, posting ticks per proposal.
let shownCalc: bigint | undefined, shown = { bp: 0, rev: 0, margin: 0 };
const posting = new Map<bigint, { checks: string[]; busy: boolean }>();
const tickState = (pid: bigint) => posting.get(pid) ?? posting.set(pid, { checks: ['', '', '', '', ''], busy: false }).get(pid)!;
let priya: Promise<DbConnection> | undefined; // second connection, opened only for "Approve as the accountant"

const page: Page = {
  route: /^\/workbench\/projects\/(\d+)(?:\/(overview|sources|calculations|proposals))?\/?$/,
  title: 'Project',
  render(root, ctx, [idText, tabArg]) {
    const pid = BigInt(idText), tab = (tabArg ?? 'overview') as (typeof TABS)[number];
    const d = ctx.conn.db;
    const m0 = project(d, pid);
    if (!m0) {
      head({ title: 'Project not found', sub: 'Ids change after a demo reset.' });
      root.innerHTML = '<p class="empty">This project is not in the ledger. <a href="/workbench/projects">See all projects</a>.</p>';
      return;
    }
    root.innerHTML = `<nav class="tabs">${TABS.map((t) => `<a href="/workbench/projects/${pid}${t === 'overview' ? '' : '/' + t}" class="${t === tab ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</a>`).join('')}</nav><div class="tabbody"></div>`;
    const body = root.querySelector<HTMLElement>('.tabbody')!;
    const $ = (sel: string) => body.querySelector<HTMLElement>(sel)!;
    const m = () => project(d, pid);

    const refuse = (msg: string) => { ctx.toast(`Refused · ${msg}`, 'error'); ctx.summo('refused', codeOf(msg)); proof(`<b>Refused ·</b> ${esc(msg)}`, true); };
    const proof = (html: string, bad = false) => { const el = body.querySelector<HTMLElement>('.refusal'); if (el) { el.innerHTML = html; el.classList.toggle('info', !bad); } };

    function header() {
      const x = m();
      if (!x) return;
      const pol = last(all(d.policy.iter()));
      head({ title: x.proj.name, sub: `Aster Robotics · contract ${usd(x.proj.contractValueCents)} · policy v${pol?.version ?? ''} · period ${x.proj.periodOpen ? 'open' : 'closed'}` });
    }

    // ---------- Overview ----------
    function overview() {
      body.innerHTML = `<div class="ovgrid"><section>
        <div class="figs"><div class="fig"><div class="big" data-f="pct">…</div><div class="was" data-f="wasPct"></div><div class="lbl">complete</div><small data-f="subPct"></small></div>
        <div class="fig"><div class="big" data-f="rev">…</div><div class="was" data-f="wasRev"></div><div class="lbl">revenue recognized</div><small data-f="subRev"></small></div></div>
        <div class="margin"><div class="mline">Expected margin <b data-f="margin"></b><span class="warn" data-f="loss" hidden>loss warning · escalated to Dana</span></div><div class="track"><i data-f="bar"></i></div></div>
        <h2>Activity</h2><ul class="list" data-f="activity"></ul></section>
        <aside class="side"><div class="joincard" data-f="join"><h3>Scan to be the deployment manager</h3><p>Summo will read your update, call your phone with one question, and book the result with your name on it.</p><div class="qr" data-f="qr"></div><code data-f="qrUrl"></code></div><div data-f="prop"></div></aside></div>`;
      const url = location.origin + '/phone';
      try { const q = qrcode(0, 'M'); q.addData(url); q.make(); $('[data-f=qr]').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }).replace(/fill="black"/g, 'fill="#0B1215"'); }
      catch { $('[data-f=qr]').textContent = 'QR unavailable'; }
      $('[data-f=qrUrl]').textContent = url.replace(/^https?:\/\//, '');
      return () => {
        const x = m();
        if (!x) return;
        figures(x);
        setHtml($('[data-f=activity]'), activity(x));
        const p = x.main && x.latestOf(x.main.id);
        const show = !!p && p.status !== 'posted'; // 'posted' only on the S0 seed: nothing to decide yet
        $('[data-f=join]').hidden = show || !!ctx.judge();
        const writing = !!x.cur && (!p || p.calculationId < x.cur.id); // the calculation lands 6-9 s before its proposal
        setHtml($('[data-f=prop]'), show && !writing ? panel(x, p!, true) : writing ? '<div class="quiet"><b>Summo is writing the entry.</b><p>The numbers moved. The proposal follows in a few seconds.</p></div>' : ctx.judge() ? `<div class="quiet"><b>Summo is watching.</b><p>${esc(ctx.judge()!.name)} joined as deployment manager. A site update from the phone starts the next proposal.</p></div>` : '');
      };
    }

    function figures(x: M) {
      const cur = x.cur;
      if (!cur) return;
      const props = x.main ? x.proposals.filter((p) => p.workItemId === x.main!.id) : [];
      // "was": the calculation behind the latest approved/posted proposal, older than the one on screen (Summo's baseline, loop.ts)
      const base = props.filter((p) => (p.status === 'approved' || p.status === 'posted') && p.calculationId !== 0n && p.calculationId < cur.id).pop();
      const before = base && x.calcs.find((c) => c.id === base.calculationId);
      const contract = Number(x.proj.contractValueCents);
      const j = JSON.parse(cur.inputsJson), incurred = BigInt(j.incurredCents), remaining = BigInt(j.remainingCents);
      $('[data-f=subPct]').textContent = `${usd(incurred)} incurred of ${usd(incurred + remaining)} estimated`;
      $('[data-f=subRev]').textContent = `billed ${usd(BigInt(j.billedCents))} · contract asset ${usd(cur.contractAssetCents)}`;
      $('[data-f=wasPct]').textContent = before ? `was ${pct(before.progressBp)}` : '';
      $('[data-f=wasRev]').textContent = before ? `was ${dollars(Number(before.cumRevenueCents))}` : '';
      $('[data-f=loss]').hidden = !cur.lossWarning;
      const bar = $('[data-f=bar]');
      const target = { bp: cur.progressBp, rev: Number(cur.cumRevenueCents), margin: Number(cur.marginCents) };
      const paint = () => {
        $('[data-f=pct]').textContent = pct(Math.round(shown.bp));
        $('[data-f=rev]').textContent = dollars(shown.rev);
        $('[data-f=margin]').textContent = `${dollars(shown.margin)} · ${pct(Math.round((shown.margin / contract) * 10000))}`;
      };
      const settle = () => { bar.classList.toggle('loss', cur.lossWarning); bar.style.width = barWidth(target.margin, contract); paint(); };
      if (shownCalc === cur.id) return settle(); // already shown (or counting): a re-mounted tab just paints
      const first = shownCalc === undefined;
      shownCalc = cur.id;
      if (first || reduceMotion) { shown = target; return settle(); }
      // count old→new over 0.9 s ease-in-out; the figures flash a willow underline, "was X" fades in, the bar slides (workbench.css .moving)
      paint(); bar.style.width = barWidth(shown.margin, contract); void bar.offsetWidth; // start from what was shown last
      const from = { ...shown }, t0 = performance.now(), el = body.querySelector<HTMLElement>('.ovgrid')!;
      el.classList.remove('moving'); void el.offsetWidth; el.classList.add('moving');
      bar.classList.toggle('loss', cur.lossWarning); bar.style.width = barWidth(target.margin, contract);
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 900), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        shown = { bp: from.bp + (target.bp - from.bp) * e, rev: from.rev + (target.rev - from.rev) * e, margin: from.margin + (target.margin - from.margin) * e };
        paint();
        if (k < 1) requestAnimationFrame(step); else setTimeout(() => el.classList.remove('moving'), 600);
      };
      requestAnimationFrame(step);
    }
    const barWidth = (margin: number, contract: number) => `${Math.max(0, Math.min(1, margin / contract)) * 100}%`;

    function activity(x: M) {
      const agents = new Set(all(d.user.iter()).filter((u) => u.role === 'agent').map((u) => u.name));
      const who = (a: string) => (a === 'Keel Agent' || agents.has(a) ? 'Summo' : a); // Summo is its own actor
      const judge = ctx.judge()?.name ?? 'the manager';
      const events = all(d.historyEvent.iter()).filter((e) => e.projectId === x.proj.id || (e.projectId === 0n && e.summary.endsWith('deployment_manager'))).sort(byId).reverse().slice(0, 40);
      return events.map((e) => {
        const actor = who(e.actor);
        switch (e.kind) {
          case 'register_user': return card('phone', e.summary.replace('registered as deployment_manager', 'joined as deployment manager'), 'Phone page', 'joined', 'ok');
          case 'source_added': {
            const s = d.source.id.find(e.refId);
            if (!s) return card('note', e.summary, actor, actor.toLowerCase());
            const what = s.kind === 'scanned_forecast' ? 'photographed the forecast sheet' : s.kind === 'clarification' ? 'answer recorded' : `“${clip(s.text)}”`;
            return card('note', `${actor}: ${what}`, `${KIND[s.kind] ?? s.kind} v${s.version}`, actor.toLowerCase());
          }
          case 'extraction': {
            const xr = d.extraction.id.find(e.refId);
            const ambiguous = xr?.ambiguityFlag ?? e.summary.includes('ambiguous');
            let amount = '';
            try { const f = JSON.parse(xr?.factsJson ?? '[]'); amount = Array.isArray(f) ? f[0]?.amountText ?? '' : ''; } catch {}
            const reader = READER[xr?.reader ?? e.summary.split(' ')[0]] ?? 'Summo';
            return card('readers', `${amount ? amount + ' read' : 'Read'}${ambiguous ? ', wording ambiguous' : ''}`, `${reader}, for Summo`, ambiguous ? 'ambiguous' : 'read', ambiguous ? 'amber' : '');
          }
          case 'clarification_opened': return card('phone', `Asking ${judge}: ${e.summary}`, 'Summo · phone call', 'asking', 'amber');
          case 'clarification_confirmed': {
            const [name, answer] = e.summary.replace(/\s*\(source \d+\)$/, '').split(': ');
            return card('phone', `${name} answered: ${answer ?? ''}`, 'Confirmed by speaker · voice saved', 'confirmed', 'ok');
          }
          case 'calculation': {
            const c = d.calculation.id.find(e.refId);
            if (!c) return card('calc', e.summary, 'Accounting engine', 'calc');
            const prev = last(x.calcs.filter((y) => y.workItemId === c.workItemId && y.id < c.id));
            const delta = prev ? c.cumRevenueCents - prev.cumRevenueCents : 0n;
            return card('calc', prev ? `Revenue ${dollars(Number(prev.cumRevenueCents))} → ${dollars(Number(c.cumRevenueCents))}` : `Revenue ${dollars(Number(c.cumRevenueCents))}`,
              `Accounting engine · ${pct(c.progressBp)} complete${c.lossWarning ? ' · loss' : ''}`, delta ? `${delta > 0n ? '+' : ''}${dollars(Number(delta))}` : 'no change', c.lossWarning ? 'amber' : '');
          }
          case 'proposed': return card('check', e.summary, 'Summo · waits for Dana', 'proposed');
          case 'proposal_stale': return card('check', e.summary, 'New evidence arrived', 'stale', 'amber');
          case 'decision_approve': case 'decision_return': case 'decision_hold':
            return card('check', e.summary, actor, e.kind.slice(9), e.kind === 'decision_approve' ? 'ok' : 'amber');
          case 'posted': return card('check', e.summary, `${actor} approved · five checks passed`, 'posted', 'ok');
          case 'convention_saved': return card('readers', `Convention learned: ${e.summary}`, `Approved by ${actor}`, 'learned', 'ok');
          case 'period_closed': return card('doc', e.summary, actor, 'closed');
          default: return card('doc', e.summary, actor, e.kind.replace(/_/g, ' '));
        }
      }).join('');
    }

    // ---------- the proposal panel (Overview and Proposals) ----------
    function panel(x: M, p: M['proposals'][number], withActions: boolean) {
      const pg = x.postingOf(p.id);
      const decidable = withActions && x.latestOf(p.workItemId)?.id === p.id;
      let lines: Line[] = [];
      try { lines = JSON.parse(p.entryJson); } catch {}
      const dr = lines.reduce((n, l) => n + BigInt(l.debit), 0n), cr = lines.reduce((n, l) => n + BigInt(l.credit), 0n);
      const expl = p.explanation.split('\n').filter(Boolean);
      const pending = p.pendingConventionJson ? (JSON.parse(p.pendingConventionJson) as { template: string; key: string; value: string }) : null;
      const saved = pending && all(d.convention.iter()).find((c) => c.template === pending.template && c.key === pending.key && c.value === pending.value);
      const refs = all(d.clarificationRef.iter());
      const evidence = ids(p.evidenceSourceIds).map((id) => d.source.id.find(id)).filter((s) => !!s).map((s) => {
        const ref = s.kind === 'clarification' ? refs.find((r) => r.sourceId === s.parentSourceId) : undefined;
        const audio = ref?.audioStorageId ? ` data-audio="${esc(ref.audioStorageId)}"` : '';
        const label = s.kind === 'note' ? `Site update · ${clip(s.text, 24)}` : sourceLabel(s);
        return `<button class="chip" type="button" data-src="${s.id}"${audio}>${audio ? '▶ ' : ''}${esc(label)}</button>`;
      });
      const st = proposalStatus(p, x.postingOf);
      const t = st === 'open' ? tag('awaiting Dana', 'amber') : tag(st, statusTone(st));
      const ui = tickState(p.id);
      const checks = ['role · controller', 'revision · current', `period · ${x.proj.periodOpen ? 'open' : 'closed'}`, `balanced · ${usd(dr)} = ${usd(cr)}`, 'duplicate · none'];
      const canPost = !pg && (p.status === 'open' || p.status === 'approved');
      const acts = pg ? `<p class="posted">Posted ${esc(pg.postingRef)} · ${esc(pg.postedBy)} · ${pg.postedAt.toDate().toLocaleTimeString()}</p>`
        : !decidable ? ''
        : `<button class="pill dark sm" type="button" data-act="approve" data-pid="${p.id}"${canPost && !ui.busy ? '' : ' disabled'}>Approve and post</button>` +
          (p.status === 'open' ? `<button class="pill outline sm" type="button" data-act="return" data-pid="${p.id}"${ui.busy ? ' disabled' : ''}>Return</button><button class="pill outline sm" type="button" data-act="hold" data-pid="${p.id}"${ui.busy ? ' disabled' : ''}>Hold</button>` : '');
      const wi = x.items.find((w) => w.id === p.workItemId);
      return `<article class="proposal${decidable && !pg && p.status === 'open' ? ' open' : ''}">` +
        `<h3>Proposal rev ${p.revision} ${t}</h3>${x.items.length > 1 && wi ? `<p class="small">${esc(wi.title)}</p>` : ''}` +
        `<div class="entry">${lines.map((l) => { const isDr = BigInt(l.debit) > 0n; return `<div class="${isDr ? 'dr' : 'cr'}"><span>${isDr ? 'Dr' : 'Cr'}</span><span>${esc(ACCOUNT[l.account] ?? l.account)}</span><span>${usd(isDr ? BigInt(l.debit) : BigInt(l.credit))}</span></div>`; }).join('')}</div>` +
        `<div class="expl">${expl.map((y) => `<p class="${y.startsWith('ESCALATION:') ? 'esc' : ''}">${esc(y)}</p>`).join('')}</div>` +
        (evidence.length ? `<p class="small">Evidence</p><div class="evid">${evidence.join('')}</div>` : '') +
        (saved ? `<p class="saved">Convention saved: ${esc(saved.key.replace(/_/g, ' '))} ${esc(saved.value)}</p>`
          : pending ? `<p class="small">Approving saves: ${esc(`${pending.template}.${pending.key} = ${pending.value}`)}</p>` : '') +
        (p.status === 'stale' && decidable ? '<p class="small">New evidence arrived after this proposal. Summo is rewriting the entry.</p>' : '') +
        (acts ? `<div class="acts">${acts}</div>` : '') +
        (decidable && (canPost || ui.checks[0]) ? `<ul class="checks">${checks.map((c, i) => `<li class="${ui.checks[i]}">${esc(c)}</li>`).join('')}</ul>` : '') +
        `</article>`;
    }

    // ---------- Sources ----------
    let sourcesKey = '';
    function sources() {
      body.innerHTML = `<h2>On file</h2><div class="chips" data-f="chips"></div><h2>Every source</h2><table class="tbl"><thead><tr><th>Source</th><th>Kind</th><th>Version</th><th>Text</th><th></th></tr></thead><tbody data-f="rows"></tbody></table>`;
      return () => {
        const x = m();
        if (!x) return;
        const seed = all(d.convention.iter()).sort(byId)[0]; // the seeded convention cites the six prior closes
        const past = new Set(seed ? ids(seed.exampleSourceIds).map(String) : []);
        const srcs = all(d.source.iter()).filter((s) => s.projectId === x.proj.id).sort(byId);
        const refs = all(d.clarificationRef.iter());
        const key = srcs.map((s) => s.id).join() + '|' + [...past].join() + '|' + refs.map((r) => r.audioStorageId).join();
        if (key === sourcesKey) return; // keep focus on the chips while nothing changed
        sourcesKey = key;
        const chip = (label: string, data: string) => `<button class="chip" type="button" data-src="${data}">${esc(label)}</button>`;
        $('[data-f=chips]').innerHTML = srcs.filter((s) => !past.has(String(s.id))).map((s) => chip(sourceLabel(s), String(s.id))).join('') +
          (past.size ? chip(`${past.size} past closes`, [...past].join(',')) : '') + chip(`Policy v${last(all(d.policy.iter()))?.version ?? ''}`, 'policy');
        $('[data-f=rows]').innerHTML = [...srcs].reverse().map((s) => {
          const ref = s.kind === 'clarification' ? refs.find((r) => r.sourceId === s.parentSourceId) : undefined;
          const extra = ref?.audioStorageId ? `<button class="chip" type="button" data-audio="${esc(ref.audioStorageId)}">▶ voice</button>`
            : s.kind === 'scanned_forecast' ? `<button class="chip" type="button" data-src="${s.id}">image + OCR</button>` : '';
          const text = s.kind === 'scanned_forecast' ? 'Photographed forecast sheet' : clip(s.text, 90);
          return `<tr data-src="${s.id}"><td class="mono">#${s.id}</td><td>${esc(KIND[s.kind] ?? s.kind)}${past.has(String(s.id)) ? ' · past close' : ''}</td><td class="mono">v${s.version}</td><td>${esc(text)}</td><td>${extra}</td></tr>`;
        }).join('');
      };
    }

    // ---------- Calculations ----------
    function calculations() {
      body.innerHTML = `<table class="tbl"><thead><tr><th>Calc</th><th>Work item</th><th class="num">Progress</th><th class="num">Cum revenue</th><th class="num">Contract asset</th><th class="num">Margin</th><th>Loss</th><th>Forecast source</th></tr></thead><tbody data-f="rows"></tbody></table>`;
      return () => {
        const x = m();
        if (!x) return;
        setHtml($('[data-f=rows]'), [...x.calcs].reverse().map((c) => {
          const s = d.source.id.find(c.forecastSourceId), wi = x.items.find((w) => w.id === c.workItemId);
          return `<tr class="${c.id === x.cur?.id ? 'cur' : ''}"><td class="mono">#${c.id}</td><td>${esc(clip(wi?.title ?? '', 40))}</td><td class="num">${pct(c.progressBp)}</td><td class="num">${usd(c.cumRevenueCents)}</td><td class="num">${usd(c.contractAssetCents)}</td>` +
            `<td class="num${c.lossWarning ? ' amber' : ''}">${usd(c.marginCents)}</td><td>${c.lossWarning ? tag('loss', 'amber') : ''}</td><td>${s ? `<button class="chip" type="button" data-src="${s.id}">${esc(clip(sourceLabel(s), 36))}</button>` : '—'}</td></tr>`;
        }).join('') || '<tr><td colspan="8" class="empty">No calculations yet.</td></tr>');
      };
    }

    // ---------- Proposals (+ break it) ----------
    function proposals() {
      body.innerHTML = `<div class="plist" data-f="list"></div>
        <section class="breakit"><h2>Try to break it</h2><p class="small">Each of these is refused by a ledger reducer, not by this page.</p>
        <div class="acts"><button class="pill danger sm" type="button" data-break="again">Post it again</button>
        <button class="pill danger sm" type="button" data-break="accountant">Approve as the accountant</button>
        <button class="pill danger sm" type="button" data-break="forecast">Change the forecast after approval</button></div>
        <p class="refusal" role="status" aria-live="polite"></p></section>`;
      return () => {
        const x = m();
        if (!x) return;
        const list = [...x.proposals].reverse();
        setHtml($('[data-f=list]'), list.map((p) => panel(x, p, true)).join('') || '<p class="empty">No proposals yet. Summo writes one after the next site update.</p>');
      };
    }

    // ---------- actions ----------
    async function approveAndPost(id: bigint) {
      const p = d.proposal.id.find(id), x = m();
      const ui = tickState(id);
      if (!p || !x || ui.busy) return;
      ui.busy = true; ui.checks = ['', '', '', '', '']; draw();
      const prefix = x.proj.name.slice(0, 3).toUpperCase();
      const ref = `${prefix}-WI${p.workItemId}-R${p.revision}`; // unique across work items (frontend-guide §7)
      let err = p.status === 'approved' ? null : await call(ctx.conn.reducers.decide({ proposalId: p.id, revision: p.revision, decision: 'approve', reason: '' }));
      if (!err) err = await call(ctx.conn.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: ref }));
      const failAt = err ? CHECK_OF[codeOf(err)] ?? 1 : 5;
      for (let i = 0; i <= Math.min(failAt, 4); i++) { await sleep(120); ui.checks[i] = i < failAt ? 'ok' : 'bad'; draw(); } // tick top to bottom
      ui.busy = false;
      if (err) refuse(err); else { ctx.toast(`Posted ${ref}`, 'ok'); ctx.summo('posted', ref); }
      draw();
    }

    async function decideWith(id: bigint, decision: 'return' | 'hold') {
      const p = d.proposal.id.find(id);
      if (!p) return;
      const reason = prompt(decision === 'return' ? 'Why return it to Summo?' : 'Why hold it?');
      if (reason === null) return;
      const err = await call(ctx.conn.reducers.decide({ proposalId: p.id, revision: p.revision, decision, reason }));
      if (err) refuse(err); else ctx.toast(`Rev ${p.revision} ${decision === 'return' ? 'returned to Summo' : 'held'}`, 'warn');
    }

    const expectRefusal = (err: string | null) => (err ? refuse(err) : proof('Accepted: the ledger did not refuse this.'));
    // "Break it" (frontend-guide §9): each must be refused by a reducer, not by the UI.
    const BREAK: Record<string, () => Promise<void>> = {
      async again() {
        const x = m(), p = x && [...x.proposals].reverse().find((y) => x.postingOf(y.id));
        const pg = p && x!.postingOf(p.id);
        if (!p || !pg) return proof('Post an entry first.');
        expectRefusal(await call(ctx.conn.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: pg.postingRef })));
      },
      async accountant() {
        const x = m(), p = x?.main && x.latestOf(x.main.id);
        if (!p) return proof('No proposal to approve yet.');
        priya ??= connect('accountant', 'Priya', ['user']);
        const c = await priya.catch((e) => { priya = undefined; throw e; });
        expectRefusal(await call(c.reducers.decide({ proposalId: p.id, revision: p.revision, decision: 'approve', reason: '' })));
      },
      async forecast() {
        const x = m(), p = x?.main && x.latestOf(x.main.id);
        if (!x) return;
        const err = await call(ctx.conn.reducers.addSource({ projectId: x.proj.id, kind: 'note', text: 'Updated forecast: Remaining Estimate: $700,000', parentSourceId: 0n, version: 3 }));
        if (err) return refuse(err);
        if (p?.status !== 'open') return proof('The posted entry stays posted. Summo is reading the new forecast and will propose a new adjustment.');
        expectRefusal(await call(ctx.conn.reducers.decide({ proposalId: p.id, revision: p.revision, decision: 'approve', reason: '' }))); // now stale
      },
    };

    async function openSheet(data: string) {
      const sheet = document.getElementById('sheet')!, sb = document.getElementById('sheetBody')!, st = document.getElementById('sheetTitle')!;
      sheet.hidden = false;
      if (data === 'policy') {
        const pol = last(all(d.policy.iter()));
        st.textContent = `Policy v${pol?.version ?? ''}`;
        sb.innerHTML = `<article>${esc(pol?.text ?? '')}</article>`;
        return;
      }
      const srcs = ids(data).map((id) => d.source.id.find(id)).filter((s) => !!s);
      st.textContent = srcs.length > 1 ? `${srcs.length} past closes` : srcs[0] ? sourceLabel(srcs[0]) : 'Source';
      sb.innerHTML = srcs.map((s) => {
        if (s.kind !== 'scanned_forecast') return `<article><b>${esc(KIND[s.kind] ?? s.kind)} v${s.version} · source ${s.id}</b>${esc(s.text)}</article>`;
        const di = all(d.extraction.iter()).find((y) => y.sourceId === s.id && y.reader === 'azure-di');
        let text = 'Reading document…';
        try { if (di) text = JSON.parse(di.factsJson).text ?? di.factsJson; } catch {}
        return `<article><b>Forecast sheet (photo) · Azure Document Intelligence</b>${esc(text)}<img data-storage="${esc(s.text)}" alt="Photographed forecast sheet"></article>`;
      }).join('');
      for (const img of sb.querySelectorAll<HTMLImageElement>('img[data-storage]')) {
        const url = await ctx.convex.query(ctx.api.clarifications.audioUrl, { storageId: img.dataset.storage as any }).catch(() => null);
        if (url) img.src = url; else img.remove();
      }
    }
    async function playAudio(storageId: string) {
      const url = await ctx.convex.query(ctx.api.clarifications.audioUrl, { storageId: storageId as any }).catch(() => null);
      if (url) new Audio(url).play().catch(() => {}); else ctx.toast('No recording for this answer.', 'warn');
    }

    const onClick = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-audio],[data-src],[data-break]');
      if (!t) return;
      const id = t.dataset.pid ? BigInt(t.dataset.pid) : 0n;
      if (t.dataset.act === 'approve') approveAndPost(id);
      else if (t.dataset.act === 'return' || t.dataset.act === 'hold') decideWith(id, t.dataset.act);
      else if (t.dataset.break) BREAK[t.dataset.break]().catch((err) => refuse(String(err?.message ?? err)));
      else if (t.dataset.audio) playAudio(t.dataset.audio);
      else if (t.dataset.src) openSheet(t.dataset.src);
    };
    root.addEventListener('click', onClick);

    const tabDraw = { overview, sources, calculations, proposals }[tab]();
    const draw = () => { header(); tabDraw(); };
    const stop = live(ctx, draw);
    const stopJudge = ctx.convex.onUpdate(ctx.api.managers.current, {}, () => draw()); // join card + "asking <Name>"
    return () => { stop(); stopJudge(); root.removeEventListener('click', onClick); };
  },
};
export default page;
