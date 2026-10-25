# Demo video shot list (90-120 s)

Rule (Hyphenate): open with the moment, not the logo. Total 120 s. Narrator speaks one line per shot.

| # | Sec | On screen | Said (one line) | Must be visible |
|---|---|---|---|---|
| 1 | 0-6 | Phone camera: judge speaks a site update into `/phone` | "We need another two hundred thousand to finish." | Phone page, the judge's first name, the text landing |
| 2 | 6-12 | Laptop: Summo reads, "Summo is asking <Name>" | "Summo noticed 'another' is ambiguous, so it calls." | Two readers' extractions, the ambiguity text |
| 3 | 12-16 | Phone camera: phone rings, judge taps Answer | (phone audio: the question) | Ringing screen with the question |
| 4 | 16-20 | Phone camera, then laptop: judge says "it's additional"; figures move | "They answer by voice. The books move." | 50.00% to 40.00%, revenue $500,000 to $400,000, margin $0 with amber loss warning |
| 5 | 20-25 | Laptop: click the $400,000 figure in the audit trail; the judge's voice plays | "Where did $400,000 come from? Their own voice." | Audio playing, judge's name on the trail row |
| 6 | 25-45 | Laptop: Connections page | "One controller, Summo, two readers, and a ledger that decides what is allowed." | Controller, Summo, Claude and Gemini readers, ledger (SpacetimeDB), Azure/Convex connections |
| 7 | 45-57 | Laptop: Dana approves; five checks listed | "Approval runs five checks before anything posts." | The five checks passing, entry posted |
| 8 | 57-75 | Laptop: the three Break it buttons in order (accountant approve, change after approval, post twice) | "Now we try to break it. The ledger refuses each, and says why." | Codes `role`, `stale`, `duplicate_posting` with reasons |
| 9 | 75-90 | Phone camera, then laptop: photograph the $550k printed sheet; Azure `azure-di` row | "When sources disagree, a printed sheet changes the figure." | Sheet in frame, `azure-di` row, figures moving (+$21,053) |
| 10 | 90-100 | Laptop: month-3 note ("another $50,000 for conveyor rework") | "Month three: no question. It learned the convention." | No phone ring, explanation citing `another_means = additional` |
| 11 | 100-115 | One static card: Real vs Simulated | "Real: ledger, Convex, Azure, Claude, Gemini, Cartesia. Simulated: the company, Aster Robotics." | Two columns, readable for 10+ s (copy from `docs/devpost.md` "Real at judging" / "Simulated") |
| 12 | 115-120 | Card: URL + seats line: "Fills the project accountant's revenue-close seat and the part of the controller's week spent chasing deployment managers. Never the approver's seat." | "Try it: <Azure URL>. Seats at the table." | `https://www.robaudit.us` and the seats line |

Shots 1-5 are the moment (0-20 s needs trimming in edit: the cut from 6 to 16 can run faster than live).

## Recording setup

- Laptop: QuickTime screen recording, 1440x900, browser open on the Azure URL (not localhost, so the QR and links are the public ones). Hide bookmarks and notifications.
- Phone: film with a second phone, or screen-record on iOS (Control Center record, mic off). Use the filmed phone for shots 1 and 3, the screen recording if the camera angle is poor.
- Narrator mic: external or headset mic, voiceover recorded separately or live in a quiet room. Phone audio (the call) must stay audible under it.
- Two takes minimum; keep the better one.

## Reset between takes

```sh
cp demo/identities.maincloud.json demo/identities.json
pnpm demo --reset-only
```

Run with `.env` pointing at Maincloud and Convex prod. Confirm the laptop shows 50.00% / $500,000 and the QR before recording.

## If the voice path fails on the phone

Cut shot 4's voice and use the tap buttons (type the update, tap Additional on the option buttons). The audit trail still shows the judge's name, so shot 5 becomes the name and the typed answer instead of the audio playback; drop the "own voice" line.
