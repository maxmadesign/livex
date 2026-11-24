import { expect, test } from '@playwright/test';
import { expectNeutralAndPlayable, openWithCamera } from './cameraHelpers';

test.describe('13. camera unavailable', () => {
  test('no camera present → fixed neutral view, chip says so, game playable', async ({ browser }) => {
    // Permission is granted, but this headless Chromium has no camera at all.
    const context = await browser.newContext({ permissions: ['camera'], viewport: { width: 1280, height: 720 }, baseURL: 'http://127.0.0.1:8799' });
    const page = await context.newPage();
    await openWithCamera(page);
    expect(await page.evaluate(async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length)).toBe(0);
    await expectNeutralAndPlayable(page, 'no_device');
    await context.close();
  });
});
