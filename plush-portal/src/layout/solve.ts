import type { DisplayProfileId } from '../core/types';
import type { LayoutSettings } from '../settings/spec';

/** Reference design sizes: all HUD measurements are authored in these units. */
export const DESIGN = {
  desktop: { w: 1920, h: 1080 },
  portrait32: { w: 1080, h: 1920 },
  portrait86: { w: 1080, h: 1920 },
} as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HudLayout {
  profile: DisplayProfileId;
  /** Viewport in CSS pixels. */
  vw: number;
  vh: number;
  /** CSS pixels per design unit, UI scale included. */
  unit: number;
  /** Minimum touch target in CSS pixels. */
  touch: number;
  fontScale: number;
  /** Interactive safe zone in CSS pixels. */
  safeTop: number;
  safeBottom: number;
  marginX: number;
  marginY: number;
  /** Main control panel (direction pad, grab, start / again, compact menu). */
  panel: Rect;
  /** split = pad and grab button in the two lower corners (desktop); bar = one centred panel. */
  panelStyle: 'split' | 'bar';
  /** Area in which dialogs must stay (they scroll inside). */
  modal: Rect;
  /** Where the title / chips row sits. */
  topBar: Rect;
  /** Mascot + speech bubble block. */
  guide: { x: number; y: number; w: number; h: number; align: 'left' | 'right'; place: 'belowPanel' | 'abovePanel' | 'side' };
  handed: 'left' | 'right';
  density: LayoutSettings['hudDensity'];
  showGuides: boolean;
  /** Normalised Y of the 3D play floor's front edge that the scene should use. */
  floorY: number;
  /** True when the solver had to shrink / move something to keep it reachable. */
  adjusted: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Computes the HUD geometry for a viewport and a display preset. Everything
 * the player must touch ends up inside the interactive safe zone; the 3D
 * scene gets a floor line that keeps the toys above the control panel.
 */
export function solveLayout(profile: DisplayProfileId, s: LayoutSettings, vw: number, vh: number): HudLayout {
  const design = DESIGN[profile];
  const landscape = vw > vh * 1.05;
  // Design units are based on the short reference side so a resized window scales smoothly.
  const base = profile === 'desktop' ? Math.min(vw / design.w, vh / design.h) : vw / design.w;
  let uiScale = s.uiScale;
  let adjusted = false;
  let unit = base * uiScale;
  const marginX = s.marginX * vw;
  const marginY = s.marginY * vh;
  let safeTop = s.safeTop * vh;
  let safeBottom = s.safeBottom * vh;
  if (safeBottom - safeTop < vh * 0.3) {
    safeTop = Math.max(0, vh * 0.35);
    safeBottom = Math.min(vh, vh * 0.65);
    adjusted = true;
  }
  const zoneH = safeBottom - safeTop;

  const style: HudLayout['panelStyle'] = profile === 'desktop' || landscape ? 'split' : 'bar';
  const panelUnits = (touchUnits: number) => (style === 'bar' ? touchUnits * 3.25 + 96 : touchUnits * 3.1 + 40);
  let touchUnits = s.touchSize;
  let panelH = panelUnits(touchUnits) * unit;
  // Keep the panel inside the safe zone (and leave room for the toys above it).
  const maxPanelH = Math.min(zoneH * (style === 'bar' ? 0.62 : 0.5), vh * 0.4);
  if (s.autoFit && panelH > maxPanelH) {
    const k = maxPanelH / panelH;
    uiScale *= k;
    unit = base * uiScale;
    panelH = maxPanelH;
    adjusted = true;
  }
  let panelW = clamp(s.panelWidth * vw, Math.min(vw, 300 * base), vw - 2 * marginX);
  if (style === 'bar') {
    // The bar never needs to be wider than its content.
    const contentW = (touchUnits * 3.1 + touchUnits * 2.4 + 140) * unit;
    if (s.autoFit && contentW > panelW) {
      const k = panelW / contentW;
      uiScale *= k;
      unit = base * uiScale;
      panelH *= k;
      adjusted = true;
    }
  }
  let panelY = s.anchorY * vh - panelH / 2;
  const minY = safeTop + marginY * 0.5;
  const maxY = safeBottom - marginY * 0.5 - panelH;
  if (panelY < minY || panelY > maxY) {
    const moved = clamp(panelY, minY, Math.max(minY, maxY));
    // Sub-percent nudges are not worth telling the player about.
    if (Math.abs(moved - panelY) > vh * 0.01) adjusted = true;
    panelY = moved;
  }
  const panel: Rect = { x: (vw - panelW) / 2, y: panelY, w: panelW, h: panelH };
  void touchUnits;
  touchUnits = s.touchSize;

  // Dialogs: centred in the safe zone, scrolling inside.
  const modalMargin = Math.max(12, marginY);
  const modalW = Math.min(vw - 2 * Math.max(12, marginX), (profile === 'desktop' ? 1180 : 960) * base * Math.max(0.85, Math.min(1.15, uiScale + 0.25)));
  const modalTop = safeTop + (zoneH < vh * 0.98 ? modalMargin * 0.4 : modalMargin);
  const modalBottom = safeBottom - (zoneH < vh * 0.98 ? modalMargin * 0.4 : modalMargin);
  const modal: Rect = { x: (vw - modalW) / 2, y: modalTop, w: modalW, h: Math.max(200, modalBottom - modalTop) };

  const topBar: Rect = { x: marginX, y: Math.max(marginY, 10), w: vw - 2 * marginX, h: 96 * unit };

  // Guide (mascot + bubble): never over the toys. Central-zone layouts put it just under the panel,
  // bottom-docked layouts just above it, split layouts beside the play field.
  const guideH = 118 * unit;
  const guideAlign: 'left' | 'right' = s.handedness === 'right' ? 'left' : 'right';
  let guideW: number;
  let guideX: number;
  let guideY: number;
  let guidePlace: HudLayout['guide']['place'];
  if (style === 'split') {
    guidePlace = 'side';
    guideW = Math.min(vw * 0.25, 520 * unit);
    guideX = guideAlign === 'left' ? marginX : vw - marginX - guideW;
    guideY = topBar.y + topBar.h + 18 * unit;
  } else {
    guideW = Math.min(panel.w, vw - 2 * marginX);
    guideX = (vw - guideW) / 2;
    const below = panel.y + panel.h + 10 * unit;
    if (zoneH < vh * 0.9 && below + guideH <= safeBottom) {
      guidePlace = 'belowPanel';
      guideY = below;
    } else {
      guidePlace = 'abovePanel';
      guideY = Math.max(safeTop, panel.y - guideH - 10 * unit);
    }
  }

  // 3D floor line: stays above the control panel when auto-fit is on.
  let floorY = s.floorY;
  if (s.autoFit && style === 'bar') {
    const clearTop = guidePlace === 'abovePanel' ? guideY : panel.y;
    floorY = Math.min(floorY, (clearTop - 14 * unit) / vh);
  }
  floorY = clamp(floorY, 0.28, 0.86);

  return {
    profile,
    vw,
    vh,
    unit,
    touch: s.touchSize * unit,
    fontScale: s.fontScale,
    safeTop,
    safeBottom,
    marginX,
    marginY,
    panel,
    panelStyle: style,
    modal,
    topBar,
    guide: { x: guideX, y: guideY, w: guideW, h: guideH, align: guideAlign, place: guidePlace },
    handed: s.handedness,
    density: s.hudDensity,
    showGuides: s.showGuides,
    floorY,
    adjusted,
  };
}

/** Suggests a preset from the viewport shape (used for the first-run chooser's default highlight). */
export function guessProfile(vw: number, vh: number): DisplayProfileId {
  if (vw >= vh) return 'desktop';
  // Portrait: very large viewports are most likely the big kiosk.
  return vw >= 1600 || vh >= 3000 ? 'portrait86' : 'portrait32';
}
