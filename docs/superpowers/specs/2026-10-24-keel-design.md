# Keel: Robotics Project Close Agent — Design

Date: 2026-10-24. Event: Cal Hacks 13.0. Submission deadline: Oct 25, 9:00 AM PDT.
Repo: github.com/Jagga-tech/robaudit (branch `summo`). Build window: ~5 hours, then rehearsal.

## Intent

An accounting agent for robotics companies that install million-dollar systems. It keeps
project revenue current as costs, forecasts and commissioning evidence change, asks the one
clarifying question, prepares the adjustment, and a controller approves. The judge speaks
into a phone and watches the books change with their words attached as evidence.

The full product narrative, demo answer key, pitch lines and run-of-show are in the
one-pager (`docs/one-pager.md`). This document covers what gets built in this session:
**the backend and agent workflow**. The UI (workbench, phone page) is built by Tanush
against the API contract defined here.

## Goals

1. Hyphenate track: Learns, Runs, Escalates, Improves each visible in one workflow.
2. Spacetime track: ledger state in SpacetimeDB; reducers enforce roles and transitions.
3. Convex track: the voice clarification channel runs on Convex live queries, actions,
   file storage and scheduling.
4. Cartesia track: question spoken (Sonic TTS), answer transcribed (Ink STT), confirmed.
5. Microsoft, Atlassian Best Agent, MLH Commit Fellowship: no extra code; submission text.
6. MLH Gemini (stretch): Gemini as independent second reader on extraction.
7. Numbers on screen match the answer key to the dollar. Demo resets in 10 seconds.

## Non-goals

