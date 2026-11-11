// Renders the teardown figures: serves viewer.html plus the extracted data, drives Chromium, saves element screenshots.
//
//   node figs.mjs <dir holding viewer.html and data/> <path/to/three.module.js> <out_dir> [comma-separated figure names]
//
// DPR=2 (default) gives the sizes used on the page. Needs playwright and three@0.160.0.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [figDir, threePath, outDir, only] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream' };
const srv = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const file = p === '/three.module.js' ? threePath : path.join(figDir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(figDir) && file !== threePath || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/viewer.html`;
const LIST = [
  ['hero', 'fig=hero', 1280, 720],
  ['layer-outline', 'fig=layer&l=outline', 520, 600], ['layer-skull', 'fig=layer&l=skull', 520, 600], ['layer-brain', 'fig=layer&l=brain', 520, 600],
  ['layer-muscles', 'fig=layer&l=muscles', 520, 600], ['layer-eyes', 'fig=layer&l=eyes', 520, 600],
  ['look-xray', 'fig=all', 520, 600], ['look-solid', 'fig=solid', 520, 600], ['look-solid-muscle', 'fig=solidmuscle', 520, 600], ['reveal-half', 'fig=cut', 520, 600],
  ['jaw-0', 'fig=jaw&j=0', 440, 520], ['jaw-50', 'fig=jaw&j=0.5', 440, 520], ['jaw-100', 'fig=jaw&j=1', 440, 520],
  ['fit-front', 'fig=fit&v=front', 520, 600], ['fit-side', 'fig=fit&v=side', 520, 600],
  ['hand', 'fig=hand', 620, 640],
].filter(f => !only || only.split(',').includes(f[0]));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const dpr = +(process.env.DPR || 2);
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
page.on('console', m => console.log('[page]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', e => console.log('[pageerror]', e.message));
fs.mkdirSync(outDir, { recursive: true });
for (const [name, qs, w, h] of LIST) {
  await page.goto(`${base}?${qs}&w=${w}&h=${h}&dpr=${dpr}`);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
  await page.waitForTimeout(150);
  await page.locator('#fig').screenshot({ path: path.join(outDir, name + '.png') });
  console.log('ok', name);
}
await browser.close(); srv.close();
