# Devpost submission: RoboAudit

**Project name:** RoboAudit

**Tagline:** An accounting agent that keeps robotics project revenue current, asks the one question it needs by phone, and lets a controller post.

## Inspiration

Robotics companies that install million-dollar systems recognize revenue as work progresses. Every forecast change or field note ("we need another $200,000") moves revenue, and someone has to work out what the note means, recompute, and book an adjustment. One ambiguous word changes the answer by a quarter of a million dollars.

Public evidence. Symbotic, a warehouse-automation company, disclosed a material weakness in controls over the timing of cost-of-revenue recognition, which also affected revenue timing, still described in its quarter ended June 27, 2026 (SEC filing); its auditor earlier called deployment revenue estimates a critical audit matter (10-K). This proves the accounting problem exists at a major robotics company; it does not prove Symbotic would buy this.

## What it does

RoboAudit is the platform; the agent inside it is named Summo.

A deployment manager adds a note. RoboAudit reads it, sees that "another $200,000" could mean additional cost or a new total, and calls the manager. The question is spoken, the answer is transcribed and confirmed, and it is stored as evidence. RoboAudit recomputes: progress falls from 50% to 40%, cumulative revenue from $500,000 to $400,000, margin to $0 with a loss warning. It proposes Dr Revenue 100,000 / Cr Contract asset 100,000 with an explanation. The controller approves, the posting checks run, and the history shows v1 to v2. The next month, "another $50,000 for conveyor rework" is handled with no call, citing the saved convention.

## How we built it

Language, arithmetic and permission to write are kept apart.

- **Claude Opus 5.5** (`claude-opus-5-5`, structured outputs via `messages.parse` with Zod schemas): reads notes into facts with source spans, writes the clarifying question, writes the explanation. It only reads, asks and explains. No schema on the posting path has a money field.
- **Engine** (TypeScript, integer-cent `bigint`, no I/O): progress, revenue, contract asset, margin, adjustment and balanced entries.
- **SpacetimeDB** (TypeScript module): the ledger. Reducers enforce roles, revisions, staleness, period open, debits = credits and unique posting refs, and write a history event on every change. Agent, harness and UI subscribe live.
- **Convex**: the voice clarification channel. Live queries drive the phone page and call pane, mutations move the call through ringing, answering and confirmed, actions call Cartesia, file storage holds question and answer audio, and the scheduler chains them. Convex never touches money.
- **Cartesia**: Sonic TTS speaks the question; Ink STT transcribes the recorded answer over WebSocket. The STT path (Ink over WebSocket) is implemented; the automated demo confirms answers by text, so STT is exercised only from the phone page. Claude and Cartesia TTS were verified end to end with real keys in `pnpm demo --require-real`.
- **Gemini 2.5 Flash**: an independent second reader on the same extraction schema. Gemini runs only when `GEMINI_API_KEY` is set (otherwise there is a single reader). When the readers disagree on the amount, RoboAudit asks instead of guessing; when a saved convention applies to the agreed readings, RoboAudit cites it instead of asking.

## Challenges we ran into

- Rounding: revenue is computed on the exact ratio in `bigint` with round-half-up to the dollar. Computing from rounded basis points (66.67%) would give 666,700 instead of 666,667.
- Staleness: any new evidence must invalidate an open revenue proposal without invalidating a milestone invoice.
- Restart safety: the agent must never double-propose a source it has already handled.
- Getting phone audio into a format a Convex action can stream to STT without transcoding.

## Accomplishments that we're proud of

- The numbers match an independent answer key to the dollar, in the engine tests; the end-to-end demo script asserts the same figures against the ledger.
- Every control in the design is a test: duplicate posting, wrong role, stale proposal, closed period, idempotent propose. Control 6 ("new total") is engine-tested.
- SpacetimeDB resets to the starting state in ~0.5 s; Convex open clarifications are cleared by `resetOpen`.

## What we learned

Most of the work in an accounting agent is deciding what the model is not allowed to do. RoboAudit learns conventions from confirmed answers, once the controller approves them, not model weights. S0 seeds one convention, learned from six past closes (seeded for the demo).

## What's next

Multiple performance obligations and variable consideration, ERP connectors, real authentication, and more convention types learned from historical closes.

## Hyphenate: the four behaviors

- **Learns:** conventions learned from confirmed answers and approved by the controller; here the manager's answer becomes the convention `another_means = additional`, saved when the controller approves rev 2.
- **Runs:** the agent extracts, computes and proposes rev 2 on its own; nobody types a number.
- **Escalates:** an ambiguous word triggers the phone call, and the loss warning (margin $0, then -$50,000) goes to the controller.
- **Improves:** month 3 runs with no call and cites the saved convention.

## Tracks

- Hyphenate — The Hyphenated Enterprise: Autonomous Systems for Finance
- Spacetime — Best Use of Spacetime
- Convex — Best use of Convex
- Cartesia — Best Use of Cartesia
- Microsoft — Built for the Real World
- Atlassian — Best Agent. Submitting for: Best Agent
- MLH — Commit Fellowship Prize Category (opt in on Devpost and complete the supplemental form)
- MLH — Best Use of Gemini API

## Built with

typescript, node.js, pnpm, spacetimedb, convex, cartesia, claude, anthropic, gemini, zod, vitest, vite

## Submission checklist

- [ ] Submit before Oct 25, 9:00 AM PDT
- [ ] Project image uploaded
- [ ] GitHub repo link: https://github.com/Jagga-tech/robaudit
- [ ] Video demo linked
- [ ] Verify exact track names on Hive
- [ ] MLH Commit Fellowship: opted in and supplemental form submitted
- [x] Symbotic paragraph pasted verbatim (from team planning doc, 2026-10-24)
