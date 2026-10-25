import type { Convention } from '@keel/engine';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { Calculator, Check, Lock, MessageSquareText, Pause, Play, RotateCcw, ShieldCheck } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatedNumber } from '../components/ui';
import { ACCOUNT_LABEL, amount, pct, usd } from '../lib/format';
import { AGENT, BEFORE, MESSAGE, PHRASE, PRIOR, READINGS, SWING, UPDATE, type Reading } from './scenario';

const STEPS = ['Field update', 'Two readings', 'Ask the owner', 'Recalculate', 'Propose entry', 'Approve & post'] as const;
// Dwell per step while autoplaying. Step 2 waits for an answer; autoplay answers "additional", the primary demo branch.
const DWELL = [1600, 2600, 3600, 2800, 2400, 0];
const ease = [0.16, 1, 0.3, 1] as const;
const dollars = (c: bigint) => usd(c, { cents: false });
const grp = (c: bigint) => (c / 100n).toLocaleString('en-US');

type Wire = { d: string; key: string };

export function HeroFork() {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { amount: 0.35 });
  const [step, setStep] = useState(reduce ? 2 : 0);
  const [choice, setChoice] = useState<Convention | null>(null);
  const [playing, setPlaying] = useState(!reduce);
  const [pressing, setPressing] = useState(false);

  const choose = useCallback((c: Convention) => { setPressing(false); setChoice(c); setStep(3); }, []);

  useEffect(() => {
    if (!playing || !inView || step >= STEPS.length - 1) return;
    if (step === 2) {
      const press = setTimeout(() => setPressing(true), DWELL[2] - 700);
      const answer = setTimeout(() => choose('additional'), DWELL[2]);
      return () => { clearTimeout(press); clearTimeout(answer); };
    }
    const t = setTimeout(() => setStep((s) => s + 1), DWELL[step]);
    return () => clearTimeout(t);
  }, [step, playing, inView, choose]);

  const jump = (i: number) => {
    setPlaying(false); setPressing(false); setStep(i);
    if (i >= 3 && !choice) setChoice('additional');
    if (i < 3) setChoice(null);
  };
  const replay = () => { setPressing(false); setChoice(null); setStep(0); setPlaying(true); };

  // Wires are measured from the real card positions so they survive every breakpoint.
  const gridRef = useRef<HTMLDivElement>(null);
  const msgRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLDivElement>(null);
  const aRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const [wires, setWires] = useState<{ a: Wire; b: Wire; outA: Wire; outB: Wire; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const g = grid.getBoundingClientRect();
      const r = (el: HTMLElement | null) => {
        const x = el!.getBoundingClientRect();
        return { l: x.left - g.left, r: x.right - g.left, t: x.top - g.top, b: x.bottom - g.top, cx: x.left - g.left + x.width / 2, cy: x.top - g.top + x.height / 2 };
      };
      const m = r(msgRef.current), col = r(inRef.current), a = r(aRef.current), b = r(bRef.current), o = r(outRef.current);
      const vertical = a.t > m.b - 4;
      // Stacked layouts start below the facts list so the wires never cross text.
      const top = col.b + 4;
      const curve = (x1: number, y1: number, x2: number, y2: number) => {
        if (vertical) { const k = (y2 - y1) / 2; return `M${x1},${y1} C${x1},${y1 + k} ${x2},${y2 - k} ${x2},${y2}`; }
        const k = (x2 - x1) / 2; return `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`;
      };
      const oy = Math.min(o.t + 64, o.b);
      setWires({
        w: g.width, h: g.height,
        a: { key: 'a', d: vertical ? curve(m.cx, top, a.cx, a.t) : curve(m.r, m.t + 58, a.l, a.cy) },
        b: { key: 'b', d: vertical ? curve(m.cx, top, b.cx, b.t) : curve(m.r, m.t + 58, b.l, b.cy) },
        outA: { key: 'oa', d: vertical ? curve(a.cx, a.b, o.cx, o.t) : curve(a.r, a.cy, o.l, oy) },
        outB: { key: 'ob', d: vertical ? curve(b.cx, b.b, o.cx, o.t) : curve(b.r, b.cy, o.l, oy) },
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, []);

  const forked = step >= 1;
  const resolved = step >= 3 && choice;
  const state = (c: Convention) => (step === 0 ? 'idle' : !resolved ? 'open' : choice === c ? 'confirmed' : 'ruled');

  return (
    <div className="fork" ref={rootRef} aria-label="How RoboAudit handles an ambiguous field update" role="region">
      <div className="fork-bar">
        <span className="fork-file"><span className="fork-dot" />{'Oakland deployment'}<span className="fork-sep">/</span>September close</span>
        <span className="fork-note">Illustrative run on the demo ledger</span>
        <div className="fork-ctl">
          <button type="button" className="icon-btn" onClick={() => (step >= STEPS.length - 1 ? replay() : setPlaying((p) => !p))} aria-label={step >= STEPS.length - 1 ? 'Replay' : playing ? 'Pause' : 'Play'}>
            {step >= STEPS.length - 1 ? <RotateCcw size={14} /> : playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
        </div>
      </div>

      <div className="fork-grid" ref={gridRef}>
        {wires && (
          <svg className="fork-wires" width={wires.w} height={wires.h} viewBox={`0 0 ${wires.w} ${wires.h}`} aria-hidden>
            <defs>
              <linearGradient id="wire-open" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={wires.w} y2="0"><stop offset="0" stopColor="#FFFFFF" stopOpacity=".75" /><stop offset="1" stopColor="#F5A65B" /></linearGradient>
            </defs>
            {[wires.a, wires.b].map((w, i) => {
              const s = state(i === 0 ? 'additional' : 'new_total');
              return (
                <g key={w.key} className={`wire wire-${s}`}>
                  <path d={w.d} className="wire-base" />
                  <motion.path d={w.d} className="wire-live" initial={false} animate={{ pathLength: forked ? 1 : 0, opacity: forked ? 1 : 0 }} transition={{ duration: 0.9, delay: i * 0.12, ease }} />
                  {s === 'open' && <path d={w.d} pathLength={1} className="wire-pulse" style={{ animationDelay: `${i * 0.6}s` }} />}
                </g>
              );
            })}
            {[wires.outA, wires.outB].map((w, i) => {
              const on = !!resolved && choice === (i === 0 ? 'additional' : 'new_total');
              return <motion.path key={w.key} d={w.d} className="wire-out" initial={false} animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }} transition={{ duration: 0.8, ease }} />;
            })}
          </svg>
        )}

        <div className="fork-col fork-in" ref={inRef}>
          <motion.div ref={msgRef} className="msg" initial={reduce ? false : { opacity: 0, y: 10, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.7, ease, delay: 0.3 }}>
            <div className="msg-from">
              <span className="avatar">M</span>
              <span><b>Matt</b> · Deployment manager</span>
              <span className="msg-via">SMS · 11:37</span>
            </div>
            <p className="msg-text">
              {MESSAGE.split(PHRASE)[0]}
              <mark className={`phrase${forked ? ' is-on' : ''}`}>{PHRASE}</mark>
              {MESSAGE.split(PHRASE)[1]}
            </p>
            <AnimatePresence initial={false}>
              {forked && (
                <motion.p className="msg-flag" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.4, ease }}>
                  <span className={`flag-ic${resolved ? ' is-ok' : ''}`}>{resolved ? <Check size={10} strokeWidth={3} /> : null}</span>
                  {resolved ? `Matt confirmed: ${choice === 'additional' ? 'added cost' : 'new total'}` : '“Another” is ambiguous: added cost, or a new total?'}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
          <ul className="facts" aria-label="Facts confirmed from ledger sources">
            <Fact label="Contract value" value={BEFORE.contractValue} src="Contract" />
            <Fact label="Cost incurred" value={BEFORE.incurred} src="Job cost export" />
            <Fact label="Prior remaining" value={BEFORE.remaining} src="Forecast v1" />
            <Fact label="Recognized to date" value={PRIOR.cumRevenue} src="Posted close" />
          </ul>
        </div>

        <div className="fork-col fork-mid">
          <ReadingCard ref={aRef} tag="A" title={`Additional ${dollars(UPDATE)}`} sub={`Remaining ${dollars(BEFORE.remaining)} + ${dollars(UPDATE)}`} r={READINGS.additional} state={state('additional')} />
          <motion.div className="swing" initial={false} animate={{ opacity: forked && !resolved ? 1 : 0 }} transition={{ duration: 0.4 }}>
            <span className="swing-line" />
            <span className="swing-txt"><b>{dollars(SWING)}</b> apart in reported revenue</span>
            <span className="swing-line" />
          </motion.div>
          <ReadingCard ref={bRef} tag="B" title={`New total ${dollars(UPDATE)}`} sub={`Remaining becomes ${dollars(UPDATE)}`} r={READINGS.new_total} state={state('new_total')} />
        </div>

        <div className="fork-col fork-out">
          <div ref={outRef} className="out">
            <AnimatePresence mode="wait" initial={false}>
              {step <= 1 && <OutLedger key="ledger" paused={forked} />}
              {step === 2 && <OutAsk key="ask" pressing={pressing} onAnswer={(c) => { setPlaying(true); choose(c); }} />}
              {step === 3 && choice && <OutRecalc key="recalc" r={READINGS[choice]} />}
              {step >= 4 && choice && <OutEntry key="entry" r={READINGS[choice]} posted={step >= 5} />}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <ol className="fork-steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? 'is-done' : i === step ? 'is-now' : ''}>
            <button type="button" onClick={() => jump(i)} aria-current={i === step ? 'step' : undefined}>
              <span className="fs-track"><span className={`fs-fill${i === step && playing && inView && DWELL[i] ? ' run' : ''}`} style={{ animationDuration: `${DWELL[i]}ms` }} /></span>
              <span className="fs-label"><span className="fs-n">{i + 1}</span><span className="fs-t">{label}</span></span>
            </button>
          </li>
        ))}
      </ol>
      <div className="fs-now" aria-hidden><span className="num">{step + 1}/{STEPS.length}</span>{STEPS[step]}</div>
    </div>
  );
}

