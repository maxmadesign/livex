import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideEvent, GuideLine } from '../../../src/core/contracts';
import { makeRng } from '../../../src/core/math';
import type { Lang } from '../../../src/core/types';
import { createGuide } from '../../../src/ai/createGuide';
import {
  STATUS_FIRST_TIMEOUT_MS,
  STATUS_RETRY_DELAYS_MS,
  STATUS_TIMEOUT_MS,
  guideLanguage,
  type GuideConfig,
  type GuideDirector,
} from '../../../src/ai/GuideDirector';
import { LINE_BANKS, localCandidates } from '../../../src/ai/lines';
import type { LineRequestBody, StatusResponseBody } from '../../../src/ai/protocol';
import { migrateGuideLanguage } from '../../../src/ai/settingsMigration';
import type { SpeechPath, SpeechProvider, SpeechRequest } from '../../../src/ai/speech/types';
import { defaultSettings, sanitizeSettings } from '../../../src/settings/spec';

const STATUS: StatusResponseBody = {
  configured: true,
  provider: 'openai',
  textModel: 'gpt-6-luna',
  speechModel: 'gpt-realtime-2.1-mini',
  speechApi: 'realtime',
  voice: 'marin',
  allowClientPrompt: true,
  adminProtected: false,
  speechConfigError: '',
  warnings: [],
  limits: { ratePerMin: 60, maxSpeechChars: 300, maxRecentLines: 6, textTimeoutMs: 6000, speechTimeoutMs: 12000 },
  version: 'test',
  credential: { source: 'env', fingerprint: '…TEST', envDefault: true, savedAt: null, management: 'local', canManage: true },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** What the status endpoint does for each call: answer after `delay` ms, fail, or never answer. */
type StatusPlan = { delay?: number; response?: () => Response; fail?: boolean; hang?: boolean };

function fakeFetch(plans: (index: number) => StatusPlan) {
  const calls = { status: 0, statusAt: [] as number[], line: [] as LineRequestBody[] };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/ai/status')) {
      const index = calls.status++;
      calls.statusAt.push(Date.now());
      const plan = plans(index);
      return await new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener('abort', onAbort, { once: true });
        if (plan.hang) return;
        setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          if (plan.fail) reject(new TypeError('fetch failed'));
          else resolve((plan.response ?? (() => json(STATUS)))());
        }, plan.delay ?? 0);
      });
    }
    if (url.endsWith('/api/ai/line')) {
      const body = JSON.parse(String(init?.body)) as LineRequestBody;
      calls.line.push(body);
      return json({ text: body.lang === 'en' ? 'Aim right at the tummy and press grab, friend!' : '对准肚子再按抓取吧！', emotion: 'happy', shouldSpeak: true, model: 'gpt-6-luna', latencyMs: 5 });
    }
    return json({ error: { code: 'not_found', message: 'nope' } }, 404);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function config(overrides: Partial<GuideConfig['settings']> = {}, extra: Partial<GuideConfig> = {}): GuideConfig {
  return { settings: { ...defaultSettings().ai, ...overrides }, uiLang: 'en', themeId: 'sakura', themeVersion: 1, ...extra };
}

const event = (type: GuideEvent['type'], roundId = 1): GuideEvent => ({
  type,
  roundId,
  themeId: 'sakura',
  facts: { phase: 'READY', demo: false, attempts: 0, wins: 0, lossStreak: 0 },
});

