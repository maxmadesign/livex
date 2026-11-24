// usage: node flow.cjs <url> <outPrefix> <width> <height> <script.js>
// The script file exports async (page, shot) => {...}; shot(name) saves <outPrefix>_<name>.png
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [url, prefix, w = '1280', h = '720', scriptPath] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (!/GPU stall|\[vite\]|React DevTools|KHR_parallel/.test(t)) logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
  page.setDefaultTimeout(180000);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__bootDone === true, null, { timeout: 180000 }).catch(() => logs.push('boot timeout'));
  await page.waitForTimeout(700);
  const shot = async (name) => page.screenshot({ path: `${prefix}_${name}.png` });
  try {
    await require(path.resolve(scriptPath))(page, shot, logs);
  } catch (e) { logs.push('flow error: ' + e.message); }
  console.log(logs.slice(-40).join('\n'));
  await browser.close();
})();
