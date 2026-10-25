import { BookOpen, Check, Scale } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ManagerClarify } from '../components/ManagerClarify';
import { Sidebar, TopBar } from '../components/Shell';
import { Actor } from '../components/ui';
import { useKeel } from '../data/KeelProvider';
import { priorCloseNotes } from '../data/select';
import { amount, lines, pct, time, usd } from '../lib/format';

function Page({ crumbs, title, sub, children }: { crumbs: string[]; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="app"><div className="ambient" />
      <Sidebar />
      <main className="main">
        <TopBar crumbs={crumbs} />
        <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div><h1 className="h1">{title}</h1><div className="sec" style={{ marginTop: 2 }}>{sub}</div></div>
          {children}
        </div>
      </main>
    </div>
  );
}

export function Approvals() {
  const { snapshot } = useKeel();
  const nav = useNavigate();
  const open = snapshot.proposals.filter((p) => p.status === 'open');
  return (
    <Page crumbs={['Close', 'Approvals']} title="Approvals" sub="Proposals waiting for a controller decision. Only the controller role can approve, return, hold, or post.">
      <section className="card" style={{ overflow: 'hidden' }}>
        {open.length === 0 ? <div className="empty"><div className="ic"><Check size={18} /></div><b style={{ color: 'var(--ink-900)', fontWeight: 500 }}>Nothing awaiting approval</b><span className="small">New proposals appear here as soon as Keel prepares them.</span></div> : (
          <table className="tbl"><thead><tr><th>Work item</th><th>Revision</th><th style={{ textAlign: 'right' }}>Entry</th><th>Prepared by</th></tr></thead><tbody>
            {open.map((p) => {
              const w = snapshot.workItems.find((x) => x.id === p.workItemId);
              const ls = lines(p.entryJson);
              const isRevenue = p.calculationId !== 0n;
              const go = () => nav(isRevenue ? '/exceptions/oakland-forecast' : '/approvals');
              return <tr key={String(p.id)} className="click" tabIndex={0} onClick={go} onKeyDown={(e) => e.key === 'Enter' && go()}><td><div style={{ fontWeight: 500 }}>{w?.title}</div><span className="code">WI-{String(p.workItemId)}</span></td><td>rev {p.revision}</td><td className="amt small" style={{ textAlign: 'right' }}>{ls.map((l) => `${l.debit ? 'Dr' : 'Cr'} ${l.account} ${amount(l.debit || l.credit)}`).join(' / ')}</td><td><Actor kind="agent">Keel</Actor></td></tr>;
            })}
          </tbody></table>
        )}
      </section>
    </Page>
  );
}

export function Ledger() {
  const { snapshot } = useKeel();
  const nav = useNavigate();
  const postings = [...snapshot.postings].sort((a, b) => Number(b.id - a.id));
  return (
    <Page crumbs={['Close', 'Journal entries']} title="Journal entries" sub="Posted entries on the ledger. Select one to replay its evidence.">
      <section className="card" style={{ overflow: 'hidden' }}>
        <table className="tbl"><thead><tr><th>Posting ref</th><th>Lines</th><th>Posted by</th><th>Time</th></tr></thead><tbody>
          {postings.map((p) => {
            const go = () => nav(`/audit?posting=${p.id}`);
            return <tr key={String(p.id)} className="click" tabIndex={0} onClick={go} onKeyDown={(e) => e.key === 'Enter' && go()}><td><span className="row"><BookOpen size={14} color="var(--ink-500)" /><b className="mono" style={{ fontWeight: 500 }}>{p.postingRef}</b></span></td><td className="amt small">{lines(p.linesJson).map((l) => `${l.debit ? 'Dr' : 'Cr'} ${l.account} ${amount(l.debit || l.credit)}`).join(' / ')}</td><td>{p.postedBy}</td><td className="mono small">{time(p.postedAt)}</td></tr>;
          })}
        </tbody></table>
      </section>
    </Page>
  );
}

