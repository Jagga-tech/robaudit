/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// envDir points at the repo root so CONVEX_URL / STDB_* written by the backend tooling are visible (see docs/frontend-guide.md).
export default defineConfig({
  plugins: [react()],
  envDir: '../..',
  envPrefix: ['VITE_', 'CONVEX_URL', 'STDB_'],
  server: { port: 5173, host: true },
  test: { environment: 'jsdom', globals: false },
});
