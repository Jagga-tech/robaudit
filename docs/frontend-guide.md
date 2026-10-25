# Keel frontend integration guide (workbench + phone)

For Tanush. Everything here was checked against the code as of 2026-10-24: `spacetimedb/src`, `packages/bindings/src`, `convex/`, `apps/agent/src/loop.ts`, `apps/harness/src/main.ts` and `scripts/demo.ts`. If something here disagrees with the code, the code is right.

## 1. What the backend does

An accountant adds evidence (a note, a forecast, a commissioning log) to the SpacetimeDB ledger. The agent (`pnpm agent`) is subscribed to `source` and runs Claude on each new source; Gemini runs as a second reader. If the wording is ambiguous ("another $200,000"), the agent asks the deployment manager a question through Convex. Convex speaks it with Cartesia TTS and the phone page rings. Once the manager confirms an answer, the agent writes a `clarification` source, does the arithmetic in `packages/engine` (bigint cents, never the model), and writes a `calculation` plus a `proposal` (journal lines, explanation, evidence ids). The controller approves (`decide`) and posts (`post`). The reducers enforce role, revision, staleness, period, balance and posting-ref uniqueness. Approving a proposal that carries a pending convention saves that convention, so the next "another $X" is handled with no call.

```
 workbench (laptop) ── addSource / decide / post / resetDemo ──▶ ┌─────────────┐
   │  reads all 14 tables (subscription)                          │ SpacetimeDB │
   │                                                              │  db "keel"  │
   │                       agent (Node) ── recordExtraction ───▶  │             │
   │                         │  openClarification / resolveClarification /     │
   │                         │  recordCalculation / propose / openWorkItem /   │
   │                         │  markMilestoneMet                  └─────────────┘
   │                         │ ask() ▲ polls byWorkItem every 1 s
   │                         ▼       │
   └── byWorkItem / transcript ──▶ ┌────────┐ ◀── speakQuestion / transcribe ──▶ Cartesia
 phone ── active / startAnswer / ──▶│ Convex │
          submitAnswerAudio /       └────────┘
          confirm / decline / fallbackText
```

The UI never calls any agent reducer. The workbench calls `addSource`, `decide`, `post`, `resetDemo` and, if you want them, `closePeriod` and `saveConvention`. The phone only talks to Convex.

## 2. Local setup

```bash
pnpm install
spacetime start                 # leave running (SpacetimeDB CLI 2.13)
pnpm stdb:publish               # publishes db "keel" to local and wipes its data
npx convex dev                  # leave running; writes CONVEX_URL to .env.local
pnpm agent                      # agent loop; needs ANTHROPIC_API_KEY in .env, otherwise extraction is mocked
```

Environment values the UI needs:

| What | Where it comes from | Value (local) |
|---|---|---|
| Convex URL | `.env.local` → `CONVEX_URL` (written by `npx convex dev`) | `http://127.0.0.1:...` (local anonymous deployment) |
| SpacetimeDB URI | `.env` → `STDB_URI` (Node only today) | `ws://127.0.0.1:3000` |
| SpacetimeDB db | `.env` → `STDB_DB` | `keel` |

Vite only exposes `VITE_*` variables by default, so the harness uses an envDir trick. Copy it into your app's `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
export default defineConfig({ envDir: '../..', envPrefix: ['VITE_', 'CONVEX_URL', 'STDB_'] });
// then: import.meta.env.VITE_CONVEX_URL ?? import.meta.env.CONVEX_URL
```

The harness only has `['VITE_', 'CONVEX_URL']` and hardcodes `ws://127.0.0.1:3000` and `keel`. Adding `'STDB_'` is my suggestion, so the URI is not hardcoded once we move to Maincloud or Convex cloud. No cloud URLs are configured in the repo yet.

Add the app under `apps/` (it is already in the workspace glob) with deps `"@keel/bindings": "workspace:*"`, `"spacetimedb": "2.13.*"` and `"convex": "^1.48.0"`. Import the Convex API the same way the harness does: `import { api } from '../../../convex/_generated/api'`.

**Seeing it work without a UI:**
- `pnpm demo` runs all nine beats with asserts and prints `DEMO OK`. It runs its own agent in-process, so stop `pnpm agent` first.
- `pnpm demo --reset-only` resets to S0 in about 0.5 s. Use it between judges.
- `pnpm --filter @keel/harness dev` opens an unstyled page with one button per beat and a live JSON dump of the tables. It is your reference implementation.

## 3. Connecting to SpacetimeDB from the browser

