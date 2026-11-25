import { expect, test, type Page } from '@playwright/test';
import { appliedValue, boot, box, click, closeSettings, expectInZone, openSettings, outsideZone, plush, pushStick, settle, start, state, winARound } from './helpers';

// MACHINES (the lobby) leads the panel menu now that more than one machine is offered.
const HUD = ['panel', 'dpad', 'stick', 'stick-knob', 'start', 'status', 'panel-menu', 'menu-machines', 'menu-settings', 'menu-collection', 'menu-themes', 'menu-help'];
const TABS = ['gameplay', 'themes', 'layout', 'graphics', 'audio', 'ai', 'camera', 'system'];
/** The top-right "i" is the one deliberate exception: a second way into Settings, outside the reach zone. */
const ALLOW = ['info-button'];

async function zoneOf(page: Page, ids: string[]): Promise<Record<string, string>> {
  await settle(page);
  const out: Record<string, string> = {};
  for (const id of ids) {
    const z = await expectInZone(page, id);
    out[id] = `${z.top.toFixed(3)}–${z.bottom.toFixed(3)}`;
  }
  return out;
}

test.describe('3. portrait86 interactive safe zone (normalised Y 0.25–0.75)', () => {
  test('1080×1920: HUD, tutorial, every settings tab, theme picker, collection and win card stay inside', async ({ page }) => {
    // Eight settings tabs, the theme picker, the collection and a win at 1080 × 1920 on software GL:
    // 4.3-5.4 min on this shared 4-CPU box at load 9-10; at load 17-20 two runs ran past 7 min.
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 1080, height: 1920 });
    await boot(page, { display: 'portrait86', tutorial: true });
    expect((await state(page)).profile).toBe('portrait86');

    // --- attract HUD
    const hud = await zoneOf(page, HUD);
    console.log('portrait86 1080×1920 HUD zones:', JSON.stringify(hud));
    expect(await outsideZone(page, ALLOW)).toEqual([]);
    // The theme name in the top bar is a label here, not a button (themes open from the panel).
    expect(await page.getByTestId('theme-chip').evaluate((el) => el.tagName)).toBe('SPAN');
    const panel = await box(page, 'panel');
    const anchor = await appliedValue<number>(page, 'profiles.portrait86.layout.anchorY');
    const centre = (panel.y + panel.height / 2) / 1920;
    console.log(`panel centre y=${centre.toFixed(3)} (anchorY setting ${anchor})`);
    expect(Math.abs(centre - anchor)).toBeLessThan(0.03);
    expect(anchor).toBeCloseTo(0.6, 2);

    // --- the "i" exists in the top-right corner
    const info = await box(page, 'info-button');
    expect((info.x + info.width / 2) / 1080).toBeGreaterThan(0.8);
    expect((info.y + info.height / 2) / 1920).toBeLessThan(0.12);

    // --- first START shows the how-to-play card inside the zone
    await click(page, 'start');
    await expect(page.getByTestId('tutorial')).toBeVisible();
    await zoneOf(page, ['tutorial', 'tutorial-ok']);
    expect(await outsideZone(page, ALLOW)).toEqual([]);
    await click(page, 'tutorial-ok');
    await expect(page.getByTestId('tutorial')).toHaveCount(0);
    await zoneOf(page, ['grab', 'dpad', 'stick', 'status']);
    // Pushed to its limits the joystick's ball stays inside the zone too.
    for (const gate of ['back', 'front'] as const) {
      await pushStick(page, gate);
      await expectInZone(page, 'stick-knob');
      await page.mouse.up();
    }

    // --- settings: frame, footer buttons, tab list and every tab's visible controls
    await openSettings(page, 'menu-settings');
    const dialog = await zoneOf(page, ['settings', 'settings-close', 'settings-cancel', 'settings-apply', 'settings-tabs']);
    console.log('settings dialog zones:', JSON.stringify(dialog));
    for (const tab of TABS) {
      await click(page, `tab-${tab}`);
      await expect(page.getByTestId(`panel-${tab}`)).toBeVisible();
      await expectInZone(page, `panel-${tab}`);
      expect(await outsideZone(page, ALLOW), `settings tab ${tab}`).toEqual([]);
      // Also after scrolling the tab to its end.
      await page.getByTestId(`panel-${tab}`).evaluate((el) => (el.scrollTop = el.scrollHeight));
      expect(await outsideZone(page, ALLOW), `settings tab ${tab} (scrolled)`).toEqual([]);
    }
    await closeSettings(page, 'cancel');

    // --- theme picker and collection
    await click(page, 'menu-themes');
    await expect(page.getByTestId('theme-picker')).toBeVisible();
    await zoneOf(page, ['theme-picker', 'theme-sakura', 'theme-storybook', 'theme-ocean', 'theme-cosmic', 'modal-close']);
    expect(await outsideZone(page, ALLOW)).toEqual([]);
    await click(page, 'modal-close');
    await expect(page.getByTestId('theme-picker')).toHaveCount(0);
    await click(page, 'menu-collection');
    await expect(page.getByTestId('collection')).toBeVisible();
    await zoneOf(page, ['collection', 'modal-close']);
    expect(await outsideZone(page, ALLOW)).toEqual([]);
    await click(page, 'modal-close');
    await expect(page.getByTestId('collection')).toHaveCount(0);

    // --- win card with its PLAY AGAIN button
    await winARound(page, 8);
    await expect(page.getByTestId('result-win')).toBeVisible();
    const win = await zoneOf(page, ['result-win', 'result-again']);
    console.log('win card zones:', JSON.stringify(win));
    expect(await outsideZone(page, ALLOW)).toEqual([]);
  });

  test('2160×3840 (4K portrait): HUD and settings dialog buttons stay inside', async ({ page }) => {
    await page.setViewportSize({ width: 2160, height: 3840 });
    await boot(page, { display: 'portrait86' });
    const hud = await zoneOf(page, HUD);
    console.log('portrait86 2160×3840 HUD zones:', JSON.stringify(hud));
    expect(await outsideZone(page, ALLOW)).toEqual([]);
    const info = await box(page, 'info-button');
    expect((info.x + info.width / 2) / 2160).toBeGreaterThan(0.8);
    expect((info.y + info.height / 2) / 3840).toBeLessThan(0.12);
    // Touch targets are physically large enough on the big panel: at least 3% of the screen width.
    const grab = await box(page, 'start');
    const stick = await box(page, 'stick');
    console.log(`4K sizes: START ${grab.width.toFixed(0)}×${grab.height.toFixed(0)} px, joystick ${stick.width.toFixed(0)} px`);
    // The joystick takes the old pad's slot: three of the old direction buttons (each over 3 % of the width).
    expect(stick.width).toBeGreaterThan(2160 * 0.09);

    await openSettings(page, 'info-button');
    const dialog = await zoneOf(page, ['settings', 'settings-close', 'settings-cancel', 'settings-apply', 'settings-tabs']);
    console.log('4K settings dialog zones:', JSON.stringify(dialog));
    expect(await outsideZone(page, ALLOW)).toEqual([]);
    await click(page, 'tab-system');
    expect(await outsideZone(page, ALLOW)).toEqual([]);
    await closeSettings(page, 'cancel');
    await start(page);
    await expectInZone(page, 'grab');
    void plush;
  });
});
