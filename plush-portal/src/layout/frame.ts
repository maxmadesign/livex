/**
 * Simulated 9:16 portrait screen (Settings → Layout → "Simulate 9:16 screen").
 *
 * The two portrait kiosk presets are designed for a 9:16 panel. Opened in a browser window of
 * another shape (a laptop, a landscape monitor), the whole game — 3D canvas, HUD, overlays,
 * dialogs and toasts — is laid out in the largest centred 9:16 box of the window, and that box is
 * treated as the preset's physical screen (Window Perspective included). Outside it there is only
 * a calm surround. On a window that already is 9:16 (within FRAME_FILL_TOLERANCE) the box is the
 * whole window. See docs/DISPLAYS.md → "Simulated 9:16 screen".
 *
 * Everything here is a pure function of the preset, its layout settings and the window size, so
 * the HUD (React) and the game (resize path in src/app/Game.ts) compute the same box without
 * waiting for each other.
 */
import type { DisplayProfileId } from '../core/types';
import { readWindowEnvironment, type WindowEnvironment } from '../perspective/windowGeometry';
import type { LayoutSettings } from '../settings/spec';
import { readSafeAreaInsets, type Insets } from './safeArea';
import { solveLayout, type HudLayout } from './solve';

/** How a portrait preset uses a browser window of another shape (`profiles.<id>.layout.frame`). */
export type FrameMode = LayoutSettings['frame'];

/** Width ÷ height of the simulated portrait screen. */
export const FRAME_ASPECT = 9 / 16;
/** A window whose aspect ratio is within this relative difference of 9:16 is used whole. */
export const FRAME_FILL_TOLERANCE = 0.02;
/** Presets that can simulate their 9:16 screen. */
export const FRAME_PROFILES: readonly DisplayProfileId[] = ['portrait32', 'portrait86'];

/** Where the game's viewport sits in the browser window (CSS px). */
export interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Browser viewport (`innerWidth × innerHeight`). */
  windowW: number;
  windowH: number;
  /** The box stands for the preset's whole physical screen ("Simulate 9:16 screen" is on). */
  simulated: boolean;
  /** The box is smaller than the window: the rest is the surround. */
  letterboxed: boolean;
}

export interface FitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True for the presets that offer "Simulate 9:16 screen". */
export function frameSupported(profile: DisplayProfileId): boolean {
  return FRAME_PROFILES.includes(profile);
}

/** True when the preset lays the game out in a simulated 9:16 screen. */
export function frameEnabled(profile: DisplayProfileId, layout: Pick<LayoutSettings, 'frame'>): boolean {
  return frameSupported(profile) && layout.frame !== 'fill';
}

/**
 * The largest centred rectangle of `aspect` (width ÷ height) inside `windowW × windowH`, in whole
 * CSS pixels (left / top rounded down, so a one-pixel remainder goes to the right / bottom).
 * A window within `tolerance` of the aspect is returned whole.
 */
export function fitAspect(windowW: number, windowH: number, aspect: number = FRAME_ASPECT, tolerance: number = FRAME_FILL_TOLERANCE): FitRect {
  const W = Number.isFinite(windowW) ? Math.max(0, windowW) : 0;
  const H = Number.isFinite(windowH) ? Math.max(0, windowH) : 0;
  if (W <= 0 || H <= 0 || !(aspect > 0)) return { x: 0, y: 0, w: W, h: H };
  const windowAspect = W / H;
  if (Math.abs(windowAspect / aspect - 1) <= tolerance) return { x: 0, y: 0, w: W, h: H };
  let w: number;
  let h: number;
  if (windowAspect > aspect) {
    // Wider than the target: full height, bars left and right.
    h = H;
    w = Math.min(W, Math.max(1, Math.round(H * aspect)));
  } else {
    // Taller than the target: full width, bars above and below.
    w = W;
    h = Math.min(H, Math.max(1, Math.round(W / aspect)));
  }
  return { x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2), w, h };
}

/** The game's box for a preset in a `windowW × windowH` browser viewport. */
export function computeFrame(profile: DisplayProfileId, layout: Pick<LayoutSettings, 'frame'>, windowW: number, windowH: number): FrameBox {
  const W = Math.max(0, windowW);
  const H = Math.max(0, windowH);
  if (!frameEnabled(profile, layout)) return { x: 0, y: 0, w: W, h: H, windowW: W, windowH: H, simulated: false, letterboxed: false };
  const r = fitAspect(W, H);
  return { ...r, windowW: W, windowH: H, simulated: true, letterboxed: r.w < W || r.h < H };
}

/** Browser viewport size in CSS px (0 × 0 outside a browser). */
export function readViewportSize(): { w: number; h: number } {
  const g = globalThis as { innerWidth?: number; innerHeight?: number };
  return { w: g.innerWidth ?? 0, h: g.innerHeight ?? 0 };
}

/** The box for the current browser viewport. */
export function readFrame(profile: DisplayProfileId, layout: Pick<LayoutSettings, 'frame'>): FrameBox {
  const { w, h } = readViewportSize();
  return computeFrame(profile, layout, w, h);
}

/**
 * The window's safe-area insets (notch, home indicator) as seen from inside the box: only the part
 * of a cut-out that reaches into the box remains. Unchanged when the box is the whole window.
 */
export function frameInsets(insets: Insets, frame: FrameBox): Insets {
  if (!frame.letterboxed) return insets;
  const right = frame.windowW - (frame.x + frame.w);
  const bottom = frame.windowH - (frame.y + frame.h);
  return {
    top: Math.max(0, insets.top - frame.y),
    right: Math.max(0, insets.right - right),
    bottom: Math.max(0, insets.bottom - bottom),
    left: Math.max(0, insets.left - frame.x),
  };
}

/** A HUD layout together with the box it was solved for. */
export type FramedLayout = HudLayout & { frame: FrameBox };

/**
 * Solves the layout for the preset's box: `solveLayout` gets the box size (not the window size)
 * and the insets that reach into the box. Used by the HUD; the game's resize path uses
 * `readFramedEnvironment`, which yields the same box.
 */
export function solveFramed(
  profile: DisplayProfileId,
  layout: LayoutSettings,
  windowW: number,
  windowH: number,
  windowInsets: Insets = readSafeAreaInsets(),
): FramedLayout {
  const frame = computeFrame(profile, layout, windowW, windowH);
  return { ...solveLayout(profile, layout, frame.w, frame.h, frameInsets(windowInsets, frame)), frame };
}

/**
 * Resize path of the game: the window environment for the canvas, the insets to solve the layout
 * with, and the box. With a simulated screen the environment is taken from the computed box (the
 * canvas element may not have been resized by React yet) and marked `simulated`, so Window
 * Perspective treats the box as the preset's physical screen; otherwise it is measured from the
 * canvas exactly as before.
 */
export function readFramedEnvironment(
  canvas: HTMLElement,
  profile: DisplayProfileId,
  layout: Pick<LayoutSettings, 'frame'>,
): { env: WindowEnvironment; insets: Insets; frame: FrameBox } {
  const frame = readFrame(profile, layout);
  const env = readWindowEnvironment(canvas, frame.simulated ? frame : null);
  return { env, insets: frameInsets(readSafeAreaInsets(), frame), frame };
}
