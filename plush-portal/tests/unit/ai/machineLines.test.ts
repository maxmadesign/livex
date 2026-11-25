import { describe, expect, it } from 'vitest';
import { BRAND_KITS } from '../../../src/brand/kits';
import type { GuideEvent, GuideEventType, GuideFacts } from '../../../src/core/contracts';
import { LANGS, THEME_IDS, type Lang, type ThemeId } from '../../../src/core/types';
import { mentionsQr } from '../../../src/ai/brand';
import { BRIDGE_PROGRESS_GAIN, LINE_BANKS, localCandidates, localCandidatesWithFlavour, resolveSituation, type LineKey } from '../../../src/ai/lines';
import { buildLineInput, describeMachine, sanitizeFacts, sanitizeMachine, taskFor } from '../../../src/ai/prompt';

/** Guide lines and prompt facts of the machines (docs/design/machines.md, section 4.9). */

const GTC = { event: BRAND_KITS.gtc.eventName, host: BRAND_KITS.gtc.hostName };
const MACHINE_KEYS: LineKey[] = [
  'machine.classic',
  'machine.bridge',
  'machine.shelf',
  'machine.rush',
  'bridge.progress',
  'bridge.same',
  'bridge.stuck',
  'shelf.edge',
  'items.one',
  'items.many',
  'time.low',
  'session.over',
  'session.reward',
  'session.rank',
];

const bridge = (extra: Partial<NonNullable<GuideFacts['machine']>> = {}): GuideFacts['machine'] => ({ id: 'bridge', genre: 'bridge', name: 'Tippy Bridge', tries: 2, ...extra });
const shelf = (extra: Partial<NonNullable<GuideFacts['machine']>> = {}): GuideFacts['machine'] => ({ id: 'shelf', genre: 'shelf', name: 'Tumble Shelf', tries: 1, triesLeft: 4, ...extra });
const rush = (extra: Partial<NonNullable<GuideFacts['machine']>> = {}): GuideFacts['machine'] => ({ id: 'rush', genre: 'rush', name: 'Sparkle Rush', tries: 5, secondsLeft: 9, ...extra });

const event = (type: GuideEventType, facts: Partial<GuideFacts> = {}, themeId: ThemeId = 'sakura'): GuideEvent => ({
  type,
  roundId: 4,
  themeId,
  facts: { phase: 'RESULT', demo: false, attempts: 2, wins: 0, lossStreak: 1, ...facts },
});
const keysOf = (e: GuideEvent) => resolveSituation(e).keys;

describe('machine events → line pools', () => {
  it('welcomes each machine with its own pool; classic (no facts.machine) gets the classic one', () => {
    expect(keysOf(event('machine_selected', { machine: bridge() }))).toEqual(['machine.bridge']);
    expect(keysOf(event('machine_selected', { machine: shelf() }))).toEqual(['machine.shelf']);
    expect(keysOf(event('machine_selected', { machine: rush() }))).toEqual(['machine.rush']);
    expect(keysOf(event('machine_selected'))).toEqual(['machine.classic']);
    expect(keysOf(event('machine_selected', { machine: null }))).toEqual(['machine.classic']);
  });

  it('bridge progress: stuck first, then a real gain, else "barely moved"; shelf: a box at the edge', () => {
    expect(keysOf(event('machine_progress', { machine: bridge({ progressGain: 0.3, stuck: true }) }))).toEqual(['bridge.stuck']);
    expect(keysOf(event('machine_progress', { machine: bridge({ progressGain: BRIDGE_PROGRESS_GAIN }) }))).toEqual(['bridge.progress']);
    expect(keysOf(event('machine_progress', { machine: bridge({ progressGain: BRIDGE_PROGRESS_GAIN - 0.001 }) }))).toEqual(['bridge.same']);
    expect(keysOf(event('machine_progress', { machine: bridge() }))).toEqual(['bridge.same']);
    expect(keysOf(event('machine_progress', { machine: shelf({ items: 0 }) }))).toEqual(['shelf.edge']);
    // No machine facts: a light retry line, true on any machine.
    expect(keysOf(event('machine_progress'))).toEqual(['retry']);
  });

  it('items: one or many by facts.machine.items; time low; session end by rank, prize and plain', () => {
    expect(keysOf(event('items_scored', { machine: shelf({ items: 1 }) }))).toEqual(['items.one']);
    expect(keysOf(event('items_scored', { machine: shelf({ items: 2 }) }))).toEqual(['items.many']);
    expect(keysOf(event('items_scored', { machine: rush({ items: 5 }) }))).toEqual(['items.many']);
    expect(keysOf(event('items_scored'))).toEqual(['items.one']);
    expect(keysOf(event('time_low', { machine: rush() }))).toEqual(['time.low']);
    expect(keysOf(event('time_low'))).toEqual(['time.low']);
    const toy = { typeId: 'sakura.bunny', name: 'Cream Bunny', kind: 'bunny' };
    expect(keysOf(event('session_over', { machine: rush({ reason: 'time', rank: 1 }), toy }))).toEqual(['session.rank']);
    expect(keysOf(event('session_over', { machine: shelf({ reason: 'tries', rank: null }), toy }))).toEqual(['session.reward']);
    expect(keysOf(event('session_over', { machine: shelf({ reason: 'tries', rank: null }) }))).toEqual(['session.over']);
    expect(keysOf(event('session_over'))).toEqual(['session.over']);
  });

  it('a session end never talks about a QR (rewardFor covers the win and the retry prompt only)', () => {
    for (const lang of LANGS) {
      const e = event('session_over', { machine: shelf({ reason: 'tries' }), reward: { qr: true, options: 'both' } });
      expect(keysOf(e)).toEqual(['session.over']);
      for (const c of localCandidates(e, lang)) expect(mentionsQr(c.text, lang), c.text).toBe(false);
    }
  });
});

