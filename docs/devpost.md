# Devpost submission: RoboAudit

**Project name:** RoboAudit (Cal Hacks 13.0). The agent inside it is named Summo.

**Tagline:** An accounting agent that keeps robotics project revenue current, asks the one question it needs by phone, and leaves posting to the controller.

**Seats:** Fills the project accountant's revenue-close seat and the part of the controller's week spent chasing deployment managers. Never the approver's seat.

## The moment

A judge scans a QR code and sends a site update in their own words: "we need another 200k to finish."
Two independent readers, Claude and Gemini, flag the same problem: "another" could mean added cost or a new total, and the answer moves revenue by $266,667.
Summo rings the judge's phone and asks one question. The judge answers.
Within about a second the books move: progress 50% to 40%, revenue $500,000 to $400,000, margin to $0 with a loss warning. The controller approves and posts.
Two minutes later someone asks where $400,000 came from. One click on the figure plays the judge's own voice from the audit trail.
Then we try to break it: approve as the accountant, change the forecast after approval, post the same entry twice. The ledger refuses each one and says why.

## Is it real enough?

**The company.** Aster Robotics is fictional and labelled as such. It is installing a warehouse robot system in Oakland under a $1,000,000 fixed-price contract, recognized with cost-to-cost under policy v3. The record holds six past closes, printed forecast sheets with four different figures, and commissioning logs that trigger a milestone invoice.

**Real at judging:** the SpacetimeDB Maincloud ledger, the Convex production channel, Summo running on Azure Container Apps, Claude Opus 5.5 and Gemini 3.5 Flash Lite as readers, Cartesia Sonic and Ink for voice, and Azure Document Intelligence for OCR of photographed sheets.

**Simulated:** the company and its data.

**How we know it works:**
- Engine answer key, to the dollar: the "additional" branch, the "new total" branch, and month 3.
- 10 ledger control tests against a running ledger: wrong role, duplicate posting, stale proposal, closed period, idempotent proposals.
- 20 freeform site-update phrasings, 20/20 on three real-API runs.
- 7 phone-robustness scenarios (reload, dropped connection, double taps, failed upload, stale question, reduced motion) against real Convex and Cartesia.
- The nine-beat demo script, which asserts every figure, run against production with all services real.
- Azure Document Intelligence read all four printed sheets.
- Full evidence (planted errors with answer key, test set, live runs): [docs/proof.md; independent Promptfoo run docs/eval-promptfoo.md (79/79 on Claude and Gemini); internal benchmark docs/benchmark.md](proof.md).

Public evidence. Symbotic, a warehouse-automation company, disclosed a material weakness in controls over the timing of cost-of-revenue recognition, which also affected revenue timing, still described in its quarter ended June 27, 2026 (SEC filing); its auditor earlier called deployment revenue estimates a critical audit matter (10-K). This proves the accounting problem exists at a major robotics company; it does not prove Symbotic would buy this.

## Would you hire it?

**Limits.** Summo holds the agent role and nothing else. The ledger refuses `post` from anyone but the controller. No model output is ever a posted amount: amounts come from a deterministic engine (integer cents) and from a parser that only accepts figures that appear in the source text.

**Clean record.** Every row carries an actor, a time and its evidence. Posted entries are never edited; later evidence produces a new adjustment. The audit trail exports to CSV.

**Knows when to ask.** Summo stops and asks the deployment manager when the wording is ambiguous, when the two readers disagree on the amount, when the amount is spelled out in words, and when claimed savings are larger than the remaining forecast. Loss contracts are escalated to the controller with an explanation that starts with `ESCALATION:`.

**Handles a no.** The controller can Return or Hold a proposal with a reason. It stays unposted, and the reason is on the record.

**Segregation of duties.** In the demo one controller reviews and approves. In production those are two people, and the roles already exist in the ledger.

**Time.** A convention learned from the six past closes tells Summo how to read a "Remaining Estimate" on a forecast sheet. A convention saved when the controller approves an answer ("another means additional") is cited the next month, and Summo does not call again.

## Did we see something new?

- An installed robot system produces its own acceptance evidence: the commissioning log marks the milestone met and Summo proposes the invoice.
- The field channel is a phone call, and its transcript and recording become evidence on the entry.
- Summo learns through scoped, versioned precedents approved by a person, not through retraining.

## Tracks

- Hyphenate — The Hyphenated Enterprise: Autonomous Systems for Finance
- Spacetime — Best Use of Spacetime
- Convex — Best use of Convex
- Cartesia — Best Use of Cartesia
- Microsoft — Built for the Real World
- Atlassian — Best Agent. Submitting for: Best Agent. The Jira mirror is visible in the workbench: Inbox chips, a Jira tab per project, Connections and Agents.
- MLH — Commit Fellowship Prize Category (opt in on Devpost and complete the supplemental form)
- MLH — Best Use of Gemini API

## Built with

typescript, node.js, pnpm, spacetimedb, convex, cartesia, claude, anthropic, gemini, azure-container-apps, azure-document-intelligence, azure-static-web-apps, zod, vitest, vite, playwright

## Submission checklist

- [ ] Submit before Oct 25, 9:00 AM PDT
- [ ] Project image uploaded
- [ ] GitHub repo link: https://github.com/Jagga-tech/robaudit
- [ ] Video demo linked; it opens with the moment
- [ ] Verify exact track names on Hive
- [ ] MLH Commit Fellowship: opted in and supplemental form submitted
