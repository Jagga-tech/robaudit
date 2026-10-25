import { motion } from 'motion/react';
import { ArrowRight, Check, Eye, FileText, MessageSquare, Pause, Send, ShieldCheck, Smartphone, Wrench, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sidebar, TopBar } from '../components/Shell';
import { Actor, errorCopy, useToast, useUi } from '../components/ui';
import { useKeel } from '../data/KeelProvider';
import { ROLE_NAMES, type HistoryEvent, type Snapshot } from '../data/model';
import { oakland, type CaseView } from '../data/select';
import { pct, time, usd } from '../lib/format';

export const SAMPLE_UPDATES = [
  { label: 'Ambiguous forecast', kind: 'note' as const, text: 'we need another $200,000 to finish' },
  { label: 'Milestone evidence', kind: 'commissioning_log' as const, text: 'Commissioning complete: 48 of 48 units commissioned, throughput test passed 1,200 totes/hr, acceptance criteria met.' },
  { label: 'Month 3 (learned)', kind: 'note' as const, text: 'another $50,000 for conveyor rework' },
];

export function CommandCenter() {
  const { snapshot, view, role } = useKeel();
  const [inbox, setInbox] = useState(false);
  const project = oakland(snapshot);
  const active = ['reading', 'awaiting_clarification', 'unconfirmed', 'calculating', 'proposed', 'approved', 'returned', 'held', 'stale'].includes(view.stage);
  const agentActions = snapshot.history.filter((h) => h.actor === 'Keel Agent').length;
  const openProps = snapshot.proposals.filter((p) => p.status === 'open').length;
  const unapprovedPostings = snapshot.postings.filter((pg) => !snapshot.approvals.some((a) => a.proposalId === pg.proposalId && a.decision === 'approve')).length;

  return (
    <div className="app"><div className="ambient" />
      <Sidebar />
      <main className="main">
        <TopBar crumbs={['Close', 'Command center']} />
        <div className="content">
          <div className="row" style={{ alignItems: 'flex-end', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
            <div>
              <div className="over">Current period · Revenue close</div>
              <h1 className="h1" style={{ marginTop: 6 }}>Good morning, {ROLE_NAMES[role]}</h1>
              <div className="sec" style={{ marginTop: 2 }}>{headline(view)}</div>
            </div>
            <div style={{ flex: 1 }} />
            <CloseStatus view={view} />
          </div>

          {active ? <CaseHero /> : view.stage === 'posted' && !inbox ? <PostedHero onNew={() => setInbox(true)} /> : <Inbox />}

          <div className="kpis">
            <Kpi label="Contract value on ledger" value={project ? usd(project.contractValueCents, { cents: false }) : '—'} sub={`${project?.name ?? '—'} · fixed price`} />
            <Kpi label="Needs your judgment" value={String(['awaiting_clarification', 'unconfirmed', 'proposed', 'returned', 'held'].includes(view.stage) ? 1 : 0)} sub={view.stage === 'awaiting_clarification' ? 'Waiting on Matt’s answer' : view.stage === 'proposed' ? 'Entry awaiting controller' : 'Nothing waiting'} tone={view.stage === 'proposed' || view.stage === 'awaiting_clarification' ? 'amber' : undefined} />
            <Kpi label="Ready for approval" value={String(openProps)} sub="Open proposals on the ledger" />
            <Kpi label="Agent actions" value={String(agentActions)} sub={`${unapprovedPostings} entries posted without approval`} tone="teal-sub" />
          </div>

          <div className="cc-grid">
            <Queue />
            <Activity events={snapshot.history} />
          </div>
        </div>
      </main>
    </div>
  );
}

function headline(v: CaseView) {
  switch (v.stage) {
    case 'idle': return 'The September close is posted. One field update is waiting in the inbox.';
    case 'reading': return 'Keel is reading a new field update from the Oakland deployment.';
    case 'awaiting_clarification': return 'One estimate change needs a human answer before revenue can close.';
    case 'unconfirmed': return 'The manager could not confirm the estimate. Revenue stays on hold.';
    case 'calculating': return 'Clarification received. The accounting engine is recalculating.';
    case 'proposed': return 'A revised revenue entry is ready for controller review.';
    case 'posted': return 'All entries are approved and posted. The close is on track.';
    default: return 'One revenue proposal needs attention.';
  }
}

function CloseStatus({ view }: { view: CaseView }) {
  if (view.stage === 'posted' || view.stage === 'idle') return <span className="pill teal" style={{ height: 28, padding: '0 12px' }}><span className="dot" />Close on track</span>;
  if (view.stage === 'proposed' || view.stage === 'approved') return <span className="pill cobalt" style={{ height: 28, padding: '0 12px' }}><span className="dot" />Awaiting approval</span>;
  return <span className="pill amber" style={{ height: 28, padding: '0 12px' }}><span className="dot" />Close at risk · 1 blocker</span>;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'amber' | 'teal-sub' }) {
  return (
    <div className="card kpi">
      <div className="over">{label}</div>
      <div className="v" style={tone === 'amber' ? { color: 'var(--amber-600)' } : undefined}>{value}</div>
      <div className="small" style={{ color: tone === 'teal-sub' ? 'var(--teal-600)' : 'var(--ink-500)' }}>{sub}</div>
    </div>
  );
}

function Inbox() {
  const { backend } = useKeel();
  const toast = useToast();
  const nav = useNavigate();
  const [sample, setSample] = useState(0);
  const [text, setText] = useState(SAMPLE_UPDATES[0].text);
  const [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    const r = await backend.addSource(SAMPLE_UPDATES[sample].kind, text.trim());
    setSending(false);
    if (r.ok) { toast({ tone: 'ok', title: 'Sent to Keel', body: 'Added to the ledger as a versioned source. The agent is reading it.' }); nav('/exceptions/oakland-forecast'); }
    else toast({ tone: 'err', title: 'Could not add source', body: errorCopy(r) });
  };
  return (
    <motion.section className="glass hero" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="bar" style={{ background: 'linear-gradient(180deg,#6079FF,#3F5EFB)' }} />
      <div className="l">
        <div className="row"><span className="actor human"><i>H</i>Field update</span><span className="small faint">From {ROLE_NAMES.deployment_manager} · Oakland deployment · via SMS</span></div>
        <h2 className="h2" style={{ fontSize: 18, lineHeight: '26px', marginTop: 12 }}>Inbox: send the latest update to Keel</h2>
        <p className="sec" style={{ marginTop: 4, maxWidth: 520 }}>Adding an update writes it to the ledger as evidence. Keel reads it, checks it against approved conventions, and asks the right person if the wording is ambiguous.</p>
        <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }} role="group" aria-label="Sample updates">
          {SAMPLE_UPDATES.map((s, i) => (
            <button key={s.label} className={`pill ${i === sample ? 'cobalt' : 'outline'}`} onClick={() => { setSample(i); setText(s.text); }} aria-pressed={i === sample}>{s.kind === 'note' ? <MessageSquare size={12} /> : <Wrench size={12} />}{s.label}</button>
          ))}
        </div>
        <div className="composer" style={{ marginTop: 10 }}>
          <textarea aria-label="Field update text" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn primary" style={{ height: 'auto' }} disabled={!text.trim() || sending} onClick={send}><Send size={14} />Send to Keel</button>
        </div>
      </div>
      <ProjectStats />
    </motion.section>
  );
}

