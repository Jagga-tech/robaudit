// Page 2, the live workbench (Figma "07 — Landing Page": 04 First screen 67:120, 04b After the answer 78:291, motion spec 78:437).
// One user: Dana, controller. Everything is read from the SpacetimeDB client cache on each render (docs/frontend-guide.md §7, §9, §10).
import { connect, onChange, call, codeOf, usd, dollars, pct, ids, STDB_URI, type DbConnection } from './lib/ledger';
import { convex, api } from './lib/convex';

declare const qrcode: any; // qrcode-generator 1.4.4, classic script from cdnjs (workbench.html)

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const clip = (s: string, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const all = <T>(it: Iterable<T>) => [...it];
const byId = (a: { id: bigint }, b: { id: bigint }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const last = <T>(xs: T[]) => xs[xs.length - 1] as T | undefined;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ICON: Record<string, string> = {
  note: 'M4 5h16v10H9l-5 4z',
  readers: 'M12 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 8v4l3 2M3 12h2M19 12h2',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  calc: 'M5 3h14v18H5zM8 7h8M8 12h3M13 12h3M8 16h3M13 16h3',
  check: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-4',
  doc: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3',
};
const KIND: Record<string, string> = {
  contract: 'Contract', cost_export: 'Cost export', forecast: 'Forecast', invoice: 'Invoice', note: 'Site note',
  clarification: 'Clarification', commissioning_log: 'Commissioning log', scanned_forecast: 'Forecast sheet (photo)',
};
const READER: Record<string, string> = { claude: 'Claude', gemini: 'Gemini', 'azure-di': 'Azure Document Intelligence' };
const ACCOUNT: Record<string, string> = { Revenue: 'Revenue', ContractAsset: 'Contract asset', AccountsReceivable: 'Accounts receivable' };
// post() checks in its own order (spacetimedb/src/index.ts); a refusal code maps to the check that failed.
const CHECK_OF: Record<string, number> = { role: 0, not_approved: 1, revision: 1, stale: 1, period_closed: 2, unbalanced: 3, bad_input: 3, duplicate_posting: 4 };

let dana: DbConnection | undefined;
let priya: Promise<DbConnection> | undefined; // second connection, opened only for "Approve as the accountant"
let manager: { _id: any; name: string } | null = null;
let refusedUntil = 0;
const ui = { pid: -1n, checks: ['', '', '', '', ''], busy: false }; // posting state of the proposal on screen
let shownCalc: bigint | undefined, shown = { bp: 0, rev: 0, margin: 0 }; // what the hero figures show right now
let seenProp: bigint | undefined, seenPosting: bigint | undefined;

type Line = { account: string; debit: string; credit: string };
type Model = NonNullable<ReturnType<typeof model>>;

function model() {
  const d = dana!.db;
  const proj = all(d.project.iter()).find((p) => p.name === 'Oakland deployment');
  if (!proj) return null;
  const items = all(d.workItem.iter()).filter((w) => w.projectId === proj.id).sort(byId);
  const oak = items.find((w) => w.title.startsWith('Oakland')) ?? items[0]; // never cache ids: they shift after every reset
  const calcs = all(d.calculation.iter()).filter((c) => c.workItemId === oak?.id).sort(byId);
  const proposals = all(d.proposal.iter()).sort((a, b) => a.revision - b.revision || byId(a, b));
  const props = proposals.filter((p) => p.workItemId === oak?.id);
  const postings = all(d.posting.iter()).sort(byId);
  const postingOf = (pid: bigint) => postings.find((x) => x.proposalId === pid);
  const cur = last(calcs);
  // "was": the calculation behind the latest approved/posted proposal, older than the one on screen (Summo's baseline, loop.ts)
  const base = props.filter((p) => (p.status === 'approved' || p.status === 'posted') && p.calculationId !== 0n && cur && p.calculationId < cur.id).pop();
  const before = base && calcs.find((c) => c.id === base.calculationId);
  const events = all(d.historyEvent.iter()).filter((e) => e.projectId === proj.id || e.projectId === 0n).sort(byId).reverse();
  return { d, proj, items, oak, calcs, cur, before, p: last(props), proposals, postings, postingOf, events };
}

// ---- render (coalesced to one per frame; resetDemo fires a callback per row) ----
let queued = false;
function schedule() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; render(); }); } }

