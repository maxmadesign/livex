import type { Vec3 } from '../core/types';
import { FIELD, clampBinFloor } from '../physics/fieldSpec';
import type { ViewSettings } from '../settings/spec';

/** Width of the front frame bar plus the play field: the narrowest window that shows the whole machine. */
export const MIN_WINDOW_WIDTH = FIELD.halfWidth * 2 + 0.06;
/** Smallest virtual window height (landscape): gantry, toys, fascia and the top of the prize bin. */
export const MIN_WINDOW_HEIGHT = 1.3;
/** The gantry must stay inside the window, so the floor line may not be closer to the top than this. */
export const MIN_TOP = 0.89;
/** At least this much of the prize bin (world metres) stays below the floor line. */
export const MIN_BIN_VIEW = 0.3;

/**
 * Phones: physical size of one CSS pixel (metres). Measured from published panel sizes:
 * iPhone 15 Pro 0.166 mm, iPhone 13 mini 0.153 mm, Pixel 7 0.160 mm, Galaxy S24 0.183 mm,
 * Galaxy A55 0.147 mm. A browser cannot read the real value; this is a typical one.
 */
export const PHONE_CSS_PX_M = 0.000163;
/** Older / smaller phones with a pixel ratio of 2 (326 ppi iPhones, 320 ppi Android): 0.156 mm. */
export const PHONE_CSS_PX_M_DPR2 = 0.000157;
/**
 * The phone preset's default screen size (a 6.1" 19.5:9 phone held sideways, active area). While a
 * profile's screen size is left at exactly this value, window mode estimates the real size of the
 * device from its CSS pixels instead (see `estimateHandheldScreen`).
 */
export const PHONE_NOMINAL_SCREEN = { w: 0.141, h: 0.065 } as const;
/** Typical distance between the eyes and a phone held in the hands, metres. */
export const PHONE_VIEW_DISTANCE = 0.35;
/** Distance of the front camera's lens from the short edge of the active area (notch / punch hole), metres. */
export const PHONE_CAMERA_INSET = 0.008;

export interface WindowEnvironment {
  /** Canvas size in CSS pixels. */
  viewportW: number;
  viewportH: number;
  /** `screen.width/height` in CSS pixels, in the same orientation as the viewport. */
  screenW: number;
  screenH: number;
  /** Position of the centre of the canvas on the screen in CSS pixels (best effort). */
  canvasCenterX: number;
  canvasCenterY: number;
  /** Device pixel ratio (optional; refines the phone estimate). */
  dpr?: number;
  /** Screen rotation in degrees (0, 90, 180, 270) as reported by the browser, if known. */
  orientationAngle?: number;
  /**
   * The canvas is a simulated screen (portrait presets, Settings → Layout → "Simulate 9:16 screen";
   * src/layout/frame.ts): it stands for the preset's whole physical screen (`screenW × screenH`),
   * whatever the browser window and the monitor are, so the "Game window" option does not apply.
   */
  simulated?: boolean;
}

/** A rectangle in the browser viewport (CSS px) to use instead of the canvas' own position. */
export interface ViewportBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowLayout {
  /** Virtual window (world units = metres at the cabinet's design scale). */
  width: number;
  height: number;
  top: number;
  bottom: number;
  centerY: number;
  aspect: number;
  /** Width of the display bay on each side of the play field (0 for portrait). */
  sideBay: number;
  /** Width of the frame bar at the edge of the window. */
  frame: number;
  binFloorY: number;
  /** Normalised screen Y of the floor line that was actually used. */
  floorY: number;
  /** Physical size of the effective window in metres and its offset from the screen centre. */
  physWidth: number;
  physHeight: number;
  physOffsetX: number;
  physOffsetY: number;
  /** World units per physical metre. */
  scale: number;
  /** True when the physical size was estimated from CSS pixels (phone preset left at its nominal screen size). */
  estimated: boolean;
}

/** Size of the virtual window (metres) for a canvas aspect ratio (width / height). */
export function virtualWindowSize(aspect: number): { width: number; height: number } {
  const a = Math.max(0.2, aspect);
  const width = Math.max(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT * a);
  return { width, height: width / a };
}

/** Range of the normalised floor line that keeps the gantry and part of the bin in view. */
export function floorLimits(vw: number, vh: number): { min: number; max: number } {
  const { height } = virtualWindowSize(vw / Math.max(1, vh));
  const min = MIN_TOP / height;
  return { min, max: Math.max(min, 1 - MIN_BIN_VIEW / height) };
}

/**
 * Horizontal span of the cabinet (play field plus its front frame) on screen, in CSS pixels. On
 * landscape screens the rest of the width is the display bays on either side, where controls can
 * sit without covering a toy.
 */
