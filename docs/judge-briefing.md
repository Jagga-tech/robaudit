# RoboAudit judge briefing (two pages)

Everything the person in front of the judges needs: what it is, how it works, what each sponsor sees, how the demo runs, and the answers to the hard questions. Facts are taken from the code and from `docs/devpost.md`, `docs/demo-flow.md` and `docs/one-pager.md`.

---

## Page 1 · What it is and how it works

### The names

- **RoboAudit** is the product and the brand: the platform a robotics installer's finance team uses. It owns the ledger, the controller's workbench, the deployment manager's phone page, and the landing page.
- **Summo** is the lead agent and the mascot. It is the one agent service (`apps/agent`) that watches the ledger, reads every new source, decides whether to ask a question, runs the recalculation, and writes the proposal. On the Agents page it is the "coordinator, project accountant."
- **The specialists** Summo coordinates: Readers A and B (Claude and Gemini, each extracting facts independently), the Document reader (Azure Document Intelligence, for photographed sheets), the Reconciler (compares the readers), Field liaison and Phone (Convex plus Cartesia, the call), the Engine (integer-cent arithmetic), the Explainer (Claude writing the plain-English reason), Proposal (journal lines plus evidence), and the Posting guard (ledger rules that refuse any post not made by the controller).
- **The one human** is the controller, Dana. Only her role can approve, post, close a period or save a convention. Summo never posts. If asked: several specialists are modules inside Summo's loop rather than separate processes; the roster shows how the work is divided, not nine servers.

### The problem, in one breath

Robotics installers recognise revenue as work progresses: revenue = contract value × (costs incurred ÷ total estimated costs). Every forecast change or field note moves revenue, and someone has to decide what the note means, recompute, and book an adjustment. "We need another $200,000 to finish" can mean additional cost or the new total, and the two readings are a quarter of a million dollars apart. Symbotic, a public warehouse-automation company, disclosed a material weakness over exactly this timing in 2026. That proves the problem is real; it does not prove Symbotic would buy this.

### What happens, step by step

1. **A source arrives.** The deployment manager types or speaks a site note on the phone page, or photographs a forecast sheet. It is written to the SpacetimeDB ledger as a `source` row.
2. **Two readers extract facts.** Claude and Gemini each turn the text into facts with source spans (quote, amount, ambiguity flag). A photo first goes through Azure Document Intelligence.
3. **Reconcile.** If the readers disagree on the amount, or either flags ambiguity, Summo asks instead of guessing. If a saved convention already answers it, Summo cites the convention and skips the call.
4. **The call.** Summo opens a clarification in Convex. Cartesia Sonic speaks the question on the manager's phone, the manager answers aloud, Cartesia Ink transcribes it, the manager confirms the transcript. The answer is stored as a `clarification` source: evidence, not chat.
5. **Recalculate.** The engine (TypeScript, integer cents, no I/O) computes progress, revenue, contract asset, margin and the adjustment. The model never does arithmetic.
6. **Propose.** Summo writes the journal entry (Dr Revenue 100,000 / Cr Contract asset 100,000), the explanation, and the evidence ids. A loss warning is raised when margin goes to zero.
7. **The controller decides.** Dana approves and posts. Ledger reducers enforce role, revision, staleness, open period, debits equal credits, and unique posting reference. Approving a proposal that carries a pending convention saves it.
8. **It improves.** Next month, "another $50,000 for conveyor rework" is handled with no call, citing the saved convention.

### The numbers (project OAK, contract $1,000,000)

| Measure | Before | After "additional $200,000" | If "new total" |
|---|---|---|---|
| Remaining cost | $400,000 | $600,000 | $200,000 |
| Progress | 50% | 40% | 66.7% |
| Cumulative revenue | $500,000 | $400,000 | $666,667 |
| Contract asset | $200,000 | $100,000 | — |
| Expected margin | $200,000 (20%) | $0, loss warning | $400,000 |
| Adjustment | — | −$100,000 | +$166,667 |

Every figure matches an independent answer key to the dollar; the end-to-end demo script asserts the same figures against the ledger.

### What is real and what is simulated

Real: Claude, Gemini, Cartesia, Azure Document Intelligence, SpacetimeDB on Maincloud, Convex production. Simulated: the company, the project, the six past closes behind the seeded convention, and the controller identity. How we know it is right: the engine answer key, seven controls as tests, and the demo script asserting to the dollar.

---

## Page 2 · The demo, the sponsors, the questions

