import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ForecastBridge } from '../components/ForecastBridge';
import { AgentPanel, AmbiguityFinding, JournalEntryCard, SourcesPane, Stepper } from '../components/investigation';
import { Rail, TopBar } from '../components/Shell';
import { useKeel } from '../data/KeelProvider';

const STAGE_PILL: Record<string, [string, string]> = {
  idle: ['teal', 'No open exception'], reading: ['cobalt', 'Keel is reading'], awaiting_clarification: ['amber', 'Awaiting clarification'],
  unconfirmed: ['coral', 'On hold · not confirmed'], calculating: ['cobalt', 'Recalculating'], proposed: ['cobalt', 'Ready for controller'],
  approved: ['teal', 'Approved'], posted: ['teal', 'Posted'], returned: ['coral', 'Returned'], held: ['amber', 'On hold'], stale: ['amber', 'Superseded'],
};

export function Investigation() {
  const { view, snapshot } = useKeel();
  const [tone, label] = STAGE_PILL[view.stage];
  const policy = snapshot.policies[0];
  const showBridge = view.beforeInputs && view.stage !== 'idle';
  return (
    <div className="app"><div className="ambient" />
      <Rail />
      <main className="main">
        <TopBar crumbs={['Exceptions', 'Oakland deployment', view.note ? 'Estimate change' : 'No open exception']} />
        <div className="ihd">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ flexWrap: 'wrap' }}><h1 className="h1" style={{ fontSize: 20, lineHeight: '28px' }}>{view.note ? 'Remaining cost forecast changed' : 'Oakland deployment'}</h1><span className={`pill ${tone}`}><span className="dot" />{label}</span></div>
            <div className="row small muted" style={{ marginTop: 4, flexWrap: 'wrap' }}>
              <span>Aster Robotics</span>·<span>ASC 606 over time · cost-to-cost</span>·<span>{policy ? <>Policy <span className="vtag">v{policy.version}</span></> : null}</span>
              {view.workItemId != null && <>·<span>WI-{String(view.workItemId)}</span></>}
            </div>
          </div>
          {view.stage === 'posted' && <Link className="btn ghost" to="/audit"><ShieldCheck size={14} />Evidence trail</Link>}
        </div>
        {view.steps.length > 0 ? <Stepper steps={view.steps} /> : <div className="steps" />}
        <div className="ws">
          <SourcesPane />
          <div className="pane" style={{ gap: 16 }}>
            {(view.stage === 'awaiting_clarification' || view.stage === 'unconfirmed') && <AmbiguityFinding />}
            {view.stage === 'reading' && <section className="card" style={{ padding: 20 }}><div className="row"><span className="actor agent"><i>K</i>Keel agent</span><span className="small muted">Reading “{view.note?.text}”</span></div><div className="shimmer" style={{ height: 18, marginTop: 14, width: '70%' }} /><div className="shimmer" style={{ height: 14, marginTop: 10, width: '90%' }} /><div className="shimmer" style={{ height: 14, marginTop: 8, width: '55%' }} /></section>}
            {showBridge && <ForecastBridge before={view.beforeInputs!} after={view.afterInputs} pendingLabel={view.stage === 'calculating' ? 'Engine recalculating' : 'Revised estimate pending'} />}
            <JournalEntryCard />
            {view.stage === 'idle' && <section className="card"><div className="empty"><b style={{ color: 'var(--ink-900)', fontWeight: 500 }}>Nothing to investigate</b><span className="small">Send a field update from the command center to start a case.</span><Link className="btn primary" to="/" style={{ marginTop: 8 }}>Go to inbox</Link></div></section>}
          </div>
          <AgentPanel />
        </div>
      </main>
    </div>
  );
}
