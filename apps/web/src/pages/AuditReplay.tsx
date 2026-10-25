import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BookOpen, Calculator, Download, FileSpreadsheet, MessageSquare, Play, RotateCcw, Scale, ShieldCheck } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sidebar, TopBar } from '../components/Shell';
import { Actor, Chk, Wait, errorCopy, type ActorKind } from '../components/ui';
import { useKeel } from '../data/KeelProvider';
import type { Result, Snapshot } from '../data/model';
import { inputsOf } from '../data/select';
import { ACCOUNT_LABEL, amount, ids, json, lines, pct, time, usd } from '../lib/format';

type NodeData = { key: string; actor: ActorKind; actorLabel: string; icon: ReactNode; title: string; value: string; meta: string; detail: [string, string][]; quote?: string };

function buildTrail(s: Snapshot, postingId: bigint | null) {
  const posting = (postingId ? s.postings.find((p) => p.id === postingId) : null) ?? [...s.postings].sort((a, b) => Number(b.id - a.id))[0];
  if (!posting) return null;
  const proposal = s.proposals.find((p) => p.id === posting.proposalId)!;
  const calc = s.calculations.find((c) => c.id === proposal.calculationId) ?? null;
  const prevProp = s.proposals.filter((p) => p.workItemId === proposal.workItemId && p.revision < proposal.revision && (p.status === 'approved' || p.status === 'posted')).sort((a, b) => b.revision - a.revision)[0];
  const before = prevProp ? s.calculations.find((c) => c.id === prevProp.calculationId) ?? null : null;
  const src = calc ? s.sources.find((x) => x.id === calc.forecastSourceId) ?? null : s.sources.find((x) => ids(proposal.evidenceSourceIds).includes(x.id)) ?? null;
  const ref = src ? s.clarificationRefs.find((r) => r.sourceId === src.id) ?? null : null;
  const clarSrc = src ? s.sources.find((x) => x.kind === 'clarification' && x.parentSourceId === src.id) ?? null : null;
  const exts = src ? s.extractions.filter((e) => e.sourceId === src.id) : [];
  const approval = s.approvals.filter((a) => a.proposalId === proposal.id && a.decision === 'approve').sort((a, b) => Number(b.id - a.id))[0] ?? null;
  const policy = s.policies[0] ?? null;
  const convLine = proposal.explanation.split('\n').find((l) => l.startsWith('Convention'));
  const ls = lines(posting.linesJson);
  const revenue = ls.find((l) => l.account === 'Revenue');
  const revDelta = revenue ? revenue.credit - revenue.debit : 0n;
  const inputs = calc ? inputsOf(calc) : null;

  const nodes: NodeData[] = [
    { key: 'entry', actor: 'ledger', actorLabel: 'Ledger', icon: <BookOpen />, title: 'Journal entry', value: revenue ? usd(revDelta, { sign: true }) : usd(ls[0]?.debit ?? 0n), meta: `${posting.postingRef} · rev ${posting.revision}`,
      detail: [['Posting ref', posting.postingRef], ['Lines', ls.map((l) => `${l.debit ? 'Dr' : 'Cr'} ${ACCOUNT_LABEL[l.account].name} ${amount(l.debit || l.credit)}`).join(' · ')], ['Posted by', `${posting.postedBy} · ${time(posting.postedAt)}`], ['Proposal', `#${proposal.id} rev ${proposal.revision}`]] },
    { key: 'calc', actor: 'engine', actorLabel: 'Engine', icon: <Calculator />, title: 'Calculation', value: calc ? `${pct(calc.progressBp)} × ${usd(inputs!.contractValue, { cents: false })}` : 'Milestone billing', meta: calc ? `calc #${calc.id} · @keel/engine` : 'no revenue calculation',
      detail: calc && inputs ? [['Inputs', `incurred ${usd(inputs.incurred, { cents: false })} · remaining ${usd(inputs.remaining, { cents: false })} · billed ${usd(inputs.billed, { cents: false })}`], ['Progress', `${usd(inputs.incurred, { cents: false })} ÷ ${usd(inputs.incurred + inputs.remaining, { cents: false })} = ${pct(calc.progressBp)}`], ['Cumulative revenue', usd(calc.cumRevenueCents)], ['Contract asset', usd(calc.contractAssetCents)], ['Margin', `${usd(calc.marginCents)}${calc.lossWarning ? ' · escalated' : ''}`]] : [['Type', 'Reclassification, revenue unchanged']] },
    { key: 'source', actor: 'agent', actorLabel: 'Agent', icon: src?.kind === 'note' ? <MessageSquare /> : <FileSpreadsheet />, title: src?.kind === 'note' ? 'Field update' : src?.kind === 'forecast' ? 'Forecast' : 'Source', value: src ? `v${src.version} · ${src.kind}` : '—', meta: src ? `source #${src.id} · hash ${src.hash}` : '',
      quote: src?.text, detail: src ? [['Received', time(src.createdAt)], ['Readers', exts.length ? exts.map((e) => `${e.reader}${e.ambiguityFlag ? ' (ambiguous)' : ''}`).join(' · ') : 'seeded source'], ['Hash', src.hash]] : [] },
    { key: 'clar', actor: ref ? 'humanok' : 'agent', actorLabel: ref ? 'Manager' : convLine ? 'Convention' : 'Not required', icon: <MessageSquare />, title: ref ? 'Clarification' : convLine ? 'Learned convention' : 'Clarification', value: ref ? `“${ref.answer}”` : convLine ? 'another_means' : 'n/a', meta: ref ? `${ref.speaker} · ${time(ref.confirmedAt)}` : convLine ? 'no call needed' : 'unambiguous source',
      quote: clarSrc?.text ?? convLine, detail: ref ? [['Question', ref.question], ['Answer', ref.answer], ['Speaker', ref.speaker], ['Confirmed', time(ref.confirmedAt)], ['Scope', 'Resolves the interpretation only; does not substantiate the cost estimate']] : [['Basis', convLine ?? 'Source wording was unambiguous']] },
    { key: 'policy', actor: 'engine', actorLabel: 'Policy', icon: <Scale />, title: 'Revenue policy', value: policy ? `v${policy.version}` : '—', meta: policy?.text ?? '', detail: policy ? [['Policy', policy.text], ['Approved by', policy.approvedBy], ['Conventions', s.conventions.map((c) => `${c.template}.${c.key} = ${c.value}`).join(' · ')]] : [] },
    { key: 'approval', actor: 'ctrl', actorLabel: 'Controller', icon: <ShieldCheck />, title: 'Approval & posting', value: approval ? 'Approved' : 'Posted', meta: approval ? `${approval.by} · ${time(approval.at)}` : '', detail: approval ? [['Decision', `${approval.decision} rev ${approval.revision}`], ['By', approval.by], ['At', time(approval.at)], ['Reason', approval.reason || '—']] : [] },
  ];

  const allLines = ls.reduce((a, l) => ({ dr: a.dr + l.debit, cr: a.cr + l.credit }), { dr: 0n, cr: 0n });
  const preparer = s.history.find((h) => h.kind === 'proposed' && h.refId === proposal.id)?.actor ?? 'Keel Agent';
  const controls: { ok: boolean | 'warn'; label: string; right: string }[] = [
    { ok: allLines.dr === allLines.cr && ls.length > 0, label: 'Entry balances', right: `Δ ${amount(allLines.dr - allLines.cr)}` },
    { ok: !!approval && approval.by !== preparer, label: 'Preparer ≠ approver', right: `${preparer} → ${approval?.by ?? '—'}` },
    { ok: s.postings.filter((p) => p.postingRef === posting.postingRef).length === 1 && s.postings.filter((p) => p.proposalId === proposal.id).length === 1, label: 'Duplicate protection', right: 'ref + proposal unique' },
    { ok: !!src, label: 'Source version locked', right: src ? `v${src.version} · ${src.hash}` : '—' },
    { ok: !src || src.kind !== 'note' || !!ref || !!convLine, label: 'Ambiguity resolved by owner', right: ref ? ref.speaker : convLine ? 'convention' : 'n/a' },
    { ok: src?.kind === 'note' ? 'warn' : true, label: src?.kind === 'note' ? 'Cost-to-complete support' : 'Supporting documents', right: src?.kind === 'note' ? 'recommended: attach schedule' : 'attached' },
  ];
  return { posting, proposal, calc, before, nodes, controls, src, ref };
}

