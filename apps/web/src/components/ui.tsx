import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Result } from '../data/model';

// ---------- actor tags: who did this? ----------
export type ActorKind = 'agent' | 'engine' | 'human' | 'humanok' | 'ctrl' | 'ledger';
const GLYPH: Record<ActorKind, string> = { agent: 'K', engine: 'ƒ', human: 'H', humanok: 'H', ctrl: 'C', ledger: 'L' };
export function Actor({ kind, children, glyph }: { kind: ActorKind; children?: ReactNode; glyph?: string }) {
  return <span className={`actor ${kind}`}><i aria-hidden>{glyph ?? GLYPH[kind]}</i>{children}</span>;
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div className="logo" style={{ width: size, height: size, borderRadius: size * 0.28 }} aria-hidden>
      <svg width={size * 0.57} height={size * 0.57} viewBox="0 0 24 24" fill="none">
        <path d="M3.5 7h17l-4.2 6.8a2 2 0 0 1-1.7.9H9.4a2 2 0 0 1-1.7-.9z" fill="#fff" />
        <rect x="10.8" y="14" width="2.4" height="6.5" rx="1.2" fill="#fff" opacity=".85" />
      </svg>
    </div>
  );
}

export const Chk = ({ size = 16 }: { size?: number }) => (
  <span className="chk" style={{ width: size, height: size }} aria-label="verified"><Check strokeWidth={3} /></span>
);
export const Wait = () => <span className="wait" aria-label="pending" />;

// ---------- animated money: tweens between ledger values, never invents them ----------
export function AnimatedNumber({ value, format, className, from, delay = 0 }: { value: number; format: (n: number) => string; className?: string; from?: number; delay?: number }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(from ?? value);
  const text = useTransform(mv, (v) => format(v));
  const first = useRef(from === undefined);
  useEffect(() => {
    if (first.current || reduce) { mv.set(value); first.current = false; return; }
    const c = animate(mv, value, { duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [value, reduce, mv, delay]);
  return <motion.span className={className}>{text}</motion.span>;
}

// ---------- toasts ----------
type Toast = { id: number; tone: 'ok' | 'warn' | 'err'; title: string; body?: string };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div key={t.id} className="glass toast" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
              <span className="ic" style={{ background: t.tone === 'ok' ? 'var(--teal-100)' : t.tone === 'warn' ? 'var(--amber-100)' : 'var(--coral-100)', color: t.tone === 'ok' ? 'var(--teal-600)' : t.tone === 'warn' ? 'var(--amber-600)' : 'var(--coral-600)' }}>
                {t.tone === 'ok' ? <Check /> : t.tone === 'warn' ? <AlertTriangle /> : <X />}
              </span>
              <div><div style={{ fontWeight: 500 }}>{t.title}</div>{t.body && <div className="small muted" style={{ marginTop: 2 }}>{t.body}</div>}</div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

/** Human copy for reducer error codes (spacetimedb/src/guards.ts). */
export function errorCopy(r: Extract<Result, { ok: false }>): string {
  const m: Record<string, string> = {
    role: 'Only the controller can approve or post. Switch role to Dana (Controller).',
    revision: 'This revision is no longer current or was already decided.',
    stale: 'New evidence arrived after this proposal. Keel will re-propose.',
    period_closed: 'The period is closed for this project.',
    unbalanced: 'Debits and credits do not balance.',
    duplicate_posting: 'This entry was already posted. No second posting was made.',
    not_approved: 'The entry must be approved before posting.',
    not_found: 'Record not found. The demo may have been reset.',
    bad_input: 'The request was rejected as invalid.',
    unavailable: 'Backend unavailable.',
  };
  return m[r.code] ?? r.message;
}

// ---------- shared UI state ----------
type UiState = { phoneOpen: boolean; setPhoneOpen: (v: boolean) => void; focusSource: bigint | null; flashSource: (id: bigint) => void };
const UiCtx = createContext<UiState | null>(null);
export function UiProvider({ children }: { children: ReactNode }) {
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [focusSource, setFocus] = useState<bigint | null>(null);
  const flashSource = useCallback((id: bigint) => {
    setFocus(id);
    requestAnimationFrame(() => document.getElementById(`src-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    setTimeout(() => setFocus(null), 1500);
  }, []);
  return <UiCtx.Provider value={{ phoneOpen, setPhoneOpen, focusSource, flashSource }}>{children}</UiCtx.Provider>;
}
export const useUi = () => { const u = useContext(UiCtx); if (!u) throw new Error('useUi outside UiProvider'); return u; };