function render() {
  if (!dana) return;
  const m = model();
  if (!m) return;
  $('projMeta').textContent = `Aster Robotics · contract ${usd(m.proj.contractValueCents)} · policy v${last(all(m.d.policy.iter()))?.version ?? ''}`;
  renderFigures(m);
  renderActivity(m);
  renderQueue(m);
  renderSources(m);
  renderProposal(m);
  renderHeader(m);
}

function renderHeader(m: Model) {
  $('badgeText').textContent = `Summo · ${badgeState(m)}`;
  $('presence').hidden = !manager;
  $('presence').textContent = manager ? `${manager.name} · deployment manager, on phone` : '';
  $('joined').hidden = !manager;
  $('joined').textContent = manager ? `${manager.name} joined as deployment manager` : '';
  // Summo spins once when a new proposal lands, wiggles on posted (refusals wiggle in refuse()).
  const p = m.p, pg = last(m.postings);
  if (seenProp !== undefined && p && p.id !== seenProp && p.status === 'open') play('spin');
  if (seenPosting !== undefined && pg && pg.id !== seenPosting) play('wiggle');
  seenProp = p?.id ?? 0n; seenPosting = pg?.id ?? 0n;
}

function badgeState(m: Model): string {
  if (Date.now() < refusedUntil) return 'refused';
  const asking = `asking ${manager?.name ?? 'the manager'}`;
  if (m.oak?.status === 'awaiting_clarification') return asking;
  switch (m.events.find((e) => e.projectId === m.proj.id)?.kind) {
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

// ---- hero figures: the one orchestrated motion, once per NEW calculation row ----
function renderFigures(m: Model) {
  const { cur, before } = m;
  if (!cur) return;
  const contract = Number(m.proj.contractValueCents);
  const j = JSON.parse(cur.inputsJson), incurred = BigInt(j.incurredCents), remaining = BigInt(j.remainingCents);
  $('subPct').textContent = `${usd(incurred)} incurred of ${usd(incurred + remaining)} estimated`;
  $('subRev').textContent = `billed ${usd(BigInt(j.billedCents))} · contract asset ${usd(cur.contractAssetCents)}`;
  $('wasPct').textContent = before ? `was ${pct(before.progressBp)}` : '';
  $('wasRev').textContent = before ? `was ${dollars(Number(before.cumRevenueCents))}` : '';
  $('lossTag').hidden = !cur.lossWarning;
  if (shownCalc === cur.id) return;
  const first = shownCalc === undefined;
  shownCalc = cur.id;
  const target = { bp: cur.progressBp, rev: Number(cur.cumRevenueCents), margin: Number(cur.marginCents) };
  const bar = $('marginBar');
  if (first || reduce) { shown = target; paintFigures(contract); bar.classList.toggle('loss', cur.lossWarning); bar.style.width = barWidth(target.margin, contract); return; }
  // count old→new over 0.9 s ease-in-out; "was X" fades in and the margin bar slides/recolors under .moving (workbench.css)
  const from = { ...shown }, t0 = performance.now(), body = document.body;
  body.classList.remove('moving'); void body.offsetWidth; body.classList.add('moving');
  bar.classList.toggle('loss', cur.lossWarning); bar.style.width = barWidth(target.margin, contract);
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / 900), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    shown = { bp: from.bp + (target.bp - from.bp) * e, rev: from.rev + (target.rev - from.rev) * e, margin: from.margin + (target.margin - from.margin) * e };
    paintFigures(contract);
    if (k < 1) requestAnimationFrame(step); else setTimeout(() => body.classList.remove('moving'), 50);
  };
  requestAnimationFrame(step);
}
const barWidth = (margin: number, contract: number) => `${Math.max(0, Math.min(1, margin / contract)) * 100}%`;
function paintFigures(contract: number) {
  $('figPct').textContent = pct(Math.round(shown.bp));
  $('figRev').textContent = dollars(shown.rev);
  $('marginVal').textContent = `${dollars(shown.margin)} · ${pct(Math.round((shown.margin / contract) * 10000))}`;
}