export function AuditReplay() {
  const { snapshot, backend, role } = useKeel();
  const [params] = useSearchParams();
  const pid = params.get('posting');
  const trail = useMemo(() => buildTrail(snapshot, pid ? BigInt(pid) : null), [snapshot, pid]);
  const reduce = useReducedMotion();
  const [sel, setSel] = useState(0);
  const [traced, setTraced] = useState(-1);
  const [replay, setReplay] = useState<{ at: Date; result: Result } | null>(null);
  useEffect(() => { setReplay(null); setTraced(-1); setSel(0); }, [trail?.posting.id]);

  const trace = () => {
    setTraced(-1);
    trail?.nodes.forEach((_, i) => setTimeout(() => { setSel(i); setTraced(i); }, reduce ? 0 : 160 + i * 620));
  };
  const doReplay = async () => {
    if (!trail) return;
    const result = await backend.post(trail.proposal, trail.posting.postingRef);
    setReplay({ at: new Date(), result });
  };
  const exportPacket = () => {
    if (!trail) return;
    const blob = new Blob([json({ posting: trail.posting, proposal: trail.proposal, calculation: trail.calc, evidence: trail.nodes.map((n) => ({ step: n.title, detail: Object.fromEntries(n.detail), quote: n.quote })), controls: trail.controls, exportedAt: new Date().toISOString(), mode: backend.mode })], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${trail.posting.postingRef}-audit-packet.json`; a.click(); URL.revokeObjectURL(a.href);
  };

  if (!trail) return null;
  const node = trail.nodes[sel];
  const b = trail.before, a = trail.calc;
  const bi = b ? inputsOf(b) : null, ai = a ? inputsOf(a) : null;
  const headline = trail.nodes[0].value;

  return (
    <div className="app"><div className="ambient" />
      <Sidebar />
      <main className="main">
        <TopBar crumbs={['Evidence & audit', 'Journal entries', trail.posting.postingRef]} />
        <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div className="over">Evidence replay</div>
              <h1 className="h1" style={{ marginTop: 6 }}>Why does this {headline.replace(/^[+−]/, '')} entry exist?</h1>
              <div className="sec" style={{ marginTop: 2 }}>Every figure traces to a versioned source, a deterministic calculation, a human confirmation, and an authorized approval.</div>
            </div>
            <div style={{ flex: 1 }} />
            <button className="btn ghost" onClick={exportPacket}><Download size={14} />Export audit packet</button>
            <button className="btn primary" onClick={trace}><Play size={14} />Trace the dollar</button>
          </div>

          <div className="audit-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 380px', gap: 16 }}>
            <section className="card" style={{ overflow: 'hidden' }}>
              <div className="cardhd"><span className="code" style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-800)' }}>{trail.posting.postingRef}</span><span className="h2">{trail.calc ? 'Estimate adjustment' : 'Milestone invoice'} · Oakland</span><div className="sp" /><span className="pill teal"><span className="dot" />Posted</span></div>
              <table className="je">
                <thead><tr><th>Account</th><th className="n">Debit</th><th className="n">Credit</th></tr></thead>
                <tbody>
                  {lines(trail.posting.linesJson).map((l, i) => <tr key={i}><td><span className="acct">{ACCOUNT_LABEL[l.account].code}</span>{ACCOUNT_LABEL[l.account].name}</td><td className={`n${l.debit ? '' : ' faint'}`}>{l.debit ? amount(l.debit) : '—'}</td><td className={`n${l.credit ? '' : ' faint'}`}>{l.credit ? amount(l.credit) : '—'}</td></tr>)}
                </tbody>
              </table>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', padding: '12px 16px', gap: 12, background: 'var(--sand-50)', borderTop: '1px solid var(--sand-200)' }}>
                <div><div className="over">Prepared</div><div className="small" style={{ marginTop: 4 }}>{trail.nodes[2].actorLabel === 'Agent' ? 'Keel agent' : 'Seed'} · rev {trail.proposal.revision}</div></div>
                <div><div className="over">Approved</div><div className="small" style={{ marginTop: 4 }}>{trail.nodes[5].meta || '—'}</div></div>
                <div><div className="over">Posted</div><div className="small mono" style={{ marginTop: 4 }}>{trail.posting.postedBy} · {time(trail.posting.postedAt)}</div></div>
                <div><div className="over">Posting ref</div><div className="small mono" style={{ marginTop: 4 }}>{trail.posting.postingRef}</div></div>
              </div>
            </section>
            <section className="card">
              <div className="cardhd"><span className="h2">Controls</span><div className="sp" /><span className="pill teal">{trail.controls.filter((c) => c.ok === true).length} / {trail.controls.length} passed</span></div>
              {trail.controls.map((c) => <div className="ctl" key={c.label}>{c.ok === true ? <Chk /> : c.ok === 'warn' ? <Wait /> : <span className="chk" style={{ background: 'var(--coral-600)' }}>!</span>}{c.label}<span className="r">{c.right}</span></div>)}
            </section>
          </div>

          <section className="card" aria-labelledby="chain-h">
            <div className="cardhd" style={{ flexWrap: 'wrap' }}><h2 className="h2" id="chain-h">Evidence chain</h2><span className="small muted">Entry → calculation → source → clarification → policy → approval</span><div className="sp" /><span className="small muted">Select a link to inspect the record</span></div>
            <div className="chain" role="tablist" aria-label="Evidence chain">
              {trail.nodes.map((n, i) => (
                <button key={n.key} role="tab" aria-selected={sel === i} className="cn" onClick={() => setSel(i)}>
                  <div className="bead">{n.icon}</div>
                  {i < trail.nodes.length - 1 && <div className="lk"><motion.i initial={false} animate={{ scaleX: traced < 0 || traced > i ? 1 : 0 }} transition={{ duration: reduce ? 0 : 0.5 }} /></div>}
                  <div className="box"><Actor kind={n.actor}>{n.actorLabel}</Actor><div className="t">{n.title}</div><div className={`v${i === 0 && n.value.startsWith('−') ? ' neg' : ''}`}>{n.value}</div><div className="m">{n.meta}</div></div>
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={node.key} role="tabpanel" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} style={{ padding: '4px 16px 16px', display: 'grid', gridTemplateColumns: node.quote ? 'minmax(0,1fr) minmax(0,1fr)' : '1fr', gap: 16 }}>
                <dl className="detail">{node.detail.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
                {node.quote && <div className="quote" style={{ marginTop: 0 }}>“{node.quote}”</div>}
              </motion.div>
            </AnimatePresence>
          </section>

          <div className="audit-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 420px', gap: 16 }}>
            <section className="card" style={{ overflow: 'hidden' }}>
              <div className="cardhd"><span className="h2">Prior vs revised</span><div className="sp" />{trail.ref && <Link className="small" style={{ color: 'var(--cobalt-600)', fontWeight: 500 }} to="/exceptions/oakland-forecast">Open investigation</Link>}</div>
              {a && ai ? (
                <table className="cmp">
                  <thead><tr><th>Metric</th><th>Prior</th><th>Revised</th></tr></thead>
                  <tbody>
                    <Row label="Remaining cost" b={bi ? usd(bi.remaining, { cents: false }) : '—'} a={usd(ai.remaining, { cents: false })} />
                    <Row label="Est. total cost" b={bi ? usd(bi.incurred + bi.remaining, { cents: false }) : '—'} a={usd(ai.incurred + ai.remaining, { cents: false })} />
                    <Row label="Progress" b={b ? pct(b.progressBp) : '—'} a={pct(a.progressBp)} />
                    <Row label="Cumulative revenue" b={b ? usd(b.cumRevenueCents, { cents: false }) : '—'} a={usd(a.cumRevenueCents, { cents: false })} />
                    <Row label="Contract asset" b={b ? usd(b.contractAssetCents, { cents: false }) : '—'} a={usd(a.contractAssetCents, { cents: false })} />
                    <Row label="Billed to date" b={bi ? usd(bi.billed, { cents: false }) : '—'} a={usd(ai.billed, { cents: false })} />
                  </tbody>
                </table>
              ) : <div className="empty small">No revenue calculation for this entry.</div>}
            </section>
            <section className="replay" aria-live="polite">
              <div className={`glow${replay && replay.result.ok ? ' ok' : ''}`} />
              <div className="row" style={{ position: 'relative' }}>
                {replay ? (replay.result.ok ? <span className="pill teal">Posted (unexpected)</span> : <span className="pill coral" style={{ background: 'rgba(207,63,85,.18)', color: '#FF9AA8' }}><span className="dot" />{replay.result.code === 'duplicate_posting' ? 'Duplicate blocked' : `Refused · ${replay.result.code}`}</span>) : <span className="pill" style={{ background: 'rgba(255,255,255,.08)', color: '#C9D0DC' }}><RotateCcw size={12} />Replay test</span>}
                <div style={{ flex: 1 }} />
                {replay && <span className="small" style={{ color: '#7F8AA0' }}>{time(replay.at)}</span>}
              </div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 15, marginTop: 12, position: 'relative' }}>
                {replay ? (replay.result.ok ? 'A second posting was written.' : replay.result.code === 'duplicate_posting' ? 'The same event was replayed. No second entry was created.' : errorCopy(replay.result)) : 'Send this exact posting to the ledger again.'}
              </div>
              <div className="term">
                post(proposal={String(trail.proposal.id)}, rev={trail.proposal.revision}, ref={trail.posting.postingRef})<br />
                {replay ? (replay.result.ok ? <span style={{ color: '#7CE0C9' }}>ok</span> : <span style={{ color: '#FF9AA8' }}>{replay.result.message}</span>) : <span style={{ color: '#7F8AA0' }}>awaiting replay…</span>}<br />
                ledger postings for this proposal: <span style={{ color: '#fff' }}>{snapshot.postings.filter((p) => p.proposalId === trail.proposal.id).length}</span>
              </div>
              <button className="btn" style={{ marginTop: 12, background: 'rgba(255,255,255,.1)', color: '#fff', position: 'relative' }} onClick={doReplay}><RotateCcw size={14} />Replay event</button>
              {role !== 'controller' && <div className="small" style={{ color: '#7F8AA0', marginTop: 8, position: 'relative' }}>Acting as accountant: the role guard refuses before the duplicate check. Switch to Dana to test duplicate protection.</div>}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

const Row = ({ label, b, a }: { label: string; b: string; a: string }) => <tr className={b !== a ? 'chg' : ''}><td>{label}</td><td>{b}</td><td>{a}</td></tr>;
