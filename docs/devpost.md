# Devpost submission: Robaudit

**Project name:** Robaudit (Cal Hacks 13.0). The agent inside it is named Summo.

**Tagline:** An accounting agent that keeps robotics project revenue current, asks the one question it needs by phone, and leaves posting to the controller.

**Seats:** Fills the project accountant's revenue-close seat and the part of the controller's week spent chasing deployment managers. Never the approver's seat.

**Live:** https://www.robaudit.us (workbench at `/workbench`, judge phone at `/phone`). Repo: https://github.com/Jagga-tech/robaudit. Jira mirror: project SUMMO on https://one-atlas-udgh.atlassian.net.

## The moment

A judge scans a QR code and sends a site update in their own words: "we need another 200k to finish."
Two independent readers, Claude and Gemini, flag the same problem: "another" could mean added cost or a new total, and the answer moves revenue by $266,667.
Summo rings the judge's phone and asks one question. The judge answers.
Within about a second the books move: progress 50% to 40%, revenue $500,000 to $400,000, margin to $0 with a loss warning. The controller approves and posts.
Two minutes later someone asks where $400,000 came from. One click on the figure plays the judge's own voice from the audit trail.
Then we try to break it: approve as the accountant, change the forecast after approval, post the same entry twice. The ledger refuses each one and says why.

## Is it real enough?

**The company.** Aster Robotics is fictional and labelled as such. It is installing a warehouse robot system in Oakland under a $1,000,000 fixed-price contract, recognized with cost-to-cost under policy v3. The record holds six past closes, printed forecast sheets with four different figures, and commissioning logs that trigger a milestone invoice.

**Real at judging:** the SpacetimeDB Maincloud ledger, the Convex production channel, Summo running on Azure Container Apps, Claude Opus 5.5 and Gemini 3.5 Flash Lite as readers, Cartesia Sonic and Ink for voice, and Azure Document Intelligence for OCR of photographed sheets.

**Simulated:** the company and its data.

**How we know it works:**
- Engine answer key, to the dollar: the "additional" branch, the "new total" branch, and month 3.
- 10 ledger control tests against a running ledger: wrong role, duplicate posting, stale proposal, closed period, idempotent proposals.
- 20 freeform site-update phrasings, 20/20 on three real-API runs.
- 7 phone-robustness scenarios (reload, dropped connection, double taps, failed upload, stale question, reduced motion) against real Convex and Cartesia.
- The nine-beat demo script, which asserts every figure, run against production with all services real.
- Azure Document Intelligence read all four printed sheets.
- Full evidence (planted errors with answer key, test set, live runs): [docs/proof.md; independent Promptfoo run docs/eval-promptfoo.md (79/79 on Claude and Gemini); internal benchmark docs/benchmark.md](proof.md).

Public evidence. Symbotic, a warehouse-automation company, disclosed a material weakness in controls over the timing of cost-of-revenue recognition, which also affected revenue timing, still described in its quarter ended June 27, 2026 (SEC filing); its auditor earlier called deployment revenue estimates a critical audit matter (10-K). This proves the accounting problem exists at a major robotics company; it does not prove Symbotic would buy this.

## Would you hire it?

**Limits.** Summo holds the agent role and nothing else. The ledger refuses `post` from anyone but the controller. No model output is ever a posted amount: amounts come from a deterministic engine (integer cents) and from a parser that only accepts figures that appear in the source text.

**Clean record.** Every row carries an actor, a time and its evidence. Posted entries are never edited; later evidence produces a new adjustment. Refused attempts are on the record too: a duplicate posting, a post from the wrong role, a decision on a stale proposal or a closed period each write a `rejected` row with who tried it. The audit trail exports to CSV.

**Knows when to ask.** Summo stops and asks the deployment manager when the wording is ambiguous, when the two readers disagree on the amount, when the amount is spelled out in words, and when claimed savings are larger than the remaining forecast. Loss contracts are escalated to the controller with an explanation that starts with `ESCALATION:`.

**Handles a no.** The controller can Return or Hold a proposal with a reason. It stays unposted, Summo acknowledges the reason on the record and waits, and the next piece of evidence produces the next revision, whose explanation opens with what it answers: "Rework of rev 2, returned by Dana: check the forecast date."

**Segregation of duties.** In the demo one controller reviews and approves. In production those are two people, and the roles already exist in the ledger.

**Time.** A convention learned from the six past closes tells Summo how to read a "Remaining Estimate" on a forecast sheet. A convention saved when the controller approves an answer ("another means additional") is cited the next month, and Summo does not call again.

## Did we see something new?

