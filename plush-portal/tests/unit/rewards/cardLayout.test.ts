import { describe, expect, it } from 'vitest';
import type { DisplayProfileId } from '../../../src/core/types';
import { solveFramed } from '../../../src/layout/frame';
import { NO_INSETS, solveLayout, type HudLayout, type Rect } from '../../../src/layout/solve';
import { CARD, QR_MIN_M, QR_MIN_PX, cardBounds, codeRowWidth, compactPoints, overlaps, screenWidthMetres, winCardGeometry, type RewardCardKind, type WinCardInput } from '../../../src/rewards/cardLayout';
import { defaultSettings } from '../../../src/settings/spec';
import { placePopup, popupBox } from '../../../src/ui/ScoreHud';

const settings = defaultSettings();
const EPS = 0.5;

interface Case {
  label: string;
  profile: DisplayProfileId;
  vw: number;
  vh: number;
  /** A portrait preset simulated in a window of another shape (Settings → Layout). */
  simulated?: boolean;
}

const CASES: Case[] = [
  { label: 'desktop 1280×720', profile: 'desktop', vw: 1280, vh: 720 },
  { label: 'desktop 1920×1080', profile: 'desktop', vw: 1920, vh: 1080 },
  { label: 'desktop 1024×600', profile: 'desktop', vw: 1024, vh: 600 },
  { label: '32" 1080×1920', profile: 'portrait32', vw: 1080, vh: 1920 },
  { label: '32" 2160×3840', profile: 'portrait32', vw: 2160, vh: 3840 },
  { label: '86" 1080×1920', profile: 'portrait86', vw: 1080, vh: 1920 },
  { label: '86" 2160×3840', profile: 'portrait86', vw: 2160, vh: 3840 },
  { label: '32" simulated in 1280×720', profile: 'portrait32', vw: 1280, vh: 720, simulated: true },
  { label: '86" simulated in 1280×720', profile: 'portrait86', vw: 1280, vh: 720, simulated: true },
  { label: 'phone 844×390', profile: 'mobile', vw: 844, vh: 390 },
  { label: 'phone 667×320', profile: 'mobile', vw: 667, vh: 320 },
  { label: 'phone 390×844 (upright)', profile: 'mobile', vw: 390, vh: 844 },
];

function layoutFor(c: Case): HudLayout {
  const layout = settings.profiles[c.profile].layout;
  if (c.simulated) return solveFramed(c.profile, layout, c.vw, c.vh, NO_INSETS);
  return solveLayout(c.profile, layout, c.vw, c.vh, NO_INSETS);
}

function metres(c: Case, l: HudLayout): number | null {
  return screenWidthMetres(c.profile, settings.profiles[c.profile].view, { vw: l.vw, vh: l.vh }, !!c.simulated);
}

/** Everything the card must not cover: the control panel's parts (or the whole bar), and Momo above a bar. */
function controls(l: HudLayout): Rect[] {
  if (l.controls) return [l.controls.dpad, l.controls.action, l.controls.status, l.controls.menu];
  if (l.panelStyle === 'bar') return l.guide.place === 'abovePanel' ? [l.panel, l.guide] : [l.panel];
  // Split panel: the pad / button corners and the status + menu cluster at its bottom.
  const cluster = (25 * 1.3 + 18) * l.unit + l.touch * 0.62;
  return [{ x: l.panel.x, y: l.panel.y + l.panel.h - cluster, w: l.panel.w, h: cluster }];
}

const INPUTS: { label: string; input: Omit<WinCardInput, 'screenWidthM'> }[] = [];
for (const kind of ['none', 'qr', 'note'] as RewardCardKind[]) {
  for (const withPoints of [false, true]) {
    INPUTS.push({ label: `${kind}${withPoints ? ' + points' : ''}`, input: { kind, withPoints, pointRows: 4, ribbon: withPoints, countLine: !withPoints } });
  }
}
INPUTS.push({ label: 'qr + points + DEMO label + 5 rows', input: { kind: 'qr', withPoints: true, pointRows: 5, label: true, ribbon: true, countLine: true } });

