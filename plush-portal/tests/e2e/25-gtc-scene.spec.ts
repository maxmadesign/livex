import { expect, test, type Page } from '@playwright/test';
import { boot, frames, openSettings, plush, settle, start, state } from './helpers';

/**
 * The GPU theme dressed by the brand kit (src/brand, src/scene/ledWall.ts): the event logo on the
 * LED wall of the play field's back wall, drawn from the kit's logo slot. No official file is in
 * the repository, so the original placeholder wordmark must be the one in use, and its green must
 * reach the screen as the brand green #76B900 (the logo shader undoes the output pass's exposure
 * and tone mapping). Rendered at 1080 × 1920 (portrait 32") with anti-aliasing off, so the logo's
 * green underline is several pixels tall and its inner pixels are not blended by the AA pass.
 */

const BRAND_GREEN = [0x76, 0xb9, 0x00] as const;

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Screen rectangle (CSS px) of a named mesh's unit plane, from the game camera. */
const meshRect = (page: Page, name: string): Promise<Rect | null> =>
  plush(page, (p, meshName) => {
    const stage = p.game.stage;
    let mesh: any = null;
    stage.scene.traverse((o: any) => {
      if (o.name === meshName) mesh = o;
    });
    if (!mesh || !mesh.visible) return null;
    mesh.updateMatrixWorld(true);
    const rect = p.game.deps.canvas.getBoundingClientRect();
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [u, v] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ]) {
      const c = mesh.position.clone().set(u, v, 0).applyMatrix4(mesh.matrixWorld).project(stage.camera);
      xs.push(rect.left + ((c.x + 1) / 2) * rect.width);
      ys.push(rect.top + ((1 - c.y) / 2) * rect.height);
    }
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }, name);

/** Decodes a PNG screenshot in the page and returns the RGBA pixels inside `r`. */
async function pixels(page: Page, png: Buffer, r: Rect): Promise<{ w: number; h: number; data: number[] }> {
  return page.evaluate(
    async ([b64, rect]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const x0 = Math.max(0, Math.floor(rect.x0)), y0 = Math.max(0, Math.floor(rect.y0));
      const w = Math.min(c.width, Math.ceil(rect.x1)) - x0, h = Math.min(c.height, Math.ceil(rect.y1)) - y0;
      return { w, h, data: Array.from(g.getImageData(x0, y0, w, h).data) };
    },
    [png.toString('base64'), r] as const,
  );
}