- An installed robot system produces its own acceptance evidence: the commissioning log marks the milestone met and Summo proposes the invoice.
- The field channel is a phone call, and its transcript and recording become evidence on the entry.
- Summo learns through scoped, versioned precedents approved by a person, not through retraining.

## Inspiration

Robotics companies that install million-dollar systems recognize revenue as work progresses. Every forecast change or field note ("we need another $200,000") moves revenue, and someone has to work out what the note means, recompute, and book an adjustment. One ambiguous word changes the answer by a quarter of a million dollars, and the person who knows the answer is on a factory floor, not in the ledger.

## What it does

Robaudit is a System of Work for project-close accounting, built on top of the Systems of Record it writes into. Summo reads each new source (field note, forecast sheet, phone photo, commissioning log), asks the deployment manager one question by phone when the wording is ambiguous or its two readers disagree, recomputes progress and revenue with a deterministic engine, and proposes the adjusting entry with its evidence. The controller approves and posts. Conventions confirmed once and approved by the controller are cited next month instead of asked again.

## How we built it

Language, arithmetic and permission to write are kept apart. Claude Opus 5.5 and Gemini 3.5 Flash Lite read and explain, never compute. A TypeScript engine in integer cents computes. SpacetimeDB reducers enforce who may write what. Convex runs the phone call with Cartesia Sonic and Ink inside it. Azure Document Intelligence reads photographed sheets. Each agent is a named object with a seat, the tools it may use and the reducers it may call; every step lands in an `agent_event` row. A Forge app mirrors the work into Jira. The agent runs on Azure Container Apps, the web app on Azure Static Web Apps.

## Challenges we ran into

- Rounding: revenue is computed on the exact ratio in `bigint` with round-half-up to the dollar. Computing from rounded basis points (66.67%) would give 666,700 instead of 666,667.
- Staleness: new evidence must invalidate an open revenue proposal without invalidating a milestone invoice.
- Restart safety: the agent must never double-propose a source it has already handled.
- Refusals leave no trace: a rejected reducer rolls back, so the caller records the refusal in a separate row.
- Phone audio into a format a Convex action can stream to speech-to-text without transcoding.

## Accomplishments that we're proud of

- The figures match an independent answer key to the dollar, and the nine-beat demo asserts them against production with every service real.
- Every control is a test: duplicate posting, wrong role, stale proposal, closed period, idempotent propose, and now the refusal rows.
- The judge's own voice is the evidence behind a posted number.

## What we learned

Most of the work in an accounting agent is deciding what the model is not allowed to do. Robaudit learns conventions from confirmed answers, once the controller approves them, not from model weights.

## What's next

Multiple performance obligations and variable consideration, ERP connectors, real identity for each seat, approve-from-Jira, and more convention types learned from historical closes.

## Tracks

- Hyphenate — The Hyphenated Enterprise: Autonomous Systems for Finance. Verify: send a note from `/phone`, answer the call, watch the figures move on the `/workbench` project page; the agent chain is on `/workbench/agents`; the planted errors are in `docs/proof.md`.
- Spacetime — Best Use of Spacetime. Verify: the controls are reducers in `spacetimedb/src/index.ts` (`decide`, `post`, `add_source`); the workbench "Break it" buttons show each refusal (wrong role, stale, duplicate posting).
- Convex — Best use of Convex. Verify: `convex/` (live queries, mutations, Cartesia actions, file storage, `action-retrier` component in `convex/convex.config.ts`, Anonymous auth); the phone rings and the transcript streams without a refresh.
- Cartesia — Best Use of Cartesia. Verify: `convex/voice.ts` (Sonic speaks the question, Ink transcribes the answer); on Evidence, click the figure and the judge's own answer plays.
- Microsoft — Built for the Real World. Verify: Summo runs on Azure Container Apps (`infra/azure/containerapp.md`); photograph a forecast sheet on `/phone` and the Azure Document Intelligence row appears (`apps/agent/src/azure-di.ts`).
- Atlassian — Best Agent. Submitting for: Best Agent (Track 2, audit mirror): every ask, proposal, return and post lands in Jira project SUMMO with its reasoning; Jira never posts to the ledger. Verify: `apps/jira-forge` + `apps/jira-bridge`; in the workbench, Inbox chips, a Jira tab per project, Connections and Agents.
- MLH — Commit Fellowship Prize Category. Verify: the live prototype and `docs/proof.md` (opt in on Devpost and submit the supplemental form).
- MLH — Best Use of Gemini API. Verify: `apps/agent/src/agents/reader-gemini.ts` and `reviewer.ts`; the `gemini` extraction row beside `claude` and "Reviewed by Gemini" on the proposal.

