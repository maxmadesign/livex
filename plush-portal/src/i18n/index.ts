import type { Lang } from '../core/types';

/** One namespace of UI strings: the same keys for every language. */
export type StringTable = Record<Lang, Record<string, string>>;

const tables: StringTable = { en: {}, zh: {}, ja: {} };
const missing = new Set<string>();

/** Adds a namespace. Later registrations win, which lets tests override strings. */
export function registerStrings(table: StringTable): void {
  for (const lang of Object.keys(tables) as Lang[]) Object.assign(tables[lang], table[lang]);
}

/**
 * Looks up `key` in `lang`, falling back to English and finally to the key
 * itself. `{name}` placeholders are replaced from `params`.
 */
export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let text = tables[lang][key] ?? tables.en[key];
  if (text === undefined) {
    if (!missing.has(key)) {
      missing.add(key);
      if (import.meta.env?.DEV) console.warn(`[i18n] missing string: ${key}`);
    }
    text = key;
  }
  if (params) {
    for (const name of Object.keys(params)) text = text.split(`{${name}}`).join(String(params[name]));
  }
  return text;
}

export function hasString(lang: Lang, key: string): boolean {
  return tables[lang][key] !== undefined;
}

/** Keys that exist in English but not in `lang` (used by the i18n completeness test). */
export function missingKeys(lang: Lang): string[] {
  return Object.keys(tables.en).filter((key) => tables[lang][key] === undefined);
}

export const LANGUAGE_NAMES: Record<Lang, string> = { en: 'English', zh: '简体中文', ja: '日本語' };
