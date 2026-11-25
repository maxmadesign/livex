import type { DisplayProfileId } from '../core/types';
import { floorLimits, machineSpan } from '../perspective/windowGeometry';
import type { LayoutSettings } from '../settings/spec';
import type { FrameBox } from './frame';
import { NO_INSETS, readSafeAreaInsets, type Insets } from './safeArea';

export type { Insets } from './safeArea';

/** Reference design sizes: all HUD measurements are authored in these units. */
export const DESIGN = {
  desktop: { w: 1920, h: 1080 },
  portrait32: { w: 1080, h: 1920 },
  portrait86: { w: 1080, h: 1920 },
  /**
   * Phone, held sideways (upright it is the same size turned). The short side is 600 units, so one
   * unit is 0.56–0.68 CSS px: text comes out at 14–17 px and the main buttons at 56–68 px, which is
   * about the same physical size on every phone because a phone's CSS pixel is ~0.16 mm.
   */
  mobile: { w: 1300, h: 600 },
} as const satisfies Record<DisplayProfileId, { w: number; h: number }>;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Exact positions of the control panel's parts (phone preset; viewport coordinates, CSS px). */
export interface PanelControls {
  dpad: Rect;
  /** The big START / GRAB / PLAY AGAIN button (square box around the round button). */
  action: Rect;
  status: Rect;
  menu: Rect;
  /** Edge of one compact-menu button. */
  menuButton: number;
}

