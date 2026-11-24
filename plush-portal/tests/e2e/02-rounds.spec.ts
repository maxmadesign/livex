import { expect, test } from '@playwright/test';
import { aim, appliedValue, boot, click, closeSettings, collection, ff, fieldToys, grabAndWait, hold, openSettings, plush, readyForNext, setField, start, state, steerTo, watch, winARound } from './helpers';

test.describe('2. full rounds through the HUD on all three display presets', () => {
  test('desktop 1280×720: START, hold-to-aim with the direction buttons only, GRAB, win card, PLAY AGAIN', async ({ page }) => {
    const w = watch(page);
    await boot(page, { display: 'desktop' });
    await start(page);
    expect((await state(page)).roundId).toBe(1);

    let won: Record<string, unknown> | null = null;
    const tried: string[] = [];
    for (let attempt = 0; attempt < 6 && !won; attempt++) {
      await readyForNext(page);
      const toys = await fieldToys(page);
      const toy = toys[attempt % toys.length]!;
      const reached = await steerTo(page, toy.x, toy.z);
      const miss = Math.hypot(reached.x - toy.x, reached.z - toy.z);
      const result = await grabAndWait(page);
      tried.push(`${toy.type} aimErr=${(miss * 100).toFixed(1)}cm presses=${reached.presses} -> ${result.outcome}`);
      if (result.outcome === 'won') won = result;
    }
    console.log('desktop HUD-only rounds:', tried.join(' | '));
    expect(won, `no win with button-only aiming: ${tried.join(' | ')}`).not.toBeNull();

    // The win card shows the prize and offers PLAY AGAIN; the collection has it.
    await expect(page.getByTestId('result-win')).toBeVisible();
    const c = await collection(page);
    expect(c.wins).toBe(1);
    expect(c.counts[won!.targetTypeId as string]).toBe(1);
    const round = (await state(page)).roundId;
    await click(page, 'result-again');
    await expect.poll(async () => (await state(page)).phase).toMatch(/READY|AIMING/);
    expect((await state(page)).roundId).toBe(round + 1);
    await expect(page.getByTestId('result-win')).toHaveCount(0);
    expect(w.pageErrors).toEqual([]);
    expect(w.consoleErrors).toEqual([]);
  });

  for (const [name, display, width, height] of [
    ['portrait32 1080×1920', 'portrait32', 1080, 1920],
    ['portrait86 2160×3840', 'portrait86', 2160, 3840],
  ] as const) {
    test(`${name}: START, hold a direction, GRAB, result, PLAY AGAIN`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const w = watch(page);
      await boot(page, { display });
      const s0 = await state(page);
      expect(s0.profile).toBe(display);
      expect(s0.hud.vw).toBe(width);
      // The 3D view is rendered at its own (here deliberately tiny) resolution; the HUD stays in CSS pixels.
      await expect.poll(async () => (await state(page)).effective.megapixels, { timeout: 120_000 }).toBeLessThanOrEqual(0.41);
      await start(page);
      const before = (await state(page)).claw.x;
      await hold(page, 'right', 0.5);
      await ff(page, 0.4);
      expect((await state(page)).claw.x).toBeGreaterThan(before + 0.05);

      const { result, tries } = await winARound(page, 8);
      console.log(`${name}: won ${result.targetTypeId} after ${tries} centred grab(s)`);
      await expect(page.getByTestId('result-win')).toBeVisible();
      await click(page, 'result-again');
      await expect.poll(async () => (await state(page)).phase).toMatch(/READY|AIMING/);
      expect((await collection(page)).wins).toBe(1);
      expect(w.pageErrors).toEqual([]);
    });
  }

  test('the three presets keep independent layout settings across reloads', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 1280 });
    await boot(page, { display: 'portrait86' });
    const defaults = {
      desktop: await appliedValue<number>(page, 'profiles.desktop.layout.uiScale'),
      portrait32: await appliedValue<number>(page, 'profiles.portrait32.layout.uiScale'),
      portrait86: await appliedValue<number>(page, 'profiles.portrait86.layout.uiScale'),
    };
    await openSettings(page, 'menu-settings', 'layout');
    await setField(page, 'profiles.portrait86.layout.uiScale', 0.8);
    await setField(page, 'profiles.portrait86.layout.anchorY', 0.56);
    await closeSettings(page, 'apply');
    expect(await appliedValue(page, 'profiles.portrait86.layout.uiScale')).toBeCloseTo(0.8, 5);

    // Reload as another preset: its own values are untouched, portrait86 keeps the change.
    await page.goto('/?debug=1&seed=7&camera=off&display=portrait32');
    await page.waitForFunction(() => (window as unknown as { __bootDone?: boolean }).__bootDone === true, null, { timeout: 240_000 });
    expect(await plush(page, (p) => p.state().profile)).toBe('portrait32');
    expect(await appliedValue(page, 'profiles.portrait32.layout.uiScale')).toBe(defaults.portrait32);
    expect(await appliedValue(page, 'profiles.desktop.layout.uiScale')).toBe(defaults.desktop);
    expect(await appliedValue(page, 'profiles.portrait86.layout.uiScale')).toBeCloseTo(0.8, 5);
    expect(await appliedValue(page, 'profiles.portrait86.layout.anchorY')).toBeCloseTo(0.56, 5);

    // Change portrait32, go back to portrait86: both keep their own values.
    await openSettings(page, 'menu-settings', 'layout');
    await setField(page, 'profiles.portrait32.layout.uiScale', 1.1);
    await closeSettings(page, 'apply');
    await page.goto('/?debug=1&seed=7&camera=off&display=portrait86');
    await page.waitForFunction(() => (window as unknown as { __bootDone?: boolean }).__bootDone === true, null, { timeout: 240_000 });
    expect(await appliedValue(page, 'profiles.portrait32.layout.uiScale')).toBeCloseTo(1.1, 5);
    expect(await appliedValue(page, 'profiles.portrait86.layout.uiScale')).toBeCloseTo(0.8, 5);
    expect(await appliedValue(page, 'profiles.desktop.layout.uiScale')).toBe(defaults.desktop);
    void aim;
  });
});
