<p align="center">
  <img src="apps/landing/public/robaudit-logo.png" alt="Robaudit" width="180">
</p>

<h1 align="center">Robaudit</h1>

<p align="center"><b>Project-close accounting for robotics installs. Summo does the close; a person posts.</b></p>

<p align="center">
  <a href="https://www.robaudit.us">www.robaudit.us</a> ·
  <a href="https://www.robaudit.us/workbench">workbench</a> ·
  <a href="https://www.robaudit.us/phone">judge phone</a> ·
  <a href="https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX/?node-id=119-2">Figma designs</a> ·
  <a href="docs/devpost.md">Devpost text</a> ·
  <a href="docs/proof.md">proof</a>
</p>

<p align="center">
  <img src="apps/landing/public/summo-suit.png" alt="Summo, the Robaudit agent: a fuzzy green character in a charcoal suit" width="240">
</p>

## Meet Summo

Summo is the agent inside Robaudit. It fills the project accountant's revenue-close seat on fixed-price robotics installations recognized with cost-to-cost, and the part of the controller's week spent chasing deployment managers. It never takes the approver's seat.

What Summo does, every time a source lands:

1. **Reads** the field note, forecast sheet, phone photo or commissioning log. Two independent readers, Claude Opus 5.5 and Gemini 3.5 Flash Lite; a deterministic guard screens the text first.
2. **Asks** the deployment manager one question by phone when the wording is ambiguous or the readers disagree. Cartesia speaks it and transcribes the answer; the recording becomes evidence.
3. **Computes** progress, revenue, contract asset and margin with an engine in integer cents. No model output is ever a posted amount.
4. **Proposes** the adjusting entry with an explanation that cites its evidence and any convention it relied on. Gemini reviews it before the controller sees it.
5. **Waits.** The controller approves and posts, returns, or holds. Every call, including refused ones, is a row in the ledger. A confirmed answer the controller approves becomes a convention, and next month there is no call.

The ledger is SpacetimeDB. The phone call runs on Convex. Summo runs on Azure. Jira mirrors the work. Built at Cal Hacks 13.0 by a team of four; the company in the demo (Aster Robotics, Oakland project) is fictional and seeded from `demo/seed.json`.

## Live demo