function ProjectStats({ extra }: { extra?: ReactNode }) {
  const { view } = useKeel();
  const calc = view.after ?? view.before;
  const inputs = view.afterInputs ?? view.beforeInputs;
  if (!calc || !inputs) return null;
  return (
    <div className="stats">
      <div className="stat"><div className="over">Contract value</div><div className="v">{usd(inputs.contractValue, { cents: false })}</div><div className="s">Fixed price · 1 obligation</div></div>
      <div className="stat"><div className="over">Recognized</div><div className="v">{usd(calc.cumRevenueCents, { cents: false })}</div><div className="s">{view.after && view.posting ? 'Revised · posted' : 'Last approved close'}</div></div>
      <div className="stat"><div className="over">Progress</div><div className="v">{pct(calc.progressBp)}</div><div className="prog"><motion.i style={{ background: 'var(--ink-800)' }} initial={{ width: 0 }} animate={{ width: `${calc.progressBp / 100}%` }} transition={{ duration: 0.8 }} /></div><div className="s">{usd(inputs.incurred, { cents: false })} of {usd(inputs.incurred + inputs.remaining, { cents: false })}</div></div>
      {extra ?? <div className="stat"><div className="over">Contract asset</div><div className="v">{usd(calc.contractAssetCents, { cents: false })}</div><div className="s">Unbilled revenue</div></div>}
    </div>
  );
}