// ---- Activity, Queue, Sources (the landing feed's .card markup) ----
function card(ic: string, title: string, sub: string, tag: string, tone = '') {
  return `<li class="card"><div class="ibox"><svg viewBox="0 0 24 24"><path d="${ICON[ic]}"/></svg></div>` +
    `<div><b>${esc(title)}</b><i><svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>${esc(sub)}</i></div>` +
    `<span class="tag ${tone}">${esc(tag)}</span></li>`;
}

function renderActivity(m: Model) {
  const agents = new Set(all(m.d.user.iter()).filter((u) => u.role === 'agent').map((u) => u.name));
  const who = (a: string) => (a === 'Keel Agent' || agents.has(a) ? 'Summo' : a); // Summo is its own actor
  $('activity').innerHTML = m.events.filter((e) => e.kind !== 'register_user' || e.summary.endsWith('deployment_manager')).slice(0, 40).map((e) => {
    const actor = who(e.actor);
    switch (e.kind) {
      case 'register_user': return card('phone', e.summary.replace('registered as deployment_manager', 'joined as deployment manager'), 'Phone page', 'joined', 'ok');
      case 'source_added': {
        const s = m.d.source.id.find(e.refId);
        if (!s) return card('note', e.summary, actor, actor.toLowerCase());
        const what = s.kind === 'scanned_forecast' ? 'photographed the forecast sheet' : s.kind === 'clarification' ? 'answer recorded' : `“${clip(s.text)}”`;
        return card('note', `${actor}: ${what}`, `${KIND[s.kind] ?? s.kind} v${s.version}`, actor.toLowerCase());
      }
      case 'extraction': {
        const x = m.d.extraction.id.find(e.refId);
        const ambiguous = x?.ambiguityFlag ?? e.summary.includes('ambiguous');
        let amount = '';
        try { const f = JSON.parse(x?.factsJson ?? '[]'); amount = Array.isArray(f) ? f[0]?.amountText ?? '' : ''; } catch {}
        const reader = READER[x?.reader ?? e.summary.split(' ')[0]] ?? 'Summo';
        return card('readers', `${amount ? amount + ' read' : 'Read'}${ambiguous ? ', wording ambiguous' : ''}`, `${reader}, for Summo`, ambiguous ? 'ambiguous' : 'read', ambiguous ? 'amber' : '');
      }
      case 'clarification_opened':
        return card('phone', `Asking ${manager?.name ?? 'the manager'}: ${e.summary}`, 'Summo · phone call', 'asking', 'amber');
      case 'clarification_confirmed': {
        const [name, answer] = e.summary.replace(/\s*\(source \d+\)$/, '').split(': ');
        return card('phone', `${name} answered: ${answer ?? ''}`, 'Confirmed by speaker · voice saved', 'confirmed', 'ok');
      }
      case 'calculation': {
        const c = m.d.calculation.id.find(e.refId);
        if (!c) return card('calc', e.summary, 'Accounting engine', 'calc');
        const prev = last(all(m.d.calculation.iter()).filter((x) => x.workItemId === c.workItemId && x.id < c.id).sort(byId));
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
      default: return card('doc', e.summary, actor, e.kind.replace(/_/g, ' '));
    }
  }).join('');
}

function renderQueue(m: Model) {
  $('queue').innerHTML = m.items.map((w) => {
    const p = last(m.proposals.filter((x) => x.workItemId === w.id));
    const pg = p && m.postingOf(p.id);
    if (pg) return card('doc', w.title, `Posted ${pg.postingRef} · Summo proposed, ${pg.postedBy} approved`, 'posted', 'ok');
    const st = p?.status ?? w.status;
    const tone = st === 'stale' || w.status === 'awaiting_clarification' ? 'amber' : st === 'open' ? '' : 'ok';
    return card('doc', w.title, p ? `Rev ${p.revision} · ${w.status.replace(/_/g, ' ')}` : w.status.replace(/_/g, ' '), st, tone);
  }).join('') + '';
}

function sourceLabel(s: { kind: string; version: number; text: string }) {
  if (s.kind === 'forecast') return `Forecast v${s.version}`;
  if (s.kind === 'note') return `Site note · “${clip(s.text, 30)}”`;
  if (s.kind === 'clarification') {
    const who = s.text.match(/Clarification from ([^:]+):/)?.[1] ?? 'Manager', a = s.text.match(/A: (.*)$/)?.[1] ?? '';
    return `${who}: “${a}”`;
  }
  return KIND[s.kind] ?? s.kind;
}

let sourcesKey = '';
function renderSources(m: Model) {
  const seed = all(m.d.convention.iter()).sort(byId)[0]; // the seeded convention cites the six prior closes
  const past = new Set(seed ? ids(seed.exampleSourceIds).map(String) : []);
  const srcs = all(m.d.source.iter()).filter((s) => s.projectId === m.proj.id).sort(byId);
  const key = srcs.map((s) => s.id).join() + '|' + [...past].join();
  if (key === sourcesKey) return; // keep focus on the chips while nothing changed
  sourcesKey = key;
  const chip = (label: string, data: string) => `<button class="chip" type="button" data-src="${data}">${esc(label)}</button>`;
  $('sources').innerHTML = srcs.filter((s) => !past.has(String(s.id))).map((s) => chip(sourceLabel(s), String(s.id))).join('') +
    (past.size ? chip(`${past.size} past closes`, [...past].join(',')) : '') + chip(`Policy v${last(all(m.d.policy.iter()))?.version ?? ''}`, 'policy');
}

// ---- the proposal panel (slides in from the right) ----
function renderProposal(m: Model) {
  const p = m.p, panel = $('proposal');
  const show = !!p && p.status !== 'posted'; // 'posted' only on the S0 seed: nothing to decide yet
  panel.hidden = !show;
  $('joinCard').hidden = show;
  if (!p || !show) return;
  if (ui.pid !== p.id) Object.assign(ui, { pid: p.id, checks: ['', '', '', '', ''], busy: false });
  const pg = m.postingOf(p.id);
  let lines: Line[] = [];
  try { lines = JSON.parse(p.entryJson); } catch {}
  const dr = lines.reduce((n, l) => n + BigInt(l.debit), 0n), cr = lines.reduce((n, l) => n + BigInt(l.credit), 0n);
  const expl = p.explanation.split('\n').filter(Boolean);
  const pending = p.pendingConventionJson ? (JSON.parse(p.pendingConventionJson) as { template: string; key: string; value: string }) : null;
  const saved = pending && all(m.d.convention.iter()).find((c) => c.template === pending.template && c.key === pending.key && c.value === pending.value);
  const refs = all(m.d.clarificationRef.iter());
  const evidence = ids(p.evidenceSourceIds).map((id) => m.d.source.id.find(id)).filter((s) => !!s).map((s) => {
    const ref = s.kind === 'clarification' ? refs.find((r) => r.sourceId === s.parentSourceId) : undefined;
    const audio = ref?.audioStorageId ? ` data-audio="${esc(ref.audioStorageId)}"` : '';
    const label = s.kind === 'note' ? `Site update · ${clip(s.text, 24)}` : sourceLabel(s);
    return `<button class="chip" type="button" data-src="${s.id}"${audio}>${audio ? '▶ ' : ''}${esc(label)}</button>`;
  });
  const tag = pg ? '<span class="tag ok">posted</span>' : p.status === 'open' ? '<span class="tag ok">awaiting Dana</span>'
    : `<span class="tag ${p.status === 'stale' ? 'amber' : ''}">${esc(p.status)}</span>`;
  const checks = ['role · controller', 'revision · current', 'period · open', `balanced · ${usd(dr)} = ${usd(cr)}`, 'duplicate · none'];
  const canPost = !pg && (p.status === 'open' || p.status === 'approved');
  const acts = pg ? `<p class="posted">Posted ${esc(pg.postingRef)}</p>`
    : `<button class="pill dark sm" type="button" data-act="approve"${canPost && !ui.busy ? '' : ' disabled'}>Approve and post</button>` +
      (p.status === 'open' ? `<button class="pill outline sm" type="button" data-act="return"${ui.busy ? ' disabled' : ''}>Return</button><button class="pill outline sm" type="button" data-act="hold"${ui.busy ? ' disabled' : ''}>Hold</button>` : '') +
      (p.status === 'stale' ? '<span class="tag amber">stale</span>' : '');
  panel.innerHTML =
    `<h3>Proposal rev ${p.revision} ${tag}</h3>` +
    `<div class="entry">${lines.map((l) => { const d = BigInt(l.debit) > 0n; return `<div class="${d ? 'dr' : 'cr'}"><span>${d ? 'Dr' : 'Cr'}</span><span>${esc(ACCOUNT[l.account] ?? l.account)}</span><span>${usd(d ? BigInt(l.debit) : BigInt(l.credit))}</span></div>`; }).join('')}</div>` +
    `<div class="expl">${expl.map((x) => `<p class="${x.startsWith('ESCALATION:') ? 'esc' : ''}">${esc(x)}</p>`).join('')}</div>` +
    `<p class="small">Evidence</p><div class="evid">${evidence.join('')}</div>` +
    (saved ? `<p class="saved">Convention saved: ${esc(saved.key.replace(/_/g, ' '))} ${esc(saved.value)}</p>`
      : pending ? `<p class="small">Approving saves: ${esc(`${pending.template}.${pending.key} = ${pending.value}`)}</p>` : '') +
    (p.status === 'stale' ? '<p class="small">New evidence arrived after this proposal. Summo is rewriting the entry.</p>' : '') +
    `<div class="acts">${acts}</div>` +
    `<ul class="checks">${checks.map((c, i) => `<li class="${ui.checks[i]}">${esc(c)}</li>`).join('')}</ul>`;
}

// ---- actions ----
async function approveAndPost() {
  const p = model()?.p;
  if (!dana || !p || ui.busy) return;
  ui.busy = true; ui.checks = ['', '', '', '', '']; schedule();
  const ref = `OAK-WI${p.workItemId}-R${p.revision}`; // unique across work items (frontend-guide §7)
  let err = p.status === 'approved' ? null : await call(dana.reducers.decide({ proposalId: p.id, revision: p.revision, decision: 'approve', reason: '' }));
  if (!err) err = await call(dana.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: ref }));
  const failAt = err ? CHECK_OF[codeOf(err)] ?? 1 : 5;
  for (let i = 0; i <= Math.min(failAt, 4); i++) { await sleep(120); ui.checks[i] = i < failAt ? 'ok' : 'bad'; schedule(); } // tick top to bottom
  ui.busy = false;
  if (err) refuse(err);
  schedule();
}

