# Phone rehearsal checklist (real iPhone + Android, at the venue)

1. Open the **HTTPS** phone URL (`https://<host>/phone`). Plain http blocks the mic on phones. The footer should read `ledger: online · convex: online`.
2. Type a first name and tap **Join** once. The page says "Hi <name>". A reload keeps you joined.
3. Type or say "we need another $200,000 to finish" and tap **Send update**. You should see "Sent. Summo is reading…".
4. Within about 10 s the phone shows "Summo has a question" and the Hold to answer button pulses. Reloading the page keeps the question.
5. No sound (iOS blocks autoplay)? Tap **Play question**, or just read the question on screen.
6. The first time you hold the mic button, tap **Allow** when the phone asks for the microphone. If you said no, the page shows the option buttons. That's expected.
7. Hold **Hold to answer**, say "it's additional", then let go. A tap shorter than 0.4 s is ignored. Recording stops by itself after 8 s.
8. If Summo heard "additional" or "new total", it marks those words. Tap **That's right**.
9. If the option buttons appear ("I heard …", "The recording didn't send", "Summo is still listening"), tap **Additional**. Nothing is saved until you tap.
10. After you answer: Summo bounces, the page says "Thanks, <name>. Summo is booking it with your name on it.", and goes back Home about 2 s later.
11. Decline path: on a question, tap **Not me / decline**. The phone goes Home, and the workbench shows the question as unconfirmed.
12. Camera: tap **Photograph the forecast sheet**, take the photo, and wait for "Sheet sent. Reading…". Reset between runs with `pnpm demo --reset-only`. Every phone then goes back to the Join screen.