describe('win card geometry', () => {
  for (const c of CASES) {
    describe(c.label, () => {
      const l = layoutFor(c);
      const m = metres(c, l);
      for (const { label, input } of INPUTS) {
        it(`${label}: inside the safe zone, clear of the controls${input.kind === 'qr' ? ', QR big enough' : ''}`, () => {
          const g = winCardGeometry(l, { ...input, screenWidthM: m });
          expect(g.fits, 'fits its bounds').toBe(true);
          expect(g.y).toBeGreaterThanOrEqual(l.safeTop - EPS);
          expect(g.y + g.h).toBeLessThanOrEqual(l.safeBottom + EPS);
          expect(g.x).toBeGreaterThanOrEqual(-EPS);
          expect(g.x + g.w).toBeLessThanOrEqual(l.vw + EPS);
          // The ribbon sticks out above the card: still inside the zone.
          if (input.ribbon) expect(g.y - 26 * l.unit).toBeGreaterThanOrEqual(l.safeTop - EPS);
          for (const r of controls(l)) expect(overlaps(g, r), `covers a control at ${JSON.stringify(r)}`).toBe(false);
          expect(g.scale).toBeGreaterThanOrEqual(0.5);
          if (input.kind !== 'qr') {
            expect(g.qrPx).toBe(0);
            return;
          }
          if (l.controls) {
            // A phone cannot scan its own screen: a claim link instead of the QR.
            expect(g.kind).toBe('link');
            expect(g.qrPx).toBe(0);
            expect(compactPoints(l, g.kind)).toBe(true);
            return;
          }
          expect(g.kind).toBe('qr');
          expect(g.qrPx, 'at least 160 CSS px').toBeGreaterThanOrEqual(QR_MIN_PX);
          if (c.profile === 'portrait32' || c.profile === 'portrait86') {
            const widthM = (g.qrPx / l.vw) * m!;
            expect(widthM, 'at least 8 cm on the kiosk').toBeGreaterThanOrEqual(QR_MIN_M - 1e-6);
          }
          // The QR fits inside the card.
          expect(g.qrPx).toBeLessThanOrEqual(Math.min(g.w, g.h));
        });
      }
    });
  }

  it('portrait kiosks know their physical width; the 8 cm rule wins over 160 px on the 32" panel', () => {
    const p32 = layoutFor(CASES.find((c) => c.label === '32" 1080×1920')!);
    const g = winCardGeometry(p32, { kind: 'qr', withPoints: true, screenWidthM: 0.398 });
    expect(g.qrMinPx).toBe(Math.ceil((0.08 / 0.398) * 1080));
    expect(g.qrMinPx).toBeGreaterThan(QR_MIN_PX);
    expect(screenWidthMetres('desktop', settings.profiles.desktop.view, { vw: 1280, vh: 720 }, false)).toBeNull();
    // A portrait preset in a browser window: metres per CSS px from the screen's CSS size.
    const windowed = screenWidthMetres('portrait32', { screenW: 0.398, screenH: 0.708, windowMode: 'window' }, { vw: 540, vh: 960 }, false, { w: 1080, h: 1920 });
    expect(windowed).toBeCloseTo((0.708 / 1920) * 540, 6);
  });

  it('phone 844×390: the card ends above the status and menu row (it used to cover the menu by about 9 px)', () => {
    const l = layoutFor(CASES.find((c) => c.label === 'phone 844×390')!);
    for (const { input } of INPUTS) {
      const g = winCardGeometry(l, { ...input, screenWidthM: null });
      expect(g.y + g.h).toBeLessThanOrEqual(Math.min(l.controls!.status.y, l.controls!.menu.y) - 6 + EPS);
      expect(g.x).toBeGreaterThanOrEqual(l.controls!.dpad.x + l.controls!.dpad.w);
      expect(g.x + g.w).toBeLessThanOrEqual(l.controls!.action.x);
    }
  });

  it('side arrangement: the QR column is as wide as the code row under the tile (it stuck out of the 1280×720 card by 8 px)', () => {
    let checked = 0;
    for (const c of CASES) {
      const l = layoutFor(c);
      for (const { input } of INPUTS) {
        if (input.kind !== 'qr') continue;
        const g = winCardGeometry(l, { ...input, screenWidthM: metres(c, l) });
        if (g.arrangement !== 'side') continue;
        const k = l.unit * g.scale;
        const column = g.w - k * (2 * CARD.padX + CARD.sideLeft + CARD.sideGap);
        expect(column + EPS, `${c.label}`).toBeGreaterThanOrEqual(codeRowWidth(k, l.fontScale));
        expect(column + EPS).toBeGreaterThanOrEqual(g.qrPx);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    // The desktop 1280×720 card of the e2e run: about 240 CSS px of code row beside a 167 px tile.
    const desk = layoutFor(CASES[0]!);
    const g = winCardGeometry(desk, { kind: 'qr', withPoints: true, pointRows: 4, ribbon: true, screenWidthM: null });
    expect(g.arrangement).toBe('side');
    expect(codeRowWidth(desk.unit * g.scale, desk.fontScale)).toBeGreaterThan(g.qrPx);
  });

  it("split panel: the card keeps clear of Momo's line beside the field, on either side, at its tallest", () => {
    let checked = 0;
    for (const c of CASES) {
      for (const handedness of ['right', 'left'] as const) {
        const base = layoutFor(c);
        // Phones have their own guide placement (and no room to spare): not covered by this rule.
        if (base.guide.place !== 'side' || base.controls) continue;
        const l = solveLayout(c.profile, { ...settings.profiles[c.profile].layout, handedness }, c.vw, c.vh, NO_INSETS);
        const bubble = { x: l.guide.x, y: l.guide.y, w: l.guide.w, h: l.guide.maxH };
        for (const { label, input } of INPUTS) {
          const g = winCardGeometry(l, { ...input, screenWidthM: metres(c, l) });
          expect(overlaps(g, bubble), `${c.label} ${handedness}-handed, ${label}: covers Momo's line`).toBe(false);
          expect(g.fits).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('bounds of a bar panel end above the panel and Momo', () => {
    const l = layoutFor(CASES.find((c) => c.label === '32" 1080×1920')!);
    const b = cardBounds(l);
    expect(b.y + b.h).toBeLessThanOrEqual(Math.min(l.panel.y, l.guide.y));
    expect(b.y).toBeGreaterThanOrEqual(l.topBar.y + l.topBar.h);
  });
});

describe('score popups keep clear of the win card', () => {
  for (const c of CASES) {
    it(`${c.label}: a popup anywhere ends up beside, above or not at all`, () => {
      const l = layoutFor(c);
      const g = winCardGeometry(l, { kind: 'qr', withPoints: true, screenWidthM: metres(c, l) });
      const grid = [0.1, 0.3, 0.5, 0.7, 0.9];
      for (const fx of grid) {
        for (const fy of grid) {
          const at = { x: fx * l.vw, y: fy * l.vh };
          const placed = placePopup(at, g, l);
          if (!placed) continue;
          expect(overlaps(popupBox(placed.x, placed.y, l.unit), g), `${JSON.stringify(at)} → ${JSON.stringify(placed)}`).toBe(false);
        }
      }
      // A popup that is already clear stays where it is.
      const clear = { x: g.x + g.w / 2, y: g.y + g.h + 400 * l.unit + 20 };
      if (clear.y < l.vh) expect(placePopup(clear, g, l)).toEqual(clear);
      // No card: unchanged.
      expect(placePopup({ x: 10, y: 20 }, null, l)).toEqual({ x: 10, y: 20 });
    });
  }

  it('the 1280×720 desktop exit (left of centre) moves beside the card, not on top of it', () => {
    const l = layoutFor(CASES[0]!);
    const g = winCardGeometry(l, { kind: 'qr', withPoints: true, screenWidthM: null });
    const at = { x: g.x + g.w * 0.3, y: g.y + g.h * 0.6 };
    const placed = placePopup(at, g, l)!;
    expect(placed).not.toBeNull();
    expect(placed.x).toBeLessThan(g.x);
  });
});
