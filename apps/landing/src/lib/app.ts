// Shared contract between the workbench shell (src/shell.ts, src/router.ts) and every page module in src/pages/.
// A page module exports a Page (default export preferred); the router mounts it under /workbench.
import type { DbConnection } from '@keel/bindings';
import type { ConvexClient } from 'convex/browser';
export type Ctx = {
  conn: DbConnection;                 // connected as controller (Dana); subscribed to all tables
  convex: ConvexClient;
  api: typeof import('./convex').api;
  navigate: (path: string) => void;   // e.g. navigate('/workbench/projects/42')
  onChange: (cb: () => void) => () => void;   // ledger change listener (from ./ledger)
  judge: () => { name: string } | null;       // current manager from Convex managers.current, cached
  toast: (text: string, kind?: 'info' | 'ok' | 'warn' | 'error') => void;
  summo: (state: 'watching' | 'reading' | 'asking' | 'proposing' | 'posted' | 'refused', detail?: string) => void;
};
export type Page = { route: RegExp; title: string; render: (root: HTMLElement, ctx: Ctx, params: string[]) => (() => void) | void };
