import { describe, expect, it } from 'vitest';
import type { GuideFacts } from '../../../src/core/contracts';
import {
  DEFAULT_PERSONA,
  DEFAULT_SYSTEM_PROMPT,
  buildInstructions,
  buildLineInput,
  describeSlipReason,
  sanitizeFacts,
} from '../../../src/ai/prompt';
import { LENGTH_RULES, countUnits, displayDurationMs, fitLine, normalizeLineText } from '../../../src/ai/textLength';
import { planBabble, renderBabble, synthesizeBabble } from '../../../src/ai/speech/babbleSynth';
import { LineCache, factsCacheKey, lineCacheKey, LINE_CACHE_STORAGE_KEY, type StorageLike } from '../../../src/ai/cache';

describe('line length rules', () => {
  it('counts English in words and CJK in characters', () => {
    expect(countUnits("You got it! Cream Bunny is joining your collection.", 'en')).toBe(9);
    expect(countUnits("It's a brand-new friend", 'en')).toBe(4);
    expect(countUnits('抓到啦！奶油长耳兔加入你的收藏了。', 'zh')).toBe(15);
    expect(countUnits('やったー！モモだよ。', 'ja')).toBe(8);
    // Latin runs inside CJK text count as a fraction, not per letter.
    expect(countUnits('嗨，我是Momo！', 'zh')).toBe(3 + 2);
    expect(countUnits('   ', 'en')).toBe(0);
  });

  it('normalises whitespace, control characters and wrapping quotes', () => {
    expect(normalizeLineText('  Hello\n\tthere  ')).toBe('Hello there');
    expect(normalizeLineText('"Nice catch!"')).toBe('Nice catch!');
    expect(normalizeLineText('「やったね！」')).toBe('やったね！');
    expect(normalizeLineText('“抓到啦！”')).toBe('抓到啦！');
    expect(normalizeLineText('He said "wow" twice')).toBe('He said "wow" twice');
    expect(normalizeLineText(`Line${String.fromCharCode(0x2028)}break${String.fromCharCode(7)}`)).toBe('Line break');
  });

  it('accepts lines within the hard limit unchanged', () => {
    const fitted = fitLine('So close, the claw touched it! Aim a bit more over the middle.', 'en', 'short');
    expect(fitted).toEqual({ text: 'So close, the claw touched it! Aim a bit more over the middle.', units: 13, truncated: false });
  });

  it('cuts long output back to whole sentences', () => {
    const long = 'You got it! ' + 'That was a really wonderful and very careful grab indeed. '.repeat(4);
    const fitted = fitLine(long, 'en', 'short');
    expect(fitted).not.toBeNull();
    expect(fitted!.truncated).toBe(true);
    expect(fitted!.units).toBeLessThanOrEqual(LENGTH_RULES.short.en.hardMax);
    expect(fitted!.text.endsWith('.') || fitted!.text.endsWith('!')).toBe(true);
    const zh = fitLine('抓到啦！' + '这一下真的非常非常漂亮而且特别特别稳。'.repeat(4), 'zh', 'short');
    expect(zh!.truncated).toBe(true);
    expect(zh!.units).toBeLessThanOrEqual(LENGTH_RULES.short.zh.hardMax);
  });

  it('rejects empty output and a single run-on sentence', () => {
    expect(fitLine('   ', 'en', 'short')).toBeNull();
    expect(fitLine('!!!', 'en', 'short')).toBeNull();
    expect(fitLine('word '.repeat(60), 'en', 'short')).toBeNull();
    expect(fitLine('字'.repeat(80), 'zh', 'medium')).toBeNull();
  });

  it('keeps lines on screen long enough to read, within bounds', () => {
    expect(displayDurationMs('Hi!', 'en')).toBe(2600);
    expect(displayDurationMs('word '.repeat(40), 'en')).toBe(7500);
    const mid = displayDurationMs('抓到啦！奶油长耳兔加入你的收藏了。', 'zh');
    expect(mid).toBeGreaterThan(2600);
    expect(mid).toBeLessThan(7500);
  });
});

