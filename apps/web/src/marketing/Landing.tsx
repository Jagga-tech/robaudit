/*
Direction: Resend's discipline (black field, serif display with a soft gradient fill, light sans titles,
hairline cards lit from the top edge, long quiet spacing) with Slash's financial confidence (spotlit
product object, big numerals, bold-lead captions, centered serif statements). The hero object asks the
question; the stage below answers it. Color appears only where it means something: amber for open
judgment, teal for verified, coral for a negative adjustment.
*/
import { MotionConfig, motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowRight, ArrowUpRight, Smartphone } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { pct, usd } from '../lib/format';
import { HeroFork } from './HeroFork';
import { HeroObject } from './HeroObject';
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
          <Stage />
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

function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M3 12h4c2.8 0 2.8-5 5.6-5H19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 12c2.8 0 2.8 5 5.6 5H19" fill="none" stroke="currentColor" strokeOpacity=".38" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="7" r="2.2" fill="#45DDBB" />
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
          <a href="#how">How it works</a>
          <a href="#product">Product</a>
          <a href="#trace">Trace the dollar</a>
          <a href="#controls">Controls</a>
        </nav>
        <div className="nav-r">
          <Link to="/m" className="nav-text">Manager phone</Link>
          <Link to={DEMO} className="btn-lp btn-light btn-sm">Launch demo</Link>
        </div>
      </div>
    </header>
  );
}

const up = (d: number) => ({ initial: { opacity: 0, y: 18, filter: 'blur(10px)' }, animate: { opacity: 1, y: 0, filter: 'blur(0px)' }, transition: { duration: 1, ease, delay: d } });

function Hero() {
  return (
    <section className="lp-hero" id="top">
      <div className="beam" aria-hidden />
      <div className="hero-glow" aria-hidden />
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <motion.a href="#demo" className="lp-pill" {...up(0.05)}>Built at Cal Hacks 13.0<span className="pill-sep" />See the 3-minute demo<ArrowRight size={13} /></motion.a>
          <motion.h1 className="serif gt" {...up(0.15)}>Every dollar<br />has a <em>story.</em></motion.h1>
          <motion.p className="hero-p" {...up(0.3)}>
            {BRAND} turns ambiguous field updates into verified, audit-ready revenue decisions. {AGENT} reads the evidence, computes every reading with a tested engine,
            and asks before anything posts. Your controller signs.
          </motion.p>
          <motion.div className="cta-row" {...up(0.42)}>
            <Link to={DEMO} className="btn-lp btn-light">Launch interactive demo<ArrowRight size={15} /></Link>
            <a href="#how" className="btn-lp btn-glass">See how it works<ArrowDown size={15} /></a>
          </motion.div>
        </div>
        <motion.div className="hero-obj" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.4, ease, delay: 0.2 }}>
          <HeroObject />
        </motion.div>
      </div>
    </section>
  );
}

function Head({ title, children, center }: { title: ReactNode; children?: ReactNode; center?: boolean }) {
  return (
    <motion.div className={`head${center ? ' center' : ''}`} initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }} whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.9, ease }}>
      <h2 className={center ? 'serif gt display' : 'gt'}>{title}</h2>
      {children && <div className="head-p">{children}</div>}
    </motion.div>
  );
}