test('25. GTC scene: the placeholder logo is on the LED wall in the exact brand green', async ({ page }) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1080, height: 1920 });
  await boot(page, {
    display: 'portrait32',
    theme: 'gpu',
    quality: 'medium',
    settings: { graphics: { autoOptimize: false }, system: { attractDemo: false } },
  });
  expect((await state(page)).theme).toBe('gpu');
  // The Medium preset otherwise (bloom, shadows, exposure, Neutral tone mapping), but no FXAA pass.
  await plush(page, (p) => p.game.deps.settings.getState().set('graphics.aa', 'off'));
  expect(await plush(page, (p) => ({ aa: p.settings().graphics.aa, tm: p.settings().graphics.toneMapping, bloom: p.settings().graphics.bloom }))).toEqual({ aa: 'off', tm: 'neutral', bloom: 0.25 });

  // The logo slot resolved to the shipped placeholder (no official file in the repository), and the
  // host mark, which has no placeholder, is not drawn.
  await expect
    .poll(() => plush(page, (p) => p.game.materials?.brand?.logoStatus().logo.loaded ?? false), { timeout: 120_000 })
    .toBe(true);
  const status = await plush(page, (p) => p.game.materials.brand.logoStatus());
  console.log(`logo status: ${JSON.stringify(status)}`);
  expect(status.logo.official).toBe(false);
  expect(status.logo.url).toMatch(/assets\/brand\/gtc\/gtc-logo\.placeholder\.svg$/);
  // The placeholder's own aspect ratio (viewBox 246 × 100), not a stretched square.
  expect(status.logo.aspect).toBeCloseTo(2.46, 2);
  if (status.host) expect(status.host.loaded).toBe(false);

  // Scene objects: the LED wall, the logo on an unlit, untone-mapped material.
  const scene = await plush(page, (p) => {
    const found: Record<string, { visible: boolean; toneMapped: boolean; type: string }> = {};
    p.game.stage.scene.traverse((o: any) => {
      if (['led-wall', 'brand-logo', 'brand-host-logo'].includes(o.name)) found[o.name] = { visible: o.visible, toneMapped: o.material.toneMapped, type: o.material.type };
    });
    return found;
  });
  console.log(`scene: ${JSON.stringify(scene)}`);
  expect(scene['led-wall']?.visible).toBe(true);
  expect(scene['brand-logo']).toEqual({ visible: true, toneMapped: false, type: 'ShaderMaterial' });
  expect(scene['brand-host-logo']?.visible ?? false).toBe(false);

  // A round in progress: no call-to-action over the field, the claw parked at home.
  await start(page);
  await frames(page, 3);
  const rect = await meshRect(page, 'brand-logo');
  expect(rect).not.toBeNull();
  console.log(`logo on screen: ${JSON.stringify(rect)}`);
  expect(rect!.x1 - rect!.x0).toBeGreaterThan(200);

  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const px = await pixels(page, png, rect!);
  // Strongly green pixels: the placeholder's underline. Their median must be the brand green.
  const greens: [number, number, number][] = [];
  let whites = 0;
  for (let i = 0; i < px.data.length; i += 4) {
    const r = px.data[i]!, g = px.data[i + 1]!, b = px.data[i + 2]!;
    if (g > 120 && g > r * 1.35 && b < 70) greens.push([r, g, b]);
    if (r > 225 && g > 225 && b > 225) whites++;
  }
  const median = (k: 0 | 1 | 2) => greens.map((c) => c[k]).sort((a, b) => a - b)[Math.floor(greens.length / 2)]!;
  const got = [median(0), median(1), median(2)];
  console.log(`logo pixels: ${greens.length} green (median rgb ${got.join(', ')}), ${whites} white of ${px.w}×${px.h}`);
  expect(greens.length).toBeGreaterThan(200);
  expect(whites).toBeGreaterThan(500);
  for (const k of [0, 1, 2] as const) expect(Math.abs(got[k]! - BRAND_GREEN[k]), `channel ${k}: ${got[k]} vs ${BRAND_GREEN[k]}`).toBeLessThanOrEqual(8);
});

