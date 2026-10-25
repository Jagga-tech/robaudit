# Sponsors and tracks: Robaudit (Cal Hacks 13.0)

One section per track entered. Each lists the sponsor's stated criteria (from the Devpost prize blurbs), what we built with code paths, where the judge sees it, and the gaps we know. Test counts and run results are in [proof.md](proof.md), [eval-promptfoo.md](eval-promptfoo.md) and [benchmark.md](benchmark.md). Live app: https://kind-river-0eb9d010f.5.azurestaticapps.net (`/`, `/workbench`, `/phone`).

## Cal Hacks general criteria

| Criterion | Evidence |
|---|---|
| Application | Revenue close on fixed-price robotics installs (cost-to-cost). Public evidence: Symbotic's disclosed material weakness over cost-of-revenue timing (quoted in `docs/devpost.md`). |
| Intentionality | Language, arithmetic and permission to write are separated: models read and explain, `packages/engine` computes, only the controller can `post` (`spacetimedb/src/index.ts`). Each agent has a `may` list enforced in `apps/agent/src/bus.ts`. |
| Functionality | Deployed end to end (Azure agent, Maincloud ledger, Convex prod, Azure Static Web Apps). `pnpm demo` asserts every figure in nine beats; live runs in `docs/proof.md` §4. |
| Creativity | The field channel is a phone call whose recording becomes evidence on the entry; conventions learned from approvals stop the next call; the commissioning log triggers a milestone invoice. |
| Technical complexity | 12 agents plus a posting guard, two ledgers of record (SpacetimeDB for money, Convex for the call), 16 reducers, two independent model readers, OCR with reconciliation, Forge mirror. Tests: engine 8, ledger 11, agent 120, jira-bridge 3, Convex 5, phone e2e 7 scenarios; Promptfoo 79/79; bench 0 chain violations. |

## Hyphenate: The Hyphenated Enterprise: Autonomous Systems for Finance

**Criteria.** Four questions: is it real enough, would you hire it, did we see something new, and the moment.

**What we built.**
- Real enough: the real/simulated split is in `docs/proof.md` §1. Real: Claude, Gemini, Cartesia, Azure Document Intelligence, SpacetimeDB Maincloud, Convex prod, Azure Container Apps. Simulated: the company and its data (`demo/seed.json`).
- Would you hire it: Summo holds the `agent` role only. Amounts come from `packages/engine` and from `parseAmountCents` (figures that appear in the source text). The explainer replaces any $-figure not derived from the inputs with a template (`apps/agent/src/agents/explainer.ts`). It asks when wording is ambiguous, readers disagree, the amount is spelled out, or savings exceed the remaining forecast (`agents/summo.ts`, `docs/proof.md` rows 1, 7, 8, 11). Losses escalate with an `ESCALATION:` explanation. Untrusted notes are screened by `agents/guard.ts`.
- Sources that disagree: the reconciler compares the photographed sheet with the cost export and books on the cost export, saying so in the explanation (`agents/reconciler.ts`, `apps/agent/test/azure-di.test.ts`).
- Something new: conventions are learned and cited, not retrained. The seeded convention comes from six past closes; approving a proposal saves `another_means = additional` (`decide` in `spacetimedb/src/index.ts`), and month 3 runs with no call.
- The moment: judge sends a note, Claude and Gemini flag "another", Summo rings the judge's phone, numbers move within about a second of the answer (`docs/benchmark.md` confirm → compute p50 0.77 s).

**Where the judge sees it.** `/phone` (send a note, answer the call), `/workbench` project page (figures move, proposal with "Reviewed by Gemini", Approve / Return / Hold), `/workbench/agents` (agent_event chain), `/workbench/audit` (history, CSV export), `/workbench/policies` (conventions).

**Gaps we know.**
- One controller reviews and approves in the demo; the roles for two people exist in the ledger.
- A controller Return or Hold is recorded with its reason, but Summo does nothing after it; the next source produces the next revision.
- Rejected reducer calls (wrong role, duplicate post, stale decide) roll back and leave no `history_event` row.
- `learner` is not wired into the live loop; the S0 convention is seeded.

## Spacetime: Best Use of Spacetime

**Criteria.** Most impressive use of SpacetimeDB.

**What we built.** SpacetimeDB is the ledger and the system of record: 15 tables (`spacetimedb/src/schema.ts`) and 16 reducers (`spacetimedb/src/index.ts`). Controls are reducers, not UI checks: `requireRole` (`guards.ts`), `add_source` marks open revenue proposals `stale`, `decide` refuses stale or non-current revisions and saves the pending convention on approve, `post` checks role, approval, revision, open period, balance and unique posting ref in that order. The agent, the Jira bridge, the workbench and the phone all subscribe to the same database; `agent_event` and `history_event` are the audit trail.

**Where the judge sees it.** Workbench and phone update live from one subscription. "Break it" buttons: approve as the accountant (`role: requires controller, caller is accountant`), change the forecast after approval (`stale`), post it again (`duplicate_posting`). Maincloud dashboard https://spacetimedb.com/keel.

**Gaps we know.** All tables are `public: true`; auth is four fixed demo tokens. `seed` / `reset_demo` have no role check. `source.hash` is FNV-1a 32-bit (change detection, not tamper evidence).

## Convex: Best use of Convex

**Criteria.** Live queries, components, actions, file storage.

