import { describe, expect, it } from 'vitest';
import { floorLimits } from '../../../src/perspective/windowGeometry';
import { NO_INSETS, PHONE, guessProfile, solveLayout, type HudLayout, type Insets, type Rect } from '../../../src/layout/solve';
import { defaultSettings, type LayoutSettings } from '../../../src/settings/spec';

const EPS = 0.5;
const base = defaultSettings().profiles.mobile.layout;

/** Landscape viewports: full-screen phones and the same phones with browser chrome (Playwright device sizes). */
const LANDSCAPE: [number, number][] = [
  [640, 360], // Galaxy S III / small Android, 16:9
  [667, 375], // iPhone SE (3rd gen), 16:9
  [740, 360], // Galaxy S8
  [780, 360], // Galaxy S24, 19.5:9
  [800, 360], // 20:9
  [844, 390], // iPhone 14, full screen
  [852, 393], // iPhone 15 Pro, full screen
  [915, 412], // Pixel 7, full screen
  [932, 430], // iPhone 15 Pro Max, full screen
  [950, 440],
  [734, 343], // iPhone 15 Pro in Safari
  [750, 340], // iPhone 14 in Safari
  [814, 380], // iPhone 15 Pro Max in Safari
  [863, 360], // Pixel 7 in Chrome
  [802, 293], // Pixel 5 in Chrome (shortest)
];
const PORTRAIT: [number, number][] = [
  [360, 640],
  [375, 667],
  [360, 740],
  [360, 780],
  [390, 844],
  [393, 852],
  [412, 915],
  [430, 932],
  [393, 659], // iPhone 15 Pro in Safari
  [430, 739],
  [412, 839], // Pixel 7 in Chrome
  [320, 568], // first-generation iPhone SE (stress case)
];

const LANDSCAPE_INSETS: Insets[] = [
  NO_INSETS,
  { top: 0, right: 0, bottom: 21, left: 47 }, // notch on the left, home indicator
  { top: 0, right: 59, bottom: 21, left: 59 }, // Dynamic Island phones report both sides
];
const PORTRAIT_INSETS: Insets[] = [NO_INSETS, { top: 47, right: 0, bottom: 34, left: 0 }, { top: 59, right: 0, bottom: 34, left: 0 }];
/**
 * Cut-outs only exist on 19.5:9-and-longer phones, and only a full-screen page (home-screen app or
 * after the first START) reaches into them; inside Safari's or Chrome's toolbars they report none.
 */
const FULL_SCREEN = new Set(['780x360', '800x360', '844x390', '852x393', '915x412', '932x430', '950x440', '360x780', '390x844', '393x852', '412x915', '430x932']);
const insetsFor = (vw: number, vh: number): Insets[] => (FULL_SCREEN.has(`${vw}x${vh}`) ? (vw > vh ? LANDSCAPE_INSETS : PORTRAIT_INSETS) : [NO_INSETS]);

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const label = (l: HudLayout, extra = '') => `${l.vw}x${l.vh} ${JSON.stringify(l.insets)} ${extra}`;

function controls(l: HudLayout): [string, Rect][] {
  const c = l.controls!;
  return [
    ['dpad', c.dpad],
    ['action', c.action],
    ['status', c.status],
    ['menu', c.menu],
  ];
}