### Run of show (three minutes, judge-driven)

| Beat | Judge does | What everyone sees | Say |
|---|---|---|---|
| 1 | Scans the QR on the laptop, types first name, taps Join | "Name joined as deployment manager" on the workbench | "You are now the person on site." |
| 2 | Types or speaks "we need another 200k to finish", taps Send | New source row, "Summo is reading" | "Summo reads it with two readers." |
| 3 | Watches | Claude and Gemini extraction rows, ambiguity flagged, "Summo is asking Name" | "Two readings, a quarter million apart. It asks instead of guessing." |
| 4 | Phone rings, taps Answer, hears the question, says "it's additional", taps Stop, confirms the transcript | Transcript lands on the workbench | "Your voice is now evidence on the entry." |
| 5 | Watches; Dana approves | 50% to 40%, $500,000 to $400,000, asset $200,000 to $100,000, margin to $0 with the amber loss warning; proposal rev 2 with entry and explanation; five checks tick; "Posted OAK-WI-R2"; "Convention saved" | "The math is integer cents in a tested engine. Dana posts. Summo cannot." |
| 6 | Photographs a printed forecast sheet | "Reading document", the Azure DI row, figures move again, no call, convention cited | "A paper sheet became an evidenced entry, and it did not need to call this time." |
| 7 | Dana presses the three "Break it" buttons | Refusals: duplicate posting, wrong role, stale proposal | "Controls are database rules, not UI checks." |
| 8 | Team resets | Back to the start in under a second | Next judge. |

Fallbacks, in order: call fails within 8 seconds, answer in the app; misheard, fix in the confirm step; sync fails within 5 seconds, answer on the laptop; app down within 10 seconds, play the video.

### What to point at, per sponsor

| Track | Point at | Say |
|---|---|---|
| Hyphenate (primary) | Convention saved on approve; history stream; loss warning and the call; the second update with no call | "It learns a convention from one approval, runs every step on the record, escalates losses and ambiguity to a human, and improves: next time it does not need to call." |
| SpacetimeDB | The "Break it" refusals; laptop and phone updating from one subscription | "Controls are reducers: role, revision, staleness, period, balance, unique posting ref, all enforced in the database." |
| Convex | Phone ringing in real time, presence, audio and photo in storage | "Convex is the human channel: the call, the presence, the recordings, the photo." |
| Cartesia | The question spoken aloud; the judge's own voice transcribed and replayable from the evidence | "Sonic speaks the question, Ink transcribes the answer, and the recording is evidence on the entry." |
| Microsoft | Summo on Azure Container Apps; the photographed sheet read by Azure Document Intelligence | "A phone photo of a paper forecast becomes a posted, evidenced entry." |
| Atlassian | The Jira project SUMMO mirroring every ask, proposal, return and post | "Jira is the audit mirror. It never posts to the ledger." |
| Gemini (MLH) | The Gemini extraction row beside Claude's | "Two independent readers; if they disagree on the amount, Summo asks." |
| Figma | Page 08 of the design file and the Slides deck | "Design states in Figma, motion in code, every running screen captured back into Figma." |

### Hard questions, short answers

- **Why does a higher cost estimate reduce revenue?** Progress is incurred divided by total. A bigger total means a smaller share done.
- **Was this a mistake?** No. An estimate changed.
- **Did you save money?** No. It is an accounting adjustment; cash is unchanged.
- **How do you know it is right?** Four lines of tested arithmetic against an independent answer key, in integer cents. The model reads, asks and explains; it never does the math and never posts.
- **Hard ASC 606 cases?** Out of scope by policy: single performance obligation, fixed price, cost-to-cost.
- **Does it learn?** Conventions and precedents, approved by a person. Not model weights.
- **What if the controller says no?** It stays unposted, with the reason on the record.
- **Evidence after posting?** The posted entry stays, the open proposal goes stale, a new adjustment is proposed.
- **How many agents is it really?** One coordinator service, Summo, with specialist steps and two model readers. The division of labour is real; the count of processes is not the point.

### Links

Live app: https://kind-river-0eb9d010f.5.azurestaticapps.net (landing at /, phone at /phone, workbench at /workbench). Repo: https://github.com/Jagga-tech/robaudit. Figma design: https://www.figma.com/design/8gPKZCS1U6j1LiL5fiGmTX (page 08 is the handoff, page 06 the stage log). Slides: https://www.figma.com/slides/6OP6R1iZp5DaZT7m6FsKoT.
