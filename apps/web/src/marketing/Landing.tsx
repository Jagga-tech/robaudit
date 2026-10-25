/*
THESIS: An accounting decision you can watch being made. The page refuses the category default
(dashboard screenshot + feature-card grid) and instead stages one real sentence forking into two
ledgers, then resolving through a question, a deterministic calculation and a controller's signature.
OWN-WORLD: Night desk and workpaper. Deep ink ground with faint columnar-pad ruling; cobalt for the
agent, amber for open judgment, teal for verified, coral for negative. Warm sand sheets carry the real
product and an auditor's workpaper with tickmarks. Geist for words, Geist Mono only for money.
STORY: A controller sees the sentence, sees the $266,667 swing, sees nothing posts until a person
answers and a controller signs, then opens the working demo.
FIRST VIEWPORT: Left-aligned two-line headline, positioning and CTAs on its right baseline; below,
the full-width fork stage already playing.
FORM: Brief-pinned direction (dark, cinematic, restrained glass); no concept roll.
*/
import { MotionConfig, motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { ArrowRight, ArrowUpRight, Smartphone } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { pct, usd } from '../lib/format';
import { HeroFork } from './HeroFork';
import { AGENT, BEFORE, BRAND, COMPANY, PRIOR, PROJECT, READINGS, SWING } from './scenario';
import { TraceDollar } from './TraceDollar';
import './landing.css';

const ease = [0.16, 1, 0.3, 1] as const;
const dollars = (c: bigint) => usd(c, { cents: false });
const DEMO = '/';

export default function Landing() {
  useEffect(() => {
    const prev = document.title;
    document.title = `${BRAND} · Every dollar has a story`;
    document.documentElement.classList.add('lp-root');
    // Leaving for the app: start it at the top rather than at this page's scroll offset.
    return () => { document.title = prev; document.documentElement.classList.remove('lp-root'); window.scrollTo(0, 0); };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="lp">
        <Nav />
        <main>
          <Hero />
          <Problem />
          <Product />
          <Trace />
          <Controls />
          <Closing />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}

function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <defs>
        <linearGradient id="mk-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6E86FF" /><stop offset="1" stopColor="#3048E0" /></linearGradient>
      </defs>
      <rect width="28" height="28" rx="8" fill="url(#mk-bg)" />
      <path d="M6 14h4.5c3.2 0 3.2-5.5 6.4-5.5H22" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M10.5 14c3.2 0 3.2 5.5 6.4 5.5H22" fill="none" stroke="#fff" strokeOpacity=".42" strokeWidth="2.1" strokeLinecap="round" strokeDasharray="0.1 3.6" />
      <circle cx="22" cy="8.5" r="2.1" fill="#7FF0D8" />
    </svg>
  );
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 8);
    f(); window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  return (
    <header className={`lp-nav${scrolled ? ' scrolled' : ''}`}>
      <div className="wrap nav-in">
        <a href="#top" className="wordmark" aria-label={`${BRAND} home`}><Mark />{BRAND}</a>
        <nav aria-label="Sections" className="nav-links">
          <a href="#problem">Problem</a>
          <a href="#product">Product</a>
          <a href="#trace">Trace the dollar</a>
          <a href="#controls">Controls</a>
        </nav>
        <Link to={DEMO} className="btn-lp btn-primary btn-sm">Launch demo<ArrowRight size={14} /></Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="lp-hero" id="top">
      <div className="hero-light" aria-hidden />
      <div className="ruling" aria-hidden />
      <div className="wrap">
        <div className="hero-head">
          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease }}>
            Every dollar<br />has a story.
          </motion.h1>
          <motion.div className="hero-side" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease, delay: 0.12 }}>
            <p className="lede">
              <b>{BRAND} shows you the evidence.</b> {AGENT}, our accounting agent, reads field updates, catches the sentences that could move revenue,
              computes every reading with a tested engine, and asks before anything posts. Your controller signs.
            </p>
            <div className="cta-row">
              <Link to={DEMO} className="btn-lp btn-primary">Launch interactive demo<ArrowRight size={15} /></Link>
              <a href="#trace" className="btn-lp btn-ghost">See how it works</a>
            </div>
          </motion.div>
        </div>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease, delay: 0.2 }}>
          <HeroFork />
        </motion.div>
        <p className="hero-foot">For fixed-price robotics deployments recognized over time, cost-to-cost. Figures come from the demo ledger ({COMPANY}, {PROJECT}).</p>
      </div>
    </section>
  );
}

