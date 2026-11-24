import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { THEMES, boot, click, frames, openSettings, plush, start, state, switchTheme, winARound, type Display } from './helpers';

/**
 * Screenshot set for docs/screenshots: 5 layouts (desktop, portrait 32", portrait 86", a phone
 * sideways and the 86" preset simulated in a 16:9 window) × 5 themes in attract mode with the
 * default "medium" graphics preset, plus one win card and the settings dialog per layout.
 * Rendered by headless Chromium with software WebGL (SwiftShader) — real GPUs differ in
 * anti-aliasing and timing, not in layout.
 *
 * Run only this file with PLUSH_SHOTS=1 (it is skipped otherwise: it takes about an hour on software GL).
 * PLUSH_SHOTS=settings / PLUSH_SHOTS=win regenerate only the settings-dialog / win-card pictures.
 */
const MODE = process.env.PLUSH_SHOTS;
const OUT = path.resolve(process.cwd(), 'docs/screenshots');
const LAYOUTS: { display: Display; width: number; height: number; name?: string }[] = [
  { display: 'desktop', width: 1280, height: 720 },
  { display: 'portrait32', width: 1080, height: 1920 },
  { display: 'portrait86', width: 1080, height: 1920 },
  // A phone held sideways (CSS px of a 6.1" phone).
  { display: 'mobile', width: 844, height: 390 },
  // The 86" preset on an ordinary 16:9 monitor: the simulated 9:16 screen (Settings → Layout → frame).
  { display: 'portrait86', width: 1280, height: 720, name: 'portrait86-simulated' },
];

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.jpg`);
  let size = 0;
  for (const quality of [80, 70, 60, 50, 40, 30]) {
    const buffer = await page.screenshot({ type: 'jpeg', quality, animations: 'disabled', caret: 'hide' });
    size = buffer.length;
    if (size <= 250 * 1024 || quality === 30) {
      fs.writeFileSync(file, buffer);
      console.log(`${name}.jpg ${(size / 1024).toFixed(0)} KB (JPEG quality ${quality})`);
      break;
    }
  }
  expect(size).toBeLessThanOrEqual(260 * 1024);
}

for (const layout of LAYOUTS) {
  const prefix = layout.name ?? layout.display;
  test(`20. screenshots ${prefix} ${layout.width}×${layout.height}`, async ({ page }) => {
    test.skip(!MODE, 'set PLUSH_SHOTS=1 to regenerate docs/screenshots');
    test.setTimeout(2_400_000);
    await page.setViewportSize({ width: layout.width, height: layout.height });
    // The automatic optimiser would strip effects on software GL; the pictures show the preset as designed.
    // No demo rounds: on software GL a theme switch outlasts the 1.6 s before a demo starts, and the
    // attract pictures are meant to show the machine waiting for a player (call to action).
    await boot(page, { display: layout.display, quality: 'medium', theme: MODE === 'settings' || MODE === 'win' ? 'cosmic' : 'sakura', settings: { graphics: { autoOptimize: false }, system: { attractDemo: false } } });
    expect(await plush(page, (p) => p.settings().graphics.autoOptimize)).toBe(false);
    await frames(page, 2);
    const preset = await plush(page, (p) => `${p.settings().graphics.preset} → 3D buffer ${p.state().effective.width}×${p.state().effective.height}, automatic reductions: ${p.ui().autoReductions.join(', ') || 'none'}`);
    console.log(`${layout.display}: graphics ${preset}`);
    expect(await plush(page, (p) => p.settings().graphics.preset)).toBe('medium');
    if (MODE === 'settings') {
      // Same state as at the end of the full run: Cosmic theme, a round ready to play, Graphics tab.
      await start(page);
      await openSettings(page, 'menu-settings', 'graphics');
      await frames(page, 3);
      expect(await plush(page, (p) => p.ui().autoReductions)).toEqual([]);
      await shot(page, `${prefix}-settings`);
      return;
    }
    if (MODE === 'win') {
      await start(page);
      await winARound(page, 10);
      await expect(page.getByTestId('result-win')).toBeVisible();
      await frames(page, 4);
      await shot(page, `${prefix}-win`);
      return;
    }
    for (const theme of THEMES) {
      if ((await state(page)).theme !== theme) await switchTheme(page, theme);
      // Stay in attract mode (demo rounds are off): keep the idle clock at zero while frames render.
      await plush(page, (p) => {
        p.game.attractTime = 0;
      });
      await frames(page, 4);
      expect((await state(page)).phase).toBe('ATTRACT');
      await shot(page, `${prefix}-${theme}-attract`);
    }
    // Win card (GPU Party is the last theme of the loop).
    await start(page);
    const { result } = await winARound(page, 10);
    await expect(page.getByTestId('result-win')).toBeVisible();
    await frames(page, 4);
    console.log(`${prefix}: win card for ${result.targetTypeId}`);
    await shot(page, `${prefix}-win`);
    await click(page, 'result-again');
    // Settings dialog.
    await openSettings(page, 'menu-settings', 'graphics');
    await frames(page, 3);
    expect(await plush(page, (p) => p.ui().autoReductions)).toEqual([]);
    await shot(page, `${prefix}-settings`);
  });
}
