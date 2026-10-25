# Reading the agent logs

There are two records of what Summo did. They answer different questions.

| record | where | written by | survives |
|---|---|---|---|
| `agent_event` + `history_event` tables | the ledger (SpacetimeDB) | `say()` in `apps/agent/src/bus.ts` (agent_event), every reducer (history_event) | until `reset_demo` |
| JSONL file | `logs/summo-<YYYY-MM-DD>.jsonl` (or `$SUMMO_LOG_FILE`) | `apps/agent/src/logfile.ts`, turned on by `pnpm agent` and `pnpm stress` | until you delete it (`logs/` is gitignored) |

The ledger tables are the audit trail a reviewer sees. The file is the operator's record: it also has console output, reducer
failures, and agent events the ledger refused to store.

## The JSONL line

One JSON object per line, appended, never rotated:

```json
{"ts":"2026-10-25T04:20:11.204Z","level":"info","agent":"field-liaison","kind":"ask","summary":"Is the $200,000 additional ...",
 "refTable":"work_item","refId":"2","projectId":"1","workItemId":"2","latencyMs":41}
```

- `level`: `info`, `warn` (an agent_event the ledger refused, a MOCK reader), `error` (a summo `error` event, a bus exception, a give-up).
- `agent`: `summo`, `guard`, `reader-claude`, `reader-gemini`, `document-reader`, `reconciler`, `engine`, `explainer`, `reviewer`, `field-liaison`; `agent` for console lines and the start-up line; `stress` for stress-run scenario brackets.
- `kind`: an agent_event kind (`read`, `ask`, `answer`, `compute`, `explain`, `propose`, `review`, `skip`, `flag`, `pass`, `error`, ...), `console` for a mirrored console line, `start` for the start-up line, `scenario` for stress brackets.
- `refTable`/`refId`/`projectId`: as on the agent_event row (ids are strings). `sourceId`/`workItemId` are filled when the ref is a source or work item.
- `latencyMs`: round trip of the `logAgentEvent` reducer call for that line.
- `err`: the ledger's refusal code (`role`, `not_approved`, `revision`, `period_closed`, `unbalanced`, `duplicate_posting`, `bad_input`, `not_found`, `stale`) when one is in the message; otherwise the raw message.

The first line of every start is `kind:"start"`: git sha (`$GIT_SHA` or `git rev-parse`), node version, ledger URI/db, Convex URL,
and which readers are REAL or OFF. Anything that looks like a key (`sk-...`, `AQ....`, `Bearer ...`) is replaced with `[redacted]`.

## Commands

```bash
pnpm logs                          # today's file as columns: level, time, agent, kind, summary [ref] (err, latency)
pnpm logs --follow                 # tail it
pnpm logs --agent summo --kind error --since 30m
pnpm logs --file logs/stress-<ts>.jsonl
pnpm logs:export --db keel-local   # ledger agent_event + history_event -> logs/agent_event-<ts>.csv, logs/history_event-<ts>.csv
pnpm logs:export --db keel --out handover/agent_event.csv
```

Level marks in `pnpm logs`: blank = info, `!` = warn, `X` = error. `--since` takes `30s`, `10m`, `2h`, `1d`.
`logs:export` connects read-only with a fresh anonymous identity (`STDB_URI` from env/.env), no demo token needed, and writes every row, timestamps as ISO.

## Typical questions

- *Why did nothing happen to a note?* `pnpm logs --kind skip` (guard flag, no amount, convention applied, zero adjustment), then look for `X` (error) lines in `pnpm logs`.
- *Did the ledger refuse something?* `grep '"err"' logs/summo-*.jsonl`.
- *What happened in a stress scenario?* Open the run's file and read between the `stress/scenario ... start` and `... PASS|FAIL` lines.