describe('prompt and context', () => {
  const facts: GuideFacts = {
    phase: 'RESULT',
    demo: false,
    attempts: 4,
    wins: 1,
    lossStreak: 2,
    outcome: 'slipped',
    contact: 'lifted',
    slipReason: 'bounced_out',
    liftedMs: 2140.6,
    toy: { typeId: 'cream_bunny', name: 'Cream Bunny', kind: 'bunny' },
    nearest: { dx: 0.0834, dz: -0.0112, dist: 0.0841, name: 'Cream Bunny' },
    newCharacter: false,
    headTracking: true,
  };

  it('always appends the fixed output rules, also to a custom prompt', () => {
    const standard = buildInstructions({ lang: 'zh', length: 'short' });
    expect(standard).toContain(DEFAULT_SYSTEM_PROMPT);
    expect(standard).toContain(DEFAULT_PERSONA);
    expect(standard).toContain('Simplified Chinese');
    expect(standard).toContain('10-30 characters');
    const custom = buildInstructions({ systemPrompt: 'You are a pirate parrot.', persona: 'Grumpy.', lang: 'en', length: 'medium' });
    expect(custom).toContain('You are a pirate parrot.');
    expect(custom).not.toContain(DEFAULT_SYSTEM_PROMPT);
    expect(custom).toContain('Personality: Grumpy.');
    expect(custom).toContain('Reply in English only');
    expect(custom).toContain('14-30 words');
    expect(custom).toContain('Never promise');
    expect(custom).toContain('facts.contact is "none"');
  });

  it('serialises only whitelisted facts', () => {
    const dirty = { ...facts, faceLandmarks: [[0.1, 0.2, 0.3]], eye: [0, 0.1, 0.6], apiKey: 'sk-nope' } as unknown as GuideFacts;
    const clean = sanitizeFacts(dirty) as unknown as Record<string, unknown>;
    expect(Object.keys(clean).sort()).toEqual(
      ['attempts', 'contact', 'demo', 'headTracking', 'liftedMs', 'lossStreak', 'nearest', 'newCharacter', 'outcome', 'phase', 'slipReason', 'toy', 'wins'].sort(),
    );
    expect(clean.liftedMs).toBe(2141);
    expect(clean.nearest).toEqual({ dx: 0.08, dz: -0.01, dist: 0.08, name: 'Cream Bunny' });
    const input = buildLineInput({ event: { type: 'slipped_after_grip', facts: dirty }, theme: 'ocean', recentLines: ['a', 'b'] });
    expect(input).not.toMatch(/faceLandmarks|sk-nope|"eye"/);
    const parsed = JSON.parse(input) as Record<string, unknown>;
    expect(parsed.event).toBe('slipped_after_grip');
    expect((parsed.theme as { name: string }).name).toBe('Ocean Dream');
    expect(parsed.slipReasonMeaning).toContain('bounced off the rim');
    expect(parsed.recentLines).toEqual(['a', 'b']);
    // Round bookkeeping belongs to the application, not to the model.
    expect(input).not.toMatch(/roundId|eventId/);
  });

  it('explains every slip reason and tolerates unknown ones', () => {
    for (const reason of ['eccentric', 'weak_support', 'contact_lost', 'transport_swing', 'overload', 'bounced_out']) {
      expect(describeSlipReason(reason)).toBeTruthy();
    }
    expect(describeSlipReason('reason_from_the_future')).toBe('it slipped out of the grip');
    expect(describeSlipReason(null)).toBeNull();
    expect(describeSlipReason(undefined)).toBeNull();
  });
});

