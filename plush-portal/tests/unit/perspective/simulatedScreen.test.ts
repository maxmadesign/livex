import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Vec3 } from '../../../src/core/types';
import { computeFrame } from '../../../src/layout/frame';
import { computeWindowLayout, eyeToWorld, readWindowEnvironment, type WindowEnvironment } from '../../../src/perspective/windowGeometry';
import { defaultSettings, type ViewSettings } from '../../../src/settings/spec';

const profiles = defaultSettings().profiles;

/** The simulated box of a portrait preset in a laptop window: a 1280 × 720 viewport on a 1280 × 800 screen. */
function laptopEnv(boxW: number, boxH: number, extra: Partial<WindowEnvironment> = {}): WindowEnvironment {
  return {
    viewportW: boxW,
    viewportH: boxH,
    screenW: 1280,
    screenH: 800,
    // The box is centred in the window, which sits at the top-left of the laptop screen.
    canvasCenterX: 640,
    canvasCenterY: 80 + 360,
    dpr: 2,
    simulated: true,
    ...extra,
  };
}

/** The real kiosk: a full-screen canvas on a 9:16 panel. */
function kioskEnv(w: number, h: number): WindowEnvironment {
  return { viewportW: w, viewportH: h, screenW: w, screenH: h, canvasCenterX: w / 2, canvasCenterY: h / 2 };
}

describe('Window Perspective treats the simulated box as the preset’s physical screen', () => {
  it('32": 0.398 × 0.708 m, scale ≈ 2.66, no offset — the same as on the real panel', () => {
    const view = profiles.portrait32.view;
    const sim = computeWindowLayout(laptopEnv(405, 720), view, profiles.portrait32.layout.floorY);
    const real = computeWindowLayout(kioskEnv(1080, 1920), view, profiles.portrait32.layout.floorY);
    expect(sim.physWidth).toBeCloseTo(0.398, 9);
    expect(sim.physHeight).toBeCloseTo(0.398 / (405 / 720), 9);
    expect(sim.physHeight).toBeCloseTo(0.708, 2);
    expect(sim.physOffsetX).toBe(0);
    expect(sim.physOffsetY).toBe(0);
    expect(sim.estimated).toBe(false);
    expect(sim.scale).toBeCloseTo(real.scale, 9);
    expect(sim.scale).toBeCloseTo(2.66, 2);
    expect(sim.width).toBeCloseTo(real.width, 9);
    expect(sim.height).toBeCloseTo(real.height, 9);
    expect(sim.top).toBeCloseTo(real.top, 9);
  });

  it('86": 1.071 × 1.904 m, scale ≈ 0.99', () => {
    const view = profiles.portrait86.view;
    const sim = computeWindowLayout(laptopEnv(405, 720), view, profiles.portrait86.layout.floorY);
    expect(sim.physWidth).toBeCloseTo(1.071, 9);
    expect(sim.physHeight).toBeCloseTo(1.904, 2);
    expect(sim.scale).toBeCloseTo(0.99, 2);
  });

  it('ignores the "Game window: browser window" estimate, which would size the box from the laptop’s pixels', () => {
    const view: ViewSettings = { ...profiles.portrait32.view, windowMode: 'window' };
    const sim = computeWindowLayout(laptopEnv(405, 720), view, 0.6);
    expect(sim.physWidth).toBeCloseTo(0.398, 9);
    expect(sim.physOffsetX).toBe(0);
    // Without the flag the same window would be taken as a 405 px slice of a 0.708 m wide screen.
    const unsimulated = computeWindowLayout(laptopEnv(405, 720, { simulated: false }), view, 0.6);
    expect(unsimulated.physWidth).toBeCloseTo((405 * 0.708) / 1280, 9);
    expect(unsimulated.physOffsetY).not.toBe(0);
  });

  it('maps the tracked eye exactly as the real screen does (head tracking stays correct on a laptop)', () => {
    for (const id of ['portrait32', 'portrait86'] as const) {
      const { view, layout } = profiles[id];
      const sim = computeWindowLayout(laptopEnv(405, 720), view, layout.floorY);
      const real = computeWindowLayout(kioskEnv(2160, 3840), view, layout.floorY);
      for (const eye of [view.eye, [0.2, -0.1, 0.8] as Vec3, [-0.35, 0.3, 0.5] as Vec3]) {
        const a = eyeToWorld(sim, eye, [0, 0, 0]);
        const b = eyeToWorld(real, eye, [0, 0, 0]);
        for (let i = 0; i < 3; i++) expect(a[i]!, `${id} eye ${eye.join(',')} [${i}]`).toBeCloseTo(b[i]!, 9);
      }
    }
  });

  it('a box of 1920 × 1080 (608 × 1080, one pixel off 9:16) keeps the width and follows the box shape', () => {
    const f = computeFrame('portrait86', profiles.portrait86.layout, 1920, 1080);
    const sim = computeWindowLayout(laptopEnv(f.w, f.h), profiles.portrait86.view, 0.48);
    expect(sim.physWidth).toBeCloseTo(1.071, 9);
    expect(sim.physWidth / sim.physHeight).toBeCloseTo(f.w / f.h, 9);
    expect(sim.width / sim.height).toBeCloseTo(f.w / f.h, 9);
  });
});

describe('readWindowEnvironment with a simulated box', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the box instead of the canvas element and marks it simulated', () => {
    vi.stubGlobal('window', {
      innerWidth: 1280,
      innerHeight: 720,
      outerWidth: 1280,
      outerHeight: 800,
      screenX: 0,
      screenY: 0,
      devicePixelRatio: 2,
      screen: { width: 1280, height: 800 },
    });
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) } as unknown as HTMLElement;
    const env = readWindowEnvironment(canvas, { x: 437, y: 0, w: 405, h: 720 });
    expect(env.viewportW).toBe(405);
    expect(env.viewportH).toBe(720);
    expect(env.simulated).toBe(true);
    expect(env.canvasCenterX).toBeCloseTo(437 + 202.5, 9);
    expect(env.dpr).toBe(2);
    const plain = readWindowEnvironment(canvas);
    expect(plain.viewportW).toBe(1280);
    expect(plain.simulated).toBeUndefined();
  });
});