Import from `@keel/bindings`, never from `@keel/ledger-client`. That package imports `node:fs` and `ws` and is Node-only.

```ts
import { DbConnection } from '@keel/bindings';

export type Role = 'accountant' | 'deployment_manager' | 'controller' | 'agent';
const NAMES: Record<Role, string> = { accountant: 'Priya', deployment_manager: 'Matt', controller: 'Dana', agent: 'Keel Agent' };
// Subscription SQL uses the snake_case wire names; conn.db uses camelCase (work_item -> conn.db.workItem).
const TABLES = ['user', 'project', 'policy', 'convention', 'source', 'extraction', 'clarification_ref', 'work_item',
  'calculation', 'proposal', 'approval', 'posting', 'contract_milestone', 'history_event'];

export async function connect(role: Role, onChange: () => void): Promise<DbConnection> {
  const key = `keel-token-${role}`; // one identity per role, kept per browser
  const conn = await new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder()
      .withUri('ws://127.0.0.1:3000')
      .withDatabaseName('keel')
      .withToken(localStorage.getItem(key) ?? undefined)
      .onConnect((c, _identity, token) => { localStorage.setItem(key, token); resolve(c); })
      .onConnectError((_ctx, e) => reject(e))
      .build();
  });
  await new Promise<void>((resolve, reject) => {
    conn.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject((ctx as any).event ?? new Error('subscription failed')))
      .subscribe(TABLES.map((t) => `SELECT * FROM ${t}`));
  });
  const me = conn.db.user.identity.find(conn.identity!);
  if (!me || me.role !== role) await conn.reducers.registerDemoUser({ name: NAMES[role], role });
  for (const t of TABLES) {
    const tbl = (conn.db as any)[t.replace(/_(\w)/g, (_: string, x: string) => x.toUpperCase())];
    tbl.onInsert(onChange); tbl.onUpdate?.(onChange); tbl.onDelete(onChange);
  }
  return conn;
}
```

In React, keep a `version` counter that `onChange` increments, and read from the client cache on each render (`[...conn.db.workItem.iter()]`, `conn.db.proposal.id.find(id)`). Callback signatures are `onInsert((ctx, row) => …)`, `onUpdate((ctx, oldRow, newRow) => …)` and `onDelete((ctx, row) => …)`. `resetDemo` fires a delete for every row and then inserts the fresh ones.

**Calling reducers.** They return a promise. When the server throws `SenderError("code: message")`, the promise rejects with an Error whose message contains the code:

```ts
const CODES = ['role', 'revision', 'stale', 'period_closed', 'unbalanced', 'duplicate_posting', 'not_approved', 'not_found', 'bad_input'] as const;
export async function call(f: () => Promise<void>): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try { await f(); return { ok: true }; }
  catch (e: any) {
    const message = String(e?.message ?? e);
    return { ok: false, code: CODES.find((c) => new RegExp(`\\b${c}:`).test(message)) ?? 'unknown', message };
  }
}
// call(() => conn.reducers.decide({ proposalId: p.id, revision: p.revision, decision: 'approve', reason: '' }))
```

What each code means for the UI:
- `role`: wrong identity. Only `controller` can call `decide`, `post`, `closePeriod` and `saveConvention`.
- `revision`: not the latest revision, or the proposal was already decided.
- `stale`: new evidence arrived after this proposal.
- `period_closed`: the project period is closed.
- `unbalanced` or `bad_input`: something is wrong with the entry.
- `duplicate_posting`: the postingRef or the proposal has already been posted.
- `not_approved`: `post` was called before `decide`.
- `not_found`: a bad id.

**Types and conversions:**
- All ids and cents are `bigint` (`u64`/`i64`). `revision`, `version`, `progressBp` and `policyVersion` are plain `number`s.
- Timestamps are SpacetimeDB `Timestamp` objects; call `row.at.toDate()`. `clarificationRef.confirmedAt` holds `Timestamp.UNIX_EPOCH` until the clarification is confirmed.
- **Never hardcode ids.** Auto-increment keeps counting across `resetDemo`. Find the project with `[...conn.db.project.iter()].find(p => p.name === 'Oakland deployment')`.

