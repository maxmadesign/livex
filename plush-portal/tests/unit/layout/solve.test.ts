import { describe, expect, it } from 'vitest';
import { NO_INSETS, guessProfile, solveLayout, type HudLayout } from '../../../src/layout/solve';
import { defaultSettings, type LayoutSettings } from '../../../src/settings/spec';

const EPS = 0.5; // half a CSS pixel of rounding slack

function expectInsideViewport(l: HudLayout, label: string): void {
  for (const [name, r] of [
    ['panel', l.panel],
    ['modal', l.modal],
  ] as const) {
    expect(r.x, `${label} ${name}.x`).toBeGreaterThanOrEqual(-EPS);
    expect(r.y, `${label} ${name}.y`).toBeGreaterThanOrEqual(-EPS);
    expect(r.x + r.w, `${label} ${name} right`).toBeLessThanOrEqual(l.vw + EPS);
    expect(r.y + r.h, `${label} ${name} bottom`).toBeLessThanOrEqual(l.vh + EPS);
    expect(r.w, `${label} ${name}.w`).toBeGreaterThan(0);
    expect(r.h, `${label} ${name}.h`).toBeGreaterThan(0);
  }
  expect(l.guide.x, `${label} guide.x`).toBeGreaterThanOrEqual(-EPS);
  expect(l.guide.x + l.guide.w, `${label} guide right`).toBeLessThanOrEqual(l.vw + EPS);
  expect(l.guide.y, `${label} guide.y`).toBeGreaterThanOrEqual(-EPS);
  expect(l.guide.y + l.guide.h, `${label} guide bottom`).toBeLessThanOrEqual(l.vh + EPS);
  expect(l.unit, `${label} unit`).toBeGreaterThan(0);
  expect(l.touch, `${label} touch`).toBeGreaterThan(0);
}

function expectInsideSafeZone(l: HudLayout, label: string): void {
  expect(l.panel.y, `${label} panel top`).toBeGreaterThanOrEqual(l.safeTop - EPS);
  expect(l.panel.y + l.panel.h, `${label} panel bottom`).toBeLessThanOrEqual(l.safeBottom + EPS);
  expect(l.modal.y, `${label} modal top`).toBeGreaterThanOrEqual(l.safeTop - EPS);
  expect(l.modal.y + l.modal.h, `${label} modal bottom`).toBeLessThanOrEqual(l.safeBottom + EPS);
  expect(l.guide.y, `${label} guide top`).toBeGreaterThanOrEqual(l.safeTop - EPS);
  expect(l.guide.y + l.guide.h, `${label} guide bottom`).toBeLessThanOrEqual(l.safeBottom + EPS);
}

const PORTRAIT_SIZES: [number, number][] = [
  [1080, 1920],
  [2160, 3840],
  [720, 1280],
  [1000, 1900],
  [1205, 2010],
  [900, 1700],
  [540, 960],
];

