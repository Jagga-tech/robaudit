# Figma "Idea to Demo" stage log — RoboAudit (Cal Hacks 13.0)

Draft written 2026-10-25 from the actual build history. Minutes are estimates from session timestamps; correct them before submitting. Each stage is under 200 words. Figma file: https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX (set sharing to "Anyone with the link" before submitting). Repo: https://github.com/Jagga-tech/robaudit (public).

## Stage 1 · Ideation

**Figma tools:** Figma Design (pages 00 "Problem & User Journey", 01 "UX Explorations"); the Figma agent read from Claude Code.
**Why:** We wanted two interaction architectures side by side before writing any code. Page 01 holds A (a conventional exception dashboard, rejected) and B (an evidence-first investigation workspace, selected), with the four risks of A as sticky notes.
**Minutes:** about 45.
**Worked:** 4/5.
**How it reached the final project:** The B architecture became the workbench's project page. For the landing page, the agent read the Figma file, then proposed four themes (ledger, blueprint, instrument panel, Swiss report) as a board. All four were rejected as too corporate. We chose an Adaptive-style hero with a Nuevo Tokyo grey palette from a screenshot the team supplied. That palette became the `Landing / Colors` variable collection and `src/base.css`.
**Friction:** Four theme directions were a dead end. The first board was published as a web artifact; the team wanted local files and static Figma frames only, so we switched.

## Stage 2 · Prototyping

**Figma tools:** Figma Design through the Figma agent (`use_figma`, Plugin API from Claude Code), Figma AI image generation (`generate_image`), `upload_assets`; page 03 "Interactive Prototype" (teammate); a local HTML prototype for motion.
**Why:** The hero needed real components (an Activity card with text, boolean and icon-swap properties, bound variables, auto-layout) and a character. Figma cannot animate the scroll sequence, so motion was prototyped as a local page in Vite and checked in headless Chromium, while Figma kept one static frame per state (page 08, section A).
**Minutes:** about 150.
**Worked:** 4/5.
**How it reached the final project:** Hero v2 (fuzzy Summo in a suit) is the locked design and the landing page is built from it. Summo took three generations: robot, fuzzy with beret, fuzzy in a suit; the background was cut locally and uploaded as the fill. The storyboard notes (trigger, timing, easing) were the spec for the code.
**Friction:** Instances cannot have children removed, so the card icon became an instance-swap property. New auto-layout frames default to white fills. A teammate's frames landed on the same coordinates on page 07; both bodies of work were moved into sections.

## Stage 3 · Handoff

**Figma tools:** Figma Design variables and notes; the Figma agent reading metadata and screenshots; page 08 "Design handoff" (one workspace with every state and every note).
**Why:** The handoff had to survive two agents and three humans working at once. Tokens live once as Figma variables and once in `src/base.css`; the step notes carry triggers, durations, easing curves and file paths so anyone can implement or re-implement.
**Minutes:** about 60.
**Worked:** 4/5.
**How it reached the final project:** The landing, phone and workbench share the same seven colour tokens and three typefaces. The workbench and phone sit on plain paper; the landing on a sage-to-cream gradient. An honesty rule was enforced in design and code: source tiles show only integrations we really have (Claude, Gemini, Azure Document Intelligence, Cartesia, Convex, SpacetimeDB) and the feed shows only the real demo beats.
**Friction:** The workbench stylesheet had redefined the shared tokens with its own values; we removed the overrides so one file governs the tone. Page 04 was never filled during the build; it now points to page 08.

## Stage 4 · Code generation

**Figma tools:** the Figma agent round trip (`generate_figma_design`) capturing the running app back into Figma; Claude Code writing `apps/landing` (Vite, package `@keel/web`).
**Why:** The landing page was written from the Figma frames as HTML, CSS and TypeScript. A second agent turned the folder into a Vite multi-page app with the workbench and the judge's phone page. To prove the design survived, every running screen (landing, phone, inbox and eight workbench pages) was captured live into Figma with a note each (page 08, section B).
**Minutes:** about 180.
**Worked:** 5/5 for the round trip; 3/5 for the surrounding friction.
**How it reached the final project:** This is the shipped app. `main` was fast-forwarded to the `summo` branch once the pages shared one tone.
**Friction:** Chromium painted a box behind a transforming `<img>` with alpha, so the flying Summo is a `div` with a background image. Autoplay was removed at the team's request; scroll drives the moment, click is a fallback. Captures append to whichever Figma page is current, so they had to be moved. The dev server was killed twice by other sessions.