function recorder(path: SpeechPath) {
  const spoken: SpeechRequest[] = [];
  const provider: SpeechProvider = {
    path,
    available: () => true,
    async speak(request) {
      spoken.push(request);
      // Plays for a second (the router ignores audio that ends at once).
      let stop: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        stop = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      return { path, done, stop };
    },
  };
  return { provider, spoken };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('status probe: robust against a busy page and a slow start', () => {
  it('gives the first probe a long time limit (the page may be busy booting)', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ delay: STATUS_FIRST_TIMEOUT_MS - 1000 }));
    const guide = createGuide({ audio: null, fetchImpl, storage: null, onWake: null });
    guide.configure(config());
    // The old 4 s limit would have given up here and shown "local lines" for a minute.
    await vi.advanceTimersByTimeAsync(4500);
    expect(guide.status().connection).toBe('checking');
    await vi.advanceTimersByTimeAsync(STATUS_FIRST_TIMEOUT_MS);
    expect(calls.status).toBe(1);
    expect(guide.serverStatus()?.configured).toBe(true);
    expect(guide.status().connection).toBe('checking');
    expect(guide.status().detail).toMatch(/not verified/i);
  });

  it('retries a timed-out first probe quickly instead of waiting a minute', async () => {
    const { fetchImpl, calls } = fakeFetch((i) => (i === 0 ? { hang: true } : { delay: 50 }));
    const guide = createGuide({ audio: null, fetchImpl, storage: null, onWake: null });
    guide.configure(config());
    await vi.advanceTimersByTimeAsync(STATUS_FIRST_TIMEOUT_MS + 10);
    expect(calls.status).toBe(1);
    // Not settled yet: still "checking", never "local lines".
    expect(guide.status().connection).toBe('checking');
    expect(guide.status().detail).toMatch(/asking again in 1 s/);
    await vi.advanceTimersByTimeAsync(STATUS_RETRY_DELAYS_MS[0]! + 100);
    expect(calls.status).toBe(2);
    expect(guide.serverStatus()?.configured).toBe(true);
    expect(guide.status().connection).toBe('checking');
  });

  it('backs off between retries (1 s, 2 s, 4 s) and uses the shorter limit after the first try', async () => {
    const { fetchImpl, calls } = fakeFetch((i) => (i < 3 ? { fail: true } : { delay: 10 }));
    const guide = createGuide({ audio: null, fetchImpl, storage: null, onWake: null });
    const start = Date.now();
    guide.configure(config());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.status).toBe(4);
    const gaps = calls.statusAt.map((t) => t - start);
    expect(gaps[1]! - gaps[0]!).toBeGreaterThanOrEqual(STATUS_RETRY_DELAYS_MS[0]!);
    expect(gaps[2]! - gaps[1]!).toBeGreaterThanOrEqual(STATUS_RETRY_DELAYS_MS[1]!);
    expect(gaps[3]! - gaps[2]!).toBeGreaterThanOrEqual(STATUS_RETRY_DELAYS_MS[2]!);
    expect(guide.serverStatus()?.configured).toBe(true);
    expect(STATUS_TIMEOUT_MS).toBeLessThan(STATUS_FIRST_TIMEOUT_MS);
  });

  it('does not retry when there is no API server behind the page (404)', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ response: () => new Response('Not found', { status: 404 }) }));
    const guide = createGuide({ audio: null, fetchImpl, storage: null, onWake: null });
    guide.configure(config());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.status).toBe(1);
    expect(guide.status().connection).toBe('local');
  });

  it('asks again when the tab becomes visible or the network comes back', async () => {
    let wake: () => void = () => {};
    let up = false;
    const { fetchImpl, calls } = fakeFetch(() => (up ? { delay: 5 } : { fail: true }));
    const guide = createGuide({
      audio: null,
      fetchImpl,
      storage: null,
      onWake: (listener) => {
        wake = listener;
        return () => {
          wake = () => {};
        };
      },
    });
    guide.configure(config());
    await vi.advanceTimersByTimeAsync(10_000);
    const settled = calls.status;
    expect(settled).toBe(1 + STATUS_RETRY_DELAYS_MS.length);
    expect(guide.status().connection).toBe('local');
    up = true;
    wake();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.status).toBe(settled + 1);
    expect(guide.serverStatus()?.configured).toBe(true);
    // Repeated wake events right after a good answer do not hammer the server.
    wake();
    wake();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.status).toBe(settled + 1);
    guide.dispose();
  });

  it('re-probes on demand after a key change and forgets an earlier "verified" state', async () => {
    let fingerprint = '…AAAA';
    const { fetchImpl, calls } = fakeFetch(() => ({ response: () => json({ ...STATUS, credential: { ...STATUS.credential!, fingerprint } }) }));
    const guide = createGuide({ audio: null, fetchImpl, storage: null, onWake: null, rng: makeRng(1) }) as unknown as GuideDirector;
    guide.configure(config());
    await vi.advanceTimersByTimeAsync(10);
    guide.handle(event('user_requested_tip'));
    await vi.advanceTimersByTimeAsync(50);
    expect(guide.status().connection).toBe('gpt');
    fingerprint = '…BBBB';
    const refreshed = guide.refreshServerStatus();
    await vi.advanceTimersByTimeAsync(10);
    await refreshed;
    expect(calls.status).toBe(2);
    expect(guide.serverStatus()?.credential?.fingerprint).toBe('…BBBB');
    expect(guide.status().connection).toBe('checking');
  });
});

