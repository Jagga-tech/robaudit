# RoboAudit — Production Deployment Plan (Cal Hacks demo + beyond)

Date: 2026-10-24. Scope: how every service runs on the day, how it is deployed, how it is
reset, and what the Azure additions change. Build nothing until this is agreed.

## 1. Target topology

| Component | Dev (today) | Demo / "prod" target | Why |
|---|---|---|---|
| SpacetimeDB ledger (`keel`) | local `spacetime start` :3000 | **SpacetimeDB Maincloud** `keel` (published 2026-10-24, https://spacetimedb.com/keel) | Phone + laptop + agent reach one URL; survives laptop sleep |
| Convex clarification channel | cloud dev deployment `lovely-squirrel-569.convex.cloud` (already live) | **Convex production deployment** `hushed-shrimp-24.convex.cloud` (deployed 2026-10-24; `npx convex deploy`) | Prod URL is stable; dev deployment stays for rehearsals |
| Agent service (`apps/agent`) | `pnpm agent` on the laptop | **Azure Container Apps** (one container, min 1 replica, restart-on-exit) with a laptop fallback | Keeps running when the laptop is busy with the UI; Microsoft track hosting story |
| Document ingestion | none | **Azure AI Document Intelligence** (prebuilt-layout) called from the agent on `source.kind = scanned_forecast` | "Document-to-decision" for the Microsoft track; photo of a forecast sheet becomes forecast v2 |
| Workbench + phone UI (Tanush) | Vite dev server | **Azure Static Web Apps** (or Azure Static Web Apps) serving the built UI over HTTPS | Phone mic needs HTTPS; one URL for judges' phone |
| Secrets | `.env` on laptop | Container Apps secrets + Convex env + GitHub Actions secrets | Never in git |

Fallback chain on the day: if Maincloud is down → local SpacetimeDB on the laptop + hotspot. If
Container Apps is down → `pnpm agent` on the laptop. If Convex prod is down → the dev
deployment URL. Every fallback is a one-line env change in `.env` and a UI rebuild.

## 2. Environments and variables

One `.env` shape everywhere (values differ):

```
STDB_URI=            wss://maincloud.spacetimedb.com   | ws://127.0.0.1:3000
STDB_DB=keel
CONVEX_URL=          https://hushed-shrimp-24.convex.cloud        | https://lovely-squirrel-569.convex.cloud
ANTHROPIC_API_KEY=   (agent only)
GEMINI_API_KEY=      (agent only, optional)
CARTESIA_API_KEY=    (Convex env only — set with `npx convex env set`)
AZURE_DI_ENDPOINT=   (agent only)
AZURE_DI_KEY=        (agent only)
```

UI gets only `VITE_CONVEX_URL`, `VITE_STDB_URI`, `VITE_STDB_DB`. The UI never holds a model
or voice key.

Identities: the agent connects with a fixed SpacetimeDB token stored as a Container Apps
secret (`STDB_AGENT_TOKEN`); on first run it registers role `agent`. Controller/accountant/
manager tokens live in the UI's localStorage per device, as today.

## 3. Deployment steps (in order, each verifiable)

1. **SpacetimeDB Maincloud**: `spacetime login` → `spacetime publish keel --server maincloud --yes`
   → `spacetime call keel reset_demo --server maincloud` → `spacetime sql keel "select * from proposal" --server maincloud` shows 1 posted row. Regenerate bindings only if schema changed.
2. **Convex prod**: `npx convex deploy` (project keel) → `npx convex env set CARTESIA_API_KEY … --prod` → `CONVEX_URL=<prod> pnpm test:convex` passes 4/4.
3. **Agent container**: `apps/agent/Dockerfile` (node:20-slim, `pnpm install --prod --filter @keel/agent...`, `CMD ["node","--import","tsx","src/main.ts"]`), health = process alive (exits non-zero on ledger disconnect; Container Apps restarts it). `az containerapp up` with secrets for the six variables. Verify: `az containerapp logs show` prints `agent loop started`, then `pnpm demo --require-real --remote` (new flag: do not start an in-process loop; use the running remote agent) passes against Maincloud + Convex prod.
4. **Azure Document Intelligence**: resource exists (user has endpoint + key). Agent: new source kind `scanned_forecast` (image/PDF stored in Convex storage, storageId in `source.text`) → `@azure-rest/ai-document-intelligence` prebuilt-layout → table rows → Claude extraction on the OCR text (same path as a note) → forecast v2 evidence with the page image as source. Verify with one fixture image of the Oakland forecast sheet: remaining = $600,000 extracted.
5. **UI hosting**: `vite build` → Azure Static Web Apps (HTTPS). Verify the phone page opens on a real phone and the mic prompt appears.
6. **Dry run**: `pnpm demo --require-real --remote` twice; then the human run-of-show twice with a stopwatch; `pnpm demo --reset-only --remote` between.

## 4. Reset procedure (10 seconds, between judges)

`pnpm demo --reset-only` → calls `reset_demo` on the ledger and `clarifications.resetOpen` on
Convex. The agent needs no restart (restart-safe). The UI re-renders from subscriptions.

## 5. What this adds to the codebase (the only new code)

- `apps/agent/Dockerfile`, `.dockerignore`, `infra/azure/containerapp.md` (the exact `az` commands).
- `apps/agent/src/azure-di.ts`: `readForecastDocument(bytes) → { text, tables }` with mock mode when `AZURE_DI_ENDPOINT` is unset; loop handles `scanned_forecast`.
- `scripts/demo.ts --remote` flag.
- Convex: `documents.generateUploadUrl` reuse of the existing upload URL + `sources.attach` is NOT needed: the UI uploads to Convex storage and calls `add_source(kind='scanned_forecast', text=storageId)`.
- README runbook section: Maincloud / prod URLs and the fallback chain.

## 6. Risks and cut lines

- Maincloud publish or Container Apps provisioning fails → stay local for the demo; the Azure
  Document Intelligence beat still works from the laptop agent.
- Document Intelligence on a phone photo misreads a digit → the extraction is shown with the
  OCR text and the page image; the controller sees and returns it. This is a feature in the
  pitch ("every number carries its evidence"), not a bug to hide.
- Cut order if time runs out: UI hosting → Container Apps → Maincloud. Never cut the
  Document Intelligence beat once started; it is the Microsoft track's visible proof.

## 7. Tooling needed on this machine

`az` CLI (not installed) and Docker (not installed) are required for steps 3 and 5. Options:
install both (`brew install azure-cli`, Docker Desktop), or build the image in GitHub Actions
(`azure/container-apps-deploy-action`) so the laptop needs only `az login`.
