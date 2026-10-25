# Hackathon log

- **Project:** RoboAudit (agent: Summo)
- **Event:** Cal Hacks 13.0
- **What it does:** Reads robotics project-close evidence, asks the deployment manager one clarifying question by voice, recomputes revenue, and proposes an adjusting entry that a controller approves and posts.
- **Live app:** https://www.robaudit.us
- **Repo:** https://github.com/Jagga-tech/robaudit
- **Frontend:** Other (Azure Static Web Apps, Vite MPA in `apps/landing`)
- **Convex deployment:** https://hushed-shrimp-24.convex.cloud
- **Components:** `@convex-dev/action-retrier` (`app.use(actionRetrier)` in `convex/convex.config.ts`), wrapping both Cartesia actions
- **Convex features:** schema, indexes, queries, mutations, internal queries/mutations, actions, scheduled functions (via the action-retrier component), HTTP actions (Convex Auth routes in `convex/http.ts`), file storage, realtime subscriptions via `ConvexClient.onUpdate`
- **Auth:** Convex Auth, Anonymous provider (`convex/auth.ts`); the call mutations require a session and `confirm` records `speakerUserId`
- **AI models:** `claude-opus-5-5`, `gemini-3.5-flash-lite`, Cartesia `sonic-3` (TTS) and `ink-2` (STT)
- **Started:** 2026-10-25T03:22:47Z
- **Last updated:** 2026-10-25T11:15:00Z

## How we use Convex

Convex runs the voice clarification call between the agent and the manager's phone. It never touches money; the ledger is SpacetimeDB.

- **The call.** A `clarifications` row moves through `ringing`, `answering`, `confirmed`, `unconfirmed`, `fallback_text` (union in `convex/schema.ts`, index `by_workItem`). Only the mutations in `convex/clarifications.ts` (`ask`, `startAnswer`, `confirm`, `decline`, `fallbackText`, `resetOpen`) move it.
- **Spoken question.** `ask` runs the action `voice.speakQuestion` (`convex/voice.ts`) through the action-retrier component (3 tries, backoff), which calls Cartesia Sonic and saves the audio with `ctx.storage.store`; the phone plays it via the `audioUrl` query.
- **Transcribed answer.** The phone uploads a recording through `generateUploadUrl`; `submitAnswerAudio` (session required) runs `voice.transcribe` through the retrier, which streams the stored blob to Cartesia Ink and writes `transcriptSegments` rows (internal mutation `addSegment`, index `by_clarification`).
- **Judge presence and session.** `managers.join` / `leave` / `current` in `convex/managers.ts` let the judge join from their phone; the page signs in anonymously (`apps/landing/src/lib/convex.ts`), so `confirm` and `decline` are bound to a session, not a typed name.
- **Live without refresh.** The phone page (`apps/landing/src/phone.ts`) subscribes to `clarifications.active`, `transcript.byClarification` and `managers.current`; the landing and workbench pages subscribe to `managers.current`; the dev harness (`apps/harness/src/main.ts`) subscribes to the same.
- **Agent bridge.** `apps/agent/src/bridge.ts` opens calls with `ask` and polls `byWorkItem` to carry confirmed answers into the ledger. Tests: `convex/test` (`pnpm test:convex`).

## Log

- 2026-10-25 03:22Z `be70e37` Initial commit.
- 03:57Z `45970c1` Claude extraction, explanation, convention learning (`apps/agent/src`).
- 03:57Z `286d663` Cost-to-cost engine with answer-key tests (`packages/engine`).
- 03:58Z `e3e3604` Convex clarification channel with Cartesia actions (`convex/schema.ts`, `clarifications.ts`, `voice.ts`, `transcript.ts`).
- 04:46Z `9e11220` Idempotency, decline guard, `resetOpen` (`convex/clarifications.ts`).
- 04:46Z `253f95a` `audioUrl` query for playback (`convex/clarifications.ts`).
- 06:30Z `7eb46a1` Manager presence (`convex/managers.ts`), phone-photo OCR test.
- 08:36Z `7f16dee` Web app: landing, live workbench, judge phone page (`apps/landing`).
- 11:15Z action-retrier component and Convex Auth (anonymous) (`convex/convex.config.ts`, `convex/auth.ts`, `convex/clarifications.ts`).
