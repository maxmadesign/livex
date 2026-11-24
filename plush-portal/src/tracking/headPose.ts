/**
 * Head direction ("where the face points") for the baseline-relative view. Pure functions.
 *
 * The eye estimator reports the head orientation relative to the camera axes. Here it is turned
 * into the screen frame (so a tilted / sideways camera does not bias it) and compared with the
 * direction from the eyes to the centre of the game window:
 *
 *   relative = head direction − direction to the window centre − baseline bias
 *
 * Looking at the middle of the window from anywhere gives relative ≈ 0, so walking sideways while
 * watching the cabinet is pure position parallax. Turning the head away from the middle ("looking
 * around") gives a non-zero angle, which the view mapping turns into an extra viewpoint offset in
 * the same direction (`camera.headWeight`). The baseline bias is the relative angle measured during
 * the countdown calibration (people rarely face a screen exactly square).
 *
 * Angles: yaw > 0 = turned to the player's right (screen +X), pitch > 0 = up (screen +Y), radians.
 */
import type { Vec3 } from '../core/types';
import { rotateToScreen } from './cameraTransform';

export interface HeadAngles {
  yaw: number;
  pitch: number;
}

/** Relative angles smaller than this are ignored (landmark jitter at rest), radians. */
export const HEAD_DEADZONE = (2 * Math.PI) / 180;
/** Relative angles are limited to this (the fit is unreliable for faces turned further), radians. */
export const HEAD_MAX_ANGLE = (45 * Math.PI) / 180;

const _nc: Vec3 = [0, 0, 0];
const _ns: Vec3 = [0, 0, 0];

/**
 * Head direction in screen space from the estimator's camera-space angles
 * (`FaceMeasurement.yaw / pitch`: yaw > 0 nose towards image right, pitch > 0 nose up) and the
 * camera → screen rotation (`mountMatrix`).
 */
export function headDirectionScreen(cameraYaw: number, cameraPitch: number, matrix: Float64Array, out: HeadAngles = { yaw: 0, pitch: 0 }): HeadAngles {
  // Face normal in camera space (X right, Y down, Z away from the camera): facing the camera = −Z.
  const cp = Math.cos(cameraPitch);
  _nc[0] = Math.sin(cameraYaw) * cp;
  _nc[1] = -Math.sin(cameraPitch);
  _nc[2] = -Math.cos(cameraYaw) * cp;
  rotateToScreen(_nc, matrix, _ns);
  // Facing the screen = −Z in screen space.
  out.yaw = Math.atan2(_ns[0], -_ns[2]);
  out.pitch = Math.atan2(_ns[1], Math.hypot(_ns[0], _ns[2]));
  return out;
}

/** Direction from an eye position (window space) to the centre of the game window. */
export function directionToCentre(eye: Readonly<Vec3>, out: HeadAngles = { yaw: 0, pitch: 0 }): HeadAngles {
  const z = Math.max(1e-3, eye[2]);
  out.yaw = Math.atan2(-eye[0], z);
  out.pitch = Math.atan2(-eye[1], Math.hypot(eye[0], z));
  return out;
}

/** Wraps an angle to (−π, π]. */
function wrap(a: number): number {
  if (a > Math.PI) return a - 2 * Math.PI;
  if (a <= -Math.PI) return a + 2 * Math.PI;
  return a;
}

/** Head direction minus the direction to the window centre (both screen space), radians. */
export function headRelativeToCentre(head: HeadAngles, eye: Readonly<Vec3>, out: HeadAngles = { yaw: 0, pitch: 0 }): HeadAngles {
  const yaw = head.yaw;
  const pitch = head.pitch;
  directionToCentre(eye, out);
  out.yaw = wrap(yaw - out.yaw);
  out.pitch = wrap(pitch - out.pitch);
  return out;
}

/** Dead zone + limit for one relative angle (continuous: no step at the edge of the dead zone). */
export function shapeHeadAngle(angle: number, deadzone = HEAD_DEADZONE, max = HEAD_MAX_ANGLE): number {
  const a = Math.abs(angle);
  if (!(a > deadzone)) return 0;
  return Math.sign(angle) * Math.min(max, a - deadzone);
}

/**
 * Viewpoint offset (metres, window space x / y) for a head turned by `relYaw` / `relPitch`
 * relative to the baseline: `weight × lever × sin(angle)` after the dead zone. `lever` is the
 * reference viewing distance, so the effect scales with the installation (desktop ≈ 0.6 m,
 * 86" ≈ 0.95 m). With the default weight 0.4 a 20° turn moves the view by about 0.08 m on a desktop.
 */
export function headOffset(relYaw: number, relPitch: number, weight: number, lever: number, out: [number, number] = [0, 0]): [number, number] {
  if (!(weight > 0) || !(lever > 0)) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  out[0] = weight * lever * Math.sin(shapeHeadAngle(relYaw));
  out[1] = weight * lever * Math.sin(shapeHeadAngle(relPitch));
  return out;
}
