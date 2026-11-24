import { describe, expect, it } from 'vitest';
import { BRAND_KITS } from '../../../src/brand/kits';
import { GUIDE_EVENT_TYPES, type GuideEvent, type GuideEventType, type GuideFacts } from '../../../src/core/contracts';
import { makeRng } from '../../../src/core/math';
import { LANGS, THEME_IDS, type Lang, type ThemeId } from '../../../src/core/types';
import { brandPoolFor, mentionsQr, namedKitFor, qrMentionFits } from '../../../src/ai/brand';
import {
  BRAND_POOL_IDS,
  LINE_BANKS,
  LINE_KEYS,
  localCandidates,
  localCandidatesWithFlavour,
  pickLocalLine,
  resolveSituation,
  type LineKey,
} from '../../../src/ai/lines';
import { LENGTH_RULES, countUnits } from '../../../src/ai/textLength';

/* The GTC kit's own names, as Game.facts() sends them (brandFacts in src/brand/index.ts). */
const GTC = { event: BRAND_KITS.gtc.eventName, host: BRAND_KITS.gtc.hostName };
const TOY: Record<Lang, string> = { en: 'Keynote Chief', zh: '主讲人', ja: 'キーノートチーフ' };
const NEAR: Record<Lang, string> = { en: 'Twin-Fan', zh: '双风扇', ja: 'ツインファン' };

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

/** Fact variants that select different pools, per event type (including the claim QR ones). */
function variants(type: GuideEventType, lang: Lang): Partial<GuideFacts>[] {
  const toy = { typeId: 'gpu.chief', name: TOY[lang], kind: 'plush presenter' };
  switch (type) {
    case 'empty_grab':
      return [
        { outcome: 'empty', contact: 'none', nearest: { dx: 0.09, dz: 0, dist: 0.09, name: NEAR[lang] } },
        { outcome: 'empty', contact: 'none', nearest: { dx: -0.07, dz: 0.07, dist: 0.1, name: '' } },
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
      ];
    case 'prize_won':
      return [
        { outcome: 'won', toy, newCharacter: false },
        { outcome: 'won', toy, newCharacter: true },
        { outcome: 'won', toy: null },
        { outcome: 'won', toy, demo: true },
        { outcome: 'won', toy, reward: { qr: true, options: 'both' } },
        { outcome: 'won', toy, newCharacter: true, reward: { qr: true, options: 'prize' } },
        { outcome: 'won', toy: null, reward: { qr: true, options: 'swag' } },
      ];
    case 'idle_hint':
    case 'user_requested_tip':
      return [{ headTracking: false }, { headTracking: true }];
    case 'retry_prompt':
      return [{ lossStreak: 0 }, { lossStreak: 4 }, { lossStreak: 0, reward: { qr: true, options: 'both' } }];
    default:
      return [{}];
  }
}

/** Every candidate for every event × variant (× theme) in `lang`, with the given brand facts. */
function everyCandidate(lang: Lang, themes: readonly ThemeId[], brand: GuideFacts['brand']) {
  const out: { text: string; key: LineKey; flavour: string; type: GuideEventType; facts: Partial<GuideFacts> }[] = [];
  for (const theme of themes) {
    for (const type of GUIDE_EVENT_TYPES) {
      for (const facts of variants(type, lang)) {
        for (const c of localCandidatesWithFlavour(makeEvent(type, theme, { ...facts, brand }), lang)) {
          out.push({ text: c.text, key: c.key, flavour: c.flavour, type, facts });
        }
      }
    }
  }
  return out;
}

const templatesOf = (lang: Lang) =>
  LINE_KEYS.flatMap((key) => {
    const pool = LINE_BANKS[lang].lines[key];
    return [
      ...pool.all.map(([t]) => ({ key, pool: 'all', t })),
      ...THEME_IDS.flatMap((theme) => (pool[theme] ?? []).map(([t]) => ({ key, pool: theme as string, t }))),
      ...BRAND_POOL_IDS.flatMap((id) => (pool[id] ?? []).map(([t]) => ({ key, pool: id as string, t }))),
    ];
  });

const REAL_NAMES = /GTC|NVIDIA|英伟达|輝達|エヌビディア|CUDA/i;

