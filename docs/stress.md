# Stress run: Summo multi-agent loop

Generated 2026-10-25T11:26:39.777Z by `pnpm stress --db keel-stress --rounds 1 --convex https://lovely-squirrel-569.convex.cloud`. Result: **8/8 scenarios passed**.

**Stack.** Local SpacetimeDB `ws://127.0.0.1:3000`, scratch db `keel-stress` (published fresh, data wiped), Convex `https://lovely-squirrel-569.convex.cloud`, agent loop in-process
(same wiring as `pnpm agent`). Models: Claude REAL, Gemini REAL, Azure DI REAL. Every scenario starts from `reset_demo` (S0) + Convex `resetOpen`. Convex anonymous sign-in: ok.

**Log of this run:** `logs/stress-2026-10-25T11-26-39-777Z.jsonl` (125 lines; 0 error, 0 warn). Read it with
`pnpm logs --file logs/stress-2026-10-25T11-26-39-777Z.jsonl`; each scenario is bracketed by `stress/scenario` lines.

## Scenarios

| # | what | expected | observed (last round) | pass | time |
|---|---|---|---|---|---|
| a | Unbalanced entry, then a negative line | post refused `unbalanced`, then `bad_input`; no posting | propose on the seeded calculation is an idempotent no-op (accepted, proposals still 1); unbalanced: approve ok, post refused (unbalanced: debits 10000000 != credits 9999900); no posting for the unbalanced proposal; negative line: approve ok, post refused (bad_input: entryJson); no posting for the negative proposal | 1/1 | 0.4 s |
| b | Rapid fire: 5 notes in < 1 s (valid, additive, savings, injection, chatter) | all handled; one ask per ambiguous note; guard flags injection; no errors; chain intact | 5 notes sent in 15 ms; every note reached a terminal state; asks per note valid:0 additive:1* savings:0 injection:0 chatter:0 (* = flagged ambiguous); guard flagged the injection (flagged input: post_now); no calculation from injection or chatter; no summo error events (0); chain integrity (0 violations) | 1/1 | 23.6 s |
| c | Double confirm race: same clarification, two answers at once | one calculation and one proposal; first committed answer wins | both confirm calls returned (fulfilled, fulfilled); Convex kept Racer A: additional; ledger Racer A: additional; calculations for the note: 1; proposals from the note: 1; no summo error events (0) | 1/1 | 12.9 s |
| d | Reset mid-flight: ask open, reset_demo + resetOpen, same note again | loop recovers; new ask on the new source; nothing done for the old one | new source id 59 != old 48; new ask on source 59; old clarification gone from the ledger (0 rows) and not ringing; Convex active clarification is the new one; no calculation for either note; no summo error events (0) | 1/1 | 8.8 s |
| e | Giant note: 5,000 chars with "the new total remaining is $600,000" buried mid-way | read correctly (remaining $600,000) or asked; no error | note length 5000; outcome: remaining $600000; no summo error events (0) | 1/1 | 15.5 s |
| f | Wrong-role spree | accountant decide/post/closePeriod/saveConvention and agent post all refused `role` | accountant decide: role: requires controller, caller is accountant; accountant post: role: requires controller, caller is accountant; accountant closePeriod: role: requires controller, caller is accountant; accountant saveConvention: role: requires controller, caller is accountant; agent post: role: requires controller, caller is agent; period still open, no new convention | 1/1 | 0.0 s |
| g | Duplicate storm: 3 concurrent posts, same ref | one posting, two `duplicate_posting` | approved; results: posted, duplicate_posting, duplicate_posting; postings for the proposal: 1 | 1/1 | 0.4 s |
| h | Agent restart: kill the loop after the ask, confirm while down, start a new loop | answer still processed after restart (one calculation, one proposal) | no calculation while the agent was down (0); clarification confirmed: additional; calculations 1, proposals 1; field-liaison answer event after restart; no summo error events (0) | 1/1 | 16.2 s |

No failures.

## Log lines per scenario (agent JSONL, excluding the stress brackets)

