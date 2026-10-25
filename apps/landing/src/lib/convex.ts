// Convex client for presence, the call and storage URLs (docs/frontend-guide.md §5 Convex tables).
import { ConvexClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api';
export { api };

export const CONVEX_URL = import.meta.env.VITE_CONVEX_URL ?? 'https://hushed-shrimp-24.convex.cloud';
export const convex = new ConvexClient(CONVEX_URL);

// Convex Auth, Anonymous provider: one session per phone, no sign-in screen. The call mutations require it.
// ponytail: token kept for the tab's life (1 h default expiry covers a judging slot); refresh = sign in again
let session: { token: string; refreshToken: string } | null = null;
try { session = JSON.parse(sessionStorage.getItem('keel-session') ?? 'null'); } catch { session = null; }
async function freshToken(): Promise<string> {
  const r = (await convex.action(api.auth.signIn, { provider: 'anonymous' })) as { tokens?: { token: string; refreshToken: string } };
  if (!r.tokens) throw new Error('anonymous sign-in returned no tokens');
  session = r.tokens; try { sessionStorage.setItem('keel-session', JSON.stringify(session)); } catch {}
  return session.token;
}
/** Short id of the current auth session (JWT `sub` = userId|sessionId), for display only. */
export function sessionId(): string | null {
  try { return session ? (JSON.parse(atob(session.token.split('.')[1])).sub as string).split('|')[1]?.slice(-6) ?? null : null; } catch { return null; }
}
export type AuthState = 'none' | 'ok' | 'failed';
let authState: AuthState = 'none';
export const getAuthState = () => authState;
let authSet = false, inflight: Promise<void> | null = null;
const SIGN_IN_MS = 4000;
const tokenFetcher = async ({ forceRefreshToken }: { forceRefreshToken: boolean }): Promise<string | null> => {
  try { return forceRefreshToken || !session ? await freshToken() : session.token; }
  catch { authState = 'failed'; return null; } // null = unauthenticated, never throws
};
/** Settles within 4 s and never rejects. Sign in FIRST; setAuth only on success, since setAuth holds every request behind its handshake. */
export function signInAnonymously(): Promise<void> {
  if (authState === 'ok') return Promise.resolve();
  return (inflight ??= (async () => {
    try {
      let timer: ReturnType<typeof setTimeout>;
      const t = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('sign-in timeout')), SIGN_IN_MS); });
      try { await Promise.race([freshToken(), t]); } finally { clearTimeout(timer!); }
      if (!authSet) { authSet = true; convex.setAuth(tokenFetcher); }
      authState = 'ok';
    } catch (e) {
      console.warn('convex sign-in failed', e);
      authState = 'failed';
    } finally { inflight = null; }
  })());
}
