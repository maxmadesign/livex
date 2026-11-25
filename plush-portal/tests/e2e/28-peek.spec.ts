import { expect, test, type Page } from '@playwright/test';
import { boot, closeSettings, frames, openSettings, plush, setField, start } from './helpers';

/**
 * Drag-to-peek (src/app/PeekDrag.ts): without a tracked face, dragging on the 3D view moves the
 * virtual eye and it springs back on release. Read from the running renderer like 17-viewpoint:
 * P[8] = −2·ex/W and P[9] = −2·ey/H follow the eye relative to the window centre.
 */
const view = (page: Page) =>
  plush(page, (p) => {
    const P = Array.from(p.game.stage.camera.projectionMatrix.elements) as number[];
    const s = p.state();
    return {
      p8: P[8]!,
      p9: P[9]!,
      source: p.tracker().status.viewSource as string,
      claw: [s.claw.x, s.claw.z] as number[],
      input: [p.core().controller.inputX, p.core().controller.inputZ] as number[],
      phase: s.phase as string,
    };
  });

/** A point on the 3D view that no HUD element covers, with room to drag 240 px to the right. */
const openSpot = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="game-canvas"]')!;
    const r = canvas.getBoundingClientRect();
    for (const fy of [0.42, 0.36, 0.5, 0.3, 0.56])
      for (const fx of [0.36, 0.3, 0.42, 0.25, 0.48]) {
        const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy);
        if (document.elementFromPoint(x, y) === canvas && x + 240 < r.right) return { x, y };
      }
    return null;
  });

/** Opacity of the one-time hint, or −1 when it was never created. */
const hintOpacity = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="peek-hint"]');
    return el ? Number(getComputedStyle(el).opacity) : -1;
  });

async function dragRight(page: Page, from: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y - 10, { steps: 4 });
  await page.mouse.move(from.x + 240, from.y - 40, { steps: 6 });
}

test.describe('28. drag to peek', () => {
  test('a drag on the 3D view moves the eye (view source "drag"), never the claw, and springs back on release', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    await start(page);
    // The one-time hint appears for a player round without a tracked face, in the user's language.
    await expect.poll(() => hintOpacity(page), { timeout: 120_000 }).toBeGreaterThan(0.5);
    await expect(page.getByTestId('peek-hint')).toHaveText('Drag to peek inside');
    const hint = (await page.getByTestId('peek-hint').boundingBox())!;
    for (const id of ['panel', 'dpad', 'grab', 'panel-menu', 'status']) {
      const other = await page.getByTestId(id).first().boundingBox();
      if (!other) continue;
      const overlap = hint.x < other.x + other.width && other.x < hint.x + hint.width && hint.y < other.y + other.height && other.y < hint.y + hint.height;
      expect(overlap, `peek hint overlaps ${id}`).toBe(false);
    }

    // The attract sway has ended: the view rests at the reference eye.
    await expect.poll(async () => Math.abs((await view(page)).p8), { timeout: 120_000 }).toBeLessThan(1e-4);
    const neutral = await view(page);
    expect(neutral.source).toBe('neutral');

    const spot = await openSpot(page);
    expect(spot, 'an uncovered point on the 3D view').not.toBeNull();
    await dragRight(page, spot!);
    // Content follows the finger: dragging right and up moves the eye right (P[8] < 0) and up (P[9] falls).
    await expect.poll(async () => (await view(page)).p8, { timeout: 120_000 }).toBeLessThan(-0.02);
    const peeking = await view(page);
    console.log(`drag: P[8] ${neutral.p8.toFixed(4)} → ${peeking.p8.toFixed(4)}, P[9] ${neutral.p9.toFixed(4)} → ${peeking.p9.toFixed(4)}, source ${peeking.source}`);
    expect(peeking.source).toBe('drag');
    expect(peeking.p9).toBeLessThan(neutral.p9 - 0.002);
    expect(peeking.claw, 'the claw did not move').toEqual(neutral.claw);
    expect(peeking.input, 'no claw input from a drag').toEqual([0, 0]);
    // Peeking hides the hint.
    await expect.poll(() => hintOpacity(page), { timeout: 60_000 }).toBeLessThan(0.05);

    await page.mouse.up();
    await expect.poll(async () => (await view(page)).source, { timeout: 120_000 }).toBe('neutral');
    const back = await view(page);
    console.log(`released: P[8] ${back.p8.toFixed(5)}, P[9] ${back.p9.toFixed(5)}`);
    expect(Math.abs(back.p8 - neutral.p8)).toBeLessThan(1e-3);
    expect(Math.abs(back.p9 - neutral.p9)).toBeLessThan(1e-3);
    expect(back.claw).toEqual(neutral.claw);
    expect(back.phase).toMatch(/READY|AIMING/);
  });

  test('a drag that starts on a HUD control does not peek', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    await start(page);
    await expect.poll(async () => Math.abs((await view(page)).p8), { timeout: 120_000 }).toBeLessThan(1e-4);
    const neutral = await view(page);
    // Whatever the direction control is (pad or stick), press it and drag across the 3D view.
    const control = page.locator('[data-testid="joystick"], [data-testid="dpad"]').first();
    const b = (await control.boundingBox())!;
    const from = { x: Math.round(b.x + b.width * 0.5), y: Math.round(b.y + b.height * 0.3) };
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-testid') ?? document.elementFromPoint(x, y)?.tagName, from);
    expect(hit, 'the press lands on a HUD control, not on the 3D view').not.toBe('game-canvas');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 200, from.y - 120, { steps: 8 });
    const sources = new Set<string>();
    for (let i = 0; i < 4; i++) {
      await frames(page, 2);
      const v = await view(page);
      sources.add(v.source);
      expect(Math.abs(v.p8 - neutral.p8), 'the eye did not move').toBeLessThan(1e-4);
    }
    await page.mouse.up();
    expect([...sources]).toEqual(['neutral']);
  });

  test('camera.dragPeek off disables it', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    await start(page);
    await openSettings(page, 'menu-settings', 'camera');
    await expect(page.getByTestId('field-camera.dragPeek')).toBeVisible();
    await setField(page, 'camera.dragPeek', false);
    await closeSettings(page, 'apply');
    expect(await plush(page, (p) => p.settings().camera.dragPeek)).toBe(false);
    await expect.poll(async () => Math.abs((await view(page)).p8), { timeout: 120_000 }).toBeLessThan(1e-4);
    const neutral = await view(page);
    const spot = await openSpot(page);
    expect(spot).not.toBeNull();
    await dragRight(page, spot!);
    for (let i = 0; i < 4; i++) {
      await frames(page, 2);
      const v = await view(page);
      expect(v.source).toBe('neutral');
      expect(Math.abs(v.p8 - neutral.p8)).toBeLessThan(1e-4);
    }
    await page.mouse.up();
    // No hint either when the feature is off.
    expect(await hintOpacity(page)).toBeLessThan(0.05);
  });
});
