import { defineConfig } from '@playwright/test';

/**
 * End-to-end acceptance tests against the production build.
 *
 *   npm run e2e                      build → serve dist + API on :8799 → run every spec
 *   npm run e2e -- tests/e2e/02-*    one spec
 *
 * The suite is written for headless Chromium with software WebGL (SwiftShader):
 * frames can take seconds there, so tests drive game time through the debug API
 * (`?debug=1` → `window.__plush.fastForward`) instead of waiting on the clock.
 * `PLUSH_E2E_DIST` builds into / serves from another folder than `dist`.
 */
const PORT = 8799;
const DIST = process.env.PLUSH_E2E_DIST ?? 'dist';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: Number(process.env.PLUSH_E2E_WORKERS ?? 1),
  retries: 0,
  timeout: 420_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    actionTimeout: 60_000,
    navigationTimeout: 120_000,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  },
  projects: [
    { name: 'chromium', testIgnore: /camera-fake/ },
    {
      // A synthetic camera stream (Chromium's built-in test pattern): exercises the camera and
      // inference lifecycle, not face tracking of a real person.
      name: 'camera-fake',
      testMatch: /camera-fake/,
      use: {
        launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
      },
    },
  ],
  webServer: {
    command: `node tools/fetch-tracking-assets.mjs && npx vite build --outDir ${DIST} && npx tsx server/index.ts --serve-dist`,
    env: { PLUSH_API_PORT: String(PORT), PLUSH_DIST_DIR: DIST, OPENAI_API_KEY: '', PLUSH_RATE_LIMIT_PER_MIN: '600' },
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
