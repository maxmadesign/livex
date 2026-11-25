/**
 * Head Tracking / Window Perspective.
 *
 * Public surface of the tracking module. The game talks to the tracker through
 * `TrackerPort` (src/core/contracts.ts); `createFaceTracker()` returns that
 * port plus `configure()` and the calibration hook.
 */
export { createFaceTracker } from './FaceTracker';
export type {
  CalibrationEvent,
  CalibrationOutcome,
  DragSource,
  FaceTracker,
  FaceTrackerDeps,
  PhysicalWindow,
  TrackerConfig,
  TrackerDiagnostics,
} from './FaceTracker';
export type { CalibrationValues } from './calibration';
export { AutoCalibrationPolicy, type AutoCalibrationAction, type AutoCalibrationInput } from './autoCalibration';
export { baselineWrites, clearHeadBaselineWrites, headBiasFor } from './baseline';
export { ROTATED, WAITING_CAMERA, type CountdownFailure } from './countdown';
export { effectiveCapture, readDeviceInfo, type DeviceInfo, type EffectiveCapture } from './devicePolicy';
export type { BackendKind, ProbeAttempt } from './inference/backends';
export { REFERENCE_FRAME_WIDTH, REFERENCE_IPD_M } from './landmarks';
