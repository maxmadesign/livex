import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISPLAY_PROFILE_IDS } from '../../../src/core/types';
import {
  FRAME_ASPECT,
  FRAME_FILL_TOLERANCE,
  computeFrame,
  fitAspect,
  frameEnabled,
  frameInsets,
  frameSupported,
  readFramedEnvironment,
  solveFramed,
} from '../../../src/layout/frame';
import { NO_INSETS, solveLayout, type HudLayout, type Insets } from '../../../src/layout/solve';
import { defaultSettings, getFieldAt, sanitizeSettings, setValueAt, type LayoutSettings } from '../../../src/settings/spec';

const EPS = 0.5;
const profiles = defaultSettings().profiles;
const fill = (l: LayoutSettings): LayoutSettings => ({ ...l, frame: 'fill' });

describe('fitAspect: the largest centred 9:16 box', () => {
  it('1280 × 720 → 405 × 720, centred', () => {
    expect(fitAspect(1280, 720)).toEqual({ x: 437, y: 0, w: 405, h: 720 });
  });

  it('1920 × 1080 → 608 × 1080, centred', () => {
    const r = fitAspect(1920, 1080);
    expect(r).toEqual({ x: 656, y: 0, w: 608, h: 1080 });
    expect(r.x + r.w / 2).toBeCloseTo(1920 / 2, 0);
  });

  it('a 9:16 window is used whole (1080 × 1920, 2160 × 3840, 720 × 1280)', () => {
    expect(fitAspect(1080, 1920)).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    expect(fitAspect(2160, 3840)).toEqual({ x: 0, y: 0, w: 2160, h: 3840 });
    expect(fitAspect(720, 1280)).toEqual({ x: 0, y: 0, w: 720, h: 1280 });
  });

  it(`fills a window within ${FRAME_FILL_TOLERANCE * 100} % of 9:16, letterboxes beyond`, () => {
    // 1080 × 1900: 1.05 % wider than 9:16 → whole window.
    expect(fitAspect(1080, 1900)).toEqual({ x: 0, y: 0, w: 1080, h: 1900 });
    // 1080 × 1950: 1.5 % narrower → whole window.
    expect(fitAspect(1080, 1950)).toEqual({ x: 0, y: 0, w: 1080, h: 1950 });
    // 1080 × 1857 (a 1080p portrait panel with browser chrome): 3.4 % wider → bars left and right.
    const r = fitAspect(1080, 1857);
    expect(r.h).toBe(1857);
    expect(r.w).toBe(1045);
    expect(r.x).toBe(17);
  });

  it('a window narrower than 9:16 (upright phone) gets bars above and below', () => {
    expect(fitAspect(390, 844)).toEqual({ x: 0, y: 75, w: 390, h: 693 });
  });

  it('tiny and degenerate windows', () => {
    expect(fitAspect(100, 50)).toEqual({ x: 36, y: 0, w: 28, h: 50 });
    expect(fitAspect(3, 1000)).toEqual({ x: 0, y: 497, w: 3, h: 5 });
    expect(fitAspect(1, 1)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(fitAspect(0, 0)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(fitAspect(0, 720)).toEqual({ x: 0, y: 0, w: 0, h: 720 });
    expect(fitAspect(Number.NaN, 720)).toEqual({ x: 0, y: 0, w: 0, h: 720 });
  });

  it('always lies inside the window, is centred and has the 9:16 shape (± 1 px of rounding)', () => {
    for (let W = 40; W <= 4000; W += 97) {
      for (let H = 40; H <= 4000; H += 89) {
        const r = fitAspect(W, H);
        const label = `${W}x${H}`;
        expect(r.x, label).toBeGreaterThanOrEqual(0);
        expect(r.y, label).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, label).toBeLessThanOrEqual(W);
        expect(r.y + r.h, label).toBeLessThanOrEqual(H);
        expect(Math.abs(r.x + r.w / 2 - W / 2), label).toBeLessThanOrEqual(1);
        expect(Math.abs(r.y + r.h / 2 - H / 2), label).toBeLessThanOrEqual(1);
        // One side always touches the window.
        expect(r.w === W || r.h === H, label).toBe(true);
        if (r.w < W || r.h < H) {
          // Letterboxed: the box has the 9:16 shape up to one pixel of rounding.
          if (r.h === H) expect(Math.abs(r.w - H * FRAME_ASPECT), label).toBeLessThanOrEqual(0.5 + 1e-9);
          else expect(Math.abs(r.h - W / FRAME_ASPECT), label).toBeLessThanOrEqual(0.5 + 1e-9);
        } else {
          expect(Math.abs(W / H / FRAME_ASPECT - 1), label).toBeLessThanOrEqual(FRAME_FILL_TOLERANCE + 1e-9);
        }
      }
    }
  });
});

describe('computeFrame: which presets simulate the screen', () => {
  it('only the two portrait presets, and only with "Simulate 9:16 screen" on (the default)', () => {
    expect(DISPLAY_PROFILE_IDS.filter(frameSupported)).toEqual(['portrait32', 'portrait86']);
    expect(profiles.portrait32.layout.frame).toBe('simulate916');
    expect(profiles.portrait86.layout.frame).toBe('simulate916');
    expect(profiles.desktop.layout.frame).toBe('fill');
    expect(profiles.mobile.layout.frame).toBe('fill');
    expect(frameEnabled('portrait32', profiles.portrait32.layout)).toBe(true);
    expect(frameEnabled('portrait86', fill(profiles.portrait86.layout))).toBe(false);
    // Even if a desktop / phone profile were set to simulate, it is ignored there.
    expect(frameEnabled('desktop', { frame: 'simulate916' })).toBe(false);
    expect(frameEnabled('mobile', { frame: 'simulate916' })).toBe(false);
  });

  it('portrait86 in a 1280 × 720 window: a 405 × 720 simulated box in the middle', () => {
    expect(computeFrame('portrait86', profiles.portrait86.layout, 1280, 720)).toEqual({
      x: 437,
      y: 0,
      w: 405,
      h: 720,
      windowW: 1280,
      windowH: 720,
      simulated: true,
      letterboxed: true,
    });
  });

  it('on a real 9:16 screen the simulated box is the whole screen', () => {
    for (const [W, H] of [
      [1080, 1920],
      [2160, 3840],
    ] as const) {
      const f = computeFrame('portrait86', profiles.portrait86.layout, W, H);
      expect(f).toEqual({ x: 0, y: 0, w: W, h: H, windowW: W, windowH: H, simulated: true, letterboxed: false });
    }
  });

  it('fill, desktop and mobile use the whole window', () => {
    const whole = { x: 0, y: 0, w: 1280, h: 720, windowW: 1280, windowH: 720, simulated: false, letterboxed: false };
    expect(computeFrame('portrait32', fill(profiles.portrait32.layout), 1280, 720)).toEqual(whole);
    expect(computeFrame('desktop', profiles.desktop.layout, 1280, 720)).toEqual(whole);
    expect(computeFrame('mobile', profiles.mobile.layout, 1280, 720)).toEqual(whole);
  });

  it('is a persisted, sanitised per-preset setting', () => {
    expect(getFieldAt('profiles.portrait86.layout.frame')).toMatchObject({ kind: 'enum', options: ['simulate916', 'fill'], apply: 'live' });
    const s = sanitizeSettings({ profiles: { portrait32: { layout: { frame: 'bogus' } }, portrait86: { layout: { frame: 'fill' } } } });
    expect(s.profiles.portrait32.layout.frame).toBe('simulate916');
    expect(s.profiles.portrait86.layout.frame).toBe('fill');
    // Old settings files without the key get the default.
    expect(sanitizeSettings({ profiles: { portrait86: { layout: { uiScale: 0.7 } } } }).profiles.portrait86.layout.frame).toBe('simulate916');
    // Per preset: switching one off leaves the other alone.
    const b = setValueAt(defaultSettings(), 'profiles.portrait32.layout.frame', 'fill');
    expect(b.profiles.portrait32.layout.frame).toBe('fill');
    expect(b.profiles.portrait86.layout.frame).toBe('simulate916');
  });
});

describe('frameInsets: cut-outs as seen from the box', () => {
  const notch: Insets = { top: 47, right: 44, bottom: 34, left: 44 };

  it('are unchanged when the box is the whole window', () => {
    const f = computeFrame('portrait32', profiles.portrait32.layout, 1080, 1920);
    expect(frameInsets(notch, f)).toBe(notch);
    expect(frameInsets(notch, computeFrame('desktop', profiles.desktop.layout, 1280, 720))).toBe(notch);
  });

  it('only keep the part of a cut-out that reaches into the box', () => {
    // Bars left and right (437 px each): side cut-outs never reach the box; top / bottom stay.
    expect(frameInsets(notch, computeFrame('portrait86', profiles.portrait86.layout, 1280, 720))).toEqual({ top: 47, right: 0, bottom: 34, left: 0 });
    // Upright phone: bars of 75 / 76 px above and below the box.
    expect(frameInsets(notch, computeFrame('portrait32', profiles.portrait32.layout, 390, 844))).toEqual({ top: 0, right: 44, bottom: 0, left: 44 });
    const deep: Insets = { top: 90, right: 0, bottom: 100, left: 0 };
    expect(frameInsets(deep, computeFrame('portrait32', profiles.portrait32.layout, 390, 844))).toEqual({ top: 15, right: 0, bottom: 24, left: 0 });
  });
});

function expectInside(l: HudLayout, top: number, bottom: number, label: string): void {
  for (const [name, r] of [
    ['panel', l.panel],
    ['modal', l.modal],
    ['guide', l.guide],
  ] as const) {
    expect(r.x, `${label} ${name}.x`).toBeGreaterThanOrEqual(-EPS);
    expect(r.x + r.w, `${label} ${name} right`).toBeLessThanOrEqual(l.vw + EPS);
    expect(r.y, `${label} ${name} top`).toBeGreaterThanOrEqual(top - EPS);
    expect(r.y + r.h, `${label} ${name} bottom`).toBeLessThanOrEqual(bottom + EPS);
  }
}

describe('solveFramed: the layout is solved for the box, not the window', () => {
  const WINDOWS: [number, number][] = [
    [1280, 720],
    [1920, 1080],
    [1366, 768],
    [2560, 1440],
    [800, 600],
    [1080, 1920],
    [2160, 3840],
    [390, 844],
  ];

  it('calls the solver with the box size and the box insets', () => {
    for (const id of ['portrait32', 'portrait86'] as const) {
      for (const [W, H] of WINDOWS) {
        const framed = solveFramed(id, profiles[id].layout, W, H, NO_INSETS);
        const f = framed.frame;
        expect(framed.vw, `${id} ${W}x${H}`).toBe(f.w);
        expect(framed.vh, `${id} ${W}x${H}`).toBe(f.h);
        const { frame: _frame, ...rest } = framed;
        expect(rest).toEqual(solveLayout(id, profiles[id].layout, f.w, f.h, NO_INSETS));
      }
    }
  });

  it('portrait86 @ 1280 × 720: the 25–75 % safe band is measured on the box height (180–540 px)', () => {
    const l = solveFramed('portrait86', profiles.portrait86.layout, 1280, 720, NO_INSETS);
    expect(l.vw).toBe(405);
    expect(l.vh).toBe(720);
    expect(l.safeTop).toBeCloseTo(180, 9);
    expect(l.safeBottom).toBeCloseTo(540, 9);
    expectInside(l, 180, 540, 'portrait86 1280x720');
    expect(l.panelStyle).toBe('bar');
    expect(l.adjusted).toBe(false);
  });

  it('a simulated portrait screen has the same normalised layout as the real one', () => {
    for (const id of ['portrait32', 'portrait86'] as const) {
      const real = solveLayout(id, profiles[id].layout, 1080, 1920, NO_INSETS);
      for (const [W, H] of WINDOWS) {
        const sim = solveFramed(id, profiles[id].layout, W, H, NO_INSETS);
        const label = `${id} in ${W}x${H}`;
        // Same aspect up to a pixel of rounding → same fractions up to a pixel.
        const tol = 1.5 / Math.min(sim.vw, sim.vh);
        expect(sim.panelStyle, label).toBe(real.panelStyle);
        expect(sim.guide.place, label).toBe(real.guide.place);
        for (const [a, b, name] of [
          [sim.panel.y / sim.vh, real.panel.y / real.vh, 'panel top'],
          [(sim.panel.y + sim.panel.h) / sim.vh, (real.panel.y + real.panel.h) / real.vh, 'panel bottom'],
          [sim.panel.w / sim.vw, real.panel.w / real.vw, 'panel width'],
          [sim.modal.y / sim.vh, real.modal.y / real.vh, 'modal top'],
          [(sim.modal.y + sim.modal.h) / sim.vh, (real.modal.y + real.modal.h) / real.vh, 'modal bottom'],
          [sim.safeTop / sim.vh, real.safeTop / real.vh, 'safe top'],
          [sim.safeBottom / sim.vh, real.safeBottom / real.vh, 'safe bottom'],
          [sim.floorY, real.floorY, 'floor line'],
        ] as const) {
          expect(Math.abs(a - b), `${label}: ${name} ${a.toFixed(4)} vs ${b.toFixed(4)}`).toBeLessThanOrEqual(tol);
        }
        if (id === 'portrait86') expectInside(sim, sim.vh * 0.25, sim.vh * 0.75, label);
      }
    }
  });

  it('desktop and mobile are unaffected (whole window, solver called with the window size)', () => {
    for (const id of ['desktop', 'mobile'] as const) {
      for (const [W, H] of WINDOWS) {
        const insets: Insets = { top: 5, right: 7, bottom: 9, left: 11 };
        const framed = solveFramed(id, profiles[id].layout, W, H, insets);
        const { frame, ...rest } = framed;
        expect(frame.simulated).toBe(false);
        expect(rest).toEqual(solveLayout(id, profiles[id].layout, W, H, insets));
      }
    }
  });

  it('with "Simulate 9:16 screen" off a portrait preset uses the whole window again', () => {
    const l = solveFramed('portrait32', fill(profiles.portrait32.layout), 1280, 720, NO_INSETS);
    expect(l.vw).toBe(1280);
    expect(l.frame.simulated).toBe(false);
    expect(l.panelStyle).toBe('split');
  });
});

describe('readFramedEnvironment: the resize path of the game', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubBrowser(W: number, H: number): HTMLElement {
    vi.stubGlobal('innerWidth', W);
    vi.stubGlobal('innerHeight', H);
    vi.stubGlobal('window', {
      innerWidth: W,
      innerHeight: H,
      outerWidth: W,
      outerHeight: H + 80,
      screenX: 0,
      screenY: 0,
      devicePixelRatio: 2,
      screen: { width: W, height: H + 80 },
    });
    // The canvas element still has the size of the whole window (React has not moved it yet).
    return { getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) } as unknown as HTMLElement;
  }

  it('portrait86 in 1280 × 720: env, solver size and Window Perspective all use the 405 × 720 box', () => {
    const canvas = stubBrowser(1280, 720);
    const { env, insets, frame } = readFramedEnvironment(canvas, 'portrait86', profiles.portrait86.layout);
    expect(frame).toMatchObject({ x: 437, y: 0, w: 405, h: 720, simulated: true });
    expect(env.viewportW).toBe(405);
    expect(env.viewportH).toBe(720);
    expect(env.simulated).toBe(true);
    expect(env.canvasCenterX).toBeCloseTo(437 + 405 / 2, 9);
    expect(insets).toEqual(NO_INSETS);
  });

  it('desktop: measured from the canvas exactly as before', () => {
    const canvas = stubBrowser(1280, 720);
    const { env, frame } = readFramedEnvironment(canvas, 'desktop', profiles.desktop.layout);
    expect(frame.simulated).toBe(false);
    expect(env.viewportW).toBe(1280);
    expect(env.viewportH).toBe(720);
    expect(env.simulated).toBeUndefined();
  });

  it('portrait32 with the simulation off: measured from the canvas', () => {
    const canvas = stubBrowser(1280, 720);
    const { env } = readFramedEnvironment(canvas, 'portrait32', fill(profiles.portrait32.layout));
    expect(env.viewportW).toBe(1280);
    expect(env.simulated).toBeUndefined();
  });
});