/** Everything the player touches is on screen, clear of cut-outs, and nothing covers anything else. */
function expectPlayable(l: HudLayout, extra = '') {
  const tag = label(l, extra);
  expect(l.controls, tag).not.toBeNull();
  const left = l.insets.left - EPS;
  const right = l.vw - l.insets.right + EPS;
  const top = l.insets.top - EPS;
  const bottom = l.vh - l.insets.bottom + EPS;
  const parts = controls(l);
  for (const [name, r] of [...parts, ['panel', l.panel] as [string, Rect], ['modal', l.modal] as [string, Rect], ['topBar', l.topBar] as [string, Rect]]) {
    expect(r.w, `${tag} ${name}.w`).toBeGreaterThan(0);
    expect(r.x, `${tag} ${name} left`).toBeGreaterThanOrEqual(left);
    expect(r.x + r.w, `${tag} ${name} right`).toBeLessThanOrEqual(right);
    expect(r.y, `${tag} ${name} top`).toBeGreaterThanOrEqual(top);
    expect(r.y + r.h, `${tag} ${name} bottom`).toBeLessThanOrEqual(bottom);
  }
  // Inside the reported safe zone as well (the generic HUD rule).
  expect(l.panel.y, tag).toBeGreaterThanOrEqual(l.safeTop - EPS);
  expect(l.panel.y + l.panel.h, tag).toBeLessThanOrEqual(l.safeBottom + EPS);
  expect(l.modal.y + l.modal.h, tag).toBeLessThanOrEqual(l.safeBottom + EPS);
  // No two controls overlap, the controls stay inside the panel and below the title row.
  for (let i = 0; i < parts.length; i++) {
    const [an, a] = parts[i]!;
    expect(a.x, `${tag} ${an} in panel`).toBeGreaterThanOrEqual(l.panel.x - EPS);
    expect(a.x + a.w, `${tag} ${an} in panel`).toBeLessThanOrEqual(l.panel.x + l.panel.w + EPS);
    expect(a.y, `${tag} ${an} in panel`).toBeGreaterThanOrEqual(l.panel.y - EPS);
    expect(a.y + a.h, `${tag} ${an} in panel`).toBeLessThanOrEqual(l.panel.y + l.panel.h + EPS);
    expect(overlap(a, l.topBar), `${tag} ${an} vs title row`).toBeLessThan(EPS);
    for (let j = i + 1; j < parts.length; j++) {
      const [bn, b] = parts[j]!;
      expect(overlap(a, b), `${tag} ${an} overlaps ${bn}`).toBeLessThan(EPS);
    }
  }
}

/** Momo's block (at its maximum height) never reaches a control or the title row. */
function expectGuideClear(l: HudLayout, extra = '') {
  const tag = label(l, extra);
  const g = { x: l.guide.x, y: l.guide.y, w: l.guide.w, h: l.guide.maxH };
  expect(l.guide.maxH, tag).toBeGreaterThanOrEqual(l.guide.h - EPS);
  for (const [name, r] of [...controls(l), ['panel', l.panel] as [string, Rect], ['topBar', l.topBar] as [string, Rect]]) {
    if (name === 'panel' && l.panelStyle === 'split') continue; // the split panel is only a bounding box
    expect(overlap(g, r), `${tag} guide overlaps ${name}`).toBeLessThan(EPS);
  }
  expect(g.x, tag).toBeGreaterThanOrEqual(l.insets.left - EPS);
  expect(g.x + g.w, tag).toBeLessThanOrEqual(l.vw - l.insets.right + EPS);
}