describe('layout solver · portrait86', () => {
  const base = defaultSettings().profiles.portrait86.layout;

  it('uses the central half of the screen and the 0.60 anchor by default', () => {
    for (const [vw, vh] of PORTRAIT_SIZES) {
      const l = solveLayout('portrait86', base, vw, vh);
      const label = `${vw}x${vh}`;
      expect(l.safeTop / vh, label).toBeCloseTo(0.25, 5);
      expect(l.safeBottom / vh, label).toBeCloseTo(0.75, 5);
      expect((l.panel.y + l.panel.h / 2) / vh, label).toBeCloseTo(0.6, 2);
      expect(l.panelStyle).toBe('bar');
      expectInsideViewport(l, label);
      expectInsideSafeZone(l, label);
      // The toys' floor line is above the control panel and Momo sits below it, never over the toys.
      expect(l.floorY * vh, label).toBeLessThan(l.panel.y);
      expect(l.guide.place, label).toBe('belowPanel');
      expect(l.guide.y, label).toBeGreaterThanOrEqual(l.panel.y + l.panel.h);
      // Centred horizontally.
      expect(l.panel.x + l.panel.w / 2, label).toBeCloseTo(vw / 2, 3);
      expect(l.modal.x + l.modal.w / 2, label).toBeCloseTo(vw / 2, 3);
    }
  });

  it('scales with the viewport: identical proportions at 1080×1920 and 2160×3840', () => {
    const a = solveLayout('portrait86', base, 1080, 1920);
    const b = solveLayout('portrait86', base, 2160, 3840);
    expect(b.unit).toBeCloseTo(a.unit * 2, 6);
    expect(b.touch).toBeCloseTo(a.touch * 2, 6);
    expect(b.panel.w).toBeCloseTo(a.panel.w * 2, 4);
    expect(b.panel.h).toBeCloseTo(a.panel.h * 2, 4);
    expect(b.panel.y).toBeCloseTo(a.panel.y * 2, 4);
    expect(b.floorY).toBeCloseTo(a.floorY, 6);
  });

  it('keeps every interactive rect inside the safe zone for setting extremes (auto-fit on)', () => {
    const variants: Partial<LayoutSettings>[] = [];
    for (const uiScale of [0.4, 0.66, 1, 1.8])
      for (const touchSize of [56, 100, 180])
        for (const panelWidth of [0.3, 0.6, 1])
          for (const anchorY of [0.29, 0.45, 0.6, 0.71])
            for (const margin of [0, 0.035, 0.15]) variants.push({ uiScale, touchSize, panelWidth, anchorY, marginX: margin, marginY: margin });
    for (const handedness of ['left', 'right'] as const) variants.push({ handedness, fontScale: 1.6 });
    for (const zone of [
      [0.25, 0.75],
      [0.3, 0.6],
      [0.2, 0.8],
      [0.35, 0.7],
    ]) variants.push({ safeTop: zone[0]!, safeBottom: zone[1]!, anchorY: (zone[0]! + zone[1]!) / 2 + 0.05 });
    let checked = 0;
    for (const [vw, vh] of PORTRAIT_SIZES) {
      for (const v of variants) {
        const l = solveLayout('portrait86', { ...base, ...v, autoFit: true }, vw, vh);
        const label = `${vw}x${vh} ${JSON.stringify(v)}`;
        expectInsideViewport(l, label);
        expectInsideSafeZone(l, label);
        // A panel inside the zone is at most as tall as the zone.
        expect(l.panel.h, label).toBeLessThanOrEqual(l.safeBottom - l.safeTop + EPS);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it('keeps the play floor above the panel whenever the panel sits in the lower part of the zone', () => {
    for (const [vw, vh] of PORTRAIT_SIZES) {
      for (const anchorY of [0.56, 0.6, 0.64, 0.68]) {
        for (const uiScale of [0.5, 0.66, 0.9]) {
          for (const touchSize of [72, 100, 132]) {
            const l = solveLayout('portrait86', { ...base, anchorY, uiScale, touchSize }, vw, vh);
            expect(l.floorY * vh, `${vw}x${vh} a=${anchorY} s=${uiScale} t=${touchSize}`).toBeLessThanOrEqual(l.panel.y);
          }
        }
      }
    }
  });

  it('auto-fit shrinks a panel that would not fit and says so', () => {
    const huge = solveLayout('portrait86', { ...base, uiScale: 1.8, touchSize: 180 }, 1080, 1920);
    expect(huge.adjusted).toBe(true);
    expect(huge.panel.h).toBeLessThanOrEqual((huge.safeBottom - huge.safeTop) * 0.62 + EPS);
    const normal = solveLayout('portrait86', base, 1080, 1920);
    expect(normal.adjusted).toBe(false);
  });

  it('repairs a degenerate safe zone handed to it directly', () => {
    const l = solveLayout('portrait86', { ...base, safeTop: 0.5, safeBottom: 0.52 }, 1080, 1920);
    expect(l.safeBottom - l.safeTop).toBeGreaterThanOrEqual(1920 * 0.3 - EPS);
    expect(l.adjusted).toBe(true);
    expectInsideSafeZone(l, 'degenerate');
  });
});

describe('layout solver · portrait32', () => {
  const base = defaultSettings().profiles.portrait32.layout;
  it('uses the whole screen with the controls along the bottom', () => {
    for (const [vw, vh] of PORTRAIT_SIZES) {
      const l = solveLayout('portrait32', base, vw, vh);
      const label = `${vw}x${vh}`;
      expectInsideViewport(l, label);
      expect(l.safeTop).toBe(0);
      expect(l.safeBottom).toBe(vh);
      expect(l.panelStyle).toBe('bar');
      // Panel in the lower third, toys above it, Momo between them (not over the toys).
      expect(l.panel.y / vh, label).toBeGreaterThan(0.6);
      expect(l.floorY * vh, label).toBeLessThan(l.panel.y);
      expect(l.guide.place, label).toBe('abovePanel');
      expect(l.floorY * vh, label).toBeLessThanOrEqual(l.guide.y);
      expect(l.topBar.y + l.topBar.h, label).toBeLessThan(l.panel.y);
    }
  });
  it('is not constrained by the 86-inch central zone', () => {
    const a = solveLayout('portrait32', base, 1080, 1920);
    const b = solveLayout('portrait86', defaultSettings().profiles.portrait86.layout, 1080, 1920);
    expect(a.panel.y + a.panel.h).toBeGreaterThan(b.safeBottom);
    expect(a.touch).toBeGreaterThan(b.touch);
  });
});

describe('layout solver · desktop', () => {
  const base = defaultSettings().profiles.desktop.layout;
  const sizes: [number, number][] = [
    [1920, 1080],
    [1280, 720],
    [1440, 900],
    [1680, 1050],
    [2560, 1080],
    [3440, 1440],
    [1024, 768],
    [900, 650],
  ];
  it('stays inside the viewport for 16:9, 16:10, ultrawide and small windows', () => {
    for (const [vw, vh] of sizes) {
      const l = solveLayout('desktop', base, vw, vh);
      const label = `${vw}x${vh}`;
      expectInsideViewport(l, label);
      expect(l.panelStyle, label).toBe('split');
      expect(l.guide.place, label).toBe('side');
      // Controls sit low; the play floor is above them.
      expect(l.panel.y / vh, label).toBeGreaterThan(0.5);
      expect(l.floorY, label).toBeGreaterThan(0.28);
      expect(l.floorY, label).toBeLessThanOrEqual(0.86);
    }
  });
  it('does not stretch the HUD on ultrawide screens (units follow the short side)', () => {
    const wide = solveLayout('desktop', base, 3440, 1440);
    const normal = solveLayout('desktop', base, 2560, 1440);
    expect(wide.unit).toBeCloseTo(normal.unit, 6);
    expect(wide.touch).toBeCloseTo(normal.touch, 6);
  });
});

describe('guessProfile', () => {
  it('suggests a preset from the viewport shape', () => {
    expect(guessProfile(1920, 1080)).toBe('desktop');
    expect(guessProfile(1000, 1000)).toBe('desktop');
    expect(guessProfile(1080, 1920)).toBe('portrait32');
    expect(guessProfile(720, 1280)).toBe('portrait32');
    expect(guessProfile(2160, 3840)).toBe('portrait86');
    expect(guessProfile(1620, 2880)).toBe('portrait86');
  });

  it('suggests the phone preset only for a finger-driven viewport with a short side of at most 500 px', () => {
    // No matchMedia in Node: the default is "not a touch screen".
    expect(guessProfile(844, 390)).toBe('desktop');
    expect(guessProfile(844, 390, false)).toBe('desktop');
    expect(guessProfile(844, 390, true)).toBe('mobile');
    expect(guessProfile(390, 844, true)).toBe('mobile');
    expect(guessProfile(1000, 500, true)).toBe('mobile');
    expect(guessProfile(1000, 501, true)).toBe('desktop');
    // A big touch kiosk is not a phone.
    expect(guessProfile(1080, 1920, true)).toBe('portrait32');
    expect(guessProfile(2160, 3840, true)).toBe('portrait86');
  });
});

describe('layout solver · documented big-screen values (no regression from the phone work)', () => {
  const d = defaultSettings().profiles;
  const row = (l: HudLayout) => [l.panel.y / l.vh, (l.panel.y + l.panel.h) / l.vh, l.panel.w / l.vw, l.floorY].map((v) => Number(v.toFixed(3)));
  it('matches the table in docs/DISPLAYS.md', () => {
    expect(row(solveLayout('desktop', d.desktop.layout, 1920, 1080, NO_INSETS))).toEqual([0.701, 0.979, 0.93, 0.69]);
    expect(row(solveLayout('portrait32', d.portrait32.layout, 1080, 1920, NO_INSETS))).toEqual([0.752, 0.978, 0.93, 0.6]);
    expect(row(solveLayout('portrait86', d.portrait86.layout, 1080, 1920, NO_INSETS))).toEqual([0.528, 0.672, 0.6, 0.48]);
    for (const [p, vw, vh] of [
      ['desktop', 1920, 1080],
      ['portrait32', 1080, 1920],
      ['portrait86', 2160, 3840],
    ] as const) {
      const l = solveLayout(p, d[p].layout, vw, vh, NO_INSETS);
      expect(l.adjusted, p).toBe(false);
      expect(l.controls, p).toBeNull();
      // The default argument (no browser here) measures no insets: same result.
      expect(solveLayout(p, d[p].layout, vw, vh)).toEqual(l);
    }
  });

  it('keeps the panel and the title row clear of screen cut-outs when a big screen reports some', () => {
    const insets = { top: 30, right: 40, bottom: 25, left: 40 };
    const l = solveLayout('desktop', d.desktop.layout, 1280, 720, insets);
    expect(l.panel.x).toBeGreaterThanOrEqual(40 - EPS);
    expect(l.panel.x + l.panel.w).toBeLessThanOrEqual(1280 - 40 + EPS);
    expect(l.panel.y + l.panel.h).toBeLessThanOrEqual(720 - 25 + EPS);
    expect(l.topBar.y).toBeGreaterThanOrEqual(30);
    expect(l.topBar.x).toBeGreaterThanOrEqual(40);
  });
});
