import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../../src/core/types';
import {
  MIN_TOP,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  PHONE_CSS_PX_M,
  PHONE_CSS_PX_M_DPR2,
  PHONE_NOMINAL_SCREEN,
  PHONE_VIEW_DISTANCE,
  computeWindowLayout,
  estimateHandheldScreen,
  eyeToWorld,
  floorLimits,
  handheldPitch,
  isNominalPhoneScreen,
  machineSpan,
  orientScreen,
  phoneCameraPosition,
  virtualWindowSize,
  type WindowEnvironment,
} from '../../../src/perspective/windowGeometry';
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

describe('phones: physical screen estimate and viewing distance', () => {
  const phone = views.mobile.view;

  it('the phone preset starts in window mode at the nominal phone size, held at 0.35 m', () => {
    expect(phone.windowMode).toBe('window');
    expect(isNominalPhoneScreen(phone)).toBe(true);
    expect(phone.screenW).toBeCloseTo(PHONE_NOMINAL_SCREEN.w, 9);
    expect(phone.eye[2]).toBeCloseTo(PHONE_VIEW_DISTANCE, 9);
    expect(phone.refDistance).toBeCloseTo(PHONE_VIEW_DISTANCE, 9);
    // The other presets keep their screens.
    expect(isNominalPhoneScreen(views.desktop.view)).toBe(false);
    expect(isNominalPhoneScreen(views.portrait32.view)).toBe(false);
    expect(isNominalPhoneScreen(views.portrait86.view)).toBe(false);
  });

  it('estimates real phones within about 12 % of their published active area', () => {
    // [CSS width, CSS height, DPR, real width mm, real height mm] (long side first).
    const phones: [number, number, number, number, number][] = [
      [852, 393, 3, 141.1, 65.1], // iPhone 15 Pro, 6.1"
      [932, 430, 3, 154.4, 71.2], // iPhone 15 Pro Max, 6.7"
      [915, 412, 2.625, 146.6, 66.0], // Pixel 7, 6.3"
      [780, 360, 3, 142.9, 66.0], // Galaxy S24, 6.2"
      [667, 375, 2, 104.1, 58.6], // iPhone SE (3rd gen), 4.7"
    ];
    for (const [w, h, dpr, mw, mh] of phones) {
      const e = estimateHandheldScreen(w, h, dpr);
      expect(Math.abs(e.widthM * 1000 - mw) / mw, `${w}x${h}`).toBeLessThan(0.12);
      expect(Math.abs(e.heightM * 1000 - mh) / mh, `${w}x${h}`).toBeLessThan(0.12);
      expect(e.pitchM).toBe(handheldPitch(dpr));
    }
    expect(handheldPitch(2)).toBe(PHONE_CSS_PX_M_DPR2);
    expect(handheldPitch(3)).toBe(PHONE_CSS_PX_M);
    expect(handheldPitch(undefined)).toBe(PHONE_CSS_PX_M);
  });

  it('window mode at the nominal size uses the phone pitch: a pocket-sized window, scaled up accordingly', () => {
    // iPhone 15 Pro in Safari, sideways: 734 × 343 CSS px of a 852 × 393 screen.
    const e = env(734, 343, { screenW: 852, screenH: 393, canvasCenterX: 426, canvasCenterY: 196.5 + 20, dpr: 3 });
    const l = computeWindowLayout(e, phone, 0.7);
    expect(l.estimated).toBe(true);
    expect(l.physWidth).toBeCloseTo(734 * PHONE_CSS_PX_M, 9);
    expect(l.physHeight).toBeCloseTo(343 * PHONE_CSS_PX_M, 9);
    expect(l.physWidth).toBeGreaterThan(0.1);
    expect(l.physWidth).toBeLessThan(0.14);
    // The canvas sits below the screen centre (toolbar above it).
    expect(l.physOffsetY).toBeCloseTo(-20 * PHONE_CSS_PX_M, 9);
    // Same virtual window as any other 2.14:1 canvas → roughly 20× scale; the eye at 35 cm sees the
    // window under the same angle as the phone's real screen.
    expect(l.scale).toBeGreaterThan(18);
    expect(l.scale).toBeLessThan(28);
    const eye: Vec3 = [0, 0, 0];
    eyeToWorld(l, phone.eye, eye);
    expect(l.width / 2 / eye[2]).toBeCloseTo(l.physWidth / 2 / phone.eye[2], 9);
    // An entered size wins over the estimate.
    const measured = computeWindowLayout(e, { ...phone, screenW: 0.15, screenH: 0.07 }, 0.7);
    expect(measured.estimated).toBe(false);
    expect(measured.physWidth).toBeCloseTo((734 * 0.15) / 852, 9);
    // Fullscreen mode is never estimated.
    expect(computeWindowLayout(e, { ...phone, windowMode: 'fullscreen' }, 0.7).estimated).toBe(false);
  });

  it('keeps the desktop, 32" and 86" values exactly as before', () => {
    expect(computeWindowLayout(env(1920, 1080), views.desktop.view, 0.69).physWidth).toBeCloseTo(0.531, 9);
    expect(computeWindowLayout(env(1080, 1920), views.portrait32.view, 0.6).physWidth).toBeCloseTo(0.398, 9);
    expect(computeWindowLayout(env(2160, 3840), views.portrait86.view, 0.48).physWidth).toBeCloseTo(1.071, 9);
    for (const v of [views.desktop.view, views.portrait32.view, views.portrait86.view]) expect(computeWindowLayout(env(1920, 1080), v, 0.69).estimated).toBe(false);
  });

  it('turns screen.width/height into the viewport orientation only when that is the only way it fits', () => {
    // iOS reports the portrait screen size even when the phone is sideways.
    expect(orientScreen(734, 343, 393, 852)).toEqual({ screenW: 852, screenH: 393 });
    expect(orientScreen(393, 659, 393, 852)).toEqual({ screenW: 393, screenH: 852 });
    // Android already turns it.
    expect(orientScreen(863, 360, 915, 412)).toEqual({ screenW: 915, screenH: 412 });
    // A narrow browser window on a landscape monitor is not a rotated screen.
    expect(orientScreen(600, 900, 1920, 1080)).toEqual({ screenW: 1920, screenH: 1080 });
    // The rotation angle confirms a turn that would otherwise be ambiguous.
    expect(orientScreen(360, 300, 390, 844, 90)).toEqual({ screenW: 844, screenH: 390 });
    expect(orientScreen(360, 300, 390, 844, 0)).toEqual({ screenW: 390, screenH: 844 });
  });

  it('puts the front camera at the top edge of the phone, wherever that edge is', () => {
    const [w, h] = [0.141, 0.065];
    expect(phoneCameraPosition(90, w, h)[0]).toBeCloseTo(-(w / 2 - 0.008), 9);
    expect(phoneCameraPosition(270, w, h)[0]).toBeCloseTo(w / 2 - 0.008, 9);
    expect(phoneCameraPosition(-90, w, h)[0]).toBeCloseTo(w / 2 - 0.008, 9);
    expect(phoneCameraPosition(0, 0.065, 0.141)[1]).toBeCloseTo(0.141 / 2 - 0.008, 9);
    expect(phoneCameraPosition(180, 0.065, 0.141)[1]).toBeCloseTo(-(0.141 / 2 - 0.008), 9);
    // The preset's static default matches the usual way of turning a phone (top to the left).
    expect(views.mobile.view.camPos[0]).toBeCloseTo(phoneCameraPosition(90, w, h)[0], 2);
  });

  it('machineSpan and floorLimits agree with the window the scene builds', () => {
    for (const [w, h] of [
      [852, 393],
      [393, 852],
      [1920, 1080],
      [1080, 1920],
    ] as const) {
      const l = computeWindowLayout(env(w, h), views.mobile.view, 0.5);
      const span = machineSpan(w, h);
      expect(span.right - span.left).toBeCloseTo((MIN_WINDOW_WIDTH / l.width) * w, 6);
      const lim = floorLimits(w, h);
      expect(computeWindowLayout(env(w, h), views.mobile.view, 0).floorY).toBeCloseTo(lim.min, 9);
      expect(computeWindowLayout(env(w, h), views.mobile.view, 1).floorY).toBeCloseTo(lim.max, 9);
      expect(virtualWindowSize(w / h).width).toBeCloseTo(l.width, 9);
    }
  });
});