describe('phone layout · sideways', () => {
  it('puts the pad bottom-left and the big button bottom-right, both at least 56 px, inside the viewport', () => {
    // Even the unrealistic case (a notch on a 16:9 phone) stays playable, only less tidy.
    expectPlayable(solveLayout('mobile', base, 640, 360, LANDSCAPE_INSETS[2]!));
    for (const [vw, vh] of LANDSCAPE) {
      for (const insets of insetsFor(vw, vh)) {
        const l = solveLayout('mobile', base, vw, vh, insets);
        const tag = label(l);
        expect(l.orientation, tag).toBe('landscape');
        expect(l.panelStyle, tag).toBe('split');
        expect(l.adjusted, tag).toBe(false);
        expectPlayable(l);
        expectGuideClear(l);
        const c = l.controls!;
        // Main controls: 56+ CSS px, compact menu and everything else 44+.
        expect(l.touch, tag).toBeGreaterThanOrEqual(PHONE.mainMin - 1e-6);
        expect(c.action.w, tag).toBeGreaterThanOrEqual(2 * PHONE.mainMin);
        expect(c.menuButton, tag).toBeGreaterThanOrEqual(PHONE.touchMin);
        expect(l.touchMin, tag).toBeGreaterThanOrEqual(PHONE.touchMin);
        // Corners: pad on the left, big button on the right, both in the lower half.
        expect(c.dpad.x + c.dpad.w / 2, tag).toBeLessThan(vw * 0.3);
        expect(c.action.x + c.action.w / 2, tag).toBeGreaterThan(vw * 0.7);
        expect(c.dpad.y + c.dpad.h / 2, tag).toBeGreaterThan(vh * 0.5);
        expect(c.action.y + c.action.h / 2, tag).toBeCloseTo(c.dpad.y + c.dpad.h / 2, 6);
        // Bottom edge of the pad on the bottom of the usable area.
        expect(c.dpad.y + c.dpad.h, tag).toBeCloseTo(l.safeBottom, 6);
        // Status and menu sit between them at the bottom, below the play floor.
        expect(c.menu.y + c.menu.h, tag).toBeCloseTo(l.safeBottom, 6);
        expect(c.status.y, tag).toBeGreaterThanOrEqual(l.floorY * vh - 1);
        // Compact title row: a single touch-target high.
        expect(l.topBar.h, tag).toBeLessThanOrEqual(Math.max(PHONE.touchMin, 0.68 * PHONE.topBar) + 1e-6);
        // Dialogs use the whole usable area.
        const m = Math.max(6, base.marginX * vw);
        expect(l.modal.w, tag).toBeCloseTo(vw - Math.max(insets.left, m) - Math.max(insets.right, m), 6);
        // Anything placed `marginX` from either edge (the corner "i") clears both cut-outs.
        expect(l.marginX, tag).toBeGreaterThanOrEqual(Math.max(insets.left, insets.right, m) - 1e-9);
      }
    }
  });

  it('keeps pad and button in the display bays beside the cabinet (at most its frame is touched)', () => {
    for (const [vw, vh] of LANDSCAPE) {
      for (const insets of insetsFor(vw, vh)) {
        const l = solveLayout('mobile', base, vw, vh, insets);
        const c = l.controls!;
        const frame = Math.max(6, 0.03 * (l.machine.right - l.machine.left));
        // 19.5:9 and wider always have room; 16:9 phones may reach a few pixels over the frame bar.
        const tolerance = vw / vh >= 2 ? frame : frame + 12;
        expect(c.dpad.x + c.dpad.w, label(l)).toBeLessThanOrEqual(l.machine.left + tolerance);
        expect(c.action.x, label(l)).toBeGreaterThanOrEqual(l.machine.right - tolerance);
        // Momo stays in the bay above the button (never over the toys in the middle).
        if (l.machine.right + 2 <= l.vw - l.insets.right - PHONE.guideMinW) expect(l.guide.x, label(l)).toBeGreaterThanOrEqual(l.machine.right);
        expect(l.guide.place).toBe('side');
        expect(l.guide.h, label(l)).toBeGreaterThan(36);
      }
    }
  });

  it('keeps the floor line where the 3D window can put it', () => {
    for (const [vw, vh] of LANDSCAPE) {
      const l = solveLayout('mobile', base, vw, vh, NO_INSETS);
      const lim = floorLimits(vw, vh);
      expect(l.floorY).toBeGreaterThanOrEqual(lim.min - 1e-9);
      expect(l.floorY).toBeLessThanOrEqual(lim.max + 1e-9);
    }
  });

  it('mirrors everything for left-handed players', () => {
    const r = solveLayout('mobile', base, 852, 393, NO_INSETS);
    const l = solveLayout('mobile', { ...base, handedness: 'left' }, 852, 393, NO_INSETS);
    expect(l.controls!.dpad.x + l.controls!.dpad.w).toBeCloseTo(852 - r.controls!.dpad.x, 6);
    expect(l.controls!.action.x).toBeCloseTo(852 - (r.controls!.action.x + r.controls!.action.w), 6);
    expect(l.guide.align).toBe('left');
    expect(r.guide.align).toBe('right');
    expectPlayable(l);
    expectGuideClear(l);
  });

  it('honours the panel height setting but never pushes the pad off screen or into the title row', () => {
    for (const anchorY of [0.3, 0.5, 0.7, 0.95]) {
      const l = solveLayout('mobile', { ...base, anchorY }, 844, 390, NO_INSETS);
      expectPlayable(l, `anchor ${anchorY}`);
      expectGuideClear(l, `anchor ${anchorY}`);
    }
  });
});

