# RoboAudit frontend integration guide (workbench + phone)

For Tanush. Everything here was checked against the code as of 2026-10-24: `spacetimedb/src`, `packages/bindings/src`, `convex/` (including `convex/managers.ts`), `apps/agent/src/loop.ts`, `apps/agent/src/bridge.ts`, `apps/harness/src/main.ts` and `scripts/demo.ts`. If something here disagrees with the code, the code is right. The stage script (who does what, timings, fallbacks) is `docs/demo-flow.md`; this guide is how to build it.

> Naming: the platform is **RoboAudit**; the agent service (the thing that reads, asks and proposes) is **Summo**. Label it "Summo" in the queue, workbench and history.

## 1. What the backend does

Evidence (a site note, a photographed forecast sheet, a commissioning log) is added to the SpacetimeDB ledger with `addSource`. In the demo the deployment manager adds it **from the phone** (the judge, on their own phone). Summo (`keel-agent` on Azure Container Apps, or `pnpm agent`) is subscribed to `source` and runs Claude on each new source; Gemini runs as a second reader; a `scanned_forecast` is first read by Azure Document Intelligence. If the wording is ambiguous ("another $200,000"), Summo asks the deployment manager a question through Convex. Convex speaks it with Cartesia TTS and the phone rings. Once the manager confirms an answer, Summo writes a `clarification` source, does the arithmetic in `packages/engine` (bigint cents, never the model), and writes a `calculation` plus a `proposal` (journal lines, explanation, evidence ids). The controller approves (`decide`) and posts (`post`). The reducers enforce role, revision, staleness, period, balance and posting-ref uniqueness. Approving a proposal that carries a pending convention saves that convention, so the next "another $X" is handled with no call.

```
 workbench (laptop, Dana) ── decide / post / resetDemo ─────────▶ ┌─────────────┐
   │  reads all 14 tables (subscription)                          │ SpacetimeDB │
   │                                                              │  db "keel"  │
 phone (judge) ── registerDemoUser / addSource ───────────────▶   │             │
   │                       Summo (Node) ── recordExtraction ───▶  │             │
   │                         │  openClarification / resolveClarification /     │
   │                         │  recordCalculation / propose / openWorkItem /   │
   │                         │  markMilestoneMet                  └─────────────┘
   │                         │ ask() ▲ polls byWorkItem every 1 s
   │                         ▼       │
   │                       ┌────────┐ ◀── speakQuestion / transcribe ──▶ Cartesia
   └── active / startAnswer│ Convex │
       submitAnswerAudio / │        │ ◀── managers.current / byWorkItem / transcript ── workbench
       confirm / fallback- │        │
       Text / managers.join│        │
       generateUploadUrl   └────────┘
```

The UI never calls any agent reducer. The workbench calls `decide`, `post`, `resetDemo`, and `addSource` only for the "Break it" button. The phone calls `registerDemoUser` and `addSource` on SpacetimeDB and the clarification/manager functions on Convex.

## 2. Environments, URLs and setup

### Production (the demo)

