import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { LOW_GRAPHICS, appliedValue, boot, box, click, closeSettings, openSettings, plush, setField, settingsValue, state, waitBoot } from './helpers';

const persisted = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('plush-portal/settings') ?? 'null'));
const toastText = async (page: Page) => (await page.getByTestId('toast').count()) ? page.getByTestId('toast').first().innerText() : '';

test.describe('11. settings', () => {
  test('live preview, cancel, apply, persistence, reset tab', async ({ page }) => {
    await boot(page, { display: 'desktop' });
    const panel0 = await box(page, 'panel');
    const scale0 = await appliedValue<number>(page, 'profiles.desktop.layout.uiScale');

    // Preview: the HUD behind the dialog follows the draft immediately.
    await openSettings(page, 'menu-settings', 'layout');
    await setField(page, 'profiles.desktop.layout.uiScale', 1.25);
    expect(await settingsValue(page, 'profiles.desktop.layout.uiScale')).toBeCloseTo(1.25, 5);
    expect(await appliedValue(page, 'profiles.desktop.layout.uiScale'), 'the stored value is untouched while previewing').toBe(scale0);
    await expect.poll(async () => (await box(page, 'panel')).height).toBeGreaterThan(panel0.height * 1.1);
    await expect(page.getByTestId('settings-note')).not.toBeEmpty();
    expect((await persisted(page)).settings.profiles?.desktop?.layout?.uiScale ?? scale0).toBe(scale0);

    // Cancel: everything is back.
    await closeSettings(page, 'cancel');
    await expect.poll(async () => (await box(page, 'panel')).height).toBeCloseTo(panel0.height, 0);
    expect(await appliedValue(page, 'profiles.desktop.layout.uiScale')).toBe(scale0);

    // Escape cancels too.
    await openSettings(page, 'menu-settings', 'layout');
    await setField(page, 'profiles.desktop.layout.uiScale', 0.85);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings')).toHaveCount(0);
    expect(await appliedValue(page, 'profiles.desktop.layout.uiScale')).toBe(scale0);

    // Apply: stored, used, and still there after a reload.
    await openSettings(page, 'menu-settings', 'layout');
    await setField(page, 'profiles.desktop.layout.uiScale', 1.2);
    await click(page, 'tab-gameplay');
    await setField(page, 'gameplay.moveSpeed', 0.6);
    await setField(page, 'gameplay.aimBeam', false);
    await click(page, 'tab-system');
    await setField(page, 'system.language', 'zh');
    await closeSettings(page, 'apply');
    expect(await appliedValue(page, 'profiles.desktop.layout.uiScale')).toBeCloseTo(1.2, 5);
    expect(await appliedValue(page, 'gameplay.moveSpeed')).toBeCloseTo(0.6, 5);
    expect((await persisted(page)).settings.gameplay.moveSpeed).toBeCloseTo(0.6, 5);
    await expect(page.getByTestId('start')).toContainText(/开始|START/);
    const startZh = await page.getByTestId('start').innerText();
    await page.reload();
    await waitBoot(page);
    expect(await appliedValue(page, 'profiles.desktop.layout.uiScale')).toBeCloseTo(1.2, 5);
    expect(await appliedValue(page, 'gameplay.moveSpeed')).toBeCloseTo(0.6, 5);
    expect(await appliedValue(page, 'gameplay.aimBeam')).toBe(false);
    expect(await appliedValue(page, 'system.language')).toBe('zh');
    expect(await page.getByTestId('start').innerText()).toBe(startZh);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh-Hans');
    await expect.poll(async () => (await box(page, 'panel')).height).toBeGreaterThan(panel0.height * 1.1);

    // Reset this tab: only that tab's values go back to their defaults (after Apply).
    await openSettings(page, 'menu-settings', 'gameplay');
    await click(page, 'settings-reset-tab');
    expect(await settingsValue(page, 'gameplay.moveSpeed')).toBeCloseTo(0.42, 5);
    expect(await settingsValue(page, 'gameplay.aimBeam')).toBe(true);
    expect(await settingsValue(page, 'profiles.desktop.layout.uiScale'), 'other tabs are untouched').toBeCloseTo(1.2, 5);
    expect(await appliedValue(page, 'gameplay.moveSpeed'), 'reset is a preview until Apply').toBeCloseTo(0.6, 5);
    await click(page, 'tab-layout');
    await click(page, 'settings-reset-tab');
    expect(await settingsValue(page, 'profiles.desktop.layout.uiScale')).toBe(scale0);
    await click(page, 'tab-system');
    await setField(page, 'system.language', 'en');
    await closeSettings(page, 'apply');
    expect(await appliedValue(page, 'gameplay.moveSpeed')).toBeCloseTo(0.42, 5);
    expect(await appliedValue(page, 'profiles.desktop.layout.uiScale')).toBe(scale0);
    await expect.poll(async () => (await box(page, 'panel')).height).toBeCloseTo(panel0.height, 0);
  });

  test('export → import round trip, garbage is rejected, out-of-range values are clamped, secrets stay out', async ({ page }, testInfo) => {
    await boot(page, { display: 'desktop' });
    await openSettings(page, 'menu-settings', 'gameplay');
    await setField(page, 'gameplay.moveSpeed', 0.55);
    await click(page, 'tab-themes');
    await setField(page, 'gameplay.toyCount', 12);
    await click(page, 'tab-system');
    await setField(page, 'system.lockPin', '4321');
    await click(page, 'tab-ai');
    await setField(page, 'ai.personality', 'cheerful test persona');
    await closeSettings(page, 'apply');

    // Export through the real button (a file download).
    await openSettings(page, 'menu-settings', 'system');
    const [download] = await Promise.all([page.waitForEvent('download'), click(page, 'btn-export')]);
    expect(download.suggestedFilename()).toBe('plush-portal-config.json');
    const file = testInfo.outputPath('exported.json');
    await download.saveAs(file);
    const text = fs.readFileSync(file, 'utf8');
    const exported = JSON.parse(text);
    expect(exported.app).toBe('plush-portal');
    expect(exported.version).toBe(1);
    expect(exported.settings.gameplay.moveSpeed).toBeCloseTo(0.55, 5);
    expect(exported.settings.gameplay.toyCount).toBe(12);
    expect(exported.settings.ai.personality).toBe('cheerful test persona');
    // No secrets, device ids, camera images or face data in the export.
    expect(text).not.toContain('4321');
    expect(text).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(text).not.toMatch(/api[_-]?key|authorization|bearer|landmark|data:image/i);
    expect(exported.settings.system.lockPin ?? '').toBe('');
    expect(exported.settings.camera.deviceId ?? '').toBe('');
    expect(exported.settings.audio.outputDevice ?? '').toBe('');
    console.log(`export: ${text.length} bytes, top-level sections ${Object.keys(exported.settings).join(', ')}`);

    // Change things, then import the file again: the exported values come back (as a preview until Apply).
    await click(page, 'tab-gameplay');
    await setField(page, 'gameplay.moveSpeed', 0.2);
    await click(page, 'tab-system');
    await page.getByTestId('import-file').setInputFiles(file);
    await expect.poll(() => settingsValue(page, 'gameplay.moveSpeed')).toBeCloseTo(0.55, 5);
    await expect(page.getByTestId('toast')).toContainText(/Configuration loaded/);
    expect(await settingsValue(page, 'system.lockPin'), 'the local PIN is kept, not imported').toBe('4321');

    // Garbage: not JSON, JSON that is not a config, a config from the future.
    const before = JSON.stringify(await plush(page, (p) => p.game.deps.settings.getState().view()));
    const same = async () => expect(JSON.stringify(await plush(page, (p) => p.game.deps.settings.getState().view()))).toBe(before);
    const importText = async (name: string, body: string) => {
      const f = testInfo.outputPath(name);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
      await page.getByTestId('import-file').setInputFiles(f);
    };
    await importText('garbage.json', '{{{ not json at all \u0000\u0001');
    await expect(page.getByTestId('toast')).toContainText(/not valid JSON/);
    await same();
    await importText('other.json', JSON.stringify({ hello: 'world', settings: { gameplay: { moveSpeed: 0.9 } } }));
    await expect(page.getByTestId('toast')).toContainText(/not a PLUSH PORTAL configuration/);
    await same();
    await importText('future.json', JSON.stringify({ app: 'plush-portal', version: 99, settings: { gameplay: { moveSpeed: 0.9 } } }));
    await expect(page.getByTestId('toast')).toContainText(/newer version/);
    await same();
    await importText('array.json', '[1,2,3]');
    await expect(page.getByTestId('toast')).toContainText(/not a PLUSH PORTAL configuration/);
    await same();

    // Out-of-range, wrong types, unknown keys and prototype tricks are clamped / dropped.
    await importText(
      'hostile.json',
      JSON.stringify({
        app: 'plush-portal',
        version: 1,
        settings: {
          gameplay: { moveSpeed: 99, toyCount: -5, clawForce: 'strong', aimTimeLimit: 1e9, difficulty: 'impossible', __proto__: { polluted: true } },
          // (Graphics stay cheap on purpose: this runs on software WebGL.)
          graphics: { ...LOW_GRAPHICS, renderScale: -50, maxPixels: -1000, preset: 'ludicrous', bloom: -3, particles: -5, targetFps: 999, shadows: ['off'] },
          audio: { master: 7, muted: 'yes' },
          profiles: { portrait86: { layout: { safeTop: -1, safeBottom: 9, anchorY: 4, uiScale: 100 } } },
          themes: { current: 'lava', toyScale: 12, disabledToys: 'all' },
          // attractIdleSec is the retired name of idleSeconds: an imported old file is migrated.
          system: { lockPin: '9999', lockSettings: true, attractIdleSec: 0 },
          unknownSection: { evil: '<script>alert(1)</script>' },
        },
      }),
    );
    await expect(page.getByTestId('toast')).toContainText(/Configuration loaded/);
    const v = await plush(page, (p) => p.game.deps.settings.getState().view());
    console.log(`after hostile import: moveSpeed ${v.gameplay.moveSpeed}, toyCount ${v.gameplay.toyCount}, clawForce ${v.gameplay.clawForce}, aimTimeLimit ${v.gameplay.aimTimeLimit}, difficulty ${v.gameplay.difficulty}, renderScale ${v.graphics.renderScale}, maxPixels ${v.graphics.maxPixels}, preset ${v.graphics.preset}, master ${v.audio.master}, muted ${v.audio.muted}, theme ${v.themes.current}, toyScale ${v.themes.toyScale}, p86 safe ${v.profiles.portrait86.layout.safeTop}–${v.profiles.portrait86.layout.safeBottom} anchor ${v.profiles.portrait86.layout.anchorY}`);
    expect(v.gameplay.moveSpeed).toBe(0.9);
    expect(v.gameplay.toyCount).toBe(6);
    expect(v.gameplay.clawForce).toBe(1);
    expect(v.gameplay.aimTimeLimit).toBe(60);
    expect(['easy', 'arcade', 'skill', 'custom']).toContain(v.gameplay.difficulty);
    expect(v.graphics.renderScale).toBe(0.35);
    expect(v.graphics.maxPixels).toBe(0.4);
    expect(['safe', 'medium', 'high', 'ultra', 'custom']).toContain(v.graphics.preset);
    expect(v.graphics.bloom).toBe(0);
    expect(v.graphics.particles).toBe(0);
    expect(['30', '60', '120']).toContain(v.graphics.targetFps);
    expect(['off', 'low', 'medium', 'high']).toContain(v.graphics.shadows);
    expect(v.audio.master).toBe(1);
    expect(typeof v.audio.muted).toBe('boolean');
    expect(['sakura', 'storybook', 'ocean', 'cosmic', 'gpu']).toContain(v.themes.current);
    expect(v.themes.toyScale).toBe(1.25);
    expect(Array.isArray(v.themes.disabledToys)).toBe(true);
    expect(v.profiles.portrait86.layout.safeTop).toBeGreaterThanOrEqual(0);
    expect(v.profiles.portrait86.layout.safeBottom).toBeLessThanOrEqual(1);
    expect(v.profiles.portrait86.layout.anchorY).toBeLessThanOrEqual(0.95);
    expect(v.system.lockPin, 'an imported file cannot set or change the PIN').toBe('4321');
    // attractIdleSec 0 is read like the old setting read it (10 … 600 s) and carried over.
    expect(v.system.idleSeconds).toBe(10);
    expect((v.system as Record<string, unknown>).attractIdleSec).toBeUndefined();
    expect((v as Record<string, unknown>).unknownSection).toBeUndefined();
    expect(await page.evaluate(() => ({} as Record<string, unknown>).polluted)).toBeUndefined();
    // Nothing of this is stored unless the player presses Apply.
    expect(await appliedValue(page, 'gameplay.moveSpeed')).toBeCloseTo(0.55, 5);
    await closeSettings(page, 'cancel');
    expect(await appliedValue(page, 'gameplay.moveSpeed')).toBeCloseTo(0.55, 5);
    // Still in attract mode: the ATTRACT phase or one of its self-playing demo rounds (they start
    // whenever the game runs a few seconds in attract mode between the dialogs).
    const end = await state(page);
    expect(end.phase === 'ATTRACT' || end.demo, `${end.phase}${end.demo ? ' (demo)' : ''}`).toBe(true);
  });

  test('corrupt or hostile stored settings are repaired on load; every tab renders real labels', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('__e2e_seeded')) return;
      sessionStorage.setItem('__e2e_seeded', '1');
      localStorage.setItem('plush-portal/tutorial-seen', '1');
      localStorage.setItem(
        'plush-portal/settings',
        JSON.stringify({
          version: 1,
          settings: {
            graphics: { preset: 'custom', autoOptimize: false, renderScale: -4, maxPixels: 0.4, targetFps: '30', lod: 'low', textures: '512', shadows: 'off', ao: 'off', glass: 'low', reflections: 'static', fur: 'flat', deform: 'basic', aa: 'off', bloom: 0, particles: 0 },
            gameplay: { moveSpeed: 'fast', toyCount: 9999 },
            audio: null,
            themes: { current: 42 },
          },
        }),
      );
    });
    await page.goto('/?debug=1&seed=7&camera=off&display=desktop');
    await waitBoot(page);
    expect((await state(page)).phase).toBe('ATTRACT');
    const s = await plush(page, (p) => p.settings());
    expect(s.graphics.renderScale).toBe(0.35);
    expect(s.gameplay.moveSpeed).toBe(0.42);
    expect(s.gameplay.toyCount).toBe(30);
    expect(s.audio.master).toBe(0.8);
    expect(s.themes.current).toBe('sakura');
    expect((await state(page)).toys.length).toBe(30);

    // No tab shows a raw translation key instead of a label.
    await openSettings(page, 'menu-settings');
    for (const tab of ['gameplay', 'themes', 'layout', 'graphics', 'audio', 'ai', 'camera', 'system']) {
      await click(page, `tab-${tab}`);
      const text = await page.getByTestId(`panel-${tab}`).innerText();
      const raw = text.match(/\b(?:set|sec|ai|audio|camera|system|tracking|hud|toast|common|theme|guide|graphics|gameplay|layout)\.[a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\b/g) ?? [];
      const keys = raw.filter((k) => !/\.(json|js|com|md|glb|png|ogg|mp3|wasm|task)$/i.test(k) && !/^(system\.verboseLog)$/.test(k));
      expect(keys, `raw i18n keys in tab ${tab}`).toEqual([]);
      expect(text.trim().length).toBeGreaterThan(40);
    }
    await closeSettings(page, 'cancel');
  });
});
