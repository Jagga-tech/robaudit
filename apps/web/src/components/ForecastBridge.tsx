import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Database, FileSignature, Info, MessageSquare, Scale } from 'lucide-react';
import { useState } from 'react';
import { useKeel } from '../data/KeelProvider';
import type { Inputs } from '../data/select';
import { compute } from '@keel/engine';
import { pct, usd, usdShort } from '../lib/format';
import { Actor, AnimatedNumber, useUi } from './ui';

const ease = [0.16, 1, 0.3, 1] as const;

/**
 * The Forecast Bridge: prior vs revised cost estimate → total cost → progress → cumulative revenue → adjustment.
 * Every number is read from ledger calculation inputs/outputs (or the engine for the prior snapshot); nothing is decorative.
 */
export function ForecastBridge({ before, after, pendingLabel }: { before: Inputs; after: Inputs | null; pendingLabel?: string }) {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<'prior' | 'bridge'>('bridge');
  const [replayKey, setReplayKey] = useState(0);
  const { snapshot, view } = useKeel();
  const { flashSource } = useUi();
  const b = compute(before);
  const a = after ? compute(after) : null;
  const showAfter = mode === 'bridge' && after && a;

  const max = Number([before.contractValue, b.estTotal, a?.estTotal ?? 0n].reduce((m, x) => (x > m ? x : m), 0n)) * 1.25;
  const w = (c: bigint) => `${(Number(c) / max) * 100}%`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => BigInt(Math.round((max / 1.25) * f)));
  const delta = after ? after.remaining - before.remaining : 0n;
  const kind = (k: string) => snapshot.sources.filter((s) => s.kind === k).sort((x, y) => Number(y.id - x.id))[0];
  const costExport = kind('cost_export'), contract = kind('contract');
  const adj = a ? a.cumRevenue - b.cumRevenue : 0n;
  const dur = reduce ? 0 : 0.9;

  const Seg = ({ cls, left, width, children, delay = 0, radius }: { cls: string; left: bigint; width: bigint; children: React.ReactNode; delay?: number; radius?: string }) => (
    <motion.div className={`seg ${cls}`} style={{ left: w(left), borderRadius: radius }} initial={{ width: 0, opacity: 0 }} animate={{ width: w(width), opacity: 1 }} transition={{ duration: dur, delay: reduce ? 0 : delay, ease }}>
      <span style={{ overflow: 'hidden', textOverflow: 'clip' }}>{children}</span>
    </motion.div>
  );

  return (
    <section className="card" aria-labelledby="bridge-h">
      <div className="cardhd">
        <h2 className="h2" id="bridge-h">Forecast bridge</h2>
        <Actor kind="engine">Accounting engine · deterministic</Actor>
        <div className="sp" />
        {after && (
          <div className="seg-ctl" role="group" aria-label="Bridge view">
            <button aria-pressed={mode === 'prior'} onClick={() => setMode('prior')}>Prior</button>
            <button aria-pressed={mode === 'bridge'} onClick={() => { setMode('bridge'); setReplayKey((k) => k + 1); }}>Prior → Revised</button>
          </div>
        )}
        {!after && pendingLabel && <span className="pill amber"><span className="dot" />{pendingLabel}</span>}
      </div>
      <div className="bridge" key={replayKey}>
        <div className="axis" aria-hidden>{ticks.map((t, i) => <span key={i} style={{ left: `${(Number(t) / max) * 100}%` }}>{i === 0 ? '$0' : usdShort(t).replace('$', '')}</span>)}</div>
        <div className="brow">
          <div className="lbl"><b>Prior estimate</b><span>Last approved close</span></div>
          <div className="track" role="img" aria-label={`Prior: incurred ${usd(before.incurred, { cents: false })} plus remaining ${usd(before.remaining, { cents: false })} equals ${usd(b.estTotal, { cents: false })}`}>
            <Seg cls="inc" left={0n} width={before.incurred}>Incurred {usdShort(before.incurred)}</Seg>
            <Seg cls="rem" left={before.incurred} width={before.remaining} delay={0.15} radius="0 7px 7px 0">Remaining {usdShort(before.remaining)}</Seg>
            <motion.div className="btot" style={{ left: w(b.estTotal) }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 0 : 0.6 }}>= {usd(b.estTotal, { cents: false })}</motion.div>
          </div>
        </div>
        <div className="brow">
          <div className="lbl"><b>Revised estimate</b><span>{after ? 'Field update + clarification' : 'Awaiting clarification'}</span></div>
          <div className="track" role="img" aria-label={after ? `Revised: incurred ${usd(after.incurred, { cents: false })} plus remaining ${usd(after.remaining, { cents: false })} equals ${usd(a!.estTotal, { cents: false })}` : 'Revised estimate pending'}>
            <div className="cv" style={{ left: w(before.contractValue) }}><span>Contract value {usdShort(before.contractValue)}</span></div>
            {showAfter ? (
              <>
                <Seg cls="inc" left={0n} width={after.incurred} delay={0.3}>Incurred {usdShort(after.incurred)}</Seg>
                {delta >= 0n ? (
                  <>
                    <Seg cls="rem" left={after.incurred} width={before.remaining} delay={0.45}>Remaining {usdShort(before.remaining)}</Seg>
                    {delta > 0n && <Seg cls="add" left={after.incurred + before.remaining} width={delta} delay={0.75}>+{usdShort(delta)}</Seg>}
                  </>
                ) : (
                  <Seg cls="rem" left={after.incurred} width={after.remaining} delay={0.45} radius="0 7px 7px 0">Remaining {usdShort(after.remaining)}</Seg>
                )}
                <motion.div className="btot" style={{ left: w(a!.estTotal) }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduce ? 0 : 1.2 }}>= {usd(a!.estTotal, { cents: false })}</motion.div>
              </>
            ) : after ? (
              <div className="seg q" style={{ left: 0, width: w(before.incurred), borderRadius: 7, opacity: 0.4 }} />
            ) : (
              <>
                <Seg cls="inc" left={0n} width={before.incurred}>Incurred {usdShort(before.incurred)}</Seg>
                <div className="seg q" style={{ left: w(before.incurred), width: w(view.readings ? (view.readings.additional.remaining > before.remaining ? view.readings.additional.remaining : before.remaining) : before.remaining), justifyContent: 'center' }}>
                  {view.readings ? `Remaining: ${usdShort(view.readings.new_total.remaining)} or ${usdShort(view.readings.additional.remaining)}?` : 'Remaining: ?'}
                </div>
              </>
            )}
          </div>
        </div>

        {showAfter && (
          <motion.div className="flow" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: reduce ? 0 : 0.16, delayChildren: reduce ? 0 : 1.0 } } }}>
            <Node label="Est. total cost" from={usd(b.estTotal, { cents: false })} fromNum={Number(b.estTotal)} to={Number(a!.estTotal)} fmt={(n) => usd(BigInt(Math.round(n)), { cents: false })} formula={`${grp(after.incurred)} + ${grp(after.remaining)}`}
              chip={{ icon: <MessageSquare size={11} />, label: view.clarificationSource ? 'Note + clarification' : 'Field note', onClick: () => view.note && flashSource(view.note.id) }} />
            <Conn />
            <Node label="Progress" from={pct(b.progressBp)} fromNum={b.progressBp} to={a!.progressBp} fmt={(n) => pct(Math.round(n))} formula={`${grp(after.incurred)} ÷ ${grp(a!.estTotal)}`}
              chip={{ icon: <Database size={11} />, label: 'Cost export', onClick: () => costExport && flashSource(costExport.id) }} />
            <Conn />
            <Node label="Cum. revenue" from={usd(b.cumRevenue, { cents: false })} fromNum={Number(b.cumRevenue)} to={Number(a!.cumRevenue)} fmt={(n) => usd(BigInt(Math.round(n)), { cents: false })} formula={`${grp(after.contractValue)} × ${pct(a!.progressBp)}`}
              chip={{ icon: <FileSignature size={11} />, label: 'Contract', onClick: () => contract && flashSource(contract.id) }} />
            <Conn />
            <Node keyNode={adj < 0n ? 'neg' : 'pos'} label="Adjustment" from="$0" fromNum={0} to={Number(adj)} fmt={(n) => usd(BigInt(Math.round(n)), { cents: false, sign: true })} formula={`${grp(a!.cumRevenue)} − ${grp(b.cumRevenue)}`}
              chip={{ icon: <Scale size={11} />, label: `Policy v${snapshot.policies[0]?.version ?? '—'}`, href: '/policies' }} />
          </motion.div>
        )}
        {showAfter && (
          <div className="row small muted" style={{ marginTop: 14, alignItems: 'flex-start' }}>
            <Info size={13} style={{ marginTop: 3, flex: 'none', color: 'var(--ink-400)' }} />
            <span>Projected margin moves from {usd(b.margin.amount, { cents: false })} ({pct(b.margin.bp)}) to {usd(a!.margin.amount, { cents: false })} ({pct(a!.margin.bp)}). This revises an estimate. It is not a realized loss, a cash movement, or an invoice correction.</span>
          </div>
        )}
      </div>
    </section>
  );
}

