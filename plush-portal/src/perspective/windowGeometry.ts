import type { Vec3 } from '../core/types';
import { FIELD, clampBinFloor } from '../physics/fieldSpec';
import type { ViewSettings } from '../settings/spec';

/** Width of the front frame bar plus the play field: the narrowest window that shows the whole machine. */
export const MIN_WINDOW_WIDTH = FIELD.halfWidth * 2 + 0.06;
/** Smallest virtual window height (landscape): gantry, toys, fascia and the top of the prize bin. */
export const MIN_WINDOW_HEIGHT = 1.3;
/** The gantry must stay inside the window, so the floor line may not be closer to the top than this. */
export const MIN_TOP = 0.89;

export interface WindowEnvironment {
  /** Canvas size in CSS pixels. */
  viewportW: number;
  viewportH: number;
  /** `screen.width/height` in CSS pixels. */
  screenW: number;
  screenH: number;
  /** Position of the centre of the canvas on the screen in CSS pixels (best effort). */
  canvasCenterX: number;
  canvasCenterY: number;
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
}

/**
 * Maps the canvas to a "window" into the cabinet. The front edge of the play
 * floor lies exactly in the window plane, so its position on screen never
 * changes with the viewpoint.
 */
export function computeWindowLayout(env: WindowEnvironment, view: ViewSettings, floorYNorm: number): WindowLayout {
  const aspect = Math.max(0.2, env.viewportW / Math.max(1, env.viewportH));
  const width = Math.max(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT * aspect);
  const height = width / aspect;
  // Keep the gantry in view and leave room for the prize bin below the floor.
  const minFloor = MIN_TOP / height;
  const maxFloor = 1 - 0.3 / height;
  const floorY = Math.min(Math.max(floorYNorm, minFloor), Math.max(minFloor, maxFloor));
  const top = floorY * height;
  const bottom = top - height;

  let physWidth: number;
  let physHeight: number;
  let offX = 0;
  let offY = 0;
  if (view.windowMode === 'fullscreen' || env.screenW <= 0) {
    // The canvas is the whole physical screen (kiosk). Height follows the real canvas aspect.
    physWidth = aspect >= 1 ? Math.max(view.screenW, view.screenH) : Math.min(view.screenW, view.screenH);
    physHeight = physWidth / aspect;
  } else {
    // A browser window on a larger screen: derive the physical size from CSS pixels.
    const pitch = Math.max(view.screenW, view.screenH) / Math.max(env.screenW, env.screenH);
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
  };
}

/** Eye position in world space for an eye given in metres relative to the centre of the effective window. */
export function eyeToWorld(layout: WindowLayout, eye: Vec3, out: Vec3): Vec3 {
  out[0] = eye[0] * layout.scale;
  out[1] = layout.centerY + eye[1] * layout.scale;
  out[2] = Math.max(0.05, eye[2] * layout.scale);
  return out;
}

/** Best-effort measurement of where the canvas sits on the physical screen. */
export function readWindowEnvironment(canvas: HTMLElement): WindowEnvironment {
  const rect = canvas.getBoundingClientRect();
  const chromeX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  const chromeTop = Math.max(0, window.outerHeight - window.innerHeight - chromeX);
  return {
    viewportW: rect.width,
    viewportH: rect.height,
    screenW: window.screen?.width ?? rect.width,
    screenH: window.screen?.height ?? rect.height,
    canvasCenterX: (window.screenX || 0) + chromeX + rect.left + rect.width / 2,
    canvasCenterY: (window.screenY || 0) + chromeTop + rect.top + rect.height / 2,
  };
}
