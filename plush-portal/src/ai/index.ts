/**
 * AI guide "Momo": event intake, GPT text through the server proxy, local line
 * bank, speech paths (AI voice / system voice / babble) and status reporting.
 */
export { createGuide, type Guide } from './createGuide';
export {
  GuideDirector,
  GUIDE_PRIORITY,
  GUIDE_COOLDOWN_MS,
  FREQUENCY_SCALE,
  STATUS_FIRST_TIMEOUT_MS,
  STATUS_TIMEOUT_MS,
  STATUS_RETRY_DELAYS_MS,
  guideLanguage,
  type GuideConfig,
  type GuideDeps,
  type GuideStats,
} from './GuideDirector';
export {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_PERSONA,
  LANGUAGE_PROMPT_NAMES,
  THEME_PROMPT_INFO,
  buildInstructions,
  buildLineInput,
  buildOutputRules,
  buildVoiceStyle,
  describeSlipReason,
  sanitizeFacts,
} from './prompt';
export { pickLocalLine, localCandidates, resolveSituation, directionKey, LINE_BANKS, LINE_KEYS } from './lines';
export type { LocalLine, LineKey, DirKey } from './lines';
export { LENGTH_RULES, countUnits, fitLine, normalizeLineText, displayDurationMs } from './textLength';
export { LineCache, LINE_CACHE_STORAGE_KEY, lineCacheKey, factsCacheKey, type CacheMode, type StorageLike } from './cache';
export { planBabble, renderBabble, synthesizeBabble } from './speech/babbleSynth';
export { SpeechRouter } from './speech/router';
export type { SpeechPath, SpeechPlayback, SpeechProvider, SpeechRequest } from './speech/types';
export { fetchKeyStatus, saveKey, testKey, restoreDefaultKey, type KeyCallResult, type KeyClientOptions } from './keyClient';
export { migrateGuideLanguage } from './settingsMigration';
export * from './protocol';
