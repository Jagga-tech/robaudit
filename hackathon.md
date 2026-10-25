# Hackathon log

- **Project:** RoboAudit (agent: Summo)
- **Event:** Cal Hacks 13.0
- **What it does:** Reads robotics project-close evidence, asks the deployment manager one clarifying question by voice, recomputes revenue, and proposes an adjusting entry that a controller approves and posts.
- **Live app:** https://kind-river-0eb9d010f.5.azurestaticapps.net
- **Repo:** https://github.com/Jagga-tech/robaudit
- **Frontend:** Other (Azure Static Web Apps, Vite MPA in `apps/landing`)
- **Convex deployment:** https://hushed-shrimp-24.convex.cloud
- **Components:** none (no `convex/convex.config.ts`)
- **Convex features:** schema, indexes, queries, mutations, internal queries/mutations, actions, scheduled functions (`ctx.scheduler.runAfter`), file storage, realtime subscriptions via `ConvexClient.onUpdate`
- **Auth:** none
- **AI models:** `claude-opus-5-5`, `gemini-3.5-flash-lite`, Cartesia `sonic-3` (TTS) and `ink-2` (STT)
- **Started:** 2026-10-25T03:22:47Z
- **Last updated:** 2026-10-25T08:36:58Z

## How we use Convex

Convex runs the voice clarification call between the agent and the manager's phone. It never touches money; the ledger is SpacetimeDB.

- **The call.** A `clarifications` row moves through `ringing`, `answering`, `confirmed`, `unconfirmed`, `fallback_text` (union in `convex/schema.ts`, index `by_workItem`). Only the mutations in `convex/clarifications.ts` (`ask`, `startAnswer`, `confirm`, `decline`, `fallbackText`, `resetOpen`) move it.
- **Spoken question.** `ask` schedules the action `voice.speakQuestion` (`convex/voice.ts`), which calls Cartesia Sonic and saves the audio with `ctx.storage.store`; the phone plays it via the `audioUrl` query.
- **Transcribed answer.** The phone uploads a recording through `generateUploadUrl`; `submitAnswerAudio` schedules `voice.transcribe`, which streams the stored blob to Cartesia Ink and writes `transcriptSegments` rows (internal mutation `addSegment`, index `by_clarification`).
- **Judge presence.** `managers.join` / `leave` / `current` in `convex/managers.ts` let the judge join as deployment manager from their phone.
- **Live without refresh.** The phone page (`apps/landing/src/phone.ts`) subscribes to `clarifications.active`, `transcript.byClarification` and `managers.current`; the landing and workbench pages subscribe to `managers.current`; the dev harness (`apps/harness/src/main.ts`) subscribes to the same.
- **Agent bridge.** `apps/agent/src/bridge.ts` opens calls with `ask` and polls `byWorkItem` to carry confirmed answers into the ledger. Tests: `convex/test` (`pnpm test:convex`).

## Log

- 2026-10-25 03:22Z `be70e37` Initial commit.
- 03:52Z `f466027` pnpm workspace scaffold.
- 03:57Z `45970c1` Claude extraction, explanation, convention learning (`apps/agent/src`).
- 03:57Z `286d663` Cost-to-cost engine with answer-key tests (`packages/engine`).
- 03:58Z `e3e3604` Convex clarification channel with Cartesia actions (`convex/schema.ts`, `clarifications.ts`, `voice.ts`, `transcript.ts`).
- 03:59Z `2b9094d` SpacetimeDB ledger schema, seed, reducers (`spacetimedb/src`).
- 04:02Z `5284165` STT robustness, single `answerAudioId` patch (`convex/voice.ts`).
- 04:09Z `59fcfda` Dev harness with live subscriptions (`apps/harness`).
- 04:11Z `439920f` Agent loop and Convex bridge (`apps/agent/src/loop.ts`, `bridge.ts`).
- 04:16Z `a0dce0a` End-to-end demo script (`scripts/demo.ts`).
- 04:20Z `0ec6188` Gemini second reader (`apps/agent/src/gemini.ts`).
- 04:46Z `9e11220` Idempotency, decline guard, `resetOpen` (`convex/clarifications.ts`).
- 04:46Z `253f95a` `audioUrl` query for playback (`convex/clarifications.ts`).
- 04:53Z `6a6be8b` Azure Document Intelligence ingestion (`apps/agent/src/azure-di.ts`).
- 06:30Z `7eb46a1` Manager presence (`convex/managers.ts`), phone-photo OCR test.
- 06:49Z `939e72e` UI hosting on Azure Static Web Apps (`.github/workflows/deploy-web.yml`).
- 08:36Z `7f16dee` Web app: landing, live workbench, judge phone page (`apps/landing`).
