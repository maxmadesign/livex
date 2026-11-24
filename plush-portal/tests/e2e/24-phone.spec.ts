import { expect, test, type Page } from '@playwright/test';
import { aim, box, boot, ff, fieldToys, finishRound, plush, results, state, watch, type Box } from './helpers';


/**
 * A round on a phone held sideways (the `mobile` preset), played with taps: Chromium's phone
 * emulation (touch screen, coarse pointer, mobile viewport), not a real phone. `?quality=safe`
 * keeps the first-run phone setup from changing the graphics (an explicit preset wins).
 */

test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

async function tap(page: Page, testId: string): Promise<void> {
  const b = await box(page, testId);
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

test('24. phone held sideways: thumb-sized controls, a full round played with taps', async ({ page }) => {
  test.setTimeout(900_000);
  const w = watch(page);
  await boot(page, { display: 'mobile', quality: 'safe' });
  const s = await state(page);
  const layout = await plush(page, (p) => ({ orientation: p.game.hud.orientation, controls: p.game.hud.controls, touchMin: p.game.hud.touchMin }));
  console.log(`phone 844×390: profile ${s.profile}, ${layout.orientation}, 3D buffer ${s.effective.width}×${s.effective.height}, controls ${JSON.stringify(layout.controls)}`);
  expect(s.profile).toBe('mobile');
  expect(layout.orientation).toBe('landscape');
  expect(layout.controls).toBeTruthy();

  // Pad bottom-left, big button bottom-right; every control on screen, at least 44 px, no overlaps.
  const ids = ['dir-left', 'dir-right', 'dir-back', 'dir-front', 'start', 'menu-settings', 'menu-collection', 'menu-themes', 'menu-help'];
  const boxes: Record<string, Box> = {};
  for (const id of ids) {
    const b = await box(page, id);
    boxes[id] = b;
    expect(b.x, `${id} left`).toBeGreaterThanOrEqual(0);
    expect(b.y, `${id} top`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${id} right`).toBeLessThanOrEqual(844.5);
    expect(b.y + b.height, `${id} bottom`).toBeLessThanOrEqual(390.5);
    expect(Math.min(b.width, b.height), `${id} touch size`).toBeGreaterThanOrEqual(43.5);
  }
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) expect(overlaps(boxes[ids[i]!]!, boxes[ids[j]!]!), `${ids[i]} / ${ids[j]}`).toBe(false);
  const pad = await box(page, 'dpad');
  expect(pad.x + pad.width / 2).toBeLessThan(844 / 2);
  expect(boxes.start!.x + boxes.start!.width / 2).toBeGreaterThan(844 / 2);
  // The call to action fits between the pad and the big button.
  const cta = await box(page, 'attract-cta');
  expect(overlaps(cta, pad)).toBe(false);
  expect(overlaps(cta, boxes.start!)).toBe(false);

  // Tap START: a player round, ready to aim.
  await tap(page, 'start');
  await expect.poll(async () => (await state(page)).phase, { timeout: 120_000 }).toMatch(/READY|AIMING/);
  await expect(page.getByTestId('dir-right')).toHaveAttribute('aria-disabled', 'false');
  await ff(page, 1.2);

  // Hold ▶ with a finger: the claw moves while the finger is down and stops when it lifts (a short hold,
  // so the claw is still away from the side wall when the finger lifts).
  const right = await box(page, 'dir-right');
  const x0 = (await state(page)).claw.x;
  const cdp = await page.context().newCDPSession(page);
  const point = { x: right.x + right.width / 2, y: right.y + right.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await ff(page, 0.3);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByTestId('dir-right')).toHaveAttribute('data-pressed', 'false');
  const x1 = (await state(page)).claw.x;
  await ff(page, 1);
  const x2 = (await state(page)).claw.x;
  const maxX = await plush<number>(page, (p) => p.claw.maxX);
  console.log(`hold ▶ 0.3 s: claw x ${x0.toFixed(3)} → ${x1.toFixed(3)}, 1 s after lifting the finger ${x2.toFixed(3)} (wall at ${maxX.toFixed(3)})`);
  expect(x1).toBeGreaterThan(x0 + 0.02);
  expect(x2, 'still short of the side wall').toBeLessThan(maxX - 0.02);
  // 0.42 m/s braked at 2.4 m/s² stops within about 4 cm.
  expect(Math.abs(x2 - x1), 'the claw stops when the finger lifts (only braking distance)').toBeLessThan(0.05);

  // Aim at a toy and tap GRAB: the round runs to a physical result.
  const toys = await fieldToys(page);
  await aim(page, toys[0]!.x, toys[0]!.z);
  const before = (await results(page)).length;
  await tap(page, 'grab');
  const result = await finishRound(page, before, 40);
  expect(result, 'the round finished').toBeTruthy();
  console.log(`phone round ${result.roundId}: ${result.outcome}${result.slipReason ? ` (${result.slipReason})` : ''}, target ${result.targetTypeId}`);
  expect(['won', 'slipped', 'empty']).toContain(result.outcome);
  if (result.outcome === 'won') {
    // The win card is on screen and clear of the pad and the big button's slot.
    await expect(page.getByTestId('result-win')).toBeVisible();
    const card = await box(page, 'result-win');
    expect(card.y).toBeGreaterThanOrEqual(0);
    expect(card.y + card.height).toBeLessThanOrEqual(390.5);
    await tap(page, 'again');
  } else await ff(page, 2);
  await expect.poll(async () => (await state(page)).phase, { timeout: 120_000 }).toMatch(/READY|AIMING/);
  expect(w.pageErrors).toEqual([]);
});
