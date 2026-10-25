import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (f: string) => fileURLToPath(new URL(f, import.meta.url));
// Env comes from the repo root (.env.local for local dev); only VITE_* reaches the browser (docs/frontend-guide.md §2).
// /phone -> phone.html; /workbench/* is client-routed (src/router.ts): serve workbench.html for it in dev and preview, like staticwebapp.config.json does on Azure.
const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
  if (req.url && /^\/workbench(\/[^.]*)?(\?.*)?$/.test(req.url)) req.url = '/workbench.html';
  else if (req.url && /^\/phone\/?(\?.*)?$/.test(req.url)) req.url = '/phone.html';
  next();
};
export default defineConfig({
  plugins: [{ name: 'workbench-routes', configureServer: (s) => { s.middlewares.use(rewrite); }, configurePreviewServer: (s) => { s.middlewares.use(rewrite); } }],
  envDir: '../..',
  envPrefix: ['VITE_'],
  build: { rollupOptions: { input: { index: page('./index.html'), workbench: page('./workbench.html'), phone: page('./phone.html') } } },
});