| What | Value |
|---|---|
| SpacetimeDB URI | `wss://maincloud.spacetimedb.com` |
| SpacetimeDB db | `keel` (dashboard https://spacetimedb.com/keel) |
| Convex | prod `https://hushed-shrimp-24.convex.cloud` (dev, for rehearsal: `https://lovely-squirrel-569.convex.cloud`) |
| Summo | Azure Container Apps `keel-agent`, resource group `keel-rg` |
| Workbench + phone page | Azure Static Web App `roboaudit-web`, https://www.robaudit.us (HTTPS). The phone page must be HTTPS (mic and camera need a secure context). |

### Azure Static Web Apps deployment

- One Vite app under `apps/` serving two routes: `/` (workbench) and `/phone` (phone page). The QR on the workbench encodes `${location.origin}/phone`.
- Build-time environment variables (set in `.github/workflows/deploy-web.yml`): `VITE_CONVEX_URL=https://hushed-shrimp-24.convex.cloud`, `VITE_STDB_URI=wss://maincloud.spacetimedb.com`, `VITE_STDB_DB=keel`. Vite inlines them at build time, so changing one needs a redeploy.
- Monorepo: the workflow runs `pnpm install` then `pnpm --filter @keel/web build` and uploads `apps/web/dist`; name the package `@keel/web` in `apps/web`. Add an SPA rewrite (`apps/web/public/staticwebapp.config.json`: `{ "navigationFallback": { "rewrite": "/index.html" } }`) so `/phone` loads on a cold open.
- No model or voice key is ever a `VITE_*` variable. The browser holds none.
- Fallback without a redeploy (suggested): let `?convex=<url>` and `?stdb=<uri>` override the env values, and encode them into the QR, so switching to the Convex dev deployment is a URL change.

### Local setup

```bash
pnpm install
spacetime start                 # leave running (SpacetimeDB CLI 2.13)
pnpm stdb:publish               # publishes db "keel" to local and wipes its data
npx convex dev                  # leave running; writes CONVEX_URL to .env.local
pnpm agent                      # Summo; needs ANTHROPIC_API_KEY in .env, otherwise extraction is mocked
```

| What | Where it comes from | Value (local) |
|---|---|---|
| Convex URL | `.env.local` → `CONVEX_URL` (written by `npx convex dev`) | local or the dev cloud deployment |
| SpacetimeDB URI | `.env` → `STDB_URI` | `ws://127.0.0.1:3000` |
| SpacetimeDB db | `.env` → `STDB_DB` | `keel` |

Vite only exposes `VITE_*` variables by default, so the harness uses an envDir trick. Copy it into your app's `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
export default defineConfig({ envDir: '../..', envPrefix: ['VITE_', 'CONVEX_URL', 'STDB_'] });
// then:
export const CONVEX_URL = import.meta.env.VITE_CONVEX_URL ?? import.meta.env.CONVEX_URL;
export const STDB_URI = import.meta.env.VITE_STDB_URI ?? import.meta.env.STDB_URI ?? 'ws://127.0.0.1:3000';
export const STDB_DB = import.meta.env.VITE_STDB_DB ?? import.meta.env.STDB_DB ?? 'keel';
```

On a real phone `127.0.0.1` is the phone itself, and local Convex is unreachable. Test the phone page against Maincloud + a cloud Convex deployment.

Add the app under `apps/` (it is already in the workspace glob) with deps `"@keel/bindings": "workspace:*"`, `"spacetimedb": "2.13.*"` and `"convex": "^1.48.0"`. Import the Convex API the same way the harness does: `import { api } from '../../../convex/_generated/api'`.

**Seeing it work without a UI:**
- `pnpm demo` runs all nine beats with asserts and prints `DEMO OK`. It runs its own agent in-process, so stop `pnpm agent` first. `--remote` uses the deployed agent instead.
- `pnpm demo --reset-only` resets to S0 (and calls Convex `resetOpen`) in about 0.5 s.
- `pnpm --filter @keel/harness dev` opens an unstyled page with one button per beat and a live JSON dump of the tables. It is your reference implementation.

## 3. Who is connected (the one-user model)

There is no role switcher. Each device has a fixed identity:

| Device | Connection | Registered as | Used for |
|---|---|---|---|
| Laptop (workbench) | main connection | `controller`, name `Dana` | everything Dana does: `decide`, `post`, `resetDemo`, the "Change the forecast" `addSource` |
| Laptop (workbench) | second connection, opened only for the "Break it" button | `accountant`, name `Priya` | "Approve as the accountant" (must be refused) |
| Phone (judge's own) | one connection | `deployment_manager`, name = the judge's first name | `addSource` for the update and the photographed sheet |
| Summo | its own token on the server | `agent` | never from the UI |

Each identity is a SpacetimeDB token kept in that browser's `localStorage` under `keel-token-<role>`. The judge's phone gets a fresh identity on first open.

## 4. Connecting to SpacetimeDB from the browser

Import from `@keel/bindings`, never from `@keel/ledger-client`. That package imports `node:fs` and `ws` and is Node-only.

```ts
import { DbConnection } from '@keel/bindings';
import { STDB_URI, STDB_DB } from './env';

export type Role = 'accountant' | 'deployment_manager' | 'controller';
// Subscription SQL uses the snake_case wire names; conn.db uses camelCase (work_item -> conn.db.workItem).
export const TABLES = ['user', 'project', 'policy', 'convention', 'source', 'extraction', 'clarification_ref', 'work_item',
  'calculation', 'proposal', 'approval', 'posting', 'contract_milestone', 'history_event'];

export async function connect(role: Role, name: string, onChange: () => void, tables = TABLES): Promise<DbConnection> {
  const key = `keel-token-${role}`; // one identity per role, kept per browser
  const conn = await new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder()
      .withUri(STDB_URI)
      .withDatabaseName(STDB_DB)
      .withToken(localStorage.getItem(key) ?? undefined)
      .onConnect((c, _identity, token) => { localStorage.setItem(key, token); resolve(c); })
      .onConnectError((_ctx, e) => reject(e))
      .build();
  });
  await new Promise<void>((resolve, reject) => {
    conn.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject((ctx as any).event ?? new Error('subscription failed')))
      .subscribe(tables.map((t) => `SELECT * FROM ${t}`));
  });
  const me = conn.db.user.identity.find(conn.identity!);
  if (!me || me.role !== role || me.name !== name) await conn.reducers.registerDemoUser({ name, role });
  for (const t of tables) {
    const tbl = (conn.db as any)[t.replace(/_(\w)/g, (_: string, x: string) => x.toUpperCase())];
    tbl.onInsert(onChange); tbl.onUpdate?.(onChange); tbl.onDelete(onChange);
  }
  return conn;
}
// laptop: const dana = await connect('controller', 'Dana', bump);
// phone:  const mgr  = await connect('deployment_manager', judgeName, bump, ['user', 'project']);
```

The phone only needs `user` and `project` (to find the project id). In React, keep a `version` counter that `onChange` increments, and read from the client cache on each render (`[...conn.db.workItem.iter()]`, `conn.db.proposal.id.find(id)`). Callback signatures are `onInsert((ctx, row) => …)`, `onUpdate((ctx, oldRow, newRow) => …)` and `onDelete((ctx, row) => …)`. `resetDemo` fires a delete for every row and then inserts the fresh ones.

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
- `role`: wrong identity. Only `controller` can call `decide`, `post`, `closePeriod` and `saveConvention`. Message: `role: requires controller, caller is <role>`.
- `revision`: not the latest revision, or the proposal was already decided.
- `stale`: new evidence arrived after this proposal. Message: `stale: proposal <id> is stale`.
- `period_closed`: the project period is closed.
- `unbalanced` or `bad_input`: something is wrong with the entry. A zero adjustment never reaches `post`: the agent records no proposal for it.
- `duplicate_posting`: `postingRef <ref> already posted`, or `proposal <id> already posted as <ref>`.
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

## 5. Data model for the screens

### SpacetimeDB tables

| Table (`conn.db.*`) | Columns | Meaning |
|---|---|---|
| `user` | identity, name, role | Role is one of `accountant`, `deployment_manager`, `controller` or `agent`. |
| `project` | id, name, contractValueCents, periodOpen | One project: "Oakland deployment", $1,000,000. |
| `policy` | id, version, text, approvedBy, approvedAt | v3, "Cost-to-cost, single performance obligation, fixed price". |
| `convention` | id, projectCompanyScope, template, key, value, exampleSourceIds (csv), policyVersion, approvedBy | Learned rules. The seed has `forecast.remaining_estimate_means = future_costs_only`. |
| `source` | id, projectId, kind, version, text, parentSourceId (0 = none), hash, createdAt | Kinds: `contract`, `cost_export`, `forecast`, `note`, `clarification`, `commissioning_log`, `invoice`, `scanned_forecast` (text = Convex storage id). |
| `extraction` | id, sourceId, reader (`claude`/`gemini`/`azure-di`), factsJson, ambiguityFlag, ambiguityText | One row per reader per source. |
| `clarificationRef` | id, workItemId, sourceId, convexId, question, status (`open`/`confirmed`), answer, speaker, confirmedAt, audioStorageId | Mirror of the Convex call; `audioStorageId` is the Convex answer audio. |
| `workItem` | id, projectId, title, status, assignedRole | The queue. |
| `calculation` | id, workItemId, forecastSourceId, inputsJson, progressBp, cumRevenueCents, contractAssetCents, marginCents, lossWarning | `inputsJson` = `{contractValueCents, incurredCents, remainingCents, billedCents}` as strings. |
| `proposal` | id, workItemId, calculationId (0 = invoice), revision, entryJson, explanation, evidenceSourceIds (csv), pendingConventionJson (`''` or `{template,key,value}`), status | |
| `approval` | id, proposalId, revision, decision (`approve`/`return`/`hold`), by, reason, at | |
| `posting` | id, proposalId, revision, postingRef (unique), linesJson, postedBy, postedAt | The seed has `OAK-2026-09-R1`. |
| `contractMilestone` | id, projectId, name, amountCents, status (`pending`/`met`/`invoiced`) | `acceptance`, $200,000. |
| `historyEvent` | id, projectId (0 for user/convention events), kind, refId, summary, actor, at | Append-only log. `actor` is the caller's registered name (the judge's name for phone sources). The agent identity registers as `Summo` (`packages/ledger-client/src/index.ts`); `registerDemoUser` updates an existing row's name on reconnect, but `reset_demo` keeps user rows and old `historyEvent.actor` strings stay as written, so still display every row whose actor's `user.role === 'agent'` (or `actor === 'Keel Agent'`) as "Summo". |

`extraction.factsJson`: for `claude`/`gemini`, an array of facts (`kind`, `quote`, `amountText`, `charStart`, `charEnd`); for `azure-di`, `{ text, tables }` where `tables` is `string[][][]` (rows of cell strings).

### Convex tables

| Table | Fields | Functions |
|---|---|---|
| `clarifications` | workItemId (SpacetimeDB id as string), question, options, status (`ringing`/`answering`/`confirmed`/`unconfirmed`/`fallback_text`), answer, speaker, reason, questionAudioId, answerAudioId, confirmedAt (ms) | `active`, `byWorkItem`, `startAnswer`, `confirm`, `decline`, `fallbackText`, `resetOpen`, `generateUploadUrl`, `submitAnswerAudio`, `audioUrl` (all in `api.clarifications`) |
| `transcriptSegments` | clarificationId, seq, text, isFinal | `api.transcript.byClarification({ id })` |
| `managers` | name, joinedAt (ms), active | `api.managers.join({ name })` → id (deactivates any previous manager); `api.managers.leave({ id })`; `api.managers.current()` → `{ _id, name, joinedAt } \| null` |

### Statuses

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
- **Improves:** a later "another $X" note is handled with no Convex call, and the explanation contains `Convention v3: another_means = additional`.

## 6. Design direction (from the design lead)

Ledger paper, not a dashboard.

| Token | Value | Use |
|---|---|---|
| paper | `#EEF1EC` | page background |
| ink | `#16212E` | text, figures |
| rules | `#C9D2CC` | hairlines between ledger rows |
| teal | `#0F6B63` | approved / posted, passed checks |
| amber | `#C77A00` | loss warning, open question ("Summo is asking <Name>") |
| error | `#9B3B2E` | refusals (Break it), failed checks |

