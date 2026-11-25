import { expect, test, type Page } from '@playwright/test';
import { appliedValue, boot, click, closeSettings, openSettings, plush, setField, start, waitBoot } from './helpers';

/** Real Web Audio state of the engine (context state and the gain actually set on the master bus). */
const engine = (page: Page) =>
  plush(page, (p) => {
    const a = p.game.deps.audio;
    return {
      status: p.audio().state as string,
      music: p.audio().musicTheme as string | null,
      fallback: p.audio().usingFallbackSynth as boolean,
      ctx: (a.ctx?.state ?? null) as string | null,
      master: (a.master ? a.master.gain.value : null) as number | null,
      musicBus: (a.musicBus ? a.musicBus.gain.value : null) as number | null,
      preview: !!a.preview,
      sampleRate: a.ctx?.sampleRate ?? 0,
    };
  });

/**
 * Playwright's Chromium lets an AudioContext run without any gesture (navigator.userActivation
 * reports an activation on load, whatever --autoplay-policy says), so a desktop browser's autoplay
 * block is emulated here: contexts start suspended and resume() only takes effect once the page has
 * seen a real pointerdown / pointerup / touchend / keydown.
 */
const emulateAutoplayBlock = () => {
  let gesture = false;
  for (const t of ['pointerdown', 'pointerup', 'touchend', 'keydown']) window.addEventListener(t, () => (gesture = true), { capture: true });
  const Native = window.AudioContext;
  const nativeResume = Native.prototype.resume;
  window.AudioContext = class extends Native {
    constructor(options?: AudioContextOptions) {
      super(options);
      void Native.prototype.suspend.call(this);
    }
  };
  window.AudioContext.prototype.resume = function (this: AudioContext) {
    return gesture ? nativeResume.call(this) : new Promise<void>(() => undefined);
  };
};