export function machineSpan(vw: number, vh: number): { left: number; right: number } {
  const { width } = virtualWindowSize(vw / Math.max(1, vh));
  const w = (MIN_WINDOW_WIDTH / width) * vw;
  return { left: (vw - w) / 2, right: (vw + w) / 2 };
}

/** True when a view's screen size is the phone preset's untouched default. */
export function isNominalPhoneScreen(view: Pick<ViewSettings, 'screenW' | 'screenH'>): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 5e-4;
  return (
    (near(view.screenW, PHONE_NOMINAL_SCREEN.w) && near(view.screenH, PHONE_NOMINAL_SCREEN.h)) ||
    (near(view.screenW, PHONE_NOMINAL_SCREEN.h) && near(view.screenH, PHONE_NOMINAL_SCREEN.w))
  );
}

/** Metres per CSS pixel on a handheld device. */
export function handheldPitch(dpr: number | undefined): number {
  return dpr !== undefined && dpr > 0 && dpr <= 2.2 ? PHONE_CSS_PX_M_DPR2 : PHONE_CSS_PX_M;
}

/**
 * Physical size of a phone's screen estimated from its CSS size (any orientation) and pixel ratio.
 * Typical error ±12 %; enter the real size under Camera & Parallax for an exact result.
 */
export function estimateHandheldScreen(screenCssW: number, screenCssH: number, dpr?: number): { widthM: number; heightM: number; pitchM: number } {
  const pitchM = handheldPitch(dpr);
  return { widthM: Math.max(1, screenCssW) * pitchM, heightM: Math.max(1, screenCssH) * pitchM, pitchM };
}

/**
 * Estimated position of a phone's front camera relative to the centre of its screen (metres; x right,
 * y up, z towards the viewer) for a screen rotation angle: 0 = upright (camera at the top), 90 = turned
 * so the top is on the left (camera on the left), 180 = upside down, 270 = top on the right.
 */