async function decideWith(decision: 'return' | 'hold') {
  const p = model()?.p;
  if (!dana || !p) return;
  const reason = prompt(decision === 'return' ? 'Why return it to Summo?' : 'Why hold it?');
  if (reason === null) return;
  const err = await call(dana.reducers.decide({ proposalId: p.id, revision: p.revision, decision, reason }));
  if (err) refuse(err);
}

let flashTimer = 0;
function flash(html: string, danger: boolean) {
  const el = $('refusal');
  el.innerHTML = html; el.classList.toggle('info', !danger);
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { el.textContent = ''; schedule(); }, 4000);
}
function refuse(msg: string) {
  flash(`<b>Refused ·</b>${esc(msg)}`, true);
  refusedUntil = Date.now() + 4000;
  play('wiggle');
  schedule();
}
const expectRefusal = (err: string | null) => (err ? refuse(err) : flash('Accepted: the ledger did not refuse this.', false));

// "Break it" (frontend-guide §9): each must be refused by a reducer, not by the UI.
const BREAK: Record<string, () => Promise<void>> = {
  async again() {
    const m = model(), p = m && [...m.proposals].reverse().find((x) => m.postingOf(x.id));
    const pg = p && m!.postingOf(p.id);
    if (!p || !pg) return flash('Post an entry first.', false);
    expectRefusal(await call(dana!.reducers.post({ proposalId: p.id, revision: p.revision, postingRef: pg.postingRef })));
  },
  async accountant() {
    const p = model()?.p;
    if (!p) return;
    priya ??= connect('accountant', 'Priya', ['user']);
    const c = await priya.catch((e) => { priya = undefined; throw e; });
    expectRefusal(await call(c.reducers.decide({ proposalId: p.id, revision: p.revision, decision: 'approve', reason: '' })));
  },
  async forecast() {
    const m = model(), p = m?.p;
    if (!m) return;
    const err = await call(dana!.reducers.addSource({ projectId: m.proj.id, kind: 'note', text: 'Updated forecast: Remaining Estimate: $700,000', parentSourceId: 0n, version: 3 }));
    if (err) return refuse(err);
    if (p?.status !== 'open') return flash('The posted entry stays posted. Summo is reading the new forecast and will propose a new adjustment.', false);
    expectRefusal(await call(dana!.reducers.decide({ proposalId: p.id, revision: p.revision, decision: 'approve', reason: '' }))); // now stale
  },
};

