import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ACCOUNT_LABEL, amount, pct } from '../lib/format';
import { AGENT, BEFORE, MESSAGE, PRIOR, READINGS, UPDATE } from './scenario';

// Auditor tickmarks: the marks a reviewer pencils beside a figure to say how it was verified.
type Mark = 'agreed' | 'manager' | 'footed' | 'engine' | 'controller' | 'refused';
const MARKS: Record<Mark, { glyph: string; label: string }> = {
  agreed: { glyph: '✓', label: 'Agreed to a ledger source' },
  manager: { glyph: 'M', label: 'Confirmed by the deployment manager' },
  footed: { glyph: 'F', label: 'Footed' },
  engine: { glyph: 'E', label: 'Recomputed by @keel/engine' },
  controller: { glyph: 'C', label: 'Approved by the controller' },
  refused: { glyph: '⊘', label: 'Replay refused by the ledger' },
};

const R = READINGS.additional;
// Accountants' notation: negatives in parentheses.
const acct = (c: bigint) => (c < 0n ? `(${amount(-c)})` : amount(c));
const grp = (c: bigint) => (c / 100n).toLocaleString('en-US');

type Row = { id: string; label: ReactNode; note?: string; value: string; mark: Mark; total?: boolean };
const ROWS: Row[] = [
  { id: 'contract', label: 'Contract value, fixed price', note: 'a', value: acct(BEFORE.contractValue), mark: 'agreed' },
  { id: 'incurred', label: 'Cost incurred to date', note: 'b', value: acct(BEFORE.incurred), mark: 'agreed' },
  { id: 'prior', label: 'Prior remaining estimate', value: acct(BEFORE.remaining), mark: 'agreed' },
  { id: 'update', label: <>Field update, read as <em>additional</em></>, value: acct(UPDATE), mark: 'manager' },
  { id: 'remaining', label: 'Revised remaining estimate', value: acct(R.remaining), mark: 'footed', total: true },
  { id: 'total', label: 'Estimated total cost', note: 'c', value: acct(R.estTotal), mark: 'footed' },
  { id: 'progress', label: 'Progress to date  (b ÷ c)', value: pct(R.progressBp), mark: 'engine' },
  { id: 'revenue', label: 'Cumulative revenue  (a × progress)', value: acct(R.cumRevenue), mark: 'engine' },
  { id: 'recognized', label: 'Less: previously recognized', value: acct(-PRIOR.cumRevenue), mark: 'agreed' },
  { id: 'adj', label: 'Revenue adjustment, current period', value: acct(R.adjustment), mark: 'engine', total: true },
];

const STEPS: { title: string; rows: string[]; actor: string; body: ReactNode; role: string }[] = [
  {
    title: 'Field update', rows: ['update'], actor: 'Matt · Deployment manager',
    body: <blockquote className="tr-quote">“{MESSAGE}”<span>SMS · added to the ledger as a versioned, hashed source</span></blockquote>,
    role: `Supplies the ${grp(UPDATE)}. On its own it can't say whether that's added cost or a new total, so ${AGENT} doesn't use it yet.`,
  },
  {
    title: 'Source evidence', rows: ['contract', 'incurred', 'prior', 'recognized'], actor: `${AGENT} · reading`,
    body: (
      <ul className="tr-src">
        <li><b>Contract</b><span>Fixed price, one performance obligation</span><i className="num">{grp(BEFORE.contractValue)}</i></li>
        <li><b>Job cost export</b><span>Incurred through Sept 30</span><i className="num">{grp(BEFORE.incurred)}</i></li>
        <li><b>Forecast v1</b><span>Remaining estimate, last close</span><i className="num">{grp(BEFORE.remaining)}</i></li>
        <li><b>Posted close</b><span>Revenue recognized to date</span><i className="num">{grp(PRIOR.cumRevenue)}</i></li>
      </ul>
    ),
    role: 'Every other input is agreed to a ledger source before it is used. These four figures do not change.',
  },
  {
    title: 'Clarification', rows: ['update', 'remaining'], actor: 'Matt · answered on mobile',
    body: <blockquote className="tr-quote">“Additional $200,000: it increases the remaining estimate.”<span>Stored as evidence, linked to the field update</span></blockquote>,
    role: `Decides the reading. Remaining becomes ${grp(BEFORE.remaining)} + ${grp(UPDATE)} = ${grp(R.remaining)}.`,
  },
  {
    title: 'Calculation', rows: ['total', 'progress', 'revenue'], actor: '@keel/engine · deterministic',
    body: (
      <div className="tr-formula num">
        <div><span>c</span>{grp(BEFORE.incurred)} + {grp(R.remaining)} = {grp(R.estTotal)}</div>
        <div><span>%</span>{grp(BEFORE.incurred)} ÷ {grp(R.estTotal)} = {pct(R.progressBp)}</div>
        <div><span>rev</span>{grp(BEFORE.contractValue)} × {pct(R.progressBp)} = {grp(R.cumRevenue)}</div>
      </div>
    ),
    role: 'Tested cost-to-cost arithmetic in integer cents. The language model never produces a number that gets posted.',
  },
  {
    title: 'Revised result', rows: ['revenue', 'recognized', 'adj'], actor: 'Engine output',
    body: (
      <div className="tr-formula num">
        <div><span>adj</span>{grp(R.cumRevenue)} − {grp(PRIOR.cumRevenue)} = ({grp(-R.adjustment)})</div>
        <div><span>margin</span>{grp(PRIOR.margin.amount)} → {grp(R.margin)}</div>
      </div>
    ),
    role: 'The adjustment is the change in cumulative revenue. Margin falls to zero, so the proposal is flagged for controller review.',
  },
  {
    title: 'Controller approval', rows: ['je1', 'je2'], actor: 'Dana · Controller',
    body: <p className="tr-p">Dana approves revision 2. Before posting, the ledger checks her role, that the revision is current, that no newer evidence has arrived, and that debits equal credits.</p>,
    role: 'A person with authority signs. Summo can propose an entry but cannot post one.',
  },
  {
    title: 'Audit trail', rows: ['post', 'replay'], actor: 'Ledger',
    body: <pre className="tr-pre">post(rev=2, ref=OAK-WI15-R2){'\n'}<em>duplicate_posting: already posted</em>{'\n'}postings for this proposal: 1</pre>,
    role: 'The same event replayed is refused and logged. The adjustment exists exactly once, with every link above attached.',
  },
];

