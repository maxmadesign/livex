import { describe, expect, it } from 'vitest';
import { settingsEn } from '../../../src/i18n/strings/settings.en';
import { settingsJa } from '../../../src/i18n/strings/settings.ja';
import { settingsZh } from '../../../src/i18n/strings/settings.zh';
import { uiEn } from '../../../src/i18n/strings/ui.en';
import { uiJa } from '../../../src/i18n/strings/ui.ja';
import { uiZh } from '../../../src/i18n/strings/ui.zh';

type Table = Record<string, string>;

const NAMESPACES: { name: string; en: Table; zh: Table; ja: Table }[] = [
  { name: 'ui', en: uiEn, zh: uiZh, ja: uiJa },
  { name: 'settings', en: settingsEn, zh: settingsZh, ja: settingsJa },
];

/** Hiragana and katakana (including the prolonged sound mark and the katakana middle dot). */
const KANA = /[぀-ゟ゠-ヿ]/;
/** English sentences at least this long must be genuinely translated. */
const LONG_SENTENCE = 40;

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]!).sort();
}

function keyDiff(source: Table, translation: Table): { missing: string[]; extra: string[] } {
  const src = new Set(Object.keys(source));
  const dst = new Set(Object.keys(translation));
  return {
    missing: [...src].filter((key) => !dst.has(key)).sort(),
    extra: [...dst].filter((key) => !src.has(key)).sort(),
  };
}

describe('i18n completeness', () => {
  it('has English strings to translate', () => {
    for (const ns of NAMESPACES) expect(Object.keys(ns.en).length, `${ns.name}.en`).toBeGreaterThan(50);
  });

  for (const ns of NAMESPACES) {
    for (const lang of ['zh', 'ja'] as const) {
      const table = ns[lang];
      const label = `${ns.name}.${lang}`;

      describe(label, () => {
        it('has exactly the same keys as English', () => {
          const { missing, extra } = keyDiff(ns.en, table);
          // Printed in full so a newly added English key is easy to spot.
          expect({ missing, extra }, `${label}: missing = keys to translate, extra = keys to remove`).toEqual({ missing: [], extra: [] });
        });

        it('has no empty strings', () => {
          const empty = Object.entries(table)
            .filter(([, text]) => typeof text !== 'string' || text.trim().length === 0)
            .map(([key]) => key);
          expect(empty, `${label}: empty strings`).toEqual([]);
        });

        it('keeps every {placeholder} of the English string', () => {
          const broken: string[] = [];
          for (const [key, english] of Object.entries(ns.en)) {
            const translated = table[key];
            if (translated === undefined) continue; // reported by the key-set test
            const want = placeholders(english);
            const have = placeholders(translated);
            if (want.join(',') !== have.join(',')) broken.push(`${key}: expected {${want.join('}, {')}} got {${have.join('}, {')}}`);
          }
          expect(broken, `${label}: placeholder mismatches`).toEqual([]);
        });

        it('does not leave long English sentences untranslated', () => {
          const untranslated = Object.entries(ns.en)
            .filter(([key, english]) => english.length >= LONG_SENTENCE && table[key] === english)
            .map(([key]) => key);
          expect(untranslated, `${label}: identical to English`).toEqual([]);
        });
      });
    }

    describe(`${ns.name} zh / ja sanity`, () => {
      it('Chinese strings contain no Japanese kana', () => {
        const withKana = Object.entries(ns.zh)
          .filter(([, text]) => KANA.test(text))
          .map(([key, text]) => `${key}: ${text}`);
        expect(withKana, `${ns.name}.zh: kana found (copy-paste from ja?)`).toEqual([]);
      });

      it('Japanese long sentences are not copies of the Chinese ones and are written with kana', () => {
        const longKeys = Object.keys(ns.en).filter((key) => ns.en[key]!.length >= LONG_SENTENCE && ns.ja[key] !== undefined && ns.zh[key] !== undefined);
        expect(longKeys.length, `${ns.name}: sample of long sentences`).toBeGreaterThan(5);
        const copies = longKeys.filter((key) => ns.ja[key] === ns.zh[key]);
        expect(copies, `${ns.name}.ja identical to ${ns.name}.zh`).toEqual([]);
        const noKana = longKeys.filter((key) => !KANA.test(ns.ja[key]!));
        expect(noKana, `${ns.name}.ja: long sentences without any kana`).toEqual([]);
      });
    });
  }

  it('keeps language names in their own language', () => {
    for (const table of [settingsEn, settingsZh, settingsJa]) {
      expect(table['set.system.language.o.en']).toBe('English');
      expect(table['set.system.language.o.zh']).toBe('简体中文');
      expect(table['set.system.language.o.ja']).toBe('日本語');
      expect(table['set.ai.language.o.en']).toBe('English');
      expect(table['set.ai.language.o.zh']).toBe('简体中文');
      expect(table['set.ai.language.o.ja']).toBe('日本語');
    }
  });

  it('keeps the product name untouched', () => {
    for (const table of [uiEn, uiZh, uiJa]) expect(table['app.title']).toBe('PLUSH PORTAL');
  });
});
