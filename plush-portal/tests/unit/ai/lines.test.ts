import { describe, expect, it } from 'vitest';
import { GUIDE_EVENT_TYPES, type GuideEvent, type GuideEventType, type GuideFacts } from '../../../src/core/contracts';
import { makeRng } from '../../../src/core/math';
import { LANGS, THEME_IDS, type Lang, type ThemeId } from '../../../src/core/types';
import {
  LINE_BANKS,
  LINE_KEYS,
  directionKey,
  localCandidates,
  pickLocalLine,
  resolveSituation,
} from '../../../src/ai/lines';
import { DIR_KEYS } from '../../../src/ai/lines/types';
import { LENGTH_RULES, countUnits } from '../../../src/ai/textLength';

const TOY_NAME: Record<Lang, string> = { en: 'Cream Bunny', zh: '奶油长耳兔', ja: 'クリームうさぎ' };
const NEAR_NAME: Record<Lang, string> = { en: 'Sakura Cat', zh: '樱花猫', ja: 'さくらねこ' };

const baseFacts = (extra: Partial<GuideFacts> = {}): GuideFacts => ({
  phase: 'RESULT',
  demo: false,
  attempts: 3,
  wins: 1,
  lossStreak: 1,
  ...extra,
});

const makeEvent = (type: GuideEventType, themeId: ThemeId, facts: Partial<GuideFacts> = {}): GuideEvent => ({
  type,
  roundId: 7,
  themeId,
  facts: baseFacts(facts),
});

/** Fact variants that select different pools, per event type. */
function variants(type: GuideEventType, lang: Lang): Partial<GuideFacts>[] {
  const toy = { typeId: 'cream_bunny', name: TOY_NAME[lang], kind: 'bunny' };
  switch (type) {
    case 'empty_grab':
      return [
        { outcome: 'empty', contact: 'none', nearest: { dx: 0.09, dz: 0.0, dist: 0.09, name: NEAR_NAME[lang] } },
        { outcome: 'empty', contact: 'none', nearest: { dx: -0.02, dz: -0.1, dist: 0.1, name: NEAR_NAME[lang] } },
        { outcome: 'empty', contact: 'none', nearest: { dx: 0.07, dz: 0.07, dist: 0.1, name: '' } },
        { outcome: 'empty', contact: 'none', nearest: null },
        { outcome: 'empty', contact: 'touched' },
        { outcome: 'empty', contact: 'none', demo: true },
      ];
    case 'slipped_after_grip':
      return [
        ...(['eccentric', 'weak_support', 'contact_lost', 'transport_swing', 'overload', 'bounced_out'] as const).map((slipReason) => ({
          outcome: 'slipped' as const,
          contact: 'lifted' as const,
          slipReason,
          toy,
        })),
        { outcome: 'slipped', contact: 'gripped', slipReason: null, toy },
        { outcome: 'slipped', contact: 'lifted', slipReason: 'overload', demo: true },
      ];
    case 'prize_won':
      return [
        { outcome: 'won', toy, newCharacter: false },
        { outcome: 'won', toy, newCharacter: true },
        { outcome: 'won', toy: null },
        { outcome: 'won', toy, demo: true },
      ];
    case 'idle_hint':
    case 'user_requested_tip':
      return [{ headTracking: false }, { headTracking: true }];
    case 'retry_prompt':
      return [{ lossStreak: 0 }, { lossStreak: 4 }];
    default:
      return [{}];
  }
}

