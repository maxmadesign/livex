import { expect, test, type Page } from '@playwright/test';
import { box, boot, click, expectInZone, plush, settle, state, watch, type Box } from './helpers';

/**
 * Simulated 9:16 screen (src/layout/frame.ts): the 32" and 86" portrait presets shown in a 16:9
 * desktop window render inside a centred 9:16 box; the layout, the 3D view, the safe band and the
 * score popups are all computed against that box.
 */

const inside = (inner: Box, outer: Box, tol = 1.5) =>
  inner.x >= outer.x - tol && inner.y >= outer.y - tol && inner.x + inner.width <= outer.x + outer.width + tol && inner.y + inner.height <= outer.y + outer.height + tol;

/** A score popup at a point on the play field: placed by Game.toScreen, drawn by the HUD (src/ui/ScoreHud.tsx). */
const popupAtField = (page: Page) =>
  plush(page, (p) => {
    const g = p.game;
    const toy = p.state().toys.find((t: any) => !t.inBin);
    const at = g.toScreen({ x: toy.pos[0], y: toy.pos[1], z: toy.pos[2] });
    g.addPopup(at, { roundId: -1, outcome: 'won', demo: false, typeId: toy.type, tier: 'rare', total: 250, comboMultiplier: 1 });
    return at as { x: number; y: number };
  });

for (const display of ['portrait32', 'portrait86'] as const) {
  test(`23. ${display} in a 1280×720 window renders inside a centred 9:16 box`, async ({ page }) => {
    test.setTimeout(600_000);
    const w = watch(page);
    await boot(page, { display });
    const root = await box(page, 'root');
    const canvas = await box(page, 'game-canvas');
    const s = await state(page);
    console.log(`${display}: root ${root.width}×${root.height} at x ${root.x}, canvas ${canvas.width}×${canvas.height} at x ${canvas.x}, hud ${s.hud.vw}×${s.hud.vh}, 3D buffer ${s.effective.width}×${s.effective.height}`);
    // 720 × 9 / 16 = 405 px wide, centred: x = (1280 − 405) / 2 = 437.5 → whole pixels.
    expect(root.height).toBeCloseTo(720, 0);
    expect(Math.abs(root.width - 405)).toBeLessThanOrEqual(1);
    expect(Math.abs(root.x + root.width / 2 - 640)).toBeLessThanOrEqual(1);
    expect(root.y).toBeCloseTo(0, 0);
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(canvas[k] - root[k]), `canvas ${k}`).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('root')).toHaveAttribute('data-frame', 'simulate916');
    await expect(page.getByTestId('root')).toHaveAttribute('data-letterbox', 'true');
    await expect(page.getByTestId('frame-surround')).toBeVisible();
    // The game lays out against the box, not the window.
    expect(s.hud.vw).toBeCloseTo(root.width, 0);
    expect(s.hud.vh).toBeCloseTo(720, 0);
    expect(s.effective.width / s.effective.height).toBeCloseTo(9 / 16, 1);

    // Every HUD control sits inside the box.
    await settle(page);
    for (const id of ['panel', 'start', 'dpad', 'panel-menu', 'info-button', 'attract-cta']) expect(inside(await box(page, id), root), `${id} inside the box`).toBe(true);
    if (display === 'portrait86') {
      // The 86" safe band is measured on the box: 0.25–0.75 of 720 px.
      for (const id of ['panel', 'start', 'attract-cta']) await expectInZone(page, id);
    }

    // Score popups are positioned inside the box (Game.toScreen returns box coordinates).
    const at = await popupAtField(page);
    expect(at.x).toBeGreaterThanOrEqual(0);
    expect(at.x).toBeLessThanOrEqual(root.width);
    const popup = await box(page, 'score-popup');
    console.log(`${display}: popup anchor ${at.x.toFixed(1)},${at.y.toFixed(1)} in the box → on screen ${popup.x.toFixed(1)},${popup.y.toFixed(1)} ${popup.width.toFixed(0)}×${popup.height.toFixed(0)}`);
    expect(inside(popup, root, 40), 'the popup is drawn inside the box').toBe(true);

    // A click on START inside the box starts a round.
    await click(page, 'start');
    await expect.poll(async () => (await state(page)).phase, { timeout: 120_000 }).toMatch(/READY|AIMING/);
    // A click in the surround does nothing.
    await page.mouse.click(40, 360);
    expect(await plush(page, (p) => p.ui().modal)).toBeNull();
    expect(w.pageErrors).toEqual([]);
  });
}

test('23. a 9:16 window is used whole (no box, no surround)', async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 720, height: 1280 });
  await boot(page, { display: 'portrait86' });
  const root = await box(page, 'root');
  expect(root).toEqual({ x: 0, y: 0, width: 720, height: 1280 });
  await expect(page.getByTestId('root')).toHaveAttribute('data-letterbox', 'false');
  await expect(page.getByTestId('frame-surround')).toBeHidden();
});