export function Policies() {
  const { snapshot } = useKeel();
  const prior = priorCloseNotes(snapshot);
  return (
    <Page crumbs={['Controls', 'Policies & conventions']} title="Policies & conventions" sub="What Keel is allowed to assume. Conventions are learned from approved closes and saved only when a controller approves.">
      {snapshot.policies.map((p) => (
        <section key={String(p.id)} className="card" style={{ padding: 16 }}>
          <div className="row"><Scale size={16} /><b style={{ fontWeight: 600 }}>Revenue policy</b><span className="vtag">v{p.version}</span><div style={{ flex: 1 }} /><span className="small muted">Approved by {p.approvedBy}</span></div>
          <p className="sec" style={{ marginTop: 8 }}>{p.text}. Progress = cost incurred ÷ estimated total cost; cumulative revenue = contract value × progress (bigint cents, @keel/engine).</p>
        </section>
      ))}
      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="cardhd"><span className="h2">Learned conventions</span><div className="sp" /><span className="small muted">{snapshot.conventions.length} active</span></div>
        <table className="tbl"><thead><tr><th>Convention</th><th>Value</th><th>Policy</th><th>Approved by</th><th>Evidence</th></tr></thead><tbody>
          {snapshot.conventions.map((c) => <tr key={String(c.id)}><td className="mono small">{c.template}.{c.key}</td><td><span className="pill cobalt">{c.value}</span></td><td>v{c.policyVersion}</td><td>{c.approvedBy}</td><td className="small muted">{c.exampleSourceIds.split(',').filter(Boolean).length} sources</td></tr>)}
        </tbody></table>
      </section>
      <section className="card" style={{ padding: 16 }}>
        <div className="over">Prior closes that taught “Remaining Estimate = future costs only”</div>
        <ol style={{ marginTop: 10, paddingLeft: 18 }} className="col">{prior.map((n) => <li key={String(n.id)} className="small sec" style={{ lineHeight: '20px' }}>{n.text}</li>)}</ol>
      </section>
    </Page>
  );
}

export function Project() {
  const { snapshot, view } = useKeel();
  const calc = view.after ?? view.before;
  const p = snapshot.projects[0];
  return (
    <Page crumbs={['Projects', p?.name ?? '']} title={p?.name ?? 'Project'} sub="Aster Robotics · fixed-price, single performance obligation">
      <div className="kpis">
        <div className="card kpi"><div className="over">Contract value</div><div className="v">{p ? usd(p.contractValueCents, { cents: false }) : '—'}</div></div>
        <div className="card kpi"><div className="over">Progress</div><div className="v">{calc ? pct(calc.progressBp) : '—'}</div></div>
        <div className="card kpi"><div className="over">Cumulative revenue</div><div className="v">{calc ? usd(calc.cumRevenueCents, { cents: false }) : '—'}</div></div>
        <div className="card kpi"><div className="over">Contract asset</div><div className="v">{calc ? usd(calc.contractAssetCents, { cents: false }) : '—'}</div></div>
      </div>
      <section className="card" style={{ overflow: 'hidden' }}>
        <div className="cardhd"><span className="h2">Billing milestones</span></div>
        <table className="tbl"><thead><tr><th>Milestone</th><th style={{ textAlign: 'right' }}>Amount</th><th>Status</th></tr></thead><tbody>
          {snapshot.milestones.map((m) => <tr key={String(m.id)}><td>{m.name}</td><td className="amt" style={{ textAlign: 'right' }}>{usd(m.amountCents)}</td><td><span className={`pill ${m.status === 'pending' ? 'ink' : 'teal'}`}>{m.status}</span></td></tr>)}
        </tbody></table>
      </section>
      <Link className="btn primary" style={{ alignSelf: 'flex-start' }} to="/exceptions/oakland-forecast">Open investigation</Link>
    </Page>
  );
}

export function ManagerPage() {
  return <ManagerClarify />;
}
