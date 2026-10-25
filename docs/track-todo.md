# Track to-do (Cal Hacks 13.0, deadline Oct 25 2026 9:00 AM PDT)

Gaps found by checking sponsor criteria against the repo on Oct 25, 01:30 PDT. Tick as done.

## Everyone (blocks four tracks)

- [ ] Record the demo video (3 min max; Atlassian and Spacetime both want it). Show the phone ringing and the answer transcribed, then month 3 running with no call and citing the convention.
- [ ] Link the public repo https://github.com/Jagga-tech/robaudit on Devpost.

## Hyphenate (primary) — official doc checked. Judged on: real enough, would you hire it, something new, the moment

Submission asks: video opens with the moment; live demo, judges may try their own scenario; one line on the seats; proof of what's real vs simulated.

- [ ] Video opens with the moment (phone rings on the ambiguous note, or month 3 posts silently citing March). Not the architecture.
- [ ] Devpost: one line on seats. Draft: "Fills the project accountant seat for revenue recognition on fixed-price installs and the deployment manager's clarification loop; the controller keeps the sign-off seat."
- [ ] Devpost: one block "What's real / what's simulated / how we know". Real: Claude, Gemini, Cartesia, Azure DI, SpacetimeDB Maincloud, Convex prod. Simulated: company, project, six past closes behind the seeded convention, controller identity. How we know: engine answer key, 7 controls as tests, demo script asserts to the dollar, 20-phrase real-API wording set.
- [ ] Controller says "no": `decide(return)` works in the reducer but the agent loop does nothing after. Add: on returned proposal, agent logs the reason and reopens the work item so the next source yields the next rev (~30 lines in `apps/agent/src/loop.ts` + 1 test). Judges may try this live.
- [ ] Sources that disagree (their example: bank vs ledger vs contract). Ours is reader vs reader on one note. Optional: plant a mismatch between the forecast sheet and the field note so Summo says which it trusted and why. Only after the return path.

- [ ] Log failed attempts. Rejected reducers roll back, so duplicate post, wrong role and stale decide leave no `history_event` row. Add reducer `record_rejection` in `spacetimedb/src/index.ts` and call it from the ledger client catch. Shows "post rejected: duplicate_posting" in the history pane.
- [ ] Devpost: use the phrase "System of Work" (their term). Say agents propose, humans approve, every action logged including rejections.
- [ ] Mention self-learning on onboarding (S0 convention seeded from six past closes) and self-improving (convention saved on controller approval).

## Spacetime main track — all criteria met

- [x] Primary functionality on Spacetime (ledger + 15 reducers).
- [x] Public repo.
- [ ] Video (see above).
- [ ] Redeem promo code `CALHACKS13` on https://spacetimedb.com/keel so the Maincloud db stays live after demo day.
- [ ] Devpost: name two or three reducers (decide, post, add_source) so judges see it is not "just chat".

## Atlassian — NOT eligible yet (deferred)

Needs a Forge app on a Jira/Confluence demo site. We have none. Node 22 required (we run 20).

- [ ] Decide: drop the track from Devpost, or build the minimal layer below (2-3 h).
- [ ] If building (Track 2, "Audit and Reversion"): `nvm install 22`, `npm i -g @forge/cli`, `forge login`, `forge site provision`, `forge register`.
- [ ] One web trigger: agent POSTs escalations (ambiguous note, loss warning, stale proposal) → Jira issue with evidence, facts, proposed entry, explanation. Loop reads approve/reject back from the issue.
- [ ] Starter: https://github.com/atlassian-labs/forge-inspired

## Microsoft Built for the Real World — eligible, 4 of 5 capabilities strong

Rubric: customer understanding, measurable usefulness, prototype-to-production, responsible design, end-to-end. Azure usage not required but we have it: Container Apps `keel-agent`, AI Document Intelligence (`apps/agent/src/azure-di.ts`), Static Web Apps.

