# Internal benchmark: Summo multi-agent loop

Generated 2026-10-25T10:36:40.517Z by `pnpm bench --db keel-bench --runs 1`.

**Stack.** Local SpacetimeDB (`ws://127.0.0.1:3000`, scratch db `keel-bench`), Convex `https://hushed-shrimp-24.convex.cloud`, agent loop in-process (same wiring as `pnpm agent`).
Models: Claude REAL (claude-opus-5-5, reader + explainer), Gemini REAL (second reader + reviewer), Azure Document Intelligence (scanned sheets). N = 1 run(s).

## A. Reading accuracy: 20/20

Each of the 20 field-note phrasings (`apps/agent/src/bench-cases.ts`) on a fresh S0 (incurred $400,000, remaining $400,000).
Pass = Claude's extraction has the expected fact kind, the system asked exactly when the answer key says the note is ambiguous, and
the resulting remaining forecast is right (direction and amount; questions answered "additional"; no calculation where none is expected).

No failures.

## B. Planted errors

| check | pass | detail (last run) |
|---|---|---|
| ambiguous note -> asks, does not propose | 1/1 | ok clarification_ref open; ok no new proposal; ok work item awaiting_clarification |
| 'new_total' -> 66.67% / +$166,667 | 1/1 | ok progress 6667 bp = 6667; ok adjustment $166,667 = $166,667; ok entry Dr ContractAsset 16666700 / Cr Revenue 16666700 |
| duplicate post refused | 1/1 | ok approve + first post accepted; ok second post refused (duplicate_posting: proposal 138 already posted as BENCH-1); ok one posting for the proposal |
| wrong-role approve refused | 1/1 | ok accountant decide refused (role: requires controller, caller is accountant); ok proposal still open |
| stale after new source | 1/1 | ok status stale; ok approve refused (stale: proposal 140 is stale) |
| post after close refused | 1/1 | ok approved; ok post refused (period_closed: period closed for Oakland deployment); ok no posting |
| scanned sheet 420k -> disagreement recorded, ledger trusted | 1/1 | ok disagreement 42000000 vs 40000000, trusted cost_export; ok calc incurred 40000000 = 40000000; ok progress 4000 = 4000 |
| zero-adjustment sheet (600k after additional) -> calculation, no proposal | 1/1 | ok calculation recorded (4000 bp); ok no new proposal; ok summo skip "no revenue change" |
| month-3 convention reuse (3810 bp, no question) | 1/1 | ok progress 3810 = 3810; ok no new clarification; ok proposal cites another_means |
| injection note -> guard flags, no proposal, no question | 1/1 | ok guard row flagged input: post_now; ok events guard flag, summo skip; ok no reader extraction; ok no calculation; ok no new proposal; ok no question |
| unclear answer "sure" -> fallback_text, nothing confirmed | 1/1 | ok convex status fallback_text; ok clarification_ref open; ok no calculation |

## C. Latency per agent (seconds, from `agent_event.at` and `source.createdAt`)

| step | n | p50 | p95 |
|---|---|---|---|
| confirm → compute (time-to-numbers) | 10 | 0.77 | 1.22 |
| reader-claude read | 29 | 2.34 | 9.50 |
| reader-gemini read | 29 | 2.35 | 9.50 |
| source → ask | 12 | 2.60 | 9.89 |
| ask → answer row (bench confirms at once; incl. 1 s liaison poll) | 11 | 1.23 | 1.66 |
| answer row → compute | 10 | 0.00 | 0.01 |
| explain (compute → explain) | 22 | 5.51 | 6.84 |
| review (explain → propose: Gemini review + propose write) | 22 | 0.94 | 2.09 |
| compute → propose | 22 | 6.54 | 8.35 |
| engine compute (after routing) | 13 | 0.00 | 0.01 |

Both reader rows are written after both readers return (Claude and Gemini run in parallel, Gemini capped at 5 s), so the two reader
rows measure source → both reads, not each model alone. "ask → answer" is not agent time: the bench confirms immediately, so it is the
Convex round trip plus the 1 s liaison poll; with a real person it is however long they take to pick up. The hero metric is
**confirm → compute** (p50 0.77 s, p95 1.22 s):
from the Convex confirm call to the calculation row, i.e. the liaison poll plus resolve and the deterministic engine; the
explanation and proposal follow (compute → propose). Second-model availability this run: reader-claude read 29, reader-gemini read 29, reviewer review 22
(Gemini skips are timeouts or free-tier 429s; the flow continues on Claude alone, by design).

## D. Chain integrity: 0 violation(s) in 22 forecast proposal(s)

Expected per proposal: `[document-reader read, reconciler] → guard pass → reader-claude read → reader-gemini read|skip → summo agree|disagree →
[field-liaison ask → answer | summo skip (convention)] → engine compute → explainer explain → summo propose → reviewer review|skip`.


## Notes

- There is no public benchmark for this task (field-note forecast updates under ASC 606 cost-to-cost). These cases are our own answer key, written alongside the code, so they test regressions, not general ability.
- Simulated: the site lead (the bench confirms answers through the Convex mutation the voice flow calls, no phone audio), the controller and accountant (reducer calls with demo identities), and the source documents (the 20 phrasings and generated forecast sheets). Real: Claude, Gemini, Azure DI, Convex, SpacetimeDB.
- Latency is wall-clock on one laptop against hosted model APIs; expect run-to-run variance. With N = 1, p95 is close to the max.
- Regenerate: `spacetime publish keel-bench --server local --yes --module-path spacetimedb` (once), then `pnpm bench --db keel-bench --runs 1`, then `STDB_DB=keel-bench pnpm demo --reset-only`.
