# Summo -> Jira (Atlassian Forge app)

One web trigger. The bridge in `apps/jira-bridge` subscribes to the ledger and POSTs every work-item status change here.
First event for a work item creates a Jira issue in project `SUMMO`; later events are comments and column moves.
Nothing posts to the ledger from Jira: the controller decides in the ledger, Jira mirrors it (audit trail outside the system of record).

## Setup (Node 22, Forge CLI 14+)

```sh
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22
forge login                       # Atlassian API token with Forge scopes
forge site provision              # demo site; create Kanban project "Summo", key SUMMO
cd apps/jira-forge
forge register                    # writes app.id into manifest.yml
forge variables set --encrypt SUMMO_WEBHOOK_SECRET <random>
forge deploy
forge install --demo-site --product jira
forge webtrigger -f main          # prints the trigger URL
```

Then in the repo `.env`:

```
JIRA_WEBTRIGGER_URL=<trigger url>
SUMMO_WEBHOOK_SECRET=<same random>
```

and run the bridge next to the agent: `pnpm --filter @keel/jira-bridge start`.

Optional Forge variables: `JIRA_PROJECT_KEY` (default `SUMMO`), `JIRA_TRANSITIONS` (JSON status -> column, default Kanban To Do / In Progress / Done).

## Mapping

| Ledger work item status | Jira |
|---|---|
| awaiting_clarification | issue created or comment with the question; In Progress |
| proposed | comment: rev N, entry, explanation, progress and margin; label `loss-warning` on a loss; In Progress |
| approved | comment with the controller's name and reason |
| returned / held | comment with reason; label `needs-rework`; To Do |
| posted | comment with the posting ref and the entry; Done |
| stale | comment; To Do |
