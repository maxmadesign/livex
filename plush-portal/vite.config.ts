import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
export default defineConfig(({ mode }) => {
  // The API port may come from the shell or from .env (the server reads the same variable).
  const env = loadEnv(mode, process.cwd(), 'PLUSH_');
  const API_PORT = Number(process.env.PLUSH_API_PORT ?? env.PLUSH_API_PORT ?? 8787);
  return {
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
    },
  },
  // Crawl both HTML entry points up front so the dev server never re-optimises mid-session.
  optimizeDeps: { entries: ['index.html', 'viewer.html'] },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    // The main chunk contains Rapier with its WASM inlined (about 2 MB) plus Three.js.
    chunkSizeWarningLimit: 6500,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 60_000,
  },
};
});