function Stage() {
  return (
    <section className="stage" id="how">
      <div className="wrap">
        <Head title={<>{AGENT} doesn’t guess.<br />It asks.</>}>
          <p>Watch the same message resolve: two readings computed, posting held, one question to the person who knows, then a balanced entry for the controller. Answer as Matt to take either branch.</p>
        </Head>
        <motion.div className="stage-frame" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }} transition={{ duration: 1, ease }}>
          <HeroFork />
        </motion.div>
        <p className="fine">Figures come from the demo ledger ({COMPANY}, {PROJECT}) through the same engine the app uses.</p>
      </div>
    </section>
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
        <motion.div className="bignum" initial={{ opacity: 0, y: 20, filter: 'blur(12px)' }} whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 1.1, ease }}>
          <span className="bignum-k">The cost of one ambiguous word</span>
          <span className="bignum-v serif gt">{dollars(SWING)}</span>
          <span className="bignum-p">That is the gap in reported revenue between the two readings of Matt’s message. Same project, same costs to date, same contract.</span>
        </motion.div>

        <div className="bars" role="table" aria-label="Cost-to-cost under each reading">
          <div className="bars-hd" role="row">
            <span role="columnheader">Estimate</span>
            <span role="columnheader">Cost incurred + remaining, against the {dollars(BEFORE.contractValue)} contract</span>
            <span role="columnheader" className="cell-r">Progress</span>
            <span role="columnheader" className="cell-r">Revenue</span>
            <span role="columnheader" className="cell-r">Adjustment</span>
          </div>
          {rows.map((r, i) => (
            <div className={`bar-row t-${r.tone}`} role="row" key={r.k}>
              <span role="cell" className="bar-k"><b>{r.k}</b><span>{r.sub}</span></span>
              <span role="cell" className="bar-track">
                <span className="cv-line" style={{ left: w(BEFORE.contractValue) }} aria-hidden />
                <motion.span className="b-inc" style={{ width: w(BEFORE.incurred) }} initial={reduce ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 0.8, ease, delay: i * 0.15 }} />
                <motion.span className="b-rem" style={{ left: w(BEFORE.incurred), width: w(r.rem) }} initial={reduce ? false : { scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 0.9, ease, delay: 0.4 + i * 0.15 }} />
                <span className="b-total num" style={{ left: w(r.total) }}>{dollars(r.total)}</span>
              </span>
              <span role="cell" className="cell-r num" data-l="Progress">{pct(r.prog)}</span>
              <span role="cell" className="cell-r num" data-l="Revenue">{dollars(r.rev)}</span>
              <span role="cell" data-l="Adjustment" className={`cell-r num ${r.adj == null ? 'is-dim' : r.adj < 0n ? 'neg' : 'pos'}`}>{r.adj == null ? '—' : usd(r.adj, { cents: false, sign: true })}</span>
            </div>
          ))}
          <div className="bars-foot"><span className="cv-key" />Contract value<span className="sw-key sw-inc" />Incurred<span className="sw-key sw-rem" />Remaining estimate</div>
        </div>

        <div className="versus">
          <div className="vs-old">
            <h3>How it usually goes</h3>
            <p><b>Someone guesses and posts.</b> The number moves, and the reason lives in one person’s head.</p>
            <p><b>Or the close waits.</b> An email thread decides when revenue is final.</p>
            <p><b>Then the auditor asks.</b> The evidence is in an inbox, if anywhere.</p>
          </div>
          <div className="vs-new">
            <h3>What {BRAND} does</h3>
            <p className="serif">Computes both readings, holds the posting, asks the one person who knows, and routes a balanced entry to the controller, with every step’s evidence attached.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Shot({ src, alt, w, h, className = '' }: { src: string; alt: string; w: number; h: number; className?: string }) {
  return (
    <motion.div className={`shot ${className}`} initial={{ clipPath: 'inset(8% 6% 0% 6% round 14px)', opacity: 0.4 }} whileInView={{ clipPath: 'inset(0% 0% 0% 0% round 14px)', opacity: 1 }} viewport={{ once: true, amount: 0.25 }} transition={{ duration: 1.1, ease }}>
      <img src={src} alt={alt} width={w} height={h} loading="lazy" decoding="async" />
    </motion.div>
  );
}

function Card({ children, lead, body, className = '' }: { children: ReactNode; lead: string; body: ReactNode; className?: string }) {
  return (
    <figure className={`lp-card ${className}`}>
      <div className="card-media">{children}</div>
      <figcaption><b>{lead}</b> {body}</figcaption>
    </figure>
  );
}

function Product() {
  const A = READINGS.additional;
  return (
    <section className="product" id="product">
      <div className="wrap">
        <Head title={<>Built like a close,<br />not a chat window.</>}>
          <p>Sources are versioned, both readings are computed, and the open question goes to the person who can answer it. These are screenshots of the working demo.</p>
        </Head>
        <figure className="lp-card wide">
          <div className="card-media"><Shot src="/landing/investigation.webp" alt="Investigation screen: the field update, two computed readings with opposite adjustments, and posting blocked while the manager is asked" w={2880} h={1580} /></div>
          <figcaption><b>The investigation.</b> The exact phrase is flagged, both readings sit side by side with the engine’s numbers, and posting is blocked until Matt answers.</figcaption>
        </figure>
        <div className="cards">
          <div className="cards-col">
            <Card lead="Forecast Bridge." body={<>{dollars(PRIOR.estTotal)} of total cost becomes {dollars(A.estTotal)}, so progress moves from {pct(PRIOR.progressBp)} to {pct(A.progressBp)}. Every figure shows its formula and source.</>}>
              <Shot src="/landing/bridge.webp" alt="Forecast Bridge: prior and revised estimates, then total cost, progress, cumulative revenue and the adjustment, each with its formula" w={1360} h={853} />
            </Card>
            <Card lead="One entry, posted once." body={<>Balanced, approved by the controller, and written to the ledger with its posting reference.</>}>
              <Shot src="/landing/entry.webp" alt="Posted journal entry: debit project revenue 100,000, credit contract asset 100,000, balanced and posted" w={1360} h={427} />
            </Card>
          </div>
          <Card lead="The manager’s phone." body={<>Three answers, including “I’m not sure”, which holds the forecast instead of guessing. The answer is stored as evidence.</>} className="tall">
            <Shot src="/landing/phone.webp" alt="Deployment manager's phone: the clarification question with three answers and what the chosen answer confirms" w={918} h={1748} />
          </Card>
        </div>
        <Card lead="Replays are refused." body={<>Sending the posted event to the ledger again returns <code>duplicate_posting</code>. The adjustment exists exactly once, with its evidence attached.</>} className="split">
          <Shot src="/landing/duplicate.webp" alt="Audit screen: the same event was replayed, duplicate_posting refused it, and the ledger still shows one posting" w={840} h={624} />
        </Card>
      </div>
    </section>
  );
}