| scenario | lines | agent/kind |
|---|---|---|
| a (r1) | 2 | none |
| b (r1) | 46 | guard/pass 4, agent/console 16, reader-claude/read 4, reader-gemini/read 4, summo/agree 4, engine/compute 2, explainer/explain 2, summo/propose 2, reviewer/review 2, field-liaison/ask 1, guard/flag 1, summo/skip 2 |
| c (r1) | 18 | guard/pass 1, agent/console 6, reader-claude/read 1, reader-gemini/read 1, summo/agree 1, field-liaison/ask 1, field-liaison/answer 1, engine/compute 1, explainer/explain 1, summo/propose 1, reviewer/review 1 |
| d (r1) | 18 | guard/pass 2, agent/console 6, reader-claude/read 2, reader-gemini/read 2, summo/agree 2, field-liaison/ask 2 |
| e (r1) | 14 | guard/pass 1, agent/console 4, reader-claude/read 1, reader-gemini/read 1, summo/agree 1, engine/compute 1, explainer/explain 1, summo/propose 1, reviewer/review 1 |
| f (r1) | 2 | none |
| g (r1) | 2 | none |
| h (r1) | 19 | guard/pass 1, agent/console 7, reader-claude/read 1, reader-gemini/read 1, summo/agree 1, field-liaison/ask 1, field-liaison/answer 1, engine/compute 1, explainer/explain 1, summo/propose 1, reviewer/review 1 |

## Refusals by code (reducer calls the stress driver made that the ledger refused)

| code | count |
|---|---|
| bad_input | 1 |
| duplicate_posting | 2 |
| role | 5 |
| unbalanced | 1 |

## agent_event rows by agent and kind (all scenarios)

| agent | kind | count |
|---|---|---|
| engine | compute | 5 |
| explainer | explain | 5 |
| field-liaison | answer | 2 |
| field-liaison | ask | 5 |
| guard | flag | 1 |
| guard | pass | 9 |
| reader-claude | read | 9 |
| reader-gemini | read | 9 |
| reviewer | review | 5 |
| summo | agree | 9 |
| summo | propose | 5 |
| summo | skip | 2 |

## Notes

- Scenario a: `propose` with the seeded calculation id is a silent no-op (the reducer is idempotent per calculation and the S0 proposal already uses it), so the driver records a fresh calculation as the agent and proposes on that. Same for g. These proposals bypass the models on purpose: the point is the ledger's checks, not the reading.
- Scenario c: Convex mutations are serialized, so "first" means first committed; which racer wins varies run to run. The check is that the ledger answer matches the one Convex kept and that exactly one calculation and proposal follow.
- Scenario d re-adds the same note text after the reset; source ids are not reused by `reset_demo` (autoinc keeps counting), so the loop's id+text seen-key does not swallow it.
- Scenario h stops the loop and disconnects the agent connection (an in-process stand-in for killing `pnpm agent`); the confirm lands while nothing is polling, and the new loop finds it through `pollConfirmed`.
- Convex is the shared deployment from `.env`: stress clarifications briefly appear there (keyed by scratch-db work item ids) and are closed with `resetOpen` at every reset and at the end. Run it when nobody is on the phone page.
- Simulated: the site lead (Convex `confirm`), controller and accountant (reducer calls with demo identities). Real: Claude, Gemini, Azure DI, Convex, SpacetimeDB. Model output varies run to run; one round is a smoke test, not a rate.
- Regenerate: `pnpm stress --db keel-stress --rounds 1`, then `STDB_DB=keel-stress pnpm demo --reset-only`.

## Prod Convex (`.env`, hushed-shrimp-24): 6/8, a real defect

The same script against the prod Convex in `.env` (log `logs/stress-2026-10-25T11-20-25-886Z.jsonl`) passed a, b, d, e, f, g and
failed c and h: every `clarifications.confirm` was refused with `unauthenticated: sign in (anonymous) before answering a call`, and
`auth:signIn` does not exist on that deployment ("Could not find public function for 'auth:signIn'"). Prod runs a `confirm` that
requires a Convex Auth session but no `auth` functions to create one, so **no phone or text answer can be confirmed on prod
Convex until `npx convex deploy` ships `convex/auth.ts`**. The 8/8 run above used the dev deployment (`--convex`), where sign-in works.

> Note (04:35 PDT): the prod-Convex failures in scenarios c and h above were recorded before Convex Auth was deployed to production at 04:28; production now has `auth.signIn` and confirms succeed (see prod-auth smoke in docs/proof.md).
