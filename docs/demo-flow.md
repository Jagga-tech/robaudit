# RoboAudit judge-driven demo flow

Cal Hacks 13.0. Platform **RoboAudit**, agent **Summo**. Checked against the code on 2026-10-24
(`spacetimedb/src/index.ts`, `convex/clarifications.ts`, `convex/managers.ts`, `apps/agent/src/loop.ts`,
`apps/agent/src/bridge.ts`, `apps/agent/src/azure-di.ts`, `packages/engine/src/engine.ts`, `scripts/demo.ts`).
If this disagrees with the code, the code is right. Build details for the UI are in `docs/frontend-guide.md`.

## Purpose

The judge plays the deployment manager on their own phone. They send a site update in their own
words, Summo reads it, notices it is ambiguous, calls them, and they answer. The books move in front
of them, the controller approves, and the ledger refuses every attempt to cheat. Nothing is scripted
on the judge's side except the printed forecast sheet they photograph.

## The three actors

| Actor | Who plays it | Device | Identity |
|---|---|---|---|
| Dana, controller | a team member (the Driver) | laptop, workbench page | SpacetimeDB role `controller`, name `Dana` |
| Deployment manager | the judge, using their first name | the judge's own phone, phone page | Convex `managers.join({ name })`; SpacetimeDB role `deployment_manager`, name = the judge's name |
| Summo | the agent service | Azure Container Apps `keel-agent` (fallback: laptop `pnpm agent`) | SpacetimeDB role `agent` |

Pitch line for the single controller: "One controller does review and approval in this demo; in
production two people, and the ledger already enforces roles."