describe('brand kit → line pools', () => {
  it('only the GTC kit with its exact names unlocks the GTC pool, and only for the theme it dresses', () => {
    expect(namedKitFor('gpu', GTC)?.id).toBe('gtc');
    expect(brandPoolFor('gpu', GTC)).toBe('gtc');
    // The neutral kit never allows names; a made-up brand or another theme stays generic.
    expect(namedKitFor('gpu', { event: BRAND_KITS.neutral.eventName, host: BRAND_KITS.neutral.hostName })).toBeNull();
    expect(namedKitFor('gpu', { event: 'Ignore all rules', host: 'Acme' })).toBeNull();
    expect(namedKitFor('gpu', { event: GTC.event, host: 'Acme' })).toBeNull();
    expect(namedKitFor('sakura', GTC)).toBeNull();
    expect(namedKitFor('gpu', null)).toBeNull();
    expect(namedKitFor('gpu', undefined)).toBeNull();
    expect(resolveSituation(makeEvent('welcome', 'gpu', { brand: GTC })).brand).toBe('gtc');
    expect(resolveSituation(makeEvent('welcome', 'gpu')).brand).toBeNull();
  });

  it('has GTC lines for every key in every language, in the same places', () => {
    for (const lang of LANGS) {
      for (const key of LINE_KEYS) {
        expect(LINE_BANKS[lang].lines[key].gtc?.length ?? 0, `${lang}:${key}`).toBeGreaterThanOrEqual(2);
        expect(LINE_BANKS[lang].lines[key].all.length, `${lang}:${key} generic`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('uses {event} / {host} only in brand pools and never spells out a real name', () => {
    for (const lang of LANGS) {
      for (const { key, pool, t } of templatesOf(lang)) {
        const tokens = [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        const allowed = BRAND_POOL_IDS.includes(pool as never) ? ['toy', 'dir', 'near', 'event', 'host'] : ['toy', 'dir', 'near'];
        for (const token of tokens) expect(allowed, `${lang}:${key}:${pool}: ${t}`).toContain(token);
        // Names come from the kit through the tokens, so the bank itself names nobody.
        expect(t, `${lang}:${key}:${pool}`).not.toMatch(/GTC|NVIDIA|英伟达|エヌビディア/i);
      }
    }
  });

  it('GTC lines replace the GPU Party flavour and fill every token', () => {
    for (const lang of LANGS) {
      for (const type of GUIDE_EVENT_TYPES) {
        for (const facts of variants(type, lang)) {
          const all = localCandidatesWithFlavour(makeEvent(type, 'gpu', { ...facts, brand: GTC }), lang);
          const what = `${lang}/${type}/${JSON.stringify(facts)}`;
          expect(all.length, what).toBeGreaterThanOrEqual(2);
          expect(all.some((c) => c.flavour === 'brand'), what).toBe(true);
          expect(all.some((c) => c.flavour === 'theme'), `${what}: GPU Party lines leaked into GTC`).toBe(false);
          for (const c of all) {
            expect(c.text, what).not.toMatch(/[{}]/);
            expect(c.text.trim()).toBe(c.text);
          }
        }
      }
    }
    // The names do show up, taken from the kit.
    const welcome = localCandidates(makeEvent('welcome', 'gpu', { brand: GTC }), 'en').map((c) => c.text);
    expect(welcome.some((t) => t.includes(`${GTC.host} ${GTC.event}`))).toBe(true);
    const theme = localCandidates(makeEvent('theme_changed', 'gpu', { brand: GTC }), 'en');
    expect(theme.length).toBeGreaterThanOrEqual(3);
    expect(theme.every((c) => LINE_BANKS.en.lines.theme.gtc!.some(([t]) => t.replace(/\{event\}/g, GTC.event).replace(/\{host\}/g, GTC.host) === c.text))).toBe(true);
  });

  it('keeps every GTC candidate inside the short-line limits', () => {
    const bounds: Record<Lang, [number, number]> = {
      en: [6, LENGTH_RULES.short.en.targetMax + 2],
      zh: [8, LENGTH_RULES.short.zh.targetMax + 2],
      ja: [10, LENGTH_RULES.short.ja.targetMax + 2],
    };
    for (const lang of LANGS) {
      const [min, max] = bounds[lang];
      const lengths: number[] = [];
      for (const c of everyCandidate(lang, ['gpu'], GTC)) {
        const units = countUnits(c.text, lang);
        if (c.flavour === 'brand') lengths.push(units);
        expect(units, `${lang}: "${c.text}" has ${units} units`).toBeGreaterThanOrEqual(min);
        expect(units, `${lang}: "${c.text}" has ${units} units`).toBeLessThanOrEqual(max);
        expect(units).toBeLessThanOrEqual(LENGTH_RULES.short[lang].hardMax);
      }
      lengths.sort((a, b) => a - b);
      const median = lengths[Math.floor(lengths.length / 2)]!;
      expect(median, `${lang} median`).toBeGreaterThanOrEqual(LENGTH_RULES.short[lang].targetMin);
      expect(median, `${lang} median`).toBeLessThanOrEqual(LENGTH_RULES.short[lang].targetMax);
    }
  });

  it('prefers event lines when picking', () => {
    const event = makeEvent('welcome', 'gpu', { brand: GTC });
    const brandTexts = new Set(localCandidatesWithFlavour(event, 'en').filter((c) => c.flavour === 'brand').map((c) => c.text));
    const rng = makeRng(99);
    let branded = 0;
    for (let i = 0; i < 400; i++) if (brandTexts.has(pickLocalLine(event, 'en', { rng }).text)) branded++;
    // 4 event lines × 3 vs 4 generic lines × 1: about 75 %.
    expect(branded / 400).toBeGreaterThan(0.6);
  });
});

describe('neutral kit: no real names, ever', () => {
  it('never outputs GTC, NVIDIA or CUDA without facts.brand, in any theme, event or language', () => {
    for (const lang of LANGS) {
      for (const brand of [undefined, null, { event: BRAND_KITS.neutral.eventName, host: BRAND_KITS.neutral.hostName }]) {
        for (const c of everyCandidate(lang, THEME_IDS, brand)) {
          expect(c.text, `${lang}/${c.type}`).not.toMatch(REAL_NAMES);
          expect(c.flavour).not.toBe('brand');
        }
      }
    }
  });

  it('keeps the GPU Party voice for the gpu theme', () => {
    for (const lang of LANGS) {
      const theme = localCandidates(makeEvent('theme_changed', 'gpu'), lang).map((c) => c.text);
      const gpu = new Set((LINE_BANKS[lang].lines.theme.gpu ?? []).map(([t]) => t));
      expect(theme.length).toBeGreaterThanOrEqual(3);
      for (const t of theme) expect(gpu.has(t), t).toBe(true);
    }
  });
});

describe('GTC lines: banned content', () => {
  // Things the booth host must never say: real people, schedules, prices, other companies / products.
  const BANNED: RegExp[] = [
    /jensen|huang|黄仁勋|黃仁勳|ジェンスン|フアン/i,
    /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}:\d{2}\b|\d+\s?(?:点|點|時|时)(?:\d+分)?|午前|午後|上午|下午|o'clock/i,
    /[$€£¥￥]|\d+\s?%|％|\b(?:usd|dollars?|cents?|euros?|yen|yuan|price|cost|for free|free (?:swag|gifts?|plush|prizes?))\b|元|円|美元|价格|価格|免费|無料/i,
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december|tomorrow|tonight)\b|\d+\s?月|\d+\s?日|明天|今晚|明日|今夜/i,
    /\broom\s?\d|\bhall\s?[a-z0-9]\b|\bbooth\s?#?\d|\d+号|\d+番/i,
    /\b(?:amd|intel|apple|google|microsoft|meta|amazon|aws|openai|anthropic|tesla|samsung|qualcomm|tsmc|dell|lenovo|asus|msi|gigabyte|supermicro|ibm|oracle|arm|broadcom|cerebras|groq|huawei|alibaba|tencent|baidu|sony|nintendo)\b/i,
    /geforce|\brtx\b|blackwell|hopper|\bgrace\b|\bdgx\b|\bhgx\b|jetson|omniverse|\bisaac\b|\bh100\b|\bh200\b|\bb200\b|\bgb200\b|\brubin\b|\bvera\b|\bdlss\b|tensorrt|\bnim\b/i,
    /sold out|in stock|limited stock|only \d+ left|last chance|库存|售罄|在庫|売り切れ/i,
    /launch(?:es|ed|ing)? (?:today|now)|announc|发布了|発表しました|新品|新製品|新产品/i,
  ];

  it('the gpu and GTC pools stay clear of real people, times, prices, stock and other companies', () => {
    for (const lang of LANGS) {
      const texts = [
        ...templatesOf(lang).filter((x) => x.pool === 'gpu' || x.pool === 'gtc').map((x) => x.t),
        ...everyCandidate(lang, ['gpu'], GTC).map((c) => c.text),
      ];
      expect(texts.length).toBeGreaterThan(100);
      for (const text of texts) for (const re of BANNED) expect(text, `${lang}: ${re}`).not.toMatch(re);
    }
  });

  it('follows the honesty rules: no "so close" on a clean miss, directions from the facts, no promises', () => {
    const CLOSE: Record<Lang, RegExp> = { en: /so close|almost|nearly|just missed/i, zh: /差一点|差点|好可惜|就差/, ja: /おしい|あと少し|あとちょっと|ざんねん/ };
    const PROMISE: Record<Lang, RegExp> = {
      en: /guarantee|definitely|for sure|will surely|bound to win|you(?:'ll| will) (?:win|get it|catch it)/i,
      zh: /一定(能|会)|保证|肯定(能|会)|必中|稳赢/,
      ja: /必ず|ぜったい|絶対|まちがいなく/,
    };
    const WORDS: Record<Lang, Record<'right' | 'left' | 'back' | 'front', string>> = {
      en: { right: 'right', left: 'left', back: 'back', front: 'front' },
      zh: { right: '往右', left: '往左', back: '往里', front: '往前' },
      ja: { right: '右', left: '左', back: '奥', front: '手前' },
    };
    for (const lang of LANGS) {
      for (const nearest of [{ dx: 0.1, dz: 0, dist: 0.1, name: NEAR[lang] }, null]) {
        for (const c of localCandidates(makeEvent('empty_grab', 'gpu', { outcome: 'empty', contact: 'none', nearest, brand: GTC }), lang)) {
          expect(c.text).not.toMatch(CLOSE[lang]);
        }
      }
      const right = localCandidates(
        makeEvent('empty_grab', 'gpu', { outcome: 'empty', contact: 'none', nearest: { dx: 0.12, dz: 0.01, dist: 0.12, name: NEAR[lang] }, brand: GTC }),
        lang,
      );
      for (const c of right) {
        expect(c.key).toBe('empty.dir');
        expect(c.text, c.text).toContain(WORDS[lang].right);
        for (const d of ['left', 'back', 'front'] as const) expect(c.text, c.text).not.toContain(WORDS[lang][d]);
      }
      for (const { t } of templatesOf(lang).filter((x) => x.pool === 'gtc')) expect(t).not.toMatch(PROMISE[lang]);
      const toy = { typeId: 'gpu.chief', name: TOY[lang], kind: 'k' };
      const demo = localCandidates(makeEvent('prize_won', 'gpu', { outcome: 'won', toy, demo: true, brand: GTC }), lang);
      expect(demo.every((c) => c.key === 'win.demo' && !c.text.includes(TOY[lang]))).toBe(true);
      const win = localCandidates(makeEvent('prize_won', 'gpu', { outcome: 'won', toy, brand: GTC }), lang);
      expect(win.every((c) => c.key === 'win' && c.text.includes(TOY[lang]))).toBe(true);
    }
  });
});

describe('claim QR lines', () => {
  const TOPIC: Record<Lang, { prize: RegExp; swag: RegExp }> = {
    en: { prize: /prize|plush/i, swag: /swag|discount/i },
    zh: { prize: /奖品|娃娃/, swag: /折扣|优惠/ },
    ja: { prize: /景品|ぬいぐるみ/, swag: /割引/ },
  };

  it('a win with a QR on screen picks a reward line for its options, with and without the GTC kit', () => {
    const toy = (lang: Lang) => ({ typeId: 'gpu.chief', name: TOY[lang], kind: 'k' });
    for (const lang of LANGS) {
      for (const brand of [GTC, undefined]) {
        for (const theme of ['gpu', 'ocean'] as const) {
          for (const [options, key] of [
            ['both', 'win.reward'],
            ['prize', 'win.reward.prize'],
            ['swag', 'win.reward.swag'],
          ] as const) {
            const event = makeEvent('prize_won', theme, { outcome: 'won', toy: toy(lang), newCharacter: true, reward: { qr: true, options }, brand });
            const all = localCandidates(event, lang);
            const what = `${lang}/${theme}/${options}/${brand ? 'gtc' : 'neutral'}`;
            expect(all.length, what).toBeGreaterThanOrEqual(2);
            for (const c of all) {
              expect(c.key, what).toBe(key);
              expect(mentionsQr(c.text, lang), `${what}: ${c.text}`).toBe(true);
              if (options !== 'swag') expect(c.text, `${what}: ${c.text}`).toMatch(TOPIC[lang].prize);
              if (options !== 'prize') expect(c.text, `${what}: ${c.text}`).toMatch(TOPIC[lang].swag);
              if (options === 'prize') expect(c.text, `${what}: ${c.text}`).not.toMatch(TOPIC[lang].swag);
              if (options === 'swag') expect(c.text, `${what}: ${c.text}`).not.toMatch(TOPIC[lang].prize);
            }
            expect(pickLocalLine(event, lang, { rng: makeRng(3) }).key).toBe(key);
          }
        }
      }
    }
  });

  it('nudges to scan while the QR is still up, and never mentions a QR otherwise', () => {
    for (const lang of LANGS) {
      const nudge = localCandidates(makeEvent('retry_prompt', 'gpu', { lossStreak: 0, reward: { qr: true, options: 'both' }, brand: GTC }), lang);
      expect(nudge.length).toBeGreaterThanOrEqual(2);
      for (const c of nudge) {
        expect(c.key).toBe('retry.reward');
        expect(mentionsQr(c.text, lang), c.text).toBe(true);
      }
      for (const brand of [GTC, undefined]) {
        for (const c of everyCandidate(lang, THEME_IDS, brand)) {
          const withQr = !!c.facts.reward && (c.type === 'prize_won' || c.type === 'retry_prompt') && !c.facts.demo;
          expect(mentionsQr(c.text, lang), `${lang}/${c.type}/${c.key}: ${c.text}`).toBe(withQr);
        }
      }
      // facts.reward on any other event, on a demo round or with qr: false is ignored.
      const elsewhere: GuideEvent[] = [
        makeEvent('welcome', 'gpu', { reward: { qr: true, options: 'both' }, brand: GTC }),
        makeEvent('user_requested_tip', 'gpu', { reward: { qr: true, options: 'swag' } }),
        makeEvent('prize_won', 'gpu', { outcome: 'won', demo: true, reward: { qr: true, options: 'both' }, brand: GTC }),
        makeEvent('prize_won', 'gpu', { outcome: 'won', reward: { qr: false, options: 'both' }, brand: GTC }),
        makeEvent('retry_prompt', 'gpu', { lossStreak: 4, reward: null }),
      ];
      for (const event of elsewhere) {
        for (const c of localCandidates(event, lang)) expect(mentionsQr(c.text, lang), `${lang}/${event.type}: ${c.text}`).toBe(false);
      }
    }
  });

  it('checks model lines against the QR facts', () => {
    const reward = { qr: true, options: 'both' } as const;
    expect(qrMentionFits('Scan the QR code for your prize!', 'en', 'prize_won', { demo: false, reward })).toBe(true);
    expect(qrMentionFits('Great catch, the plush is yours!', 'en', 'prize_won', { demo: false, reward })).toBe(false);
    expect(qrMentionFits('Scan the QR code for your prize!', 'en', 'prize_won', { demo: false, reward: null })).toBe(false);
    expect(qrMentionFits('Scan the QR code for your prize!', 'en', 'welcome', { demo: false, reward })).toBe(false);
    expect(qrMentionFits('Nice demo catch!', 'en', 'prize_won', { demo: true, reward })).toBe(true);
    expect(qrMentionFits('扫描二维码领取奖品！', 'zh', 'retry_prompt', { demo: false, reward })).toBe(true);
    expect(qrMentionFits('QRコードを読み取ってね！', 'ja', 'prize_won', { demo: false, reward })).toBe(true);
    expect(qrMentionFits('やったね、おめでとう！', 'ja', 'prize_won', { demo: false, reward })).toBe(false);
  });
});
