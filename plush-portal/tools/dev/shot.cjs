// usage: node shot.cjs <url> <out.png> [width] [height] [waitGlobal]
const { chromium } = require('playwright');
(async () => {
  const [url, out, w = '1100', h = '800', flag = '__viewerReady'] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForFunction((f) => window[f] === true || window.__viewerError, flag, { timeout: 90000 });
  } catch (e) {
    logs.push('timeout waiting for ' + flag);
  }
  const err = await page.evaluate(() => window.__viewerError);
  if (err) logs.push('ERROR ' + err);
  await page.screenshot({ path: out });
  console.log(logs.filter((l) => !l.includes('[vite]')).slice(-12).join('\n'));
  await browser.close();
})();