function Fact({ label, value, src }: { label: string; value: bigint; src: string }) {
  return (
    <li>
      <span className="tick" aria-label="Verified"><Check size={9} strokeWidth={3.2} /></span>
      <span className="f-l">{label}<span className="f-src">{src}</span></span>
      <span className="f-v num">{dollars(value)}</span>
    </li>
  );
}

const ReadingCard = forwardRef<HTMLDivElement, { tag: string; title: string; sub: string; r: Reading; state: 'idle' | 'open' | 'confirmed' | 'ruled' }>(function ReadingCard({ tag, title, sub, r, state }, ref) {
  const neg = r.adjustment < 0n;
  return (
    <div ref={ref} className={`reading r-${state}`}>
      <div className="rd-hd">
        <span className="rd-tag">{tag}</span>
        <span className="rd-title">{title}</span>
        <span className="rd-state">
          {state === 'confirmed' ? <><Check size={11} strokeWidth={3} />Confirmed</> : state === 'ruled' ? 'Ruled out' : state === 'open' ? 'Unconfirmed' : ''}
        </span>
      </div>
      <div className="rd-body" aria-hidden={state === 'idle'}>
        <div className="rd-sub">{sub}</div>
        <dl>
          <div className="rd-row rd-hide-sm"><dt>Est. total cost</dt><dd className="num">{dollars(r.estTotal)}</dd></div>
          <div className="rd-row"><dt>Progress</dt><dd className="num">{pct(r.progressBp)}</dd></div>
          <div className="rd-row"><dt>Cum. revenue</dt><dd className="num">{dollars(r.cumRevenue)}</dd></div>
          <div className="rd-row rd-adj"><dt>Adjustment</dt><dd className={`num ${neg ? 'neg' : 'pos'}`}>{usd(r.adjustment, { cents: false, sign: true })}</dd></div>
        </dl>
      </div>
    </div>
  );
});

