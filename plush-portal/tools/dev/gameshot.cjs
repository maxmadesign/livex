// usage: node gameshot.cjs <url> <out.png> [width] [height] [waitMs] [evalAfterBoot]
const { chromium } = require('playwright');
(async () => {
  const [url, out, w = '1280', h = '720', wait = '1500', script = ''] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (!t.includes('GPU stall') && !t.includes('[vite]')) logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__bootDone === true || window.__bootError, null, { timeout: 120000 });
  } catch (e) { logs.push('timeout waiting for boot'); }
  if (script) { try { const r = await page.evaluate(script); if (r !== undefined) logs.push('eval: ' + JSON.stringify(r)); } catch (e) { logs.push('eval error: ' + e.message); } }
  await page.waitForTimeout(Number(wait));
  await page.screenshot({ path: out });
  console.log(logs.slice(-25).join('\n'));
  await browser.close();
})();
