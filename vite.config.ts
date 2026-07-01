/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // Honor the port assigned by the preview harness (PORT env); 5173 otherwise.
    port: Number(process.env.PORT) || 5173,
    // Let the Cloudflare tunnels reach the dev server (vite blocks unknown hosts):
    // the named crown-fall.com tunnel (incl. subdomains) and ad-hoc quick tunnels.
    allowedHosts: ['crown-fall.com', '.crown-fall.com', '.trycloudflare.com'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
