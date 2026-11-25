import { expect, test, type Page } from '@playwright/test';
import { aim, box, boot, ff, fieldToys, finishRound, frames, plush, results, state, stickPoint, watch, type Box } from './helpers';


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

  // Joystick bottom-left, big button bottom-right; every control on screen, at least 44 px, no overlaps.
  // MACHINES (the lobby: more than one machine is offered) leads the menu row.
  const ids = ['stick', 'start', 'menu-machines', 'menu-settings', 'menu-collection', 'menu-themes', 'menu-help'];
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
  const centreY = (b: Box) => b.y + b.height / 2;
  expect(Math.abs(centreY(boxes['menu-machines']!) - centreY(boxes['menu-settings']!)), 'MACHINES in the menu row').toBeLessThan(2);
  expect(boxes['menu-machines']!.x, 'MACHINES leads the menu row').toBeLessThan(boxes['menu-settings']!.x);
  const pad = await box(page, 'dpad');
  expect(pad.x + pad.width / 2).toBeLessThan(844 / 2);
  expect(boxes.start!.x + boxes.start!.width / 2).toBeGreaterThan(844 / 2);
  // The call to action fits between the pad and the big button.
  const cta = await box(page, 'attract-cta');
  expect(overlaps(cta, pad)).toBe(false);
  expect(overlaps(cta, boxes.start!)).toBe(false);

  // Held upright the menu row is solved for four buttons: MACHINES moves to the top bar, level with
  // the corner "i", still thumb-sized, on screen and clear of every other control. (Checked before
  // START: the first START tap asks for full screen, and a full-screen window cannot be resized.)
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => plush(page, (p) => p.game.hud.orientation), { timeout: 60_000 }).toBe('portrait');
  await frames(page, 2);
  const upright = ['menu-machines', 'info-button', 'menu-settings', 'menu-collection', 'menu-themes', 'menu-help', 'stick', 'start'];
  const ub: Record<string, Box> = {};
  for (const id of upright) {
    const b = await box(page, id);
    ub[id] = b;
    expect(b.x, `upright ${id} left`).toBeGreaterThanOrEqual(0);
    expect(b.y, `upright ${id} top`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `upright ${id} right`).toBeLessThanOrEqual(390.5);
    expect(b.y + b.height, `upright ${id} bottom`).toBeLessThanOrEqual(844.5);
    expect(Math.min(b.width, b.height), `upright ${id} touch size`).toBeGreaterThanOrEqual(43.5);
  }
  for (let i = 0; i < upright.length; i++) for (let j = i + 1; j < upright.length; j++) expect(overlaps(ub[upright[i]!]!, ub[upright[j]!]!), `upright ${upright[i]} / ${upright[j]}`).toBe(false);
  expect(Math.abs(centreY(ub['menu-machines']!) - centreY(ub['info-button']!)), 'MACHINES in the top bar').toBeLessThan(ub['info-button']!.height / 2);
  expect(ub['menu-machines']!.y + ub['menu-machines']!.height, 'the top bar is above the menu row').toBeLessThan(ub['menu-settings']!.y);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => plush(page, (p) => p.game.hud.orientation), { timeout: 60_000 }).toBe('landscape');
  await frames(page, 2);

  // Tap START: a player round, ready to aim.
  await tap(page, 'start');
  await expect.poll(async () => (await state(page)).phase, { timeout: 120_000 }).toMatch(/READY|AIMING/);
  await expect(page.getByTestId('stick')).toHaveAttribute('aria-disabled', 'false');
  await ff(page, 1.2);

  // Push the joystick right with a thumb: the claw moves while the thumb holds it and stops when it
  // lifts (a short push, so the claw is still away from the side wall when the thumb lifts).
  const push = await stickPoint(page, 'right');
  const x0 = (await state(page)).claw.x;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: Math.round(push.cx), y: Math.round(push.cy) }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(push.x), y: Math.round(push.y) }] });
  await expect(page.getByTestId('stick')).toHaveAttribute('data-gate', 'right');
  await ff(page, 0.3);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByTestId('stick')).toHaveAttribute('data-held', 'false');
  const x1 = (await state(page)).claw.x;
  await ff(page, 1);
  const x2 = (await state(page)).claw.x;
  const maxX = await plush<number>(page, (p) => p.claw.maxX);
  console.log(`push ▶ 0.3 s: claw x ${x0.toFixed(3)} → ${x1.toFixed(3)}, 1 s after lifting the finger ${x2.toFixed(3)} (wall at ${maxX.toFixed(3)})`);
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
