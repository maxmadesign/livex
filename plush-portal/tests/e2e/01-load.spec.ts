import { expect, test } from '@playwright/test';
import { boot, plush, state, watch } from './helpers';

test.describe('1. production build loads cleanly', () => {
  test('no console errors, no failed requests, boots to attract mode', async ({ page }) => {
    const w = watch(page);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    const t0 = Date.now();
    await boot(page, { display: 'desktop', quality: 'safe' });
    const bootMs = Date.now() - t0;
    const s = await state(page);
    expect(s.phase).toBe('ATTRACT');
    expect(s.toys.length).toBe(18);
    // Give lazy resources (fonts, thumbnails, audio manifest) a moment to be requested.
    await page.waitForTimeout(4000);
    expect(w.pageErrors, 'uncaught exceptions').toEqual([]);
    expect(w.consoleErrors, 'console errors').toEqual([]);
    expect(w.failedRequests, 'failed requests').toEqual([]);
    expect(w.badResponses, 'HTTP >= 400').toEqual([]);
    // Everything comes from this origin: no CDN, no remote model / font / analytics hosts.
    const foreign = requests.filter((u) => !u.startsWith('http://127.0.0.1:8799/') && !u.startsWith('data:') && !u.startsWith('blob:'));
    expect(foreign, 'requests to other origins').toEqual([]);
    const appLog = await plush<string[]>(page, (p) => p.log());
    expect(appLog.filter((l) => l.startsWith('[error]'))).toEqual([]);
    const bootState = await plush(page, (p) => p.ui().boot);
    expect(bootState).toMatchObject({ stage: 'ready', error: null });
    test.info().annotations.push({ type: 'boot-ms', description: String(bootMs) });
    console.log(`boot ${bootMs} ms, ${requests.length} requests, app log: ${JSON.stringify(appLog)}`);
  });

  test('first run without a preset shows the device chooser inside reach, and it can be dismissed', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 1280 });
    const w = watch(page);
    await boot(page, { display: null, pristine: true, quality: 'safe' });
    const chooser = page.getByTestId('device-chooser');
    await expect(chooser).toBeVisible();
    expect((await state(page)).paused).toBe(true);
    await page.getByTestId('device-portrait86').click({ force: true });
    await expect(chooser).toHaveCount(0);
    // The tutorial follows on a first run; close it.
    const tutorial = page.getByTestId('tutorial');
    if (await tutorial.count()) await page.getByTestId('tutorial-ok').click({ force: true });
    await expect(tutorial).toHaveCount(0);
    const s = await state(page);
    expect(s.profile).toBe('portrait86');
    expect(s.paused).toBe(false);
    expect(await plush(page, (p) => p.settings().display.profile)).toBe('portrait86');
    expect(w.pageErrors).toEqual([]);
  });
});
