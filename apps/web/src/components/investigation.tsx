import { AnimatePresence, motion } from 'motion/react';
import {
  Check, CheckCircle2, ChevronDown, Database, FileSignature, FileSpreadsheet, Lock, MessageSquare, Pause, Receipt, Send, ShieldCheck, Smartphone, Undo2, Wrench,
} from 'lucide-react';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useKeel } from '../data/KeelProvider';
import { ROLE_NAMES, type Source } from '../data/model';
import { postingRef, priorCloseNotes, type Step } from '../data/select';
import { ACCOUNT_LABEL, amount, pct, time, usd } from '../lib/format';
import { Actor, Chk, Logo, Wait, errorCopy, useToast, useUi } from './ui';

// ---------------- stepper ----------------
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="steps" aria-label="Workflow progress">
      {steps.map((s, i) => (
        <Fragment key={s.key}>
          {i > 0 && <li aria-hidden className={`sline${steps[i - 1].state === 'done' && s.state !== 'todo' ? ' done' : ''}`} />}
          <li className={`step ${s.state === 'done' ? 'done' : s.state === 'now' ? (s.actor === 'Manager' ? 'now' : 'nowb') : s.state === 'blocked' ? 'now' : ''}`} aria-current={s.state === 'now' ? 'step' : undefined}>
            <span className="n">{s.state === 'done' ? <Check strokeWidth={3} /> : s.state === 'blocked' ? <Pause size={10} /> : i + 1}</span>
            {s.label}<span className="who">{s.actor}</span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

// ---------------- sources ----------------
const META: Record<string, { icon: ReactNode; name: string }> = {
  contract: { icon: <FileSignature />, name: 'Contract' },
  cost_export: { icon: <Database />, name: 'Job cost export' },
  forecast: { icon: <FileSpreadsheet />, name: 'Forecast' },
  invoice: { icon: <Receipt />, name: 'Billings to date' },
  note: { icon: <MessageSquare />, name: 'Field update' },
  clarification: { icon: <CheckCircle2 />, name: 'Manager clarification' },
  commissioning_log: { icon: <Wrench />, name: 'Commissioning log' },
};

/** Highlights the dollar phrase the agent found ambiguous ("another $200,000"). */
export function Quote({ text, tone }: { text: string; tone: 'amber' | 'teal' | 'none' }) {
  const m = text.match(/((?:another|more|extra|additional)\s+)?\$\s?[\d,]+(?:\.\d+)?\s*[km]?/i);
  if (!m || tone === 'none') return <>“{text}”</>;
  const i = m.index ?? 0;
  return <>“{text.slice(0, i)}<span className={tone === 'amber' ? 'hl' : 'hlt'}>{m[0]}</span>{text.slice(i + m[0].length)}”</>;
}

export function SourcesPane() {
  const { snapshot, view } = useKeel();
  const { focusSource } = useUi();
  const [showPrior, setShowPrior] = useState(false);
  const prior = new Set(priorCloseNotes(snapshot).map((s) => String(s.id)));
  const core = ['note', 'clarification', 'commissioning_log', 'contract', 'cost_export', 'forecast', 'invoice'];
  const visible = snapshot.sources
    .filter((s) => !prior.has(String(s.id)))
    .sort((a, b) => core.indexOf(a.kind) - core.indexOf(b.kind) || Number(b.id - a.id));
  const priorNotes = snapshot.sources.filter((s) => prior.has(String(s.id)));

  return (
    <div className="pane sources" aria-label="Sources">
      <div className="panehd"><span className="over">Sources · {visible.length}</span><div style={{ flex: 1 }} /><span className="small faint">versioned · hashed</span></div>
      <AnimatePresence initial={false}>
        {visible.map((s) => (
          <motion.div key={String(s.id)} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <SourceCard s={s} focused={focusSource === s.id} selected={view.note?.id === s.id} />
          </motion.div>
        ))}
      </AnimatePresence>
      <button className="src" onClick={() => setShowPrior((v) => !v)} aria-expanded={showPrior}>
        <div className="row"><div className="ty"><FileSpreadsheet /></div><div style={{ flex: 1 }}><div className="nm">Prior close notes · {priorNotes.length}</div><div className="meta">Taught: “Remaining Estimate” = future costs only</div></div><ChevronDown size={14} style={{ transform: showPrior ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} /></div>
        {showPrior && <div className="col" style={{ gap: 6, marginTop: 10 }}>{priorNotes.map((n) => <div key={String(n.id)} className="small muted" style={{ lineHeight: '16px' }}>{n.text}</div>)}</div>}
      </button>
    </div>
  );
}

function SourceCard({ s, focused, selected }: { s: Source; focused: boolean; selected: boolean }) {
  const { view } = useKeel();
  const meta = META[s.kind] ?? { icon: <FileSpreadsheet />, name: s.kind };
  const isNote = s.kind === 'note';
  const isOpen = isNote && selected && (view.stage === 'awaiting_clarification' || view.stage === 'unconfirmed' || view.stage === 'reading');
  const clarified = isNote && selected && !!view.clarificationSource;
  const tone = isOpen ? 'amber' : clarified ? 'teal' : 'none';
  const style = isOpen ? { borderColor: 'rgba(224,138,37,.55)', boxShadow: '0 0 0 3px rgba(224,138,37,.12)' } : undefined;
  const tyStyle = isNote ? (isOpen ? { background: 'var(--amber-100)', color: 'var(--amber-600)' } : { background: 'var(--teal-100)', color: 'var(--teal-600)' }) : s.kind === 'clarification' ? { background: 'var(--teal-100)', color: 'var(--teal-600)' } : undefined;
  const author = isNote ? `${ROLE_NAMES.deployment_manager} · Deployment mgr` : s.kind === 'clarification' ? 'Confirmed on mobile' : 'Ledger source';
  return (
    <div id={`src-${s.id}`} className={`src${selected && !isOpen ? ' sel' : ''}${focused ? ' flash' : ''}`} style={style}>
      <div className="row">
        <div className="ty" style={tyStyle}>{meta.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}><div className="nm">{meta.name}</div><div className="meta">{author} · {time(s.createdAt)}</div></div>
        <span className="vtag" title={`hash ${s.hash}`}>v{s.version}</span>
      </div>
      {(isNote || s.kind === 'clarification' || s.kind === 'commissioning_log') ? (
        <div className="quote">{isNote ? <Quote text={s.text} tone={tone} /> : s.text}</div>
      ) : (
        <div className="small muted" style={{ marginTop: 8, lineHeight: '17px' }}>{s.text}</div>
      )}
      {isOpen && view.stage !== 'reading' && <div className="row small" style={{ marginTop: 8, color: 'var(--amber-600)' }}><Wait />Ambiguous quantity: incremental or total?</div>}
      {clarified && view.ref && <div className="row small" style={{ marginTop: 8, color: 'var(--teal-600)' }}><Chk />Clarified {time(view.ref.confirmedAt)}: {view.ref.answer === 'additional' ? 'increases remaining estimate' : 'new total remaining'}</div>}
    </div>
  );
}

// ---------------- ambiguity finding (both readings, engine preview) ----------------
export function AmbiguityFinding() {
  const { view } = useKeel();
  if (!view.readings || !view.note || !view.beforeInputs) return null;
  const { additional: A, new_total: B } = view.readings;
  const amt = view.noteAmount ?? 0n;
  const swing = A.adjustment > B.adjustment ? A.adjustment - B.adjustment : B.adjustment - A.adjustment;
  const card = (key: string, title: string, sub: string, r: typeof A) => (
    <div className="card" style={{ padding: 14, boxShadow: 'none' }}>
      <div className="row"><span className="code">{key}</span><b style={{ fontWeight: 600 }}>{title}</b></div>
      <div className="small muted" style={{ marginTop: 2 }}>{sub}</div>
      <div style={{ marginTop: 10 }}>
        <div className="kv"><span>Remaining cost</span><span className="amt">{usd(r.remaining)}</span></div>
        <div className="kv"><span>Est. total cost</span><span className="amt">{usd(r.estTotal)}</span></div>
        <div className="kv"><span>Progress</span><span className="amt">{pct(r.progressBp)}</span></div>
        <div className="kv"><span>Cumulative revenue</span><span className="amt">{usd(r.cumRevenue)}</span></div>
      </div>
      <div className="hr" style={{ margin: '8px 0' }} />
      <div className="kv" style={{ fontSize: 13 }}><span style={{ color: 'var(--ink-800)', fontWeight: 500 }}>Adjustment</span><span className={`amt ${r.adjustment < 0n ? 'neg' : 'pos'}`} style={{ fontWeight: 500 }}>{usd(r.adjustment, { sign: true })}</span></div>
    </div>
  );
  return (
    <motion.section className="glass" style={{ padding: '18px 20px', borderRadius: 16 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <div className="row"><Actor kind="agent">Keel agent</Actor><span className="pill amber"><span className="dot" />Ambiguity detected</span><div style={{ flex: 1 }} /><span className="small faint">{time(view.note.createdAt)}</span></div>
      <h2 className="h2" style={{ fontSize: 17, lineHeight: '24px', marginTop: 12 }}>“{view.note.text}” has two valid readings, and they lead to opposite adjustments.</h2>
      <p className="sec" style={{ marginTop: 4 }}>Keel will not choose between them. Both outcomes below were computed by the accounting engine, and no entry can be proposed until the deployment manager confirms which reading applies.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, marginTop: 16 }}>
        {card('A', `Increase: additional ${usd(amt, { cents: false })}`, `Remaining becomes ${usd(view.beforeInputs.remaining, { cents: false })} + ${usd(amt, { cents: false })}`, A)}
        {card('B', `Replace: new total ${usd(amt, { cents: false })}`, `Remaining becomes ${usd(amt, { cents: false })}`, B)}
      </div>
      <div className="row small" style={{ marginTop: 12, flexWrap: 'wrap' }}><Actor kind="engine">Engine preview · not recorded</Actor><span className="muted">{usd(swing)} swing in recognized revenue between the two readings</span></div>
    </motion.section>
  );
}

// ---------------- proposed journal entry ----------------
export function JournalEntryCard() {
  const { view } = useKeel();
  if (!view.latest || view.entry.length === 0) return null;
  const dr = view.entry.reduce((s, l) => s + l.debit, 0n), cr = view.entry.reduce((s, l) => s + l.credit, 0n);
  const status = view.posting ? { cls: 'teal', t: `Posted · ${view.posting.postingRef}` } : view.stage === 'approved' ? { cls: 'teal', t: 'Approved' } : view.stage === 'returned' ? { cls: 'coral', t: 'Returned' } : view.stage === 'held' ? { cls: 'amber', t: 'On hold' } : { cls: 'cobalt', t: 'Awaiting controller' };
  return (
    <motion.section className="card" style={{ overflow: 'hidden' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }} aria-labelledby="je-h">
      <div className="cardhd" style={{ flexWrap: 'wrap' }}>
        <h2 className="h2" id="je-h">{view.posting ? 'Journal entry' : 'Proposed journal entry'}</h2>
        <span className="code">rev {view.latest.revision}</span>
        <div className="sp" />
        <span className={`pill ${dr === cr ? 'teal' : 'coral'}`}><span className="dot" />{dr === cr ? 'Balanced' : 'Unbalanced'}</span>
        <motion.span key={status.t} className={`pill ${status.cls}`} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}><span className="dot" />{status.t}</motion.span>
      </div>
      <table className="je">
        <thead><tr><th>Account</th><th>Memo</th><th className="n">Debit</th><th className="n">Credit</th></tr></thead>
        <tbody>
          {view.entry.map((l, i) => (
            <tr key={i}>
              <td><span className="acct">{ACCOUNT_LABEL[l.account].code}</span>{ACCOUNT_LABEL[l.account].name}</td>
              <td className="muted small">{l.account === 'Revenue' ? 'Cumulative catch-up · estimate revision' : l.account === 'ContractAsset' ? (l.credit > 0n ? 'Reduce unbilled revenue' : 'Increase unbilled revenue') : 'Milestone invoice'}</td>
              <td className={`n${l.debit ? '' : ' faint'}`}>{l.debit ? amount(l.debit) : '—'}</td>
              <td className={`n${l.credit ? '' : ' faint'}`}>{l.credit ? amount(l.credit) : '—'}</td>
            </tr>
          ))}
          <tr className="tot"><td>Total</td><td className="small muted">Estimate adjustment · current period</td><td className="n">{amount(dr)}</td><td className="n">{amount(cr)}</td></tr>
        </tbody>
      </table>
    </motion.section>
  );
}

// ---------------- agent findings panel ----------------
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="mono">{String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')} elapsed</span>;
}

export function AgentPanel() {
  const { view, snapshot, backend, role } = useKeel();
  const { setPhoneOpen } = useUi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState<null | 'return' | 'hold'>(null);
  const [reason, setReason] = useState('');
  const b = view.beforeInputs;
  const call = snapshot.call && view.ref && snapshot.call.id === view.ref.convexId ? snapshot.call : null;
  const isController = role === 'controller';

  const approve = async () => {
    if (!view.latest) return;
    setBusy(true);
    const p = view.latest;
    if (p.status === 'open') {
      const r = await backend.decide(p, 'approve', '');
      if (!r.ok) { setBusy(false); return toast({ tone: 'err', title: 'Approval refused', body: errorCopy(r) }); }
    }
    const r2 = await backend.post({ ...p, status: 'approved' }, postingRef(p));
    setBusy(false);
    if (r2.ok) toast({ tone: 'ok', title: 'Approved and posted', body: `${postingRef(p)} written to the ledger by ${ROLE_NAMES.controller}.` });
    else toast({ tone: 'err', title: 'Posting refused', body: errorCopy(r2) });
  };
  const decideOther = async () => {
    if (!view.latest || !reasonFor) return;
    setBusy(true);
    const r = await backend.decide(view.latest, reasonFor, reason.trim() || (reasonFor === 'hold' ? 'Hold pending cost support' : 'Returned for review'));
    setBusy(false); setReasonFor(null); setReason('');
    toast(r.ok ? { tone: 'ok', title: reasonFor === 'hold' ? 'Placed on hold' : 'Returned to preparer', body: 'Nothing was posted.' } : { tone: 'err', title: 'Decision refused', body: errorCopy(r) });
  };

  const facts = b && (
    <div className="sect"><div className="over">Confirmed from ledger sources</div>
      <div className="fact"><Chk />Cost incurred (job cost export)<span className="amt">{usd(b.incurred, { cents: false })}</span></div>
      <div className="fact"><Chk />Prior remaining estimate<span className="amt">{usd(b.remaining, { cents: false })}</span></div>
      <div className="fact"><Chk />Contract value (fixed price)<span className="amt">{usd(b.contractValue, { cents: false })}</span></div>
      <div className="fact"><Chk />Billed to date<span className="amt">{usd(b.billed, { cents: false })}</span></div>
    </div>
  );

  let body: ReactNode;
  switch (view.stage) {
    case 'idle':
      body = <div className="empty"><div className="ic"><ShieldCheck size={18} /></div><b style={{ color: 'var(--ink-900)', fontWeight: 500 }}>No open exceptions</b><span className="small">The September close is posted. Keel is watching for new field updates.</span><Link className="btn ghost" to="/" style={{ marginTop: 8 }}>Go to command center</Link></div>;
      break;
    case 'reading':
      body = (
        <div className="sect"><div className="over">Investigating</div>
          {['Reading the field update (Claude)', 'Second reader cross-check (Gemini)', 'Comparing with approved conventions'].map((t, i) => (
            <motion.div key={t} className="fact" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.25 }}><span className="wait" style={{ borderColor: 'var(--cobalt-600)' }} />{t}</motion.div>
          ))}
          <div className="shimmer" style={{ height: 54, marginTop: 6 }} />
        </div>
      );
      break;
    case 'awaiting_clarification':
    case 'unconfirmed':
      body = (
        <>
          {view.stage === 'awaiting_clarification' ? (
            <div className="esc">
              <div className="row" style={{ fontWeight: 500, color: 'var(--amber-600)' }}><Wait />Waiting on deployment manager</div>
              <div className="row" style={{ marginTop: 10 }}><div className="av" style={{ width: 28, height: 28, borderRadius: '50%', background: '#2A3550', color: '#fff', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>M</div><div><div style={{ fontWeight: 500, lineHeight: '16px' }}>{ROLE_NAMES.deployment_manager}</div><div className="small muted">Deployment manager · Oakland</div></div></div>
              <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.75)', border: '1px solid rgba(184,106,18,.16)', fontWeight: 500 }}>“{view.ref?.question}”</div>
              <div className="row small muted" style={{ marginTop: 8 }}><Send size={12} />{call ? `Phone ${call.status === 'answering' ? 'answering' : 'ringing'}` : 'Sent'} · voice + mobile<div style={{ flex: 1 }} />{call && <Elapsed since={call.createdAt} />}</div>
            </div>
          ) : (
            <div className="esc" style={{ background: 'var(--coral-100)', borderColor: 'rgba(207,63,85,.25)' }}>
              <div className="row" style={{ fontWeight: 500, color: 'var(--coral-600)' }}><Pause size={14} />Manager could not confirm</div>
              <p className="small" style={{ marginTop: 6 }}>{ROLE_NAMES.deployment_manager} answered “not sure”{call?.reason ? ` (${call.reason})` : ''}. The forecast stays on hold and no entry can be proposed. Next step: obtain a cost-to-complete schedule from the site team.</p>
            </div>
          )}
          <div className="block"><Lock />Posting blocked: estimate is ambiguous</div>
          {facts}
          <div className="sect"><div className="over">Unresolved</div><div className="fact"><Wait />Is the {usd(view.noteAmount ?? 0n, { cents: false })} incremental to the {usd(b?.remaining ?? 0n, { cents: false })} remaining, or a replacement?</div></div>
          <div style={{ flex: 1 }} />
          {view.stage === 'awaiting_clarification' && <button className="btn dark lg" onClick={() => setPhoneOpen(true)}><Smartphone size={14} />Open manager phone</button>}
        </>
      );
      break;
    case 'calculating':
      body = (
        <>
          {view.ref && <ClarifiedCard />}
          <div className="sect"><div className="over">Recalculating</div><div className="fact"><span className="wait" style={{ borderColor: 'var(--ink-800)' }} />Accounting engine computing revised cost-to-cost figures</div><div className="shimmer" style={{ height: 80 }} /></div>
        </>
      );
      break;
    default: {
      const p = view.latest!;
      const canDecide = p.status === 'open';
      body = (
        <>
          {view.ref ? <ClarifiedCard /> : view.explanation.find((l) => l.startsWith('Convention')) && (
            <div className="ok"><div className="row" style={{ fontWeight: 500, color: 'var(--teal-600)' }}><Chk />Learned convention applied</div><div className="small" style={{ marginTop: 6 }}>{view.explanation.find((l) => l.startsWith('Convention'))}. No call was needed.</div></div>
          )}
          {view.escalation && (
            <div className="esc"><div className="row small" style={{ fontWeight: 500, color: 'var(--amber-600)' }}>Margin at or below zero: controller review</div><div className="small" style={{ marginTop: 4 }}>{cap(view.escalation.replace(/; loss contract.*$/, '.'))}</div></div>
          )}
          {facts}
          <div className="sect"><div className="over">Agent explanation</div>
            {view.explanation.filter((l) => !l.startsWith('ESCALATION') && !l.startsWith('Convention') && !l.startsWith('Clarification from')).map((l, i) => <p key={i} className="small sec" style={{ lineHeight: '18px' }}>{l}</p>)}
          </div>
          {view.pendingConvention && canDecide && (
            <div className="small muted" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--sand-50)', border: '1px solid var(--sand-200)' }}>
              Approving also saves the convention <b className="mono" style={{ fontWeight: 500, color: 'var(--ink-800)' }}>{view.pendingConvention.template}.{view.pendingConvention.key} = {view.pendingConvention.value}</b>, so the next “another $X” update needs no call.
            </div>
          )}
          <div style={{ flex: 1 }} />
          {view.posting ? (
            <div className="col" style={{ gap: 8 }}>
              <div className="ok"><div className="row" style={{ fontWeight: 500, color: 'var(--teal-600)' }}><Chk />Posted {view.posting.postingRef}</div><div className="small muted" style={{ marginTop: 4 }}>{view.posting.postedBy} · {time(view.posting.postedAt)} · duplicate-protected by posting ref</div></div>
              <Link className="btn primary lg" to="/audit"><ShieldCheck size={14} />Open evidence trail</Link>
            </div>
          ) : canDecide || view.stage === 'approved' ? (
            <div className="col" style={{ gap: 8 }}>
              <div className="row small muted"><Actor kind="ctrl">Controller</Actor>{isController ? 'approval required · preparer ≠ approver' : `Switch to ${ROLE_NAMES.controller} to approve`}</div>
              <button className="btn primary lg" disabled={!isController || busy} onClick={approve}>{busy ? <span className="wait spin" style={{ borderColor: '#fff' }} /> : <Check size={14} />}{view.stage === 'approved' ? 'Post approved entry' : 'Approve & post'}</button>
              {canDecide && (
                <AnimatePresence mode="wait">
                  {reasonFor ? (
                    <motion.div key="r" className="col" style={{ gap: 8 }} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                      <label className="small muted" htmlFor="reason">{reasonFor === 'hold' ? 'Why hold?' : 'Why return?'}</label>
                      <div className="composer"><textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonFor === 'hold' ? 'e.g. need cost-to-complete schedule' : 'e.g. recheck incurred cost cutoff'} autoFocus /></div>
                      <div className="row" style={{ gap: 8 }}><button className="btn ghost" style={{ flex: 1 }} onClick={() => setReasonFor(null)}>Cancel</button><button className="btn dark" style={{ flex: 1 }} disabled={busy} onClick={decideOther}>Confirm {reasonFor}</button></div>
                    </motion.div>
                  ) : (
                    <motion.div key="b" className="row" style={{ gap: 8 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      <button className="btn ghost" style={{ flex: 1 }} disabled={!isController} onClick={() => setReasonFor('return')}><Undo2 size={14} />Return</button>
                      <button className="btn ghost" style={{ flex: 1 }} disabled={!isController} onClick={() => setReasonFor('hold')}><Pause size={14} />Hold</button>
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </div>
          ) : (
            <div className="esc"><div style={{ fontWeight: 500 }}>Rev {p.revision} {p.status}</div><div className="small muted" style={{ marginTop: 4 }}>{view.approval?.reason ? `“${view.approval.reason}” · ${view.approval.by}` : 'A new revision is required to move forward.'}</div></div>
          )}
        </>
      );
    }
  }

  return (
    <aside className="glass ag" aria-label="Keel findings">
      <div className="row"><Logo size={24} /><h2 className="h2">Keel findings</h2><div style={{ flex: 1 }} /><Actor kind="agent">Agent</Actor></div>
      {body}
    </aside>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ClarifiedCard() {
  const { view } = useKeel();
  if (!view.ref) return null;
  return (
    <motion.div className="ok" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
      <div className="row" style={{ fontWeight: 500, color: 'var(--teal-600)' }}><Chk />Clarification confirmed</div>
      <div style={{ marginTop: 6, fontWeight: 500 }}>{view.ref.answer === 'additional' ? `“Additional ${usd(view.noteAmount ?? 0n, { cents: false })}: it increases the remaining estimate.”` : `“New total remaining: ${usd(view.noteAmount ?? 0n, { cents: false })}.”`}</div>
      <div className="small muted" style={{ marginTop: 4 }}>{view.ref.speaker || ROLE_NAMES.deployment_manager} · Deployment manager · {time(view.ref.confirmedAt)}</div>
      <div className="small muted" style={{ marginTop: 6 }}>Resolves which reading applies. It does not by itself substantiate the cost estimate.</div>
    </motion.div>
  );
}
