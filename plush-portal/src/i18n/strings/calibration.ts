import type { StringTable } from '../index';

/** Strings owned by the camera calibration countdown overlay. */
export const calibrationStrings: StringTable = {
  en: {
    'calibration.title': 'Look at the screen',
    'calibration.countdown': 'Hold still… {seconds}',
    'calibration.done': 'Calibrated',
    'calibration.failed': 'Could not see your face. Try again.',
  },
  zh: {
    'calibration.title': '请看向屏幕',
    'calibration.countdown': '保持不动… {seconds}',
    'calibration.done': '校准完成',
    'calibration.failed': '没有看到你的脸，请再试一次。',
  },
  ja: {
    'calibration.title': '画面を見てください',
    'calibration.countdown': 'そのまま動かないで… {seconds}',
    'calibration.done': 'キャリブレーション完了',
    'calibration.failed': '顔が見つかりませんでした。もう一度お試しください。',
  },
};