export function phoneCameraPosition(angle: number, widthM: number, heightM: number): Vec3 {
  const a = (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
  if (a === 90) return [-(widthM / 2 - PHONE_CAMERA_INSET), 0, 0];
  if (a === 270) return [widthM / 2 - PHONE_CAMERA_INSET, 0, 0];
  if (a === 180) return [0, -(heightM / 2 - PHONE_CAMERA_INSET), 0];
  return [0, heightM / 2 - PHONE_CAMERA_INSET, 0];
}

/**
 * Lens position the head tracker should use on a phone. The phone preset's stored default
 * (`presetDefault`, [-0.065, 0, 0]) is only right for a phone turned top-to-the-left; while the stored
 * value is still exactly that default and the rotation is known, the position follows the actual
 * rotation (`phoneCameraPosition`). A position the user entered is returned unchanged.
 */
export function handheldCameraPosition(stored: Readonly<Vec3>, presetDefault: Readonly<Vec3>, angle: number | undefined, screenWidthM: number, screenHeightM: number): Readonly<Vec3> {
  const isDefault = stored.every((v, i) => Math.abs(v - presetDefault[i]!) < 1e-9);
  if (!isDefault || angle === undefined || !Number.isFinite(angle) || !(screenWidthM > 0) || !(screenHeightM > 0)) return stored;
  return phoneCameraPosition(angle, screenWidthM, screenHeightM);
}

/**
 * Physical size of the whole screen (metres, in the viewport's orientation), derived from the window
 * layout: the canvas' physical size scaled by screen / viewport CSS pixels. Without a usable screen
 * size (or for a simulated screen) the canvas is taken as the screen.
 */
export function physicalScreenSize(env: WindowEnvironment, layout: Pick<WindowLayout, 'physWidth' | 'physHeight'>): { widthM: number; heightM: number } {
  if (!env.simulated && env.screenW > 0 && env.screenH > 0 && env.viewportW > 0 && env.viewportH > 0) {
    return { widthM: (layout.physWidth * env.screenW) / env.viewportW, heightM: (layout.physHeight * env.screenH) / env.viewportH };
  }
  return { widthM: layout.physWidth, heightM: layout.physHeight };
}

/**
 * Maps the canvas to a "window" into the cabinet. The front edge of the play
 * floor lies exactly in the window plane, so its position on screen never
 * changes with the viewpoint.
 */
export function computeWindowLayout(env: WindowEnvironment, view: ViewSettings, floorYNorm: number): WindowLayout {
  const aspect = Math.max(0.2, env.viewportW / Math.max(1, env.viewportH));
  const { width, height } = virtualWindowSize(aspect);
  // Keep the gantry in view and leave room for the prize bin below the floor.
  const minFloor = MIN_TOP / height;
  const maxFloor = 1 - MIN_BIN_VIEW / height;
  const floorY = Math.min(Math.max(floorYNorm, minFloor), Math.max(minFloor, maxFloor));
  const top = floorY * height;
  const bottom = top - height;

  let physWidth: number;
  let physHeight: number;
  let offX = 0;
  let offY = 0;
  let estimated = false;
  if (view.windowMode === 'fullscreen' || env.screenW <= 0 || env.simulated) {
    // The canvas is the whole physical screen (kiosk, or the simulated 9:16 screen of a portrait
    // preset shown on another monitor). Height follows the real canvas aspect.
    physWidth = aspect >= 1 ? Math.max(view.screenW, view.screenH) : Math.min(view.screenW, view.screenH);
    physHeight = physWidth / aspect;
  } else {
    // A browser window on a larger screen: derive the physical size from CSS pixels. A phone preset
    // left at its nominal size uses the typical size of a phone's CSS pixel instead.
    estimated = isNominalPhoneScreen(view);
    const pitch = estimated ? handheldPitch(env.dpr) : Math.max(view.screenW, view.screenH) / Math.max(env.screenW, env.screenH);
    physWidth = env.viewportW * pitch;
    physHeight = env.viewportH * pitch;
    offX = (env.canvasCenterX - env.screenW / 2) * pitch;
    offY = -(env.canvasCenterY - env.screenH / 2) * pitch;
  }
  const sideBay = Math.max(0, (width - MIN_WINDOW_WIDTH) / 2);
  return {
    width,
    height,
    top,
    bottom,
    centerY: (top + bottom) / 2,
    aspect,
    sideBay,
    frame: 0.015 + 0.014 * width,
    binFloorY: clampBinFloor(bottom + 0.075),
    floorY,
    physWidth,
    physHeight,
    physOffsetX: offX,
    physOffsetY: offY,
    scale: width / physWidth,
    estimated,
  };
}

/** Eye position in world space for an eye given in metres relative to the centre of the effective window. */
export function eyeToWorld(layout: WindowLayout, eye: Vec3, out: Vec3): Vec3 {
  out[0] = eye[0] * layout.scale;
  out[1] = layout.centerY + eye[1] * layout.scale;
  out[2] = Math.max(0.05, eye[2] * layout.scale);
  return out;
}

/**
 * Puts `screen.width/height` into the viewport's orientation. iOS always reports the portrait size,
 * so a phone held sideways would otherwise look like a canvas far off the screen centre. A portrait
 * browser window on a landscape monitor still fits the unrotated screen and is left alone.
 */
export function orientScreen(viewportW: number, viewportH: number, screenW: number, screenH: number, angle?: number): { screenW: number; screenH: number } {
  if (screenW <= 0 || screenH <= 0) return { screenW, screenH };
  const viewLandscape = viewportW > viewportH;
  if (viewLandscape === screenW > screenH || screenW === screenH) return { screenW, screenH };
  const fits = viewportW <= screenW + 1 && viewportH <= screenH + 1;
  const fitsSwapped = viewportW <= screenH + 1 && viewportH <= screenW + 1;
  const rotated = angle !== undefined && Math.round(angle / 90) % 2 !== 0;
  if ((!fits && fitsSwapped) || (rotated && fitsSwapped && screenW < screenH)) return { screenW: screenH, screenH: screenW };
  return { screenW, screenH };
}

function readOrientationAngle(): number | undefined {
  try {
    const angle = globalThis.screen?.orientation?.angle;
    if (typeof angle === 'number') return angle;
    const legacy = (globalThis as unknown as { orientation?: unknown }).orientation;
    return typeof legacy === 'number' ? (legacy + 360) % 360 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort measurement of where the canvas sits on the physical screen. `simulatedBox` (the
 * simulated 9:16 screen of a portrait preset, src/layout/frame.ts) replaces the canvas' measured
 * rectangle — the element may not have been resized yet — and marks the environment `simulated`.
 */
export function readWindowEnvironment(canvas: HTMLElement, simulatedBox?: ViewportBox | null): WindowEnvironment {
  const rect = simulatedBox
    ? { left: simulatedBox.x, top: simulatedBox.y, width: simulatedBox.w, height: simulatedBox.h }
    : canvas.getBoundingClientRect();
  const chromeX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  const chromeTop = Math.max(0, window.outerHeight - window.innerHeight - chromeX);
  const angle = readOrientationAngle();
  const screen = orientScreen(rect.width, rect.height, window.screen?.width ?? rect.width, window.screen?.height ?? rect.height, angle);
  return {
    viewportW: rect.width,
    viewportH: rect.height,
    screenW: screen.screenW,
    screenH: screen.screenH,
    canvasCenterX: (window.screenX || 0) + chromeX + rect.left + rect.width / 2,
    canvasCenterY: (window.screenY || 0) + chromeTop + rect.top + rect.height / 2,
    dpr: window.devicePixelRatio || 1,
    orientationAngle: angle,
    ...(simulatedBox ? { simulated: true } : {}),
  };
}
