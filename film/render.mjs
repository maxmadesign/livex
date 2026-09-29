// Deterministic frame capture: Chromium poses the film at t = frame / fps,
// we screenshot, and pipe JPEG frames straight into ffmpeg (libx264).
//
//   node render.mjs --stills 3,12.5,24          -> out/stills/t_XX.png
//   node render.mjs --video [--from 0 --to 60]  -> out/frames segments -> out/film_silent.mp4
//   node render.mjs --entry test --stills 0
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, '..', 'out');
const FFMPEG = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d; };
const entry = opt('entry', 'film');
const fps = +opt('fps', 30);
const workers = +opt('workers', 3);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const body = await readFile(join(ROOT, p === '/' ? 'index.html' : p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;

const browser = await chromium.launch({ args: ['--disable-web-security', '--font-render-hinting=none', '--disable-gpu-vsync', '--force-color-profile=srgb'] });

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html?entry=${entry}${opt('post', '1') === '0' ? '&post=0' : ''}`);
  const meta = await page.evaluate(() => window.__ready);
  return { page, meta };
}

async function renderFrame(page, t) {
  await page.evaluate(t => window.__render(t), t);
}

if (opt('stills')) {
  await mkdir(join(OUT, 'stills'), { recursive: true });
  const { page } = await openPage();
  for (const s of String(opt('stills')).split(',')) {
    const t = parseFloat(s);
    await renderFrame(page, t);
    const f = join(OUT, 'stills', `${entry}_t${t.toFixed(2).padStart(5, '0')}.png`);
    await page.screenshot({ path: f, type: 'png' });
    console.log('still', f);
  }
} else if (opt('video')) {
  const from = +opt('from', 0), to = +opt('to', 60);
  const n0 = Math.round(from * fps), n1 = Math.round(to * fps);
  await mkdir(join(OUT, 'seg'), { recursive: true });
  const per = Math.ceil((n1 - n0) / workers);
  const t0 = Date.now();
  const segs = await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const a = n0 + w * per, b = Math.min(n1, a + per);
    if (a >= b) return null;
    const file = join(OUT, 'seg', `${entry}_${String(w).padStart(2, '0')}.mp4`);
    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(fps), file], { stdio: ['pipe', 'inherit', 'inherit'] });
    const { page } = await openPage();
    for (let n = a; n < b; n++) {
      await renderFrame(page, n / fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 96 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if ((n - a) % 60 === 0) console.log(`w${w} frame ${n}/${b} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
    return file;
  }));
  const list = join(OUT, 'seg', `${entry}_list.txt`);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(list, segs.filter(Boolean).map(f => `file '${f}'`).join('\n'));
  const outFile = join(OUT, `${entry}_silent.mp4`);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', outFile]);
  console.log('video', outFile, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

await browser.close();
server.close();