describe('phone layout · upright', () => {
  it('stacks cabinet, Momo and one panel (status + menu row, pad + button row) from top to bottom', () => {
    for (const [vw, vh] of PORTRAIT) {
      for (const insets of insetsFor(vw, vh)) {
        const l = solveLayout('mobile', base, vw, vh, insets);
        const tag = label(l);
        const c = l.controls!;
        expect(l.orientation, tag).toBe('portrait');
        expect(l.panelStyle, tag).toBe('bar');
        expectPlayable(l);
        expectGuideClear(l);
        expect(l.touch, tag).toBeGreaterThanOrEqual(Math.min(vw, vh) >= 340 ? PHONE.mainMin - 1e-6 : PHONE.touchMin);
        expect(c.menuButton, tag).toBeGreaterThanOrEqual(PHONE.touchMin);
        // Docked at the bottom of the usable area.
        expect(l.panel.y + l.panel.h, tag).toBeCloseTo(l.safeBottom, 6);
        // Momo directly above the panel, the floor line above Momo: no toy behind either.
        expect(l.guide.place, tag).toBe('abovePanel');
        expect(l.guide.y + l.guide.maxH, tag).toBeLessThanOrEqual(l.panel.y + EPS);
        if (vw >= 340) {
          expect(l.adjusted, tag).toBe(false);
          expect(l.floorY * vh, tag).toBeLessThanOrEqual(l.guide.y + EPS);
        }
        // The cabinet gets the top of the screen: the floor line is at least as low as the gantry needs.
        expect(l.floorY, tag).toBeGreaterThanOrEqual(floorLimits(vw, vh).min - 1e-9);
        // The panel never takes more than about half of the screen.
        expect(l.panel.h / vh, tag).toBeLessThan(0.5);
        // Pad left, button right, on the same row.
        expect(c.dpad.x, tag).toBeLessThan(c.action.x);
        expect(c.action.y + c.action.h / 2, tag).toBeCloseTo(c.dpad.y + c.dpad.h / 2, 6);
      }
    }
  });

  it('turning the phone keeps the same design unit range and button sizes of the same order', () => {
    for (const [vw, vh] of [
      [852, 393],
      [915, 412],
      [667, 375],
    ] as const) {
      const side = solveLayout('mobile', base, vw, vh, NO_INSETS);
      const up = solveLayout('mobile', base, vh, vw, NO_INSETS);
      expect(side.unit).toBeCloseTo(up.unit, 9);
      expect(Math.abs(side.touch - up.touch) / side.touch).toBeLessThan(0.15);
    }
  });
});

