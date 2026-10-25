import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (f: string) => fileURLToPath(new URL(f, import.meta.url));
// Env comes from the repo root (.env.local for local dev); only VITE_* reaches the browser (docs/frontend-guide.md §2).
export default defineConfig({
  envDir: '../..',
  envPrefix: ['VITE_'],
  build: { rollupOptions: { input: { index: page('./index.html'), workbench: page('./workbench.html'), phone: page('./phone.html') } } },
});
