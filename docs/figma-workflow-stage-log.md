# Keel: Figma workflow stage log

- Figma Design file: https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX
- Figma prototype: https://www.figma.com/proto/8gPKZCS1U6j1LiL5fiGmTX?node-id=21-547&starting-point-node-id=21-547
- Figma Slides deck: https://www.figma.com/slides/4qlUUnJAKySOLLgOt66qrd
- Code: branch `feat/keel-frontend-design`, app in `apps/web`

Written while working. Times are UTC on 2026-10-25 from the session clock, and minutes are active time. All work below was done by one frontend owner pairing with an AI coding agent (Claude Code) driving the Figma MCP tools.

## Stage summaries (each ≤ 200 words)

### 1. Ideation
**Tools:** Figma MCP `use_figma` (Variables API, auto-layout), `html_to_figma`, `get_screenshot`. **Time:** ~26 min (03:50–04:16). **Rating: 4/5.**

We reconciled the starter file's tokens in place (19 variables created, 46 tokens updated, plus 2 text styles and 3 effect styles), adding actor colors so AI, engine, human, controller and ledger each read differently. We then explored two architectures for the same decision, "should revenue change, and by how much?": **A**, a conventional exception list with an AI summary, and **B**, an evidence-first workspace. Annotating A exposed 4 risks: it silently guesses "another $200,000", shows evidence only as file names, has one blurred Approve button, and shows the $200K input instead of the revenue impact. We rejected A and kept it on page 01 with the reasons. Six frames went into Figma as editable layers via `html_to_figma`. **Friction:** some stroke icons converted with distorted paths. **Output reused:** the B layout became the investigation route, and the tokens became `styles/base.css`.

### 2. Prototyping
**Tools:** `use_figma` prototype reactions (5 click-throughs, flow starting point), a coded prototype exercised in a browser. **Time:** ~12 min in Figma (05:16) + ~10 min walkthrough. **Rating: 3/5.**

The Figma prototype walks one exception: alert → ambiguity → manager phone → recalculated entry → evidence replay. Figma Make was not used: `create_new_file` can create a Make file, but we prioritized the working app. We did **not** test with outside users in this window. Instead we ran an *internal walkthrough* of the task "find out why reported revenue changed and identify the evidence", driving the coded prototype click by click. It surfaced 2 real issues: the manager's phone drawer hid the desktop's reaction, and a confirmation made in a tab that then navigated away left the case stuck. Both were fixed (commits `1d6483f`, `780fba1`). **Limitation:** a walkthrough is not a usability test. The protocol for 2–3 outside participants is in the "Usability test protocol" section below.

### 3. Handoff
**Tools:** variable code syntax (`var(--color-…)`), scoped variables, `use_figma` handoff table (page 04), Figma MCP reads. **Time:** ~20 min. **Rating: 4/5.**

Every color variable carries WEB code syntax matching `apps/web/src/styles/base.css`, so tokens moved into CSS without translation. Page 04 maps 13 Figma frames, tokens and components to the React files and behaviors that implement them. The decisive handoff input was the backend team's `docs/frontend-guide.md`: it showed that our mock data (a "Luis Ortega", a CR-118 change request, $666,666.67) did not match the ledger (Matt, no change-request document, whole-dollar revenue from `@keel/engine`). We let the code follow the ledger and corrected 42 text layers in Figma. The missing cost document became an honest amber control instead of a fake source. Code Connect was skipped: it would have cost time without changing the demo.

### 4. Code generation
**Tools:** generated React/TypeScript built from the Figma tokens and frames; `generate_figma_design` to capture the running app back into Figma (page 05). **Time:** ~45 min build (04:30–05:10) + ~10 min round trip. **Rating: 4/5.**

The app reads real ledger tables (SpacetimeDB + Convex in live mode, or a labeled offline demo backend that mirrors the reducer guards). All arithmetic comes from `@keel/engine`, and 8 unit tests cover the three clarification branches, the role guard, duplicate posting, month-3 convention reuse and recovery. Capturing the live UI back into editable Figma layers and comparing it with the 02b frame found **6 discrepancies**, all fixed: mock vs. ledger data, a label collision in the bridge, a CSS class collision that rendered the evidence connector as a block, stray list numbers in the stepper, static vs. derived states, and the drawer occlusion.

## Running log (raw)

| Time (UTC) | Stage | What happened | Tool |
|---|---|---|---|
| 03:50 | Ideation | Inspected the starter file: 3 collections, 7 text styles, 4 empty shells | `use_figma`, `get_screenshot` |
| 03:52 | Ideation | Captured 8 reference sites. Product UIs are behind logins, so only marketing pages were visible | Playwright |
| 03:56 | Ideation | Token reconciliation (19 variables created, 46 updated, 2 text + 3 effect styles) | `use_figma` Variables API |
| 03:58–04:10 | Ideation | Token-bound HTML compositions, checked in a browser; fixed a class collision in the JE total row | — |
| 04:10 | Ideation | 6 frames into Figma as editable layers; some icons distorted | `html_to_figma` |
| 04:12 | Ideation | Page 01: A (rejected, 4 annotated risks) vs B (selected) | `use_figma` |
| 04:15 | Handoff | Read backend `docs/frontend-guide.md`; mock data ≠ ledger, so code follows the ledger | — |
| 04:30–05:10 | Code | Built `apps/web`: data layer, demo + live backends, pages, tests | — |
| 05:05 | Prototyping | Internal walkthrough of the full flow in the browser | Playwright |
| 05:12 | Code | Captured the running investigation into Figma (page 05) | `generate_figma_design` |
| 05:14 | Code | Found drawer occlusion in the capture → fix `1d6483f` | — |
| 05:15 | Handoff | Corrected 42 Figma text layers to ledger data | `use_figma` |
| 05:16 | Prototyping | Page 03: 5 screens, 5 click-through reactions, flow start | `use_figma` reactions |
| 05:17 | Handoff | Page 04 handoff table; page 00 problem & journey | `use_figma` |
| 05:19 | Code | Found the stuck state after navigating away → recovery fix `780fba1` + regression test | Playwright, Vitest |
| 05:22 | All | Built the Figma Slides deck from real app screenshots and this log | `create_new_file` (slides), `upload_assets`, `use_figma` |

## Measured, not estimated

- Figma: 7 organized pages, 6 designed frames, 1 rejected alternative kept, 5-screen prototype with 5 interactions, 1 round-trip capture.
- Discrepancies found by design-vs-implementation comparison: 6. Fixed: 6.
- Issues found by the internal walkthrough: 2. Fixed: 2.
- Unit tests: 8 passing (`pnpm --filter @keel/web test`).
- Users tested: **0 external** (internal walkthrough only).

## Usability test protocol (to run with 2–3 non-accountants)

Task: "Find out why the reported revenue changed and identify the evidence supporting the adjustment." Start on the Command Center in the proposed state. Do not coach.

For each participant, record:
- seconds until they point at the Forecast Bridge or the Evidence chain;
- whether they say "the remaining cost went up, so the percent complete went down";
- where they hesitate;
- one design change it suggests.

| Participant | Time to explanation (s) | Correct interpretation? | Hesitation | Change made |
|---|---|---|---|---|
| P1 | | | | |
| P2 | | | | |
| P3 | | | | |
