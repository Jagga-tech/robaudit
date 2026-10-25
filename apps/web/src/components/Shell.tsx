import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronDown, ExternalLink, Folder, Home, Plug, RotateCcw, Scale, Search, ShieldCheck, Smartphone, User,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { setPreferredMode, useKeel } from '../data/KeelProvider';
import { ROLE_NAMES, ROLE_TITLES, type Role } from '../data/model';
import { Logo, useToast, useUi } from './ui';

const CASE_PATH = '/exceptions/oakland-forecast';

function useCounts() {
  const { snapshot, view } = useKeel();
  const needsJudgment = ['awaiting_clarification', 'unconfirmed', 'proposed', 'returned', 'held'].includes(view.stage) ? 1 : 0;
  const approvals = snapshot.proposals.filter((p) => p.status === 'open').length;
  return { needsJudgment, approvals };
}

export function Sidebar() {
  const { needsJudgment, approvals } = useCounts();
  const { role } = useKeel();
  const item = (to: string, icon: ReactNode, label: string, ct?: ReactNode, end?: boolean) => (
    <NavLink to={to} end={end} className={({ isActive }) => `nav${isActive ? ' on' : ''}`}>{icon}{label}{ct}</NavLink>
  );
  return (
    <aside className="side" aria-label="Primary">
      <div className="brand"><Logo /><b>Keel</b></div>
      <div className="org"><div className="av">AR</div><div className="t"><div>Aster Robotics</div><div>Project accounting · FY26</div></div><ChevronDown size={14} color="#7F8AA0" /></div>
      <div className="navlabel">Close</div>
      {item('/', <Home />, 'Command center', undefined, true)}
      {item(CASE_PATH, <AlertTriangle />, 'Exceptions', <span className={`ct${needsJudgment ? ' amber' : ''}`}>{needsJudgment}</span>)}
      {item('/approvals', <CheckCircle2 />, 'Approvals', <span className="ct">{approvals}</span>)}
      {item('/ledger', <BookOpen />, 'Journal entries')}
      <div className="navlabel">Projects</div>
      {item('/projects', <Folder />, 'Oakland deployment')}
      <div className="navlabel">Controls</div>
      {item('/audit', <ShieldCheck />, 'Evidence & audit')}
      {item('/policies', <Scale />, 'Policies & conventions')}
      <div className="nav" aria-disabled style={{ opacity: 0.45 }}><Plug />Integrations</div>
      <div className="grow" />
      <AgentCard />
      <div className="me"><div className="av">{ROLE_NAMES[role][0]}{role === 'controller' ? 'O' : 'R'}</div><div className="t"><div>{ROLE_NAMES[role]}</div><div>{ROLE_TITLES[role]}</div></div></div>
    </aside>
  );
}

function AgentCard() {
  const { backend, snapshot } = useKeel();
  return (
    <div className="agentcard">
      <div className="r"><span className="pulse" />{snapshot.agentBusy ? 'Keel is reading…' : 'Keel agent active'}</div>
      <p>{backend.mode === 'live' ? 'Connected to the SpacetimeDB ledger and Convex.' : 'Offline demo mode: scripted agent, real engine arithmetic.'}</p>
    </div>
  );
}

export function Rail() {
  const { needsJudgment } = useCounts();
  const link = (to: string, icon: ReactNode, label: string, badge = false, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => `ri${isActive ? ' on' : ''}`} aria-label={label} title={label}>{icon}{badge && <span className="badge" />}</NavLink>
  );
  return (
    <aside className="rail" aria-label="Primary">
      <NavLink to="/" aria-label="Keel home" style={{ margin: '4px 0 18px' }}><Logo /></NavLink>
      {link('/', <Home />, 'Command center', false, true)}
      {link(CASE_PATH, <AlertTriangle />, 'Exceptions', needsJudgment > 0)}
      {link('/approvals', <CheckCircle2 />, 'Approvals')}
      {link('/ledger', <BookOpen />, 'Journal entries')}
      {link('/audit', <ShieldCheck />, 'Evidence & audit')}
      {link('/policies', <Scale />, 'Policies & conventions')}
      <div style={{ flex: 1 }} />
      <span className="pulse" style={{ marginBottom: 16 }} />
    </aside>
  );
}

export function TopBar({ crumbs }: { crumbs: ReactNode[] }) {
  return (
    <div className="top">
      <nav className="crumb" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={i} className="row" style={{ gap: 8 }}>{i > 0 && <span className="sep">/</span>}{i === crumbs.length - 1 ? <b>{c}</b> : c}</span>
        ))}
      </nav>
      <div className="sp" />
      <div className="search hide-sm" role="search"><Search size={14} />Search projects, entries, sources<span className="kbd">⌘K</span></div>
      <RoleSwitch />
      <ModeMenu />
    </div>
  );
}

function RoleSwitch() {
  const { backend, role } = useKeel();
  const roles: Role[] = ['accountant', 'controller'];
  return (
    <div className="seg-ctl" role="group" aria-label="Acting as">
      {roles.map((r) => (
        <button key={r} aria-pressed={role === r} onClick={() => backend.setRole(r)} title={`${ROLE_NAMES[r]} · ${ROLE_TITLES[r]}`}>
          <span className="row" style={{ gap: 6 }}><User size={12} />{ROLE_NAMES[r]}<span className="hide-sm faint">· {r === 'controller' ? 'Controller' : 'Accountant'}</span></span>
        </button>
      ))}
    </div>
  );
}

function ModeMenu() {
  const { backend, bootNote } = useKeel();
  const { setPhoneOpen } = useUi();
  const toast = useToast();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bootNote) toast({ tone: 'warn', title: 'Offline demo mode', body: bootNote });
  }, [bootNote, toast]);
  useEffect(() => {
    const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', f); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k); };
  }, []);
  const reset = async () => {
    setOpen(false);
    const r = await backend.reset();
    if (r.ok) { toast({ tone: 'ok', title: 'Demo reset', body: 'Ledger restored to the September close (S0).' }); nav('/'); }
    else toast({ tone: 'err', title: 'Reset failed', body: r.message });
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className={`mode ${backend.mode}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="dot" style={{ background: backend.mode === 'live' ? 'var(--teal-600)' : '#22B8A0' }} />
        {backend.mode === 'live' ? 'Live ledger' : 'Demo data'}<ChevronDown size={13} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" className="glass menu" initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.16 }}>
            <button role="menuitem" onClick={reset}><RotateCcw /><span>Reset demo<small>Restore S0: September close, nothing open</small></span></button>
            <button role="menuitem" onClick={() => { setOpen(false); setPhoneOpen(true); }}><Smartphone /><span>Open manager phone<small>Matt’s clarification screen, beside this view</small></span></button>
            <a role="menuitem" href="/m" target="_blank" rel="noreferrer"><ExternalLink /><span>Phone view in new tab<small>/m · syncs with this tab</small></span></a>
            <div className="sep" />
            <button role="menuitem" onClick={() => setPreferredMode(backend.mode === 'live' ? 'demo' : 'live')}>
              <Plug /><span>{backend.mode === 'live' ? 'Switch to offline demo' : 'Try live ledger'}<small>{backend.mode === 'live' ? 'Scripted agent, local state' : 'SpacetimeDB ws://127.0.0.1:3000 + Convex'}</small></span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
