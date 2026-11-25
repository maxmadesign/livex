import { describe, expect, it } from 'vitest';
import { LANGS } from '../../../src/core/types';
import { hasString, translate } from '../../../src/i18n';
import { FEATURE_STRING_TABLES, registerAllStrings } from '../../../src/i18n/all';

registerAllStrings();

const placeholders = (text: string) => [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]!).sort().join(',');

describe('feature string namespaces', () => {
  it('exist for every feature namespace added since the first round', () => {
    expect(Object.keys(FEATURE_STRING_TABLES).sort()).toEqual(['attract', 'calibration', 'frame', 'fx', 'gpu', 'graphics', 'machines', 'mobile', 'score']);
  });

  for (const [name, table] of Object.entries(FEATURE_STRING_TABLES)) {
    describe(name, () => {
      it('has at least one key, the same keys in every language, all prefixed and non-empty', () => {
        const reference = Object.keys(table.en).sort();
        expect(reference.length).toBeGreaterThan(0);
        for (const lang of LANGS) {
          expect(Object.keys(table[lang]).sort(), `${name}.${lang}`).toEqual(reference);
          for (const key of reference) {
            // A feature's own keys, or the labels of settings in its spec section (`set.<name>.…`).
            expect(key.startsWith(`${name}.`) || key.startsWith(`set.${name}.`), key).toBe(true);
            expect(table[lang][key]!.trim().length, `${lang}:${key}`).toBeGreaterThan(0);
            expect(placeholders(table[lang][key]!), `${lang}:${key}`).toBe(placeholders(table.en[key]!));
          }
        }
      });

      it('is registered', () => {
        for (const lang of LANGS) {
          for (const key of Object.keys(table.en)) {
            expect(hasString(lang, key), `${lang}:${key}`).toBe(true);
            expect(translate(lang, key)).toBe(table[lang][key]);
          }
        }
      });
    });
  }
});
