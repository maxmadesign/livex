import { chromium, test } from '@playwright/test';
import { expectNeutralAndPlayable, openWithCamera } from './cameraHelpers';

/**
 * A camera exists (Chromium's synthetic device) and the permission prompt is
 * answered with "Block" (--use-fake-ui-for-media-stream=deny): the same
 * NotAllowedError a player produces by refusing camera access.
 */
test('13. camera permission denied → fixed neutral view, chip says so, game playable', async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream=deny'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, baseURL: 'http://127.0.0.1:8799' });
    const page = await context.newPage();
    await openWithCamera(page);
    await expectNeutralAndPlayable(page, 'denied');
  } finally {
    await browser.close();
  }
});
