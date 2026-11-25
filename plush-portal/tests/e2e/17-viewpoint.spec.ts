import { expect, test, type Page } from '@playwright/test';
import { boot, box, click, closeSettings, frames, openSettings, plush, setField, start, state } from './helpers';

/**
 * Facts about the camera read from the running renderer:
 *  - `corner`: the largest distance (in NDC) between where the four corners of the
 *    cabinet's glass "window" are projected and the four corners of the viewport.
 *    For a true off-axis (generalised perspective) projection this is 0 for every eye position.
 *  - the frustum identities P[8] = −2·ex/W, P[9] = −2·ey/H, P[0] = 2·ez/W, P[5] = 2·ez/H
 *    (eye e relative to the window centre, window size W×H).
 */
const camera = (page: Page) =>
  plush(page, (p) => {
    const cam = p.game.stage.camera;
    cam.updateMatrixWorld(true);
    const P = Array.from(cam.projectionMatrix.elements) as number[];
    const V = Array.from(cam.matrixWorldInverse.elements) as number[];
    const w = cam.getWindow();
    const e = cam.getEyeLocal();
    const mul = (m: number[], v: number[]) => [0, 1, 2, 3].map((r) => m[r]! * v[0]! + m[r + 4]! * v[1]! + m[r + 8]! * v[2]! + m[r + 12]! * v[3]!);
    let corner = 0;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const clip = mul(P, mul(V, [w.x + (sx * w.width) / 2, w.y + (sy * w.height) / 2, w.z, 1]));
        corner = Math.max(corner, Math.abs(clip[0]! / clip[3]! - sx), Math.abs(clip[1]! / clip[3]! - sy));
      }
    }
    const rot = Array.from(cam.quaternion.toArray()) as number[];
    return {
      P,
      corner,
      eye: [e.x, e.y, e.z] as number[],
      window: w as { x: number; y: number; z: number; width: number; height: number },
      identity: Math.max(Math.abs(P[8]! + (2 * e.x) / w.width), Math.abs(P[9]! + (2 * e.y) / w.height), Math.abs(P[0]! - (2 * e.z) / w.width), Math.abs(P[5]! - (2 * e.z) / w.height)),
      rotated: Math.abs(rot[0]!) + Math.abs(rot[1]!) + Math.abs(rot[2]!),
      source: p.tracker().status.viewSource as string,
      effective: p.state().effective as { width: number; height: number },
    };
  });

const slide = (page: Page, axis: 'x' | 'y' | 'z', value: number) =>
  page.getByTestId(`test-view-${axis}`).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);

const HUD = ['panel', 'dpad', 'stick', 'grab', 'logo', 'info-button', 'status'];
const hudRects = async (page: Page) => Object.fromEntries(await Promise.all(HUD.map(async (id) => [id, await box(page, id)] as const)));
const world = (page: Page) => plush(page, (p) => ({ hub: p.state().claw.hub as number[], claw: [p.state().claw.x, p.state().claw.z] as number[], toys: p.state().toys.map((t: any) => t.pos) as number[][], steps: p.state().steps as number }));