- General ASC 606: one performance obligation, fixed price, cost-to-cost only.
- Real ERP connectors, auth beyond demo roles, production security.
- A UI in this session (teammate's workstream). We ship a minimal dev-only HTML harness to
  drive and verify the backend; it is not the demo UI.

## Anti-goals (would make this a failure even if it runs)

- Claude producing a dollar amount that gets posted.
- A posted entry being edited. Entries are only adjusted by new entries.
- A repeated input double-posting.
- Convex touching money, policy or posting.
- Any sponsor API used for one decorative call.

## Constraints

- Node 20, TypeScript, pnpm. No Rust/.NET toolchain on the machine (SpacetimeDB module is
  TypeScript, `spacetime` CLI 2.13.0 installed).
- Keys required from the user: `ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, Convex login,
  `GEMINI_API_KEY` (stretch). Build proceeds with mocks until keys arrive; mocks are
  removed before submission.
- Judges rotate; state must reset to S0 with one reducer call.

## Architecture

Three things kept apart: language, arithmetic, permission to write.

```
                 ┌──────────────┐  evidence rows, proposals      ┌──────────────────┐
  Claude reads → │ agent service│ ──────────────────────────────▶│  SpacetimeDB     │◀── workbench (Tanush)
  (+Gemini 2nd)  │  (Node/TS)   │◀────────────────────────────── │  ledger module   │
                 └──────┬───────┘  subscribes: work items,       │  (TS reducers)   │
                        │           stale flags, approvals       └──────────────────┘
      ask / confirmed   │
                        ▼
                 ┌──────────────┐  TTS/STT actions   ┌──────────┐
                 │   Convex     │ ◀────────────────▶ │ Cartesia │
                 │ clarification│                    └──────────┘
                 │   channel    │◀── phone page (Tanush), workbench call pane
                 └──────────────┘
```

### 1. Accounting engine (`packages/engine`)

Pure TypeScript, integer cents (`bigint`), no I/O. Functions:

- `progress(incurred, estTotal)` → ratio (basis points, integer) with the exact rounding
  rule documented in code. Cost-to-cost: incurred ÷ (incurred + remaining).
- `cumulativeRevenue(progress, contractValue)`
- `contractAsset(cumRevenue, billed)`
- `expectedMargin(contractValue, estTotal)` → amount and ratio; `lossWarning` when ≤ 0.
- `adjustment(prevCumRevenue, newCumRevenue)` → signed amount.
- `buildEntry(adjustment)` → balanced journal lines
  (negative adj: Dr Revenue / Cr Contract asset; positive: Dr Contract asset / Cr Revenue).
- `applyUpdate(forecast, update, convention)` where convention ∈ {`additional`, `new_total`}.

Tests assert the answer key exactly:

| Measure | Before | After ("additional") | After ("new total") |
|---|---|---|---|
| Incurred | 400,000 | 400,000 | 400,000 |
| Remaining | 400,000 | 600,000 | 200,000 |
| Est total | 800,000 | 1,000,000 | 600,000 |
| Progress | 50% | 40% | 66.67% |
| Cum revenue | 500,000 | 400,000 | 666,667 |
| Billed | 300,000 | 300,000 | 300,000 |
| Contract asset | 200,000 | 100,000 | 366,667 |
| Margin | 200,000 (20%) | 0 (0%) loss warning | 400,000 (40%) |
| Adjustment | — | −100,000 | +166,667 |

Rounding: cumulative revenue = round-half-up(contractValue × incurred ÷ estTotal) to the
whole dollar, computed on the exact ratio in bigint. Basis points are display only and never
feed revenue. The "new total" branch must produce exactly 666,667 and +166,667.

Month 3 case: "another $50,000 for conveyor rework" with saved convention `additional`
→ remaining 650,000, total 1,050,000, progress 38.10%, cum revenue 380,952,
adjustment −19,048, margin −50,000 → loss contract → controller escalation.

### 2. Ledger module (`spacetimedb/`, SpacetimeDB TypeScript module)

Tables (all `public: true` for the demo):

- `user` (identity pk, name, role: accountant | deployment_manager | controller | agent)
- `project` (id, name, contractValueCents, periodOpen: bool)
- `policy` (id, version, text, approvedBy, approvedAt)
- `convention` (id, projectCompanyScope, template, key, value, exampleSourceIds, policyVersion, approvedBy)
- `source` (id, projectId, kind: contract | cost_export | forecast | note | clarification | commissioning_log | invoice, version, text, parentSourceId, hash, createdAt)
- `extraction` (id, sourceId, reader: claude | gemini, factsJson, ambiguityFlag, ambiguityText)
- `clarification_ref` (id, workItemId, convexId, question, status, answer, speaker, confirmedAt, audioStorageId)
- `work_item` (id, projectId, title, status: open | awaiting_clarification | proposed | approved | posted | returned | held | stale, assignedRole)
- `calculation` (id, workItemId, forecastSourceId, inputsJson, progressBp, cumRevenueCents, contractAssetCents, marginCents, lossWarning)
- `proposal` (id, workItemId, calculationId, revision, entryJson, explanation, evidenceSourceIds, status: open | stale | approved | returned | held)
- `approval` (id, proposalId, revision, decision: approve | return | hold, by, reason, at)
- `posting` (id, proposalId, revision, postingRef unique, linesJson, postedBy, postedAt)
- `history_event` (id, projectId, kind, refId, summary, actor, at)

Reducers (each throws `SenderError` on violation; every state change writes `history_event`):

- `seed()` / `resetDemo()` → S0: project, policy v3, forecast v1, costs, billing, six
  historical closes, approved convention, work item open with proposal v1 posted.
- `addSource(projectId, kind, text, parentSourceId?)` → inserts; if an open proposal exists
  for the project, marks it `stale` and the work item `stale` (new evidence invalidates).
- `recordExtraction(sourceId, reader, factsJson, ambiguityFlag, ambiguityText)` (agent role)
- `openClarification(workItemId, convexId, question)` → work item `awaiting_clarification`
- `resolveClarification(id, answer, speaker, audioStorageId)` → inserts a `source` of kind
  `clarification` (so it is evidence), work item back to `open`
- `recordCalculation(...)` and `propose(workItemId, calculationId, entryJson, explanation, evidenceIds)`
  (agent role; revision = previous + 1; previous open proposal → `stale`)
- `decide(proposalId, revision, decision, reason)` (controller role; rejects if revision ≠
  current or proposal is `stale`)
- `post(proposalId, revision, postingRef)` — the posting service. Checks in order:
  caller role is `controller` or `posting_service`; proposal approved; revision current;
  project period open; debits = credits; `postingRef` unique. Writes `posting`; never
  updates an existing posting.
- `saveConvention(...)` (controller role) and `applyConvention` is a pure read by the agent.
- `closePeriod(projectId)` (controller role) exists so the period check is testable.

Decisions pinned after builder review:

- **Convention lifecycle.** S0 seeds one approved convention for a different key
  (`remaining_estimate_means = future_costs_only`, learned from the six closes). The
  `another_means` convention is not seeded. When a clarification is confirmed, the agent's
  `propose` carries `pendingConventionJson` (`{template:'forecast', key:'another_means',
  value:'additional'}`). `decide(approve)` saves that convention as approved by the
  controller in the same reducer. Month 3 finds it and asks no question.
- **Who posts.** There is no `posting_service` role. `decide(approve)` and `post` are two
  reducers; the controller's client calls them back to back (one Approve button in the UI).
  `post` is where the five checks run and is what rejects wrong role / duplicate / stale.
- **Commissioning log.** `contract_milestone` table seeded with `acceptance` =
  20,000,000 cents, status `pending`. A `commissioning_log` source → extraction fact
  `milestone` → agent opens work item "Milestone invoice: acceptance" and proposes entry
  Dr AccountsReceivable 200,000 / Cr ContractAsset 200,000 with the log as evidence.
  `EntryLine.account` therefore includes `AccountsReceivable`. Billed-to-date changes
  only when that proposal is posted (not needed in the three minutes).

Clients subscribe with `spacetimedb` TS SDK; bindings generated into
`packages/bindings` via `spacetime generate --lang typescript`.

### 3. Agent service (`apps/agent`, Node/TS, long-running)

Subscribes to SpacetimeDB. Loop:

1. New `source` of kind `note` or `forecast` → **extract** with Claude
   (`claude-opus-5-5`, `messages.parse` with a Zod schema; thinking adaptive; server-side
   fallbacks on). Output: facts with source spans, `ambiguity: {flag, kind, question,
   options}`. Stretch: Gemini runs the same schema; disagreement → ambiguity.
2. If a matching approved `convention` exists → apply it, cite it, no question.
3. Else if ambiguous → `openClarification` in SpacetimeDB and `ask` in Convex.
4. On Convex `confirmed` → `resolveClarification` in SpacetimeDB.
5. Run engine → `recordCalculation` → Claude writes the **explanation** (text only; the
   numbers are passed in, never generated) → `propose`.
6. Loss warning or out-of-policy cost → work item flagged for controller with reasoning.
7. **Learns**: `learnConventions(historicalCloses)` → Claude proposes conventions with the
   supporting examples; stored as `pending` until the controller approves.

Claude never outputs a dollar amount destined for posting; schemas have no money fields on
the posting path. Prompts are in `apps/agent/prompts/` as plain text files.

### 4. Clarification channel (`convex/`)

Tables: `clarifications` (workItemId, question, options, status: ringing | answering |
confirmed | declined | unconfirmed | fallback_text, answer, speaker, questionAudioId,
answerAudioId), `transcriptSegments` (clarificationId, seq, text, isFinal).

Functions: mutation `ask` (schedules `speakQuestion`), action `speakQuestion` (Cartesia
`POST /tts/bytes`, `sonic-3.6`, wav → file storage), mutation `startAnswer`, mutation
`submitAnswerAudio({id, storageId})` (schedules `transcribe`), action `transcribe` (reads
the uploaded WAV, strips the 44-byte header, streams PCM to
`wss://api.cartesia.ai/stt/websocket?model=ink-2`, writes segments), mutation `confirm`,
mutation `fallbackText`, query `active` (phone page), query `byWorkItem` (workbench pane).

**Audio contract with the phone page (Tanush):** record with an AudioWorklet or
ScriptProcessor into 16 kHz mono PCM16 and upload a WAV (44-byte header + PCM) via
`generateUploadUrl`, then call `submitAnswerAudio`. No webm/opus: Convex actions cannot
transcode. If the mic path fails, the page falls back to the browser `SpeechRecognition`
API and calls `confirm` with that text; the agent still records the answer as evidence.

### 5. Dev harness (`apps/harness`)

One static HTML page with buttons for every demo beat (reset, add note, confirm as
manager, approve as controller, post, add commissioning log, month 3) and a live dump of
the SpacetimeDB tables. Exists so the backend is demonstrable and testable before the
real UI lands. Not styled.

## Controls that are tested, not just claimed

1. Answer key reproduced by code (engine tests).
2. Ambiguous note → work item `awaiting_clarification`, no proposal until confirmed.
3. Same `postingRef` twice → second `post` rejected.
4. `post` from accountant identity → rejected.
5. New `source` while a proposal is open → proposal `stale`, `decide` on it rejected.
6. "new total" answer → 66.67% / +166,667.
7. Month 3 with saved convention → no clarification opened, convention cited.

## API contract for the UI (Tanush)

- SpacetimeDB database name `keel`, local server `http://127.0.0.1:3000` for dev,
  Maincloud for the demo if publish succeeds. Generated TS bindings committed in
  `packages/bindings`.
- Convex deployment URL in `.env.local`; phone page subscribes to `clarifications.active`.
- Demo identities: four fixed tokens in `demo/identities.json` (accountant, manager,
  controller, agent) so the UI can switch role with a dropdown.

## Left to the builder

- Exact Zod schemas, prompt wording, Convex action retry behavior, table index choices,
  how the harness renders tables. Any choice the one-pager does not fix.

## Decisions made in this document (my calls, flag if wrong)

- Integer cents + basis points instead of a decimal library: no dependency, exact.
- SpacetimeDB tables all public: demo only, noted as a production gap.
- Posting service is a reducer in the ledger module, not a separate process: same
  guarantees, one fewer thing to keep alive on stage.
- Claude model `claude-opus-5-5`; Gemini is the second reader, not Haiku, because the
  track requires it and a different vendor is a stronger independence story.