describe('local line bank: structure', () => {
  it('has every pool and every direction phrase in every language', () => {
    for (const lang of LANGS) {
      const bank = LINE_BANKS[lang];
      for (const key of LINE_KEYS) {
        expect(bank.lines[key], `${lang}:${key}`).toBeDefined();
        expect(bank.lines[key].all.length, `${lang}:${key} needs at least two generic lines`).toBeGreaterThanOrEqual(2);
      }
      for (const dir of DIR_KEYS) expect(bank.dir[dir], `${lang}:dir.${dir}`).toBeTruthy();
      expect(bank.toyFallback).toBeTruthy();
    }
  });

  it('uses only known placeholders and the same pools across languages', () => {
    for (const lang of LANGS) {
      for (const key of LINE_KEYS) {
        const pool = LINE_BANKS[lang].lines[key];
        const entries = [...pool.all, ...THEME_IDS.flatMap((theme) => pool[theme] ?? [])];
        for (const [template, emotion] of entries) {
          for (const match of template.matchAll(/\{(\w+)\}/g)) expect(['toy', 'dir', 'near']).toContain(match[1]);
          expect(['happy', 'cheer', 'think', 'oops', 'calm']).toContain(emotion);
        }
        // Theme flavour exists in the same places in every language.
        const themed = THEME_IDS.filter((theme) => (pool[theme]?.length ?? 0) > 0).join(',');
        const themedEn = THEME_IDS.filter((theme) => (LINE_BANKS.en.lines[key][theme]?.length ?? 0) > 0).join(',');
        expect(themed, `${lang}:${key} theme coverage`).toBe(themedEn);
      }
    }
  });

  it('has dedicated theme lines for every theme where a theme matters', () => {
    for (const lang of LANGS) {
      for (const key of ['welcome', 'first_play', 'idle', 'aim', 'grab', 'win', 'win.new', 'theme', 'retry', 'tip'] as const) {
        for (const theme of THEME_IDS) {
          expect(LINE_BANKS[lang].lines[key][theme]?.length ?? 0, `${lang}:${key}:${theme}`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe('local line bank: coverage and length', () => {
  it('offers several lines for every event × theme × language × situation', () => {
    for (const lang of LANGS) {
      for (const theme of THEME_IDS) {
        for (const type of GUIDE_EVENT_TYPES) {
          for (const facts of variants(type, lang)) {
            const candidates = localCandidates(makeEvent(type, theme, facts), lang);
            expect(candidates.length, `${lang}/${theme}/${type}/${JSON.stringify(facts)}`).toBeGreaterThanOrEqual(2);
            for (const c of candidates) {
              expect(c.text).not.toMatch(/[{}]/);
              expect(c.text.trim()).toBe(c.text);
            }
          }
        }
      }
    }
  });

  it('keeps every line inside the short-line limits', () => {
    const bounds: Record<Lang, [number, number]> = {
      en: [6, LENGTH_RULES.short.en.targetMax + 2],
      zh: [8, LENGTH_RULES.short.zh.targetMax + 2],
      ja: [10, LENGTH_RULES.short.ja.targetMax + 2],
    };
    for (const lang of LANGS) {
      const [min, max] = bounds[lang];
      const seen = new Set<string>();
      const lengths: number[] = [];
      for (const theme of THEME_IDS) {
        for (const type of GUIDE_EVENT_TYPES) {
          for (const facts of variants(type, lang)) {
            for (const c of localCandidates(makeEvent(type, theme, facts), lang)) {
              if (seen.has(c.text)) continue;
              seen.add(c.text);
              const units = countUnits(c.text, lang);
              lengths.push(units);
              expect(units, `${lang}: "${c.text}" has ${units} units`).toBeGreaterThanOrEqual(min);
              expect(units, `${lang}: "${c.text}" has ${units} units`).toBeLessThanOrEqual(max);
              // Must also survive the hard limit the server applies to model output.
              expect(units).toBeLessThanOrEqual(LENGTH_RULES.short[lang].hardMax);
            }
          }
        }
      }
      lengths.sort((a, b) => a - b);
      const median = lengths[Math.floor(lengths.length / 2)]!;
      expect(median, `${lang} median length`).toBeGreaterThanOrEqual(LENGTH_RULES.short[lang].targetMin);
      expect(median, `${lang} median length`).toBeLessThanOrEqual(LENGTH_RULES.short[lang].targetMax);
      expect(seen.size, `${lang} distinct lines`).toBeGreaterThan(100);
    }
  });
});

describe('local line bank: honesty rules', () => {
  const CLOSE_CALL: Record<Lang, RegExp> = {
    en: /so close|almost|nearly|just missed/i,
    zh: /差一点|差点|好可惜|就差/,
    ja: /おしい|あと少し|あとちょっと|ざんねん/,
  };
  const PROMISE: Record<Lang, RegExp> = {
    en: /guarantee|definitely|for sure|will surely|bound to win|you(?:'ll| will) (?:win|get it|catch it)/i,
    zh: /一定(能|会)|保证|肯定(能|会)|必中|稳赢/,
    ja: /必ず|ぜったい|絶対|まちがいなく/,
  };

  it('never says "so close" when nothing was touched', () => {
    for (const lang of LANGS) {
      for (const theme of THEME_IDS) {
        for (const nearest of [{ dx: 0.1, dz: 0, dist: 0.1, name: NEAR_NAME[lang] }, null]) {
          const event = makeEvent('empty_grab', theme, { outcome: 'empty', contact: 'none', nearest });
          for (const c of localCandidates(event, lang)) expect(c.text, c.text).not.toMatch(CLOSE_CALL[lang]);
        }
      }
    }
  });

  it('uses close-call wording after real contact', () => {
    for (const lang of LANGS) {
      const touched = localCandidates(makeEvent('empty_grab', 'sakura', { outcome: 'empty', contact: 'touched' }), lang);
      expect(touched.every((c) => c.key === 'empty.touched')).toBe(true);
      expect(touched.some((c) => CLOSE_CALL[lang].test(c.text))).toBe(true);
    }
  });

  it('never promises a win', () => {
    for (const lang of LANGS) {
      for (const key of LINE_KEYS) {
        const pool = LINE_BANKS[lang].lines[key];
        for (const [template] of [...pool.all, ...THEME_IDS.flatMap((theme) => pool[theme] ?? [])]) {
          expect(template, template).not.toMatch(PROMISE[lang]);
        }
      }
    }
  });

  it('does not claim a collection entry for demo rounds', () => {
    for (const lang of LANGS) {
      const toy = { typeId: 't', name: TOY_NAME[lang], kind: 'bunny' };
      const demo = localCandidates(makeEvent('prize_won', 'ocean', { outcome: 'won', toy, demo: true }), lang);
      expect(demo.every((c) => c.key === 'win.demo')).toBe(true);
      for (const c of demo) expect(c.text).not.toContain(TOY_NAME[lang]);
    }
  });

  it('mentions the toy by name on a win and flags new characters', () => {
    for (const lang of LANGS) {
      const toy = { typeId: 't', name: TOY_NAME[lang], kind: 'bunny' };
      const win = localCandidates(makeEvent('prize_won', 'cosmic', { outcome: 'won', toy, newCharacter: false }), lang);
      expect(win.every((c) => c.key === 'win' && c.text.includes(TOY_NAME[lang]))).toBe(true);
      const fresh = localCandidates(makeEvent('prize_won', 'cosmic', { outcome: 'won', toy, newCharacter: true }), lang);
      expect(fresh.every((c) => c.key === 'win.new' && c.text.includes(TOY_NAME[lang]))).toBe(true);
      // No name from the game: a neutral stand-in is used instead of an empty slot.
      const anonymous = localCandidates(makeEvent('prize_won', 'cosmic', { outcome: 'won', toy: null }), lang);
      expect(anonymous.every((c) => c.text.includes(LINE_BANKS[lang].toyFallback))).toBe(true);
    }
  });
});

describe('direction hints', () => {
  it('follows the sign conventions of facts.nearest', () => {
    expect(directionKey({ dx: 0.1, dz: 0 })).toBe('right'); // toy is to the player's right
    expect(directionKey({ dx: -0.1, dz: 0.01 })).toBe('left');
    expect(directionKey({ dx: 0, dz: 0.1 })).toBe('front'); // +dz = closer to the player
    expect(directionKey({ dx: 0.01, dz: -0.1 })).toBe('back');
    expect(directionKey({ dx: 0.08, dz: -0.07 })).toBe('right_back');
    expect(directionKey({ dx: -0.06, dz: 0.09 })).toBe('left_front');
    expect(directionKey({ dx: -0.09, dz: -0.08 })).toBe('left_back');
    expect(directionKey({ dx: 0.07, dz: 0.07 })).toBe('right_front');
  });

  it('gives no direction when the claw was on target or the offset is unusable', () => {
    expect(directionKey({ dx: 0.005, dz: -0.01 })).toBeNull();
    expect(directionKey(null)).toBeNull();
    expect(directionKey(undefined)).toBeNull();
    expect(directionKey({ dx: Number.NaN, dz: 0.2 })).toBeNull();
  });

  const WORDS: Record<Lang, { right: string; left: string; back: string; front: string }> = {
    en: { right: 'right', left: 'left', back: 'back', front: 'front' },
    zh: { right: '往右', left: '往左', back: '往里', front: '往前' },
    ja: { right: '右', left: '左', back: '奥', front: '手前' },
  };

  it('puts the matching direction into every hint line', () => {
    const cases: { dx: number; dz: number; want: ('right' | 'left' | 'back' | 'front')[] }[] = [
      { dx: 0.12, dz: 0.01, want: ['right'] },
      { dx: -0.12, dz: -0.01, want: ['left'] },
      { dx: 0.0, dz: -0.12, want: ['back'] },
      { dx: 0.01, dz: 0.12, want: ['front'] },
      { dx: 0.09, dz: -0.09, want: ['right', 'back'] },
      { dx: -0.09, dz: 0.09, want: ['left', 'front'] },
    ];
    for (const lang of LANGS) {
      for (const { dx, dz, want } of cases) {
        const event = makeEvent('empty_grab', 'storybook', {
          outcome: 'empty',
          contact: 'none',
          nearest: { dx, dz, dist: Math.hypot(dx, dz), name: NEAR_NAME[lang] },
        });
        const candidates = localCandidates(event, lang);
        expect(candidates.length).toBeGreaterThanOrEqual(4);
        const opposite = (['right', 'left', 'back', 'front'] as const).filter((d) => !want.includes(d));
        for (const c of candidates) {
          expect(c.key).toBe('empty.dir');
          for (const d of want) expect(c.text, `${lang} ${dx},${dz}: ${c.text}`).toContain(WORDS[lang][d]);
          for (const d of opposite) expect(c.text, `${lang} ${dx},${dz}: ${c.text}`).not.toContain(WORDS[lang][d]);
        }
      }
    }
  });

  it('only names the nearest toy when the game supplied its name', () => {
    for (const lang of LANGS) {
      const withName = localCandidates(
        makeEvent('empty_grab', 'sakura', { contact: 'none', nearest: { dx: 0.1, dz: 0, dist: 0.1, name: NEAR_NAME[lang] } }),
        lang,
      );
      const withoutName = localCandidates(
        makeEvent('empty_grab', 'sakura', { contact: 'none', nearest: { dx: 0.1, dz: 0, dist: 0.1, name: '' } }),
        lang,
      );
      expect(withName.some((c) => c.text.includes(NEAR_NAME[lang]))).toBe(true);
      expect(withoutName.length).toBe(withName.length - 1);
    }
  });
});

describe('slip reasons', () => {
  it('has specific lines for every known reason, including bounced_out', () => {
    for (const lang of LANGS) {
      for (const reason of ['eccentric', 'weak_support', 'contact_lost', 'transport_swing', 'overload', 'bounced_out'] as const) {
        const event = makeEvent('slipped_after_grip', 'ocean', { outcome: 'slipped', contact: 'lifted', slipReason: reason });
        expect(resolveSituation(event).keys).toEqual([`slip.${reason}`]);
        expect(localCandidates(event, lang).length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('falls back to generic lines for reasons this build does not know', () => {
    for (const lang of LANGS) {
      const unknown = makeEvent('slipped_after_grip', 'ocean', {
        outcome: 'slipped',
        contact: 'lifted',
        slipReason: 'some_future_reason' as never,
      });
      expect(resolveSituation(unknown).keys).toEqual(['slip.generic']);
      expect(localCandidates(unknown, lang).length).toBeGreaterThanOrEqual(3);
      const none = makeEvent('slipped_after_grip', 'ocean', { outcome: 'slipped', contact: 'gripped', slipReason: null });
      expect(resolveSituation(none).keys).toEqual(['slip.generic']);
      expect(() => pickLocalLine(unknown, lang)).not.toThrow();
    }
  });
});

describe('pickLocalLine', () => {
  it('avoids recently used lines while alternatives exist', () => {
    const event = makeEvent('aim_help', 'sakura');
    const all = localCandidates(event, 'en');
    const recent: string[] = [];
    const seen = new Set<string>();
    const rng = makeRng(42);
    for (let i = 0; i < all.length; i++) {
      const line = pickLocalLine(event, 'en', { recent, rng });
      expect(seen.has(line.text), `repeated "${line.text}" after ${i} picks`).toBe(false);
      seen.add(line.text);
      recent.push(line.text);
    }
    // Everything was used once: the bank still answers instead of going silent.
    expect(pickLocalLine(event, 'en', { recent, rng }).text.length).toBeGreaterThan(0);
  });

  it('is deterministic for a seeded random source', () => {
    const event = makeEvent('welcome', 'cosmic');
    const a = pickLocalLine(event, 'ja', { rng: makeRng(7) });
    const b = pickLocalLine(event, 'ja', { rng: makeRng(7) });
    expect(a).toEqual(b);
  });

  it('answers a theme change in the voice of the new theme', () => {
    for (const lang of LANGS) {
      for (const theme of THEME_IDS) {
        const themed = new Set((LINE_BANKS[lang].lines.theme[theme] ?? []).map(([text]) => text));
        const candidates = localCandidates(makeEvent('theme_changed', theme), lang);
        expect(candidates.length).toBeGreaterThanOrEqual(3);
        for (const c of candidates) expect(themed.has(c.text)).toBe(true);
      }
    }
  });

  it('adds head-tracking hints only when tracking is on', () => {
    const off = localCandidates(makeEvent('idle_hint', 'sakura', { headTracking: false }), 'en');
    const on = localCandidates(makeEvent('idle_hint', 'sakura', { headTracking: true }), 'en');
    expect(off.some((c) => c.key === 'idle.tracking')).toBe(false);
    expect(on.some((c) => c.key === 'idle.tracking')).toBe(true);
  });

  it('switches to streak advice after several losses', () => {
    expect(resolveSituation(makeEvent('retry_prompt', 'sakura', { lossStreak: 1 })).keys).toEqual(['retry']);
    expect(resolveSituation(makeEvent('retry_prompt', 'sakura', { lossStreak: 3 })).keys).toEqual(['retry.streak']);
  });
});
