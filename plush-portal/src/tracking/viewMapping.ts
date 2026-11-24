/**
 * Measured eye position (screen space) → viewpoint used for rendering
 * (window space). Pure functions.
 *
 * Window space is screen space translated to the centre of the effective game
 * window:  window = screen − (offsetX, offsetY, 0).
 *
 *   viewpoint = eye_ref + gain ∘ (measured_window − neutral)
 *
 * `eye_ref` is the reference eye (`view.eye`). `neutral` is the measured
 * window-space position that should map onto the reference eye:
 *   - relative mode with a calibration: the calibrated `calNeutral`
 *   - absolute mode, or no calibration yet: `eye_ref` itself, so that with
 *     gain 1 the viewpoint is exactly the measured eye position
 * The offset from `eye_ref` is then softly limited to `maxOffset` and the
 * viewpoint is kept at least `minDistance` in front of the screen.
 */
import type { Vec3 } from '../core/types';
import type { ViewSettings } from '../settings/spec';

export interface PhysicalWindow {
  /** Physical size of the effective game window, metres. */
  widthM: number;
  heightM: number;
  /** Centre of the window relative to the centre of the physical screen, metres (+x right, +y up). */
  centerOffsetM: [number, number];
}

/** Subset of the view settings the mapping depends on. */
export type ViewMappingSettings = Pick<
  ViewSettings,
  'eye' | 'mode' | 'gainX' | 'gainY' | 'gainZ' | 'maxOffset' | 'minDistance' | 'calibrated' | 'calNeutral'
>;

/** Fraction of `max` up to which {@link softClamp} is exactly linear. */
export const SOFT_CLAMP_KNEE = 0.75;

/**
 * Limits `d` to (−max, max) without a kink: linear up to 75 % of the limit,
 * then a tanh shoulder that approaches the limit asymptotically (C¹ continuous).
 */
export function softClamp(d: number, max: number): number {
  if (!(max > 0)) return 0;
  const a = Math.abs(d);
  const knee = max * SOFT_CLAMP_KNEE;
  if (a <= knee) return d;
  const room = max - knee;
  return Math.sign(d) * (knee + room * Math.tanh((a - knee) / room));
}

/** The measured window-space position that maps onto the reference eye. */
export function neutralPoint(view: ViewMappingSettings): Readonly<Vec3> {
  return view.mode === 'relative' && view.calibrated ? view.calNeutral : view.eye;
}

/** Screen space → window space. */
export function screenToWindow(ps: Readonly<Vec3>, window: PhysicalWindow, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = ps[0] - window.centerOffsetM[0];
  out[1] = ps[1] - window.centerOffsetM[1];
  out[2] = ps[2];
  return out;
}

/** Applies neutral, gains and limits to a measured window-space eye position. */
export function mapToViewpoint(measuredWindow: Readonly<Vec3>, view: ViewMappingSettings, out: Vec3 = [0, 0, 0]): Vec3 {
  const n = neutralPoint(view);
  const dx = softClamp((measuredWindow[0] - n[0]) * view.gainX, view.maxOffset[0]);
  const dy = softClamp((measuredWindow[1] - n[1]) * view.gainY, view.maxOffset[1]);
  const dz = softClamp((measuredWindow[2] - n[2]) * view.gainZ, view.maxOffset[2]);
  out[0] = view.eye[0] + dx;
  out[1] = view.eye[1] + dy;
  out[2] = Math.max(view.minDistance, view.eye[2] + dz);
  return out;
}

/** The viewpoint used when nothing is tracked: the reference eye, kept in front of the screen. */
export function neutralViewpoint(view: ViewMappingSettings, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = view.eye[0];
  out[1] = view.eye[1];
  out[2] = Math.max(view.minDistance, view.eye[2]);
  return out;
}

/** Applies the same limits as {@link mapToViewpoint} to a manual offset from the reference eye. */
export function offsetViewpoint(offset: Readonly<Vec3>, view: ViewMappingSettings, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = view.eye[0] + softClamp(offset[0], view.maxOffset[0]);
  out[1] = view.eye[1] + softClamp(offset[1], view.maxOffset[1]);
  out[2] = Math.max(view.minDistance, view.eye[2] + softClamp(offset[2], view.maxOffset[2]));
  return out;
}