function Trace() {
  return (
    <section className="tracesec" id="trace">
      <div className="spot" aria-hidden />
      <div className="wrap">
        <Head center title={<>Trace the <em>dollar.</em></>}>
          <p>Pick any step to see the figures it touches on the workpaper and what it contributes to the {usd(READINGS.additional.adjustment, { cents: false })} adjustment. Tickmarks show how each figure was verified.</p>
        </Head>
        <TraceDollar />
      </div>
    </section>
  );
}

const CONTROLS: { c: string; prevents: string; how: string }[] = [
  { c: 'Deterministic engine', prevents: 'A model inventing a figure', how: 'Revenue comes from @keel/engine, tested cost-to-cost arithmetic in integer cents.' },
  { c: 'Clarification gate', prevents: 'Silent guesses on ambiguous wording', how: 'No entry is proposed until the owner answers. “I’m not sure” holds the forecast.' },
  { c: 'Role check', prevents: 'Self-approval', how: 'Only the controller role can approve and post. The agent can only propose.' },
  { c: 'Revision and stale checks', prevents: 'Approving numbers that new evidence changed', how: 'Approval names a revision. A newer source marks the open proposal stale.' },
  { c: 'Balanced entry', prevents: 'One-sided postings', how: 'Debits must equal credits before the ledger accepts the entry.' },
  { c: 'Duplicate-posting guard', prevents: 'Double counting from a replayed event', how: 'Posting references are unique. A replay is refused and logged.' },
];

function Controls() {
  return (
    <section className="controls" id="controls">
      <div className="wrap">
        <motion.p className="statement serif gt" initial={{ opacity: 0, y: 16, filter: 'blur(10px)' }} whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 1.1, ease }}>
          The model writes the words. <em>The engine writes the numbers.</em> A controller signs.
        </motion.p>
        <p className="statement-sub">Each control is enforced in code, in the live stack and in the offline demo.</p>
        <div className="matrix" role="table" aria-label="Controls">
          <div className="mx-row mx-hd" role="row"><span role="columnheader">Control</span><span role="columnheader">Prevents</span><span role="columnheader">How it is enforced</span></div>
          {CONTROLS.map((x, i) => (
            <motion.div className="mx-row" role="row" key={x.c} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.8 }} transition={{ duration: 0.6, ease, delay: i * 0.05 }}>
              <span role="rowheader" className="mx-c">{x.c}</span>
              <span role="cell" className="mx-p">{x.prevents}</span>
              <span role="cell" className="mx-h">{x.how}</span>
            </motion.div>
          ))}
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
      <div className="closing-glow" aria-hidden />
      <div className="wrap">
        <h2 className="serif gt display">Watch one sentence become an <em>audit-ready</em> entry.</h2>
        <p className="closing-p">The demo runs the whole close: the ledger, the engine, the manager’s phone and the controller. With no backend running, it works entirely in your browser.</p>
        <div className="cta-row center">
          <Link to={DEMO} className="btn-lp btn-light btn-lg">Launch interactive demo<ArrowRight size={16} /></Link>
          <Link to="/m" className="btn-lp btn-glass btn-lg"><Smartphone size={15} />Open the manager’s phone</Link>
        </div>
        <ol className="demo-path" aria-label="Three-minute demo path">
          {PATH.map((p, i) => <li key={p}><span className="dp-n num">{String(i + 1).padStart(2, '0')}</span>{p}</li>)}
        </ol>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-brand">
            <a href="#top" className="wordmark wm-sm"><Mark size={20} />{BRAND}</a>
            <p>Evidence-first revenue decisions for fixed-price robotics deployments. Built at Cal Hacks 13.0.</p>
          </div>
          <nav className="foot-col" aria-label="Page">
            <h4>Page</h4>
            <a href="#how">How it works</a>
            <a href="#product">Product</a>
            <a href="#trace">Trace the dollar</a>
            <a href="#controls">Controls</a>
          </nav>
          <nav className="foot-col" aria-label="Demo">
            <h4>Demo</h4>
            <Link to={DEMO}>Command center<ArrowUpRight size={12} /></Link>
            <Link to="/m">Manager phone<ArrowUpRight size={12} /></Link>
            <Link to="/audit">Evidence trail<ArrowUpRight size={12} /></Link>
          </nav>
          <div className="foot-col">
            <h4>Under the hood</h4>
            <span>Agent: {AGENT}</span>
            <span>Arithmetic: @keel/engine</span>
            <span>{COMPANY} is demo data</span>
          </div>
        </div>
      </div>
      <div className="foot-mark serif" aria-hidden>{BRAND}</div>
    </footer>
  );
}
