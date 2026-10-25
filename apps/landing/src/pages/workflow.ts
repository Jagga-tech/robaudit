// Workflow (/workbench/workflow[/<step>]?project=<id>): the internal pipeline as nine sub-pages, each reading live ledger rows
// for one project. Read-only. agent_event (subscribed by the shell) may be missing on older ledgers: every read of it is guarded.
import type { Page } from '../lib/app';
import { codeOf } from '../lib/ledger';
import { esc, all, byId, last, usd, pct, KIND, READER, ACCOUNT, tag, project, guardFlag, disagreement, trustedLabel, jiraEvents, jiraKey, jiraUrl, head, setHtml, live } from '../lib/ui';
import './pages.css';
import './workflow.css';

const STEPS = [
  ['intake', 'Intake', 'Summo asks four questions on the phone and writes each answer to the ledger as a source.'],
  ['sources', 'Sources & guard', 'Every document lands as a source; a deterministic guard screens it before any model reads it.'],
  ['reading', 'Reading', 'Two independent readers (Claude and Gemini) extract the facts; Summo checks whether they agree.'],
  ['reconcile', 'Reconcile', 'When a scanned sheet and the cost export disagree, a fixed rule decides which one to trust.'],
  ['ask', 'Ask', 'Ambiguous wording becomes one phone question to the deployment manager; the voice answer is kept.'],
  ['compute', 'Compute', 'Deterministic code recomputes progress and revenue; no model touches these numbers.'],
  ['review', 'Explain & review', 'Claude writes the memo from the computed figures; Gemini checks it is consistent with them.'],
  ['approve', 'Approve & post', 'Only the controller approves; the posting guard runs five checks before anything reaches the books.'],
  ['mirror', 'Mirror & audit', 'Jira is kept current, and every action stays on the append-only audit trail.'],
] as const;
type Step = (typeof STEPS)[number][0];

const QUESTION: Record<string, string> = {
  contract: 'What is this contract worth in total?', incurred: 'What have you spent so far?',
  remaining: 'What will it take to finish?', billed: 'What have you billed to date?',
};
const SEEDED = ['contract', 'cost_export', 'forecast', 'invoice'];
const CHECKS = ['role · controller', 'revision · current', 'period · open', 'balanced · debits = credits', 'duplicate · none'];
type Line = { account: string; debit: string; credit: string };
type Ts = { toDate(): Date };

