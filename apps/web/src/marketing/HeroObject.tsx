import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { Lock } from 'lucide-react';
import { useRef, type PointerEvent } from 'react';
import { pct, usd } from '../lib/format';
import { AGENT, MESSAGE, PHRASE, READINGS } from './scenario';

// The hero's lit object: one message forking into two ledgers, held at the question.
// Coordinates are a fixed 560×600 plane so the SVG paths and the absolutely placed slabs share one system.
const ease = [0.16, 1, 0.3, 1] as const;
const dollars = (c: bigint) => usd(c, { cents: false, sign: true });

export function HeroObject() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0), my = useMotionValue(0);
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-14, 2]), { stiffness: 90, damping: 18 });
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [12, 2]), { stiffness: 90, damping: 18 });
  const move = (e: PointerEvent) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const leave = () => { mx.set(0); my.set(0); };
  const A = READINGS.additional, B = READINGS.new_total;
  const at = (d: number) => ({ duration: 0.8, ease, delay: reduce ? 0 : d });
  const draw = (d: number) => ({ initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 0.9, ease, delay: reduce ? 0 : d } });
  const rise = (d: number) => ({ initial: { opacity: 0, y: 14, filter: 'blur(8px)' }, animate: { opacity: 1, y: 0, filter: 'blur(0px)' }, transition: at(d) });

  return (
    <div className="obj" ref={ref} onPointerMove={move} onPointerLeave={leave} aria-label={`${MESSAGE} Two readings: ${dollars(A.adjustment)} or ${dollars(B.adjustment)} of revenue. Posting is paused while ${AGENT} asks.`} role="img">
      <div className="obj-floor" aria-hidden />
      <motion.div className="obj-plane" style={{ rotateX, rotateY }} aria-hidden>
        <svg className="obj-wires" viewBox="0 0 560 600">
          <defs>
            <linearGradient id="ow-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".7" /><stop offset="1" stopColor="#FF8A98" /></linearGradient>
            <linearGradient id="ow-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".7" /><stop offset="1" stopColor="#45DDBB" /></linearGradient>
          </defs>
          <motion.path d="M280 122 V176" className="ow" {...draw(1.2)} />
          <motion.path d="M280 222 C280 262 140 250 140 292" className="ow" stroke="url(#ow-a)" {...draw(1.7)} />
          <motion.path d="M280 222 C280 262 420 250 420 292" className="ow" stroke="url(#ow-b)" {...draw(1.8)} />
          <motion.path d="M140 476 C140 510 280 500 280 520" className="ow dim" {...draw(2.7)} />
          <motion.path d="M420 476 C420 510 280 500 280 520" className="ow dim" {...draw(2.75)} />
          {!reduce && <path d="M280 222 C280 262 140 250 140 292" pathLength={1} className="ow-pulse" />}
          {!reduce && <path d="M280 222 C280 262 420 250 420 292" pathLength={1} className="ow-pulse" style={{ animationDelay: '1.2s' }} />}
        </svg>

        <motion.div className="o-msg" {...rise(0.45)}>
          <div className="o-msg-hd"><span className="o-av">M</span><b>Matt</b><span>Deployment manager</span><i>now</i></div>
          <p>
            {MESSAGE.split(PHRASE)[0]}
            <motion.span className="o-phrase" initial={{ backgroundSize: '0% 34%' }} animate={{ backgroundSize: '100% 34%' }} transition={at(1.15)}>{PHRASE}</motion.span>
            {MESSAGE.split(PHRASE)[1]}
          </p>
        </motion.div>

        <motion.div className="o-lock" {...rise(1.45)}><Lock size={12} />Posting paused</motion.div>

        <motion.div className="o-slab o-a" {...rise(2.0)}>
          <span className="o-lbl">Reading A · added cost</span>
          <b className="o-num neg">{dollars(A.adjustment)}</b>
          <span className="o-sub">Revenue adjustment</span>
          <span className="o-meta"><span>Progress</span><span className="num">{pct(A.progressBp)}</span></span>
        </motion.div>
        <motion.div className="o-slab o-b" {...rise(2.15)}>
          <span className="o-lbl">Reading B · new total</span>
          <b className="o-num pos">{dollars(B.adjustment)}</b>
          <span className="o-sub">Revenue adjustment</span>
          <span className="o-meta"><span>Progress</span><span className="num">{pct(B.progressBp)}</span></span>
        </motion.div>

        <motion.div className="o-ask" {...rise(2.9)}>
          <span className="o-ask-dot" />
          <span><b>{AGENT}</b> asked Matt: added cost, or the new total?</span>
        </motion.div>
      </motion.div>
    </div>
  );
}
