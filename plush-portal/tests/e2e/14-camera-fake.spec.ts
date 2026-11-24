import { expect, test, type Page } from '@playwright/test';
import { LOW_GRAPHICS, click, closeSettings, openSettings, plush, setField, start, state, waitBoot } from './helpers';

/**
 * Runs only in the "camera-fake" project: Chromium is started with
 * --use-fake-device-for-media-stream --use-fake-ui-for-media-stream, i.e. a
 * synthetic camera (a green test pattern, no face) and auto-granted permission.
 * This proves the camera lifecycle, not face tracking accuracy.
 */
const tracker = (page: Page) =>
  plush(page, (p) => {
    const t = p.tracker();
    const d = t.diagnostics;
    return { state: t.status.state as string, detail: t.status.detail as string, source: t.status.viewSource as string, backend: t.status.backend as string | null, label: t.status.cameraLabel as string | null, size: `${t.status.videoWidth}x${t.status.videoHeight}`, fps: t.status.inferenceFps as number, ms: t.status.inferenceMs as number, faces: t.status.facesSeen as number, inferences: (d?.inferences ?? 0) as number, attempts: (d?.attempts ?? []) as unknown[], lastError: (d?.lastError ?? null) as string | null };
  });

const tracks = (page: Page): Promise<{ live: number; ended: number; kinds: string[]; calls: any[] }> =>
  page.evaluate(() => {
    const w = window as any;
    const all: MediaStreamTrack[] = w.__streams.flatMap((s: MediaStream) => s.getTracks());
    return { live: all.filter((t) => t.readyState === 'live').length, ended: all.filter((t) => t.readyState === 'ended').length, kinds: all.map((t) => t.kind), calls: w.__gum };
  });

test('14. fake camera: tracking starts after START, toggling off ends the camera track, on restarts it', async ({ page }) => {
  await page.addInitScript((g) => {
    const w = window as any;
    w.__gum = [];
    w.__streams = [];
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      w.__gum.push(JSON.parse(JSON.stringify(c ?? null)));
      const stream = await real(c);
      w.__streams.push(stream);
      return stream;
    };
    if (sessionStorage.getItem('__e2e_seeded')) return;
    sessionStorage.setItem('__e2e_seeded', '1');
    localStorage.setItem('plush-portal/settings', JSON.stringify({ version: 1, settings: { graphics: g } }));
    localStorage.setItem('plush-portal/tutorial-seen', '1');
  }, LOW_GRAPHICS);
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:8799/') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  const uploads: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') uploads.push(`${r.method()} ${new URL(r.url()).pathname} ${(r.postData() ?? '').length} bytes`);
  });
  await page.goto('/?debug=1&seed=7&display=desktop');
  await waitBoot(page);

  // Nothing touches the camera before the first user gesture.
  expect((await tracker(page)).state).toBe('idle');
  expect((await tracks(page)).calls.length).toBe(0);

  await start(page);
  await expect.poll(async () => (await tracks(page)).live, { timeout: 60_000 }).toBe(1);
  const first = await tracks(page);
  expect(first.kinds, 'video only, no microphone').toEqual(['video']);
  for (const c of first.calls) expect(c.audio === false || c.audio === undefined).toBe(true);
  // The model loads from this server and inference starts on the synthetic picture.
  await expect.poll(async () => (await tracker(page)).state, { timeout: 240_000 }).toMatch(/searching|tracking|lost|model_error/);
  const running = await tracker(page);
  console.log(`fake camera running: ${JSON.stringify(running)}`);
  expect(running.state, `model failed to load: ${running.detail} ${running.lastError ?? ''}`).not.toBe('model_error');
  expect(running.label).toBeTruthy();
  expect(running.backend).toBeTruthy();
  await expect(page.getByTestId('camera-chip')).toHaveAttribute('data-state', running.state);
  await expect.poll(async () => (await tracker(page)).inferences, { timeout: 120_000 }).toBeGreaterThan(2);
  const measured = await tracker(page);
  console.log(`fake camera inference: backend ${measured.backend}, ${measured.size}, ${measured.inferences} inferences, ${measured.fps.toFixed(1)} /s, ${measured.ms.toFixed(1)} ms each, faces seen ${measured.faces}, view source ${measured.source}`);
  // The synthetic picture has no face: the game must not pretend to track someone.
  expect(measured.faces).toBe(0);
  expect(measured.state).toBe('searching');
  expect(measured.source).toBe('neutral');
  const eye = (await state(page)).eye;
  for (const v of eye) expect(Number.isFinite(v)).toBe(true);

  // Settings → Camera shows the live preview and the real device; switch tracking off.
  await openSettings(page, 'menu-settings', 'camera');
  await expect(page.getByTestId('camera-status')).toHaveAttribute('data-state', 'searching');
  await expect(page.getByTestId('camera-preview')).toBeVisible();
  await setField(page, 'camera.enabled', false);
  await expect.poll(async () => (await tracks(page)).live, { timeout: 30_000 }).toBe(0);
  expect((await tracks(page)).ended).toBe(1);
  await expect.poll(async () => (await tracker(page)).state).toBe('off');
  const stopped = (await tracker(page)).inferences;
  await page.waitForTimeout(1500);
  expect((await tracker(page)).inferences, 'no inference after switching off').toBe(stopped);
  await closeSettings(page, 'apply');
  await expect(page.getByTestId('camera-chip')).toHaveAttribute('data-state', 'off');

  // Switch it on again: a new camera stream and tracking resumes.
  await openSettings(page, 'menu-settings', 'camera');
  await setField(page, 'camera.enabled', true);
  await closeSettings(page, 'apply');
  await expect.poll(async () => (await tracks(page)).live, { timeout: 60_000 }).toBe(1);
  await expect.poll(async () => (await tracker(page)).state, { timeout: 240_000 }).toMatch(/searching|tracking/);
  const again = await tracks(page);
  expect(again.calls.length).toBeGreaterThanOrEqual(2);
  expect(again.ended).toBeGreaterThanOrEqual(1);

  // Explicit stop / start buttons.
  await openSettings(page, 'menu-settings', 'camera');
  await click(page, 'btn-camera-stop');
  await expect.poll(async () => (await tracks(page)).live, { timeout: 30_000 }).toBe(0);
  await click(page, 'btn-camera-start');
  await expect.poll(async () => (await tracks(page)).live, { timeout: 60_000 }).toBe(1);
  await closeSettings(page, 'cancel');

  // Hidden tab pauses inference; nothing was sent anywhere.
  console.log(`requests with a body during the camera test: ${uploads.join('; ') || 'none'}`);
  expect(external, 'no request left this server').toEqual([]);
  for (const u of uploads) expect(u).toMatch(/\/api\/ai\//);
});
