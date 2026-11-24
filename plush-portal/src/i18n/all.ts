import { registerStrings, type StringTable } from './index';
import { aiStrings } from './strings/ai';
import { audioStrings } from './strings/audio';
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
}
