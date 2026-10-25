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
/** Resolves once the client carries a session. Safe to call more than once. */
export function signInAnonymously(): Promise<void> {
  return new Promise((resolve) => {
    convex.setAuth(async ({ forceRefreshToken }) => (forceRefreshToken || !session ? freshToken() : session.token), (ok) => { if (ok) resolve(); });
  });
}