- **Type:** IBM Plex Sans only (Google Fonts), `font-variant-numeric: tabular-nums` on every figure. Sentence-case labels; no all-caps labels.
- **Hero:** the figure pair. Progress `50.00% → 40.00%` and cumulative revenue `$500,000 → $400,000`, large, before in ink at reduced weight, after in ink. Contract asset and margin sit beneath as smaller pairs; the loss warning is amber text next to margin.
- **Motion:** exactly one orchestrated motion, when the calculation lands after the judge confirms (before figures settle into after figures, adjustment appears). Everything else is instant: no fades on rows, no spinners beyond a plain "Summo is reading" line.
- **Layout:** rows on ruled paper (sources, extractions, the entry's Dr/Cr lines, history). No card grids, no gradient decoration, no shadows as ornament.
- **Phone:** one action per screen, large type (body ≥ 20 px, primary button full width). Screens: name → update → ringing → record → confirm → done → photograph.

## 7. Workbench (laptop, Dana)

**Header:** "RoboAudit", the joined manager line, and the Reset button (§10).

**Joined line and QR.** Subscribe to `api.managers.current`:

```ts
convex.onUpdate(api.managers.current, {}, (m) => setManager(m)); // { _id, name, joinedAt } | null
```

- `null`: show the QR code for `${origin}/phone` (any small QR lib, e.g. `qrcode`) with "Scan to join as deployment manager".
- set: show "<name> joined as deployment manager" and shrink the QR to a corner. Use `name` wherever the UI says who is being asked ("Summo is asking <name>").

**Queue.** `[...conn.db.workItem.iter()]` grouped by `status`, marked when `awaiting_clarification` (amber) or `stale`.

**Workbench (one work item):**
- **Left:** `source` rows for `projectId`, grouped by `kind` and sorted by `version`/`id`. Clarification sources show `parentSourceId` → the note they answer. A `scanned_forecast` shows the image (`api.clarifications.audioUrl({ storageId: source.text })` returns a URL for any storage id) and, under it, the `azure-di` extraction text and table.
- **Reading state:** from a `source_added` for a `note`/`scanned_forecast` until the next `extraction` for that source, show "Summo is reading" (for `scanned_forecast`: "Reading document" until the `azure-di` row, then "Summo is reading"). Then show the extraction rows (`claude`, `gemini`), each with its facts (quote + amount) and `ambiguityText` when `ambiguityFlag`.
- **Center (the figure pair):**
  - "Before" is the calculation of the highest-revision `approved`/`posted` proposal on the work item. This mirrors Summo's baseline in `loop.ts`.
  - "After" is the **newest `calculation`** on the work item that is newer than "before", whether or not a proposal points at it yet. The calculation lands about 1 s after confirm; the proposal 6–9 s later. Run the motion when this row arrives, not when the proposal does.
  - Show progress, cumulative revenue, contract asset, margin and the loss warning. The adjustment is `after.cumRevenueCents - before.cumRevenueCents`.
  - Invoice proposals have `calculationId = 0`, so there is no calculation to show.
- **Right (the proposal):**
  - The latest proposal is `maxBy(revision)` over `proposal` filtered by `workItemId`. Until it exists, show "Summo is writing the entry".
  - Show `lines(p.entryJson)` as Dr/Cr lines and the `explanation`, split on `\n`. Render the first line in amber if it starts with `ESCALATION:`.
  - Evidence: `ids(p.evidenceSourceIds)` → `conn.db.source.id.find(id)`.
  - "Approving saves: <template>.<key> = <value>" when `pendingConventionJson` is set.
  - **Approve:** `decide({proposalId, revision, decision: 'approve', reason: ''})`, then `post({proposalId, revision, postingRef})`. Use `` `OAK-WI${workItemId}-R${revision}` `` (the demo and harness use `OAK-R${revision}`, but the invoice work item also starts at revision 1 and refs must be unique across the ledger).
  - **Five visible checks** while posting, ticked in teal when `post` resolves (or the failing one in error colour with the reducer message): 1. Role is controller. 2. Approved, current revision, not stale. 3. Period open. 4. Debits equal credits. 5. Posting ref unique. These are the checks `post` performs, in its order.
  - After approve: "Convention saved: another_means = additional" when a new `convention` row appears.
  - **Return/Hold:** `decide` with `'return'` or `'hold'` and a reason. A held or returned revision cannot be decided again; only a new proposal moves it forward.
  - Disable Approve unless `p.status === 'open'`.

**Call pane (Convex):**

```ts
import { ConvexClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';
const convex = new ConvexClient(CONVEX_URL);
const unsub = convex.onUpdate(api.clarifications.byWorkItem, { workItemId: String(workItem.id) }, (rows) => {
  for (const c of rows) convex.onUpdate(api.transcript.byClarification, { id: c._id }, (segs) => { /* render segs[].text */ });
});
```

`workItemId` in Convex is the SpacetimeDB id as a string. `options` is `['additional','new_total']` from the keyword path, or Claude's options when Claude itself flagged the ambiguity.

**Audio URLs.** `api.clarifications.audioUrl({ storageId })` returns `string | null`:

```ts
const url = await convex.query(api.clarifications.audioUrl, { storageId }); new Audio(url!).play();
```

**History timeline.** `historyEvent` sorted by `id`, newest first, filtered to `projectId === oak || projectId === 0n`. Use `actor`, `summary` and `at.toDate()`. Summo's rows are its own actor.

**Learns screen.**
- The six prior-close notes are the sources whose ids appear in the seed convention's `exampleSourceIds`. Filtering by `kind === 'note'` alone would also pick up the live notes.
- Below them, list every `convention` row. After approval a second row appears: `forecast.another_means = additional`, `approvedBy: 'Dana'`, policyVersion 3, and `exampleSourceIds` set to the rev 2 evidence (note id plus clarification source id).

**Evidence trace (clicking $400,000):**
1. Start at `proposal` → `calculation` (`calculationId`).
2. From the calculation, `forecastSourceId` gives the note source (the judge's words).
3. Find the `source` with `kind === 'clarification'` and `parentSourceId === note.id`. Its text is "Clarification from <Name>: Q: … A: additional".
4. Find the `clarificationRef` with `sourceId === note.id`. It carries `speaker`, `confirmedAt` and `audioStorageId`.
5. Pass `audioStorageId` to `audioUrl` and play the judge's voice. The Convex row (`convexId`) also has `questionAudioId` for the question.

### Guard rows (flagged input)

The `guard` agent screens every note before Summo reads it. When it flags one, the ledger holds an `extraction` row with `reader = 'guard'` and `factsJson = { flagged, reasons[], amounts[] }`, plus an `agent_event` of kind `flag` (or `pass`). Summo then asks nothing, calculates nothing and proposes nothing for that source. The UI renders it in four places, all through `guardFlag(d, sourceId)` in `src/lib/ui.ts`: the Inbox gets a row "Flagged input · <first reason>" (amber `flagged` tag, "Summo did not act on it. Dana decides.") that opens the project Sources tab; the Sources tab, the Overview activity and the Evidence table show an amber `flagged input` tag with the reasons; the Evidence side sheet adds the raw text in a monospace block labelled "Untrusted text, shown as received". Agents lists `guard` first, and the chain shows `flag` events in amber and `pass` events as small grey lines. The raw text is always escaped, never rendered as HTML.

### Jira rows

`apps/jira-bridge` mirrors every work item into the Jira project `SUMMO` and logs an `agent_event` per mirror: `agent = 'jira-mirror'`, `kind = 'mirror'` (or `error`), `summary = '<ISSUE-KEY> · <headline>'`, `refTable = 'work_item'`, `refId = <workItemId>`. The UI reads them through `jiraFor(conn, workItemId)` and `jiraEvents(d)` in `src/lib/ui.ts`, over the same guarded `subscribeExtra(['agent_event'])` subscription, so a ledger without the table shows no Jira at all. They appear in four places: a mono, black, hairline chip "SUMMO-12 ↗" on Inbox rows and in the Project page header (hidden when the work item has no issue); a Jira tab per project listing the mirror events (errors in red-brown) under the line "Jira is the controller's queue and audit mirror. Nothing posts from Jira; the ledger is the system of record."; a "Jira (Atlassian Forge)" row on Connections (live dot when a mirror landed in the last 60 s); and `jira-mirror` in the Agents roster, whose `mirror` chain rows link the key. Issue links are `${VITE_JIRA_SITE ?? 'https://one-atlas-udgh.atlassian.net'}/browse/<KEY>` and open in a new tab.

## 8. Phone page (the judge)

Served at `/phone` over HTTPS. It talks to Convex for presence and the call, and to SpacetimeDB (as `deployment_manager`) only to add sources.

| Screen | Shows | Call |
|---|---|---|
| 1. Name | "Your first name", one field, Join | `const id = await convex.mutation(api.managers.join, { name })`; keep `id` in memory and `sessionStorage`. Then `connect('deployment_manager', name, bump, ['user','project'])` (calls `registerDemoUser({ name, role: 'deployment_manager' })` once). |
| 2. Update | "What's the latest on site?" text area, a mic button, Send. Hint text: "e.g. we need another $200,000 to finish" | `addSource({ projectId, kind: 'note', text, parentSourceId: 0n, version: 1 })`. Then "Sent. Watch the screen." |
| 3. Ringing | When `api.clarifications.active` returns a row with status `ringing`: the question in large type, Answer | Answer → `startAnswer({ id })` and play the question audio from `questionAudioId` via `audioUrl` (the tap is the user gesture that unlocks audio on iOS). |
| 4. Record | Record / Stop, then "Transcribing…" | `generateUploadUrl` → POST WAV → `submitAnswerAudio({ id, storageId })`. |
| 5. Confirm | The transcript (`transcript.byClarification`), "That's right", plus the `options` as buttons and an edit box | `confirm({ id, answer, speaker: name })`. "Not me" → `decline({ id, reason })` (status `unconfirmed`). |
| 6. Done | "Done. Summo has your answer." then the photograph button | — |
| 7. Photograph | "Photograph the forecast sheet" (camera) and, smaller, "Upload PDF" | see below |
| Re-ask | `active` returns the same row with status `fallback_text` (Summo did not understand the answer) | Show the question again with the option buttons and a text box → `confirm`. |

Subscribe once: `convex.onUpdate(api.clarifications.active, {}, …)`. It returns the newest row whose status is `ringing`, `answering` or `fallback_text`, or `null`. After `confirm`/`decline` it goes back to `null`, so keep the last row's `_id` locally to show the Done screen. Also subscribe to `api.managers.current`: when it becomes `null` (reset) or a different `_id`, return to screen 1.

**Project id:** `[...mgr.db.project.iter()].find(p => p.name === 'Oakland deployment')!.id`, looked up at send time (ids change after reset).

**Speaking the update (browser SpeechRecognition, typing fallback):**

```ts
const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
if (!SR) hideMicButton(); // typing always works
const rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true;
rec.onresult = (e: any) => setText([...e.results].map((r: any) => r[0].transcript).join(''));
rec.onerror = () => hideMicButton(); // permission denied etc. -> type
rec.start(); // on mic button tap; rec.stop() on second tap
```

The judge can edit the text before Send. Nothing is sent until they tap Send.

**Answering the call (Cartesia STT).** `transcribe` writes **one** final segment (`seq: 0`, `isFinal: true`) after the whole upload; segments do not stream live. The mock text is `MOCK: it's additional`. Summo normalizes `answer`: it must contain "additional", "on top", "more" or "extra" (→ `additional`), or "total"/"new total" (→ `new_total`), but not both. Anything else makes Summo call `fallbackText({ id })`, and `active` shows the row again with status `fallback_text`: render the Re-ask screen. If the mic fails, call `fallbackText({ id })` yourself and use the option buttons, then `confirm`.

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

**Photographing the forecast (camera → `scanned_forecast`):**

```html
<input type="file" accept="image/*" capture="environment" />   <!-- camera -->
<input type="file" accept="application/pdf,image/*" />           <!-- "Upload PDF" fallback -->
```

```ts
async function sendForecast(file: File) {
  const uploadUrl = await convex.mutation(api.clarifications.generateUploadUrl, {});
  const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  const { storageId } = await res.json();
  await mgr.reducers.addSource({ projectId, kind: 'scanned_forecast', text: storageId, parentSourceId: 0n, version: 2 });
}
```

Summo fetches the bytes from Convex storage, writes an `extraction` with `reader === 'azure-di'` (`factsJson` = `{ text, tables }`), then a `claude` extraction on the OCR text, then a `calculation` and `proposal` whose `evidenceSourceIds` contains the scanned source id. A "Remaining Estimate" figure is read as the new total remaining and the explanation cites `Convention v3: remaining_estimate_means = future_costs_only`; no call is made. Design "Reading document" for 3–8 s. Without Azure keys the agent's mock OCR always returns $600,000, whatever was photographed.

Sheets: `apps/agent/test/fixtures/sheets/forecast-{550k,600k,700k,350k}.{jpg,pdf}`. Expected values are in `docs/demo-flow.md` (after an approved "additional": $550k → 42.11%, $421,053, +$21,053; $700k → 36.36%, $363,636, −$36,364; $350k → 53.33%, $533,333, +$133,333; $600k → zero adjustment: calculation recorded, no proposal, show "No revenue change").

## 9. "Break it" buttons (laptop)

Three buttons in a quiet row under the proposal. Each shows the refusal in error colour as "Refused: <code>" and the reducer message underneath. Use the `call()` helper.

| Button | Exact calls | Expected |
|---|---|---|
| "Post it again" | after a successful `post`: `dana.reducers.post({ proposalId, revision, postingRef })` with the **same** three values | `duplicate_posting: postingRef OAK-WI<n>-R<rev> already posted` |
| "Approve as the accountant" | `const priya = await connect('accountant', 'Priya', bump)` (once, cached), then `priya.reducers.decide({ proposalId, revision, decision: 'approve', reason: '' })` on an **open** proposal | `role: requires controller, caller is accountant`; the proposal stays `open` |
| "Change the forecast after approval" | with an **open** revenue proposal: `dana.reducers.addSource({ projectId, kind: 'note', text: 'Updated forecast: Remaining Estimate: $700,000', parentSourceId: 0n, version: 3 })`, then `dana.reducers.decide({ proposalId, revision, decision: 'approve', reason: '' })` on the old proposal | `stale: proposal <id> is stale`. Proposal and work item go `stale` (history `proposal_stale`), Approve disables, and Summo writes a fresh proposal from the new source 6–9 s later |

Enable "Post it again" only when a `posting` exists for the latest proposal; the other two only when the latest proposal is `open` and `calculationId != 0`. A posted entry is never staled: `addSource` only stales `open` revenue proposals.

## 10. Reset

Header button, three calls in order:

```ts
await call(() => dana.reducers.resetDemo({}));
await convex.mutation(api.clarifications.resetOpen, {});            // ringing/answering/fallback_text -> unconfirmed
const m = await convex.query(api.managers.current, {});
if (m) await convex.mutation(api.managers.leave, { id: m._id });
```

After reset: 1 work item `posted`, 1 proposal `posted` rev 1, calc 5000 bp, posting `OAK-2026-09-R1`, `managers.current()` is `null` (QR shows, phone returns to the name screen). `resetDemo` clears every table except `user`, so registered identities keep their roles and names. CLI fallback: `pnpm demo --reset-only --remote` (ledger + `resetOpen`, not `managers.leave`).

## 11. The nine backend beats (reference)

This is what `pnpm demo` asserts; the judge-driven order is in `docs/demo-flow.md` (judge = Matt below, Dana = controller, the "Priya" note is sent from the phone). The S0 baseline is incurred $400k, remaining $400k, 50.00%, revenue $500,000, billed $300,000, asset $200,000, margin $200,000. Each Claude read takes about 2–4 s with a real key, and a forecast note needs two reads (extract, then explain, 6–9 s).

| # | Who clicks what | Watch | Expected |
|---|---|---|---|
| 1 | Reset (§10) | everything | 1 work item `posted`, 1 proposal `posted` rev 1, calc 5000 bp, posting `OAK-2026-09-R1` |
| 2 | (agent running) | — | nothing visible |
| 3 | `addSource({projectId, kind:'note', text:'we need another $200,000 to finish', parentSourceId:0n, version:1})` | `source`, `extraction` | extraction `ambiguityFlag: true` |
| 4 | — | Convex `active`; `workItem` | Phone `ringing`; work item `awaiting_clarification`; question "Is the $200,000 additional to the current remaining forecast, or the new total remaining?" (keyword path; Claude may phrase it) |
| 5 | Phone: confirm `additional` | Convex row `confirmed`; `clarificationRef` `confirmed`; new `clarification` source | work item → `open` |
| 6 | — | `calculation`, `proposal` rev 2 | 4000 bp (40.00%), revenue $400,000, asset $100,000, margin $0, `lossWarning: true`, entry **Dr Revenue 100,000 / Cr ContractAsset 100,000**, explanation starts `ESCALATION:`, pending `{forecast, another_means, additional}` |
| 7 | Dana: Approve (`decide` then `post`) | `approval`, `posting`, `convention` | work item `posted`; new convention `another_means = additional` approvedBy Dana |
| 8 | `addSource` kind `commissioning_log`, "Commissioning complete: 48 of 48 units commissioned, throughput test passed 1,200 totes/hr, acceptance criteria met." | `contractMilestone`, new `workItem`, `proposal` | milestone `met`; work item "Milestone invoice: acceptance" `proposed`; entry **Dr AccountsReceivable 200,000 / Cr ContractAsset 200,000** (calculationId 0) |
| 9 | `addSource` note "another $50,000 for conveyor rework" | `proposal` rev 3 on Oakland | **no** Convex call; remaining $650k, 3810 bp (38.10%), revenue $380,952, asset $80,952, margin −$50,000, loss warning + `ESCALATION:`, entry Dr Revenue 19,048 / Cr ContractAsset 19,048, explanation contains `another_means` |

Ordering rules:
- **Approve and post rev 2 before adding any new source.** `addSource` stales every `open` revenue proposal on the project. If rev 2 has not been approved, the next source also computes from the S0 baseline.
- The invoice proposal (`calculationId = 0`) is **not** staled by later notes.
- **"New total" branch** (answer `new_total` in beat 5): remaining $200,000, 6667 bp (66.67%), revenue $666,667, asset $366,667, margin $400,000, no loss, entry Dr ContractAsset 166,667 / Cr Revenue 166,667. Approving it saves `another_means = new_total`. Reset before beat 9, because "another $50,000" would then be read as the new total remaining.
- **Negative update** ("50k less"): remaining falls, progress rises, positive adjustment (from S0 as additional −$50,000: $350,000, 53.33%, $533,333, +$33,333).

## 12. Gotchas

- **Ids shift after every reset.** Look rows up by name, title or kind each time, never by a cached id.
- `resetDemo` clears every table except `user`. After a reset you do not need to call `registerDemoUser` again.
- `pnpm demo --reset-only` calls `resetDemo`, Convex `resetOpen` and `managers.leave`. The Reset button must do all three.
- `demo/identities.json` holds the Node tokens used by `pnpm agent` and `pnpm demo` (gitignored). Browser tokens live in `localStorage` under `keel-token-<role>`. They are different identities with the same names, which is fine. Tokens are per server: a local token does not work on Maincloud. To start fresh, clear localStorage.
- `addSource`, `registerDemoUser` and `resetDemo` have no role check. `decide`, `post`, `closePeriod` and `saveConvention` require controller.
- Node has no global WebSocket, so `@keel/ledger-client` polyfills it with `ws`. Browsers have one natively, so don't import ledger-client.
- `JSON.stringify` throws on bigint. Use the `json` replacer above, and `BigInt(str)` going back.
- Do not run `pnpm demo` (without `--remote`) or `pnpm agent` while `keel-agent` is running. Two agents process each source and ask Convex twice.
- `getUserMedia`, the camera input and SpeechRecognition need a secure context (https). iOS Safari plays audio only after a tap; start question playback from the Answer tap.
- When `CARTESIA_API_KEY` is not set in the Convex env, the question audio is 0.5 s of silence and the transcript is `MOCK: it's additional`. Keep the question text on screen.
- A zero adjustment (e.g. the $600,000 sheet after an approved "additional") gets a calculation but no proposal. Show "No revenue change" (no Approve button) when the newest calculation has no proposal.
- The "Change the forecast" button text is fixed so Summo reads it without a call (a "Remaining Estimate" figure). Do not change it to "another …" after a convention is saved unless you want the convention path.

## Deploying the UI (Azure Static Web Apps)

The app lives in `apps/web` with package name `@keel/web` and builds with `pnpm --filter @keel/web build` into `apps/web/dist`. Pushing to `summo` runs `.github/workflows/deploy-web.yml`, which builds with `VITE_CONVEX_URL`, `VITE_STDB_URI`, `VITE_STDB_DB` set to the production values and uploads `dist` to the Static Web App `roboaudit-web`. URL: https://www.robaudit.us (HTTPS, so the phone mic and camera work). For a SPA with a `/phone` route add `apps/web/public/staticwebapp.config.json`:

```json
{ "navigationFallback": { "rewrite": "/index.html" } }
```

Manual deploy without GitHub: `npx @azure/static-web-apps-cli deploy apps/web/dist --deployment-token <token from az staticwebapp secrets list -n roboaudit-web -g keel-rg> --env production`.

## Scroll story and handoff (Figma frames, build exactly this)

Figma page "07 — Landing Page" in file 8gPKZCS1U6j1LiL5fiGmTX:

| Step | Frame | Node | Trigger to the next step |
|---|---|---|---|
| 01 Hero | Landing / Hero 1440 — v2 suit | 63:62 | user scrolls |
| 02 Meet Summo + QR (pinned) | Scroll / 02 Meet Summo + QR | 78:214 | Convex `managers.current()` becomes non-null (judge joined on the phone). No laptop click. |
| 03 Handoff | Scroll / 03 Handoff — Alex joined, Summo dances | 78:266 | after 1.6 s, auto-scroll |
| 04 Workbench, live | App / First screen (live) 1440 | 67:120 | judge sends an update from the phone |
| 04b After the answer | Workbench / 04b After the answer | 78:291 | approve → posted; Reset returns to 02 |
| Motion spec | Motion spec — scroll, handoff, figures | 78:437 | — |

Rules: the 02→03 handoff must not need a click on the laptop; the figure animation in 04 fires once per clarification confirm (count old→new over 0.9 s, "was X" fades in, margin bar slides and recolors); everything else is instant. Summo's header badge label follows the agent state: watching, reading, asking, proposing, posted, refused. Summo render to reuse: node 63:116 (transparent suit).
