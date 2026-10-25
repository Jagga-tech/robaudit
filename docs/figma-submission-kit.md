# Keel: Figma track submission kit

## Links

| Artifact | URL | Status |
|---|---|---|
| Figma Design (pages 00–06) | https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX | built; **set sharing to "Anyone with the link"** |
| Figma prototype | https://www.figma.com/proto/8gPKZCS1U6j1LiL5fiGmTX?node-id=21-547&starting-point-node-id=21-547 | 5 screens, 5 interactions |
| Figma Slides | https://www.figma.com/slides/4qlUUnJAKySOLLgOt66qrd | 9 slides with speaker notes; **set sharing to "Anyone"**; embed the prototype on slide 4 (Insert → Embed → paste the prototype URL) |
| Stage log | `docs/figma-workflow-stage-log.md` | 4 stages, each ≤200 words |
| Code | https://github.com/Jagga-tech/robaudit, branch `feat/keel-frontend-design` | local commits; **not pushed yet** |
| Demo video | — | **not recorded yet** (shot list below) |

## Manual steps that need you

1. Figma → Share → "Anyone with the link can view" on both the Design file and the Slides file. Then open both in an incognito window to confirm.
2. Confirm Figma Education status. The account shows a **student** tier plan, but verify it on the Figma Education page.
3. In Slides, embed the prototype on slide 4 (the Plugin API can't create embeds).
4. Push the branch when you're ready: `git push -u origin feat/keel-frontend-design`.
5. Record the video (≤3:00) and add it to Devpost. Devpost deadline: **Oct 25, 2026, 9:00 am PDT**.
6. Optional but valuable: run the 3-person comprehension test (protocol in the stage log) and fill in the table. Real numbers make a stronger "before/after" slide.
7. **Naming decision.** Upstream `summo` now calls the platform **RoboAudit** and the agent **Summo** (commit `886e6bf`). The Figma file, the Slides deck and `apps/web` say **Keel**. Pick one name; renaming the UI labels is a small change.
8. **Merging upstream.** A trial merge of `origin/summo` into this branch conflicts only in `pnpm-lock.yaml` (a generated file). Resolve it by taking upstream's lockfile and re-running `pnpm install`. After the merge, switch the live reset in `apps/web/src/data/liveBackend.ts` to the new `api.clarifications.resetOpen`.
9. Re-read the official challenge PDF. It wasn't available to me, so the requirements here come from your brief.

## Video shot list (≤3:00)

| Time | Shot | Say |
|---|---|---|
| 0:00–0:15 | Slide 1 → app command center with "Close on track" | "A field manager texts one sentence. Should revenue move $100K down or $167K up?" |
| 0:15–0:35 | Slide 2 (two readings) | "Today an accountant guesses, or spends days chasing it." |
| 0:35–0:55 | Figma page 01: A vs B | "We designed the conventional dashboard first. Annotating it showed it guesses silently, so we rejected it and kept the evidence." |
| 0:55–1:10 | Figma prototype click-through | "We prototyped the decision path, not button transitions." |
| 1:10–1:35 | App: Send to Keel → ambiguity finding | "Keel finds two valid readings, computes both with the engine, and refuses to post." |
| 1:35–1:55 | Phone drawer: Matt picks "Additional" → bridge animates | "Matt answers on his phone. The engine recalculates: 50% to 40%, $500K to $400K." |
| 1:55–2:15 | Switch to Dana → Approve & post → evidence trail → Trace the dollar | "Every figure traces back to its source, the human answer, the policy, and the approver." |
| 2:15–2:30 | Replay event → duplicate blocked | "Replay the same posting: refused. Zero second entries." |
| 2:30–2:50 | Figma page 05 round trip | "We captured the live app back into Figma and found 6 discrepancies, including the phone hiding the reaction. All fixed." |
| 2:50–3:00 | Slide 9 | "A workflow any small team can repeat." |

## Judge Q&A

1. **Why Figma instead of generating a frontend directly with AI?** Because the hard part was a human decision, not the pixels. Figma let us compare two architectures side by side and reject the one that guessed silently. It also let us bring the running app back onto the canvas, where we caught issues no static frame could show.
2. **Which Figma tool helped most?** Variables with code syntax plus the live-app capture (`generate_figma_design`). The first made handoff mechanical. The second turned Figma into a QA surface after the code existed.
3. **Where did the first design fail?** Alternative A: a single AI summary stated −$100K as fact and offered one Approve button.
4. **What improved because of the prototype?** The internal walkthrough found that the phone drawer hid the desktop reaction, and that an answer from a tab that navigated away got stuck. Both are fixed. We haven't run external user tests yet, and we say so.
5. **What evidence suggests the process is repeatable?** The 8-step pattern on slide 9, the 7-page Figma structure, and a stage log with times and ratings.
6. **How did the design reach the code?** The Figma variables carry `var(--…)` names, and page 04 maps each frame to its React file.
7. **What's built and what's simulated?** Built: UI, ledger data model, reducer guards, engine arithmetic, three answer branches, duplicate protection, recovery. Simulated in offline mode: the agent's wording and reading delay. Live mode uses the team's Claude/Gemini agent and Convex voice channel, but we haven't run live mode on this machine.
8. **What accounting decision does it make easier?** Whether to approve a cumulative catch-up after a cost-to-complete change, and on whose evidence.
9. **What did you measure?** 6/6 round-trip discrepancies fixed, 2/2 walkthrough issues fixed, 8 tests, per-stage minutes. External usability: not yet.
10. **Why care beyond a hackathon?** Estimate changes drive revenue on every long-term contract. The controller's real cost is verification, and Keel makes verification a single screen.