describe('machine line pools', () => {
  it('every machine key has three generic and two GTC lines per language', () => {
    for (const lang of LANGS) {
      for (const key of MACHINE_KEYS) {
        const pool = LINE_BANKS[lang].lines[key];
        expect(pool.all.length, `${lang}:${key}`).toBeGreaterThanOrEqual(3);
        expect(pool.gtc?.length ?? 0, `${lang}:${key} gtc`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('local lines carry no numbers, no QR words, and only {toy} (+ {event} in the GTC pool)', () => {
    for (const lang of LANGS) {
      for (const key of MACHINE_KEYS) {
        const pool = LINE_BANKS[lang].lines[key];
        for (const [text] of pool.all) {
          expect(text, `${lang}:${key}`).not.toMatch(/\d/);
          expect(mentionsQr(text, lang), `${lang}:${key}: ${text}`).toBe(false);
          for (const m of text.matchAll(/\{(\w+)\}/g)) expect(m[1], `${lang}:${key}: ${text}`).toBe('toy');
        }
        for (const [text] of pool.gtc ?? []) {
          expect(text, `${lang}:${key}`).not.toMatch(/\d/);
          expect(mentionsQr(text, lang), `${lang}:${key}: ${text}`).toBe(false);
          for (const m of text.matchAll(/\{(\w+)\}/g)) expect(['toy', 'event'], `${lang}:${key}: ${text}`).toContain(m[1]);
        }
      }
    }
  });

  const STAFF: Record<Lang, RegExp> = { en: /call(?:ing)? staff/i, zh: /呼叫店员/, ja: /スタッフを呼/ };
  const NAMES: Record<Lang, Record<'bridge' | 'shelf' | 'rush', string>> = {
    en: { bridge: 'Tippy Bridge', shelf: 'Tumble Shelf', rush: 'Sparkle Rush' },
    zh: { bridge: '摇摇桥', shelf: '翻落货架', rush: '闪耀冲刺' },
    ja: { bridge: 'ゆらゆらブリッジ', shelf: 'ころころシェルフ', rush: 'キラキララッシュ' },
  };

  it('a stuck bridge always points at Call staff, with and without the GTC kit', () => {
    for (const lang of LANGS) {
      for (const brand of [undefined, GTC]) {
        const all = localCandidates(event('machine_progress', { machine: bridge({ stuck: true }), brand }, 'gpu'), lang);
        expect(all.length).toBeGreaterThanOrEqual(2);
        for (const c of all) expect(c.text, c.text).toMatch(STAFF[lang]);
      }
    }
  });

  it('the generic welcome of each machine names it', () => {
    for (const lang of LANGS) {
      for (const genre of ['bridge', 'shelf', 'rush'] as const) {
        const lines = LINE_BANKS[lang].lines[`machine.${genre}`].all.map(([t]) => t);
        expect(lines.some((t) => t.includes(NAMES[lang][genre])), `${lang}:${genre}`).toBe(true);
      }
    }
  });

  it('a session prize names the plush; a ranking place asks for initials', () => {
    const TOY: Record<Lang, string> = { en: 'Cream Bunny', zh: '奶油长耳兔', ja: 'クリームうさぎ' };
    const INITIALS: Record<Lang, RegExp> = { en: /initials|three letters|leaderboard/i, zh: /缩写|三个字母|排行榜/, ja: /イニシャル|三文字|ランキング/ };
    for (const lang of LANGS) {
      for (const theme of THEME_IDS) {
        const toy = { typeId: 't', name: TOY[lang], kind: 'k' };
        const reward = localCandidates(event('session_over', { machine: shelf({ reason: 'tries' }), toy }, theme), lang);
        expect(reward.every((c) => c.key === 'session.reward' && c.text.includes(TOY[lang]))).toBe(true);
        const rank = localCandidates(event('session_over', { machine: rush({ reason: 'time', rank: 3 }) }, theme), lang);
        expect(rank.every((c) => c.key === 'session.rank' && INITIALS[lang].test(c.text)), `${lang}/${theme}`).toBe(true);
      }
    }
  });

  it('the GTC pool replaces the theme voice on the gpu theme for every machine event', () => {
    for (const lang of LANGS) {
      for (const [type, facts] of [
        ['machine_selected', { machine: rush() }],
        ['machine_progress', { machine: bridge({ progressGain: 0.2 }) }],
        ['items_scored', { machine: shelf({ items: 3 }) }],
        ['time_low', { machine: rush() }],
        ['session_over', { machine: shelf({ reason: 'tries' }) }],
      ] as const) {
        const all = localCandidatesWithFlavour(event(type, { ...facts, brand: GTC }, 'gpu'), lang);
        expect(all.some((c) => c.flavour === 'brand'), `${lang}/${type}`).toBe(true);
        for (const c of all) expect(c.text).not.toMatch(/[{}]/);
      }
    }
  });
});

describe('facts.machine in the prompt', () => {
  const base: GuideFacts = { phase: 'RESULT', demo: false, attempts: 1, wins: 0, lossStreak: 0 };

  it('passes the machine facts through the whitelist, clamped and without extra fields', () => {
    const dirty = {
      ...base,
      machine: { ...rush({ score: 1234.6, secondsLeft: 8.4, rank: 2, reason: 'time', sessionItems: 9 }), secret: 'x', items: 3, eye: [1, 2] },
    } as unknown as GuideFacts;
    const clean = sanitizeFacts(dirty);
    expect(clean.machine).toEqual({ id: 'rush', genre: 'rush', name: 'Sparkle Rush', tries: 5, secondsLeft: 8, rank: 2, reason: 'time', sessionItems: 9, score: 1235, items: 3 });
    expect(sanitizeMachine({ ...bridge(), progress: 1.7, progressGain: -3, stuck: 'yes', tries: -4 })).toEqual({ id: 'bridge', genre: 'bridge', name: 'Tippy Bridge', progress: 1, progressGain: -1, tries: 0 });
    expect(sanitizeMachine({ ...shelf(), triesLeft: null, rank: null, reason: null })).toMatchObject({ triesLeft: null, rank: null, reason: null });
    expect(sanitizeMachine({ ...shelf(), rank: 42, reason: 'nope' })).toMatchObject({ rank: 10 });
    expect(sanitizeMachine({ ...shelf(), reason: 'nope' })).not.toHaveProperty('reason');
    // Classic and unknown genres carry no machine.
    expect(sanitizeFacts(base)).not.toHaveProperty('machine');
    expect(sanitizeFacts({ ...base, machine: { id: 'classic', genre: 'classic', name: 'x' } as never })).not.toHaveProperty('machine');
    expect(sanitizeFacts({ ...base, machine: null })).not.toHaveProperty('machine');
    expect(sanitizeMachine('rush')).toBeUndefined();
    // Long names are cut like toy names.
    expect(sanitizeMachine({ ...shelf(), name: 'N'.repeat(200), id: 'i'.repeat(80) })!.name.length).toBeLessThan(200);
  });

  it('adds the machine context to the model input, only when a machine is played', () => {
    const withMachine = JSON.parse(buildLineInput({ event: { type: 'machine_progress', facts: { ...base, machine: bridge({ progress: 0.5, progressGain: 0.1 }) } }, theme: 'ocean', recentLines: [] }));
    expect(withMachine.facts.machine).toMatchObject({ genre: 'bridge', progress: 0.5, progressGain: 0.1 });
    expect(withMachine.machineMeaning).toContain('Tippy Bridge');
    expect(withMachine.machineMeaning).toContain('Call staff');
    expect(withMachine.task).toContain('Call staff');
    const classic = JSON.parse(buildLineInput({ event: { type: 'prize_won', facts: { ...base, outcome: 'won' } }, theme: 'ocean', recentLines: [] }));
    expect(classic).not.toHaveProperty('machineMeaning');
    expect(classic.facts).not.toHaveProperty('machine');
    for (const genre of ['bridge', 'shelf', 'rush'] as const) expect(describeMachine({ id: genre, genre, name: genre })).toBeTruthy();
    expect(describeMachine(null)).toBeNull();
  });

  it('gives every machine event a task that names its facts and promises nothing', () => {
    for (const type of ['machine_selected', 'machine_progress', 'items_scored', 'time_low', 'session_over'] as const) {
      const task = taskFor(type, false);
      expect(task, type).toMatch(/facts\.machine/);
      expect(task, type).not.toMatch(/QR/);
    }
    expect(taskFor('session_over', false)).toMatch(/initials/);
    expect(taskFor('machine_progress', false)).toMatch(/Never predict/);
  });
});
