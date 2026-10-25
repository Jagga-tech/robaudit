# Independent eval with Promptfoo

Promptfoo is a third-party harness and grader; the cases and expected values are ours (docs/proof.md).

Promptfoo is the open-source CLI (`promptfoo@0.121.x`, the last line that runs on Node 20). It runs with no account and with telemetry off. It calls the real agent code: `eval/provider.mjs` loads `apps/agent/src/*.ts` through tsx. No agent code was changed for the eval.

## What is evaluated

Each reader case does three things, with no mocks in the reading path:

1. The note is read by the real model: Claude Opus 5.5 (`extract`) or Gemini 3.5 Flash Lite (`extractWithGemini`).
2. The extraction goes through the real Summo loop (`handleNewSource`) on an in-memory ledger at baseline S0. S0 is a $1,000,000 contract with $400,000 incurred, $400,000 remaining and $300,000 billed.
3. The provider returns `facts`, `ambiguity`, `amountCents` (from `parseAmountCents`), `direction` (from `isAdditiveWording` / `isReductionWording`), `decision` (ask / book / none), the question asked, and the remaining amount booked.

`eval/check.cjs` grades each output against `vars.expect`. It uses the same kind and flag rules as `apps/agent/test/phrasings.test.ts`, and every other field must match exactly. The explainer and reviewer are not exercised, because they are stubbed in the in-memory ledger.

| Section | Cases | Runs on |
|---|---|---|
| A. 20 phrasings (proof.md section 3): kind, amount, flag, direction, decision, remaining after booking | 20 | Claude and Gemini |
| B. Planted decision cases. Row 7: savings larger than remaining, so ask with "only $400,000 remains" and make no proposal. Row 8: spelled-out amount, so ask with "Amount not stated" and amount null | 2 | Claude and Gemini |
| C. Engine answer key and answer mapping. Row 1: 'additional' gives 4000 bp / $400,000 / −$100,000, and 'new_total' gives 6667 bp / $666,667 / +$166,667. Row 9: a zero adjustment gives no entry lines. Row 10: `normalizeAnswer` for 4 answers | 7 | engine (no model) |

## Results (2026-10-25, real Claude and real Gemini)

| Section | Claude | Gemini | Engine |
|---|---|---|---|
| A. 20 phrasings | 20/20 | 20/20 | – |
| B. Planted decisions | 2/2 | 2/2 | – |
| C. Engine and answers | – | – | 7/7 |
| **Total** | **22/22** | **22/22** | **7/7** |

There were 51/51 passes on each of two consecutive full runs, with 0 failures and 0 errors. `eval/results.json` holds the second run, `eval-cRo-2026-10-25T10:18:40`.

Latency per reader call (model plus loop, second run):
- Claude: median 2.3 s.
- Gemini: median 1.1 s. Four Gemini calls in one concurrent batch took 54–61 s. Inside the agent, `extractBoth` gives up on Gemini after 5 s and continues with Claude alone, so this would not block a proposal.

## Rerun

```sh
pnpm install
pnpm eval        # the keys come from the git-ignored .env; refuses to grade the mock if ANTHROPIC_API_KEY is missing
pnpm eval:view   # opens the local Promptfoo viewer
```

To run a single section, use `npx promptfoo eval -c eval/promptfooconfig.yaml --no-cache --filter-pattern '^C'`.

## Files

- `eval/promptfooconfig.yaml` holds the cases and their expected values.
- `eval/provider.mjs` is the custom provider. Its `config.reader` is claude, gemini or engine.
- `eval/check.cjs` is the grader assertion.
- `eval/results.json` holds the last run.
