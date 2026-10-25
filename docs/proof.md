# Proof it works: RoboAudit

What is real, what is simulated, and how we know. Every number below comes from a test in this repo or from a run report in `.superpowers/sdd/2026-10-24-keel-backend/`. Times are PDT unless marked UTC.

## 1. What is real at judging, what is simulated

**Real**
- SpacetimeDB Maincloud ledger, database `keel` (`wss://maincloud.spacetimedb.com`).
- Convex production deployment `hushed-shrimp-24` (phone channel, voice, presence).
- Summo, the agent, running on Azure Container Apps (`keel-agent`).
- Claude Opus 5.5 (reader, explainer) and Gemini 3.5 Flash Lite (second reader, reviewer).
- Cartesia Sonic (question audio) and Ink (answer transcription).
- Azure Document Intelligence (OCR of printed and photographed forecast sheets).

**Simulated**
- Aster Robotics, its Oakland deployment, the $1,000,000 contract and all its data. These are seeded from `demo/seed.json` and restored by `reset_demo`.
- The judge plays the deployment manager on their own phone.

## 2. Planted errors with the answer key

Each row is something we put in the data or do on stage, with the response we expect.

| # | Planted error | What the system must do | Answer key | Test that pins it | Verified how |
|---|---|---|---|---|---|
| 1 | Ambiguous note: "we need another $200,000 to finish" | Ask, not guess; no proposal until answered | 'additional' → 40.00% / revenue $400,000 / adjustment −$100,000 (Dr Revenue 100,000 / Cr Contract asset 100,000), margin $0, loss warning. 'new total' → 66.67% / $666,667 / +$166,667 | `packages/engine/test/engine.test.ts::additional`, `::new total`; `apps/agent/test/loop.test.ts::(a) ambiguous note -> openClarification + convex ask, no propose`, `::(b) confirmed clarification -> resolve, 4000 bp, propose -100,000 with pending convention`; `packages/ledger-client/test/ledger.e2e.test.ts::control 2: ambiguous note -> awaiting_clarification, no new proposal` | Unit + ledger e2e; asserted live by `scripts/demo.ts` beats 3–6 on every run in section 4 |
| 2 | Forecast sheet 5 says incurred $420,000; cost export says $400,000 | Trust the system of record, record the disagreement, explain it | Booked on incurred $400,000, remaining $600,000, 4000 bp, Dr Revenue 100,000. Explanation: "The sheet shows $420,000 incurred; the cost export, our system of record, shows $400,000, so we booked on $400,000." | `apps/agent/test/azure-di.test.ts::sheet says incurred $420,000, cost export $400,000 -> disagreement recorded, booked on $400,000, remaining $600,000`; `loop.test.ts::scanned sheet disagrees with the cost export on incurred -> ...` | Unit; live with real Azure OCR on db `keel-ae`, 2026-10-25 ~02:47 (disagree-report) |
| 3 | Post the same entry twice (same posting ref) | Refuse | `duplicate_posting` | `ledger.e2e.test.ts::control 3: same postingRef twice -> duplicate_posting` | Ledger e2e; live Playwright workbench run 2026-10-25 ~01:36 |
| 4 | Approval by the accountant | Refuse | `role: requires controller, caller is accountant` | `ledger.e2e.test.ts::control 4: post as accountant -> role` pins `post`. `decide` (approve) uses the same `requireRole(ctx, 'controller')` guard but has no test of its own | Ledger e2e for `post`; approve-as-accountant refusal seen live in the Playwright workbench run, 2026-10-25 ~01:36 |
| 5 | New evidence arrives while a proposal is open | Proposal goes stale; approve refused and disabled | `stale` | `ledger.e2e.test.ts::control 5: new source after propose -> stale; decide rejects stale` | Ledger e2e; the disabled Approve button was seen live in the Playwright workbench run, not in a test |
| 6 | Post after the period is closed | Refuse | `period_closed` | `ledger.e2e.test.ts::closePeriod then post -> period_closed` | Ledger e2e; live in the workbench shell run, 2026-10-25 ~02:07 |
| 7 | Savings larger than remaining: "finishing will cost $500,000 less" with $400,000 left | Ask instead of booking a negative remaining | Question contains "only $400,000 remains"; an 'additional' answer still records no calculation | `apps/agent/test/phrasings.test.ts::a cut larger than the remaining -> asked, not booked negative; "additional" answer is refused` | Unit (mock deps) |
| 8 | Spelled-out amount: "we need another two hundred thousand to finish" | Ask; never propose | Question and ambiguity text contain "Amount not stated"; after the answer, 1 clarification resolved, 0 proposals | `phrasings.test.ts::spelled-out amount -> asks with "amount not stated"; on confirm no proposal, no crash`; real-API phrase 16 (amount null, flagged) | Unit, plus 3 real Claude runs, 2026-10-24 ~23:33 |
| 9 | Zero-adjustment forecast: remaining unchanged (stage case: a $600,000 sheet after 'additional') | Record the calculation, no proposal | 1 calculation, 0 proposals | `loop.test.ts::(h0) forecast leaving remaining unchanged -> calculation recorded, no propose`. The test uses remaining $400,000 at S0 → "new total $400,000"; the $600,000 stage case uses the same code path but is not pinned with those figures | Unit |
| 10 | Unclear voice answer: "additional, not a new total" | Re-ask; confirm nothing | `normalizeAnswer` → null; `fallbackText` sent; 0 resolved until a clean answer arrives | `loop.test.ts::unclear Convex answer -> fallbackText, not resolved; re-confirmed later -> resolved`, `::normalizeAnswer`; phone scenario e (matcher) in `apps/landing/tests/phone.e2e.mjs` | Unit; phone e2e against real Convex and Cartesia, 2026-10-25 ~02:32 |
| 11 | Two readers disagree on the amount (Claude $50,000, Gemini $500,000) | Ask; skip the saved convention | Question names both amounts ("readers disagree"); 0 proposals | `loop.test.ts::readers disagree on the amount -> convention skipped, disagreement question asked`; `apps/agent/test/gemini.test.ts::(2) Gemini reads a different amount -> forced ambiguity naming both` | Unit |
| 12 | Month 3: "another $50,000 for conveyor rework" with the saved convention | No question; propose with the convention cited; escalate the loss | 38.10% (3810 bp) / revenue $380,952 / adjustment −$19,048, margin −$50,000, explanation starts `ESCALATION:` and cites "Convention v3: another_means = additional" | `engine.test.ts::month 3`; `loop.test.ts::(c) saved convention -> month-3 note proposes 3810 bp with no question`, `::(g) ...` | Unit; `scripts/demo.ts` beat 9 asserts no new Convex call, on every run in section 4 |
| 13 | Model writes a figure that is not in the inputs ($123,456) | Replace the explanation with the template | Explanation has no "$123,456" and contains "The estimate to finish rose from $400,000 to $600,000" | `loop.test.ts::explain cites a number not derived from the inputs -> template replaces it` | Unit |
| 14 | An agent tries to post | Permission guard throws | "may not call post" for every agent, including summo | `apps/agent/test/agents.test.ts::a reader calling propose throws; nobody may post; allowed calls go through` | Unit; the ledger also refuses `post` from the agent role (row 4 guard) |
| 15 | A reader tries to propose | Throws | "reader-claude may not call propose" | same test as row 14 | Unit |