## Sponsor tracks, in each judge's own terms

### Hyphenate: The Hyphenated Enterprise

A System of Work, not a System of Record: Summo does the close across the ledger, the phone and the people, and writes into SpacetimeDB as the record. Self-learning on onboarding (a convention seeded from six past closes), self-improving from corrections (the manager's confirmed answer becomes a convention when the controller approves), and accountable: every action, every refusal and every controller decision is a row with an actor and a time. Agents propose, humans approve. Sources that disagree (a photographed sheet against the cost export) are reconciled with the system of record winning and the difference stated. Seats, proof and the moment are above.

### Microsoft: Built for the Real World

- **Customer understanding.** Fixed-price robotics installs recognized with cost-to-cost, two named seats (deployment manager, controller), and public evidence that the control problem exists (Symbotic's disclosed material weakness). One filing, no customer interview; we say so.
- **Measurable usefulness.** One ambiguous word moves revenue by $266,667. In the demo, the learned convention removes one phone call per month on the same project, and a note becomes a proposed entry in under ten seconds with every figure traceable.
- **Path from prototype to production.** Summo runs on Azure Container Apps from an image built in CI, the web app on Azure Static Web Apps behind a custom domain, OCR on Azure AI Document Intelligence. A deployment runbook, restart-safe recovery, and the two known crash windows documented.
- **Responsible design.** Responsible AI as controls: transparency (every fact carries a source span, every proposal an explanation), accountability (controller gate, roles enforced in the ledger, refusals logged), reliability (deterministic engine, independent second reader, answer-key tests), privacy (the phone says the answer is recorded and kept as evidence).
- **End-to-end functionality.** Note or photo in, phone call, recompute, proposal, approval, post, Jira mirror, month 3 with no call.

### Spacetime: Best Use of Spacetime

The ledger is the product. 15 tables and 17 reducers; `decide`, `post`, `add_source` and `record_rejection` are the controls. Role, revision, staleness, period, balance and posting-ref uniqueness are enforced in the module, not in the client. Agent, workbench and phone subscribe live to the same database on Maincloud.

### Convex: Best use of Convex

The voice channel: `clarifications` and `transcriptSegments` tables with indexes, mutations that move a call through ringing, answering and confirmed, Cartesia actions run through the `@convex-dev/action-retrier` component, file storage for both audio clips, HTTP routes and Convex Auth (anonymous) so each phone's answer is bound to a session, and live subscriptions on the landing, workbench and phone pages. Convex never touches money. Full log in `hackathon.md`.

### Cartesia: Best Use of Cartesia

Voice is the channel, not a feature. Sonic 3.6 speaks the question; Ink transcribes the answer over WebSocket; both run inside Convex actions so the key never reaches the browser, with retries. Edge cases handled: mic denied falls back to tap-to-answer, failed upload, declined call, stale question. The phone tells the manager the answer is recorded and kept as evidence. Known limits: one short recorded answer per question, not a conversation; no Managed Agents.

### Atlassian: Agentic Workforce Challenge, Track 2

An audit mirror for an agent that acts: a Forge app with one web trigger, fed by a bridge that subscribes to the ledger. Each Summo work item becomes a Jira issue in project SUMMO when Summo asks a question; each proposal, approval, return, hold and posting becomes a comment and a column move, labels for loss warnings and rework. Jira never writes to the ledger, so the agent's work is reviewable where the team already works without giving Jira money access.

### MLH: Best Use of Gemini API

Gemini 3.5 Flash Lite is an independent second reader on every source and a reviewer on every proposal: numbers against the calculation, entry balanced, convention cited. When the two readers disagree on the amount, Summo asks instead of guessing.

### MLH: Best Domain from GoDaddy Registry

`robaudit.us`, a GoDaddy Registry TLD. The judge's phone lands on www.robaudit.us/phone from the QR code.

### MLH: Commit Fellowship

Working prototype on a real accounting problem, with the proof in `docs/proof.md`.

## Built with

typescript, node.js, pnpm, spacetimedb, convex, cartesia, claude, anthropic, gemini, azure-container-apps, azure-document-intelligence, azure-static-web-apps, zod, vitest, vite, playwright

## Submission checklist

- [ ] Submit before Oct 25, 9:00 AM PDT
- [ ] Project image uploaded
- [ ] GitHub repo link: https://github.com/Jagga-tech/robaudit; live link https://www.robaudit.us
- [ ] Video demo linked; it opens with the moment
- [ ] Verify exact track names on Hive
- [ ] MLH Commit Fellowship: opted in and supplemental form submitted
- [ ] Select every track above in the Devpost prize list, including GoDaddy Registry (not in our original list)
