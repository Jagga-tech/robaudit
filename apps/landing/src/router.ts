// Routes under /workbench. Page modules are picked up from src/pages/*.ts (any export shaped like a Page);
// a nav path with no module yet gets a "coming up" placeholder instead of a crash.
import type { Page } from './lib/app';

const mods = import.meta.glob('./pages/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
import.meta.glob('./pages/*.css', { eager: true });
const isPage = (x: any): x is Page => !!x && x.route instanceof RegExp && typeof x.render === 'function';
export const pages: Page[] = [...new Set(Object.values(mods).flatMap((m) => Object.values(m).filter(isPage)))];

export const NAV = [
  { key: 'inbox', label: 'Inbox', path: '/workbench' },
  { key: 'agents', label: 'Agents', path: '/workbench/agents' },
  { key: 'projects', label: 'Projects', path: '/workbench/projects' },
  { key: 'close', label: 'Close', path: '/workbench/close' },
  { key: 'evidence', label: 'Evidence', path: '/workbench/evidence' },
  { key: 'audit', label: 'Audit trail', path: '/workbench/audit' },
  { key: 'policies', label: 'Policies', path: '/workbench/policies' },
  { key: 'connections', label: 'Connections', path: '/workbench/connections' },
  { key: 'team', label: 'Team', path: '/workbench/team' },
];

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
