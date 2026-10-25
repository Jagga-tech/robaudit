# Track to-do (Cal Hacks 13.0, deadline Oct 25 2026 9:00 AM PDT)

Gaps found by checking sponsor criteria against the repo on Oct 25, 01:30 PDT. Tick as done.

## Everyone (blocks four tracks)

- [ ] Record the demo video (3 min max; Atlassian and Spacetime both want it). Show the phone ringing and the answer transcribed, then month 3 running with no call and citing the convention.
- [ ] Link the public repo https://github.com/Jagga-tech/robaudit on Devpost.

## Hyphenate (primary) — official doc checked. Judged on: real enough, would you hire it, something new, the moment

Submission asks: video opens with the moment; live demo, judges may try their own scenario; one line on the seats; proof of what's real vs simulated.

- [ ] Video opens with the moment (phone rings on the ambiguous note, or month 3 posts silently citing March). Not the architecture.
- [x] Devpost: one line on seats. Draft: "Fills the project accountant seat for revenue recognition on fixed-price installs and the deployment manager's clarification loop; the controller keeps the sign-off seat."
- [x] Devpost: one block "What's real / what's simulated / how we know". Real: Claude, Gemini, Cartesia, Azure DI, SpacetimeDB Maincloud, Convex prod. Simulated: company, project, six past closes behind the seeded convention, controller identity. How we know: engine answer key, 7 controls as tests, demo script asserts to the dollar, 20-phrase real-API wording set.
- [x] DONE 05:30: controller says "no": Summo subscribes to approvals; on return/hold it writes an agent_event `rework` with the reason and waits; the next source proposes rev N+1 whose explanation opens with "Rework of rev N, returned by Dana: <reason>". Tests: loop.test.ts x2. No ledger change. Add: on returned proposal, agent logs the reason and reopens the work item so the next source yields the next rev (~30 lines in `apps/agent/src/loop.ts` + 1 test). Judges may try this live.
- [x] Sources that disagree (their example: bank vs ledger vs contract). Ours is reader vs reader on one note. Optional: plant a mismatch between the forecast sheet and the field note so Summo says which it trusted and why. Only after the return path.

- [x] DONE 05:30 (needs Maincloud republish, see below): failed attempts logged. New reducer `record_rejection` writes history_event kind `rejected`; the workbench `call()` wrapper records every refusal (duplicate post, wrong role, stale decide, closed period). Test: ledger e2e control 3. Old note: rejected reducers roll back, so duplicate post, wrong role and stale decide leave no `history_event` row. Add reducer `record_rejection` in `spacetimedb/src/index.ts` and call it from the ledger client catch. Shows "post rejected: duplicate_posting" in the history pane.
- [ ] Devpost: use the phrase "System of Work" (their term). Say agents propose, humans approve, every action logged including rejections.
- [x] Mention self-learning on onboarding (S0 convention seeded from six past closes) and self-improving (convention saved on controller approval).

## Spacetime main track — all criteria met

- [x] Maincloud republished 05:40 PDT with `record_rejection` (verified with `spacetime describe`). Data kept.
- [ ] Azure agent: after the image build for 5b3e71f finishes, roll a new revision so the Container App pulls `:latest` (`az containerapp update -n keel-agent -g keel-rg --revision-suffix r5b3e71f`). Needed for the return/hold reaction on stage.

- [x] Primary functionality on Spacetime (ledger + 15 reducers).
- [x] Public repo.
- [ ] Video (see above).
- [ ] Redeem promo code `CALHACKS13` on https://spacetimedb.com/keel so the Maincloud db stays live after demo day.
- [x] Devpost: name two or three reducers (decide, post, add_source) so judges see it is not "just chat".

## Atlassian — Forge app DEPLOYED and verified 2026-10-25 03:35 PDT (Track 2: audit mirror)

Code: `apps/jira-forge` (web trigger) + `apps/jira-bridge` (ledger subscriber). App `summo-jira` installed on demo site https://one-atlas-udgh.atlassian.net (expires 2027-01-23). Trigger URL and secret are in `.env` (`JIRA_WEBTRIGGER_URL`, `SUMMO_WEBHOOK_SECRET`). Smoke test created ENGS-30 with create -> proposal comment (+loss-warning label) -> posted comment, all HTTP 200.

- [x] SUMMO project created; app pointed at SUMMO and redeployed 03:50 PDT. SUMMO-1 is a smoke issue (asked -> proposed -> posted, no transition warnings): delete it and ENGS-30 before the demo.
- [ ] First rehearsal beat with the bridge running (`pnpm --filter @keel/jira-bridge start`, needs `demo/identities.json` = maincloud tokens and `STDB_URI` = Maincloud): confirm SUMMO-1 appears, then the rev 2 comment. Local SpacetimeDB is on an old module (no `agent_event`), so the bridge only works against a republished server.
- [ ] Video: 3 min max; show the Jira card move as Summo works (Atlassian requires the video).
- [x] Devpost: Track 2 "audit mirror: every ask, proposal, return and post lands in Jira with its reasoning; Jira never posts to the ledger".
- Ceiling: no replay on bridge restart; agent_event rows and rejected attempts not mirrored (no work-item id on them). `storage` from @forge/api is deprecated in favour of @forge/kvs (lint warning only).