| What | Where |
|---|---|
| Web app | https://www.robaudit.us: `/` landing with QR, `/workbench` controller's app, `/phone` deployment manager's page |
| Jira mirror | Project `SUMMO` on https://one-atlas-udgh.atlassian.net |
| Ledger | SpacetimeDB Maincloud, database `keel` (`wss://maincloud.spacetimedb.com`, https://spacetimedb.com/keel) |
| Phone channel | Convex production deployment `hushed-shrimp-24` (`https://hushed-shrimp-24.convex.cloud`) |
| Agent | Azure Container Apps `keel-agent` (resource group `keel-rg`) |

## Design (Figma)

All web design lives in one Figma file. Page 08 is the handoff workspace with every screen and state; the other pages are the path to it.

| Page | Link |
|---|---|
| 08 Design handoff: every landing, workbench and phone screen with notes | https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX/?node-id=119-2 |
| 07 Landing page | https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX/?node-id=41-2 |
| 02 Design system and selected screens | https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX/?node-id=0-1 |
| 03 Interactive prototype | https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX/?node-id=10-4 |
| 00 Problem and user journey | https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX/?node-id=10-2 |
| 01 UX explorations | https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX/?node-id=10-3 |
| 04 Design-to-code handoff | https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX/?node-id=10-5 |
| 05 Implemented UI round trip | https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX/?node-id=10-6 |
| 06 Workflow evidence and lessons | https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX/?node-id=10-7 |

File: https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX

## Tracks

One section per sponsor: what we use it for, where it lives, how to see it in the demo, the proof, and the honest limits.

### Hyphenate: The Hyphenated Enterprise, Autonomous Systems for Finance

- **What.** A System of Work on top of the Systems of Record: Summo does the revenue close across the ledger, the phone and the people. Self-learning on onboarding (a convention seeded from six past closes), self-improving from corrections (a confirmed answer becomes a convention when the controller approves), accountable (every action, decision and refusal is a row with an actor and a time). Agents propose, humans approve.
- **Where.** `apps/agent/src/agents/`, `packages/engine`, `spacetimedb/src/index.ts`.
- **See it.** Judge's note, phone rings, numbers move, controller approves. Month 3 runs with no call and cites the convention. Return a proposal with a reason: Summo acknowledges it on the record and the next revision opens with what it answers.
- **Proof.** `docs/proof.md` (16 planted errors with the answer key), engine and ledger tests, the nine-beat demo script asserting every figure against production.
- **Limits.** One controller plays reviewer and approver in the demo; the ledger has roles for two people.

### Spacetime: Best Use of Spacetime

- **What.** The ledger is the product: 15 tables, 17 reducers. Role, revision, staleness, period, balance, posting-ref uniqueness and refusal logging are enforced in the module, not in clients. Agent, workbench and phone subscribe live to the same Maincloud database.
- **Where.** `spacetimedb/src/{schema,index,guards}.ts`.
- **See it.** Workbench "Break it": approve as accountant, decide on a stale proposal, post twice. Each is refused with the reducer's message and lands as a `rejected` history row.
- **Proof.** `packages/ledger-client/test/ledger.e2e.test.ts` (11 controls against a running ledger).
- **Limits.** All tables are `public: true`; identities are four demo tokens.

### Convex: Best use of Convex

- **What.** The voice clarification call: `clarifications` and `transcriptSegments` tables with indexes, mutations that move a call through ringing, answering and confirmed, the Cartesia actions run through the `@convex-dev/action-retrier` component, file storage for both audio clips, HTTP routes and Convex Auth (anonymous) so each phone's answer is bound to a session, live subscriptions on the landing, workbench and phone pages. Convex never touches money.
- **Where.** `convex/{clarifications,voice,transcript,managers,auth,http}.ts`, `convex/convex.config.ts`, `hackathon.md`.
- **See it.** The phone rings and the transcript lands without a refresh; the footer shows `session: secure <id>`.
- **Proof.** `convex/test/channel.e2e.test.ts` (5, run against production).
- **Limits.** The UI is hosted on Azure, not Convex. Presence is a hand-written `managers` table.

### Cartesia: Best Use of Cartesia

- **What.** Voice is the channel. Sonic 3.6 speaks the question; Ink transcribes the answer over WebSocket; both run inside Convex actions so the key never reaches the browser, with retries. The manager's recording is the evidence behind the posted number.
- **Where.** `convex/voice.ts`.
- **See it.** The phone plays the question, the judge's answer is transcribed, and on Evidence the judge's own voice plays back. The ask screen says the answer is recorded and kept as evidence.
- **Proof.** `apps/landing/tests/phone.e2e.mjs` (7 scenarios with real Cartesia: reload, dropped connection, double taps, failed upload, stale question, mic denied, reduced motion).
- **Limits.** One short recorded answer per question, not a conversation; no Managed Agents.

### Microsoft: Built for the Real World

- **Customer understanding.** Two named seats and public evidence that the control problem exists (Symbotic's disclosed material weakness over cost-of-revenue timing). One filing, no customer interview.
- **Measurable usefulness.** One ambiguous word moves revenue by $266,667. A learned convention removes one phone call per month on the same project; a note becomes a proposed entry in under ten seconds with every figure traceable.
- **Prototype to production.** Summo on Azure Container Apps from a CI-built image, the web app on Azure Static Web Apps behind a custom domain, OCR on Azure AI Document Intelligence (`apps/agent/src/azure-di.ts`). Runbook in `infra/azure/containerapp.md`; restart-safe recovery; two known crash windows documented.
- **Responsible design.** Transparency (source spans on every fact, an explanation on every proposal), accountability (controller gate, roles in the ledger, refusals logged), reliability (deterministic engine, second reader, answer-key tests), privacy (the phone says the answer is recorded).
- **End to end.** Note or photo in, call, recompute, proposal, approval, post, Jira mirror, month 3 with no call. `pnpm demo --remote` runs it against the Azure agent. Claude is called directly, not through Azure AI Foundry.

### Atlassian: Agentic Workforce Challenge, Track 2

- **What.** An audit mirror for an agent that acts. A Forge app with one web trigger, fed by a bridge that subscribes to the ledger. Each Summo work item becomes a Jira issue in `SUMMO` when Summo asks a question; each proposal, approval, return, hold and posting becomes a comment and a column move, with labels for loss warnings and rework. Jira never writes to the ledger.
- **Where.** `apps/jira-forge/src/index.js`, `apps/jira-bridge/src/{main,event}.ts`.
- **See it.** Jira chips on Inbox rows, a Jira tab per project, the Connections and Agents pages, and the SUMMO board moving as Summo works.
- **Proof.** `apps/jira-bridge/test/event.test.ts`; the Forge app smoke-tested end to end on the demo site.
- **Limits.** No replay on bridge restart; agent events and refused attempts are not mirrored.

### MLH: Best Use of Gemini API

- **What.** Gemini 3.5 Flash Lite is an independent second reader on every source and a reviewer on every proposal (figures against the calculation, entry balanced, convention cited). When the readers disagree on the amount, Summo asks instead of guessing.
- **Where.** `apps/agent/src/gemini.ts`, `agents/reader-gemini.ts`, `agents/reviewer.ts`.
- **See it.** The `gemini` extraction row beside `claude`; "Reviewed by Gemini" on the proposal.
- **Proof.** `docs/eval-promptfoo.md` (Gemini 36/36); `apps/agent/test/gemini.test.ts`.
- **Limits.** Text only; on a timeout or 429 Summo continues on Claude alone by design.

### MLH: Best Domain from GoDaddy Registry

`robaudit.us`, a GoDaddy Registry TLD. The judge's phone lands on `www.robaudit.us/phone` from the QR code on the landing page.

### MLH: Commit Fellowship

A working prototype on a real accounting problem, with the proof in `docs/proof.md`. Requires opting in on Devpost and the supplemental form.

## How we use Convex

Convex runs the voice call between Summo and the manager's phone. The `clarifications` table and its mutations move a call through ringing, answering and confirmed; the `@convex-dev/action-retrier` component runs the Cartesia TTS and STT actions with retries; Convex Auth (anonymous) gives each phone a session, and `confirm` and `decline` require it; file storage holds the audio; the landing, workbench and phone pages subscribe live. Convex never touches money. Files, features and the commit log: [hackathon.md](hackathon.md).

## Architecture

Language, arithmetic and permission to write are kept apart. Each agent is an object with a name, a seat and a `may` list of ledger reducers (`apps/agent/src/bus.ts`); calling anything outside the list throws, and `post` is on no agent's list.

| Agent | Seat | Tools | May write |
|---|---|---|---|
| `guard` | Input control: screens every note before any model reads it | Deterministic rules (`apps/agent/src/agents/guard.ts`) | `record_extraction` (flag row only) |
| `summo` | Coordinator, project accountant | Routes each source through the others (`agents/summo.ts`) | `record_calculation`, `propose`, `open_work_item`, `mark_milestone_met` |
| `reader-claude` | Reader A | Claude `claude-opus-5-5` (`extract.ts`) | `record_extraction` |
| `reader-gemini` | Reader B, independent | Gemini `gemini-3.5-flash-lite` (`gemini.ts`), 5 s cap | `record_extraction` |
| `document-reader` | Scanning clerk | Azure AI Document Intelligence (`azure-di.ts`) | `record_extraction` |
| `reconciler` | Sheet vs cost export on incurred; cost export wins | Code, no model (`agents/reconciler.ts`) | nothing |
| `field-liaison` | Asks the site and brings the answer back | Convex + Cartesia (`agents/field-liaison.ts`) | `open_clarification`, `resolve_clarification` |
| `engine` | Calculator | `@keel/engine`, integer cents, no I/O | nothing |
| `explainer` | Writes the memo; any $-figure not derived from the inputs is replaced by a template | Claude (`agents/explainer.ts`) | nothing |
| `learner` | Proposes conventions from past closes | Claude (`learn.ts`); not wired into the live loop | nothing |
| `reviewer` | Checks figures, balance and cited convention before the controller sees it | Gemini (`agents/reviewer.ts`), 5 s cap | nothing (log only) |
| `jira-mirror` | Keeps the Jira tracker current | Atlassian Forge web trigger (`apps/jira-bridge`, `apps/jira-forge`) | `log_agent_event` only |
| posting guard | The `post` reducer: controller role, approved, current revision, period open, balanced, unique posting ref | SpacetimeDB (`spacetimedb/src/index.ts`) | the ledger itself |

Every agent step is written to the `agent_event` table and shown on `/workbench/agents`.

```
  phone (/phone) ── note / photo / voice answer ──▶ Convex (clarifications, storage, Cartesia actions)
        │                                                     ▲            │ confirmed answer
        │ add_source                                   ask    │            ▼
        ▼                                             field-liaison ◀── poll
  SpacetimeDB ledger ──subscribe──▶ Summo ──▶ guard ──▶ reader-claude ┐
   (reducers, roles,                  │      (flag→stop)  reader-gemini ┼─▶ agree? ── no ──▶ ask
    history_event,                    │                  document-reader┘ + reconciler
    agent_event)                      ▼
        ▲                          engine ──▶ explainer ──▶ reviewer ──▶ propose (rev N)
        │                                                                     │
        │  decide(approve|return|hold), post  ◀── controller (/workbench) ◀───┘
        │
        └─ work_item changes ──▶ jira-bridge ──▶ Forge web trigger ──▶ Jira SUMMO (mirror; never writes back)

  every agent step ──▶ agent_event        every reducer call ──▶ history_event
```

## Proof it works

- [docs/proof.md](docs/proof.md): what is real vs simulated, 16 planted errors with the answer key and the test that pins each, live run log.
- [docs/eval-promptfoo.md](docs/eval-promptfoo.md): independent Promptfoo harness, 79/79 (Claude 36/36, Gemini 36/36, engine 7/7).
- [docs/benchmark.md](docs/benchmark.md): `pnpm bench` through the live multi-agent loop: reading 20/20, planted errors 11/11, 0 chain violations in 22 proposals, confirm → compute p50 0.77 s.
- Tests: engine 8, ledger 11, agent 120 (plus 7 skipped without keys), jira-bridge 3, Convex 5, phone e2e 7 scenarios.

## Run it

Prerequisites: Node 20, pnpm 10, the `spacetime` CLI (2.13), a Convex account. Copy `.env.example` to `.env`.

`.env` keys: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL` (optional), `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID`, `AZURE_DI_ENDPOINT`, `AZURE_DI_KEY`, `CONVEX_URL`, `STDB_URI`, `STDB_DB`, `STDB_AGENT_TOKEN` (container only), `JIRA_WEBTRIGGER_URL`, `SUMMO_WEBHOOK_SECRET`. Web (`.env.local`): `VITE_STDB_URI`, `VITE_STDB_DB`, `VITE_CONVEX_URL`, `VITE_JIRA_SITE` (optional). Cartesia runs inside Convex, so also `npx convex env set CARTESIA_API_KEY <key>`. Without `ANTHROPIC_API_KEY` the agent runs in mock mode.

Local stack, in order (each long-running command in its own terminal):

```sh
pnpm install
spacetime start                              # or: pnpm stdb:start
pnpm stdb:publish                            # publishes keel-local, wipes data
npx convex dev                               # writes CONVEX_URL to .env.local
pnpm agent                                   # Summo
pnpm --filter @keel/jira-bridge start        # optional Jira mirror
pnpm --filter @keel/web dev                  # web app
```

Tests:

```sh
pnpm test                                    # all workspace packages
pnpm --filter @keel/ledger-client test       # needs spacetime running + published; resets the db
pnpm test:convex                             # needs npx convex dev
pnpm --filter @keel/web test:phone           # needs ledger, Convex and a running agent
pnpm eval                                    # Promptfoo, real Claude + Gemini
pnpm bench                                   # scratch db keel-bench only
```

Demo script (asserts every figure in nine beats, exits 1 on mismatch):

```sh
pnpm demo                  # runs the agent in-process; do not run alongside pnpm agent
pnpm demo --require-real   # fails if Claude or Cartesia is mocked
pnpm demo --remote         # a deployed agent is connected; skips the in-process loop
pnpm demo --reset-only     # reset to S0 and assert it; use between judges
```

The ledger, Convex and phone e2e tests reset the shared database. Do not run them during a live demo.

**Local database name:** the laptop fallback ledger is `keel-local` (`.env` STDB_DB, `.env.local` VITE_STDB_DB); Maincloud is `keel`. The old local `keel` is orphaned by an identity change and should not be used.

## Stage start order (day of)

1. Check services: Azure agent healthy (`az containerapp revision list -n keel-agent -g keel-rg`), Maincloud answers (`spacetime sql keel "select count(*) from proposal" --server maincloud`), Convex prod reachable.
2. Laptop opens the Azure URL, not localhost, so the QR encodes the public phone URL.
3. Phone opens `/phone`.
4. Start the Jira bridge on the laptop with `STDB_URI`/`STDB_DB` pointing at Maincloud plus `JIRA_WEBTRIGGER_URL` and `SUMMO_WEBHOOK_SECRET`: `pnpm --filter @keel/jira-bridge start`.
5. Identities: role tokens differ per server. Keep `demo/identities.local.json` and `demo/identities.maincloud.json`; `cp demo/identities.maincloud.json demo/identities.json`.
6. Reset between judges: `pnpm demo --reset-only`.
7. Fallbacks, in order: Convex dev (`https://lovely-squirrel-569.convex.cloud`); laptop agent `until pnpm agent; do sleep 1; done` (only after stopping the Azure one, never both); local SpacetimeDB; the video.

If a beat stalls, restart the agent; recovery is restart-safe except two crash windows: between `record_calculation` and `propose`, and between Convex `ask` and `open_clarification`.

## Repo map

| Path | What |
|---|---|
| `apps/agent` | `@keel/agent`: Summo and the other agents, Claude/Gemini/Azure DI clients, Dockerfile |
| `apps/landing` | `@keel/web`: Vite multi-page app (`/`, `/workbench`, `/phone`), phone e2e |
| `apps/jira-bridge` | `@keel/jira-bridge`: ledger subscriber that POSTs work-item changes to Forge |
| `apps/jira-forge` | Atlassian Forge app (one web trigger) |
| `apps/harness` | Unstyled dev harness, one button per demo beat |
| `packages/engine` | `@keel/engine`: cost-to-cost arithmetic, integer cents |
| `packages/ledger-client` | `@keel/ledger-client`: SpacetimeDB connection by role, ledger e2e tests |
| `packages/bindings` | Generated SpacetimeDB TypeScript bindings (`pnpm stdb:gen`) |
| `spacetimedb` | Ledger module: schema, reducers, seed |
| `convex` | Clarification channel, Cartesia actions, auth, e2e test |
| `eval` | Promptfoo config, provider and grader |
| `scripts` | `demo.ts`, `bench.ts` |
| `demo` | Seed data and demo identities |
| `infra/azure` | Container Apps runbook |
| `docs` | Proof, eval, benchmark, demo flow, frontend guide, Devpost text, sponsors |

## Team and naming

Robaudit is the platform. Summo is the agent. `keel` is the code codename: `@keel/*` packages, the SpacetimeDB database `keel`, and the `keel-*` Azure resources.