**What we built.** Convex runs the voice clarification call; it never touches money.
- Live queries: the phone subscribes to `clarifications.active`, `transcript.byClarification`, `managers.current`; landing and workbench subscribe to `managers.current` (`apps/landing/src/{phone,landing,shell}.ts`). The agent reads `clarifications.byWorkItem` to bring answers into the ledger.
- Mutations: `ask`, `startAnswer`, `confirm`, `decline`, `fallbackText`, `resetOpen`, `generateUploadUrl`, `submitAnswerAudio` (`convex/clarifications.ts`); `managers.join` / `leave` (`convex/managers.ts`).
- Actions: `voice.speakQuestion` (Cartesia TTS) and `voice.transcribe` (Cartesia STT) (`convex/voice.ts`).
- Component: `@convex-dev/action-retrier` wraps both Cartesia actions (`convex/convex.config.ts`, `convex/clarifications.ts`).
- File storage: question audio, answer audio and photographed forecast sheets.
- Auth: Convex Auth with the Anonymous provider (`convex/auth.ts`, `convex/http.ts`); the phone signs in before calling mutations (`apps/landing/src/lib/convex.ts`).

**Where the judge sees it.** Scanning the QR shows "<Name> joined" on the laptop; the phone rings; the transcript appears on the phone without refresh; Evidence plays the judge's recording from Convex storage.

**Gaps we know.** The UI is hosted on Azure, not Convex. Presence is a hand-written `managers` table, not the presence component. `hackathon.md` header predates the component and Auth and still says "none" for both. Auth is verified in code and tests, not separately on the prod dashboard.

## Cartesia: Best Use of Cartesia

**Criteria.** Best use of Cartesia.

**What we built.** Sonic (`sonic-3.6`) speaks Summo's question; Ink (`ink-2`, websocket, 16 kHz PCM) transcribes the judge's answer. Both run as Convex actions (`convex/voice.ts`) with retries. The recording and transcript are stored and linked from the ledger's `clarification_ref`, so the voice is evidence on the posted entry.

**Where the judge sees it.** `/phone`: ringing screen, question plays, record, transcript, "That's right". Workbench Evidence: click the figure and play the judge's own answer.

**Gaps we know.** STT is only exercised from the phone page. Phone audio is WAV only (no webm/opus). Fallback is browser speech recognition or typed text.

## Microsoft: Built for the Real World

**Criteria.** Customer understanding, measurable usefulness, prototype-to-production, responsible design, end-to-end (rubric per `docs/track-todo.md`).

**What we built.**
- Prototype-to-production: Summo runs on Azure Container Apps `keel-agent` (image built by `.github/workflows/build-agent-image.yml`, runbook `infra/azure/containerapp.md`); the web app deploys to Azure Static Web Apps (`.github/workflows/deploy-web.yml`).
- Azure AI Document Intelligence reads printed and photographed forecast sheets (`apps/agent/src/azure-di.ts`, `agents/document-reader.ts`); the reconciler records sheet-vs-ledger disagreement.
- Responsible design: transparency (source spans, explanation, agent_event log), accountability (controller gate, history log), reliability (engine tests, second reader, reviewer, input guard).
- Measurable: confirm → compute p50 0.77 s; month 3 needs no call (`docs/benchmark.md`).
- End-to-end: phone note → proposal → post, asserted by `pnpm demo --remote` against the Azure agent.

**Where the judge sees it.** The live URL; phone "Photograph the forecast sheet" and the `azure-di` row; Connections page.

**Gaps we know.** Customer understanding rests on one SEC filing, no interviews. No "hours saved" figure. Claude is called directly, not through Azure AI Foundry. `docs/devpost.md` does not yet have the five capabilities as headings.

## Atlassian: Best Agent (Track 2, audit mirror)

**Criteria.** Indicate which track in the submission.

**What we built.** `apps/jira-bridge` subscribes to the ledger and POSTs each work-item status change to a Forge web trigger (`apps/jira-forge/src/index.js`), which creates an issue in project `SUMMO` and adds comments and column moves: question asked, proposal with entry and explanation (label `loss-warning`), approval, return/hold (label `needs-rework`), posting. The bridge logs each mirror as `agent_event` `jira-mirror`. Jira never posts to the ledger.

**Where the judge sees it.** https://one-atlas-udgh.atlassian.net project SUMMO; workbench Inbox chips, a Jira tab per project, Connections ("Jira (Atlassian Forge)"), and `jira-mirror` on the Agents page.

**Gaps we know.** No replay on bridge restart. `agent_event` rows and rejected attempts are not mirrored. The bridge runs on the laptop, not in Azure.

## MLH: Best Use of Gemini API

**Criteria.** Push the boundaries of what Gemini can do.

**What we built.** `gemini-3.5-flash-lite` has two roles: independent second reader (`agents/reader-gemini.ts`) whose disagreement on the amount forces a question, and reviewer (`agents/reviewer.ts`) that checks each proposal's figures, balance and cited convention with JSON-schema output before the controller sees it.

**Where the judge sees it.** The `gemini` extraction row beside `claude`; "Reviewed by Gemini" on the proposal; Agents page.

**Gaps we know.** Free-tier key: timeouts and 429s occur, and Summo continues on Claude alone by design (5 s cap). No multimodal call; photos go to Azure DI. The Gemini rows only appear when `GEMINI_API_KEY` is set.

## MLH: Commit Fellowship Prize Category

**Criteria.** A working prototype that solves a real problem; opt in on Devpost and submit the supplemental form.

**What we built.** The deployed prototype above, on a problem documented in a public SEC filing.

**Gaps we know.** Opt-in and the form are manual steps outside the repo (`docs/devpost.md` checklist).