- [ ] Devpost: add the five capabilities as headings with one paragraph each (FDE judges read for the rubric words).
- [ ] Devpost: one honest measurable sentence. Options from the demo: calls avoided by learned conventions (month 3), seconds from note to proposed entry, the $250k swing one ambiguous word causes. No invented "hours saved".
- [ ] Devpost: say "Responsible AI" and map: transparency = source spans + explanation; accountability = controller gate + history log; reliability = engine tests + second reader.
- [ ] Weak spot is measurable usefulness and customer understanding (one SEC filing, no interview). Say so plainly rather than overclaim.
- [ ] Rejection logging (Hyphenate item) also strengthens responsible design here.
- [ ] Optional, skip unless idle: route Claude through Azure AI Foundry (base URL + key in `apps/agent/src/claude.ts`) for an all-Azure agent. Risky before the demo.

## Convex — Best Use of Convex (modest chance; Convex is the side channel, ledger is SpacetimeDB)

Their hackathon.md template scores: components, features, Convex hosting, auth, realtime. We have no component, no auth, UI on Azure. Strong point is realtime (phone rings, transcript streams).

- [ ] Commit `hackathon.md` + README "How we use Convex" section alone, not with the teammate's web files.
- [ ] Video must show the phone ringing and the transcript streaming (Convex realtime doing visible work).
- [ ] Optional, only after the video: add `@convex-dev/presence` for the judge-joined indicator, replacing the hand-rolled `managers` table (`convex/managers.ts`, `apps/landing/src/{phone,workbench,landing}.ts`). ~45 min, needs `convex/convex.config.ts` with `app.use(presence)`, test against the dev deployment first. Ticks their "Components" box.
- [ ] Convex Auth considered, skipped: 1.5-2 h (React-centric client, our UI is plain TS), adds a login step to the judge QR flow, and roles are enforced in SpacetimeDB not Convex. Only the Anonymous provider keeps the one-tap flow. Presence component is the better buy.
- [ ] Do NOT move the ledger to Convex; not possible before 9 AM and weakens Spacetime + Hyphenate.

## MLH Best Use of Gemini API — entered, loosely met ("multimodality and flash models")

- [x] Flash model: `gemini-3.5-flash-lite` as second reader (`apps/agent/src/gemini.ts`).
- [ ] Set `GEMINI_API_KEY` before recording the video, or the Gemini extraction row never shows.
- [ ] Optional: multimodality. Let Gemini read the scanned forecast photo directly (image input in `gemini.ts`) instead of the Azure DI text, so the two readers see different evidence. Contained in the optional path.

## MLH Commit Fellowship

- [ ] Opt in on Devpost and submit the form at mlh.link/commit.

## MLH Best Domain from GoDaddy Registry — not entered, cheapest extra track

- [x] Domain `robaudit.us` registered 2026-10-25 09:44Z via Porkbun (.us is a GoDaddy Registry TLD, so it still counts). Azure side: apex registered on SWA `roboaudit-web`, status Validating.
- [ ] Porkbun DNS (delete the default parking ALIAS/CNAME first): ALIAS `@` -> `kind-river-0eb9d010f.5.azurestaticapps.net`; CNAME `www` -> same; TXT `@` = `_3i24sgtlce8kd1mhd916uww5gbgkmj2`.
- [ ] GitHub repo: description, homepage, topics set 2026-10-25. Switch homepage to https://www.robaudit.us once live: `gh repo edit Jagga-tech/robaudit --homepage https://www.robaudit.us`.
- [ ] After the CNAME exists: `az staticwebapp hostname set -n roboaudit-web -g keel-rg --hostname www.robaudit.us`, wait for the cert.
- [ ] Then replace the azurestaticapps URL in `hackathon.md`, `README.md`, `docs/demo-flow.md`, `docs/frontend-guide.md`, `docs/video-shot-list.md`. QR needs no change (uses `location.origin`).

## Cartesia — criteria not checked yet

- [ ] Get the flyer. STT is only exercised from the phone page, so show it in the video.
