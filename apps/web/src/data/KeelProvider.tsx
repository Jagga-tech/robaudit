import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DemoBackend } from './demoBackend';
import { LiveBackend } from './liveBackend';
import type { KeelBackend } from './model';
import { caseView } from './select';

const MODE_KEY = 'keel-mode';
type Boot = { backend: KeelBackend; note: string | null };

/** Live when the ledger answers within a short timeout; otherwise the clearly labeled offline demo backend. */
let booting: Promise<Boot> | null = null;
const boot = () => (booting ??= bootOnce());

async function bootOnce(): Promise<Boot> {
  const forced = new URLSearchParams(location.search).get('mode') ?? localStorage.getItem(MODE_KEY);
  if (forced === 'demo') return { backend: new DemoBackend(), note: null };
  const live = new LiveBackend();
  try {
    await live.connect();
    return { backend: live, note: null };
  } catch (e) {
    return { backend: new DemoBackend(), note: forced === 'live' ? `Live ledger unavailable (${(e as Error).message}). Using offline demo.` : null };
  }
}

export function setPreferredMode(mode: 'live' | 'demo' | null) {
  if (mode) localStorage.setItem(MODE_KEY, mode); else localStorage.removeItem(MODE_KEY);
  location.reload();
}

const Ctx = createContext<Boot | null>(null);

export function KeelProvider({ children, backend }: { children: ReactNode; backend?: KeelBackend }) {
  const [b, setB] = useState<Boot | null>(backend ? { backend, note: null } : null);
  useEffect(() => { if (!backend) boot().then(setB); }, [backend]);
  if (!b) return <BootScreen />;
  return <Ctx.Provider value={b}>{children}</Ctx.Provider>;
}

function BootScreen() {
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="logo lg"><img src="/keel.svg" alt="" width={36} height={36} /></div>
      <div className="muted">Connecting to the ledger…</div>
    </div>
  );
}

export function useKeel() {
  const b = useContext(Ctx);
  if (!b) throw new Error('useKeel outside KeelProvider');
  const { backend } = b;
  const snapshot = useSyncExternalStore(backend.subscribe, backend.getSnapshot);
  const role = useSyncExternalStore(backend.subscribe, backend.role);
  const view = useMemo(() => caseView(snapshot), [snapshot]);
  return { backend, snapshot, view, role, bootNote: b.note };
}