export interface HudLayout {
  profile: DisplayProfileId;
  /** Viewport in CSS pixels. */
  vw: number;
  vh: number;
  /** 'landscape' when the viewport is wider than tall. */
  orientation: 'landscape' | 'portrait';
  /** CSS pixels per design unit, UI scale included. */
  unit: number;
  /** Size of the main touch targets (one direction button) in CSS pixels. */
  touch: number;
  /** No touch target is smaller than this (CSS px). 44 on phones, otherwise the compact-menu size. */
  touchMin: number;
  fontScale: number;
  /** Interactive safe zone in CSS pixels. */
  safeTop: number;
  safeBottom: number;
  /** Side clearance in CSS px: the configured margin or the larger side cut-out, so anything placed `marginX` from an edge clears a notch. */
  marginX: number;
  marginY: number;
  /** Screen cut-outs (notch, home indicator) kept clear, CSS px. */
  insets: Insets;
  /** Main control panel (direction pad, grab, start / again, compact menu). */
  panel: Rect;
  /** split = pad and grab button in the two lower corners (desktop, phone sideways); bar = one centred panel. */
  panelStyle: 'split' | 'bar';
  /** Phone preset: where each part of the panel goes. Null on the other presets (laid out by CSS). */
  controls: PanelControls | null;
  /** Area in which dialogs must stay (they scroll inside). */
  modal: Rect;
  /** Where the title / chips row sits. */
  topBar: Rect;
  /**
   * Mascot + speech bubble block. `h` is its nominal height, `maxH` the most it may grow to without
   * reaching a control.
   */
  guide: {
    x: number;
    y: number;
    w: number;
    h: number;
    maxH: number;
    align: 'left' | 'right';
    place: 'belowPanel' | 'abovePanel' | 'side';
    /** Phones: whole speech-bubble lines that fit in the block (0 = no bubble; hud.css applies it). */
    lines?: number;
    /** Phones: not even Momo fits (extreme settings); the block is hidden instead of covering a control. */
    hidden?: boolean;
  };
  /** Horizontal span of the cabinet on screen (CSS px); the display bays are outside it. */
  machine: { left: number; right: number };
  handed: 'left' | 'right';
  density: LayoutSettings['hudDensity'];
  showGuides: boolean;
  /** Normalised Y of the 3D play floor's front edge that the scene should use. */
  floorY: number;
  /** True when the solver had to shrink / move something to keep it reachable. */
  adjusted: boolean;
  /**
   * Where this layout's viewport (`vw × vh`) sits in the browser window: the simulated 9:16 screen
   * of a portrait preset, or the whole window. Set by `solveFramed` (src/layout/frame.ts), which the
   * HUD uses; `solveLayout` itself leaves it out.
   */
  frame?: FrameBox;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Computes the HUD geometry for a viewport and a display preset. Everything
 * the player must touch ends up inside the interactive safe zone; the 3D
 * scene gets a floor line that keeps the toys above the control panel.
 * `insets` defaults to the browser's current safe-area insets (zero outside a browser), so the
 * HUD and the 3D scene, which both call this, agree.
 */
export function solveLayout(profile: DisplayProfileId, s: LayoutSettings, vw: number, vh: number, insets: Insets = readSafeAreaInsets()): HudLayout {
  if (profile === 'mobile') return solvePhone(s, vw, vh, insets);
  return solveScreen(profile, s, vw, vh, insets);
}

/* ------------------------------------------------------------- big screens */

function solveScreen(profile: Exclude<DisplayProfileId, 'mobile'>, s: LayoutSettings, vw: number, vh: number, insets: Insets): HudLayout {
  const design = DESIGN[profile];
  const desktopLike = profile === 'desktop';
  const landscape = vw > vh * 1.05;
  // Design units are based on the short reference side so a resized window scales smoothly.
  const base = desktopLike ? Math.min(vw / design.w, vh / design.h) : vw / design.w;
  let uiScale = s.uiScale;
  let adjusted = false;
  let unit = base * uiScale;
  const marginX = s.marginX * vw;
  const marginY = s.marginY * vh;
  const sideClear = Math.max(marginX, insets.left, insets.right);
  let safeTop = Math.max(s.safeTop * vh, insets.top);
  let safeBottom = Math.min(s.safeBottom * vh, vh - insets.bottom);
  if (safeBottom - safeTop < vh * 0.3) {
    safeTop = Math.max(0, vh * 0.35);
    safeBottom = Math.min(vh, vh * 0.65);
    adjusted = true;
  }
  const zoneH = safeBottom - safeTop;

  const style: HudLayout['panelStyle'] = desktopLike || landscape ? 'split' : 'bar';
  const panelUnits = (touchUnits: number) => (style === 'bar' ? touchUnits * 3.25 + 96 : touchUnits * 3.1 + 40);
  const touchUnits = s.touchSize;
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
  const panelW = clamp(s.panelWidth * vw, Math.min(vw, 300 * base), vw - 2 * sideClear);
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

  // Dialogs: centred in the safe zone, scrolling inside.
  const modalMargin = Math.max(12, marginY);
  const modalW = Math.min(vw - 2 * Math.max(12, sideClear), (desktopLike ? 1180 : 960) * base * Math.max(0.85, Math.min(1.15, uiScale + 0.25)));
  const modalTop = safeTop + (zoneH < vh * 0.98 ? modalMargin * 0.4 : modalMargin);
  const modalBottom = safeBottom - (zoneH < vh * 0.98 ? modalMargin * 0.4 : modalMargin);
  const modal: Rect = { x: (vw - modalW) / 2, y: modalTop, w: modalW, h: Math.max(200, modalBottom - modalTop) };

  const topBar: Rect = { x: sideClear, y: Math.max(marginY, 10, insets.top), w: vw - 2 * sideClear, h: 96 * unit };

  // Guide (mascot + bubble): never over the toys. Central-zone layouts put it just under the panel,
  // bottom-docked layouts just above it, split layouts beside the play field.
  const guideH = 118 * unit;
  const guideAlign: 'left' | 'right' = s.handedness === 'right' ? 'left' : 'right';
  let guideW: number;
  let guideX: number;
  let guideY: number;
  let guideMax: number;
  let guidePlace: HudLayout['guide']['place'];
  if (style === 'split') {
    guidePlace = 'side';
    guideW = Math.min(vw * 0.25, 520 * unit);
    guideX = guideAlign === 'left' ? sideClear : vw - sideClear - guideW;
    guideY = topBar.y + topBar.h + 18 * unit;
    guideMax = Math.max(guideH, panel.y - 10 * unit - guideY);
  } else {
    guideW = Math.min(panel.w, vw - 2 * marginX);
    guideX = (vw - guideW) / 2;
    const below = panel.y + panel.h + 10 * unit;
    if (zoneH < vh * 0.9 && below + guideH <= safeBottom) {
      guidePlace = 'belowPanel';
      guideY = below;
      guideMax = Math.max(guideH, safeBottom - guideY);
    } else {
      guidePlace = 'abovePanel';
      guideY = Math.max(safeTop, panel.y - guideH - 10 * unit);
      guideMax = Math.max(guideH, panel.y - 4 - guideY);
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
    orientation: vw > vh ? 'landscape' : 'portrait',
    unit,
    touch: s.touchSize * unit,
    touchMin: s.touchSize * unit * 0.62,
    fontScale: s.fontScale,
    safeTop,
    safeBottom,
    marginX: sideClear,
    marginY,
    insets: { ...insets },
    panel,
    panelStyle: style,
    controls: null,
    modal,
    topBar,
    guide: { x: guideX, y: guideY, w: guideW, h: guideH, maxH: guideMax, align: guideAlign, place: guidePlace },
    machine: machineSpan(vw, vh),
    handed: s.handedness,
    density: s.hudDensity,
    showGuides: s.showGuides,
    floorY,
    adjusted,
  };
}

/* ------------------------------------------------------------------ phones */

/**
 * Phone sizes in design units (× `unit` = CSS px). hud.css mirrors the guide / bubble limits in its
 * `.pp-root[data-profile="mobile"]` rules — change both together.
 */
export const PHONE = {
  /** Range of CSS px per design unit. */
  unitMin: 0.56,
  unitMax: 0.68,
  /** No touch target below this (CSS px; Apple HIG 44 pt, WCAG 2.5.5). */
  touchMin: 44,
  /** The main controls aim for at least this (CSS px). */
  mainMin: 56,
  /** Compact title row (design units, never under touchMin px). */
  topBar: 64,
  /** Space between control groups. */
  gap: 10,
  /** Inner padding of the upright panel. */
  pad: 12,
  /**
   * Sizes the joystick's slot: its round well is three touch sizes plus two of these gaps wide
   * (hud.css .pp-dpad), the footprint of the direction pad it replaced, so every layout keeps its slots.
   */
  dpadGap: 4,
  /** Gap between compact-menu buttons (hud.css .pp-menu gap). */
  menuGap: 12,
  /** Extra width of the collection button for its count. */
  menuCount: 30,
  /** Status pill: one line of 25-unit text plus padding (× font scale for the text part). */
  statusText: 34,
  statusPad: 10,
  /** Landscape guide: Momo above-right of a bubble of at most this height (× font scale). */
  momo: 72,
  bubble: 100,
  /** Between bubble and Momo; more than her bobbing animation (8 units) so she never bumps it. */
  guideGap: 10,
  /**
   * Landscape viewports at most this tall (CSS px) use the short tier: Momo beside a one-to-two-line
   * bubble (such screens are wide, so the bay is too).
   */
  shortHeight: 330,
  momoShort: 56,
  bubbleShort: 72,
  /** Upright guide: one row, Momo beside a two-line bubble. */
  momoRow: 72,
  bubbleRow: 62,
  /** Keep the floor line this far above whatever is below it. */
  floorClear: 14,
  /** Narrowest the landscape guide may be (CSS px) before it may reach over the cabinet frame. */
  guideMinW: 150,
  /** One bubble line (22-unit text × line height 1.25, hud.css) and the bubble's vertical padding. */
  bubbleLine: 27.5,
  bubblePad: 16,
} as const;

/** Whole bubble lines (at most `max`) that fit in `room` CSS px. */
function bubbleLines(room: number, unit: number, fs: number, max: number): number {
  const n = Math.floor((room - PHONE.bubblePad * unit + 0.5) / (PHONE.bubbleLine * unit * fs));
  return clamp(n, 0, max);
}

function solvePhone(s: LayoutSettings, vw: number, vh: number, insets: Insets): HudLayout {
  // Same test as hud.css's `(orientation: landscape)` (a square viewport is "portrait" there).
  const landscape = vw > vh;
  let adjusted = false;
  const unit = s.uiScale * clamp(Math.min(vw, vh) / DESIGN.mobile.h, PHONE.unitMin, PHONE.unitMax);
  const u = (n: number) => n * unit;
  const fs = s.fontScale;
  const marginX = Math.max(6, s.marginX * vw);
  const marginY = Math.max(6, s.marginY * vh);
  // Interactive rectangle: the viewport minus margins and cut-outs, limited by the configured zone.
  const L = Math.max(insets.left, marginX);
  const R = vw - Math.max(insets.right, marginX);
  let T = Math.max(insets.top, marginY, s.safeTop * vh);
  let B = Math.min(vh - Math.max(insets.bottom, marginY), s.safeBottom * vh);
  if (B - T < vh * 0.3) {
    T = Math.max(insets.top, marginY);
    B = vh - Math.max(insets.bottom, marginY);
    adjusted = true;
  }
  const width = R - L;
  const machine = machineSpan(vw, vh);
  const limits = floorLimits(vw, vh);
  const gap = Math.max(6, u(PHONE.gap));
  const dpadGap = u(PHONE.dpadGap);
  const topBarH = Math.max(PHONE.touchMin, u(PHONE.topBar));
  const statusH = Math.max(24, u(PHONE.statusText * fs + PHONE.statusPad));
  const menuButton = (t: number) => Math.max(PHONE.touchMin, 0.62 * t);
  const menuWidth = (t: number) => 4 * menuButton(t) + 3 * u(PHONE.menuGap) + u(PHONE.menuCount);
  const dpadSize = (t: number) => 3 * t + 2 * dpadGap;
  const actionSize = (t: number) => 2.15 * t;
  const requested = Math.max(PHONE.touchMin, s.touchSize * unit);
  const right = s.handedness === 'right';
  const topBar: Rect = { x: L, y: T, w: width, h: topBarH };
  const modal: Rect = { x: L, y: T, w: width, h: Math.max(160, B - T) };

  /**
   * Shrinks the main touch size to `limit` (auto-fit only, never under the hard minimum). Fitting the
   * buttons to the phone is the normal case; only a real squeeze is reported (see `squeezed`).
   */
  let touch = requested;
  const limitTouch = (limit: number) => {
    if (s.autoFit) touch = Math.max(PHONE.touchMin, Math.min(touch, limit));
  };
  const squeezed = () => s.autoFit && (touch < requested * 0.8 || touch < Math.min(requested, PHONE.mainMin) - 0.5);

  if (landscape) {
    // Pad in one lower corner, action button in the other, status + compact menu between them at the
    // bottom (below the play floor), Momo in the display bay above the action button.
    limitTouch((B - T - topBarH - gap - 2 * dpadGap) / 3);
    const menuMin = (t: number) => menuWidth(t) + 2 * gap;
    limitTouch((width - 2 * dpadGap - menuMin(touch)) / 5.15);
    if (squeezed()) adjusted = true;
    // Prefer to keep the pad inside its display bay (the cabinet frame may be touched), but not at
    // the price of buttons under the size aimed for.
    const bay = right ? machine.left - L : R - machine.right;
    const frame = Math.max(6, 0.03 * (machine.right - machine.left));
    if (dpadSize(touch) > bay + frame) limitTouch(Math.max(PHONE.mainMin, (bay + frame - 2 * dpadGap) / 3));
    const t = touch;
    const D = dpadSize(t);
    const A = actionSize(t);
    const minCy = T + topBarH + gap + D / 2;
    const maxCy = B - D / 2;
    const cy = clamp(s.anchorY * vh, minCy, Math.max(minCy, maxCy));
    const dpad: Rect = { x: right ? L : R - D, y: cy - D / 2, w: D, h: D };
    const action: Rect = { x: right ? R - A : L, y: cy - A / 2, w: A, h: A };
    const x0 = (right ? dpad.x + D : action.x + A) + gap;
    const x1 = (right ? action.x : dpad.x) - gap;
    const mb = menuButton(t);
    const menuW = Math.min(menuWidth(t), Math.max(mb, x1 - x0));
    if (menuWidth(t) > x1 - x0 + 0.5) adjusted = true;
    const menu: Rect = { x: (x0 + x1) / 2 - menuW / 2, y: B - mb, w: menuW, h: mb };
    const status: Rect = { x: x0, y: menu.y - gap / 2 - statusH, w: Math.max(0, x1 - x0), h: statusH };
    const top = Math.min(dpad.y, action.y, status.y);
    const panel: Rect = { x: L, y: top, w: width, h: B - top };

    // Momo: in the action button's bay, between the title row and the button.
    const short = vh <= PHONE.shortHeight;
    // Momo is a button: never under the touch minimum (hud.css: max(44px, …)).
    const momo = Math.max(PHONE.touchMin, u(short ? PHONE.momoShort : PHONE.momo));
    const guideNeed = short ? Math.max(momo, u(PHONE.bubbleShort * fs)) : momo + u(PHONE.guideGap + PHONE.bubble * fs);
    const bottom = action.y - gap;
    const ceiling = T + topBarH + gap;
    const guideH = Math.max(0, Math.min(guideNeed, bottom - ceiling));
    if (guideH < guideNeed - 0.5) adjusted = true;
    const bayEdge = right ? machine.right + 2 : machine.left - 2;
    const guideW = Math.min(u(440), Math.max(Math.min(PHONE.guideMinW, width / 2), right ? R - bayEdge : bayEdge - L));
    // Squeezed (large font scale, panel moved up): fewer whole bubble lines rather than a bubble that
    // grows into the big button; with no room even for Momo the block is hidden.
    const hidden = guideH + 0.5 < momo;
    const guide: HudLayout['guide'] = {
      x: right ? R - guideW : L,
      y: bottom - guideH,
      w: guideW,
      h: guideH,
      maxH: guideH,
      align: right ? 'right' : 'left',
      place: 'side',
      lines: hidden ? 0 : bubbleLines(short ? guideH : guideH - momo - u(PHONE.guideGap), unit, fs, short ? 2 : 3),
      hidden,
    };
    return {
      profile: 'mobile',
      vw,
      vh,
      orientation: 'landscape',
      unit,
      touch: t,
      touchMin: Math.min(t, PHONE.touchMin),
      fontScale: fs,
      safeTop: T,
      safeBottom: B,
      marginX: Math.max(marginX, insets.left, insets.right),
      marginY,
      insets: { ...insets },
      panel,
      panelStyle: 'split',
      controls: { dpad, action, status, menu, menuButton: mb },
      modal,
      topBar,
      guide,
      machine,
      handed: s.handedness,
      density: s.hudDensity,
      showGuides: s.showGuides,
      floorY: clamp(s.floorY, limits.min, limits.max),
      adjusted,
    };
  }

  // Upright phone: like the 32" kiosk scaled down — cabinet above, one solid panel along the bottom
  // with the status and compact menu in its top row, Momo in a single row just above it.
  const pad = u(PHONE.pad);
  const panelW = clamp(s.panelWidth * vw, Math.min(width, 280), width);
  const inner = panelW - 2 * pad;
  limitTouch((inner - 2 * gap - 2 * dpadGap) / 5.15);
  const mbFor = menuButton(touch);
  const sharedRow = menuWidth(touch) + gap + 96 <= inner;
  const topRowH = sharedRow ? Math.max(mbFor, statusH) : statusH;
  const extraRowH = sharedRow ? 0 : gap + mbFor;
  const guideH = Math.max(PHONE.touchMin, u(PHONE.momoRow), u(PHONE.bubbleRow * fs + 20));
  // Leave room for the cabinet between the title row and Momo: the gantry needs the floor line at
  // least `limits.min` down the screen.
  const floorMinPx = limits.min * vh;
  const room = B - (floorMinPx + u(PHONE.floorClear) + guideH + gap);
  const fixed = 2 * pad + topRowH + gap + extraRowH + 2 * dpadGap;
  limitTouch((Math.min(room, vh * 0.45) - fixed) / 3);
  if (squeezed()) adjusted = true;
  const t = touch;
  const mb = menuButton(t);
  const D = dpadSize(t);
  const A = actionSize(t);
  const panelH = 2 * pad + topRowH + gap + D + extraRowH;
  const minY = T + topBarH + gap;
  const maxY = B - panelH;
  let panelY = s.anchorY * vh - panelH / 2;
  if (panelY < minY || panelY > maxY) {
    const moved = clamp(panelY, minY, Math.max(minY, maxY));
    if (Math.abs(moved - panelY) > vh * 0.01 && s.anchorY * vh + panelH / 2 < B - vh * 0.02) adjusted = true;
    panelY = moved;
  }
  const panel: Rect = { x: (vw - panelW) / 2, y: panelY, w: panelW, h: panelH };
  const left = panel.x + pad;
  const rightEdge = panel.x + panel.w - pad;
  const mainY = panel.y + pad + topRowH + gap;
  const dpad: Rect = { x: right ? left : rightEdge - D, y: mainY, w: D, h: D };
  const action: Rect = { x: right ? rightEdge - A : left, y: mainY + D / 2 - A / 2, w: A, h: A };
  const menuW = Math.min(menuWidth(t), inner);
  let menu: Rect;
  let status: Rect;
  if (sharedRow) {
    menu = { x: right ? rightEdge - menuW : left, y: panel.y + pad + (topRowH - mb) / 2, w: menuW, h: mb };
    status = { x: right ? left : left + menuW + gap, y: panel.y + pad + (topRowH - statusH) / 2, w: inner - menuW - gap, h: statusH };
  } else {
    status = { x: left, y: panel.y + pad, w: inner, h: statusH };
    menu = { x: panel.x + (panel.w - menuW) / 2, y: mainY + D + gap, w: menuW, h: mb };
  }
  const guideY = Math.max(minY, panel.y - gap - guideH);
  const rowH = Math.max(0, panel.y - gap - guideY);
  // Momo beside a bubble of at most two lines; on a squeezed screen fewer lines, or nothing.
  const rowHidden = rowH + 0.5 < Math.max(PHONE.touchMin, u(PHONE.momoRow));
  const guide: HudLayout['guide'] = {
    x: L,
    y: guideY,
    w: width,
    h: rowH,
    maxH: rowH,
    align: right ? 'left' : 'right',
    place: 'abovePanel',
    lines: rowHidden ? 0 : bubbleLines(rowH, unit, fs, 2),
    hidden: rowHidden,
  };
  let floorY = s.floorY;
  if (s.autoFit) floorY = (guide.y - u(PHONE.floorClear)) / vh;
  floorY = clamp(floorY, limits.min, limits.max);
  if (floorY * vh > guide.y + 1) adjusted = true;
  return {
    profile: 'mobile',
    vw,
    vh,
    orientation: 'portrait',
    unit,
    touch: t,
    touchMin: Math.min(t, PHONE.touchMin),
    fontScale: fs,
    safeTop: T,
    safeBottom: B,
    marginX: Math.max(marginX, insets.left, insets.right),
    marginY,
    insets: { ...insets },
    panel,
    panelStyle: 'bar',
    controls: { dpad, action, status, menu, menuButton: mb },
    modal,
    topBar,
    guide,
    machine,
    handed: s.handedness,
    density: s.hudDensity,
    showGuides: s.showGuides,
    floorY,
    adjusted,
  };
}

/* --------------------------------------------------------------- detection */

/** True when the primary pointer is a finger (touch screen), as far as the browser can tell. */
export function hasCoarsePointer(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Largest short viewport side (CSS px) that is still treated as a phone. */
export const PHONE_MAX_SHORT_SIDE = 500;

/**
 * Suggests a preset from the viewport shape (used for the first-run chooser's default highlight).
 * `coarse` = the primary pointer is a finger; a touch viewport whose short side is at most
 * PHONE_MAX_SHORT_SIDE CSS px is a phone.
 */
export function guessProfile(vw: number, vh: number, coarse: boolean = hasCoarsePointer()): DisplayProfileId {
  if (coarse && Math.min(vw, vh) <= PHONE_MAX_SHORT_SIDE) return 'mobile';
  if (vw >= vh) return 'desktop';
  // Portrait: very large viewports are most likely the big kiosk.
  return vw >= 1600 || vh >= 3000 ? 'portrait86' : 'portrait32';
}

export { NO_INSETS };
