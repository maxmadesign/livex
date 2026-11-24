import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src/core/types';
import { MIN_TOP, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH, computeWindowLayout, eyeToWorld, type WindowEnvironment } from '../../../src/perspective/windowGeometry';
import { BIN } from '../../../src/physics/fieldSpec';
import { defaultSettings } from '../../../src/settings/spec';

const views = defaultSettings().profiles;
const env = (w: number, h: number, extra: Partial<WindowEnvironment> = {}): WindowEnvironment => ({
  viewportW: w,
  viewportH: h,
  screenW: w,
  screenH: h,
  canvasCenterX: w / 2,
  canvasCenterY: h / 2,
  ...extra,
});

describe('computeWindowLayout', () => {
  it('preserves the canvas aspect so nothing is ever stretched', () => {
    for (const [w, h] of [
      [1080, 1920],
      [2160, 3840],
      [1920, 1080],
      [1920, 1200],
      [3440, 1440],
      [1000, 1000],
      [800, 1900],
    ]) {
      const l = computeWindowLayout(env(w!, h!), views.portrait86.view, 0.5);
      expect(l.width / l.height, `${w}x${h}`).toBeCloseTo(w! / h!, 9);
      expect(l.aspect).toBeCloseTo(w! / h!, 9);
      expect(l.width).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH - 1e-9);
      expect(l.height).toBeGreaterThanOrEqual(Math.min(MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH / (w! / h!)) - 1e-9);
      expect(l.top - l.bottom).toBeCloseTo(l.height, 9);
      expect(l.centerY).toBeCloseTo((l.top + l.bottom) / 2, 9);
    }
  });

  it('portrait: the window is exactly as wide as the machine; landscape: side bays appear', () => {
    const p = computeWindowLayout(env(1080, 1920), views.portrait86.view, 0.48);
    expect(p.width).toBeCloseTo(MIN_WINDOW_WIDTH, 9);
    expect(p.sideBay).toBe(0);
    const d = computeWindowLayout(env(1920, 1080), views.desktop.view, 0.69);
    expect(d.height).toBeCloseTo(MIN_WINDOW_HEIGHT, 9);
    expect(d.sideBay).toBeGreaterThan(0.3);
    const u = computeWindowLayout(env(3440, 1440), views.desktop.view, 0.69);
    // Ultrawide: more bay, same height → the cabinet itself is not scaled or stretched.
    expect(u.height).toBeCloseTo(d.height, 9);
    expect(u.sideBay).toBeGreaterThan(d.sideBay);
  });

  it('puts the front edge of the play floor (y = 0) on the requested screen line', () => {
    for (const [w, h, view, floor] of [
      [1080, 1920, views.portrait86.view, 0.48],
      [1080, 1920, views.portrait32.view, 0.6],
      [1920, 1080, views.desktop.view, 0.72],
      [2160, 3840, views.portrait86.view, 0.52],
    ] as const) {
      const l = computeWindowLayout(env(w, h), view, floor);
      expect(l.floorY).toBeCloseTo(floor, 9);
      // Screen Y (0 = top) of world height 0:
      expect((l.top - 0) / l.height).toBeCloseTo(floor, 9);
    }
  });

  it('never lets the gantry leave the window or the bin disappear', () => {
    for (const floor of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      for (const [w, h] of [
        [1080, 1920],
        [1920, 1080],
      ]) {
        const l = computeWindowLayout(env(w!, h!), views.portrait86.view, floor);
        expect(l.top, `floor ${floor}`).toBeGreaterThanOrEqual(MIN_TOP - 1e-9);
        expect(l.bottom).toBeLessThanOrEqual(-0.3 + 1e-9);
        expect(l.binFloorY).toBeGreaterThanOrEqual(BIN.minFloorY);
        expect(l.binFloorY).toBeLessThanOrEqual(BIN.maxFloorY);
      }
    }
  });

  it('fullscreen presets map the canvas to the nominal panel', () => {
    const l = computeWindowLayout(env(2160, 3840), views.portrait86.view, 0.48);
    expect(l.physWidth).toBeCloseTo(1.071, 6);
    expect(l.physHeight).toBeCloseTo(1.904, 3);
    expect(l.physOffsetX).toBe(0);
    expect(l.physOffsetY).toBe(0);
    // Life size: one world metre is (almost exactly) one real metre on the 86-inch wall.
    expect(l.scale).toBeCloseTo(MIN_WINDOW_WIDTH / 1.071, 6);
    const small = computeWindowLayout(env(1080, 1920), views.portrait32.view, 0.6);
    expect(small.physWidth).toBeCloseTo(0.398, 6);
    expect(small.scale).toBeCloseTo(MIN_WINDOW_WIDTH / 0.398, 6);
    // Resolution does not change physical size.
    const lowRes = computeWindowLayout(env(1080, 1920), views.portrait86.view, 0.48);
    expect(lowRes.physWidth).toBeCloseTo(l.physWidth, 9);
    expect(lowRes.scale).toBeCloseTo(l.scale, 9);
  });

  it('window mode derives the physical size from CSS pixels, not from the whole monitor', () => {
    const view = views.desktop.view; // 0.531 m wide monitor
    const full = computeWindowLayout(env(1920, 1080), view, 0.69);
    expect(full.physWidth).toBeCloseTo(0.531, 6);
    const half = computeWindowLayout(env(960, 540, { screenW: 1920, screenH: 1080, canvasCenterX: 480, canvasCenterY: 270 }), view, 0.69);
    expect(half.physWidth).toBeCloseTo(0.531 / 2, 6);
    expect(half.physHeight).toBeCloseTo(half.physWidth * (540 / 960), 6);
    // The window sits up and to the left of the screen centre.
    expect(half.physOffsetX).toBeLessThan(0);
    expect(half.physOffsetY).toBeGreaterThan(0);
    expect(half.physOffsetX).toBeCloseTo(-0.531 / 4, 6);
    // Same virtual window (same aspect) → the smaller physical window needs a larger scale.
    expect(half.width).toBeCloseTo(full.width, 9);
    expect(half.scale).toBeCloseTo(full.scale * 2, 6);
  });
});

describe('eyeToWorld', () => {
  it('scales the physical eye uniformly and anchors it on the window centre', () => {
    const l = computeWindowLayout(env(1080, 1920), views.portrait32.view, 0.6);
    const out: Vec3 = [0, 0, 0];
    eyeToWorld(l, [0, 0, 0.6], out);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(l.centerY, 9);
    expect(out[2]).toBeCloseTo(0.6 * l.scale, 9);
    eyeToWorld(l, [0.1, -0.05, 0.6], out);
    expect(out[0]).toBeCloseTo(0.1 * l.scale, 9);
    expect(out[1]).toBeCloseTo(l.centerY - 0.05 * l.scale, 9);
    // Similar triangles: the eye's angle to the window edge is the same in the room and in the world.
    expect(l.width / 2 / out[2]).toBeCloseTo(l.physWidth / 2 / 0.6, 9);
  });

  it('never returns an eye in or behind the glass', () => {
    const l = computeWindowLayout(env(1920, 1080), views.desktop.view, 0.69);
    const out: Vec3 = [0, 0, 0];
    for (const z of [0, -1, 1e-6]) {
      eyeToWorld(l, [0, 0, z], out);
      expect(out[2]).toBeGreaterThan(0);
    }
  });
});
