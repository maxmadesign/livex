import type { HudLayout } from '../layout/solve';

/**
 * Camera calibration countdown: shows the tracker's `status().calibration` (countdown, capture,
 * done / failed) after TrackerPort.startCalibration. Mounted above the HUD and below dialogs
 * (src/ui/App.tsx). Styles: src/ui/calibration.css. Strings: src/i18n/strings/calibration.ts.
 * Placeholder: renders nothing yet.
 */
export function CalibrationOverlay(_props: { layout: HudLayout }) {
  return null;
}
