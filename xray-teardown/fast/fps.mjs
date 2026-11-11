// Frames per second of a page variant in live mode, and where its main-thread time goes.
//
//   node fps.mjs <page.html> <deps_dir> <camera.y4m> [seconds=20] [settings-json]
//
// <deps_dir> as for ../tools/run_original.mjs. The camera is a looped clip (see that file for how to make one).
// A frame is counted each time the page clears its top canvas, which it does once per drawn frame.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [htmlPath, deps, y4m, secs = '20', settingsJson = '{}'] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };
const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' }); fs.createReadStream(htmlPath).pipe(res); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + y4m] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.grantPermissions(['camera']);
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
  const url = route.request().url(); let file = null, m;
  if ((m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.*)$/))) file = path.join(deps, 'node_modules/three', m[1]);
  else if ((m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@0\.10\.14\/(.*)$/))) file = path.join(deps, 'node_modules/@mediapipe/tasks-vision', m[1]);
  else if ((m = url.match(/^https:\/\/storage\.googleapis\.com\/mediapipe-models\/.*\/([^/]+\.task)$/))) file = path.join(deps, 'models', m[1]);
  if (!file || !fs.existsSync(file)) return route.abort();
  await route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
});
await ctx.addInitScript(s => {
  try { localStorage.setItem('xr_settings', JSON.stringify(s)); } catch (e) {}
  window.__frames = 0; window.__busy = [];
  const cr = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...a) { if (this.canvas && this.canvas.id === 'hud') window.__frames++; return cr.apply(this, a); };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(t => { const t0 = performance.now(); cb(t); const d = performance.now() - t0; if (d > 4) window.__busy.push(d); });
}, JSON.parse(settingsJson));
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${srv.address().port}/`);
await page.click('#start');
for (let i = 0; i < 240; i++) { await page.waitForTimeout(500); if (/Tracking|Hand found|No face|error|Could not/i.test(await page.evaluate(() => document.getElementById('status').textContent))) break; }
await page.waitForTimeout(4000);                    // let the trackers warm up and the quality settle
const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start');
const a = await page.evaluate(() => { window.__busy = []; return { f: window.__frames, t: performance.now() }; });
await page.waitForTimeout(+secs * 1000);
const b = await page.evaluate(() => ({ f: window.__frames, t: performance.now(), busy: window.__busy, status: document.getElementById('status').textContent }));
const { profile } = await cdp.send('Profiler.stop');
const L = b.busy.sort((x, y) => x - y), dt = (b.t - a.t) / 1000;
console.log(`${((b.f - a.f) / dt).toFixed(2)} frames/s (${b.f - a.f} in ${dt.toFixed(1)} s) | busy ticks: median ${L.length ? L[L.length >> 1].toFixed(0) : 0} ms, 90th percentile ${L.length ? L[Math.floor(L.length * 0.9)].toFixed(0) : 0} ms`);
console.log('status:', b.status);
const self = new Map(), idx = new Map(profile.nodes.map(n => [n.id, n]));
profile.samples.forEach((id, i) => { const n = idx.get(id), k = (n.callFrame.functionName || '(anonymous)') + (n.callFrame.url ? ' @' + n.callFrame.url.split('/').pop().slice(0, 26) : ''); self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0)); });
const tot = [...self.values()].reduce((s, v) => s + v, 0);
console.log('main thread, self time:');
for (const [k, v] of [...self.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6)) console.log('  ' + (100 * v / tot).toFixed(1).padStart(5) + '%  ' + k);
await browser.close(); srv.close();
