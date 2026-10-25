# Final state (Cal Hacks 13.0, as of 2026-10-25 03:55 PDT)

One page of where everything lives. Open items are in `docs/track-todo.md`.

## Live URLs

| What | URL |
|---|---|
| Web app (landing, workbench, phone) | https://www.robaudit.us |
| Custom domain (DNS not set yet) | https://www.robaudit.us (Porkbun DNS: ALIAS @, CNAME www -> SWA host, TXT @ = `_3i24sgtlce8kd1mhd916uww5gbgkmj2`) |
| Repo (public, default branch `main`; `summo` is the working branch, fast-forwarded into `main`) | https://github.com/Jagga-tech/robaudit |
| SpacetimeDB Maincloud db `keel` | https://spacetimedb.com/keel (redeem `CALHACKS13`) |
| Convex prod | https://hushed-shrimp-24.convex.cloud |
| Convex dev (rehearsal) | https://lovely-squirrel-569.convex.cloud |
| Azure Container App `keel-agent` | resource group `keel-rg`, image from GitHub Actions |
| Jira demo site (Atlassian) | https://one-atlas-udgh.atlassian.net, project `SUMMO`, app `summo-jira` (dev env) |
| Azure Document Intelligence | `summoai` resource (key in `.env`) |
| Figma, all web design | https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX/?node-id=119-2 (page 08); file https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX |

## What is built per track

| Track | State |
|---|---|
| Hyphenate (primary) | Agent roster refactor, sources-disagree control, return/hold handling, agent_event log, Gemini reviewer: other agent's branch work, see git log |
| Spacetime | Ledger module, 15+ reducers, Maincloud. Done |
| Convex | Clarification channel, voice actions, file storage, realtime, `@convex-dev/action-retrier` component, Convex Auth (anonymous) on the call mutations. `hackathon.md` written. Deployed to prod and verified 04:40 PDT |
| Cartesia | Sonic TTS + Ink STT in `convex/voice.ts`. Flyer never checked |
| Microsoft | Container Apps, Document Intelligence, Static Web Apps. Devpost text pending |
| Atlassian | `apps/jira-forge` web trigger + `apps/jira-bridge`. Deployed, installed, smoke-tested (SUMMO-1). Live beat untested |
| MLH Gemini | `gemini-3.5-flash-lite` second reader + reviewer. Needs `GEMINI_API_KEY` set when recording |
| MLH GoDaddy domain | `robaudit.us` registered (Porkbun, GoDaddy Registry TLD). DNS pending |
| MLH Commit Fellowship | Opt in on Devpost + form at mlh.link/commit. Pending |

## Secrets and config (never commit)

`.env` at repo root: Anthropic, Cartesia, Gemini, Azure DI, `JIRA_WEBTRIGGER_URL`, `SUMMO_WEBHOOK_SECRET`, `STDB_URI`/`STDB_DB`.
`demo/identities.json` must be the Maincloud copy for the demo (`identities.maincloud.json`), the local copy for local work.
Convex env on dev and prod: `CARTESIA_API_KEY`, `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` (auth keys generated 2026-10-25, scratch copies not kept).
Forge variables on the app: `SUMMO_WEBHOOK_SECRET` (encrypted), `JIRA_PROJECT_KEY=SUMMO`.

## Demo start order

1. `demo/identities.json` = maincloud copy; `.env` `STDB_URI=wss://maincloud.spacetimedb.com`
2. Agent: Azure `keel-agent` running (or laptop `pnpm agent`, never both)
3. `pnpm --filter @keel/jira-bridge start` (Jira mirror)
4. Web app open on the laptop; judge scans the QR
5. Between judges: `pnpm demo --reset-only`; delete SUMMO issues from the previous judge

## Timeline today

- 06:00 record video (opens with the moment; shows phone ringing, Jira card moving, month 3 silent)
- 07:00 Devpost text (sections per track are listed in `docs/track-todo.md`)
- 09:00 submission deadline
