# Keel agent on Azure Container Apps

Run from the repo root. Remote build via ACR (no local Docker needed). Dockerfile: `apps/agent/Dockerfile` (build context = repo root).

```bash
az login
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights

RG=keel-rg; LOC=eastus
az group create --name $RG --location $LOC
az containerapp env create --name keel-env --resource-group $RG --location $LOC

# build remotely from source and deploy (no ingress: the agent only dials out)
az containerapp up --name keel-agent --resource-group $RG --environment keel-env \
  --source . --ingress none --min-replicas 1 --max-replicas 1
```

`up --source .` uses `./Dockerfile` if present; here the Dockerfile lives in apps/agent, so build it explicitly instead if `up` can't find it:

```bash
az acr create --name keelacr$RANDOM --resource-group $RG --sku Basic --admin-enabled true   # note the name
ACR=<acr-name>
az acr build --registry $ACR --image keel-agent:latest --file apps/agent/Dockerfile .
az containerapp create --name keel-agent --resource-group $RG --environment keel-env \
  --image $ACR.azurecr.io/keel-agent:latest --registry-server $ACR.azurecr.io \
  --ingress none --min-replicas 1 --max-replicas 1 --cpu 0.5 --memory 1Gi
```

## Secrets and env

```bash
az containerapp secret set --name keel-agent --resource-group $RG --secrets \
  stdb-uri="$STDB_URI" stdb-db="$STDB_DB" convex-url="$CONVEX_URL" \
  anthropic-api-key="$ANTHROPIC_API_KEY" gemini-api-key="$GEMINI_API_KEY" \
  azure-di-endpoint="$AZURE_DI_ENDPOINT" azure-di-key="$AZURE_DI_KEY" \
  stdb-agent-token="$STDB_AGENT_TOKEN"

az containerapp update --name keel-agent --resource-group $RG --set-env-vars \
  STDB_URI=secretref:stdb-uri STDB_DB=secretref:stdb-db CONVEX_URL=secretref:convex-url \
  ANTHROPIC_API_KEY=secretref:anthropic-api-key GEMINI_API_KEY=secretref:gemini-api-key \
  AZURE_DI_ENDPOINT=secretref:azure-di-endpoint AZURE_DI_KEY=secretref:azure-di-key \
  STDB_AGENT_TOKEN=secretref:stdb-agent-token
```

(CARTESIA is used by Convex, not the agent.) `STDB_AGENT_TOKEN` is the agent's token from `demo/identities.json` (`.agent`) so the container reuses the registered agent identity.

## Operate

```bash
az containerapp logs show --name keel-agent --resource-group $RG --follow
az containerapp revision restart --name keel-agent --resource-group $RG \
  --revision $(az containerapp revision list -n keel-agent -g $RG --query '[0].name' -o tsv)
```

- Restart: the process exits 1 on ledger disconnect; Container Apps restarts failed containers automatically. min=max=1 so there is exactly one agent.
- Cost: Consumption plan, 0.5 vCPU / 1 GiB, always on (min-replicas 1) is roughly $10-20/month with the free grant offsetting part; ACR Basic ~$5/month. `az group delete -n keel-rg` removes everything.

## Verify against the deployed agent

```bash
STDB_URI=... STDB_DB=... CONVEX_URL=... pnpm demo --remote
```

## Laptop fallback

```bash
until pnpm agent; do sleep 1; done
```

## What actually worked on 2026-10-24 (subscription blocks ACR Tasks)

`az acr build` and `az containerapp up --source .` both fail with `TasksOperationsNotAllowed`
on this subscription. The working path:

1. Registry `keelacr06512` (Basic, admin enabled) in `keel-rg`, environment `keel-env` (eastus).
2. GitHub Actions workflow `.github/workflows/build-agent-image.yml` builds
   `apps/agent/Dockerfile` and pushes `keelacr06512.azurecr.io/keel-agent:{latest,sha}`.
   Secrets `ACR_LOGIN_SERVER`, `ACR_USERNAME`, `ACR_PASSWORD` on the repo. Trigger:
   `gh workflow run "Build Summo agent image" --ref summo`, or any push touching apps/agent.
3. `az containerapp create --name keel-agent ... --image keelacr06512.azurecr.io/keel-agent:latest`
   with secrets anthropic-key, azure-di-endpoint, azure-di-key, stdb-agent-token and env
   STDB_URI=wss://maincloud.spacetimedb.com STDB_DB=keel CONVEX_URL=https://hushed-shrimp-24.convex.cloud.
4. Roll a new image: rerun the workflow, then
   `az containerapp update -n keel-agent -g keel-rg --image keelacr06512.azurecr.io/keel-agent:<sha>`.
5. Logs: `az containerapp logs show -n keel-agent -g keel-rg --follow`.
6. Stop the cloud agent (to run the laptop one instead): `az containerapp update -n keel-agent -g keel-rg --min-replicas 0 --max-replicas 0`; re-enable with 1/1. Never run both at once against the same ledger.
7. The app is in **single revision mode** (`az containerapp revision set-mode --mode single`). Keep it that way: in multiple-revision mode an image update leaves the old revision active and two Summo instances run against one ledger (observed 2026-10-25; per-source idempotency held, but do not rely on it).
8. Secret changes need a restart: `az containerapp revision restart -n keel-agent -g keel-rg --revision $(az containerapp revision list -n keel-agent -g keel-rg -o tsv --query '[?properties.active].name' | head -1)`.