function CaseHero() {
  const { view } = useKeel();
  const { setPhoneOpen } = useUi();
  const r = view.readings;
  const tone = view.stage === 'proposed' || view.stage === 'approved' ? 'cobalt' : 'amber';
  const label = ({ reading: 'Keel is reading', awaiting_clarification: 'Awaiting field clarification', unconfirmed: 'On hold · not confirmed', calculating: 'Recalculating', proposed: 'Entry ready for controller', approved: 'Approved · posting', returned: 'Returned', held: 'On hold', stale: 'Superseded by new evidence' } as Record<string, string>)[view.stage];
  return (
    <motion.section className="glass hero" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="bar" style={{ background: tone === 'amber' ? 'linear-gradient(180deg,#E08A25,#B86A12)' : 'linear-gradient(180deg,#6079FF,#3F5EFB)' }} />
      <div className="l">
        <div className="row" style={{ flexWrap: 'wrap' }}><Actor kind="agent">Keel agent</Actor><span className={`pill ${tone}`}><span className="dot" />{label}</span>{view.note && <span className="faint small">Update received {time(view.note.createdAt)}</span>}</div>
        <h2 className="h2" style={{ fontSize: 18, lineHeight: '26px', marginTop: 12 }}>Oakland deployment <span className="code" style={{ verticalAlign: 2 }}>Aster Robotics</span></h2>
        <p className="sec" style={{ marginTop: 4, maxWidth: 460 }}>
          {view.stage === 'proposed' || view.stage === 'approved'
            ? <>Matt confirmed the update. The engine revised revenue by <b className={view.adjustmentCents && view.adjustmentCents < 0n ? 'neg' : 'pos'} style={{ fontWeight: 600 }}>{usd(view.adjustmentCents ?? 0n, { cents: false, sign: true })}</b>, and the entry is waiting for the controller.</>
            : <>The deployment manager wrote <b style={{ fontWeight: 600 }}>“{view.note?.text}”</b>. {view.stage === 'reading' ? 'Keel is reading it against the contract, ledger and conventions.' : 'Keel found two valid readings with different revenue outcomes and paused recognition until Matt confirms.'}</>}
        </p>
        <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
          <Link className="btn primary" to="/exceptions/oakland-forecast">Open investigation <ArrowRight size={14} /></Link>
          {view.stage === 'awaiting_clarification' && <button className="btn ghost" onClick={() => setPhoneOpen(true)}><Smartphone size={14} />View request sent to Matt</button>}
        </div>
      </div>
      <ProjectStats extra={r && (view.stage === 'awaiting_clarification' || view.stage === 'unconfirmed') ? (
        <div className="stat"><div className="over">Possible adjustment</div><div className="v" style={{ fontSize: 15, lineHeight: '22px', marginTop: 9 }}><span className={r.additional.adjustment < 0n ? 'neg' : 'pos'}>{usd(r.additional.adjustment, { cents: false, sign: true })}</span><br /><span className={r.new_total.adjustment < 0n ? 'neg' : 'pos'}>{usd(r.new_total.adjustment, { cents: false, sign: true })}</span></div><div className="s">Depends on answer</div></div>
      ) : undefined} />
    </motion.section>
  );
}

function PostedHero({ onNew }: { onNew: () => void }) {
  const { view } = useKeel();
  return (
    <motion.section className="glass hero" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="bar" style={{ background: 'linear-gradient(180deg,#22B8A0,#0E9C86)' }} />
      <div className="l">
        <div className="row"><Actor kind="ledger">Ledger</Actor><span className="pill teal"><span className="dot" />Posted {view.posting?.postingRef}</span></div>
        <h2 className="h2" style={{ fontSize: 18, lineHeight: '26px', marginTop: 12 }}>Oakland deployment is closed for the period</h2>
        <p className="sec" style={{ marginTop: 4, maxWidth: 460 }}>Revenue adjusted {usd(view.adjustmentCents ?? 0n, { cents: false, sign: true })} after Matt’s confirmation, approved by {view.approval?.by}. Every figure traces to its source.</p>
        <div className="row" style={{ marginTop: 16 }}><Link className="btn primary" to="/audit"><ShieldCheck size={14} />Open evidence trail</Link><Link className="btn ghost" to="/exceptions/oakland-forecast">View investigation</Link><button className="btn ghost" onClick={onNew}><MessageSquare size={14} />New field update</button></div>
      </div>
      <ProjectStats />
    </motion.section>
  );
}

