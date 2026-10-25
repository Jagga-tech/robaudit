import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useKeel } from '../data/KeelProvider';
import { ManagerClarify } from './ManagerClarify';
import { useUi } from './ui';

/** Renders the manager's phone beside the desktop so one laptop can run the whole demo. */
export function PhoneDrawer() {
  const { phoneOpen, setPhoneOpen } = useUi();
  const [scale, setScale] = useState(1);
  const status = useKeel().snapshot.call?.status;
  // Round-trip finding: a drawer left open after the answer hid the desktop's reaction. Close it once the answer lands.
  useEffect(() => {
    if (!phoneOpen || (status !== 'confirmed' && status !== 'unconfirmed')) return;
    const t = setTimeout(() => setPhoneOpen(false), 1800);
    return () => clearTimeout(t);
  }, [status, phoneOpen, setPhoneOpen]);
  useEffect(() => {
    const f = () => setScale(Math.min(1, (window.innerHeight - 72) / 864));
    f(); window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setPhoneOpen(false);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [setPhoneOpen]);
  return (
    <AnimatePresence>
      {phoneOpen && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPhoneOpen(false)} />
          <motion.div role="dialog" aria-modal="true" aria-label="Deployment manager phone" className="drawer glass" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}>
            <div className="row small muted" style={{ alignSelf: 'stretch', marginBottom: 14 }}><span className="over">Matt’s phone · Deployment manager</span><div style={{ flex: 1 }} /><span>Esc to close</span></div>
            <div style={{ height: 864 * scale, width: 410 * scale, display: 'flex', justifyContent: 'center' }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}>
                <ManagerClarify framed onClose={() => setPhoneOpen(false)} />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