```ts
export const usd = (c: bigint) => {
  const a = c < 0n ? -c : c, cents = a % 100n;
  return `${c < 0n ? '-' : ''}$${(a / 100n).toLocaleString('en-US')}${cents ? '.' + String(cents).padStart(2, '0') : ''}`;
};
export const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`; // 4000 -> "40.00%"
export const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
export type Line = { account: 'Revenue' | 'ContractAsset' | 'AccountsReceivable'; debit: string; credit: string }; // cents as strings
export const lines = (entryJson: string) => (JSON.parse(entryJson) as Line[]).map((l) => ({ ...l, debit: BigInt(l.debit), credit: BigInt(l.credit) }));
export const ids = (csv: string) => csv.split(',').filter(Boolean).map(BigInt);
```

## 4. Data model for the screens

| Table (`conn.db.*`) | Columns | Meaning |
|---|---|---|
| `user` | identity, name, role | Role is one of `accountant`, `deployment_manager`, `controller` or `agent`. |
| `project` | id, name, contractValueCents, periodOpen | One project: "Oakland deployment", $1,000,000. |
| `policy` | id, version, text, approvedBy, approvedAt | v3, "Cost-to-cost, single performance obligation, fixed price". |
| `convention` | id, projectCompanyScope, template, key, value, exampleSourceIds (csv), policyVersion, approvedBy | Learned rules. The seed has `forecast.remaining_estimate_means = future_costs_only`. |
| `source` | id, projectId, kind, version, text, parentSourceId (0 = none), hash, createdAt | Kinds: `contract`, `cost_export`, `forecast`, `note`, `clarification`, `commissioning_log`, `invoice`. |
| `extraction` | id, sourceId, reader (`claude`/`gemini`), factsJson, ambiguityFlag, ambiguityText | One row per reader per source. |
| `clarificationRef` | id, workItemId, sourceId, convexId, question, status (`open`/`confirmed`), answer, speaker, confirmedAt, audioStorageId | Mirror of the Convex call; `audioStorageId` is the Convex answer audio. |
| `workItem` | id, projectId, title, status, assignedRole | The queue. |
| `calculation` | id, workItemId, forecastSourceId, inputsJson, progressBp, cumRevenueCents, contractAssetCents, marginCents, lossWarning | `inputsJson` = `{contractValueCents, incurredCents, remainingCents, billedCents}` as strings. |
| `proposal` | id, workItemId, calculationId (0 = invoice), revision, entryJson, explanation, evidenceSourceIds (csv), pendingConventionJson (`''` or `{template,key,value}`), status | |
| `approval` | id, proposalId, revision, decision (`approve`/`return`/`hold`), by, reason, at | |
| `posting` | id, proposalId, revision, postingRef (unique), linesJson, postedBy, postedAt | The seed has `OAK-2026-09-R1`. |
| `contractMilestone` | id, projectId, name, amountCents, status (`pending`/`met`/`invoiced`) | `acceptance`, $200,000. |
| `historyEvent` | id, projectId (0 for user/convention events), kind, refId, summary, actor, at | Append-only log. |

**Work item status** (`workItem.status`):

```
posted|open ──openClarification──▶ awaiting_clarification ──resolveClarification──▶ open
any ──propose──▶ proposed ──decide──▶ approved | returned | held
proposed ──addSource (open revenue proposal)──▶ stale ──propose──▶ proposed
approved ──post──▶ posted
```

**Proposal status:** `open` → `approved`/`returned`/`held` through `decide`. `open` → `stale` through `addSource` (only when `calculationId != 0`) or through a newer `propose`. `posted` appears only on the S0 seed row; a live `post` leaves the proposal at `approved`. To decide whether a proposal is posted, look for a `posting` row with that `proposalId`.

**Where the four Hyphenate behaviors show up:**
- **Learns:** `convention` rows, and the proposal's `pendingConventionJson` (shown as "Approving saves: forecast.another_means = additional"). `decide(approve)` inserts the convention row and a `convention_saved` history event.
- **Runs:** the `historyEvent` stream. Kinds: `seed`, `reset`, `register_user`, `source_added`, `extraction`, `clarification_opened`, `clarification_confirmed`, `calculation`, `proposed`, `proposal_stale`, `decision_approve`/`decision_return`/`decision_hold`, `convention_saved`, `posted`, `work_item_opened`, `milestone_met`, `period_closed`.
- **Escalates:** work item `awaiting_clarification` (the call), `calculation.lossWarning`, and an explanation whose first line starts with `ESCALATION:`.
- **Improves:** on month 3 the explanation contains `Convention v3: another_means = additional`, and no Convex call is made.

## 5. Screens

**Queue.** Show `[...conn.db.workItem.iter()]` grouped by `status`, with a badge for `awaiting_clarification` and `stale`.

**Workbench (one work item):**
- **Left:** `source` rows for `projectId`, grouped by `kind` and sorted by `version`/`id`. Clarification sources show `parentSourceId` → the note they answer.
- **Center:**
  - The latest proposal is `maxBy(revision)` over `proposal` filtered by `workItemId`. "After" is `conn.db.calculation.id.find(latest.calculationId)`.
  - "Before" is the calculation of the highest-revision `approved`/`posted` proposal with a lower revision. This mirrors the agent's baseline in `loop.ts`.
  - Show progress, cumulative revenue, contract asset, margin and the loss warning. The adjustment is `after.cumRevenueCents - before.cumRevenueCents`.
  - Invoice proposals have `calculationId = 0`, so there is no calculation to show.
- **Right:**
  - Show `lines(p.entryJson)` as Dr/Cr lines and the `explanation`, split on `\n`. Render the first line in red if it starts with `ESCALATION:`.
  - Show the evidence: `ids(p.evidenceSourceIds)` → `conn.db.source.id.find(id)`.
  - **Approve:** call `decide({proposalId, revision, decision: 'approve', reason: ''})`, then `post({proposalId, revision, postingRef})`. The demo and the harness use `OAK-R${revision}`. Use `` `OAK-WI${workItemId}-R${revision}` `` instead: the invoice work item also starts at revision 1, and refs must be unique across the whole ledger.
  - **Return/Hold:** call `decide` with `'return'` or `'hold'` and a reason; ask for one in the UI. A held or returned revision cannot be decided again; only a new proposal moves it forward.
  - Disable the buttons unless `p.status === 'open'` and the role is controller.

**History timeline.** `historyEvent` sorted by `id`, newest first, filtered to `projectId === oak || projectId === 0n`. Use `actor`, `summary` and `at.toDate()`.

**Learns screen.**
- The six prior-close notes are the sources whose ids appear in the seed convention's `exampleSourceIds`. Filtering by `kind === 'note'` alone would also pick up the live notes.
- Below them, list every `convention` row. After beat 7 a second row appears: `forecast.another_means = additional`, `approvedBy: 'Dana'`, policyVersion 3, and `exampleSourceIds` set to the rev 2 evidence (note id plus clarification source id).

**Call pane (Convex):**

```ts
import { ConvexClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';
const convex = new ConvexClient(import.meta.env.VITE_CONVEX_URL ?? import.meta.env.CONVEX_URL);
const unsub = convex.onUpdate(api.clarifications.byWorkItem, { workItemId: String(workItem.id) }, (rows) => {
  for (const c of rows) convex.onUpdate(api.transcript.byClarification, { id: c._id }, (segs) => { /* render segs[].text */ });
});
```

`workItemId` in Convex is the SpacetimeDB id as a string. Convex clarification fields: `question`, `options` (`['additional','new_total']` from the keyword path; Claude's options when Claude itself flagged the ambiguity), `status`, `answer`, `speaker`, `reason`, `questionAudioId`, `answerAudioId` and `confirmedAt` (ms).

**Audio URLs.** Use `api.clarifications.audioUrl({ storageId })` (returns `string | null`). It lives in `convex/clarifications.ts`:

```ts
export const audioUrl = query({
  args: { storageId: v.id("_storage") },
  handler: (ctx, { storageId }) => ctx.storage.getUrl(storageId),
});
// UI: const url = await convex.query(api.clarifications.audioUrl, { storageId }); new Audio(url!).play();
```

**Evidence trace (clicking $400,000):**
1. Start at `proposal` → `calculation` (`calculationId`).
2. From the calculation, `forecastSourceId` gives the note source ("we need another $200,000 to finish").
3. Find the `source` with `kind === 'clarification'` and `parentSourceId === note.id`. Its text is "Clarification from Matt: Q: … A: additional".
4. Find the `clarificationRef` with `sourceId === note.id`. It carries `speaker`, `confirmedAt` and `audioStorageId`.
5. Pass `audioStorageId` to `audioUrl` and play the manager's voice. The Convex row (`convexId`) also has `questionAudioId` for the question.

## 6. Phone page

The phone page needs only Convex, no SpacetimeDB connection. Subscribe to `api.clarifications.active`, which returns the newest row whose status is `ringing`, `answering` or `fallback_text`, or `null`. Once you `confirm` or `decline`, `active` goes back to `null`, so keep the last row's `_id` locally to show the confirmed screen.

| State | UI | Call |
|---|---|---|
| `ringing` | Ring and show `question`. Play the question audio once `questionAudioId` is set (TTS lands a second or so after `ask`). | Answer button → `startAnswer({id})` |
| `answering` | Record button, then a "Transcribing…" spinner, then show `transcript.byClarification` segments. | upload → `submitAnswerAudio({id, storageId})` |
| (segment shown) | "That's right", or edit the text, then confirm. Option buttons from `options` are a safe default. | `confirm({id, answer, speaker: 'Matt'})` |
| | "No / not me" | `decline({id, reason})` → `unconfirmed` |
| mic fails | Type or dictate with browser `SpeechRecognition` | `fallbackText({id})`, then `confirm({id, answer, speaker})` |

`transcribe` writes **one** final segment (`seq: 0`, `isFinal: true`) after the whole upload; segments do not stream live. The mock text is `MOCK: it's additional`. The agent normalizes `answer` with a regex. The answer must contain "additional", "on top", "more" or "extra", or "new total"/"total" (`new_total` also matches). Anything else leaves the call stuck: the clarification is confirmed in Convex but stays open in the ledger.

```ts
// Record mic -> 16 kHz mono PCM16 WAV (44-byte header). Convex cannot transcode webm/opus.
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  const ac = new AudioContext();
  const src = ac.createMediaStreamSource(stream);
  const proc = ac.createScriptProcessor(4096, 1, 1); // ponytail: deprecated but universal; AudioWorklet if it glitches
  const chunks: Float32Array[] = [];
  proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(proc); proc.connect(ac.destination);
  return async (): Promise<Blob> => {
    proc.disconnect(); src.disconnect(); stream.getTracks().forEach((t) => t.stop());
    const rate = ac.sampleRate; await ac.close();
    const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    return encodeWav16k(all, rate);
  };
}

export function encodeWav16k(input: Float32Array, inRate: number): Blob {
  const ratio = inRate / 16000, n = Math.floor(input.length / ratio);
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);   // PCM, mono
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { // box-filter downsample
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0; for (let j = a; j < b; j++) s += input[j] ?? 0;
    s = Math.max(-1, Math.min(1, s / (b - a)));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([v.buffer], { type: 'audio/wav' });
}

export async function uploadAnswer(convex: ConvexClient, id: Id<'clarifications'>, wav: Blob) {
  const url = await convex.mutation(api.clarifications.generateUploadUrl, {});
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  const { storageId } = await res.json();
  await convex.mutation(api.clarifications.submitAnswerAudio, { id, storageId });
}
// import type { Id } from '../../../convex/_generated/dataModel';
```

For the fallback, `new (window.SpeechRecognition ?? (window as any).webkitSpeechRecognition)()`; on `onresult`, take `results[0][0].transcript` and call `confirm`.

## 7. The nine demo beats

The S0 baseline is incurred $400k, remaining $400k, 50.00%, revenue $500,000, billed $300,000, asset $200,000, margin $200,000. Each Claude read takes about 2–6 s with a real key, and a forecast note needs two reads (extract, then explain). Show a "Keel is reading…" state from `source_added` until the next `calculation`/`proposed`/`clarification_opened` event for that source.

| # | Who clicks what | Watch | Expected |
|---|---|---|---|
| 1 | Reset (`resetDemo({})` + `clarifications.resetOpen({})`) | everything | 1 work item `posted`, 1 proposal `posted` rev 1, calc 5000 bp, posting `OAK-2026-09-R1` |
| 2 | (agent running) | — | nothing visible |
| 3 | Priya: `addSource({projectId, kind:'note', text:'we need another $200,000 to finish', parentSourceId:0n, version:1})` | `source`, `extraction` | extraction `ambiguityFlag: true` |
| 4 | — | Convex `active`; `workItem` | Phone `ringing`; work item `awaiting_clarification`; question "Is the $200,000 additional to the current remaining forecast, or the new total remaining?" (keyword path; Claude may phrase it) |
| 5 | Matt on phone: confirm `additional` | Convex row `confirmed`; `clarificationRef` `confirmed`; new `clarification` source | work item → `open` |
| 6 | — | `calculation`, `proposal` rev 2 | 4000 bp (40.00%), revenue $400,000, asset $100,000, margin $0, `lossWarning: true`, entry **Dr Revenue 100,000 / Cr ContractAsset 100,000**, explanation starts `ESCALATION:`, pending `{forecast, another_means, additional}` |
| 7 | Dana: Approve (`decide` then `post`) | `approval`, `posting`, `convention` | work item `posted`; new convention `another_means = additional` approvedBy Dana |
| 8 | Priya: `addSource` kind `commissioning_log`, "Commissioning complete: 48 of 48 units commissioned, throughput test passed 1,200 totes/hr, acceptance criteria met." | `contractMilestone`, new `workItem`, `proposal` | milestone `met`; work item "Milestone invoice: acceptance" `proposed`; entry **Dr AccountsReceivable 200,000 / Cr ContractAsset 200,000** (calculationId 0) |
| 9 | Priya: `addSource` note "another $50,000 for conveyor rework" | `proposal` rev 3 on Oakland | **no** Convex call; remaining $650k, 3810 bp (38.10%), revenue $380,952, asset $80,952, margin −$50,000, loss warning + `ESCALATION:`, entry Dr Revenue 19,048 / Cr ContractAsset 19,048, explanation contains `another_means` |

Ordering rules:
- **Approve and post rev 2 before adding any new source.** `addSource` stales every `open` revenue proposal on the project. If rev 2 has not been approved, month 3 also computes from the S0 baseline and the numbers are wrong.
- The invoice proposal (`calculationId = 0`) is **not** staled by later notes, so beat 9 can run while it is still open.
- **"New total" branch** (answer `new_total` in beat 5): remaining $200,000, 6667 bp (66.67%), revenue $666,667, asset $366,667, margin $400,000, no loss, entry Dr ContractAsset 166,667 / Cr Revenue 166,667. Approving it saves `another_means = new_total`. Reset before beat 9, because "another $50,000" would then be read as the new total remaining.

## 7b. Scanned forecast upload (Azure Document Intelligence beat)

The Microsoft-track beat: the accountant uploads a photo or PDF of the forecast sheet and the
agent reads it with Azure Document Intelligence, then runs the normal extraction path.

```ts
// 1. upload the file to Convex storage
const uploadUrl = await convex.mutation(api.clarifications.generateUploadUrl, {});
const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
const { storageId } = await res.json();
// 2. register it as evidence; the agent picks it up from the subscription
await conn.reducers.addSource({ projectId, kind: 'scanned_forecast', text: storageId, parentSourceId: 0n, version: 2 });
```

What to show while it runs: an `extraction` row with `reader === 'azure-di'` appears first
(its `factsJson` is `{ text, tables }`, the OCR output; render the text and the table under the
source), then a `claude` extraction, then a new `calculation` and `proposal` whose
`evidenceSourceIds` contains the scanned source id. Expected with the fixture
`apps/agent/test/fixtures/forecast-v2.pdf`: remaining $600,000 read as the new total (the seeded
convention `remaining_estimate_means = future_costs_only` is cited), progress 40%, adjustment
-$100,000. The page image itself is available for display through
`api.clarifications.audioUrl({ storageId })`, which returns a URL for any storage id.
Without Azure keys the agent runs a mock OCR that returns the same figures; the UI cannot tell
the difference, so design the "reading document..." state for 3-8 seconds either way.

## 8. Gotchas

- **Ids shift after every reset.** Look rows up by name, title or kind each time, never by a cached id.
- `resetDemo` clears every table except `user`, so registered identities keep their roles. After a reset you do not need to call `registerDemoUser` again.
- `pnpm demo --reset-only` does **not** call Convex `resetOpen`. A leftover `ringing` row from an aborted run stays in `active()` until something calls `api.clarifications.resetOpen({})`. Put it on your Reset button.
- `demo/identities.json` holds the Node tokens used by `pnpm agent` and `pnpm demo` (gitignored). Browser tokens live in `localStorage` under `keel-token-<role>`. They are different identities with the same names, which is fine. To start fresh, clear localStorage.
- `addSource` and `resetDemo` have no role check. `decide`, `post`, `closePeriod` and `saveConvention` require controller.
- Node has no global WebSocket, so `@keel/ledger-client` polyfills it with `ws`. Browsers have one natively, so don't import ledger-client.
- `JSON.stringify` throws on bigint. Use the `json` replacer above, and `BigInt(str)` going back.
- Do not run `pnpm demo` and `pnpm agent` at the same time. Both would process each source and ask Convex twice.
- On a real phone, `127.0.0.1` points at the phone itself, and `getUserMedia` needs a secure context (https or localhost). For stage use, serve the phone page over https and point it at a reachable Convex deployment (cloud, not the local anonymous one).
- When `CARTESIA_API_KEY` is not set in the Convex env, the question audio is 0.5 s of silence and the transcript is `MOCK: it's additional`. Keep the question text on screen.