function Queue() {
  const { snapshot, view } = useKeel();
  const nav = useNavigate();
  const items = [...snapshot.workItems].sort((a, b) => Number(b.id - a.id));
  const stageBars = (status: string) => {
    const map: Record<string, string[]> = {
      posted: ['t', 't', 't', 't', 't', 't'], awaiting_clarification: ['d', 'd', 'a', '', '', ''], open: ['d', 'd', 'd', '', '', ''],
      proposed: ['d', 'd', 'd', 'd', 'b', ''], approved: ['d', 'd', 'd', 'd', 'd', 'b'], returned: ['d', 'd', 'd', 'd', 'a', ''], held: ['d', 'd', 'd', 'd', 'a', ''], stale: ['d', 'd', 'd', 'a', '', ''],
    };
    return map[status] ?? ['', '', '', '', '', ''];
  };
  return (
    <section className="card" style={{ overflow: 'hidden' }} aria-labelledby="q-h">
      <div className="cardhd"><h2 className="h2" id="q-h">Exception queue</h2><div className="sp" /><span className="small muted">{items.length} work items on the ledger</span></div>
      <table className="tbl">
        <thead><tr><th>Work item</th><th>Signal</th><th style={{ textAlign: 'right' }}>Impact</th><th>Owner</th><th>Stage</th></tr></thead>
        <tbody>
          {items.map((w) => {
            const isCase = w.id === view.workItemId;
            const hot = isCase && !['posted', 'idle'].includes(view.stage);
            const prop = snapshot.proposals.filter((p) => p.workItemId === w.id).sort((a, b) => b.revision - a.revision)[0];
            const impact = isCase && view.adjustmentCents != null ? usd(view.adjustmentCents, { cents: false, sign: true }) : isCase && view.readings && view.stage !== 'posted' ? `${usd(view.readings.additional.adjustment, { cents: false, sign: true })} / ${usd(view.readings.new_total.adjustment, { cents: false, sign: true })}` : prop ? `rev ${prop.revision}` : '—';
            const go = () => nav(isCase ? '/exceptions/oakland-forecast' : '/approvals');
            return (
              <tr key={String(w.id)} className={`click${hot ? ' hot' : w.status === 'posted' ? ' dim' : ''}`} onClick={go} onKeyDown={(e) => e.key === 'Enter' && go()} tabIndex={0}>
                <td><div style={{ fontWeight: 500, color: 'var(--ink-900)' }}>{w.title}</div><span className="code">WI-{String(w.id)}</span></td>
                <td>{statusSignal(w.status)}</td>
                <td style={{ textAlign: 'right' }} className="amt small">{impact}</td>
                <td>{w.status === 'awaiting_clarification' ? <Actor kind="human">Matt</Actor> : ['proposed', 'approved'].includes(w.status) ? <Actor kind="ctrl">Dana</Actor> : <Actor kind="agent">Keel</Actor>}</td>
                <td><div className="stages">{stageBars(w.status).map((c, i) => <span key={i} className={c} />)}</div><div className="small" style={{ marginTop: 4, color: w.status === 'posted' ? 'var(--teal-600)' : w.status === 'awaiting_clarification' ? 'var(--amber-600)' : 'var(--cobalt-600)' }}>{w.status.replace('_', ' ')}</div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="fixture">Work items and figures come from the {useKeel().backend.mode === 'live' ? 'SpacetimeDB ledger' : 'offline demo ledger (seeded from demo/seed.json)'}.</div>
    </section>
  );
}

const statusSignal = (s: string) => ({ posted: 'Posted · reconciled', awaiting_clarification: 'Estimate change · ambiguous', open: 'Recalculating', proposed: 'Entry proposed', approved: 'Approved, posting', returned: 'Returned to preparer', held: 'On hold', stale: 'Superseded' } as Record<string, string>)[s] ?? s;

function evIcon(h: HistoryEvent): { icon: ReactNode; bg: string; fg: string } {
  const k = h.kind;
  if (k === 'clarification_opened') return { icon: <Send />, bg: 'var(--amber-100)', fg: 'var(--amber-600)' };
  if (k === 'clarification_unconfirmed' || k.startsWith('decision_hold') || k === 'decision_return') return { icon: <Pause />, bg: 'var(--coral-100)', fg: 'var(--coral-600)' };
  if (k === 'extraction' || k === 'convention_applied') return { icon: <Eye />, bg: 'var(--cobalt-100)', fg: 'var(--cobalt-600)' };
  if (k === 'posted' || k === 'decision_approve' || k === 'clarification_confirmed' || k === 'convention_saved') return { icon: <Check />, bg: 'var(--teal-100)', fg: 'var(--teal-600)' };
  if (k === 'proposal_stale') return { icon: <X />, bg: 'var(--coral-100)', fg: 'var(--coral-600)' };
  return { icon: <FileText />, bg: 'var(--sand-100)', fg: 'var(--ink-700)' };
}

function Activity({ events }: { events: Snapshot['history'] }) {
  const list = [...events].sort((a, b) => Number(b.id - a.id)).slice(0, 7);
  return (
    <section className="card" aria-labelledby="a-h">
      <div className="cardhd"><h2 className="h2" id="a-h">Activity</h2><div className="sp" /><span className="small muted">Append-only history</span></div>
      <ol className="feed" style={{ listStyle: 'none' }}>
        {list.map((h, i) => {
          const ic = evIcon(h);
          return (
            <motion.li key={String(h.id)} className="ev" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
              {i < list.length - 1 && <div className="ln" />}
              <div className="ic" style={{ background: ic.bg, color: ic.fg }}>{ic.icon}</div>
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 500 }}>{h.summary}</div><div className="small muted">{h.actor} · {h.kind.replace(/_/g, ' ')}</div></div>
              <span className="tm">{time(h.at)}</span>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}