## 3. Test set

**20 freeform phrasings** (`apps/agent/test/phrasings.test.ts`, baseline incurred $400,000 / remaining $400,000). "Ask" means the note is flagged additional-vs-total.

| # | Phrase | Kind | Amount / direction | Ask? |
|---|---|---|---|---|
| 1 | we need another $200,000 to finish | remaining_update | +200,000 | yes |
| 2 | conveyor rework is going to run another 80 grand | remaining_update | +80,000 | yes |
| 3 | add 75k to the forecast | remaining_update | +75,000 | yes |
| 4 | it'll take $120,000 more than we thought | remaining_update | +120,000 | yes |
| 5 | the new total remaining is $600,000 | remaining_update | 600,000 total | no |
| 6 | the new number to finish is 550k | remaining_update | 550,000 total | no |
| 7 | we now expect $700,000 to complete | remaining_update | 700,000 total | no |
| 8 | cost to complete is now $650,000 | remaining_update | 650,000 total | no |
| 9 | we found savings, finishing should cost 50k less | remaining_update | −50,000 | no |
| 10 | we're $60,000 under on electrical | remaining_update | −60,000 | no |
| 11 | remaining came down to $350,000 | remaining_update | 350,000 total | no |
| 12 | we're $75,000 over budget on conveyors | remaining_update | +75,000 | yes |
| 13 | Crew on site, rain held us up Tuesday, morale is good. | none | – | no |
| 14 | commissioning complete, throughput test passed | milestone | – | no |
| 15 | we spent 20k on cranes and need another 100k to finish | remaining_update | +100,000 | yes |
| 16 | we need another two hundred thousand to finish | remaining_update | null (spelled out) | yes |
| 17 | we'll need an extra $45,000 for the sorter install | remaining_update | +45,000 | yes |
| 18 | bump the cost to finish by $30k | remaining_update | +30,000 | yes |
| 19 | we saved $25,000 on the remaining scope | remaining_update | −25,000 | no |
| 20 | paid the $40,000 electrical invoice today | cost (no remaining_update) | – | no |

Result: **20/20 on each of three real Claude Opus 5.5 runs** (phrasings-report, 2026-10-24 ~23:33). The set runs against the real API only when `ANTHROPIC_API_KEY` is set and is skipped otherwise. The same file has 14 mock tests for the parser and the loop paths.