function SplitHead({ title, children, tone = 'dark' }: { title: ReactNode; children: ReactNode; tone?: 'dark' | 'light' }) {
  return (
    <div className={`split tone-${tone}`}>
      <h2>{title}</h2>
      <div className="split-p">{children}</div>
    </div>
  );
}

function Problem() {
  const reduce = useReducedMotion();
  const A = READINGS.additional, B = READINGS.new_total;
  const max = Number(A.estTotal > BEFORE.contractValue ? A.estTotal : BEFORE.contractValue) * 1.25;
  const w = (c: bigint) => `${(Number(c) / max) * 100}%`;
  const rows = [
    { k: 'Last close', sub: 'Approved', rem: BEFORE.remaining, total: PRIOR.estTotal, prog: PRIOR.progressBp, rev: PRIOR.cumRevenue, adj: null as bigint | null, tone: 'prior' },
    { k: 'Reading A', sub: '$200K is added cost', rem: A.remaining, total: A.estTotal, prog: A.progressBp, rev: A.cumRevenue, adj: A.adjustment, tone: 'a' },
    { k: 'Reading B', sub: '$200K is the new total', rem: B.remaining, total: B.estTotal, prog: B.progressBp, rev: B.cumRevenue, adj: B.adjustment, tone: 'b' },
  ];
  return (
    <section className="problem" id="problem">
      <div className="wrap">
        <SplitHead title={<>One sentence can move reported revenue by <span className="hl-amber">{dollars(SWING)}</span>.</>}>
          <p>Over-time revenue follows the estimate of cost to complete. If a field update is ambiguous, the estimate is ambiguous, and so is the revenue you report.</p>
          <p className="muted-p">Same project, same costs to date, same contract. Only the reading of one word changes.</p>
        </SplitHead>

        <div className="bars" role="table" aria-label="Cost-to-cost under each reading">
          <div className="bars-hd" role="row">
            <span role="columnheader">Estimate</span>
            <span role="columnheader" className="bars-axis">Cost incurred + remaining, against the {dollars(BEFORE.contractValue)} contract</span>
            <span role="columnheader" className="cell-r">Progress</span>
            <span role="columnheader" className="cell-r">Revenue</span>
            <span role="columnheader" className="cell-r">Adjustment</span>
          </div>
          {rows.map((r, i) => (
            <div className={`bar-row t-${r.tone}`} role="row" key={r.k}>
              <span role="cell" className="bar-k"><b>{r.k}</b><span>{r.sub}</span></span>
              <span role="cell" className="bar-track">
                <span className="cv-line" style={{ left: w(BEFORE.contractValue) }} aria-hidden />
                <motion.span className="b-inc" style={{ width: w(BEFORE.incurred) }} initial={reduce ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 0.7, ease, delay: i * 0.15 }} />
                <motion.span className="b-rem" style={{ left: w(BEFORE.incurred), width: w(r.rem) }} initial={reduce ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 0.8, ease, delay: 0.35 + i * 0.15 }} />
                <span className="b-total num" style={{ left: w(r.total) }}>{dollars(r.total)}</span>
              </span>
              <span role="cell" className="cell-r num" data-l="Progress">{pct(r.prog)}</span>
              <span role="cell" className="cell-r num" data-l="Revenue">{dollars(r.rev)}</span>
              <span role="cell" data-l="Adjustment" className={`cell-r num ${r.adj == null ? 'is-dim' : r.adj < 0n ? 'neg' : 'pos'}`}>{r.adj == null ? '—' : usd(r.adj, { cents: false, sign: true })}</span>
            </div>
          ))}
          <div className="bars-foot"><span className="cv-key" />Contract value {dollars(BEFORE.contractValue)}<span className="sw-key sw-inc" />Incurred<span className="sw-key sw-rem" />Remaining estimate</div>
        </div>

        <div className="versus">
          <div className="vs-old">
            <h3>How it usually goes</h3>
            <ul>
              <li><b>Someone guesses and posts.</b> The number moves, and the reason lives in one person's head.</li>
              <li><b>Or the close waits.</b> An email thread decides when revenue is final.</li>
              <li><b>Then the auditor asks.</b> The evidence is in an inbox, if anywhere.</li>
            </ul>
          </div>
          <div className="vs-new">
            <h3>What {BRAND} does</h3>
            <p>Computes both readings, blocks posting, asks the one person who knows, recalculates from the answer, and routes a balanced entry to the controller. Every step keeps its evidence.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Frame({ src, alt, w, h, className = '' }: { src: string; alt: string; w: number; h: number; className?: string }) {
  return (
    <div className={`frame ${className}`}>
      <img src={src} alt={alt} width={w} height={h} loading="lazy" decoding="async" />
    </div>
  );
}

