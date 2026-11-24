/**
 * Upgrade of stored / imported settings for the AI guide. Pure functions: the
 * settings store applies them to the raw payload before sanitising.
 */

/**
 * Settings data written before `ai.voiceLanguage` existed carried `ai.language`
 * ('ui' | 'en' | 'zh' | 'ja', default 'ui'). The new model has one control:
 * English (default) or the interface language. An explicit Chinese / Japanese
 * choice that matched the interface becomes 'ui'; everything else, including
 * the old default 'ui', becomes the new default 'en'. Returns the payload with
 * `ai.voiceLanguage` filled in (input is not modified). Pure: the settings
 * store calls it on load / import before sanitising.
 */
export function migrateGuideLanguage(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const settings = payload as { ai?: unknown; system?: unknown };
  const ai = settings.ai;
  if (!ai || typeof ai !== 'object' || Array.isArray(ai)) return payload;
  const record = ai as Record<string, unknown>;
  if (record.voiceLanguage !== undefined || record.language === undefined) return payload;
  const uiLang = settings.system && typeof settings.system === 'object' ? (settings.system as { language?: unknown }).language : undefined;
  const voiceLanguage = (record.language === 'zh' || record.language === 'ja') && record.language === uiLang ? 'ui' : 'en';
  return { ...settings, ai: { ...record, voiceLanguage } };
}