## Microsoft Built for the Real World — eligible, 4 of 5 capabilities strong

Rubric: customer understanding, measurable usefulness, prototype-to-production, responsible design, end-to-end. Azure usage not required but we have it: Container Apps `keel-agent`, AI Document Intelligence (`apps/agent/src/azure-di.ts`), Static Web Apps.

- [ ] Devpost: add the five capabilities as headings with one paragraph each (FDE judges read for the rubric words).
- [ ] Devpost: one honest measurable sentence. Options from the demo: calls avoided by learned conventions (month 3), seconds from note to proposed entry, the $250k swing one ambiguous word causes. No invented "hours saved".
- [ ] Devpost: say "Responsible AI" and map: transparency = source spans + explanation; accountability = controller gate + history log; reliability = engine tests + second reader.
- [ ] Weak spot is measurable usefulness and customer understanding (one SEC filing, no interview). Say so plainly rather than overclaim.
- [ ] Rejection logging (Hyphenate item) also strengthens responsible design here.
- [ ] Optional, skip unless idle: route Claude through Azure AI Foundry (base URL + key in `apps/agent/src/claude.ts`) for an all-Azure agent. Risky before the demo.

## Convex — Best Use of Convex (component + auth added 2026-10-25 04:20 PDT)

Built: `@convex-dev/action-retrier` wraps both Cartesia actions (`convex/convex.config.ts`, `clarifications.ts`); Convex Auth anonymous provider (`convex/auth.ts`, `http.ts`, `authTables`), required by `startAnswer`/`submitAnswerAudio`/`confirm`/`decline`; `confirm` records `speakerUserId`. Phone, harness, demo script, bench and e2e test sign in anonymously. Verified on dev: 5/5 e2e, unauthenticated confirm rejected. `hackathon.md` updated (3,909 chars).

- [x] Prod deployed 04:40 PDT (`npx convex deploy -y` by the user); `pnpm test:convex` 5/5 on prod; unauthenticated confirm rejected on prod. Phone footer shows `session: secure <id>`.
- [ ] Before judging: `pnpm demo --reset-only`.
- [ ] Video must show the phone ringing and the transcript streaming.
- [x] Presence component skipped in favour of action-retrier (server-only, no UI collision).

## Cartesia — Best Use of Cartesia (starter pack checked 2026-10-25 05:05 PDT; prize: Meta glasses)

Judged 25% each: problem/originality, use of Cartesia (core + natural voice), execution (edge cases), impact/responsibility (accessibility, privacy, responsible use). Submit: working demo, 2-minute demo-first video (one full flow, then problem and build), README with setup + Cartesia features + known limitations, no keys committed.

- [x] Voice is core: Sonic `sonic-3.6` speaks the question, Ink `ink-2` transcribes the answer, both inside Convex actions (key never in the browser, as their guide asks). Retries via action-retrier. README row lists features and the known limitation (STT only from the phone page).
- [x] Edge cases: mic failure -> tap-to-answer; upload failure message; declined call; fallback text.
- [x] Privacy line added on the phone ask screen: answer is recorded, transcribed by Cartesia, kept as evidence with the manager's name.
- [ ] Video: one complete voice flow first (question spoken, answer recorded, transcript shown, evidence playback), then the problem. Keep their 2-minute shape in mind; the Hyphenate cut opens with the moment, which is the same scene.
- [ ] Devpost Cartesia paragraph: name Sonic 3.6 and Ink, say the recording is evidence, mention mock/fallback behaviour honestly.
- Weak spot: one short recorded answer, not a conversation; no Managed Agents. Say so rather than overclaim.

## Added 06:30 PDT after reading the Devpost prize list (cal-hacks-13-0.devpost.com)

- [ ] Atlassian: the Devpost prize is "Best Agent / Best Security Solution for Agents" and asks you to name the track in the description. Ours is **Best Security Solution for Agents** (Track 2). Devpost text fixed.
- [ ] Figma — Best Figma Workflow Hack ($1,000 + recruiting session): we are prepared (`docs/figma-stage-log.md`, Figma file, Figma Slides). Needs: file shared to Anyone, Figma embeds on Devpost, Edu verified, 3-min video.
- [ ] Cal Hacks — Most Technically Complex Hack: enter it; general judging criteria are application, intentionality, functionality, creativity, technical complexity.
- [ ] Possible but unchecked criteria: [Anthropic] Claude for Public Benefit ($4,998 + credits; "public benefit" is a stretch for corporate finance), [Armadin] Best Security Hack (guard agent, segregation of duties, refusal log could fit). Ask at their tables before ticking.
- Not entered on purpose: Solana, Tiger Data, Vultr, Snowflake, Visa, Fetch.ai, Meta, Factory, Apify, Creao, Bitdeer, Elastic, Capital One, CRS, Moss, SpaceXSI, Coinbase, Notability, Mana, Bright Data.
