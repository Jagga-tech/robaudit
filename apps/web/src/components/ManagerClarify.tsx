import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Pause, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useKeel } from '../data/KeelProvider';
import { ROLE_NAMES, type ClarificationAnswer } from '../data/model';
import { time, usd } from '../lib/format';
import { Actor, Logo, errorCopy } from './ui';

type Choice = ClarificationAnswer | 'unsure';
const SPEAKER = ROLE_NAMES.deployment_manager;

/** The deployment manager's one-question clarification flow. Talks to Convex in live mode. */
export function ManagerClarify({ framed = false, onClose }: { framed?: boolean; onClose?: () => void }) {
  const { backend, snapshot, view } = useKeel();
  const call = snapshot.call;
  const [choice, setChoice] = useState<Choice | null>(null);
  const [ctxOpen, setCtxOpen] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setChoice(null); setError(null); }, [call?.id]);

  const amt = view.noteAmount ?? 0n;
  const prior = view.beforeInputs?.remaining ?? 0n;
  const open = call && ['ringing', 'answering', 'fallback_text'].includes(call.status);

  const pick = (c: Choice) => {
    setChoice(c);
    if (call?.status === 'ringing') backend.startAnswer(call.id);
  };
  const submit = async () => {
    if (!call || !choice) return;
    setSending(true); setError(null);
    const r = choice === 'unsure' ? await backend.decline(call.id, 'not sure; needs site review') : await backend.confirm(call.id, choice, SPEAKER);
    setSending(false);
    if (!r.ok) setError(errorCopy(r));
  };

  const header = (
    <div className="mh">
      <Logo size={30} />
      <div style={{ flex: 1 }}><div style={{ fontWeight: 600, lineHeight: '18px' }}>Keel for Aster Robotics</div><div className="small muted">Oakland deployment</div></div>
      {onClose && <button className="btn ghost" style={{ height: 30, width: 30, padding: 0, borderRadius: 999 }} onClick={onClose} aria-label="Close phone"><X size={14} /></button>}
    </div>
  );

  let content;
  if (!call) {
    content = (
      <div className="mb" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '0 28px' }}>
        <div className="empty"><div className="ic"><Check size={18} /></div><b style={{ color: 'var(--ink-900)', fontWeight: 600, fontSize: 17 }}>No questions right now</b><span>Keel will reach out here if a field update needs your confirmation.</span></div>
      </div>
    );
  } else if (open) {
    content = (
      <>
        <div className="mb">
          <div className="mcard">
            <div className="row"><span className="pill amber"><span className="dot" />Answer needed</span><div style={{ flex: 1 }} /><span className="small faint">{time(new Date(call.createdAt))}</span></div>
            {view.note && <><div className="small muted" style={{ marginTop: 12 }}>Your update · {time(view.note.createdAt)}</div><div style={{ fontSize: 15, lineHeight: '22px', marginTop: 2 }}>“{view.note.text}”</div></>}
            <div className="hr" style={{ margin: '12px 0' }} />
            <div style={{ fontSize: 17, lineHeight: '24px', fontWeight: 600, letterSpacing: '-.01em' }}>{call.question}</div>
          </div>
          <div role="radiogroup" aria-label="Your answer" className="col" style={{ gap: 10 }}>
            <Opt checked={choice === 'additional'} onClick={() => pick('additional')} title={`Additional ${usd(amt, { cents: false })}`} sub={`Increases remaining cost to ${usd(prior + amt, { cents: false })}`} />
            <Opt checked={choice === 'new_total'} onClick={() => pick('new_total')} title={`New total remaining: ${usd(amt, { cents: false })}`} sub={`Replaces the ${usd(prior, { cents: false })} estimate`} />
            <Opt checked={choice === 'unsure'} onClick={() => pick('unsure')} title="I’m not sure" sub="Finance holds the forecast and follows up" />
          </div>
          <AnimatePresence mode="wait">
            {choice && choice !== 'unsure' ? (
              <motion.div key="sum" className="glass" style={{ padding: 14, borderRadius: 18 }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="over">You’re confirming</div>
                <div style={{ marginTop: 8 }}>
                  <div className="kv" style={{ fontSize: 14, lineHeight: '26px' }}><span>Prior remaining</span><span className="amt">{usd(prior, { cents: false })}</span></div>
                  <div className="kv" style={{ fontSize: 14, lineHeight: '26px' }}><span>{choice === 'additional' ? 'Additional' : 'Replaced by'}</span><span className="amt">{choice === 'additional' ? '+' : ''}{usd(amt, { cents: false })}</span></div>
                  <div className="hr" style={{ margin: '4px 0' }} />
                  <div className="kv" style={{ fontSize: 14, lineHeight: '26px' }}><span style={{ color: 'var(--ink-900)', fontWeight: 500 }}>New remaining</span><span className="amt" style={{ fontWeight: 600 }}>{usd(choice === 'additional' ? prior + amt : amt, { cents: false })}</span></div>
                </div>
              </motion.div>
            ) : (
              <motion.button key="ctx" className="mcard" style={{ padding: '10px 14px', textAlign: 'left' }} onClick={() => setCtxOpen((v) => !v)} aria-expanded={ctxOpen} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="row" style={{ fontWeight: 500 }}><ChevronDown size={14} style={{ transform: ctxOpen ? undefined : 'rotate(-90deg)', transition: 'transform .2s' }} />Context from finance</div>
                {ctxOpen && <><div className="kv" style={{ fontSize: 13, lineHeight: '24px' }}><span>Remaining estimate (last approved)</span><span className="amt">{usd(prior, { cents: false })}</span></div><div className="kv" style={{ fontSize: 13, lineHeight: '24px' }}><span>Your update mentions</span><span className="amt">{usd(amt, { cents: false })}</span></div></>}
              </motion.button>
            )}
          </AnimatePresence>
          {error && <div className="small" style={{ color: 'var(--coral-600)' }} role="alert">{error}</div>}
        </div>
        <div className="mf">
          <button className="mbtn primary" disabled={!choice || sending} onClick={submit}>{sending ? 'Sending…' : !choice ? 'Select an answer' : choice === 'unsure' ? 'Send “not sure”' : 'Confirm answer'}</button>
        </div>
      </>
    );
  } else {
    const ok = call.status === 'confirmed';
    content = (
      <>
        <div className="mb" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 8, padding: '0 28px' }}>
          <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }} style={{ width: 64, height: 64, borderRadius: '50%', background: ok ? 'var(--teal-100)' : 'var(--amber-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 10px ${ok ? 'rgba(221,244,238,.5)' : 'rgba(252,239,216,.5)'}` }}>
            <span className="chk" style={{ width: 36, height: 36, background: ok ? 'var(--teal-600)' : 'var(--amber-600)' }}>{ok ? <Check size={20} strokeWidth={3} /> : <Pause size={18} />}</span>
          </motion.div>
          <div style={{ fontSize: 22, lineHeight: '28px', fontWeight: 600, letterSpacing: '-.015em', marginTop: 16 }}>{ok ? 'Answer sent to finance' : 'Thanks, finance will follow up'}</div>
          <div className="sec" style={{ fontSize: 15, lineHeight: '22px' }}>
            {ok ? <>You confirmed the {usd(amt, { cents: false })} is <b style={{ fontWeight: 600 }}>{call.answer === 'additional' ? 'additional' : 'the new total remaining'}</b>.</> : 'The forecast stays on hold. Nothing changes in the books until the estimate is clear.'}
          </div>
          <div className="mcard" style={{ textAlign: 'left', width: '100%', marginTop: 16 }}>
            <div className="over">What happens next</div>
            <div className="fact" style={{ marginTop: 10, fontSize: 13 }}><Actor kind="engine" />Keel recalculates with the accounting engine</div>
            <div className="fact" style={{ marginTop: 8, fontSize: 13 }}><Actor kind="ctrl" />The controller reviews before anything posts</div>
          </div>
          <div className="small faint mono" style={{ marginTop: 8 }}>Receipt {call.id.slice(-8)} · {call.confirmedAt ? time(new Date(call.confirmedAt)) : time(new Date())}</div>
        </div>
        {onClose && <div className="mf"><button className="mbtn ghost" onClick={onClose}>Done</button></div>}
      </>
    );
  }

  if (!framed) return <div className="m-page">{header}{content}</div>;
  return (
    <div className="ph">
      <div className="island" />
      <div className="sb"><span>{new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '')}</span><span style={{ fontSize: 13 }}>●●● 5G</span></div>
      {header}{content}
      <div className="home" />
    </div>
  );
}

function Opt({ checked, onClick, title, sub }: { checked: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button role="radio" aria-checked={checked} className="opt" onClick={onClick}>
      <span className="rd" /><span><b>{title}</b><span>{sub}</span></span>
    </button>
  );
}
