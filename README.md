# Robaudit

Robaudit keeps revenue current on fixed-price robotics installations recognized with cost-to-cost. It is used by three people: the project accountant (whose revenue-close work Summo does), the controller (who approves and posts), and the deployment manager on site (who answers Summo's questions from a phone). Summo, the agent, reads field notes, cost forecasts, photographed forecast sheets and commissioning logs; asks the deployment manager one question by voice when the wording is ambiguous or two readers disagree; recomputes progress and revenue with a deterministic engine in integer cents; and proposes an adjusting entry with an explanation. Summo never posts, and no model output is ever a posted amount: the ledger refuses `post` from anyone but the controller.

Built at Cal Hacks 13.0. Design: `docs/superpowers/specs/2026-10-24-keel-design.md`. Submission text: `docs/devpost.md`. Sponsor-by-sponsor detail: [docs/sponsors.md](docs/sponsors.md).

## Live demo

| What | Where |
|---|---|
| Web app | https://kind-river-0eb9d010f.5.azurestaticapps.net: `/` landing with QR, `/workbench` controller's app, `/phone` deployment manager's page |
| Jira mirror | Project `SUMMO` on https://one-atlas-udgh.atlassian.net |
| Ledger | SpacetimeDB Maincloud, database `keel` (`wss://maincloud.spacetimedb.com`, https://spacetimedb.com/keel) |
| Phone channel | Convex production deployment `hushed-shrimp-24` (`https://hushed-shrimp-24.convex.cloud`) |
| Agent | Azure Container Apps `keel-agent` (resource group `keel-rg`) |

The company (Aster Robotics), its Oakland project and its data are fictional and seeded from `demo/seed.json`.

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

## Sponsors and tracks

| Track | What we use it for | Where in the code | How to see it in the demo | Proof | Honest notes |
|---|---|---|---|---|---|
| Hyphenate: The Hyphenated Enterprise: Autonomous Systems for Finance | Summo fills the project accountant's revenue-close seat; controller keeps sign-off | `apps/agent/src/agents/`, `packages/engine`, `spacetimedb/src/index.ts` | Judge's note → phone rings → numbers move → controller approves; month 3 runs with no call and cites the convention | `docs/proof.md` §2 (16 planted errors) | One controller plays reviewer and approver in the demo; the ledger has the roles for two people. A controller Return/Hold is recorded, but Summo does not act on it yet. |
| Spacetime: Best Use of Spacetime | The ledger: 15 tables, 16 reducers; controls are reducers | `spacetimedb/src/{schema,index,guards}.ts` | Workbench "Break it": approve as accountant, stale after new source, post twice; all refused with the reducer's message | `packages/ledger-client/test/ledger.e2e.test.ts` (11) | All tables are `public: true`; auth is four fixed demo tokens. Rejected calls roll back and leave no history row. |
| Convex: Best use of Convex | The voice clarification call: live queries, mutations, actions, file storage, `action-retrier` component, Convex Auth (Anonymous) | `convex/{clarifications,voice,transcript,managers,auth}.ts`, `convex/convex.config.ts` | Phone rings and the transcript lands without refresh; "<Name> joined" on the laptop | `convex/test/channel.e2e.test.ts` (5) | Convex never touches money; the UI is hosted on Azure, not Convex. Presence is a hand-written `managers` table, not the presence component. |
| Cartesia: Best Use of Cartesia | Speaks the question (Sonic `sonic-3.6`), transcribes the answer (Ink `ink-2`); the recording becomes evidence | `convex/voice.ts` | Phone plays the question; the judge's answer is transcribed; Evidence plays the judge's voice back | `apps/landing/tests/phone.e2e.mjs` (7 scenarios, real Cartesia) | STT is only exercised from the phone page. |
| Microsoft: Built for the Real World | Summo runs on Azure Container Apps; web app on Azure Static Web Apps | `apps/agent/Dockerfile`, `infra/azure/containerapp.md`, `.github/workflows/{build-agent-image,deploy-web}.yml` | Live URL above; `pnpm demo --remote` against the Azure agent | `docs/proof.md` §4 (remote runs) | Customer understanding rests on one public SEC filing, no customer interview. |
| Microsoft: Azure AI Document Intelligence | OCR of printed and photographed forecast sheets; reconciler records sheet vs cost-export disagreement | `apps/agent/src/azure-di.ts`, `agents/document-reader.ts`, `agents/reconciler.ts` | Phone "Photograph the forecast sheet"; the `azure-di` extraction row and disagreement line | `apps/agent/test/azure-di.test.ts`, `azure-di-photo.test.ts`; `docs/benchmark.md` §B | Claude is called directly, not through Azure AI Foundry. |
| Atlassian: Best Agent (Track 2, audit mirror) | Every ask, proposal, approval, return and post lands in Jira `SUMMO` with its reasoning | `apps/jira-forge/src/index.js`, `apps/jira-bridge/src/{main,event}.ts` | Jira chips on Inbox rows, Jira tab per project, Connections and Agents pages; the SUMMO board | `apps/jira-bridge/test/event.test.ts` (3) | Jira never posts to the ledger. No replay on bridge restart; rejected attempts are not mirrored. |
| MLH: Best Use of Gemini API | Independent second reader and proposal reviewer | `apps/agent/src/gemini.ts`, `agents/reader-gemini.ts`, `agents/reviewer.ts` | `gemini` extraction row beside `claude`; "Reviewed by Gemini" on the proposal; readers disagree → Summo asks | `docs/eval-promptfoo.md` (Gemini 36/36); `apps/agent/test/gemini.test.ts` | Free-tier key: timeouts and 429s happen; Summo continues on Claude alone by design. Text only, no multimodal call. |
| MLH: Commit Fellowship Prize Category | Working prototype on a real accounting problem | whole repo | Live URL above | `docs/proof.md` | Requires opting in on Devpost and the supplemental form. |

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