/** Green pixels of an element as drawn: the brightest ones, and how far any strays from k × brand green. */
async function domGreens(page: Page, testId: string): Promise<{ n: number; top: number[]; offLine: number }> {
  const b = (await page.getByTestId(testId).boundingBox())!;
  const r: Rect = { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const px = await pixels(page, png, r);
  const greens: [number, number, number][] = [];
  for (let i = 0; i < px.data.length; i += 4) {
    const red = px.data[i]!, g = px.data[i + 1]!, bl = px.data[i + 2]!;
    if (g > 120 && g > red * 1.35 && bl < 70) greens.push([red, g, bl]);
  }
  greens.sort((p, q) => q[1] - p[1]);
  // Edge pixels are the green blended with the black plate (k × #76B900): a tint or filter leaves that line.
  const offLine = Math.max(0, ...greens.map(([red, g, bl]) => Math.max(Math.abs(red - (g * BRAND_GREEN[0]) / BRAND_GREEN[1]), bl)));
  return { n: greens.length, top: [...(greens[Math.floor(greens.length * 0.05)] ?? [])], offLine: Math.round(offLine) };
}

const wallLogo = (page: Page) =>
  plush<{ visible: boolean; padOn: number }>(page, (p) => ({ visible: p.game.materials.brand.logo.visible, padOn: p.game.materials.brand.ledWall.uniforms.uPadOn.value }));

const setCalibration = (page: Page, phase: 'countdown' | 'idle') =>
  plush(
    page,
    (p, ph) => {
      const ui = p.game.deps.ui;
      ui.setState({ tracker: { ...ui.getState().tracker, calibration: { phase: ph, remaining: ph === 'idle' ? 0 : 3, detail: '' } } });
    },
    phase,
  );

test('25. GTC attract and win card: the call to action carries the logo as supplied, the wall lends its own meanwhile; the card holds its content', async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await boot(page, { display: 'desktop', theme: 'gpu', settings: { system: { attractDemo: false } } });
  await expect(page.getByTestId('attract-cta')).toBeVisible();
  await expect(page.locator('[data-testid="attract-logo"][data-ready="true"]')).toBeVisible();
  await frames(page, 3);

  // The DOM logo starts on a whole pixel (a centred layout put it at fractional offsets, where the
  // whole bitmap is resampled and every edge of the artwork blurs).
  const at = await page.locator('[data-testid="attract-logo"] img').evaluate((img) => {
    const r = img.getBoundingClientRect();
    return { x: r.left, y: r.top, h: r.height };
  });
  console.log(`attract logo image at ${JSON.stringify(at)}`);
  expect(Math.abs(at.x - Math.round(at.x))).toBeLessThan(0.02);
  expect(Math.abs(at.y - Math.round(at.y))).toBeLessThan(0.02);
  // Its fully covered pixels are exactly the brand green; the others only blend with the black plate
  // (no tint, filter or glow on the artwork).
  const dom = await domGreens(page, 'attract-logo');
  console.log(`attract logo greens: ${JSON.stringify(dom)}`);
  expect(dom.n).toBeGreaterThan(100);
  for (const k of [0, 1, 2] as const) expect(Math.abs(dom.top[k]! - BRAND_GREEN[k]), `channel ${k}: ${dom.top[k]}`).toBeLessThanOrEqual(3);
  expect(dom.offLine).toBeLessThanOrEqual(4);

  // The wall's own logo sits right behind the call to action: it is lent to the overlay (no second
  // logo and no black pad peeking out between the headline and the button, under its glow).
  await expect.poll(() => wallLogo(page)).toEqual({ visible: false, padOn: 0 });

  // A calibration card takes the middle of the screen: the call to action (and its logo) step aside
  // instead of peeking out around the card.
  await setCalibration(page, 'countdown');
  await expect(page.getByTestId('calib-card-countdown')).toBeVisible();
  await expect(page.getByTestId('attract-cta')).toHaveCount(0);
  await setCalibration(page, 'idle');
  await expect(page.getByTestId('attract-cta')).toBeVisible();

  // Play: the overlay is gone and the wall shows its logo again.
  await start(page);
  await frames(page, 2);
  expect(await wallLogo(page)).toEqual({ visible: true, padOn: 1 });

  // The win card in the GPU theme (Settings → Rewards → preview: the same card, side arrangement on a
  // desktop): everything inside its border. The code row under the QR is wider in the brand sans than
  // the card model assumed, and the row of the two columns spilled over both edges of the card.
  await openSettings(page, 'menu-settings', 'rewards');
  await page.getByTestId('rewards-preview').click({ force: true });
  const card = page.getByTestId('reward-preview-card');
  await expect(card).toHaveAttribute('data-arrangement', 'side');
  await settle(page);
  const spill = await card.evaluate((el) => {
    const c = el.getBoundingClientRect();
    const out: string[] = [];
    for (const child of el.querySelectorAll('h2, .pp-breakdown, .pp-subtitle, .pp-reward-instr, .pp-reward-tile, .pp-reward-code .code, .pp-ring, .pp-result-actions')) {
      const r = child.getBoundingClientRect();
      if (!r.width) continue;
      if (r.left < c.left + 0.5 || r.right > c.right - 0.5) out.push(`${child.className}: ${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(c.left)}..${Math.round(c.right)}`);
    }
    return out;
  });
  console.log(`preview card: ${JSON.stringify(await card.boundingBox())}, outside: ${JSON.stringify(spill)}`);
  expect(spill).toEqual([]);
});