for (const [name, display, width, height] of [
  ['desktop 1280×720', 'desktop', 1280, 720],
  ['portrait86 1080×1920', 'portrait86', 1080, 1920],
] as const) {
  test(`17. viewpoint on ${name}: test sliders move the eye through a true off-axis projection; HUD and claw stay put`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await boot(page, { display });
    // Attract mode sways the viewpoint slowly to show off the depth effect; a started game rests at the reference viewpoint.
    const attract = await camera(page);
    expect(attract.corner, 'attract-mode sway is off-axis too').toBeLessThan(1e-5);
    await start(page);
    await expect.poll(async () => Math.abs((await camera(page)).P[8]!), { timeout: 120_000 }).toBeLessThan(1e-5);
    await frames(page, 2);
    const c0 = await camera(page);
    const hud0 = await hudRects(page);
    console.log(`${name} neutral: eye(local) ${c0.eye.map((v) => v.toFixed(3)).join(', ')}, window ${c0.window.width.toFixed(3)}×${c0.window.height.toFixed(3)}, P[8]=${c0.P[8]!.toFixed(4)} P[9]=${c0.P[9]!.toFixed(4)}, corner error ${c0.corner.toExponential(1)}`);
    expect(c0.source).toBe('neutral');
    expect(c0.corner).toBeLessThan(1e-5);
    expect(c0.identity).toBeLessThan(1e-5);
    expect(c0.rotated, 'the camera never rotates towards the scene (no orbit camera)').toBe(0);
    expect(Math.abs(c0.P[8]!), 'centred horizontally → symmetric left/right').toBeLessThan(1e-5);

    await openSettings(page, 'menu-settings', 'camera');
    const w0 = await world(page);
    const steps: { label: string; c: Awaited<ReturnType<typeof camera>> }[] = [];
    const move = async (axis: 'x' | 'y' | 'z', value: number, element: number) => {
      const before = await camera(page);
      await slide(page, axis, value);
      // The eye eases towards the slider value over a few frames.
      await expect.poll(async () => Math.abs((await camera(page)).P[element]! - before.P[element]!), { timeout: 120_000 }).toBeGreaterThan(0.01);
      await frames(page, 4);
      const c = await camera(page);
      steps.push({ label: `${axis}=${value}`, c });
      console.log(`${name} ${axis}=${value}: eye ${c.eye.map((v) => v.toFixed(3)).join(', ')}, P[0]=${c.P[0]!.toFixed(4)} P[8]=${c.P[8]!.toFixed(4)} P[9]=${c.P[9]!.toFixed(4)}, corner error ${c.corner.toExponential(1)}, source ${c.source}`);
      expect(c.source).toBe('test');
      expect(c.corner, 'window corners still map to the viewport corners').toBeLessThan(1e-5);
      expect(c.identity).toBeLessThan(1e-5);
      expect(c.rotated).toBe(0);
      expect(c.window).toEqual(c0.window);
      return c;
    };
    const right = await move('x', 0.25, 8);
    expect(right.eye[0]!, 'eye moved to the right').toBeGreaterThan(c0.eye[0]! + 0.02);
    expect(right.P[8]!, 'frustum is now asymmetric (shifted left)').toBeLessThan(-0.02);
    const left = await move('x', -0.25, 8);
    expect(left.eye[0]!).toBeLessThan(c0.eye[0]! - 0.02);
    expect(left.P[8]!).toBeGreaterThan(0.02);
    const up = await move('y', 0.2, 9);
    expect(up.eye[1]!).toBeGreaterThan(left.eye[1]! + 0.02);
    expect(up.P[9]!).toBeLessThan(left.P[9]! - 0.01);
    const near = await move('z', -0.3, 0);
    expect(near.eye[2]!, 'eye moved closer to the glass').toBeLessThan(up.eye[2]! - 0.02);
    expect(near.P[0]!, 'closer eye → wider field of view').toBeLessThan(up.P[0]! - 0.01);

    // The HUD is DOM in CSS pixels and the game world is simulated independently of the eye.
    expect(await hudRects(page)).toEqual(hud0);
    expect(await world(page)).toEqual(w0);

    // Resize the window while the eye is off-centre.
    await page.setViewportSize({ width: Math.round(width * 0.8), height: Math.round(height * 0.9) });
    await expect.poll(async () => (await state(page)).hud.vw, { timeout: 60_000 }).toBe(Math.round(width * 0.8));
    await frames(page, 4);
    const resized = await camera(page);
    console.log(`${name} after resize to ${Math.round(width * 0.8)}×${Math.round(height * 0.9)}: window ${resized.window.width.toFixed(3)}×${resized.window.height.toFixed(3)}, P[8]=${resized.P[8]!.toFixed(4)}, corner error ${resized.corner.toExponential(1)}, 3D buffer ${resized.effective.width}×${resized.effective.height}`);
    expect(resized.corner).toBeLessThan(1e-5);
    expect(resized.identity).toBeLessThan(1e-5);
    expect(Math.abs(resized.P[8]!), 'still asymmetric after the resize').toBeGreaterThan(0.02);
    expect(resized.source).toBe('test');
    await page.setViewportSize({ width, height });
    await expect.poll(async () => (await state(page)).hud.vw, { timeout: 60_000 }).toBe(width);

    // Reset → back to the neutral viewpoint.
    await click(page, 'btn-test-reset');
    await expect.poll(async () => (await camera(page)).source).toBe('neutral');
    await expect.poll(async () => Math.abs((await camera(page)).P[8]!), { timeout: 120_000 }).toBeLessThan(1e-3);

    // Change the internal 3D resolution while the eye is off-centre (same test-viewpoint API the sliders use).
    // (Leaving the Camera tab resets the sliders, so the viewpoint is set after switching tabs.)
    await click(page, 'tab-graphics');
    await plush(page, (p) => p.game.deps.tracker.setTestViewpoint([0.2, 0.1, 0]));
    await expect.poll(async () => Math.abs((await camera(page)).P[8]!), { timeout: 120_000 }).toBeGreaterThan(0.02);
    const beforeScale = await camera(page);
    await setField(page, 'graphics.renderScale', 0.7);
    await setField(page, 'graphics.maxPixels', 1.2);
    await expect.poll(async () => (await camera(page)).effective.width, { timeout: 120_000 }).toBeGreaterThan(beforeScale.effective.width);
    await frames(page, 4);
    const scaled = await camera(page);
    console.log(`${name} render scale 0.35 → 0.7: 3D buffer ${beforeScale.effective.width}×${beforeScale.effective.height} → ${scaled.effective.width}×${scaled.effective.height}, P[8] ${beforeScale.P[8]!.toFixed(4)} → ${scaled.P[8]!.toFixed(4)}, corner error ${scaled.corner.toExponential(1)}`);
    expect(scaled.corner).toBeLessThan(1e-5);
    expect(scaled.identity).toBeLessThan(1e-5);
    expect(Math.abs(scaled.P[8]!)).toBeGreaterThan(0.02);
    expect(await hudRects(page), 'HUD rectangles do not depend on the 3D resolution').toEqual(hud0);
    expect(await world(page), 'nothing in the game world moved').toEqual(w0);
    await plush(page, (p) => p.game.deps.tracker.setTestViewpoint(null));
    await closeSettings(page, 'cancel');
  });
}
