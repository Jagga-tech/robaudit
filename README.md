# RoboAudit

RoboAudit is a project-close accounting agent for robotics companies that install fixed-price systems. When a cost forecast, a field note or a commissioning log changes, it reads the evidence, asks the deployment manager one clarifying question by voice if the wording is ambiguous, recomputes revenue with tested cost-to-cost arithmetic, and prepares an adjusting entry. A controller approves and posts it; the model never produces a number that gets posted.

Built at Cal Hacks 13.0. Design: `docs/superpowers/specs/2026-10-24-keel-design.md`. Team source doc: `docs/one-pager.md`.

> The agent service is called **Summo** internally; RoboAudit is the platform. UI labels (`@keel/*` packages and database `keel` keep the internal codename) use "Summo" for the agent.

## Architecture

Three things are kept apart: language, arithmetic, and permission to write.

```
                 ┌──────────────┐  evidence rows, proposals      ┌──────────────────┐
  Claude reads → │ agent service│ ──────────────────────────────▶│  SpacetimeDB     │◀── workbench UI
  (+Gemini 2nd)  │  (Node/TS)   │◀────────────────────────────── │  ledger module   │
                 └──────┬───────┘  subscribes: work items,       │  (TS reducers)   │
                        │           stale flags, approvals       └──────────────────┘
      ask / confirmed   │
                        ▼
                 ┌──────────────┐  TTS/STT actions   ┌──────────┐
                 │   Convex     │ ◀────────────────▶ │ Cartesia │
                 │ clarification│                    └──────────┘
                 │   channel    │◀── phone page, workbench call pane
                 └──────────────┘
```

| Part | Role | Where |
|---|---|---|
| Claude (`claude-opus-5-5`) | Reads notes into facts, writes the question, writes the explanation. Text only. | `apps/agent/src/{claude,extract,explain,learn}.ts`, `apps/agent/prompts/` |
| Engine | Computes progress, revenue, contract asset, margin, adjustment, entry. Integer cents, no I/O. | `packages/engine` |
| SpacetimeDB | Holds the ledger. Reducers enforce roles, revisions, staleness, balance, period, posting-ref uniqueness. Posts. | `spacetimedb/` |
| Convex | Runs the clarification call: live queries, mutations, actions, file storage, scheduler. Never touches money. | `convex/` |
| Cartesia | Speaks the question (Sonic TTS) and transcribes the answer (Ink STT), inside Convex actions. | `convex/voice.ts` |
| Gemini | Independent second reader on extraction; disagreement forces a clarification. | `apps/agent/src/gemini.ts` |
| Agent loop | Subscribes to the ledger, calls the above in order, bridges Convex confirmations back. | `apps/agent/src/{loop,bridge,main}.ts` |
| Dev harness | Unstyled page with a button per demo beat and a live table dump. Not the demo UI. | `apps/harness` |

## Run it

Requires Node 20, pnpm 10, and the `spacetime` CLI (2.13).

```sh
pnpm install

spacetime start                 # leave running (or: pnpm stdb:start)
pnpm stdb:publish               # publishes db "keel" to local, wipes data
pnpm stdb:gen                   # optional: regenerate packages/bindings (committed)

npx convex login                # first time only, for a cloud deployment
npx convex dev                  # leave running; writes CONVEX_URL to .env.local
```

Keys: `cp .env.example .env` and fill in

- `ANTHROPIC_API_KEY` (Claude; without it the agent runs in `MOCK: anthropic` mode)
- `CARTESIA_API_KEY` (and optionally `CARTESIA_VOICE_ID`)
- `GEMINI_API_KEY` (second reader)
- `STDB_URI` / `STDB_DB` default to `ws://127.0.0.1:3000` / `keel`

Cartesia runs inside Convex, so the Convex deployment needs its own copy:

```sh
npx convex env set CARTESIA_API_KEY <key>
```

Then:

```sh
pnpm --filter @keel/agent start     # agent loop (or: pnpm agent)

pnpm demo                           # full 9-beat demo with asserts; exits 1 on MISMATCH
pnpm demo --require-real            # same, but fails if Claude or Cartesia is mocked
pnpm demo --reset-only              # reset to S0 and assert it (~0.5 s); use between judges

pnpm --filter @keel/harness dev     # dev harness (Vite)
```

`pnpm demo` runs the agent loop in-process, so do not run it while `pnpm --filter @keel/agent start` is also running.

Tests:

```sh
pnpm test                               # all workspace packages
pnpm --filter @keel/ledger-client test  # ledger controls; needs spacetime running + published, skips otherwise
pnpm test:convex                        # Convex channel; needs npx convex dev running, skips otherwise
```

The ledger and Convex e2e tests reset the shared `keel` database. Do not run them during a live demo.

## Stage runbook

Deployments: Convex dev `https://lovely-squirrel-569.convex.cloud` (rehearsal), Convex prod `https://hushed-shrimp-24.convex.cloud` (demo). SpacetimeDB Maincloud: database `keel` at `wss://maincloud.spacetimedb.com` (dashboard https://spacetimedb.com/keel); local `ws://127.0.0.1:3000` is the fallback. Role tokens differ per server: keep `demo/identities.local.json` and `demo/identities.maincloud.json` and copy the right one to `demo/identities.json`.

Start order:

1. `spacetime start`
2. `pnpm stdb:publish`
3. `npx convex dev`
4. `until pnpm agent; do sleep 1; done` (restart loop)
5. UI

Reset between judges: `pnpm demo --reset-only`.

If a beat stalls, restart the agent; recovery is restart-safe.

Known gaps (two crash windows): a crash between `record_calculation` and `propose`, and between Convex `ask` and `open_clarification`.

## Controls that are tested

| # | Control | Pinned by |
|---|---|---|
| 1 | Answer key reproduced by code | `packages/engine/test/engine.test.ts`: `before`, `additional`, `new total`, `month 3` |
| 2 | Ambiguous note -> work item `awaiting_clarification`, no proposal until confirmed | `packages/ledger-client/test/ledger.e2e.test.ts`: `control 2: ambiguous note -> awaiting_clarification, no new proposal`; `apps/agent/test/loop.test.ts`: `(a) ambiguous note -> openClarification + convex ask, no propose`, `(f) unflagged "another $50,000", no convention -> ...` |
| 3 | Same `postingRef` twice -> second `post` rejected | `ledger.e2e.test.ts`: `control 3: same postingRef twice -> duplicate_posting` |
| 4 | `post` from accountant identity -> rejected | `ledger.e2e.test.ts`: `control 4: post as accountant -> role` |
| 5 | New source while a proposal is open -> proposal `stale`, `decide` rejected | `ledger.e2e.test.ts`: `control 5: new source after propose -> stale; decide rejects stale` |
| 6 | "new total" answer -> 66.67% / +166,667 | `engine.test.ts`: `new total` |
| 7 | Month 3 with saved convention -> no clarification, convention cited | `loop.test.ts`: `(c) saved convention -> month-3 note proposes 3810 bp with no question`, `(g) unflagged "another $50,000" with convention -> ...`; `scripts/demo.ts` beat 9 (Convex `byWorkItem` count unchanged, explanation contains `another_means`) |

Also tested: `propose is idempotent per calculationId`, `closePeriod then post -> period_closed`, `addSource: invoice proposal (calculationId 0) survives, revenue proposal goes stale` (ledger e2e); `(d) same source delivered twice -> one propose`, `explain throws -> no calculation, no propose` (agent loop); `entries balance` (engine).

## Demo answer key

Must match to the dollar.

| Measure | Before | After ("additional") |
|---|---|---|
| Contract value | $1,000,000 | $1,000,000 |
| Eligible costs incurred | $400,000 | $400,000 |
| Estimated remaining costs | $400,000 | $600,000 |
| Estimated total costs | $800,000 | $1,000,000 |
| Progress (incurred ÷ total) | 50% | 40% |
| Cumulative revenue | $500,000 | $400,000 |
| Billed to date | $300,000 | $300,000 |
| Contract asset | $200,000 | $100,000 |
| Expected margin | $200,000 (20%) | $0 (0%) -> loss warning |

Proposed adjustment: Dr Revenue 100,000 / Cr Contract asset 100,000. "New total" branch: total 600,000, 66.7%, revenue 666,667, +166,667.

Month 3 ("another $50,000 for conveyor rework", convention `additional`): remaining 650,000, total 1,050,000, progress 38.10%, cumulative revenue 380,952, adjustment -19,048, margin -50,000 -> controller escalation.

Commissioning log with acceptance -> invoice proposal Dr Accounts receivable 200,000 / Cr Contract asset 200,000.

## Demo ordering notes for the UI

- Approve and post rev 2 before adding any new source (commissioning log or month-3 note). `add_source` marks the open revenue proposal `stale`, and `decide` rejects a stale proposal. Invoice proposals (`calculationId` 0) are not staled by a new source.
- Order: confirm -> rev 2 appears (about 0.5-1 s, the bridge polls every 1 s) -> approve -> post -> commissioning log -> invoice proposal -> month-3 note -> rev 3.
- Approve is two reducer calls back to back: `decide(approve)` then `post`. `decide(approve)` saves the pending convention.
- Rev 2 is a loss warning (margin $0 counts as a loss; explanation starts `ESCALATION:`). Narrate it as expected at 1:30.
- Each answered clarification is one Convex row. Month 3 creates none, so `clarifications.active` returns null after confirm and the phone page should go idle.
- The Convex `confirm` answer is normalized to `additional` / `new_total`; free text such as "it's additional" works. Text matching neither leaves the clarification open.
- Never hardcode ids: auto-increment sequences do not restart on `reset_demo`. Find the project by name, the work item by project, proposals by work item and revision.
- Phone audio: 16 kHz mono PCM16 WAV (44-byte header) uploaded via `generateUploadUrl`, then `submitAnswerAudio`. No webm/opus. Fallback: browser `SpeechRecognition` -> `confirm`.
- Stage reset: `pnpm demo --reset-only`.

## What is seeded vs live

Seeded (S0, `demo/seed.json`, restored by `reset_demo`): the Oakland deployment project ($1M contract), policy v3, contract, cost export, forecast v1, invoice, six historical close notes, the approved convention `remaining_estimate_means = future_costs_only` (examples from the six closes), the pending `acceptance` milestone ($200,000), and work item with proposal rev 1 already posted as `OAK-2026-09-R1`. Demo identities: `demo/identities.json` (accountant, deployment manager, controller, agent).

Live during the demo: the note, Claude's extraction, the clarification question and its audio, the manager's answer and transcript, the calculation, the explanation, rev 2 and rev 3 proposals, the approval and posting, the `another_means = additional` convention, the milestone invoice proposal, and every `history_event`.

Verified so far only with Claude and Cartesia mocked (`pnpm demo` passes twice from reset). Run `pnpm demo --require-real` once keys are set.

## Production gaps

- Accounting scope: one performance obligation, fixed price, cost-to-cost only. General ASC 606 is out of scope.
- No ERP connectors; sources are text rows.
- Auth is four fixed demo tokens and a role column. All SpacetimeDB tables are `public: true`. `demo/identities.json` holds bearer tokens.
- `seed` / `reset_demo` have no role check.
- `source.hash` is FNV-1a 32-bit: change detection, not tamper evidence.
- Escalation is a calculation `lossWarning` plus an `ESCALATION:` explanation prefix; there is no separate escalation record.
- Local Convex (`127.0.0.1:3210`) is not reachable from a phone; the demo needs a cloud Convex deployment.