async function openSheet(data: string) {
  const d = dana!.db, sheet = $('sheet'), body = $('sheetBody');
  sheet.hidden = false;
  if (data === 'policy') {
    const pol = last(all(d.policy.iter()));
    $('sheetTitle').textContent = `Policy v${pol?.version ?? ''}`;
    body.innerHTML = `<article>${esc(pol?.text ?? '')}</article>`;
    return;
  }
  const srcs = ids(data).map((id) => d.source.id.find(id)).filter((s) => !!s);
  $('sheetTitle').textContent = srcs.length > 1 ? `${srcs.length} past closes` : srcs[0] ? sourceLabel(srcs[0]) : 'Source';
  body.innerHTML = srcs.map((s) => {
    if (s.kind !== 'scanned_forecast') return `<article><b>${esc(KIND[s.kind] ?? s.kind)} v${s.version} · source ${s.id}</b>${esc(s.text)}</article>`;
    const di = all(d.extraction.iter()).find((x) => x.sourceId === s.id && x.reader === 'azure-di');
    let text = 'Reading document…';
    try { if (di) text = JSON.parse(di.factsJson).text ?? di.factsJson; } catch {}
    return `<article><b>Forecast sheet (photo) · Azure Document Intelligence</b>${esc(text)}<img data-storage="${esc(s.text)}" alt="Photographed forecast sheet"></article>`;
  }).join('');
  for (const img of body.querySelectorAll<HTMLImageElement>('img[data-storage]')) {
    const url = await convex.query(api.clarifications.audioUrl, { storageId: img.dataset.storage as any }).catch(() => null);
    if (url) img.src = url; else img.remove();
  }
}

