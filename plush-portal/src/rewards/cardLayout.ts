/**
 * Geometry of the win card (src/ui/Hud.tsx ResultLayer) with or without the prize-claim block.
 *
 * Pure: the card's box is computed from the HUD layout and a content model in design units that
 * src/ui/reward.css follows (fixed line heights and gaps), so the card can be placed before it is
 * drawn, the score can step aside (src/ui/ScoreHud.tsx) and tests can check every layout.
 *
 * Rules
 *  - The card stays inside the interactive safe zone and never covers the control panel: above a
 *    bar panel (and Momo when he sits above it), above the status / menu row of a split panel, and
 *    between the phone's direction pad and its big button.
 *  - The QR tile (quiet zone included) is at least 160 CSS px everywhere and at least 8 cm wide on
 *    the portrait kiosks (from the preset's physical screen size). The rest of the card shrinks
 *    first; the QR never goes below its minimum.
 *  - Phones show no QR (the player holds the screen and cannot scan it): a link and the code instead.
 */
import type { DisplayProfileId } from '../core/types';
import type { HudLayout, Rect } from '../layout/solve';

/** What the reward part of the card shows. */
export type RewardCardKind =
  | 'none' // plain win card
  | 'qr' // QR tile (a real code, a demo-build code, the settings preview, or the issuing placeholder)
  | 'link' // phone: claim link button and the code, no QR
  | 'note'; // a code was wanted but is unavailable: one honest line

export type CardArrangement = 'column' | 'side' | 'phone';

export interface WinCardInput {
  /** The points breakdown is shown. */
  withPoints: boolean;
  /** Rows of the breakdown including the total (2–5). */
  pointRows?: number;
  /** "You now have N" line. */
  countLine?: boolean;
  kind: RewardCardKind;
  /** A DEMO / PREVIEW label above the QR / the claim link. */
  label?: boolean;
  /** The NEW BEST ribbon sticks out above the card. */
  ribbon?: boolean;
  /** Physical width of the screen the layout fills (metres), when known; null elsewhere. */
  screenWidthM?: number | null;
}

export interface WinCardGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Multiplies the layout unit for the card's own `--u`. */
  scale: number;
  arrangement: CardArrangement;
  /** Edge of the QR tile in CSS px (0 = no QR). */
  qrPx: number;
  /** The smallest QR this layout allows (CSS px). */
  qrMinPx: number;
  /** Where the card may be (safe zone minus the controls). */
  bounds: Rect;
  /** True when the card fits its bounds (false only for impossible settings, e.g. a tiny window). */
  fits: boolean;
  /** The reward part actually drawn (a phone gets 'link' instead of 'qr'). */
  kind: RewardCardKind;
}

/** Content model in design units; src/ui/reward.css uses the same numbers. */
export const CARD = {
  padTop: 26,
  padBottom: 30,
  padX: 40,
  gap: 12,
  /** "NEW BEST" ribbon sticking out above the card. */
  ribbon: 26,
  title: 62,
  portrait: 300,
  portraitPoints: 210,
  portraitSide: 230,
  portraitSidePoints: 170,
  subtitle: 34,
  count: 28,
  pointsTier: 36,
  pointsRow: 33,
  pointsTotal: 46,
  /** 3D edge under the PLAY AGAIN button (its face is the touch size, not scaled). */
  buttonDepth: 9,
  width: 560,
  /** Left column of the side arrangement and the gap to the QR column. */
  sideLeft: 440,
  sideGap: 36,
  /** Narrowest reward block (the instruction must not become a word per line). */
  rewardMinW: 300,
  /** Narrowest QR column of the side arrangement (the code row under the tile). */
  codeMinW: 240,
  /**
   * The code row as reward.css draws it: XXXX-XXXX (9 characters at 40 units, letter spacing
   * 0.08 em), a 14 unit gap and the 56 unit countdown ring. A character advances about 0.8 em in
   * the bold display fonts (measured: 288 units for WJGR-25WS); 0.84 leaves room for wide letters.
   */
  codeChars: 9,
  codeFont: 40,
  codeAdvance: 0.84,
  codeGap: 14,
  ring: 56,
  /** Reward block: gap above the tile, instruction lines, code row (with the countdown ring), label. */
  tileGap: 12,
  instrLine: 30,
  instrLines: 2,
  codeRow: 60,
  label: 36,
  /** Unavailable note: up to two lines. */
  noteLines: 2,
  /** Phone (sideways grid): picture column, padding, title, one text line, the code row. */
  phonePicture: 170,
  phonePadY: 18,
  phonePadX: 26,
  phoneColGap: 20,
  phoneGap: 8,
  phoneTitle: 50,
  phoneLine: 32,
  phoneCode: 44,
  phoneTextMinW: 330,
} as const;

