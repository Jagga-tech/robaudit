// Routes under /workbench. Page modules are picked up from src/pages/*.ts (any export shaped like a Page);
// a nav path with no module yet gets a "coming up" placeholder instead of a crash.
import type { Page } from './lib/app';

const mods = import.meta.glob('./pages/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
import.meta.glob('./pages/*.css', { eager: true });
const isPage = (x: any): x is Page => !!x && x.route instanceof RegExp && typeof x.render === 'function';
export const pages: Page[] = [...new Set(Object.values(mods).flatMap((m) => Object.values(m).filter(isPage)))];

// Sidebar: the five places Dana works. Everything internal (what the agents did and why) sits under Team as sub-pages.
export const NAV = [
  { key: 'inbox', label: 'Inbox', path: '/workbench' },
  { key: 'projects', label: 'Projects', path: '/workbench/projects' },
  { key: 'close', label: 'Close', path: '/workbench/close' },
  { key: 'books', label: 'Books', path: '/workbench/books' },
  { key: 'team', label: 'Team', path: '/workbench/team', group: 'team' },
  { key: 'agents', label: 'Agents', path: '/workbench/agents', group: 'team' },
  { key: 'workflow', label: 'Workflow', path: '/workbench/workflow', group: 'team' },
  { key: 'evidence', label: 'Evidence', path: '/workbench/evidence', group: 'team' },
  { key: 'audit', label: 'Audit trail', path: '/workbench/audit', group: 'team' },
  { key: 'policies', label: 'Policies', path: '/workbench/policies', group: 'team' },
  { key: 'connections', label: 'Connections', path: '/workbench/connections', group: 'team' },
] as { key: string; label: string; path: string; group?: string }[];
/** Sidebar entries: one per group (the group's first item) plus the ungrouped ones. */
export const SIDE = NAV.filter((n, i) => !n.group || NAV.findIndex((m) => m.group === n.group) === i);
/** Sub-pages shown as tabs when the current page belongs to a group. The group's own page is labelled People. */
export const subTabs = (key: string) => { const g = NAV.find((n) => n.key === key)?.group; return g ? NAV.filter((n) => n.group === g).map((n) => ({ ...n, label: n.key === g ? 'People' : n.label })) : []; };
export const sideKey = (key: string) => NAV.find((n) => n.key === key)?.group ?? key;

const clean = (path: string) => path.replace(/\/+$/, '') || '/';

export function resolve(path: string): { page: Page; params: string[] } {
  const p = clean(path);
  for (const page of pages) {
    const m = p.match(page.route) ?? (p + '/').match(page.route);
    if (m) return { page, params: m.slice(1) };
  }
  const nav = NAV.find((n) => n.path === p);
  return {
    page: {
      route: /$^/, title: nav?.label ?? 'Not found',
      render(root) {
        root.innerHTML = nav ? `<p class="empty">${nav.label} is coming up. The page module has not landed yet.</p>`
          : `<p class="empty">No page at ${p.replace(/[<>&"]/g, '')}. <a href="/workbench">Back to the inbox</a>.</p>`;
      },
    },
    params: [],
  };
}

/** Which nav item a path belongs to (longest prefix wins; /workbench itself is the inbox). */
export const navKey = (path: string) => [...NAV].sort((a, b) => b.path.length - a.path.length).find((n) => clean(path) === n.path || clean(path).startsWith(n.path + '/'))?.key ?? 'inbox';
