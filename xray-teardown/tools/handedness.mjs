// Prints MediaPipe's handedness label for every hand in the given photos (see handedness.html).
//
//   node handedness.mjs <image_dir> <deps_dir> photo1.png,photo1_flipped.png,...
//
// Compare each label with the hand you can see. In our run (tasks-vision 0.10.14) 6 hands in 5 unmirrored
// photos were all labelled with their true side, and every label swapped when the photo was mirrored.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const [imgDir, deps, names] = process.argv.slice(2);
const T = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.task': 'application/octet-stream' };
const srv = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const f = p.startsWith('/mp/') ? path.join(deps, 'node_modules/@mediapipe/tasks-vision', p.slice(4))
          : p.startsWith('/models/') ? path.join(deps, 'models', p.slice(8))
          : p.startsWith('/img/') ? path.join(imgDir, path.basename(p))
          : path.join(here, 'handedness.html');
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(); const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${srv.address().port}/handedness.html?imgs=${names}`);
await page.waitForFunction(() => window.__out, null, { timeout: 180000 });
const out = await page.evaluate(() => window.__out);
for (const k in out) console.log(k.padEnd(22), JSON.stringify(out[k]));
await browser.close(); srv.close();