describe('phone layout · setting extremes', () => {
  const variants: Partial<LayoutSettings>[] = [];
  for (const uiScale of [0.4, 0.7, 1, 1.4, 1.8])
    for (const touchSize of [56, 100, 140, 180]) for (const fontScale of [0.75, 1, 1.6]) variants.push({ uiScale, touchSize, fontScale });
  for (const margin of [0, 0.05, 0.15]) variants.push({ marginX: margin, marginY: margin });
  for (const panelWidth of [0.3, 0.6, 1]) variants.push({ panelWidth });
  variants.push({ safeTop: 0.2, safeBottom: 0.9 }, { safeTop: 0.5, safeBottom: 0.55 });

  it('never makes a touch target smaller than 44 px, never overlaps controls, stays on screen (auto-fit on)', () => {
    let checked = 0;
    for (const [vw, vh] of [...LANDSCAPE, ...PORTRAIT]) {
      for (const v of variants) {
        const insets = insetsFor(vw, vh);
        const l = solveLayout('mobile', { ...base, ...v, autoFit: true }, vw, vh, insets[insets.length - 1]!);
        expect(l.touch, label(l, JSON.stringify(v))).toBeGreaterThanOrEqual(PHONE.touchMin - 1e-9);
        expect(l.controls!.menuButton).toBeGreaterThanOrEqual(PHONE.touchMin);
        expect(l.touchMin).toBeGreaterThanOrEqual(PHONE.touchMin);
        // Tiny screens with huge settings may not fit side by side at all; everything else must.
        if (Math.min(vw, vh) >= 340 && !(vw < vh && (v.panelWidth ?? 1) < 0.9)) {
          expectPlayable(l, JSON.stringify(v));
          expectGuideClear(l, JSON.stringify(v));
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1500);
  });

  it('reports a squeeze that changes what the player asked for', () => {
    const huge = solveLayout('mobile', { ...base, touchSize: 180, uiScale: 1.8 }, 844, 390, NO_INSETS);
    expect(huge.adjusted).toBe(true);
    expect(huge.touch).toBeLessThan(180 * huge.unit);
    const normal = solveLayout('mobile', base, 844, 390, NO_INSETS);
    expect(normal.adjusted).toBe(false);
  });

  it('auto-fit off takes the sizes literally (still never below 44 px)', () => {
    const l = solveLayout('mobile', { ...base, autoFit: false, touchSize: 56, uiScale: 0.4 }, 844, 390, NO_INSETS);
    expect(l.touch).toBe(PHONE.touchMin);
    const big = solveLayout('mobile', { ...base, autoFit: false, touchSize: 120 }, 844, 390, NO_INSETS);
    expect(big.touch).toBeCloseTo(120 * big.unit, 9);
  });
});

/** Height of Momo's block as hud.css draws it with the solver's line count (bubble lines + padding). */
function guideContent(l: HudLayout): number {
  if (l.guide.hidden) return 0;
  const u = l.unit;
  const fs = l.fontScale;
  const short = l.orientation === 'landscape' && l.vh <= PHONE.shortHeight;
  const momo = Math.max(PHONE.touchMin, u * (l.orientation === 'portrait' ? PHONE.momoRow : short ? PHONE.momoShort : PHONE.momo));
  const n = l.guide.lines ?? 0;
  const bubble = n > 0 ? n * PHONE.bubbleLine * u * fs + PHONE.bubblePad * u + 1 : 0;
  if (l.orientation === 'landscape' && !short) return momo + (n > 0 ? PHONE.guideGap * u + bubble : 0);
  return Math.max(momo, bubble);
}

describe('phone layout · Momo never grows into a control', () => {
  it('shows fewer whole bubble lines (or hides the block) when the layout is squeezed', () => {
    const sizes = [...LANDSCAPE, ...PORTRAIT, [560, 331], [600, 340], [400, 400], [500, 500]] as [number, number][];
    const variants: Partial<LayoutSettings>[] = [{}, { fontScale: 0.75 }, { fontScale: 1.3 }, { fontScale: 1.6 }, { uiScale: 1.4 }, { anchorY: 0.5 }, { anchorY: 0.3 }, { handedness: 'left', fontScale: 1.6 }];
    for (const [vw, vh] of sizes) {
      for (const v of variants) {
        const l = solveLayout('mobile', { ...base, ...v }, vw, vh, NO_INSETS);
        const tag = label(l, JSON.stringify(v));
        // The content (Momo + the bubble lines hud.css allows) fits the block the solver kept clear.
        expect(guideContent(l), tag).toBeLessThanOrEqual(l.guide.h + 1.5);
        expect(l.guide.lines, tag).toBeGreaterThanOrEqual(0);
        if (!l.guide.hidden) expectGuideClear(l, JSON.stringify(v));
      }
    }
  });

  it('keeps the full bubble on real phones at the default and a raised font scale', () => {
    for (const [vw, vh] of [...LANDSCAPE, ...PORTRAIT]) {
      for (const fontScale of [1, 1.15]) {
        const l = solveLayout('mobile', { ...base, fontScale }, vw, vh, NO_INSETS);
        const full = l.orientation === 'landscape' && vh > PHONE.shortHeight ? 3 : 2;
        expect(l.guide.hidden, label(l)).toBe(false);
        expect(l.guide.lines, label(l, `fs ${fontScale}`)).toBe(full);
      }
    }
    // At 1.6 the sideways bubble loses a line on 360 px tall phones instead of covering GRAB.
    const big = solveLayout('mobile', { ...base, fontScale: 1.6 }, 863, 360, NO_INSETS);
    expect(big.guide.lines).toBe(2);
    expect(guideContent(big)).toBeLessThanOrEqual(big.guide.h + 1.5);
  });

  it('agrees with hud.css about orientation (a square viewport is upright)', () => {
    expect(solveLayout('mobile', base, 450, 450, NO_INSETS).orientation).toBe('portrait');
    expect(solveLayout('mobile', base, 451, 450, NO_INSETS).orientation).toBe('landscape');
  });
});

describe('phone layout · units and other presets', () => {
  it('derives the unit from the short side, clamped to the phone range', () => {
    expect(solveLayout('mobile', base, 852, 393, NO_INSETS).unit).toBeCloseTo(393 / 600, 9);
    expect(solveLayout('mobile', base, 802, 293, NO_INSETS).unit).toBeCloseTo(PHONE.unitMin, 9);
    expect(solveLayout('mobile', base, 1920, 1080, NO_INSETS).unit).toBeCloseTo(PHONE.unitMax, 9);
  });

  it('is independent of the desktop preset (its own layout values)', () => {
    const d = defaultSettings().profiles;
    expect(d.mobile.layout).not.toEqual(d.desktop.layout);
    const m = solveLayout('mobile', d.mobile.layout, 844, 390, NO_INSETS);
    const k = solveLayout('desktop', d.desktop.layout, 844, 390, NO_INSETS);
    expect(m.touch).toBeGreaterThan(k.touch * 1.5);
    expect(k.controls).toBeNull();
  });
});

describe('guessProfile · phones', () => {
  it('suggests the phone preset for touch viewports of real phones, either way up', () => {
    for (const [vw, vh] of [...LANDSCAPE, ...PORTRAIT]) expect(guessProfile(vw, vh, true), `${vw}x${vh}`).toBe('mobile');
    // The same sizes with a mouse are a small desktop window.
    expect(guessProfile(844, 390, false)).toBe('desktop');
    // A tablet is not a phone.
    expect(guessProfile(1024, 768, true)).toBe('desktop');
    expect(guessProfile(768, 1024, true)).toBe('portrait32');
  });
});
