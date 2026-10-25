# @keel/web — Keel frontend

The workbench, evidence replay, and the deployment manager's phone screen.

```bash
pnpm install
pnpm --filter @keel/web dev        # http://localhost:5173  (phone view: /m, launch page: /intro)
pnpm --filter @keel/web test       # 8 unit tests
pnpm --filter @keel/web build      # typecheck + production build
```

## Live vs offline demo

On load the app tries the live stack described in `docs/frontend-guide.md`: SpacetimeDB at `ws://127.0.0.1:3000` (db `keel`), with Convex read from `CONVEX_URL` in the repo `.env.local`. If the ledger doesn't answer within 2.5 s, it switches to the **offline demo backend**. The top-right badge says which one is active, and the badge's menu lets you switch.

| | Live | Offline demo |
|---|---|---|
| Ledger tables | SpacetimeDB subscription | in-browser copy seeded from `demo/seed.json` |
| Reducer guards (role, revision, stale, balance, duplicate posting) | server | mirrored in `src/data/demoBackend.ts` |
| Arithmetic | agent → `@keel/engine` | `@keel/engine` (same package) |
| Agent reading / wording | Claude + Gemini (`pnpm agent`) | scripted, labeled in the UI |
| Manager phone | Convex `clarifications.*` | shared through `localStorage` + `BroadcastChannel` (same browser) |

Force a mode with `?mode=demo` or `?mode=live`. **Reset demo** (badge menu) restores S0 in both modes. In live mode it calls `resetDemo` and declines any open call, because `clarifications.resetOpen` (mentioned in the guide) doesn't exist in `convex/` yet.

## Demo path (3 minutes)

1. Command center → **Send to Keel** ("we need another $200,000 to finish").
2. The investigation shows both readings (−$100,000 / +$166,667). Posting is blocked.
3. **Open manager phone** → choose *Additional $200,000* → **Confirm answer**.
4. The Forecast Bridge animates: 50% → 40%, $500,000 → $400,000, adjustment −$100,000.
5. Switch role to **Dana** → **Approve & post**.
6. **Open evidence trail** → **Trace the dollar** → **Replay event**. The replay is refused with `duplicate_posting`.

## Where things live

- `src/data/` — `model.ts` (table types), `liveBackend.ts`, `demoBackend.ts`, `select.ts` (all derived view models), `KeelProvider.tsx`.
- `src/components/` — `ForecastBridge`, `investigation` (sources, ambiguity, entry, agent panel, stepper), `ManagerClarify`, `PhoneDrawer`, `Shell`, `ui`.
- `src/pages/` — `CommandCenter`, `Investigation`, `AuditReplay`, plus the approvals, ledger, policies and project pages.
- `src/marketing/` — the `/intro` launch page (lazy-loaded). Its figures come from `demo/seed.json` through `@keel/engine` (`scenario.ts`); styles are scoped under `.lp`. Screenshots in `public/landing/` were captured from the offline demo with the agent labelled Summo and the platform RoboAudit.
- `src/styles/` — design tokens taken from the Figma variables (same names as their code syntax).