function Product() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center center'] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [14, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1]);
  const y = useTransform(scrollYProgress, [0, 1], [40, 0]);
  return (
    <section className="product sheet-sec" id="product">
      <div className="wrap">
        <SplitHead tone="light" title={<>Not a chat window.<br />An investigation.</>}>
          <p>Sources are versioned, both readings are computed, and the one open question goes to the person who can answer it. Posting stays blocked until they do.</p>
          <p className="muted-p">These are screenshots of the working demo, not mockups.</p>
        </SplitHead>
        <div className="tilt-stage" ref={ref}>
          <motion.div style={{ rotateX, scale, y }} className="tilt">
            <Frame src="/landing/investigation.webp" alt="Investigation screen: the field update, two computed readings with opposite adjustments, and posting blocked while the manager is asked" w={2880} h={1580} className="big" />
          </motion.div>
        </div>

        <div className="caps">
          <div className="cap cap-detect">
            <h3><span className="cap-dot dot-amber" />Detect uncertainty</h3>
            <p>{AGENT} flags the exact phrase, shows both readings side by side with the engine's numbers, and names the one question that would settle it.</p>
          </div>
          <div className="cap cap-calc">
            <h3><span className="cap-dot dot-ink" />Calculate with evidence</h3>
            <p>Each figure in the Forecast Bridge carries its formula and its source. The cause reads left to right: more remaining cost, lower progress, less revenue.</p>
          </div>
          <div className="cap cap-esc">
            <h3><span className="cap-dot dot-teal" />Escalate before posting</h3>
            <p>The deployment manager answers from a phone. The answer is stored as evidence, then the controller approves the entry it produced.</p>
          </div>
        </div>

        <div className="showcase">
          <div className="sc-left">
            <figure>
              <Frame src="/landing/bridge.webp" alt="Forecast Bridge: prior and revised estimates, then total cost, progress, cumulative revenue and the adjustment, each with its formula" w={1360} h={853} />
              <figcaption><b>Forecast Bridge.</b> {dollars(PRIOR.estTotal)} becomes {dollars(READINGS.additional.estTotal)} of total cost, so progress goes from {pct(PRIOR.progressBp)} to {pct(READINGS.additional.progressBp)} and revenue from {dollars(PRIOR.cumRevenue)} to {dollars(READINGS.additional.cumRevenue)}.</figcaption>
            </figure>
            <figure>
              <Frame src="/landing/entry.webp" alt="Posted journal entry: debit project revenue 100,000, credit contract asset 100,000, balanced and posted" w={1360} h={427} />
              <figcaption><b>One entry, posted once.</b> Balanced, approved by the controller, and protected against a replayed event.</figcaption>
            </figure>
          </div>
          <figure className="sc-right">
            <Frame src="/landing/phone.webp" alt="Deployment manager's phone: the clarification question with three answers and what the chosen answer confirms" w={918} h={1748} className="phone" />
            <figcaption><b>The manager's phone.</b> Three answers, including “I'm not sure”, which holds the forecast instead of guessing.</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

function Trace() {
  return (
    <section className="tracesec sheet-sec" id="trace">
      <div className="wrap">
        <SplitHead tone="light" title={<>Trace the dollar.</>}>
          <p>Pick any step and see which figures it touches on the workpaper and what it contributes to the {usd(READINGS.additional.adjustment, { cents: false })} adjustment. The tickmarks show how each figure was verified.</p>
        </SplitHead>
        <TraceDollar />
      </div>
    </section>
  );
}

const CONTROLS: { c: string; prevents: string; how: string }[] = [
  { c: 'Deterministic engine', prevents: 'A model inventing a figure', how: 'Revenue comes from @keel/engine, tested cost-to-cost arithmetic in integer cents. Summo writes words, not posted numbers.' },
  { c: 'Clarification gate', prevents: 'Silent guesses on ambiguous wording', how: 'No entry is proposed until the owner answers. “I’m not sure” holds the forecast.' },
  { c: 'Role check', prevents: 'Self-approval', how: 'Only the controller role can approve and post. The agent can only propose.' },
  { c: 'Revision and stale checks', prevents: 'Approving numbers that new evidence changed', how: 'Approval names a revision. A newer source marks the open proposal stale and it is proposed again.' },
  { c: 'Balanced entry', prevents: 'One-sided postings', how: 'Debits must equal credits before the ledger accepts the entry.' },
  { c: 'Duplicate-posting guard', prevents: 'Double counting from a replayed event', how: 'Posting references are unique. A replay is refused and logged; the ledger still holds one posting.' },
];

function Controls() {
  return (
    <section className="controls" id="controls">
      <div className="ruling ruling-faint" aria-hidden />
      <div className="wrap">
        <SplitHead title={<>Controls a controller<br />can sign.</>}>
          <p>Language, arithmetic and permission to write are kept apart. Each control is enforced in code, in the live stack and in the offline demo.</p>
        </SplitHead>
        <div className="ctl-grid">
          <table className="matrix">
            <thead><tr><th>Control</th><th>Prevents</th><th>How it is enforced</th></tr></thead>
            <tbody>
              {CONTROLS.map((x) => (
                <tr key={x.c}><th scope="row">{x.c}</th><td className="prev">{x.prevents}</td><td>{x.how}</td></tr>
              ))}
            </tbody>
          </table>
          <figure className="dup">
            <div className="frame frame-dark"><img src="/landing/duplicate.webp" alt="Audit screen: the same event was replayed, duplicate_posting refused it, and the ledger still shows one posting" width={840} height={624} loading="lazy" decoding="async" /></div>
            <figcaption>Replaying the posted event in the demo. The ledger refuses it with <code>duplicate_posting</code> and still shows one posting.</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

const PATH = [
  'Send the field update to Summo from the command center.',
  'See both readings and the posting block.',
  'Open the manager’s phone and confirm “Additional $200,000”.',
  'Watch the Forecast Bridge recalculate: 50% to 40%.',
  'Switch to Dana and approve the entry.',
  'Open the evidence trail and replay the event. It is refused.',
];

function Closing() {
  return (
    <section className="closing" id="demo">
      <div className="closing-light" aria-hidden />
      <div className="wrap">
        <h2>Watch one sentence become<br />an audit-ready entry.</h2>
        <p className="closing-p">The demo runs the whole close: the ledger, the engine, the manager's phone and the controller. With no backend running, it works entirely in your browser. About three minutes.</p>
        <div className="cta-row center">
          <Link to={DEMO} className="btn-lp btn-primary btn-lg">Launch interactive demo<ArrowRight size={16} /></Link>
          <Link to="/m" className="btn-lp btn-ghost btn-lg"><Smartphone size={15} />Open the manager's phone</Link>
        </div>
        <ol className="demo-path">
          {PATH.map((p, i) => <li key={p}><span className="dp-n num">{i + 1}</span>{p}</li>)}
        </ol>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <a href="#top" className="wordmark wm-sm"><Mark size={20} />{BRAND}</a>
        <span>Built at Cal Hacks 13.0. Agent: {AGENT}. Arithmetic: @keel/engine.</span>
        <span>{COMPANY} and the Oakland deployment are demo data.</span>
        <Link to={DEMO} className="foot-link">Open the app<ArrowUpRight size={13} /></Link>
      </div>
    </footer>
  );
}
