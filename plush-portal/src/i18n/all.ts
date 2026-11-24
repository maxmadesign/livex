import { registerStrings, type StringTable } from './index';
import { aiStrings } from './strings/ai';
import { attractStrings } from './strings/attract';
import { audioStrings } from './strings/audio';
import { calibrationStrings } from './strings/calibration';
import { fxStrings } from './strings/fx';
import { graphicsStrings } from './strings/graphics';
import { gpuStrings } from './strings/gpu';
import { mobileStrings } from './strings/mobile';
import { scoreStrings } from './strings/score';
import { settingsEn } from './strings/settings.en';
import { settingsJa } from './strings/settings.ja';
import { settingsZh } from './strings/settings.zh';
import { trackingStrings } from './strings/tracking';
import { uiEn } from './strings/ui.en';
import { uiJa } from './strings/ui.ja';
import { uiZh } from './strings/ui.zh';

let registered = false;

/** Registers every string namespace once. */
export function registerAllStrings(): void {
  if (registered) return;
  registered = true;
  const core: StringTable = {
    en: { ...uiEn, ...settingsEn },
    zh: { ...uiZh, ...settingsZh },
    ja: { ...uiJa, ...settingsJa },
  };
  registerStrings(core);
  registerStrings(aiStrings);
  registerStrings(audioStrings);
  registerStrings(trackingStrings);
  // Feature namespaces (one owner each).
  registerStrings(scoreStrings);
  registerStrings(attractStrings);
  registerStrings(mobileStrings);
  registerStrings(calibrationStrings);
  registerStrings(gpuStrings);
  registerStrings(fxStrings);
  registerStrings(graphicsStrings);
}

/** Every feature namespace registered above, by name (used by the i18n tests). */
export const FEATURE_STRING_TABLES: Record<string, StringTable> = {
  score: scoreStrings,
  attract: attractStrings,
  mobile: mobileStrings,
  calibration: calibrationStrings,
  gpu: gpuStrings,
  fx: fxStrings,
};
