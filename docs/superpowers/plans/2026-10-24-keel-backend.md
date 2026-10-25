# Keel Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend and agent workflow for Keel: deterministic revenue engine, SpacetimeDB ledger with enforced controls, Convex voice clarification channel, Claude agent service, dev harness, and an end-to-end demo script that reproduces the answer key.

**Architecture:** Pure TS engine (integer cents) → SpacetimeDB TypeScript module holds all ledger state and enforces roles/transitions in reducers → Node agent service subscribes to SpacetimeDB, calls Claude for reading/explaining only, and bridges confirmed clarifications from Convex → Convex actions call Cartesia for TTS/STT and store audio.

**Tech Stack:** Node 20, pnpm workspaces, TypeScript 5.6, vitest, `spacetimedb` 2.13 (server + client SDK), `convex`, `@anthropic-ai/sdk` + zod, Cartesia REST/WebSocket, (stretch) `@google/genai`.

**Spec:** `docs/superpowers/specs/2026-10-24-keel-design.md` (answer key in `docs/one-pager.md`)

## Global Constraints

- All money is integer cents as `bigint`; progress is basis points (integer, 0..10000). No floats on the posting path.
- Claude output schemas on the posting path contain no money fields. Claude never emits a dollar amount that gets posted.
- Every reducer that mutates state writes a `history_event` row. Posted rows are never updated.
- Demo resets to S0 with one reducer call (`resetDemo`).
- Commits: plain messages, no co-author trailer.
- Package manager: pnpm. Workspace root `/Users/chanpreetsingh/robotaxi`.
- Secrets only via env (`ANTHROPIC_API_KEY`, `CARTESIA_API_KEY`, `CONVEX_URL`, `GEMINI_API_KEY`). When a key is absent, services use a clearly labeled mock and log `MOCK:` once; mocks must be switchable off by env only.

## Review Focus

1. "New total" answer must give exactly 666,667 / +166,667 (rounding half-up at the dollar); pinned in Task 1.
2. Confirm arriving after a proposal was already superseded must not resurrect the stale proposal; pinned in Task 3 (test 5) and Task 7.
3. Two agent loops or a restart must not double-propose for the same source; `propose` is idempotent per (workItemId, forecastSourceId); pinned in Task 3.
4. A note with no dollar figure at all must not open a clarification or a proposal; the extraction returns `facts: []` and the loop ends; pinned in Task 6.
5. Convex `confirm` on a clarification already `confirmed` is a no-op, not a second evidence row; pinned in Task 5.

---

## File structure

```
package.json                    pnpm workspace root, scripts
pnpm-workspace.yaml
tsconfig.base.json
.env.example
packages/engine/src/{money.ts,engine.ts,index.ts}   pure arithmetic
packages/engine/test/engine.test.ts
spacetimedb/src/{schema.ts,seed.ts,index.ts}        SpacetimeDB module (tables, seed, reducers)
spacetimedb/package.json
spacetime.json                  module-path ./spacetimedb, server local
packages/bindings/              generated TS client bindings (committed)
packages/ledger-client/src/index.ts                 connect() + role identities helper
packages/ledger-client/test/ledger.e2e.test.ts      controls 2–7 against local server
convex/{schema.ts,clarifications.ts,voice.ts}       Convex channel
convex/test/channel.e2e.test.ts
apps/agent/src/{schemas.ts,claude.ts,gemini.ts,extract.ts,explain.ts,learn.ts,loop.ts,bridge.ts,main.ts}
apps/agent/prompts/{extract.txt,explain.txt,learn.txt}
apps/agent/test/{extract.test.ts,loop.test.ts}
apps/harness/index.html         dev-only buttons + table dump
demo/{seed.json,identities.json}
scripts/demo.ts                 end-to-end run of the three minutes, asserts answer key
README.md, docs/devpost.md
```

---

