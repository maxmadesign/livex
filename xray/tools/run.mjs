// Opens the page in headless Chromium for a look or a measurement.
//
//   node run.mjs demo <deps_dir> <out.png> [width] [height] [query] [settings-json]
//   node run.mjs live <deps_dir> <out.png> <camera.y4m> [width] [height] [query] [settings-json] [seconds]
//
// <deps_dir> holds local copies of what the page downloads at start (three@0.160.0 and @mediapipe/tasks-vision@0.10.14
// under node_modules/, the four .task files under models/). Its requests for those are answered from disk; anything
// else it tries to reach is blocked and listed. "live" feeds a looped clip to the page as its camera.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');      // fileURLToPath: the folder may have spaces in its name
const [mode, deps, out, ...rest] = process.argv.slice(2);
const y4m = mode === 'live' ? rest.shift() : null;
const [w = '1080', h = '1920', query = '', settingsJson = '{}', secs = '10'] = rest;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.task': 'application/octet-stream',
                '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/' + (process.env.PAGE || 'index.html');
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(file).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
if (y4m) args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + y4m);
const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(process.env.DPR || 1) });
const requests = [];
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
  const url = route.request().url(); let file = null, m;
  if ((m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.*)$/))) file = path.join(deps, 'node_modules/three', m[1]);
  else if ((m = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@0\.10\.14\/(.*)$/))) file = path.join(deps, 'node_modules/@mediapipe/tasks-vision', m[1]);
  else if ((m = url.match(/^https:\/\/storage\.googleapis\.com\/mediapipe-models\/.*\/([^/]+\.task)$/))) file = path.join(deps, 'models', m[1]);
  const ok = file && fs.existsSync(file);
  if (!/fonts\.g/.test(url)) requests.push(`${route.request().method()} ${url.replace(/^https:\/\//, '').slice(0, 110)}${route.request().postData() ? ' [HAS BODY]' : ''}${ok ? '' : ' [BLOCKED]'}`);
  if (!ok) return route.abort();
  await route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
});
await ctx.addInitScript(s => {
  try { if (Object.keys(s).length) localStorage.setItem('livex_xray', JSON.stringify(s)); } catch (e) {}
  window.__frames = 0;
  const cr = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...a) { if (this.canvas && this.canvas.id === 'hud') window.__frames++; return cr.apply(this, a); };
}, JSON.parse(settingsJson));
if (y4m) await ctx.grantPermissions(['camera']);
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error' && !/INFO|Failed to load resource/.test(m.text())) console.log('[console]', m.text().slice(0, 240)); });
const base = `http://127.0.0.1:${srv.address().port}/${query ? '?' + query : ''}`;
const state = () => page.evaluate(() => document.getElementById('state').textContent);
if (mode === 'demo') {
  await page.goto(base + '#demo');
  await page.waitForTimeout(4000);
  console.log('state:', await state());
} else {
  await page.goto(base);
  await page.waitForTimeout(600);
  if (!(await page.evaluate(() => document.getElementById('start').hidden))) await page.click('#go');
  let st = '';
  for (let i = 0; i < 300; i++) { await page.waitForTimeout(500); st = await state(); if (!/(…|\.\.\.)$/.test(st) && !/Press|点/.test(st)) break; }
  await page.waitForTimeout(4000);
  const a = await page.evaluate(() => ({ f: window.__frames, t: performance.now() }));
  await page.waitForTimeout(+secs * 1000);
  const b = await page.evaluate(() => ({ f: window.__frames, t: performance.now(), dbg: document.getElementById('debug').textContent, hint: document.getElementById('hint').hidden ? '' : document.getElementById('hint').textContent }));
  console.log('state:', await state(), '|', ((b.f - a.f) * 1000 / (b.t - a.t)).toFixed(1), 'frames/s', b.hint ? '| hint: ' + b.hint : '');
  if (b.dbg) console.log(b.dbg);
}
await page.screenshot({ path: out });
console.log('requests:', requests.length ? '\n  ' + requests.join('\n  ') : 'none');
await browser.close(); srv.close();