/** The portrait shrinks to this fraction in the column arrangement when a reward block is added. */
const PORTRAIT_WITH_REWARD = 0.72;

/** Edge of the plush portrait in design units for an arrangement. */
export function portraitUnits(arrangement: CardArrangement, withPoints: boolean, kind: RewardCardKind): number {
  if (arrangement === 'phone') return CARD.phonePicture;
  if (arrangement === 'side') return withPoints ? CARD.portraitSidePoints : CARD.portraitSide;
  return (withPoints ? CARD.portraitPoints : CARD.portrait) * (kind === 'none' || kind === 'link' ? 1 : PORTRAIT_WITH_REWARD);
}

/**
 * Phones next to a claim code show one compact points line instead of the breakdown: the code and
 * its link need the room more.
 */
export function compactPoints(layout: Pick<HudLayout, 'controls'>, kind: RewardCardKind): boolean {
  return layout.controls !== null && kind !== 'none';
}

/** Lines the "joins your collection" subtitle may take (narrow columns wrap long names). */
export function subtitleLines(arrangement: CardArrangement): number {
  return arrangement === 'column' ? 1 : 2;
}
/** QR design size per preset (design units) before the minimums apply. */
const QR_DESIGN: Record<DisplayProfileId, number> = { desktop: 250, portrait32: 300, portrait86: 300, mobile: 0 };
/** Never smaller than this on screen (CSS px). */
export const QR_MIN_PX = 160;
/** Physical minimum on the portrait kiosks (metres). */
export const QR_MIN_M = 0.08;
/** Phone link button height (CSS px): the touch minimum. */
const LINK_BUTTON_PX = 44;
const MIN_SCALE = 0.5;

/**
 * Physical width (metres) of the screen area the layout covers, for the presets where it is known
 * and matters (the portrait kiosks): the preset's physical screen, as src/perspective/windowGeometry.ts
 * computes it for a full-screen or simulated canvas. Null elsewhere.
 */
export function screenWidthMetres(
  profile: DisplayProfileId,
  view: { screenW: number; screenH: number; windowMode: 'fullscreen' | 'window' },
  viewport: { vw: number; vh: number },
  simulated: boolean,
  screenCss?: { w: number; h: number } | null,
): number | null {
  if (profile !== 'portrait32' && profile !== 'portrait86') return null;
  const aspect = viewport.vw / Math.max(1, viewport.vh);
  if (view.windowMode === 'fullscreen' || simulated || !screenCss || screenCss.w <= 0 || screenCss.h <= 0) {
    return aspect >= 1 ? Math.max(view.screenW, view.screenH) : Math.min(view.screenW, view.screenH);
  }
  // A browser window on the screen: CSS px × the screen's metres per CSS px.
  const pitch = Math.max(view.screenW, view.screenH) / Math.max(screenCss.w, screenCss.h);
  return viewport.vw * pitch;
}

/** Smallest QR tile for a layout (CSS px): 160 px, and 8 cm where the physical width is known. */
export function qrMinPx(layout: Pick<HudLayout, 'vw'>, screenWidthM: number | null | undefined): number {
  const physical = screenWidthM && screenWidthM > 0 ? (QR_MIN_M / screenWidthM) * layout.vw : 0;
  return Math.ceil(Math.max(QR_MIN_PX, physical));
}