export function TraceDollar() {
  const [i, setI] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const s = STEPS[i];
  const on = (id: string) => s.rows.includes(id);
  const go = (n: number) => { const k = (n + STEPS.length) % STEPS.length; setI(k); tabs.current[k]?.focus(); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
  };
  const je = R.entry;

  return (
    <div className="trace">
      <div className="tr-rail" role="tablist" aria-label="Provenance of the adjustment" aria-orientation="vertical" onKeyDown={onKey}>
        {STEPS.map((x, k) => (
          <button key={x.title} ref={(el) => { tabs.current[k] = el; }} role="tab" id={`tr-tab-${k}`} aria-controls="tr-panel" aria-selected={k === i} tabIndex={k === i ? 0 : -1} className={`tr-tab${k === i ? ' is-on' : ''}${k < i ? ' past' : ''}`} onClick={() => setI(k)}>
            <span className="tr-node" />
            <span className="tr-t">{x.title}</span>
          </button>
        ))}
      </div>

      <div className="sheet" aria-label="Workpaper R-2: revenue catch-up">
        <div className="sheet-hd">
          <div><b>Oakland deployment · revenue catch-up</b><span>Cost-to-cost, ASC 606 over time · September close</span></div>
          <div className="sheet-ref"><span>W/P</span>R-2</div>
        </div>
        <div className="sheet-meta"><span>Prepared by {AGENT}</span><span>Reviewed by Dana</span><span className="num">USD</span></div>
        <div className="sheet-rows">
          {ROWS.map((r) => (
            <div key={r.id} className={`ws-row${on(r.id) ? ' is-hot' : ''}${r.total ? ' total' : ''}${r.id === 'adj' ? ' grand' : ''}`}>
              <span className="ws-l">{r.label}{r.note && <sup>{r.note}</sup>}</span>
              <span className="ws-v num">{r.value}</span>
              <Tick m={r.mark} hot={on(r.id)} />
            </div>
          ))}
          <div className="ws-sub">Journal entry</div>
          {je.map((l, k) => (
            <div key={l.account} className={`ws-row je${on(`je${k + 1}`) ? ' is-hot' : ''}`}>
              <span className="ws-l"><span className="ws-drcr">{l.debit ? 'Dr' : 'Cr'}</span><span className="ws-code num">{ACCOUNT_LABEL[l.account].code}</span>{ACCOUNT_LABEL[l.account].name}</span>
              <span className="ws-v num">{amount(l.debit || l.credit)}</span>
              <Tick m="controller" hot={on(`je${k + 1}`)} />
            </div>
          ))}
          <div className={`ws-row stamp-row${on('post') ? ' is-hot' : ''}`}>
            <span className="ws-l"><span className="stamp">Posted · OAK-WI15-R2</span></span>
            <span className="ws-v num">1 posting</span>
            <Tick m="controller" hot={on('post')} />
          </div>
          <div className={`ws-row${on('replay') ? ' is-hot' : ''}`}>
            <span className="ws-l">Same event replayed</span>
            <span className="ws-v num">refused</span>
            <Tick m="refused" hot={on('replay')} />
          </div>
        </div>
        <ul className="legend" aria-label="Tickmark legend">
          {(Object.keys(MARKS) as Mark[]).map((m) => <li key={m}><Tick m={m} />{MARKS[m].label}</li>)}
        </ul>
      </div>

      <div className="tr-detail" id="tr-panel" role="tabpanel" aria-labelledby={`tr-tab-${i}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
            <div className="tr-count num">{i + 1} of {STEPS.length}</div>
            <h3>{s.title}</h3>
            <div className="tr-actor">{s.actor}</div>
            {s.body}
            <div className="tr-role"><b>Role in the {acct(R.adjustment)}</b>{s.role}</div>
          </motion.div>
        </AnimatePresence>
        <div className="tr-nav">
          <button type="button" className="icon-btn light" onClick={() => go(i - 1)} aria-label="Previous step"><ArrowLeft size={15} /></button>
          <button type="button" className="tr-next" onClick={() => go(i + 1)}>{i === STEPS.length - 1 ? 'Start over' : <>Next: {STEPS[i + 1].title}</>}<ArrowRight size={14} /></button>
        </div>
      </div>
    </div>
  );
}

function Tick({ m, hot }: { m: Mark; hot?: boolean }) {
  return <span className={`tk tk-${m}${hot ? ' is-hot' : ''}`} title={MARKS[m].label} aria-label={MARKS[m].label}>{MARKS[m].glyph}</span>;
}
