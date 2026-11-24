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

test.describe('10. audio', () => {
  test('locked until START, then running; volume, mute, track preview and output-device UI', async ({ page }) => {
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
