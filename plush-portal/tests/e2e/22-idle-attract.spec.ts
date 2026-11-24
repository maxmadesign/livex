import { expect, test, type Page } from '@playwright/test';
import { boot, box, expectInZone, plush, settle, watch } from './helpers';

/**
 * Idle reset (system.idleSeconds) on the 86" portrait kiosk: a player walks away in the middle of a
 * session with the settings dialog open. After the idle time the dialog closes, the session ends and
 * the machine plays by itself with the call to action inside the reachable band (0.25–0.75).
 *
 * Every `window.__plush` call except `attract()` counts as player input, so nothing here touches the
 * debug API while waiting for the reset: the wait watches the DOM only. Input is by touch (as on the
 * kiosk), which also keeps a hovering mouse cursor out of the picture.
 */

test.use({ viewport: { width: 1080, height: 1920 }, hasTouch: true });

async function tap(page: Page, testId: string): Promise<void> {
  const b = await box(page, testId);
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

test('22. idle reset on 86": dialog closed, session over, attract mode with the call to action inside the safe band', async ({ page }) => {
  test.setTimeout(900_000);
  const w = watch(page);
  await boot(page, { display: 'portrait86', settings: { system: { idleSeconds: 10 } } });
  expect(await plush(page, (p) => p.settings().system.idleSeconds)).toBe(10);
  await expect(page.getByTestId('attract-cta')).toBeVisible();

  // A player takes over (touch on START) and opens the settings dialog.
  await tap(page, 'start');
  await expect(page.getByTestId('status')).toHaveAttribute('data-phase', /READY|AIMING/, { timeout: 120_000 });
  await expect(page.getByTestId('attract-cta')).toHaveCount(0);
  await settle(page);
  // The tap is the last input: the idle clock starts here.
  const t0 = Date.now();
  await tap(page, 'menu-settings');
  await expect(page.getByTestId('settings')).toBeVisible();

  // Nobody touches anything: after 10 s (wall clock, also while the dialog pauses the game) the reset runs.
  await expect(page.getByTestId('settings')).toHaveCount(0, { timeout: 240_000 });
  await expect(page.getByTestId('attract-cta')).toBeVisible({ timeout: 240_000 });
  const waited = (Date.now() - t0) / 1000;

  // attract() observes the idle clock without counting as input.
  const a = await plush(page, (p) => p.attract());
  console.log(`idle reset after ${waited.toFixed(1)} s wall time: ${JSON.stringify(a)}`);
  expect(a.active).toBe(true);
  expect(a.limit).toBe(10);
  expect(waited).toBeGreaterThanOrEqual(10);

  // The call to action and the START button sit inside the 86" reachable band.
  await settle(page);
  const cta = await expectInZone(page, 'attract-cta');
  const startZone = await expectInZone(page, 'start');
  const ctaBox = await box(page, 'attract-cta');
  const startBox = await box(page, 'start');
  console.log(`call to action y ${cta.top.toFixed(3)}–${cta.bottom.toFixed(3)} (${ctaBox.width.toFixed(0)}×${ctaBox.height.toFixed(0)} px), START y ${startZone.top.toFixed(3)}–${startZone.bottom.toFixed(3)}`);
  expect(ctaBox.width * ctaBox.height, 'the call to action is bigger than START').toBeGreaterThan(startBox.width * startBox.height);

  // The session is over and the dialog's draft is gone; the log says why.
  const after = await plush(page, (p) => ({ score: p.score().ui, draft: p.game.deps.settings.getState().draft, modal: p.ui().modal, log: p.log() }));
  expect(after.modal).toBeNull();
  expect(after.draft).toBeNull();
  expect(after.score.session).toBe(0);
  expect(after.score.demo).toBe(true);
  expect(after.log.some((l: string) => l.includes('idle reset (10 s without input)'))).toBe(true);

  // Tapping the call to action starts a player round again.
  await tap(page, 'attract-cta');
  await expect(page.getByTestId('status')).toHaveAttribute('data-phase', /READY|AIMING/, { timeout: 120_000 });
  expect(w.pageErrors).toEqual([]);
});