const when = (t: Ts | Date) => (t instanceof Date ? t : t.toDate()).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const ms = (t: Ts) => t.toDate().getTime();
const json = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };
const big = (v: unknown) => { try { return BigInt(v as any); } catch { return 0n; } };
const parseIntake = (text: string) => { const m = /^(\w+)=(-?\d+) \| ([^:]*): ([\s\S]*)$/.exec(text); return m ? { field: m[1], cents: BigInt(m[2]), speaker: m[3], text: m[4] } : null; };
const empty = (s: string) => `<p class="empty">${esc(s)}</p>`;
const table = (headers: string[], rows: string[]) => `<div class="tbl-wrap"><table><thead><tr>${headers.map((h) => `<th${h.startsWith('#') ? ' class="num"' : ''}>${esc(h.replace(/^#/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

let pulsed = ''; // "<step>@<ms>" of the last pulse, survives remounts so a step pulses once per new event

const page: Page = {
  route: /^\/workbench\/workflow(?:\/([a-z]+))?$/,
  title: 'Workflow',
  render(root, ctx, [stepArg]) {
    const d = ctx.conn.db;
    const step: Step = (STEPS.find((s) => s[0] === stepArg)?.[0] ?? 'intake');
    const idx = STEPS.findIndex((s) => s[0] === step);
    const projects = () => all(d.project.iter()).sort(byId);
    const q = new URLSearchParams(location.search).get('project');
    // default: the project with the newest activity
    const newest = () => last(all(d.historyEvent.iter()).filter((e) => e.projectId !== 0n).sort(byId))?.projectId ?? projects()[0]?.id;
    let pid: bigint | undefined = q && /^\d+$/.test(q) ? BigInt(q) : undefined;
    const href = (s: string) => `/workbench/workflow/${s}${pid !== undefined ? `?project=${pid}` : ''}`;
    const aev = () => { try { return all(d.agentEvent.iter()).sort(byId); } catch { return []; } };

    root.innerHTML = `<div class="pg wf"><div class="wf-top" data-f="top"></div><nav class="wf-steps" data-f="steps" aria-label="Pipeline steps"></nav>
      <section class="wf-body" data-f="body"></section>
      <div class="wf-nav">${idx > 0 ? `<a class="btn" href="" data-f="prev">← ${esc(STEPS[idx - 1][1])}</a>` : '<span></span>'}${idx < 8 ? `<a class="btn" href="" data-f="next">${esc(STEPS[idx + 1][1])} →</a>` : ''}</div></div>`;
    const $ = (f: string) => root.querySelector<HTMLElement>(`[data-f=${f}]`)!;

    // ---- per-project rows ----
    function rows(id: bigint) {
      const x = project(d, id)!;
      const srcs = all(d.source.iter()).filter((s) => s.projectId === id).sort(byId);
      const sids = new Set(srcs.map((s) => s.id));
      const exs = all(d.extraction.iter()).filter((e) => sids.has(e.sourceId)).sort(byId);
      const wids = new Set(x.items.map((w) => w.id));
      const refs = all(d.clarificationRef.iter()).filter((r) => wids.has(r.workItemId)).sort(byId);
      const pids = new Set(x.proposals.map((p) => p.id));
      const approvals = all(d.approval.iter()).filter((a) => pids.has(a.proposalId)).sort(byId);
      const hist = all(d.historyEvent.iter()).filter((e) => e.projectId === id).sort(byId);
      const evs = aev().filter((e) => e.projectId === id);
      return { x, srcs, exs, refs, approvals, hist, evs };
    }
    type R = ReturnType<typeof rows>;

    /** Newest timestamp per step (0 = no data). */
    function stamps(r: R): Record<Step, number> {
      const max = (xs: number[]) => xs.reduce((a, b) => Math.max(a, b), 0);
      const ev = (f: (e: R['evs'][number]) => boolean) => r.evs.filter(f).map((e) => ms(e.at));
      const hk = (...k: string[]) => r.hist.filter((e) => k.includes(e.kind)).map((e) => ms(e.at));
      const intake = r.srcs.filter((s) => s.kind === 'intake');
      return {
        intake: max([...intake.map((s) => ms(s.createdAt)), ...(intake.length ? [] : r.srcs.filter((s) => SEEDED.includes(s.kind)).map((s) => ms(s.createdAt)))]),
        sources: max([...r.srcs.map((s) => ms(s.createdAt)), ...ev((e) => e.agent === 'guard')]),
        reading: r.exs.some((e) => e.reader === 'claude' || e.reader === 'gemini') ? max([1, ...ev((e) => e.kind === 'read' || e.kind === 'agree' || (e.kind === 'disagree' && e.agent === 'summo'))]) : 0,
        reconcile: max([...ev((e) => e.agent === 'reconciler' || e.agent === 'document-reader'), r.exs.some((e) => e.reader === 'azure-di') ? 1 : 0]),
        ask: r.refs.length ? max([1, ...hk('clarification_opened', 'clarification_confirmed'), ...ev((e) => e.agent === 'field-liaison')]) : 0,
        compute: r.x.calcs.length ? max([1, ...hk('calculation'), ...ev((e) => e.agent === 'engine')]) : 0,
        review: r.x.proposals.length ? max([1, ...hk('proposed'), ...ev((e) => e.agent === 'explainer' || e.agent === 'reviewer')]) : 0,
        approve: max([...r.approvals.map((a) => ms(a.at)), ...r.x.postings.map((p) => ms(p.postedAt)), ...hk('posted', 'rejected')]),
        mirror: max([...ev((e) => e.agent === 'jira-mirror'), ...r.hist.map((e) => ms(e.at))]),
      };
    }

    // ---- the nine sub-pages ----
    const VIEW: Record<Step, (r: R) => string> = {
      intake(r) {
        const intake = r.srcs.filter((s) => s.kind === 'intake').map((s) => ({ s, i: parseIntake(s.text) })).filter((y) => y.i);
        if (!intake.length) {
          const seeded = r.srcs.filter((s) => SEEDED.includes(s.kind));
          if (seeded.length) return `<p class="note">Seeded from six past closes. This project did not go through the phone intake.</p>` +
            table(['Source', 'Added', 'Text'], seeded.map((s) => `<tr><td>${esc(KIND[s.kind] ?? s.kind)} v${s.version}</td><td class="mono muted">${when(s.createdAt)}</td><td class="text">${esc(s.text.slice(0, 160))}</td></tr>`));
        }
        return table(['Question', 'Answer', 'Speaker', 'Time'], Object.entries(QUESTION).map(([f, q]) => {
          const y = intake.filter((z) => z.i!.field === f).pop();
          return y ? `<tr><td>${esc(q)}</td><td><b class="mono">${usd(y.i!.cents)}</b><div class="muted">“${esc(y.i!.text)}”</div></td><td>${esc(y.i!.speaker)}</td><td class="mono muted">${when(y.s.createdAt)}</td></tr>`
            : `<tr class="wait"><td>${esc(q)}</td><td>waiting</td><td></td><td></td></tr>`;
        }));
      },
      sources(r) {
        if (!r.srcs.length) return empty('No sources yet.');
        return table(['Source', 'Kind', 'Time', 'Guard'], [...r.srcs].reverse().map((s) => {
          const g = guardFlag(d, s.id), screened = r.exs.some((e) => e.sourceId === s.id && e.reader === 'guard');
          return `<tr class="${g ? 'flag' : ''}"><td class="mono">#${s.id}</td><td>${esc(KIND[s.kind] ?? s.kind)} v${s.version}</td><td class="mono muted">${when(s.createdAt)}</td>` +
            `<td>${g ? `${tag('flagged', 'amber')}<div class="small amb">${esc(g.reasons.join('; ') || 'no reason given')}</div>` : screened ? '<span class="ok">passed</span>' : '<span class="muted">passed · not screened</span>'}</td></tr>`;
        }));
      },
      reading(r) {
        const read = r.srcs.filter((s) => r.exs.some((e) => e.sourceId === s.id && (e.reader === 'claude' || e.reader === 'gemini')));
        if (!read.length) return empty('No source has been read by the two readers yet.');
        const col = (s: bigint, reader: string) => {
          const e = r.exs.filter((x) => x.sourceId === s && x.reader === reader).pop();
          if (!e) return `<div class="wf-rd"><h4>${READER[reader]}</h4><p class="muted">Did not read this source.</p></div>`;
          const facts = json<{ quote?: string; amountText?: string; kind?: string }[]>(e.factsJson, []);
          const list = Array.isArray(facts) ? facts : [];
          return `<div class="wf-rd"><h4>${READER[reader]}</h4>${list.length ? `<ul>${list.map((f) => `<li><b class="mono">${esc(String(f.amountText ?? '—'))}</b> <span class="muted">“${esc(String(f.quote ?? ''))}”</span></li>`).join('')}</ul>` : '<p class="muted">No facts extracted.</p>'}` +
            `<p class="small">${e.ambiguityFlag ? `<span class="amb">ambiguous · ${esc(e.ambiguityText || 'wording unclear')}</span>` : '<span class="muted">not ambiguous</span>'}</p></div>`;
        };
        return [...read].reverse().map((s) => {
          const v = r.evs.filter((e) => e.agent === 'summo' && (e.kind === 'agree' || e.kind === 'disagree') && e.refTable === 'source' && e.refId === s.id).pop();
          return `<article class="wf-card"><h3>${esc(KIND[s.kind] ?? s.kind)} v${s.version} <span class="mono muted">#${s.id}</span></h3>` +
            `<div class="wf-pair">${col(s.id, 'claude')}${col(s.id, 'gemini')}</div>` +
            (v ? `<p class="verdict ${v.kind === 'agree' ? 'ok' : 'amb'}">${v.kind === 'agree' ? 'Agree' : 'Disagree'} · ${esc(v.summary)}</p>` : '<p class="verdict muted">No agreement check logged.</p>') + '</article>';
        }).join('');
      },
      reconcile(r) {
        const gs = r.srcs.map((s) => ({ s, g: disagreement(d, s.id) })).filter((y) => y.g);
        if (!gs.length) return empty('No conflicting sources.');
        return table(['Source', '#Document', '#Ledger', 'Trusted', 'Reason'], gs.map(({ s, g }) =>
          `<tr><td>${esc(KIND[s.kind] ?? s.kind)} <span class="mono muted">#${s.id}</span></td><td class="num">${usd(g!.document)}</td><td class="num">${usd(g!.ledger)}</td><td>${tag(trustedLabel(g!), 'ok')}</td><td>${esc(g!.reason || '—')}</td></tr>`));
      },
      ask(r) {
        const note = `<p class="note">Questions ring the deployment manager's phone. To take the call, scan the QR code on the <a href="/workbench/projects/${r.x.proj.id}">project page</a> (it opens <code>/phone</code>).</p>`;
        if (!r.refs.length) return note + empty('No questions asked for this project.');
        return note + table(['Question', 'Status', 'Answer', 'Speaker', 'Time'], [...r.refs].reverse().map((c) =>
          `<tr><td>${esc(c.question)}</td><td>${tag(c.status, c.status === 'confirmed' ? 'ok' : 'amber')}</td>` +
          `<td>${esc(c.answer || '—')}${c.audioStorageId ? ` <button class="chip" type="button" data-play="${esc(c.audioStorageId)}">▶ voice</button>` : ''}</td>` +
          `<td>${esc(c.speaker || '—')}</td><td class="mono muted">${c.status === 'confirmed' ? when(c.confirmedAt) : ''}</td></tr>`));
      },
      compute(r) {
        const calcs = r.x.main ? r.x.calcs.filter((c) => c.workItemId === r.x.main!.id) : r.x.calcs;
        const cur = last(calcs);
        if (!cur) return empty('No calculation yet.');
        const fig = (c: typeof cur) => {
          const j = json<Record<string, unknown>>(c.inputsJson, {}), inc = big(j.incurredCents), rem = big(j.remainingCents);
          return [['Incurred', usd(inc)], ['Remaining', usd(rem)], ['Estimated total cost', usd(inc + rem)], ['Progress', pct(c.progressBp)],
            ['Cumulative revenue', usd(c.cumRevenueCents)], ['Contract asset', usd(c.contractAssetCents)], ['Expected margin', usd(c.marginCents)]];
        };
        const now = fig(cur), prev = calcs.length >= 2 ? fig(calcs[calcs.length - 2]) : null;
        return `<p class="small muted">Calculation #${cur.id}${prev ? ` · before = #${calcs[calcs.length - 2].id}` : ''}</p>` +
          table(prev ? ['Figure', '#Before', '#After'] : ['Figure', '#Value'], now.map(([k, v], i) =>
            `<tr><td>${k}</td>${prev ? `<td class="num muted">${prev[i][1]}</td>` : ''}<td class="num"><b class="${k === 'Expected margin' && cur.lossWarning ? 'err' : ''}">${v}</b></td></tr>`)) +
          (cur.lossWarning ? `<p class="warnline">Loss warning · the estimate exceeds the contract; escalated to Dana.</p>` : '<p class="ok small">No loss warning.</p>');
      },
      review(r) {
        const p = r.x.main ? r.x.latestOf(r.x.main.id) : last(r.x.proposals);
        if (!p) return empty('No proposal yet.');
        const rv = r.evs.filter((e) => e.kind === 'review' && ((e.refTable === 'proposal' && e.refId === p.id) || (e.refTable === 'calculation' && e.refId === p.calculationId))).pop()
          ?? r.evs.filter((e) => e.agent === 'reviewer').pop();
        const m = rv && /^(consistent|flag):\s*/.exec(rv.summary);
        const ex = r.evs.filter((e) => e.agent === 'explainer').pop();
        return `<article class="wf-card"><h3>Proposal rev ${p.revision} <span class="mono muted">#${p.id}</span></h3>` +
          `<div class="expl">${p.explanation.split('\n').filter(Boolean).map((y) => `<p class="${y.startsWith('ESCALATION:') ? 'amb' : ''}">${esc(y)}</p>`).join('') || '<p class="muted">No explanation text.</p>'}</div></article>` +
          `<h2>Reviewer</h2>${rv ? `<p class="${m?.[1] === 'flag' ? 'amb' : 'ok'}"><b>${m ? m[1] : rv.kind}</b> · ${esc(m ? rv.summary.slice(m[0].length) : rv.summary)} <span class="muted">· ${when(rv.at)}</span></p>` : '<p class="muted">Not reviewed.</p>'}` +
          `<h2>Explainer</h2>${ex ? `<p>${esc(ex.summary)} <span class="muted">· ${when(ex.at)}</span></p>` : '<p class="muted">No explainer event logged.</p>'}`;
      },
      approve(r) {
        const p = r.x.main ? r.x.latestOf(r.x.main.id) : last(r.x.proposals);
        const refusals = r.hist.filter((e) => e.kind === 'rejected' || /rejected/i.test(e.summary) || codeOf(e.summary) !== 'unknown');
        const refusalHtml = refusals.length ? `<h2>Refusals</h2><ul class="refusals">${[...refusals].reverse().map((e) => `<li><span class="mono muted">${when(e.at)}</span> ${esc(e.summary)}</li>`).join('')}</ul>` : '';
        if (!p) return empty('No proposal yet.') + refusalHtml;
        const lines = json<Line[]>(p.entryJson, []);
        const side = (dr: boolean) => (Array.isArray(lines) ? lines : []).filter((l) => (big(l.debit) > 0n) === dr).map((l) => `<div><span>${esc(ACCOUNT[l.account] ?? l.account)}</span><b class="mono">${usd(dr ? big(l.debit) : big(l.credit))}</b></div>`).join('');
        const pg = r.x.postingOf(p.id);
        const aps = r.approvals.filter((a) => a.proposalId === p.id);
        return `<h3>Proposal rev ${p.revision} <span class="mono muted">#${p.id}</span> ${tag(pg ? 'posted' : p.status, pg ? 'ok' : p.status === 'open' ? 'amber' : '')}</h3>` +
          `<div class="taccount"><div><h4>Debit</h4>${side(true) || '<p class="muted">—</p>'}</div><div><h4>Credit</h4>${side(false) || '<p class="muted">—</p>'}</div></div>` +
          `<h2>Approvals</h2>${aps.length ? table(['Decision', 'By', 'Reason', 'Time'], aps.map((a) => `<tr><td>${tag(a.decision, a.decision === 'approve' ? 'ok' : 'amber')}</td><td>${esc(a.by)}</td><td>${esc(a.reason || '—')}</td><td class="mono muted">${when(a.at)}</td></tr>`)) : '<p class="muted">Waiting for the controller.</p>'}` +
          `<h2>Posting</h2>${pg ? `<p><b class="mono">${esc(pg.postingRef)}</b> · ${esc(pg.postedBy)} · <span class="mono muted">${when(pg.postedAt)}</span></p>` : '<p class="muted">Not posted.</p>'}` +
          `<ul class="wf-checks">${CHECKS.map((c) => `<li class="${pg ? 'ok' : 'muted'}">${pg ? '✓' : '·'} ${esc(c)}</li>`).join('')}</ul>` + refusalHtml;
      },
      mirror(r) {
        const jira = jiraEvents(d).filter((e) => e.projectId === r.x.proj.id).reverse();
        const counts = new Map<string, number>();
        for (const e of r.evs) counts.set(e.agent, (counts.get(e.agent) ?? 0) + 1);
        return `<h2>Jira</h2>${jira.length ? `<ul class="refusals">${jira.slice(0, 10).map((e) => { const k = jiraKey(e.summary); return `<li><span class="mono muted">${when(e.at)}</span> ${k ? `<a class="jira" href="${esc(jiraUrl(k))}" target="_blank" rel="noopener">${esc(k)} ↗</a>` : ''} ${esc(e.summary.slice(k.length).replace(/^ · /, ''))}</li>`; }).join('')}</ul>` : '<p class="muted">Not mirrored to Jira yet.</p>'}` +
          `<h2>Audit trail <span class="muted small">newest 15</span></h2>${r.hist.length ? table(['Time', 'Actor', 'Kind', 'Summary'], [...r.hist].reverse().slice(0, 15).map((e) => `<tr><td class="mono muted">${when(e.at)}</td><td>${esc(e.actor)}</td><td class="mono">${esc(e.kind)}</td><td>${esc(e.summary)}</td></tr>`)) : '<p class="muted">No events.</p>'}` +
          `<h2>Agent events by agent</h2>${counts.size ? `<div class="strip">${[...counts].sort((a, b) => b[1] - a[1]).map(([a, n]) => `<div><b>${n}</b><span>${esc(a)}</span></div>`).join('')}</div>` : '<p class="muted">No agent events for this project.</p>'}`;
      },
    };

    function draw() {
      const list = projects();
      if (pid === undefined || !d.project.id.find(pid)) pid = newest();
      if (pid === undefined || !d.project.id.find(pid)) { setHtml($('body'), empty('No projects in the ledger yet.')); return; }
      const r = rows(pid);
      head({ title: 'Workflow', sub: `${r.x.proj.name} · step ${idx + 1} of 9 · ${STEPS[idx][1]}` });
      setHtml($('top'), `<label>Project <select data-f="proj" aria-label="Project">${list.map((p) => `<option value="${p.id}"${p.id === pid ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`);
      const st = stamps(r);
      const top = STEPS.reduce<[Step | '', number]>((a, s) => (st[s[0]] > a[1] ? [s[0], st[s[0]]] : a), ['', 0]);
      const key = `${pid}:${top[0]}@${top[1]}`, pulse = top[1] > 1 && key !== pulsed ? top[0] : '';
      if (pulse) pulsed = key;
      const stepsHtml = STEPS.map(([k, label], i) => `<a href="${href(k)}" class="${k === step ? 'on' : ''}${pulse === k ? ' pulse' : ''}"${k === step ? ' aria-current="step"' : ''}><small>${i + 1}</small>${esc(label)}${st[k] ? '<i class="dot" title="has data"></i>' : ''}</a>`).join('');
      if (pulse) ($('steps') as any)._html = ''; // force a re-render so the animation replays
      setHtml($('steps'), stepsHtml);
      setHtml($('body'), `<p class="lede">${esc(STEPS[idx][2])}</p>${VIEW[step](r)}`);
      const prev = root.querySelector<HTMLAnchorElement>('[data-f=prev]'), next = root.querySelector<HTMLAnchorElement>('[data-f=next]');
      if (prev) prev.href = href(STEPS[idx - 1][0]);
      if (next) next.href = href(STEPS[idx + 1][0]);
    }

    let audio: HTMLAudioElement | null = null;
    root.onchange = (e) => { const s = e.target as HTMLSelectElement; if (s.dataset.f === 'proj') ctx.navigate(`/workbench/workflow/${step}?project=${s.value}`); };
    root.onclick = async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-play]');
      if (!b) return;
      const url = await ctx.convex.query(ctx.api.clarifications.audioUrl, { storageId: b.dataset.play as any }).catch(() => null);
      if (!url) return ctx.toast('Recording unavailable', 'warn');
      audio?.pause(); audio = new Audio(url); audio.play().catch(() => ctx.toast('Could not play the recording', 'error'));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest?.('input,select,textarea,[contenteditable]')) return;
      const j = e.key === 'ArrowLeft' ? idx - 1 : e.key === 'ArrowRight' ? idx + 1 : -1;
      if (j >= 0 && j < 9) { e.preventDefault(); ctx.navigate(href(STEPS[j][0])); }
    };
    document.addEventListener('keydown', onKey);
    const off = live(ctx, draw);
    return () => { off(); document.removeEventListener('keydown', onKey); root.onchange = null; root.onclick = null; audio?.pause(); };
  },
};
export default page;
