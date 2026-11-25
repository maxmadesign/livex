import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
export default defineConfig(async ({ command, mode }) => {
  // The API port may come from the shell or from .env (the server reads the same variable).
  const env = loadEnv(mode, process.cwd(), 'PLUSH_');
  const API_PORT = Number(process.env.PLUSH_API_PORT ?? env.PLUSH_API_PORT ?? 8787);
  // Phones on the LAN need HTTPS for the camera: `npm run dev:https` (mode "https") or PLUSH_DEV_HTTPS=1.
  // The dev server then listens on every interface with the same self-signed certificate as `npm start`
  // (kept in .data/tls, or PLUSH_TLS_CERT / PLUSH_TLS_KEY). The API behind the proxy stays plain HTTP on 127.0.0.1.
  const flag = (value: string | undefined) => /^(1|true|yes|on)$/i.test((value ?? '').trim());
  const devHttps = command === 'serve' && !process.env.VITEST && (mode === 'https' || flag(process.env.PLUSH_DEV_HTTPS ?? env.PLUSH_DEV_HTTPS));
  const root = fileURLToPath(new URL('.', import.meta.url));
  const pick = (name: string) => (process.env[name] ?? env[name] ?? '').trim();
  // Loaded only in HTTPS mode, so a plain `npm run dev` / build does not touch the certificate code.
  const tls = devHttps
    ? (await import('./server/tls.js')).ensureTlsMaterial({
        dir: path.join(path.resolve(root, pick('PLUSH_DATA_DIR') || '.data'), 'tls'),
        certFile: pick('PLUSH_TLS_CERT') ? path.resolve(root, pick('PLUSH_TLS_CERT')) : null,
        keyFile: pick('PLUSH_TLS_KEY') ? path.resolve(root, pick('PLUSH_TLS_KEY')) : null,
      })
    : null;
  if (tls) console.log(`[plush-dev] HTTPS with ${tls.source === 'user' ? 'PLUSH_TLS_CERT' : 'a self-signed certificate'} (SHA-256 ${tls.fingerprint256})`);
  const devHost = pick('PLUSH_DEV_HOST') || (devHttps ? '0.0.0.0' : '127.0.0.1');
  // assets/brand/files.json (server/brandFiles.ts): the brand-kit files that exist, so the game never
  // requests a missing official logo or font (a 404 in the console). Live in dev, a snapshot in builds.
  const { BRAND_FILES_PATH, brandFilesJson } = await import('./server/brandFiles.js');
  const publicDir = path.join(root, 'public');
  // Public demo copies (VITE_BRAND=neutral) must not carry a real event's names or marks, not even
  // unused: the GTC kit data is swapped for a stand-in, the GTC dialogue pools are dropped from the
  // line banks, and assets/brand/gtc/ is left out of the build and of its file listing.
  const neutralBuild = (process.env.VITE_BRAND ?? '').trim().toLowerCase() === 'neutral';
  const listBrandFiles = () => {
    const json = brandFilesJson(publicDir);
    if (!neutralBuild) return json;
    const { files } = JSON.parse(json) as { files: string[] };
    return JSON.stringify({ files: files.filter((f) => !f.startsWith('assets/brand/gtc/')) });
  };
  const neutralBundle: Plugin = {
    name: 'plush-neutral-bundle',
    apply: 'build',
    // Before the TypeScript transform, which reprints the source and loses the layout matched below.
    enforce: 'pre',
    transform(code, id) {
      if (!neutralBuild || !/[\\/]src[\\/]ai[\\/]lines[\\/](en|zh|ja)\.ts$/.test(id)) return null;
      // Brand pools are written as `      gtc: [ ... ],` blocks (or on one line) inside each situation.
      const stripped = code.replace(/^ {6}gtc: \[\n[\s\S]*?^ {6}\],\n/gm, '').replace(/^ {6}gtc: \[.*\],\n/gm, '');
      return { code: stripped, map: null };
    },
    closeBundle() {
      if (!neutralBuild) return;
      rmSync(path.join(outDirAbs, 'assets', 'brand', 'gtc'), { recursive: true, force: true });
    },
  };
  let outDirAbs = path.join(root, 'dist');
  const brandFiles: Plugin = {
    name: 'plush-brand-files',
    configResolved(config) {
      outDirAbs = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== `${server.config.base}${BRAND_FILES_PATH}`) return next();
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        res.end(listBrandFiles());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: BRAND_FILES_PATH, source: listBrandFiles() });
    },
  };
  return {
  plugins: [react(), brandFiles, neutralBundle],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      ...(neutralBuild ? [{ find: /^\.\/kitGtc$/, replacement: path.join(root, 'src', 'brand', 'kitGtc.neutral.ts') }] : []),
    ],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: devHost,
    port: 5173,
    strictPort: false,
    ...(tls ? { https: { key: tls.key, cert: tls.cert } } : {}),
    proxy: {
      // xfwd: the API sees the browser's real address (a phone is not "this machine" for key changes).
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false, xfwd: true },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false, xfwd: true },
    },
  },
  // Crawl both HTML entry points up front so the dev server never re-optimises mid-session.
  optimizeDeps: { entries: ['index.html', 'viewer.html'] },
  worker: { format: 'es' as const },
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