**Other suites**
- **Engine answer key:** `packages/engine/test/engine.test.ts`, 8 tests. They cover before, additional, new total, month 3, the invoice entry, balanced entries and the zero case, all in integer cents.
- **Ledger controls:** `packages/ledger-client/test/ledger.e2e.test.ts`, 11 tests against a running SpacetimeDB. They cover controls 2–5, idempotent propose, invoice-survives-addSource, period_closed, idempotent calculation and clarification, the negative-line `bad_input`, and `logAgentEvent` role. The last full report shows 10/10; the 11th (`logAgentEvent`) came with the multi-agent table.
- **Agent:** `apps/agent`, 99 passed / 7 skipped across 7 files (multiagent-report, 2026-10-25 ~03:00).
- **Phone:** `apps/landing/tests/phone.e2e.mjs`, 7/7 scenarios against real local SpacetimeDB, Convex prod, the agent and Cartesia (2026-10-25 ~02:32):
  - a: full ask → hold → upload → confirm;
  - b: reload plus dropped sockets;
  - c: double taps;
  - d: failed upload;
  - e: answer matcher;
  - f: stale question;
  - g: reduced motion.
- **Convex channel:** `convex/test/channel.e2e.test.ts`, 5 tests: 4 channel tests plus presence join/leave. Reported 4/4 on cloud dev, then 5/5 on prod after presence landed.

## 4. Live runs

Every row is `pnpm demo`, which asserts each figure in the nine beats and prints `DEMO OK` or exits 1, unless the row says otherwise.

| When | Stack | Result | Total |
|---|---|---|---|
| Oct 24 ~21:28 | Local SpacetimeDB, local Convex, real Claude + Cartesia | DEMO OK ×2 | 35.3 s / 29.2 s |
| Oct 24 ~21:37 | Same, after fix wave A | DEMO OK ×2 | 26.1 s / 26.0 s |
| Oct 24 evening (progress.md L79) | Local SpacetimeDB, cloud Convex dev | DEMO OK ×2 | 25.0 s / 22.5 s |
| Oct 24 ~22:23 | Real Azure OCR sheet run, scanned forecast-v2.pdf | Proposal 4000 bp, −$100,000; no mock OCR | 16.5 s upload → proposal; demo 24.6 s |
| Oct 24 evening (L87) | Maincloud `keel` + Convex prod | DEMO OK | 29.0 s |
| Oct 24 evening (L88) | Remote: Summo on Azure Container Apps; laptop plays the humans only | DEMO OK | 34.3 s |
| Oct 24 evening (L89) | Local, Gemini real | DEMO OK | 24.2 s |
| 2026-10-25 ~06:45 UTC | Final remote: Azure agent, Maincloud, Convex prod; Claude, Cartesia and Gemini real | DEMO OK | 23.2 s |
| Oct 25 ~02:47 | Sheet 5 disagreement, real Azure, db `keel-ae` | DEMO OK | 26.2 s |
| Oct 25 ~03:00 | Multi-agent, `--remote`, db `keel-ma`, real Claude + Gemini | DEMO OK; full agent_event chain | 25.8 s |

On the real Azure OCR sheet run, OCR took about 5.3 s, Claude extraction 3.3 s and the explanation 7.7 s. Photo OCR read all four printed sheets in 4.5–5.4 s each.

## 5. Benchmarks

There is no public benchmark for this task, and we report no benchmark score. Our measures are the planted-error answer key in section 2 and the 20-phrase set in section 3. They were also run through an independent harness and grader, Promptfoo, against real Claude and real Gemini: 51 of 51 cases pass on two consecutive runs (see docs/eval-promptfoo.md, `pnpm eval`). The internal benchmark harness (`pnpm bench`, docs/benchmark.md) replays the planted errors through the live multi-agent system and reports per-agent latency.

## 6. Reproduce in 5 minutes

```sh
pnpm install
pnpm test                                   # engine, ledger-client, agent; real-API tests skip without keys, ledger e2e skips without SpacetimeDB

spacetime start && pnpm stdb:publish        # local ledger
pnpm --filter @keel/ledger-client test      # 11 ledger controls (resets the local keel db)

cp demo/identities.maincloud.json demo/identities.json
STDB_URI=wss://maincloud.spacetimedb.com STDB_DB=keel CONVEX_URL=https://hushed-shrimp-24.convex.cloud \
  pnpm demo --require-real --remote         # needs the Azure agent running; fails if Claude or Cartesia is mocked

pnpm --filter @keel/web test:phone          # 7 phone scenarios; needs a ledger, Convex and a running agent
```

Between runs: `pnpm demo --reset-only`. Do not run the e2e tests during a live demo, because they reset the shared database.
