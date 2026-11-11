// Runs the analysed page, unmodified, in headless Chromium and reports what it does.
//
//   node run_original.mjs demo <page.html> <deps_dir> <out.png> [settings-json]
//   node run_original.mjs live <page.html> <deps_dir> <out.png> <camera.y4m> [settings-json]
//
// <deps_dir> holds local copies of what the page downloads at start, in the versions it pins:
//   node_modules/three (0.160.0), node_modules/@mediapipe/tasks-vision (0.10.14),
//   models/face_landmarker.task, models/hand_landmarker.task
// Its requests for those are answered from disk. Every other request is blocked and listed.
// "live" feeds <camera.y4m> to the page as a fake camera (ffmpeg -loop 1 -i photo.png -t 2 -r 30 -pix_fmt yuv420p camera.y4m).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [mode, htmlPath, deps, out, ...rest] = process.argv.slice(2);
const y4m = mode === 'live' ? rest.shift() : null;
const settings = Object.assign(mode === 'live' ? { showdata: true } : {}, JSON.parse(rest[0] || '{}'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };

const srv = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p !== '/' && p !== '/index.html') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
  fs.createReadStream(htmlPath).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/`;

const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
if (y4m) args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + y4m);
const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1040 }, deviceScaleFactor: +(process.env.DPR || 1) });
const requests = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
  const url = route.request().url();
  let file = null, m;
  if ((m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.*)$/))) file = path.join(deps, 'node_modules/three', m[1]);
  else if ((m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@0\.10\.14\/(.*)$/))) file = path.join(deps, 'node_modules/@mediapipe/tasks-vision', m[1]);
  else if ((m = url.match(/^https:\/\/storage\.googleapis\.com\/mediapipe-models\/.*\/([^/]+\.task)$/))) file = path.join(deps, 'models', m[1]);
  const ok = file && fs.existsSync(file);
  requests.push(`${route.request().method()} ${url.replace(/^https:\/\//, '')}${route.request().postData() ? ' [HAS BODY]' : ''}${ok ? '' : ' [BLOCKED]'}`);
  if (!ok) return route.abort();
  await route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
});
await ctx.addInitScript(s => { try { localStorage.setItem('xr_settings', JSON.stringify(s)); } catch (e) {} }, settings);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
const text = id => page.evaluate(i => document.getElementById(i).textContent, id);

if (mode === 'demo') {
  await page.goto(base + '?still#demo');
  await page.waitForTimeout(3500);
  console.log('status:', await text('status'));
  await page.screenshot({ path: out, fullPage: true });
} else {
  await ctx.grantPermissions(['camera']);
  await page.goto(base);
  const t0 = Date.now();
  await page.click('#start');
  let status = '';
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(500);
    status = await text('status');
    if (/Tracking|Hand found|No face|error|Could not|blocked/i.test(status)) break;
  }
  console.log(`status after ${((Date.now() - t0) / 1000).toFixed(1)} s:`, status);
  await page.waitForTimeout(8000);
  console.log(await text('data'));
  await page.locator('#stage').screenshot({ path: out });
}
console.log('requests:'); for (const r of requests) console.log(' ', r);
await browser.close(); srv.close();
