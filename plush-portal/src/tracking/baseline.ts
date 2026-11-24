/**
 * Where a calibration baseline lives in the settings, per display preset. Pure.
 *
 *   eye position   profiles.<id>.view.calNeutral   (+ calDepthK, calibrated – the existing calibration data)
 *   head direction camera.headBaseline.<id>.yaw / .pitch   (degrees, relative to facing the window centre)
 *
 * The tracker reports a calibration through `CalibrationEvent`; the application writes the values
 * with `baselineWrites()` into the settings of the preset that is active, and the tracker reads the
 * head part back with `headBiasFor()` when it is configured.
 */
import type { DisplayProfileId } from '../core/types';
import type { CameraSettings } from '../settings/spec';
import type { CalibrationValues } from './calibration';
import type { HeadAngles } from './headPose';

const DEG = Math.PI / 180;

/** Rounds to the 0.1° grid the settings store (so the stored and the applied value are identical). */
export function roundDegrees(value: number): number {
  return Math.round(Math.min(60, Math.max(-60, value)) * 10) / 10;
}

/** Settings writes ([path, value]) that persist a calibration for one display preset. */
export function baselineWrites(profile: DisplayProfileId, values: CalibrationValues): [string, unknown][] {
  const writes: [string, unknown][] = [
    [`profiles.${profile}.view.calDepthK`, values.calDepthK],
    [`profiles.${profile}.view.calNeutral`, [values.calNeutral[0], values.calNeutral[1], values.calNeutral[2]]],
    [`profiles.${profile}.view.calibrated`, true],
  ];
  if (typeof values.headYaw === 'number' && typeof values.headPitch === 'number') {
    writes.push([`camera.headBaseline.${profile}.yaw`, roundDegrees(values.headYaw)]);
    writes.push([`camera.headBaseline.${profile}.pitch`, roundDegrees(values.headPitch)]);
  }
  return writes;
}

/** Settings writes that clear the head-direction baseline of one preset (used by "Clear calibration"). */
export function clearHeadBaselineWrites(profile: DisplayProfileId): [string, unknown][] {
  return [
    [`camera.headBaseline.${profile}.yaw`, 0],
    [`camera.headBaseline.${profile}.pitch`, 0],
  ];
}

/**
 * Head-direction baseline (radians) of a preset, or zero when the preset is not calibrated or
 * unknown (then "facing the window centre" is the neutral head direction).
 */
export function headBiasFor(camera: Pick<CameraSettings, 'headBaseline'>, profile: DisplayProfileId | null, calibrated: boolean, out: HeadAngles = { yaw: 0, pitch: 0 }): HeadAngles {
  const entry = profile && calibrated ? (camera.headBaseline as Partial<Record<DisplayProfileId, { yaw: number; pitch: number }>> | undefined)?.[profile] : undefined;
  out.yaw = entry && Number.isFinite(entry.yaw) ? entry.yaw * DEG : 0;
  out.pitch = entry && Number.isFinite(entry.pitch) ? entry.pitch * DEG : 0;
  return out;
}
