/**
 * Phones and low-power devices: what the camera is asked for and how often the face model runs.
 *
 * On a phone the game, the browser and the face model share a small, battery-powered SoC, and
 * the front camera sits right next to the player. A smaller frame (360p) and a lower inference
 * rate (≤ 12 Hz) keep the game smooth and the phone cool without visibly hurting a view that is
 * filtered and interpolated to the render rate anyway; one face is enough at arm's length.
 *
 * `camera.lowPower`: auto (detect), on (always reduced), off (always the configured values).
 * Pure apart from readDeviceInfo().
 */
import type { CameraSettings } from '../settings/spec';

export interface DeviceInfo {
  /** Phone or tablet (touch-first mobile browser). */
  mobile: boolean;
  /** Logical CPU cores, when the browser tells. */
  cores: number | null;
  /** Approximate device memory in GB, when the browser tells (Chromium only). */
  memoryGb: number | null;
}

export type LowPowerReason = 'setting' | 'phone' | 'low_power_device';

export interface EffectiveCapture {
  resolution: CameraSettings['resolution'];
  inferenceHz: number;
  numFaces: number;
  /** True when the reduced values are in use. */
  lowPower: boolean;
  reason: LowPowerReason | null;
}

/** Upper bound of the inference rate in low-power mode, Hz. */
export const LOW_POWER_MAX_HZ = 12;

/** Reads what the browser reveals about the device (never throws; neutral values outside a browser). */
export function readDeviceInfo(nav: Partial<Navigator> | undefined = typeof navigator !== 'undefined' ? navigator : undefined): DeviceInfo {
  if (!nav) return { mobile: false, cores: null, memoryGb: null };
  const n = nav as Partial<Navigator> & { userAgentData?: { mobile?: boolean }; deviceMemory?: number };
  const ua = typeof n.userAgent === 'string' ? n.userAgent : '';
  const touchMac = /Macintosh/.test(ua) && (n.maxTouchPoints ?? 0) > 1; // iPadOS reports a desktop Safari UA
  const mobile = n.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile|Windows Phone|Silk|Kindle|HarmonyOS/i.test(ua) || touchMac;
  const cores = typeof n.hardwareConcurrency === 'number' && n.hardwareConcurrency > 0 ? n.hardwareConcurrency : null;
  const memoryGb = typeof n.deviceMemory === 'number' && n.deviceMemory > 0 ? n.deviceMemory : null;
  return { mobile, cores, memoryGb };
}

/** Why the reduced capture would be used on this device in `auto` mode (null = full capture). */
export function lowPowerReason(info: DeviceInfo): LowPowerReason | null {
  if (info.mobile) return 'phone';
  if (info.cores !== null && info.cores <= 2) return 'low_power_device';
  if (info.cores !== null && info.cores <= 4 && info.memoryGb !== null && info.memoryGb <= 4) return 'low_power_device';
  return null;
}

const ORDER: CameraSettings['resolution'][] = ['360p', '480p', '720p'];

/** The capture parameters really used for a camera configuration on this device. */
export function effectiveCapture(camera: Pick<CameraSettings, 'resolution' | 'inferenceHz' | 'numFaces' | 'lowPower'>, info: DeviceInfo): EffectiveCapture {
  const mode = camera.lowPower ?? 'auto';
  const reason: LowPowerReason | null = mode === 'on' ? 'setting' : mode === 'off' ? null : lowPowerReason(info);
  if (!reason) {
    return { resolution: camera.resolution, inferenceHz: camera.inferenceHz, numFaces: camera.numFaces, lowPower: false, reason: null };
  }
  const resolution = ORDER.indexOf(camera.resolution) > 0 ? '360p' : camera.resolution;
  return {
    resolution,
    inferenceHz: Math.min(camera.inferenceHz, LOW_POWER_MAX_HZ),
    numFaces: 1,
    lowPower: true,
    reason,
  };
}