test.describe('10. audio', () => {
  test('attract mode plays the theme music: at once where autoplay is allowed, after any tap where it is not', async ({ page, browser }) => {
    // This browser allows autoplay (like a kiosk started with --autoplay-policy=no-user-gesture-required).
    await boot(page, { display: 'desktop', theme: 'ocean' });
    await expect.poll(async () => (await engine(page)).status, { timeout: 120_000 }).toBe('running');
    await expect.poll(async () => (await engine(page)).music, { timeout: 60_000 }).toBe('ocean');
    expect(await plush(page, (p) => p.game.attract.active), 'still in attract mode, nobody pressed anything').toBe(true);
    // Autoplay blocked (emulated): locked at boot, a tap on the joystick during the demo unlocks it.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const blocked = await ctx.newPage();
    await blocked.addInitScript(emulateAutoplayBlock);
    await boot(blocked, { display: 'desktop', theme: 'ocean' });
    await blocked.waitForTimeout(2500);
    expect((await engine(blocked)).status).toBe('locked');
    expect((await engine(blocked)).ctx).toBe('suspended');
    const pad = await blocked.getByTestId('stick').boundingBox();
    await blocked.mouse.click(pad!.x + pad!.width / 2, pad!.y + pad!.height / 2);
    await expect.poll(async () => (await engine(blocked)).status, { timeout: 120_000 }).toBe('running');
    await expect.poll(async () => (await engine(blocked)).music, { timeout: 60_000 }).toBe('ocean');
    expect(await plush(blocked, (p) => p.game.attract.active), 'a joystick tap does not leave attract mode').toBe(true);
    await ctx.close();
  });

  test('locked until START (autoplay blocked, emulated), then running; volume, mute, track preview and output-device UI', async ({ page }) => {
    await page.addInitScript(emulateAutoplayBlock);
    await boot(page, { display: 'desktop' });
    const locked = await engine(page);
    expect(locked.status).toBe('locked');
    expect(locked.ctx === null || locked.ctx === 'suspended').toBe(true);

    await start(page);
    await expect.poll(async () => (await engine(page)).status, { timeout: 90_000 }).toBe('running');
    await expect.poll(async () => (await engine(page)).music, { timeout: 60_000 }).toBe('sakura');
    const on = await engine(page);
    console.log(`after START: ${JSON.stringify(on)}`);
    expect(on.ctx).toBe('running');
    await expect.poll(async () => (await engine(page)).master).toBeCloseTo(0.8, 2);

    // Live preview of the volume slider and the mute switch, then Cancel restores the applied values.
    await openSettings(page, 'menu-settings', 'audio');
    await expect(page.getByTestId('audio-status')).toHaveAttribute('data-state', 'running');
    await setField(page, 'audio.master', 0.3);
    await expect.poll(async () => (await engine(page)).master).toBeCloseTo(0.3, 2);
    await setField(page, 'audio.music', 0.2);
    await expect.poll(async () => (await engine(page)).musicBus).toBeCloseTo(0.2, 2);
    await setField(page, 'audio.muted', true);
    await expect.poll(async () => (await engine(page)).master).toBeLessThan(0.005);
    await setField(page, 'audio.muted', false);
    await expect.poll(async () => (await engine(page)).master).toBeCloseTo(0.3, 2);
    expect(await appliedValue(page, 'audio.master'), 'not applied yet').toBe(0.8);

    // Track preview: another theme's music plays while the button is pressed, the game theme is untouched.
    const ocean = page.getByTestId('track-previews').locator('[data-value="ocean"]');
    await ocean.scrollIntoViewIfNeeded();
    await ocean.click({ force: true });
    await expect(ocean).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await engine(page)).preview, { timeout: 60_000 }).toBe(true);
    expect((await engine(page)).music, 'the game keeps its own track').toBe('sakura');
    await ocean.click({ force: true });
    await expect(ocean).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => (await engine(page)).preview).toBe(false);

    // Output device selection is only offered when the browser can really do it.
    const capability = await page.evaluate(async () => {
      const Ctor = window.AudioContext;
      const supported = typeof (Ctor.prototype as unknown as { setSinkId?: unknown }).setSinkId === 'function';
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
      return { supported, outputs: devices.length, labelled: devices.filter((d) => d.label).length };
    });
    const select = await page.getByTestId('field-audio.outputDevice').count();
    const note = await page.getByTestId('audio-output-unsupported').count();
    const noteText = note ? await page.getByTestId('audio-output-unsupported').innerText() : '';
    console.log(`output device: setSinkId ${capability.supported ? 'supported' : 'missing'}, ${capability.outputs} outputs → ${select ? 'device list shown' : `note: "${noteText}"`}`);
    expect(select + note, 'either a device list or an explanation').toBe(1);
    expect(await plush(page, (p) => p.audio().outputDeviceSupported)).toBe(capability.supported);
    if (!capability.supported) expect(select).toBe(0);
    if (select) expect(capability.supported && capability.outputs > 0).toBe(true);
    if (note && capability.supported) expect(noteText).not.toMatch(/cannot|not supported|unsupported/i);

    await closeSettings(page, 'cancel');
    await expect.poll(async () => (await engine(page)).master).toBeCloseTo(0.8, 2);

    // Mute + Apply persists across a reload.
    await openSettings(page, 'menu-settings', 'audio');
    await setField(page, 'audio.muted', true);
    await setField(page, 'audio.sfx', 0.4);
    await closeSettings(page, 'apply');
    expect(await appliedValue(page, 'audio.muted')).toBe(true);
    await expect.poll(async () => (await engine(page)).master).toBeLessThan(0.005);
    await page.reload();
    await waitBoot(page);
    expect(await appliedValue(page, 'audio.muted')).toBe(true);
    expect(await appliedValue(page, 'audio.sfx')).toBeCloseTo(0.4, 5);
    await start(page);
    await expect.poll(async () => (await engine(page)).status, { timeout: 90_000 }).toBe('running');
    await expect.poll(async () => (await engine(page)).master).toBeLessThan(0.005);
    void click;
  });
});