Summo is shown as its own actor everywhere (history rows, the "Summo is reading" state, "Summo is
asking <Name>"). The laptop never acts for Summo and the phone never acts for Dana.

## Environment URLs

| Service | Demo (prod) | Fallback |
|---|---|---|
| SpacetimeDB ledger | Maincloud `wss://maincloud.spacetimedb.com`, database `keel` (dashboard https://spacetimedb.com/keel) | local `ws://127.0.0.1:3000`, db `keel`, laptop on hotspot |
| Convex | prod `https://hushed-shrimp-24.convex.cloud` | dev `https://lovely-squirrel-569.convex.cloud` |
| Summo | Azure Container Apps `keel-agent` (resource group `keel-rg`) | laptop `pnpm agent` (never both at once) |
| Workbench + phone page | Azure Static Web App `roboaudit-web`: https://kind-river-0eb9d010f.5.azurestaticapps.net | laptop `vite preview` over HTTPS tunnel, or the video |

The UI build needs only `VITE_CONVEX_URL`, `VITE_STDB_URI`, `VITE_STDB_DB`. No model or voice keys ever
reach the browser.

## Starting state (S0, after reset)

Contract $1,000,000, incurred $400,000, remaining $400,000, total $800,000, progress 50.00%,
cumulative revenue $500,000, billed $300,000, contract asset $200,000, margin $200,000 (20%).
One work item "Oakland deployment" status `posted`, one proposal rev 1 `posted` as `OAK-2026-09-R1`.
Seeded convention `forecast.remaining_estimate_means = future_costs_only`.

## The flow

Expected values assume the judge's update is read as "another $200,000" and answered "additional".
Other answers are under Branches.

| # | Judge does | Laptop shows | Phone shows | Backend call | Expected values | Timing |
|---|---|---|---|---|---|---|
| 1 | Scans the QR on the laptop, types first name, taps Join | QR code to the phone page; then "<Name> joined as deployment manager" | Name field, one Join button; then the update screen | Convex `managers.join({ name })` → id. Laptop subscribes `managers.current()` → `{ _id, name, joinedAt } \| null`. Phone connects to SpacetimeDB and calls `registerDemoUser({ name, role: 'deployment_manager' })` once | `managers.current().name === <Name>`; a `register_user` history row "<Name> registered as deployment_manager" | instant |
| 2 | Types or speaks a site update in their own words ("we need another 200k to finish"), taps Send | New `source` row (kind `note`, actor <Name>), then "Summo is reading" | Text box with a mic button; after Send, "Sent. Watch the screen." | `addSource({ projectId, kind: 'note', text, parentSourceId: 0n, version: 1 })` as `deployment_manager` | history `source_added` "note v1 added" | instant |
| 3 | Watches | Extraction rows: reader `claude` (and `gemini` when its key is set) with the facts (quote, amount) and the ambiguity text. Then "Summo is asking <Name>" (work item `awaiting_clarification`) or, if unambiguous, a proposal | (unchanged) | Summo: `recordExtraction` ×1–2, Convex `clarifications.ask`, `openClarification` | claude extraction `ambiguityFlag: true`; question "Is the $200,000 additional to the current remaining forecast, or the new total remaining?" (Claude may phrase its own) | extract 2–4 s |
| 4 | Phone rings. Taps Answer, hears the question, says "it's additional", taps Stop, reads the transcript, taps "That's right" | "Summo is asking <Name>": the question, then the transcript as it lands | Ringing screen with the question; Answer → question audio plays; Record/Stop; "Transcribing…"; transcript; "That's right" | Phone: `clarifications.startAnswer({ id })`, `generateUploadUrl` + upload WAV, `submitAnswerAudio({ id, storageId })`, then `confirm({ id, answer, speaker: <Name> })` | Convex row `confirmed`; ledger `clarificationRef` `confirmed`, new `clarification` source "Clarification from <Name>: Q: … A: additional"; work item `open` | TTS ~1 s after ask; STT 1–3 s after upload |
| 5 | Watches; Dana approves | Within ~1 s: the calculation row and the one orchestrated motion: 50.00% → 40.00%, $500,000 → $400,000, asset $200,000 → $100,000, margin $200,000 → $0 with the amber loss warning. ~6 s later: proposal rev 2 with entry, explanation (first line `ESCALATION:`), evidence (note + clarification). Approve → five checks tick, "Posted OAK-WI<n>-R2", "Convention saved: another_means = additional" | "Done. Summo has your answer." | Summo: `resolveClarification`, `recordCalculation`, `propose`. Dana: `decide({ proposalId, revision: 2, decision: 'approve', reason: '' })` then `post({ proposalId, revision: 2, postingRef: 'OAK-WI<workItemId>-R2' })` | Dr Revenue $100,000 / Cr Contract asset $100,000; pending convention `{forecast, another_means, additional}` → `convention` row approvedBy Dana | numbers ~1 s after confirm (bridge polls every 1 s); explanation 6–9 s |
| 6 | Photographs a printed forecast sheet with the phone camera | `source` kind `scanned_forecast`, "Reading document", then the `azure-di` extraction (OCR text with the Remaining Estimate figure, table), then the `claude` extraction, then the figures move again and a new proposal cites the seeded convention `remaining_estimate_means` | Camera button ("Photograph the forecast"); then "Sent. Watch the screen." | Phone: `generateUploadUrl`, POST the image, `addSource({ projectId, kind: 'scanned_forecast', text: storageId, parentSourceId: 0n, version: 2 })` | see the sheet table below; no phone call (the convention answers it) | OCR ~5 s, extract 2–4 s, explanation 6–9 s |
| 7 | Dana presses the three "Break it" buttons | Each refusal with its code and reason (see below) | (unchanged) | see below | `duplicate_posting`, `role`, `stale` | instant |
| 8 | (team) Reset | Back to S0, QR shown again | Returns to the name screen when `managers.current()` is null | `resetDemo({})`, Convex `clarifications.resetOpen({})`, `managers.leave({ id })` | S0 values above | < 1 s |

### Step 6: the four printed sheets

Files: `apps/agent/test/fixtures/sheets/forecast-{550k,600k,700k,350k}.{jpg,pdf}`. Each sheet reads
"Aster Robotics — Oakland deployment — Forecast v2 / Costs incurred to date: $400,000 / Remaining
Estimate: $X / Prepared by: M. Reyes". A Remaining Estimate is read as the new total remaining (seeded
convention), so no question is asked.

Expected values after step 5 approved "additional" (baseline remaining $600,000, 40.00%, revenue $400,000):

| Sheet | Progress | Cum. revenue | Contract asset | Margin | Adjustment | Entry |
|---|---|---|---|---|---|---|
| $550,000 | 42.11% | $421,053 | $121,053 | $50,000 | +$21,053 | Dr Contract asset / Cr Revenue 21,053 |
| $600,000 | 40.00% | $400,000 | $100,000 | $0 (loss) | $0 | **no lines** |
| $700,000 | 36.36% | $363,636 | $63,636 | −$100,000 (loss) | −$36,364 | Dr Revenue / Cr Contract asset 36,364 |
| $350,000 | 53.33% | $533,333 | $233,333 | $250,000 | +$133,333 | Dr Contract asset / Cr Revenue 133,333 |

**The $600,000 sheet after an "additional" answer changes nothing.** Cumulative revenue is unchanged, so the
agent records a calculation but creates no proposal (the UI should show "No revenue change"). Hand out $550k, $700k or $350k for a visible change. The $600,000
sheet is the right one only when nothing has been approved since reset (from S0: 40.00%, −$100,000,
the same answer key as "additional").

If Azure Document Intelligence keys are missing on the agent, the mock OCR always returns $600,000
whatever was photographed. Check this in the pre-judging checklist.

### Step 7: the "Break it" buttons

Run them in this order after step 6, while the sheet proposal is still open:

| Button | Exact calls | Expected refusal (error message contains) |
|---|---|---|
| "Approve as the accountant" | second connection as role `accountant` (`registerDemoUser({ name: 'Priya', role: 'accountant' })` once), then `decide({ proposalId, revision, decision: 'approve', reason: '' })` on the open proposal | `role: requires controller, caller is accountant` |
| "Change the forecast after approval" | `addSource({ projectId, kind: 'note', text: 'Updated forecast: Remaining Estimate: $700,000', parentSourceId: 0n, version: 3 })`, then Dana's `decide(approve)` on the now-stale proposal to surface the refusal | `stale: proposal <id> is stale`. The proposal goes `stale`, Approve disables, and Summo writes a fresh proposal from the new source 6–9 s later |
| "Post it again" | Dana: approve and post the fresh proposal, then `post` again with the **same** `proposalId`, `revision` and `postingRef` | `duplicate_posting: postingRef OAK-WI<n>-R<rev> already posted` |

"Post it again" also works straight after step 5 against rev 2. The button labelled "after approval"
must be pressed while a proposal is `open`: `addSource` only stales `open` revenue proposals; a
posted entry stays posted (that is the hard-question answer "evidence after posting → posted entry
stays, new adjustment").

## Branches

- **"New total" answer** in step 4: remaining $200,000, total $600,000, progress 66.67%, revenue
  $666,667, asset $366,667, margin $400,000, no loss. Entry Dr Contract asset 166,667 / Cr Revenue
  166,667 (+$166,667). Approving saves `another_means = new_total`. Sheets afterwards are measured from
  this baseline ($550k −$245,614, $600k −$266,667, $700k −$303,031, $350k −$133,334).
- **Unclear answer** ("yes", "both", "additional, not a new total"): Convex row goes `confirmed`, but
  the agent's normalizer matches neither or both patterns, so Summo calls `fallbackText({ id })` and
  the row returns to `active()` with status `fallback_text`. The phone re-shows the question with the
  two option buttons and a text box; the judge confirms again.
- **Unambiguous update** ("remaining is now $600,000"): no call. Summo proposes directly (step 3 goes
  straight to a proposal). Narrate it as "it only asks when it has to".
- **Negative update** ("we'll need 50k less"): remaining falls, progress rises, positive adjustment.
  From S0 read as additional −$50,000: remaining $350,000, 53.33%, revenue $533,333, +$33,333
  (Dr Contract asset / Cr Revenue). Depends on the widened extraction prompt; rehearse it.
- **Second "another $X" update after step 5:** the saved convention answers it, so the phone does
  not ring and the explanation cites `Convention v3: another_means = additional`. That is the
  "Improves" moment.

## What to point at, per sponsor

| Track | Point at | Say |
|---|---|---|
| Hyphenate (primary) | Convention saved on approve; history stream; amber loss warning + `ESCALATION:` + the call; the second update with no call | "It learns a convention from one approval, runs every step on the record, escalates losses and ambiguity to a human, and improves: next time it doesn't need to call." |
| Spacetime | The Break it refusals; laptop and phone updating live from one subscription | "Controls are reducers, not UI checks: role, revision, staleness, period, balance, unique posting ref, all enforced in the database." |
| Convex | Phone ringing in real time, manager presence ("<Name> joined"), audio and photo in Convex storage | "Convex is the human channel: the call, the presence, the recordings, the photo." |
| Cartesia | The question spoken aloud; the judge's own voice transcribed; replaying the judge's answer from the evidence trace | "Sonic speaks the question, Ink transcribes the answer, and the recording is evidence on the entry." |
| Microsoft Built for the Real World | Summo running on Azure Container Apps `keel-agent`; the photographed sheet read by Azure AI Document Intelligence (`azure-di` extraction row) | "A phone photo of a paper forecast becomes a posted, evidenced entry." |
| Atlassian Best Agent | Summo as its own actor: reads, asks, explains, proposes; never posts | "The agent does the work up to the approval gate, and nothing past it." |
| MLH Best Use of Gemini API | The `gemini` extraction row next to `claude` | "Two independent readers; if they disagree on the amount, Summo asks instead of guessing." |

## Fallbacks, in trigger order

1. **QR fails** (camera won't scan, judge's phone has no data): hand over the team's table phone,
   already on the phone page. Judge still types their own name.
2. **Mic fails** (permission denied, no SpeechRecognition, recording errors): type. The update box is
   always a text field; for the answer, `fallbackText({ id })` then the option buttons / text box →
   `confirm`.
3. **OCR fails** (blurry photo, Azure error, no `azure-di` row in ~10 s): "Upload PDF" button →
   pick `forecast-550k.pdf` (or the matching sheet) → same `generateUploadUrl` + `addSource(scanned_forecast)`.
4. **Convex prod down**: rebuild/redeploy the UI with `VITE_CONVEX_URL=https://lovely-squirrel-569.convex.cloud`
   (and point the agent's `CONVEX_URL` at the same deployment).
5. **Agent down** (no extraction within ~10 s of a source, or `az containerapp logs show --name keel-agent
   --resource-group keel-rg --follow` shows a crash): stop `keel-agent`, then run `pnpm agent` on the laptop
   with the Maincloud/prod `.env`. Never run both.
6. **App down** (Azure Static Web Apps or Maincloud unreachable for 10 s): play the video.

## Team roles at the table

| Role | Does |
|---|---|
| Narrator | Talks to the judge, tells them what to do on the phone, delivers the sponsor lines and hard-question answers |
| Driver | Plays Dana on the laptop: Approve, Break it buttons, Reset |
| Phone helper | Gets the judge onto the page, holds the table phone and the printed sheets, hands out a sheet that is not $600k after "additional" |
| Spotter | Watches the agent logs and the timing; calls the fallback ("go to table phone", "type it", "PDF", "laptop agent", "video") |

## Reset procedure (between judges, ~10 s)

1. Driver presses Reset in the header. It calls, in order: `resetDemo({})` (SpacetimeDB), Convex
   `clarifications.resetOpen({})`, Convex `managers.leave({ id: current._id })` if a manager is joined.
2. Confirm on the laptop: one work item `posted`, 50.00% / $500,000, QR showing, no "joined" line.
3. If the button fails: `pnpm demo --reset-only --remote` with `.env` pointing at Maincloud and Convex
   prod. This resets the ledger, calls `resetOpen` and also `managers.leave` for the current manager.
4. Summo needs no restart. Ids keep counting after reset; the UI must look rows up by name.

## 30-minute pre-judging checklist

- [ ] T−30 `az containerapp logs show --name keel-agent --resource-group keel-rg` shows `agent loop started` and no `MOCK:` lines (`MOCK: azure-di` means every sheet reads $600,000).
- [ ] T−28 `npx convex env list --prod` has `CARTESIA_API_KEY`; otherwise the question is silent and the transcript is `MOCK: it's additional`.
- [ ] T−25 `pnpm demo --require-real --remote` passes against Maincloud + Convex prod (stop `pnpm agent` locally first).
- [ ] T−20 Reset. Open the Azure Static Web Apps URL on the laptop: S0 figures, QR showing.
- [ ] T−18 Scan the QR from a phone not on the venue Wi-Fi (cellular): name, update, ring, answer by voice, confirm, approve, post.
- [ ] T−12 Photograph the $550k sheet: `azure-di` row shows $550,000, proposal +$21,053.
- [ ] T−10 Press all three Break it buttons; each shows its refusal.
- [ ] T−8 Reset. Repeat steps 1–2 on the table phone (fallback device), then reset again.
- [ ] T−5 Printed sheets in hand ($550k, $700k, $350k on top, $600k set aside); laptop on power, sleep off, volume up; hotspot ready; video file open in a background tab.
- [ ] T−2 Final reset. Laptop shows the QR.

## Hard questions, short answers

- **Why does a higher cost estimate reduce revenue?** Progress is incurred ÷ total. Bigger total, smaller share.
- **Was this a mistake?** No. An estimate changed.
- **Did you save money?** No. It is an accounting adjustment; cash is unchanged.
- **How do you know it's right?** Four lines of tested arithmetic against an independent answer key, in integer cents. The model reads, asks and explains; it never does the math and never posts.
- **What about hard ASC 606 cases?** Out of scope by policy: single performance obligation, fixed price, cost-to-cost.
- **Does it learn?** It learns conventions and precedents, approved by a person. Not model weights.
- **What if the controller says no?** It stays unposted, with the reason on the record.
- **What if evidence arrives after posting?** The posted entry stays, the open proposal goes stale, and a new adjustment is proposed.
- **Is this a real problem?** Symbotic, a warehouse-automation company, disclosed a material weakness in controls over the timing of cost-of-revenue recognition, which also affected revenue timing, still described in its quarter ended June 27, 2026 (SEC filing); its auditor earlier called deployment revenue estimates a critical audit matter (10-K). This proves the accounting problem exists at a major robotics company; it does not prove Symbotic would buy this.
