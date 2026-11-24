import { expect, type Page } from '@playwright/test';
import { LOW_GRAPHICS, appliedValue, click, closeSettings, collection, frames, openSettings, plush, setField, start, state, waitBoot, winARound } from './helpers';

export const tracker = (page: Page) =>
  plush(page, (p) => {
    const t = p.tracker();
    return { state: t.status.state as string, detail: t.status.detail as string, source: t.status.viewSource as string, backend: t.status.backend as string | null, label: t.status.cameraLabel as string | null };
  });

/** Opens the game with head tracking enabled (no ?camera=off) and records every getUserMedia call. */
export async function openWithCamera(page: Page): Promise<void> {
  await page.addInitScript((g) => {
    // Record every camera request the page makes.
    const w = window as any;
    w.__gum = [];
    const md = navigator.mediaDevices;
    if (md?.getUserMedia) {
      const real = md.getUserMedia.bind(md);
      md.getUserMedia = (c?: MediaStreamConstraints) => {
        w.__gum.push(JSON.parse(JSON.stringify(c ?? null)));
        return real(c);
      };
    }
    if (sessionStorage.getItem('__e2e_seeded')) return;
    sessionStorage.setItem('__e2e_seeded', '1');
    localStorage.setItem('plush-portal/settings', JSON.stringify({ version: 1, settings: { graphics: g } }));
    localStorage.setItem('plush-portal/tutorial-seen', '1');
  }, LOW_GRAPHICS);
  // No ?camera=off: head tracking is on by default, exactly like a normal launch.
  await page.goto('/?debug=1&seed=7&display=desktop');
  await waitBoot(page);
}

/** The camera could not be used: the game must fall back to the fixed viewpoint, say so, and stay playable. */
export async function expectNeutralAndPlayable(page: Page, want: string): Promise<void> {
  expect(await appliedValue(page, 'camera.enabled'), 'head tracking is on by default').toBe(true);
  const idle = await tracker(page);
  expect(idle.state, 'the camera is not touched before the first START').toBe('idle');
  expect(await page.evaluate(() => (window as any).__gum.length)).toBe(0);
  await expect(page.getByTestId('camera-chip')).toHaveAttribute('data-state', 'idle');

  await start(page);
  await expect.poll(async () => (await tracker(page)).state, { timeout: 60_000 }).toBe(want);
  const t = await tracker(page);
  const calls: any[] = await page.evaluate(() => (window as any).__gum);
  console.log(`camera ${want}: detail "${t.detail}", view source ${t.source}, getUserMedia calls ${JSON.stringify(calls)}`);
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) {
    expect(c.audio === false || c.audio === undefined, 'never asks for the microphone').toBe(true);
    expect(c.video).toBeTruthy();
  }
  expect(t.source).toBe('neutral');
  await expect(page.getByTestId('camera-chip')).toHaveAttribute('data-state', want);
  const title = await page.getByTestId('camera-chip').getAttribute('title');
  expect(title).toMatch(/fixed view/);

  // The view stays at the fixed reference viewpoint and the game plays normally.
  await frames(page, 3);
  const eye1 = (await state(page)).eye;
  await frames(page, 4);
  const eye2 = (await state(page)).eye;
  console.log(`camera ${want}: eye stays at (${eye2.map((v) => v.toFixed(3)).join(', ')})`);
  for (let i = 0; i < 3; i++) expect(eye2[i]!, 'the viewpoint does not move').toBeCloseTo(eye1[i]!, 5);
  const projection: number[] = await plush(page, (p) => p.projection());
  for (const v of projection) expect(Number.isFinite(v)).toBe(true);
  expect(Math.abs(projection[8]!), 'centred reference viewpoint').toBeLessThan(1e-4);
  const { result } = await winARound(page, 8);
  expect(result.outcome).toBe('won');
  expect((await collection(page)).wins).toBe(1);
  await click(page, 'result-again');

  // Settings → Camera tells the same story and offers no fake "tracking" state.
  await openSettings(page, 'menu-settings', 'camera');
  await expect(page.getByTestId('camera-status')).toHaveAttribute('data-state', want);
  await expect(page.getByTestId('view-source')).toHaveText(/.+/);
  const source = await page.getByTestId('view-source').innerText();
  console.log(`camera ${want}: settings show view source "${source}"`);
  // Manual test sliders are labelled as a test, not as tracking.
  await page.getByTestId('test-view-x').evaluate((el) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '0.2');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => (await tracker(page)).source).toBe('test');
  expect((await tracker(page)).state, 'sliders do not turn into "tracking"').toBe(want);
  await click(page, 'btn-test-reset');
  await expect.poll(async () => (await tracker(page)).source).toBe('neutral');
  // Switching head tracking off is reflected by the chip.
  await setField(page, 'camera.enabled', false);
  await closeSettings(page, 'apply');
  await expect(page.getByTestId('camera-chip')).toHaveAttribute('data-state', 'off');
  expect((await tracker(page)).source).toBe('neutral');
}