const grp = (c: bigint) => (c / 100n).toLocaleString('en-US');
const Conn = () => <div className="conn" aria-hidden><ArrowRight /></div>;

function Node({ label, from, fromNum, to, fmt, formula, chip, keyNode }: {
  label: string; from: string; fromNum: number; to: number; fmt: (n: number) => string; formula: string; keyNode?: 'neg' | 'pos';
  chip: { icon: React.ReactNode; label: string; onClick?: () => void; href?: string };
}) {
  const cls = keyNode === 'neg' ? 'node key' : keyNode === 'pos' ? 'node pos-key' : 'node';
  return (
    <motion.div className={cls} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease } } }}>
      <div className="over" style={keyNode ? { color: keyNode === 'neg' ? 'var(--coral-600)' : 'var(--teal-600)' } : undefined}>{label}</div>
      <div className="from">{from}</div>
      <AnimatedNumber value={to} from={fromNum} delay={0.2} format={fmt} className={`to${keyNode === 'neg' ? ' neg' : keyNode === 'pos' ? ' pos' : ''}`} />
      <div className="f">{formula}</div>
      {chip.href ? <a className="srcchip" href={chip.href}>{chip.icon}{chip.label}</a> : <button className="srcchip" onClick={chip.onClick}>{chip.icon}{chip.label}</button>}
    </motion.div>
  );
}