async function playAudio(storageId: string) {
  const url = await convex.query(api.clarifications.audioUrl, { storageId: storageId as any }).catch(() => null);
  if (url) new Audio(url).play().catch(() => {});
}

// ---- wiring ----
document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-src],[data-break]');
  if (!t || !dana) return;
  if (t.dataset.act === 'approve') approveAndPost();
  else if (t.dataset.act === 'return' || t.dataset.act === 'hold') decideWith(t.dataset.act);
  else if (t.dataset.break) BREAK[t.dataset.break]().catch((err) => refuse(String(err?.message ?? err)));
  else if (t.dataset.audio) playAudio(t.dataset.audio);
  else if (t.dataset.src) openSheet(t.dataset.src);
});
$('sheetClose').addEventListener('click', () => { $('sheet').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('sheet').hidden = true; });

// Reset (frontend-guide §10): ledger, open calls, presence; then back to 02, the QR poster on the landing page.
$('resetBtn').addEventListener('click', async () => {
  if (!dana) return;
  const btn = $('resetBtn') as HTMLButtonElement;
  btn.disabled = true;
  const err = await call(dana.reducers.resetDemo({}));
  if (err) { btn.disabled = false; return refuse(err); }
  await convex.mutation(api.clarifications.resetOpen, {}).catch(() => {});
  const cur = await convex.query(api.managers.current, {}).catch(() => null);
  if (cur) await convex.mutation(api.managers.leave, { id: cur._id }).catch(() => {});
  location.href = '/';
});

const PHONE_URL = location.origin + '/phone';
try {
  const q = qrcode(0, 'M'); q.addData(PHONE_URL); q.make();
  $('qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }).replace(/fill="black"/g, 'fill="#263336"');
} catch { $('qr').textContent = 'QR unavailable'; }
$('qrUrl').textContent = PHONE_URL.replace(/^https?:\/\//, '');

convex.onUpdate(api.managers.current, {}, (m) => { manager = m; schedule(); });
setInterval(() => { if (refusedUntil && Date.now() > refusedUntil) { refusedUntil = 0; schedule(); } }, 500); // badge leaves "refused"
connect('controller', 'Dana').then((c) => { dana = c; onChange(schedule); render(); }, (e) => {
  $('activity').innerHTML = `<li class="err">Cannot reach the ledger at ${esc(STDB_URI)}: ${esc(String(e?.message ?? e))}</li>`;
});