/** Area the card may use: the safe zone minus the controls (and Momo above a bar panel). */
export function cardBounds(layout: HudLayout): Rect {
  const u = layout.unit;
  let top = layout.safeTop + 6;
  // Below the title row where it lies inside the safe zone (logo, chips, score), except on a phone
  // held sideways, which has no height to spare (the card covers only the row's empty middle there).
  const bar = layout.topBar;
  const barInZone = bar.y >= layout.safeTop - 1 && bar.y + bar.h <= layout.safeBottom + 1;
  if (barInZone && !(layout.controls && layout.orientation === 'landscape')) top = Math.max(top, bar.y + bar.h + 6);
  let bottom = layout.safeBottom - 6;
  let left = Math.max(layout.marginX, 10);
  let right = layout.vw - Math.max(layout.marginX, 10);
  const c = layout.controls;
  if (c) {
    const gap = Math.max(6, 8 * u);
    if (layout.orientation === 'landscape') {
      // Pad and big button in the lower corners, status + menu between them at the bottom.
      bottom = Math.min(bottom, c.status.y - gap, c.menu.y - gap);
      const [a, b] = c.dpad.x < c.action.x ? [c.dpad, c.action] : [c.action, c.dpad];
      left = Math.max(left, a.x + a.w + gap);
      right = Math.min(right, b.x - gap);
    } else {
      bottom = Math.min(bottom, layout.panel.y - gap);
      if (!layout.guide.hidden && layout.guide.place === 'abovePanel') bottom = Math.min(bottom, layout.guide.y - gap);
    }
  } else if (layout.panelStyle === 'bar') {
    bottom = Math.min(bottom, layout.panel.y - 10);
    if (layout.guide.place === 'abovePanel') bottom = Math.min(bottom, layout.guide.y - 6);
  } else {
    // Split panel: the status line and the compact menu sit at its bottom between pad and button.
    const cluster = (25 * 1.3 * layout.fontScale + 12 + 6) * u + layout.touch * 0.62;
    bottom = Math.min(bottom, layout.panel.y + layout.panel.h - cluster - 10);
    // Momo's line beside the play field (it grows down to maxH): the card keeps clear of it, so the
    // win line (which invites the scan) is never cut off by the card it talks about.
    const g = layout.guide;
    if (g.place === 'side' && !g.hidden) {
      if (g.align === 'left') left = Math.max(left, g.x + g.w + 10);
      else right = Math.min(right, g.x - 10);
    }
  }
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

/**
 * Width of the code row (CSS px) for a card unit `k` and font scale `fs`: wider than the QR tile on
 * the small presets, so the side arrangement's QR column must make room for it (it used to stick
 * out of the 1280 × 720 desktop card by about 8 px).
 */
export function codeRowWidth(k: number, fs: number): number {
  return k * (CARD.codeGap + fs * (CARD.codeChars * CARD.codeAdvance * CARD.codeFont + CARD.ring));
}

function pointsHeight(rows: number): number {
  const n = Math.max(2, Math.min(5, rows));
  return CARD.pointsTier + 6 + (n - 1) * CARD.pointsRow + CARD.pointsTotal;
}

interface Size {
  w: number;
  h: number;
  q: number;
}

/** Height of the phone's claim rows: label, code row (design units) and the link button (CSS px). */
function linkRows(input: WinCardInput, k: number): number {
  return k * ((input.label ? CARD.label + CARD.phoneGap : 0) + CARD.phoneCode + CARD.phoneGap) + LINK_BUTTON_PX;
}

/**
 * Reward block under the card's content (column arrangement): label, QR tile, instruction and the
 * code row; the phone's link rows; or the unavailable note. CSS px.
 */
function rewardBlock(input: WinCardInput, k: number, q: number): { w: number; h: number } {
  if (input.kind === 'qr') {
    const h = (input.label ? k * (CARD.label + CARD.gap) : 0) + q + k * (CARD.tileGap + CARD.instrLine * CARD.instrLines + CARD.gap + CARD.codeRow);
    return { w: Math.max(q, k * CARD.rewardMinW), h };
  }
  if (input.kind === 'link') return { w: k * CARD.rewardMinW, h: linkRows(input, k) };
  if (input.kind === 'note') return { w: k * CARD.rewardMinW, h: k * CARD.instrLine * CARD.noteLines };
  return { w: 0, h: 0 };
}

/** Column arrangement: everything stacked (the reward block under the subtitle). */
function columnSize(layout: HudLayout, input: WinCardInput, s: number, qrMin: number): Size {
  const k = layout.unit * s;
  const fs = layout.fontScale;
  const portrait = portraitUnits('column', input.withPoints, input.kind);
  let inner = CARD.title * fs + CARD.gap + portrait + CARD.gap + CARD.subtitle * fs * subtitleLines('column') + CARD.gap + CARD.buttonDepth;
  if (input.withPoints) inner += (compactPoints(layout, input.kind) ? CARD.phoneLine : pointsHeight(input.pointRows ?? 4)) * fs + CARD.gap;
  if (input.countLine) inner += CARD.count * fs + CARD.gap;
  const q = input.kind === 'qr' ? Math.max(qrMin, Math.round(QR_DESIGN[layout.profile] * k)) : 0;
  const block = rewardBlock(input, k * fs, q);
  const h = k * (CARD.padTop + CARD.padBottom + inner) + layout.touch + (block.h > 0 ? block.h + k * CARD.gap : 0);
  const w = Math.max(k * CARD.width, block.w + 2 * k * CARD.padX);
  return { w, h, q };
}

/**
 * Side arrangement (QR only): the usual card on the left with the DEMO / PREVIEW label over the
 * title and the instruction under the name, the QR tile and the code row in their own column on
 * the right (as short as the tile allows: it sets the card's height on the small presets).
 */
function sideSize(layout: HudLayout, input: WinCardInput, s: number, qrMin: number): Size {
  const k = layout.unit * s;
  const fs = layout.fontScale;
  const portrait = portraitUnits('side', input.withPoints, input.kind);
  let left = CARD.title * fs + CARD.gap + portrait + CARD.gap + CARD.subtitle * fs * subtitleLines('side') + CARD.gap + CARD.instrLine * CARD.instrLines * fs + CARD.gap + CARD.buttonDepth;
  if (input.withPoints) left += pointsHeight(input.pointRows ?? 4) * fs + CARD.gap;
  if (input.countLine) left += CARD.count * fs + CARD.gap;
  if (input.label) left += CARD.label * fs + CARD.gap;
  const leftH = k * left + layout.touch;
  const q = Math.max(qrMin, Math.round(QR_DESIGN[layout.profile] * k));
  const rightH = q + k * (CARD.gap + CARD.codeRow * fs);
  const h = Math.max(leftH, rightH) + k * (CARD.padTop + CARD.padBottom);
  const w = k * (2 * CARD.padX + CARD.sideLeft + CARD.sideGap) + Math.max(q, k * CARD.codeMinW, codeRowWidth(k, fs));
  return { w, h, q };
}

/** Phone held sideways: picture beside the text column, no QR. */
function phoneSize(layout: HudLayout, input: WinCardInput, s: number): Size {
  const k = layout.unit * s;
  const fs = layout.fontScale;
  // Text column: title, subtitle, points (a compact line next to a reward, else the breakdown),
  // count line, the note, the actions; the claim rows are added below.
  let text = CARD.phoneTitle * fs + CARD.phoneGap + CARD.phoneLine * fs * subtitleLines('phone');
  if (input.withPoints) text += CARD.phoneGap + (compactPoints(layout, input.kind) ? CARD.phoneLine : pointsHeight(input.pointRows ?? 4)) * fs;
  if (input.countLine) text += CARD.phoneGap + CARD.phoneLine * fs;
  if (input.kind === 'note') text += CARD.phoneGap + CARD.phoneLine * fs * CARD.noteLines;
  text += CARD.phoneGap + CARD.buttonDepth;
  const claim = input.kind === 'link' ? linkRows(input, k * fs) + k * CARD.phoneGap : 0;
  const textH = k * text + claim + Math.max(LINK_BUTTON_PX, layout.touch);
  const h = Math.max(k * CARD.phonePicture, textH) + 2 * k * CARD.phonePadY;
  // Widest row: PLAY AGAIN (touch high, about 3.4 touch wide with its label) and the round
  // collection button.
  const textW = Math.max(k * CARD.phoneTextMinW, layout.touch * 3.4 + LINK_BUTTON_PX + k * 12);
  const w = k * (2 * CARD.phonePadX + CARD.phonePicture + CARD.phoneColGap) + textW;
  return { w, h, q: 0 };
}

/**
 * The win card's box for `layout`. Tries the arrangements this preset prefers from full size down
 * to half size and takes the first that fits its bounds; the QR keeps its minimum throughout.
 */
export function winCardGeometry(layout: HudLayout, input: WinCardInput): WinCardGeometry {
  const bounds = cardBounds(layout);
  const phone = layout.controls !== null;
  // Phones cannot scan their own screen: the QR becomes a link; elsewhere a link is a QR.
  const kind: RewardCardKind = phone && input.kind === 'qr' ? 'link' : !phone && input.kind === 'link' ? 'qr' : input.kind;
  const effective: WinCardInput = { ...input, kind };
  const minQr = kind === 'qr' ? qrMinPx(layout, input.screenWidthM ?? null) : 0;
  const ribbon = input.ribbon ? layout.unit * CARD.ribbon : 0;
  const room = { w: bounds.w, h: bounds.h - ribbon };
  let order: CardArrangement[];
  if (phone) order = layout.orientation === 'landscape' ? ['phone'] : ['column'];
  else if (kind === 'qr') order = layout.profile === 'portrait32' ? ['column', 'side'] : ['side', 'column'];
  else order = ['column'];
  const size = (a: CardArrangement, s: number): Size =>
    a === 'phone' ? phoneSize(layout, effective, s) : a === 'side' ? sideSize(layout, effective, s, minQr) : columnSize(layout, effective, s, minQr);

  let chosen: { a: CardArrangement; s: number; size: Size } | null = null;
  const steps = Math.round((1 - MIN_SCALE) / 0.02);
  for (const a of order) {
    for (let step = 0; step <= steps && !chosen; step++) {
      const s = 1 - step * 0.02;
      const sz = size(a, s);
      if (sz.w <= room.w + 0.5 && sz.h <= room.h + 0.5) chosen = { a, s, size: sz };
    }
    if (chosen) break;
  }
  let fits = true;
  if (!chosen) {
    // Nothing fits (a tiny window or extreme settings): the smallest version of the first choice,
    // squeezed into the bounds. The QR keeps its minimum.
    fits = false;
    const a = order[0]!;
    chosen = { a, s: MIN_SCALE, size: size(a, MIN_SCALE) };
  }
  const w = Math.min(chosen.size.w, bounds.w);
  const h = Math.min(chosen.size.h, Math.max(0, room.h));
  // Centred in the bounds (the band between the phone's pad and button, or the safe zone above the
  // panel), the ribbon kept inside them.
  const cx = phone ? bounds.x + bounds.w / 2 : layout.vw / 2;
  const x = Math.max(bounds.x, Math.min(cx - w / 2, bounds.x + bounds.w - w));
  const midY = bounds.y + ribbon + room.h / 2;
  const y = Math.max(bounds.y + ribbon, Math.min(midY - h / 2, bounds.y + bounds.h - h));
  return { x, y, w, h, scale: chosen.s, arrangement: chosen.a, qrPx: chosen.size.q, qrMinPx: minQr, bounds, fits, kind };
}

/** True when two rectangles overlap. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
