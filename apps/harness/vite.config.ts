import { defineConfig } from 'vite';
// ponytail: expose CONVEX_URL (convex dev writes it without the VITE_ prefix); dev-only page.
export default defineConfig({ envDir: '../..', envPrefix: ['VITE_', 'CONVEX_URL'] });