describe('babble voice synthesis', () => {
  it('plans one syllable per CJK character and per English vowel group', () => {
    expect(planBabble('抓到啦！', 'zh', { emotion: 'cheer', speed: 1 }).syllables).toHaveLength(3);
    // small kana and the long-vowel mark stretch the previous syllable instead of adding one
    expect(planBabble('やったー！', 'ja', { emotion: 'cheer', speed: 1 }).syllables).toHaveLength(2);
    expect(planBabble('Hello there!', 'en', { emotion: 'happy', speed: 1 }).syllables).toHaveLength(3);
    expect(planBabble('...', 'en', { emotion: 'calm', speed: 1 }).syllables).toHaveLength(0);
  });

  it('raises the pitch at the end of a question', () => {
    const statement = planBabble('再来一次', 'zh', { emotion: 'calm', speed: 1 }).syllables;
    const question = planBabble('再来一次？', 'zh', { emotion: 'calm', speed: 1 }).syllables;
    expect(question[3]!.pitch).toBeGreaterThan(statement[3]!.pitch * 1.2);
    expect(question[0]!.pitch).toBeCloseTo(statement[0]!.pitch, 6);
  });

  it('speaks faster at higher speed and for excited emotions', () => {
    const slow = planBabble('把爪子移到娃娃上面吧', 'zh', { emotion: 'calm', speed: 0.8 });
    const fast = planBabble('把爪子移到娃娃上面吧', 'zh', { emotion: 'cheer', speed: 1.2 });
    expect(fast.duration).toBeLessThan(slow.duration * 0.75);
    expect(fast.syllables[0]!.pitch).toBeGreaterThan(slow.syllables[0]!.pitch);
  });

  it('renders finite, audible, non-clipping audio of the planned length', () => {
    const plan = planBabble("Hi, I'm Momo! Ready to catch something cute?", 'en', { emotion: 'happy', speed: 1 });
    const samples = renderBabble(plan, 24000);
    expect(samples.length).toBe(Math.ceil(plan.duration * 24000));
    let peak = 0;
    let energy = 0;
    for (const s of samples) {
      expect(Number.isFinite(s)).toBe(true);
      peak = Math.max(peak, Math.abs(s));
      energy += s * s;
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(0.63);
    expect(Math.sqrt(energy / samples.length)).toBeGreaterThan(0.03);
    // Starts and ends in silence (no clicks).
    expect(Math.abs(samples[0]!)).toBeLessThan(1e-3);
    expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(1e-3);
  });

  it('is deterministic and bounded for very long text', () => {
    const a = synthesizeBabble('好可惜！再试一次？', 'zh', { emotion: 'oops', speed: 1 });
    const b = synthesizeBabble('好可惜！再试一次？', 'zh', { emotion: 'oops', speed: 1 });
    expect(Array.from(a.slice(0, 2000))).toEqual(Array.from(b.slice(0, 2000)));
    const long = planBabble('字'.repeat(500), 'zh', { emotion: 'calm', speed: 1 });
    expect(long.syllables.length).toBeLessThanOrEqual(64);
    expect(long.duration).toBeLessThan(10);
  });
});

describe('line cache', () => {
  const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  };
  const line = (text: string) => ({ text, emotion: 'happy' as const, shouldSpeak: true });

  it('keeps nothing when switched off', () => {
    const cache = new LineCache(memoryStorage());
    cache.add('k', line('one'));
    expect(cache.get('k')).toEqual([]);
  });

  it('keeps a few variants per key in session mode without touching storage', () => {
    const storage = memoryStorage();
    const cache = new LineCache(storage);
    cache.setMode('session');
    for (const text of ['one', 'two', 'two', 'three', 'four', 'five']) cache.add('k', line(text));
    expect(cache.get('k').map((l) => l.text)).toEqual(['two', 'three', 'four', 'five']);
    expect(storage.data.size).toBe(0);
  });

  it('persists text only, reloads it, and wipes it when persistence is turned off', () => {
    const storage = memoryStorage();
    const cache = new LineCache(storage);
    cache.setMode('persistent');
    cache.add('k', line('Hello there'));
    const stored = storage.data.get(LINE_CACHE_STORAGE_KEY)!;
    expect(JSON.parse(stored)).toEqual([['k', [{ text: 'Hello there', emotion: 'happy', shouldSpeak: true }]]]);
    const reloaded = new LineCache(storage);
    reloaded.setMode('persistent');
    expect(reloaded.get('k').map((l) => l.text)).toEqual(['Hello there']);
    reloaded.setMode('session');
    expect(storage.data.has(LINE_CACHE_STORAGE_KEY)).toBe(false);
    reloaded.setMode('off');
    expect(reloaded.get('k')).toEqual([]);
  });

  it('survives corrupt or blocked storage', () => {
    const storage = memoryStorage();
    storage.data.set(LINE_CACHE_STORAGE_KEY, '{not json');
    const cache = new LineCache(storage);
    expect(() => cache.setMode('persistent')).not.toThrow();
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const other = new LineCache(blocked);
    expect(() => {
      other.setMode('persistent');
      other.add('k', line('still works in memory'));
      other.setMode('off');
    }).not.toThrow();
  });

  it('separates situations that need different wording', () => {
    const base = { roundId: 1, themeId: 'sakura' as const };
    const facts = { phase: 'RESULT' as const, demo: false, attempts: 1, wins: 0, lossStreak: 0 };
    const right = factsCacheKey({ ...base, type: 'empty_grab', facts: { ...facts, contact: 'none', nearest: { dx: 0.1, dz: 0, dist: 0.1, name: 'A' } } });
    const left = factsCacheKey({ ...base, type: 'empty_grab', facts: { ...facts, contact: 'none', nearest: { dx: -0.1, dz: 0, dist: 0.1, name: 'A' } } });
    const touched = factsCacheKey({ ...base, type: 'empty_grab', facts: { ...facts, contact: 'touched' } });
    expect(new Set([right, left, touched]).size).toBe(3);
    const event = { ...base, type: 'welcome' as const, facts };
    const a = lineCacheKey({ event, lang: 'en', theme: 'sakura', length: 'short', model: '', promptText: 'x' });
    const b = lineCacheKey({ event, lang: 'ja', theme: 'sakura', length: 'short', model: '', promptText: 'x' });
    const c = lineCacheKey({ event, lang: 'en', theme: 'sakura', length: 'short', model: '', promptText: 'edited prompt' });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
