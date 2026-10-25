import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Convex Auth, Anonymous provider: the judge's phone gets a real session on load with no sign-in screen.
// What it protects: the mutations that move a call forward (start, answer audio, confirm, decline) require a session,
// and the confirmed answer records the session's user id, so the evidence Summo acts on is bound to a session, not a typed name.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({ providers: [Anonymous] });

export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("unauthenticated: sign in (anonymous) before answering a call");
  return userId;
}