const panel = { initial: { opacity: 0, y: 8, filter: 'blur(4px)' }, animate: { opacity: 1, y: 0, filter: 'blur(0px)' }, exit: { opacity: 0, y: -6, filter: 'blur(4px)' }, transition: { duration: 0.38, ease } };

function OutLedger({ paused }: { paused: boolean }) {
  return (
    <motion.div className="o-panel o-ledger" {...panel}>
      <div className="o-kicker">General ledger</div>
      <div className="o-empty">
        <div className="o-ghost-row" /><div className="o-ghost-row short" /><div className="o-ghost-row" />
      </div>
      <p className="o-quiet">No entry proposed.</p>
      <AnimatePresence>
        {paused && (
          <motion.div className="lockbar" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease, delay: 0.5 }}>
            <Lock size={13} />Posting paused: two valid readings
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function OutAsk({ pressing, onAnswer }: { pressing: boolean; onAnswer: (c: Convention) => void }) {
  return (
    <motion.div className="o-panel o-ask" {...panel}>
      <div className="lockbar"><Lock size={13} />Posting paused · asking Matt</div>
      <div className="ask-bubble">
        <div className="ask-from"><MessageSquareText size={12} />{AGENT} to Matt</div>
        Is the {dollars(UPDATE)} additional to the current remaining forecast, or the new total remaining?
      </div>
      <div className="ask-opts" role="group" aria-label="Answer as Matt">
        <button type="button" className={`ask-opt${pressing ? ' pressing' : ''}`} onClick={() => onAnswer('additional')}>
          <span className="radio" />Additional {dollars(UPDATE)}<span className="ask-hint">Remaining → {dollars(READINGS.additional.remaining)}</span>
        </button>
        <button type="button" className="ask-opt" onClick={() => onAnswer('new_total')}>
          <span className="radio" />New total {dollars(UPDATE)}<span className="ask-hint">Remaining → {dollars(READINGS.new_total.remaining)}</span>
        </button>
      </div>
      <p className="o-try">Answer as Matt to resolve it yourself.</p>
    </motion.div>
  );
}

function OutRecalc({ r }: { r: Reading }) {
  const rows: { k: string; from: number; to: number; fmt: (n: number) => string; f: string }[] = [
    { k: 'Est. total cost', from: Number(PRIOR.estTotal), to: Number(r.estTotal), fmt: (n) => dollars(BigInt(Math.round(n))), f: `${grp(BEFORE.incurred)} + ${grp(r.remaining)}` },
    { k: 'Progress', from: PRIOR.progressBp, to: r.progressBp, fmt: (n) => pct(Math.round(n)), f: `${grp(BEFORE.incurred)} ÷ ${grp(r.estTotal)}` },
    { k: 'Cum. revenue', from: Number(PRIOR.cumRevenue), to: Number(r.cumRevenue), fmt: (n) => dollars(BigInt(Math.round(n))), f: `${grp(BEFORE.contractValue)} × ${pct(r.progressBp)}` },
  ];
  return (
    <motion.div className="o-panel o-recalc" {...panel}>
      <div className="o-kicker"><Calculator size={12} />Accounting engine · deterministic</div>
      {rows.map((x, i) => (
        <div className="rc-row" key={x.k}>
          <div className="rc-k">{x.k}</div>
          <div className="rc-v">
            <span className="rc-from num">{x.fmt(x.from)}</span>
            <AnimatedNumber className="rc-to num" from={x.from} value={x.to} format={x.fmt} delay={0.25 + i * 0.35} />
          </div>
          <div className="rc-f num">{x.f}</div>
        </div>
      ))}
      <div className="rc-adj">
        <span>Adjustment</span>
        <AnimatedNumber className={`num ${r.adjustment < 0n ? 'neg' : 'pos'}`} from={0} value={Number(r.adjustment)} format={(n) => usd(BigInt(Math.round(n)), { cents: false, sign: true })} delay={1.3} />
      </div>
    </motion.div>
  );
}

function OutEntry({ r, posted }: { r: Reading; posted: boolean }) {
  return (
    <motion.div className="o-panel o-entry" {...panel}>
      <div className="o-kicker">Proposed journal entry · rev 2</div>
      <table className="je-mini">
        <thead><tr><th>Account</th><th>Dr</th><th>Cr</th></tr></thead>
        <tbody>
          {r.entry.map((l) => (
            <tr key={l.account}>
              <td><span className="acct-code">{ACCOUNT_LABEL[l.account].code}</span>{ACCOUNT_LABEL[l.account].name}</td>
              <td className="num">{l.debit ? amount(l.debit) : ''}</td>
              <td className="num">{l.credit ? amount(l.credit) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="balanced"><Check size={11} strokeWidth={3} />Balanced</div>
      <AnimatePresence mode="wait" initial={false}>
        {posted ? (
          <motion.div key="posted" className="approval is-ok" initial={{ opacity: 0, clipPath: 'inset(0 100% 0 0 round 10px)' }} animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0 round 10px)' }} transition={{ duration: 0.6, ease }}>
            <ShieldCheck size={15} />
            <div><b>Approved by Dana · Posted</b><span>Controller sign-off. Evidence trail saved.</span></div>
          </motion.div>
        ) : (
          <motion.div key="waiting" className="approval is-wait" exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <span className="wait-ring" />
            <div><b>Awaiting controller</b><span>Only Dana can approve and post.</span></div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