### Task 0: Workspace scaffold

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example`, `.gitignore` (add `node_modules`, `.env*`, `dist`, `spacetimedb/dist`, `.convex`).

- [ ] **Step 1:** `pnpm init`; set `"private": true`, `"packageManager": "pnpm@9"`, scripts: `test` → `pnpm -r test`, `stdb:start` → `spacetime start`, `stdb:publish` → `spacetime publish keel --server local --yes --delete-data=always`, `stdb:gen` → `spacetime generate --lang typescript --out-dir packages/bindings/src --module-path spacetimedb`, `agent` → `pnpm --filter @keel/agent start`, `demo` → `tsx scripts/demo.ts`.
- [ ] **Step 2:** `pnpm-workspace.yaml` packages: `packages/*`, `apps/*`, `spacetimedb`. Root devDeps: `typescript@~5.6.2 vitest tsx @types/node`.
- [ ] **Step 3:** `tsconfig.base.json`: `strict`, `module: NodeNext`, `target: ES2022`, `types: ["node"]`.
- [ ] **Step 4:** `.env.example` with the four keys + `CONVEX_URL=` + `STDB_URI=ws://127.0.0.1:3000` + `STDB_DB=keel`.
- [ ] **Step 5:** `pnpm install` succeeds. Commit `chore: workspace scaffold`.

---

### Task 1: Accounting engine (parallel track A)

**Files:** Create `packages/engine/package.json` (`@keel/engine`, `"type":"module"`, test script `vitest run`), `packages/engine/src/money.ts`, `packages/engine/src/engine.ts`, `packages/engine/src/index.ts`, `packages/engine/test/engine.test.ts`.

**Interfaces — Produces:**
```ts
export type Cents = bigint; export type Bp = number; // 0..10000
export const dollars = (n: number | string): Cents       // "1,000,000" | 1000000 → 100000000n
export function progressBp(incurred: Cents, remaining: Cents): Bp  // round half-up to bp; 0 if total 0
export function cumulativeRevenue(progress: Bp, contractValue: Cents): Cents // half-up to whole dollar (cents % 100 === 0)
export function contractAsset(cumRevenue: Cents, billed: Cents): Cents
export function expectedMargin(contractValue: Cents, estTotal: Cents): { amount: Cents; bp: Bp; lossWarning: boolean }
export function adjustment(prevCumRevenue: Cents, newCumRevenue: Cents): Cents
export type EntryLine = { account: 'Revenue' | 'ContractAsset'; debit: Cents; credit: Cents }
export function buildEntry(adj: Cents): EntryLine[]      // balanced; [] when adj === 0n
export type Convention = 'additional' | 'new_total'
export function applyUpdate(remaining: Cents, updateAmount: Cents, convention: Convention): Cents // new remaining
export type Snapshot = { contractValue: Cents; incurred: Cents; remaining: Cents; billed: Cents }
export function compute(s: Snapshot): { estTotal: Cents; progressBp: Bp; cumRevenue: Cents; contractAsset: Cents; margin: ReturnType<typeof expectedMargin> }
```

- [ ] **Step 1: Failing tests.** In `engine.test.ts` assert the full answer key from the spec table (Before; After "additional"; After "new total") and Month 3 (remaining 650,000 → progressBp 3810, cumRevenue 380,952, adjustment −19,048, margin −50,000 lossWarning true). Also: `buildEntry(dollars(-100000))` → `[{Revenue, debit 100000}, {ContractAsset, credit 100000}]`; `buildEntry(dollars(166667))` reversed; debits === credits for both; `compute` with incurred 0 and remaining 0 → progressBp 0, no throw.
- [ ] **Step 2:** `pnpm --filter @keel/engine test` → fails (module missing).
- [ ] **Step 3:** Implement. Rounding helper `divRoundHalfUp(n: bigint, d: bigint): bigint` in `money.ts`; `cumulativeRevenue` = `divRoundHalfUp(progress * contractValue, 10000n)` then round half-up to whole dollars.
- [ ] **Step 4:** Tests pass. Commit `feat(engine): cost-to-cost engine with answer-key tests`.

---

### Task 2: SpacetimeDB module — schema and seed (parallel track B)

**Files:** Create `spacetimedb/package.json` (deps `spacetimedb: 2.13.*`, build `spacetime build`), `spacetimedb/tsconfig.json`, `spacetimedb/src/schema.ts`, `spacetimedb/src/seed.ts`, `spacetimedb/src/index.ts`, `spacetime.json` (`{"module-path":"./spacetimedb","server":"local"}`), `demo/seed.json`.

Reference for module syntax: `/private/tmp/claude-501/-Users-chanpreetsingh-robotaxi/dd936fd4-7c07-41ef-87aa-486749d63b4c/scratchpad/stdb-probe/.cursor/rules/typescript-server.mdc` (copy to `spacetimedb/SDK-REFERENCE.md`).

**Interfaces — Produces:** tables exactly as the spec §2 lists, with these pinned details:
- all ids `t.u64().primaryKey().autoInc()`; money columns `t.i64()` cents; `progressBp: t.u32()`.
- `user.identity: t.identity().primaryKey()`, `user.role: t.string()`.
- `work_item.status`, `proposal.status`, `source.kind`, `clarification_ref.status`: `t.string()` with the spec's enumerated values.
- `posting.postingRef: t.string().unique()`.
- `proposal` index `by_work_item` on `workItemId`; `source` index on `projectId`.
- `t.timestamp()` for `*At` columns, set from `ctx.timestamp`.

Seed (S0) from `demo/seed.json`: project "Oakland deployment" (Aster Robotics), contract 100,000,000 cents, period open; policy v3 text "Cost-to-cost, single performance obligation, fixed price"; sources: contract, cost_export (incurred 40,000,000), forecast v1 (remaining 40,000,000), invoice billed 30,000,000, six historical closes (kind `note`, each a short "Remaining Estimate means future costs only" style example); convention `{template:"forecast", key:"remaining_estimate_means", value:"future_costs_only", approvedBy: controller}`; convention for "another X" is **not** seeded (it is learned in the demo); work item "Oakland deployment: forecast v1 close" with calculation (5000 bp, 50,000,000, asset 20,000,000) and proposal rev 1 `posted` (postingRef `OAK-2026-09-R1`).

- [ ] **Step 1:** Write `schema.ts` tables, `index.ts` with `export { default } from './schema'`, `seed.ts` exporting `seedS0(ctx)` that deletes all rows then inserts S0. Reducers in `index.ts`: `seed` and `resetDemo` (both call `seedS0`; `resetDemo` also logs `history_event` kind `reset`).
- [ ] **Step 2:** `cd spacetimedb && pnpm install && spacetime build` → wasm/js bundle built with no errors.
- [ ] **Step 3:** In a second terminal `spacetime start` (background). `spacetime publish keel --server local --yes --delete-data=always`; `spacetime call keel resetDemo --server local`; `spacetime sql keel "SELECT * FROM proposal" --server local` shows one row, status `posted`.
- [ ] **Step 4:** Commit `feat(ledger): SpacetimeDB schema and S0 seed`.

---

### Task 3: SpacetimeDB module — reducers with controls

**Files:** Modify `spacetimedb/src/index.ts`. Create `spacetimedb/src/guards.ts` (`requireRole(ctx, ...roles)`, `log(ctx, projectId, kind, refId, summary)`).

**Interfaces — Produces (reducer names and arg shapes are the API for the agent and UI):**
```
registerDemoUser(name: string, role: string)                 // caller identity → user row (demo only)
addSource(projectId: u64, kind: string, text: string, parentSourceId: u64 /*0 = none*/, version: u32) → inserts source; marks any proposal with status open for that project → stale, its work item → stale
recordExtraction(sourceId, reader: string, factsJson: string, ambiguityFlag: bool, ambiguityText: string)   // role agent
openClarification(workItemId, convexId: string, question: string)  // role agent; work_item → awaiting_clarification
resolveClarification(clarificationId, answer: string, speaker: string, audioStorageId: string) // role agent; inserts source kind clarification (parent = clarification's source), clarification_ref → confirmed, work_item → open
recordCalculation(workItemId, forecastSourceId, inputsJson, progressBp: u32, cumRevenueCents: i64, contractAssetCents: i64, marginCents: i64, lossWarning: bool) → id
propose(workItemId, calculationId, entryJson, explanation, evidenceSourceIdsCsv)   // role agent; idempotent: if a proposal exists with same workItemId+calculationId return; else revision = max+1, older open → stale; work_item → proposed
decide(proposalId, revision: u32, decision: 'approve'|'return'|'hold', reason)      // role controller; reject if revision mismatch or status stale; approve → work_item approved
post(proposalId, revision, postingRef)   // role controller|posting_service; checks in spec order; inserts posting; work_item → posted; proposal unchanged except status approved→posted? NO: proposal status stays approved; posting row is the record
saveConvention(template, key, value, exampleSourceIdsCsv, policyVersion: u32)    // role controller
```
Errors are `throw new SenderError('<code>: <message>')` with codes: `role`, `revision`, `stale`, `period_closed`, `unbalanced`, `duplicate_posting`, `not_approved`.

- [ ] **Step 1:** Implement all reducers. `post` balance check parses `entryJson` lines (`{account, debit, credit}` cents as strings) and sums with `BigInt`.
- [ ] **Step 2:** Build and publish locally (`pnpm stdb:publish`). Smoke with CLI: `spacetime call keel registerDemoUser '"Controller"' '"controller"'` then `spacetime call keel post 1 1 '"OAK-2026-09-R1"'` → error contains `duplicate_posting`.
- [ ] **Step 3:** Commit `feat(ledger): reducers with role, revision, period, balance and duplicate checks`.

---

### Task 4: Bindings and ledger client with e2e control tests

**Files:** Create `packages/bindings/package.json` (`@keel/bindings`), run generate into `packages/bindings/src`; create `packages/ledger-client/package.json` (`@keel/ledger-client`, deps `spacetimedb`, `@keel/bindings`), `packages/ledger-client/src/index.ts`, `packages/ledger-client/test/ledger.e2e.test.ts`, `demo/identities.json`.

**Interfaces — Produces:**
```ts
export type Role = 'accountant'|'deployment_manager'|'controller'|'agent'
export async function connectAs(role: Role, opts?: { uri?: string; db?: string }): Promise<DbConnection>  // uses token from demo/identities.json (populated on first connect, see step 1), registers user via registerDemoUser if missing, awaits subscription to all tables
export function waitFor<T>(conn: DbConnection, pred: () => T | undefined, ms = 5000): Promise<T>
```

- [ ] **Step 1:** `pnpm stdb:gen`; commit generated files. Write `connectAs`: `DbConnection.builder().withUri().withDatabaseName().withToken(saved).onConnect((conn, identity, token) => save token per role in demo/identities.json)`; subscribe `SELECT * FROM *` tables listed explicitly.
- [ ] **Step 2: Failing e2e tests** (require local server + published module; skip with a clear message if `STDB_URI` unreachable):
  - control 2: `addSource(note "we need another $200,000 to finish")` as agent → `openClarification` → work_item status `awaiting_clarification`; no new proposal.
  - control 3: `post` same `postingRef` twice → second rejects `duplicate_posting`.
  - control 4: `post` as accountant → `role`.
  - control 5: propose rev 2 → `addSource` forecast v3 → proposal 2 `stale`; `decide(2, 2, approve)` → `stale`.
  - idempotency: `propose` twice with same calculationId → one row.
  - period: set up by `resetDemo` then (add a `closePeriod(projectId)` controller reducer in Task 3 if missing) → `post` → `period_closed`.
- [ ] **Step 3:** Run `pnpm --filter @keel/ledger-client test` → all pass. Commit `feat(ledger-client): bindings, role connections, control e2e tests`.

---

### Task 5: Convex clarification channel (parallel track C)

**Files:** Create `convex/schema.ts`, `convex/clarifications.ts`, `convex/voice.ts`, `convex/_generated` (by `npx convex dev --once`), `convex/test/channel.e2e.test.ts`, `convex.json`. Add root dep `convex`.

**Interfaces — Produces (Convex function names used by the agent and the UI):**
```
mutation clarifications.ask({ workItemId: string, question: string, options: string[] }) → id ; schedules voice.speakQuestion(id) immediately
query    clarifications.active() → the newest with status in [ringing, answering, fallback_text] or null
query    clarifications.byWorkItem({ workItemId }) → list
mutation clarifications.startAnswer({ id }) → status answering
mutation clarifications.confirm({ id, answer: string, speaker: string }) → status confirmed; NO-OP if already confirmed
mutation clarifications.decline({ id, reason }) → unconfirmed
mutation clarifications.fallbackText({ id }) → status fallback_text
mutation clarifications.generateUploadUrl() → string
action   voice.speakQuestion({ id }) → Cartesia POST https://api.cartesia.ai/tts/bytes, header Cartesia-Version: 2026-08-14, model sonic-3.6, voice id from env CARTESIA_VOICE_ID (default "694f9389-aac1-45b6-b726-9d9369183238"), wav pcm_s16le 24000 → storage.store → patch questionAudioId
action   voice.transcribe({ id, storageId }) → reads blob, opens wss://api.cartesia.ai/stt/websocket?model=ink-2&encoding=pcm_s16le&sample_rate=16000&cartesia_version=2026-08-14 with X-API-Key, sends 100ms chunks, 'finalize', 'close'; inserts transcriptSegments rows {clarificationId, seq, text, isFinal}; patches answerAudioId
query    transcript.byClarification({ id }) → ordered segments
```
Tables: `clarifications` (workItemId, question, options, status, answer?, speaker?, questionAudioId?, answerAudioId?, confirmedAt?), `transcriptSegments` (clarificationId, seq, text, isFinal) with index `by_clarification`.
Mock mode: when `CARTESIA_API_KEY` is unset, `speakQuestion` stores a 0.5 s silent WAV and `transcribe` writes one segment `"MOCK: it's additional"`.

- [ ] **Step 1:** `npx convex dev --once` after user login; write schema + functions.
- [ ] **Step 2: Failing e2e test** using `ConvexHttpClient` against `CONVEX_URL`: ask → active() returns ringing; wait ≤10 s for questionAudioId set; confirm("it's additional") → status confirmed; confirm again with different text → answer unchanged; fallbackText on a new one → active() returns it.
- [ ] **Step 3:** Tests pass. Commit `feat(convex): clarification channel with Cartesia TTS/STT actions`.

---

### Task 6: Agent reading and writing with Claude (parallel track D, no SpacetimeDB dependency)

**Files:** Create `apps/agent/package.json` (`@keel/agent`, deps `@anthropic-ai/sdk zod @keel/engine`), `apps/agent/src/schemas.ts`, `apps/agent/src/claude.ts`, `apps/agent/src/extract.ts`, `apps/agent/src/explain.ts`, `apps/agent/src/learn.ts`, `apps/agent/prompts/*.txt`, `apps/agent/test/extract.test.ts`.

**Interfaces — Produces:**
```ts
// schemas.ts (zod)
Extraction = { facts: { kind: 'remaining_update'|'cost'|'milestone'|'other'; amountText: string; quote: string; charStart: number; charEnd: number }[];
               ambiguity: { flag: boolean; kind: 'additional_vs_total'|'none'|'other'; question: string; options: string[] } }
Explanation = { summary: string; whyRevenueMoved: string; whatDidNotChange: string }     // text only
Conventions = { proposals: { template: string; key: string; value: string; rationale: string; exampleSourceIds: number[] }[] }
// extract.ts
export async function extract(noteText: string, sourceId: number): Promise<Extraction>   // claude-opus-5-5, messages.parse + zodOutputFormat, system prompt from prompts/extract.txt with cache_control, fallbacks: "default" + betas ["server-side-fallback-2026-07-01"]
export function parseAmountCents(amountText: string): bigint | null                       // "$200,000" | "200k" | "two hundred thousand dollars"(no) → 20000000n | null ; pure, tested
// explain.ts
export async function explain(input: { before: ComputeOut; after: ComputeOut; adjustmentCents: bigint; convention: string; evidence: string[] }): Promise<Explanation> // numbers are passed in, prompt forbids inventing numbers
// learn.ts
export async function learnConventions(closes: { sourceId: number; text: string }[]): Promise<Conventions>
```
Mock mode: `ANTHROPIC_API_KEY` unset → `extract` returns the canned ambiguous extraction for text containing "another" and a dollar figure; `facts: []` otherwise; `explain`/`learn` return fixed strings prefixed `MOCK:`.

- [ ] **Step 1: Failing tests:** `parseAmountCents` cases; `extract("we need another $200,000 to finish")` → `ambiguity.flag true`, `kind additional_vs_total`, one fact amount parses to 20000000n; `extract("Crew on site, weather fine.")` → `facts.length 0`, `flag false`; `extract("the new total remaining is $600,000")` → `flag false`. Real-API tests run only when key present; mock tests always run.
- [ ] **Step 2:** Implement per the TypeScript Claude SDK README (structured outputs: `client.messages.parse` with `output_config: { format: zodOutputFormat(Schema) }`).
- [ ] **Step 3:** Tests pass in mock mode and with the key. Commit `feat(agent): Claude extraction, explanation, convention learning`.

---

### Task 7: Agent loop and Convex bridge (depends on 4, 5, 6)

**Files:** Create `apps/agent/src/loop.ts`, `apps/agent/src/bridge.ts`, `apps/agent/src/main.ts`, `apps/agent/test/loop.test.ts`.

**Interfaces — Produces:**
```ts
export function handleNewSource(src: SourceRow, deps: Deps): Promise<void>   // Deps = { ledger: DbConnection(agent), convex: ConvexHttpClient, extract, explain, engine }
export function startLoop(deps: Deps): () => void                            // subscribes to source inserts; dedupes by source id in a Set; also polls convex clarifications status confirmed every 1s → resolveClarification once (tracks handled convexIds)
```
Flow per spec §3 steps 1–6. Convention lookup: `convention` rows where `template === 'forecast'` and `key === 'another_means'`; if value present → apply without clarification and put `Convention v{policyVersion}: another_means = {value}` first in `evidenceSourceIdsCsv`/explanation. Loss warning → `history_event` kind `escalation` with reasoning text via `recordCalculation` + a `propose` whose explanation starts with `ESCALATION:`.

- [ ] **Step 1: Failing tests** with fake `Deps` (in-memory ledger stub implementing the reducer calls as functions): (a) ambiguous note → `openClarification` called, `propose` not called; (b) confirmed clarification → `resolveClarification` then `recordCalculation` 4000 bp and `propose` with entry −100,000; (c) convention saved → month-3 note → no `openClarification`, `propose` with progress 3810 and explanation containing `another_means`; (d) same source delivered twice → one `propose`.
- [ ] **Step 2:** Implement; `main.ts` wires real deps from env and runs until SIGINT.
- [ ] **Step 3:** Tests pass. Commit `feat(agent): orchestration loop and Convex bridge`.

---

### Task 8: Dev harness

**Files:** Create `apps/harness/index.html`, `apps/harness/package.json` (`vite` dev server, dep `@keel/bindings`, `spacetimedb`, `convex`).

- [ ] **Step 1:** One page, role dropdown (uses `connectAs`), buttons: Reset, Add $200k note, Confirm "additional" (Convex `confirm`), Confirm "new total", Approve latest, Post latest (postingRef auto `OAK-{rev}`), Add commissioning log, Add month-3 note, Save convention. Right side: `<pre>` dump of work_item, proposal, posting, history_event, clarifications.active.
- [ ] **Step 2:** Manually run the demo beats; the pre shows 4000 bp and −100,000 after confirm. Commit `feat(harness): dev page to drive the backend`.

---

### Task 9: End-to-end demo script

**Files:** Create `scripts/demo.ts`.

- [ ] **Step 1:** Script: `resetDemo` → start agent loop in-process → add note → wait for Convex `active` ringing → `confirm("it's additional")` → wait for proposal rev 2 → assert calculation 4000 bp, cumRevenue 40,000,000, asset 10,000,000, margin 0 lossWarning → `decide approve` → `post OAK-R2` → assert posting row → add commissioning log → add month-3 note → assert no new clarification, proposal rev 3 progress 3810 → print elapsed per beat. Exit 1 on any mismatch.
- [ ] **Step 2:** `pnpm demo` passes twice in a row from reset (tests the 10-second reset). Commit `test: end-to-end demo script`.

---

### Task 10 (stretch): Gemini second reader

**Files:** Create `apps/agent/src/gemini.ts`; modify `extract.ts` to run both when `GEMINI_API_KEY` set, 5 s timeout, `recordExtraction` once per reader; disagreement on `ambiguity.flag` or on the amount → force `ambiguity.flag = true` with kind `other` and question "Two readers disagree: …".

- [ ] Test: fake Gemini returning a different amount → flag forced true. Commit `feat(agent): Gemini second reader`.

---

### Task 11: Submission text and README

**Files:** Create `README.md` (run instructions, architecture diagram from spec, controls list with test names), `docs/devpost.md` (title, tagline, inspiration, what it does, how we built it, tracks: Hyphenate, Spacetime, Convex, Cartesia, Microsoft Built for the Real World, Atlassian Best Agent, MLH Commit Fellowship, MLH Best Use of Gemini API; the Symbotic citation worded exactly as the one-pager says).

- [ ] Commit `docs: README and Devpost submission text`.