describe('guide language: English by default, whatever the interface language', () => {
  it('resolves the language from ai.voiceLanguage', () => {
    expect(defaultSettings().ai.voiceLanguage).toBe('en');
    for (const ui of ['en', 'zh', 'ja'] as Lang[]) {
      expect(guideLanguage({ voiceLanguage: 'en' }, ui)).toBe('en');
      expect(guideLanguage({ voiceLanguage: 'ui' }, ui)).toBe(ui);
    }
    // The old setting is gone from the spec: stored values are dropped on load.
    expect('language' in defaultSettings().ai).toBe(false);
    expect('language' in sanitizeSettings({ ai: { language: 'ja' } }).ai).toBe(false);
  });

  it('speaks and writes English local lines with a Chinese interface', async () => {
    const voice = recorder('babble');
    const guide = createGuide({ audio: null, fetchImpl: undefined, storage: null, onWake: null, rng: makeRng(3), speech: { babble: voice.provider } });
    const lines: GuideLine[] = [];
    guide.subscribe((line) => line && lines.push(line));
    guide.configure(config({ provider: 'local' }, { uiLang: 'zh' }));
    guide.handle(event('welcome'));
    await vi.advanceTimersByTimeAsync(300);
    const line = guide.currentLine()!;
    expect(line.lang).toBe('en');
    expect(localCandidates(event('welcome'), 'en').map((c) => c.text)).toContain(line.text);
    expect(line.text).not.toMatch(/[一-鿿぀-ヿ]/);
    expect(voice.spoken[0]!.lang).toBe('en');
    expect(voice.spoken[0]!.text).toBe(line.text);
    const previewing = guide.previewVoice();
    await vi.advanceTimersByTimeAsync(300);
    const preview = await previewing;
    expect(preview.ok).toBe(true);
    expect(voice.spoken[1]!.lang).toBe('en');
    expect(voice.spoken[1]!.text).toMatch(/Momo/);
  });

  it('asks GPT for English lines with a Japanese interface, and for Japanese when set to follow it', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({}));
    const guide = createGuide({ audio: null, fetchImpl, storage: null, onWake: null, speech: { ai: recorder('ai').provider, babble: recorder('babble').provider } });
    guide.configure(config({}, { uiLang: 'ja' }));
    await vi.advanceTimersByTimeAsync(10);
    guide.handle(event('user_requested_tip'));
    await vi.advanceTimersByTimeAsync(50);
    expect(calls.line[0]!.lang).toBe('en');
    expect(guide.currentLine()!.lang).toBe('en');
    guide.configure(config({ voiceLanguage: 'ui' }, { uiLang: 'ja' }));
    await vi.advanceTimersByTimeAsync(1000); // past the tip cooldown
    guide.handle(event('user_requested_tip', 2));
    await vi.advanceTimersByTimeAsync(50);
    expect(calls.line[1]!.lang).toBe('ja');
  });

  it('local English lines exist for every theme, GPU Party included', () => {
    expect(LINE_BANKS.en.lines.theme.gpu!.length).toBeGreaterThanOrEqual(3);
  });
});

describe('settings migration: ai.language → ai.voiceLanguage', () => {
  it('maps the old default and English to "always English"', () => {
    expect(migrateGuideLanguage({ ai: { language: 'ui' }, system: { language: 'zh' } })).toEqual({ ai: { language: 'ui', voiceLanguage: 'en' }, system: { language: 'zh' } });
    expect((migrateGuideLanguage({ ai: { language: 'en' }, system: { language: 'ja' } }) as { ai: { voiceLanguage: string } }).ai.voiceLanguage).toBe('en');
  });

  it('keeps an explicit Chinese / Japanese guide that matched the interface', () => {
    expect((migrateGuideLanguage({ ai: { language: 'zh' }, system: { language: 'zh' } }) as { ai: { voiceLanguage: string } }).ai.voiceLanguage).toBe('ui');
    expect((migrateGuideLanguage({ ai: { language: 'ja' }, system: { language: 'ja' } }) as { ai: { voiceLanguage: string } }).ai.voiceLanguage).toBe('ui');
    // Japanese guide with an English interface can not be expressed any more: the new default wins.
    expect((migrateGuideLanguage({ ai: { language: 'ja' }, system: { language: 'en' } }) as { ai: { voiceLanguage: string } }).ai.voiceLanguage).toBe('en');
  });

  it('leaves new data, missing sections and odd input alone and does not mutate', () => {
    const fresh = { ai: { voiceLanguage: 'ui', language: 'zh' }, system: { language: 'en' } };
    expect(migrateGuideLanguage(fresh)).toBe(fresh);
    expect(migrateGuideLanguage({ system: {} })).toEqual({ system: {} });
    expect(migrateGuideLanguage(null)).toBeNull();
    expect(migrateGuideLanguage([1])).toEqual([1]);
    const old = { ai: { language: 'zh' }, system: { language: 'zh' } };
    migrateGuideLanguage(old);
    expect(old).toEqual({ ai: { language: 'zh' }, system: { language: 'zh' } });
    // After sanitising, the migrated value survives and the old key is dropped.
    const clean = sanitizeSettings(migrateGuideLanguage(old));
    expect(clean.ai.voiceLanguage).toBe('ui');
  });
});
