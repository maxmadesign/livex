import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideEvent, GuideEventType, GuideFacts, GuideLine, GuideStatus } from '../../../src/core/contracts';
import { makeRng } from '../../../src/core/math';
import type { Lang } from '../../../src/core/types';
import { createGuide, type Guide } from '../../../src/ai/createGuide';
import { GUIDE_COOLDOWN_MS, type GuideConfig } from '../../../src/ai/GuideDirector';
import { localCandidates } from '../../../src/ai/lines';
import type { LineRequestBody, StatusResponseBody } from '../../../src/ai/protocol';
import type { SpeechPath, SpeechPlayback, SpeechProvider, SpeechRequest } from '../../../src/ai/speech/types';
import { LINE_CACHE_STORAGE_KEY, type StorageLike } from '../../../src/ai/cache';
import { defaultSettings } from '../../../src/settings/spec';

/* ------------------------------------------------------------------ helpers */

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
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface LineCall {
  body: LineRequestBody;
  signal: AbortSignal | null;
  aborted: boolean;
}

interface FakeServer {
  fetchImpl: typeof fetch;
  lineCalls: LineCall[];
  statusCalls: number;
  testCalls: number;
  /** Answer for the next /api/ai/line calls: delay in ms plus a response factory. */
  line: (body: LineRequestBody, index: number) => { delay: number; response: () => Response };
  status: () => Response | Error;
  test: () => Response;
}

function fakeServer(overrides: Partial<Pick<FakeServer, 'line' | 'status' | 'test'>> = {}): FakeServer {
  const server: FakeServer = {
    lineCalls: [],
    statusCalls: 0,
    testCalls: 0,
    line:
      overrides.line ??
      ((_body, index) => ({
        delay: 300,
        response: () => json({ text: `GPT line number ${index + 1} for you, friend.`, emotion: 'happy', shouldSpeak: true, model: 'gpt-6-luna', latencyMs: 300 }),
      })),
    status: overrides.status ?? (() => json(STATUS)),
    test:
      overrides.test ??
      (() => json({ ok: true, text: { ok: true, model: 'gpt-6-luna', latencyMs: 420, sample: 'Aim for the tummy!' } })),
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/ai/status')) {
        server.statusCalls++;
        const result = server.status();
        if (result instanceof Error) throw result;
        return result;
      }
      if (url.endsWith('/api/ai/test')) {
        server.testCalls++;
        return server.test();
      }
      if (url.endsWith('/api/ai/line')) {
        const body = JSON.parse(String(init?.body)) as LineRequestBody;
        const call: LineCall = { body, signal: init?.signal ?? null, aborted: false };
        const index = server.lineCalls.length;
        server.lineCalls.push(call);
        const plan = server.line(body, index);
        return await new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(plan.response()), plan.delay);
          init?.signal?.addEventListener('abort', () => {
            call.aborted = true;
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
      return json({ error: { code: 'not_found', message: 'nope' } }, 404);
    }) as typeof fetch,
  };
  return server;
}

const facts = (extra: Partial<GuideFacts> = {}): GuideFacts => ({
  phase: 'AIMING',
  demo: false,
  attempts: 2,
  wins: 0,
  lossStreak: 1,
  ...extra,
});

const event = (type: GuideEventType, roundId = 1, extra: Partial<GuideFacts> = {}): GuideEvent => ({
  type,
  roundId,
  themeId: 'sakura',
  facts: facts(extra),
});

function config(overrides: Partial<GuideConfig['settings']> = {}, extra: Partial<GuideConfig> = {}): GuideConfig {
  return {
    settings: { ...defaultSettings().ai, ...overrides },
    uiLang: 'en',
    themeId: 'sakura',
    themeVersion: 1,
    ...extra,
  };
}

interface Harness {
  guide: Guide;
  server: FakeServer;
  lines: (GuideLine | null)[];
  shown: () => GuideLine[];
  status: () => GuideStatus;
}

async function setup(
  options: {
    server?: FakeServer;
    settings?: Partial<GuideConfig['settings']>;
    speech?: Partial<Record<SpeechPath, SpeechProvider>>;
    storage?: StorageLike | null;
  } = {},
): Promise<Harness> {
  const server = options.server ?? fakeServer();
  const guide = createGuide({
    audio: null,
    fetchImpl: server.fetchImpl,
    rng: makeRng(1234),
    storage: options.storage ?? null,
    speech: options.speech,
  });
  const lines: (GuideLine | null)[] = [];
  guide.subscribe((line) => {
    if (lines[lines.length - 1] !== line) lines.push(line);
  });
  guide.configure(config(options.settings));
  await vi.advanceTimersByTimeAsync(0); // let the status probe settle
  return {
    guide,
    server,
    lines,
    shown: () => {
      const seen = new Map<string, GuideLine>();
      for (const line of lines) if (line) seen.set(line.id, line);
      return [...seen.values()];
    },
    status: () => guide.status(),
  };
}

/** A scripted speech path: records what it was asked to say and plays for `ms`. */
function fakeSpeech(path: SpeechPath, options: { ms?: number; works?: boolean; available?: boolean } = {}) {
  const spoken: string[] = [];
  let stopped = 0;
  let active = 0;
  let maxActive = 0;
  const provider: SpeechProvider = {
    path,
    available: () => options.available ?? true,
    async speak(request: SpeechRequest): Promise<SpeechPlayback | null> {
      if (options.works === false) return null;
      spoken.push(request.text);
      active++;
      maxActive = Math.max(maxActive, active);
      let end: () => void = () => {};
      let finished = false;
      const done = new Promise<void>((resolve) => {
        end = () => {
          if (finished) return;
          finished = true;
          active--;
          resolve();
        };
      });
      const timer = setTimeout(end, options.ms ?? 1200);
      const stop = () => {
        if (finished) return;
        stopped++;
        clearTimeout(timer);
        end();
      };
      request.signal.addEventListener('abort', stop, { once: true });
      return { path, done, stop };
    },
  };
  return { provider, spoken, stats: () => ({ stopped, active, maxActive }) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

/* -------------------------------------------------------------------- tests */

describe('guide: text source and truthful status', () => {
  it('uses local lines immediately when the server has no key', async () => {
    const h = await setup({ server: fakeServer({ status: () => json({ ...STATUS, configured: false }) }) });
    expect(h.status().connection).toBe('local');
    h.guide.handle(event('welcome'));
    const line = h.guide.currentLine();
    expect(line).not.toBeNull();
    expect(line!.source).toBe('local');
    expect(line!.eventType).toBe('welcome');
    expect(h.server.lineCalls).toHaveLength(0);
    expect(h.status().textModel).toBeNull();
  });

  it('uses local lines when the API server is unreachable and stays quiet about it', async () => {
    const h = await setup({ server: fakeServer({ status: () => new TypeError('fetch failed') }) });
    expect(h.status().connection).toBe('local');
    expect(h.status().detail).toMatch(/not reachable/i);
    h.guide.handle(event('grab_started'));
    expect(h.guide.currentLine()!.source).toBe('local');
  });

  it('does not claim GPT is connected before a reply proved it', async () => {
    const h = await setup();
    expect(h.status().connection).toBe('checking');
    expect(h.status().detail).toMatch(/not verified/i);
    h.guide.handle(event('welcome'));
    expect(h.guide.currentLine()).toBeNull(); // waiting for GPT, nothing blocks meanwhile
    await vi.advanceTimersByTimeAsync(300);
    const line = h.guide.currentLine()!;
    expect(line.source).toBe('gpt');
    expect(line.text).toBe('GPT line number 1 for you, friend.');
    expect(h.status().connection).toBe('gpt');
    expect(h.status().lastLatencyMs).toBe(300);
    expect(h.status().textModel).toBe('gpt-6-luna');
  });

  it('sends only game facts: no round ids, no camera or face data', async () => {
    const h = await setup({ settings: { personality: 'Extra bubbly.', systemPrompt: '', model: '' } });
    const dirty = facts({ contact: 'none', nearest: { dx: 0.0812, dz: -0.02, dist: 0.0836, name: 'Cream Bunny' } });
    Object.assign(dirty, { faceLandmarks: [[0.1, 0.2]], eyePosition: [0, 0.1, 0.6] });
    h.guide.handle({ type: 'empty_grab', roundId: 42, themeId: 'sakura', facts: dirty });
    await vi.advanceTimersByTimeAsync(0);
    const sent = h.server.lineCalls[0]!.body;
    const raw = JSON.stringify(sent);
    expect(raw).not.toMatch(/roundId|eventId|faceLandmarks|eyePosition|42/);
    expect(sent.event.type).toBe('empty_grab');
    expect(sent.event.facts.nearest).toEqual({ dx: 0.08, dz: -0.02, dist: 0.08, name: 'Cream Bunny' });
    expect(sent.lang).toBe('en');
    expect(sent.theme).toBe('sakura');
    expect(sent.persona).toBe('Extra bubbly.');
    expect(sent.systemPrompt).toBeUndefined();
    expect(sent.model).toBeUndefined();
    expect(sent.length).toBe('short');
    expect(sent.timeoutMs).toBe(2500);
  });

  it('falls back to a local line at the timeout and ignores the late reply', async () => {
    const server = fakeServer({ line: () => ({ delay: 9000, response: () => json({ text: 'Too late to matter, sorry about that!', emotion: 'happy', shouldSpeak: true, model: 'gpt-6-luna', latencyMs: 9000 }) }) });
    const h = await setup({ server, settings: { timeoutMs: 2000 } });
    h.guide.handle(event('empty_grab', 3, { contact: 'touched', outcome: 'empty' }));
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.guide.currentLine()).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    const line = h.guide.currentLine()!;
    expect(line.source).toBe('local');
    expect(localCandidates(event('empty_grab', 3, { contact: 'touched', outcome: 'empty' }), 'en').map((c) => c.text)).toContain(line.text);
    expect(h.status().connection).toBe('error');
    expect(h.status().detail).toMatch(/2000 ms/);
    expect(server.lineCalls[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.shown().map((l) => l.text)).not.toContain('Too late to matter, sorry about that!');
    expect(h.shown()).toHaveLength(1);
  });

  it('switches to local lines when the server answers no_key', async () => {
    const server = fakeServer({ line: () => ({ delay: 50, response: () => json({ error: { code: 'no_key', message: 'no key' } }, 503) }) });
    const h = await setup({ server });
    h.guide.handle(event('welcome'));
    await vi.advanceTimersByTimeAsync(60);
    expect(h.guide.currentLine()!.source).toBe('local');
    expect(h.status().connection).toBe('local');
    // Next event does not even try GPT.
    await vi.advanceTimersByTimeAsync(20_000);
    h.guide.handle(event('prize_won', 2, { toy: { typeId: 't', name: 'Cream Bunny', kind: 'bunny' } }));
    expect(h.guide.currentLine()!.source).toBe('local');
    expect(server.lineCalls).toHaveLength(1);
  });

  it('reports an upstream failure as an error and still speaks', async () => {
    const server = fakeServer({ line: () => ({ delay: 80, response: () => json({ error: { code: 'upstream_auth', message: 'rejected' } }, 502) }) });
    const h = await setup({ server });
    h.guide.handle(event('grab_started'));
    await vi.advanceTimersByTimeAsync(100);
    expect(h.guide.currentLine()!.source).toBe('local');
    expect(h.status().connection).toBe('error');
    expect(h.status().detail).toContain('upstream_auth');
  });

  it('rejects over-long or malformed replies instead of showing them', async () => {
    const replies = [
      () => json({ text: 'word '.repeat(80), emotion: 'happy', shouldSpeak: true, model: 'm', latencyMs: 1 }),
      () => json({ nonsense: true }),
    ];
    const server = fakeServer({ line: (_b, i) => ({ delay: 10, response: replies[i]! }) });
    const h = await setup({ server });
    h.guide.handle(event('prize_won', 1, { toy: { typeId: 't', name: 'Cream Bunny', kind: 'bunny' } }));
    await vi.advanceTimersByTimeAsync(20);
    expect(h.guide.currentLine()!.source).toBe('local');
    h.guide.handle(event('empty_grab', 2, { contact: 'none' }));
    await vi.advanceTimersByTimeAsync(20);
    expect(h.guide.currentLine()!.source).toBe('local');
    expect(h.guide.debugStats().gptFailures).toBe(2);
  });

  it('stops waiting for GPT after repeated failures', async () => {
    const server = fakeServer({ line: () => ({ delay: 60_000, response: () => json({}) }) });
    const h = await setup({ server, settings: { timeoutMs: 1000 } });
    for (let round = 1; round <= 3; round++) {
      h.guide.handle(event('empty_grab', round, { contact: 'none' }));
      await vi.advanceTimersByTimeAsync(1001);
      expect(h.guide.currentLine()!.source).toBe('local');
      await vi.advanceTimersByTimeAsync(8000);
    }
    expect(server.lineCalls).toHaveLength(3);
    expect(h.status().detail).toMatch(/paused/i);
    h.guide.handle(event('empty_grab', 4, { contact: 'none' }));
    expect(h.guide.currentLine()).not.toBeNull(); // immediate: no request, no waiting
    expect(server.lineCalls).toHaveLength(3);
    // After the pause GPT is tried again.
    await vi.advanceTimersByTimeAsync(60_000);
    h.guide.handle(event('empty_grab', 5, { contact: 'none' }));
    expect(server.lineCalls).toHaveLength(4);
  });

  it('is silent and makes no requests when switched off or forced local', async () => {
    const off = await setup({ settings: { enabled: false } });
    off.guide.handle(event('welcome'));
    expect(off.guide.currentLine()).toBeNull();
    expect(off.status().connection).toBe('off');
    expect(off.status().voice).toBe('none');
    const local = await setup({ settings: { provider: 'local' } });
    local.guide.handle(event('welcome'));
    expect(local.guide.currentLine()!.source).toBe('local');
    expect(local.status().connection).toBe('local');
    expect(local.server.lineCalls).toHaveLength(0);
  });
});

describe('guide: priority, cooldown, de-duplication', () => {
  it('lets a result replace chit-chat that is still being generated', async () => {
    const h = await setup();
    h.guide.handle(event('idle_hint', 5));
    await vi.advanceTimersByTimeAsync(100);
    h.guide.handle(event('prize_won', 5, { toy: { typeId: 't', name: 'Cream Bunny', kind: 'bunny' }, outcome: 'won' }));
    expect(h.server.lineCalls[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    const shown = h.shown();
    expect(shown).toHaveLength(1);
    expect(shown[0]!.eventType).toBe('prize_won');
    expect(h.guide.debugStats().accepted).toBe(2);
  });

  it('lets a result interrupt a hint that is already on screen', async () => {
    const h = await setup({ settings: { provider: 'local' } });
    h.guide.handle(event('aim_help', 2));
    const hint = h.guide.currentLine()!;
    h.guide.handle(event('slipped_after_grip', 2, { slipReason: 'bounced_out', contact: 'lifted', outcome: 'slipped' }));
    const result = h.guide.currentLine()!;
    expect(result.id).not.toBe(hint.id);
    expect(result.eventType).toBe('slipped_after_grip');
  });

  it('drops hints while a result is on screen and does not replay them later', async () => {
    const h = await setup({ settings: { provider: 'local' } });
    h.guide.handle(event('prize_won', 1, { toy: { typeId: 't', name: 'Cream Bunny', kind: 'bunny' } }));
    const win = h.guide.currentLine()!;
    h.guide.handle(event('retry_prompt', 1));
    h.guide.handle(event('idle_hint', 1));
    expect(h.guide.currentLine()!.id).toBe(win.id);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.shown().map((l) => l.eventType)).toEqual(['prize_won']);
    expect(h.guide.debugStats().droppedBusy).toBe(2);
  });

  it('queues one piece of round feedback behind an equal line, never a pile', async () => {
    const h = await setup({ settings: { provider: 'local' } });
    h.guide.handle(event('welcome', 0));
    h.guide.handle(event('first_play', 0));
    h.guide.handle(event('theme_changed', 0));
    expect(h.shown().map((l) => l.eventType)).toEqual(['welcome']);
    await vi.advanceTimersByTimeAsync(4800); // the welcome line ends, the newest waiting line starts
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.shown().map((l) => l.eventType)).toEqual(['welcome', 'theme_changed']);
  });

  it('applies per-type cooldowns scaled by the frequency setting', async () => {
    const h = await setup({ settings: { provider: 'local', frequency: 'normal' } });
    h.guide.handle(event('idle_hint'));
    await vi.advanceTimersByTimeAsync(GUIDE_COOLDOWN_MS.idle_hint - 1000);
    h.guide.handle(event('idle_hint'));
    expect(h.shown()).toHaveLength(1);
    expect(h.guide.debugStats().droppedCooldown).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    h.guide.handle(event('idle_hint'));
    expect(h.shown()).toHaveLength(2);

    const quiet = await setup({ settings: { provider: 'local', frequency: 'quiet' } });
    quiet.guide.handle(event('idle_hint'));
    await vi.advanceTimersByTimeAsync(GUIDE_COOLDOWN_MS.idle_hint * 2);
    quiet.guide.handle(event('idle_hint'));
    expect(quiet.shown()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(GUIDE_COOLDOWN_MS.idle_hint);
    quiet.guide.handle(event('idle_hint'));
    expect(quiet.shown()).toHaveLength(2);

    const chatty = await setup({ settings: { provider: 'local', frequency: 'chatty' } });
    chatty.guide.handle(event('idle_hint'));
    await vi.advanceTimersByTimeAsync(GUIDE_COOLDOWN_MS.idle_hint * 0.5);
    chatty.guide.handle(event('idle_hint'));
    expect(chatty.shown()).toHaveLength(2);
  });

  it('never throttles results', async () => {
    const h = await setup({ settings: { provider: 'local', frequency: 'quiet' } });
    for (let round = 1; round <= 4; round++) {
      h.guide.handle(event('empty_grab', round, { contact: 'none', outcome: 'empty' }));
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(h.shown()).toHaveLength(4);
  });

  it('keeps hints from chasing the previous line', async () => {
    const h = await setup({ settings: { provider: 'local' } });
    h.guide.handle(event('grab_started', 1));
    await vi.advanceTimersByTimeAsync(6000); // the line ended a moment ago
    expect(h.guide.currentLine()).toBeNull();
    h.guide.handle(event('aim_help', 1));
    expect(h.guide.currentLine()).toBeNull(); // too soon after the previous line
    await vi.advanceTimersByTimeAsync(3000);
    h.guide.handle(event('retry_prompt', 1));
    expect(h.guide.currentLine()!.eventType).toBe('retry_prompt');
    const h2 = await setup({ settings: { provider: 'local' } });
    h2.guide.handle(event('empty_grab', 1, { contact: 'none' }));
    h2.guide.silence(); // line cut short right now
    h2.guide.handle(event('aim_help', 1));
    expect(h2.guide.currentLine()).toBeNull();
  });

  it('does not repeat itself when the model returns the same sentence again', async () => {
    const server = fakeServer({
      line: () => ({ delay: 20, response: () => json({ text: 'Aim for the tummy, right in the middle!', emotion: 'think', shouldSpeak: true, model: 'gpt-6-luna', latencyMs: 20 }) }),
    });
    const h = await setup({ server });
    h.guide.handle(event('user_requested_tip', 1));
    await vi.advanceTimersByTimeAsync(30);
    expect(h.guide.currentLine()!.text).toBe('Aim for the tummy, right in the middle!');
    await vi.advanceTimersByTimeAsync(8000);
    h.guide.handle(event('user_requested_tip', 1));
    await vi.advanceTimersByTimeAsync(30);
    const second = h.guide.currentLine()!;
    expect(second.text).not.toBe('Aim for the tummy, right in the middle!');
    expect(second.source).toBe('local');
    // The request carried the recent line so the model could avoid it too.
    expect(h.server.lineCalls[1]!.body.recentLines).toContain('aim for the tummy, right in the middle!');
  });

  it('avoids recent local lines', async () => {
    const h = await setup({ settings: { provider: 'local' } });
    const texts: string[] = [];
    for (let i = 0; i < 5; i++) {
      h.guide.handle(event('empty_grab', i + 1, { contact: 'touched', outcome: 'empty' }));
      texts.push(h.guide.currentLine()!.text);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(new Set(texts).size).toBe(5);
  });
});

describe('guide: stale guard', () => {
  it('drops a reply that belongs to an earlier round', async () => {
    const h = await setup();
    h.guide.handle(event('empty_grab', 7, { contact: 'none' }));
    await vi.advanceTimersByTimeAsync(100);
    h.guide.invalidateBefore(8); // the next round started
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.shown()).toHaveLength(0);
    expect(h.server.lineCalls[0]!.aborted).toBe(true);
    expect(h.guide.debugStats().droppedStale).toBeGreaterThanOrEqual(1);
    // Events that still carry the old round id are refused as well.
    h.guide.handle(event('retry_prompt', 7));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.shown()).toHaveLength(0);
  });

  it('removes advice of the previous round from the screen when the next one starts', async () => {
    const h = await setup({ settings: { provider: 'local' } });
    h.guide.handle(event('empty_grab', 3, { contact: 'none', nearest: { dx: 0.1, dz: 0, dist: 0.1, name: 'Bunny' } }));
    expect(h.guide.currentLine()).not.toBeNull();
    h.guide.invalidateBefore(4);
    expect(h.guide.currentLine()).toBeNull();
    h.guide.handle(event('grab_started', 4));
    expect(h.guide.currentLine()!.roundId).toBe(4);
  });

  it('drops a reply when the language changed meanwhile', async () => {
    const h = await setup();
    h.guide.handle(event('welcome', 1));
    await vi.advanceTimersByTimeAsync(100);
    h.guide.configure(config({ language: 'ja' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.shown()).toHaveLength(0);
    h.guide.handle(event('user_requested_tip', 1));
    await vi.advanceTimersByTimeAsync(400);
    expect(h.server.lineCalls[1]!.body.lang).toBe('ja');
    expect(h.guide.currentLine()!.lang).toBe('ja');
  });

  it('follows the UI language when Momo has no language of her own', async () => {
    const h = await setup({ settings: { provider: 'local', language: 'ui' } });
    h.guide.configure(config({ provider: 'local', language: 'ui' }, { uiLang: 'zh' as Lang }));
    h.guide.handle(event('welcome', 1));
    expect(h.guide.currentLine()!.lang).toBe('zh');
    expect(h.guide.currentLine()!.text).toMatch(/[一-鿿]/);
  });

  it('drops a reply when the theme changed meanwhile', async () => {
    const h = await setup();
    h.guide.handle(event('idle_hint', 1));
    await vi.advanceTimersByTimeAsync(100);
    h.guide.configure(config({}, { themeId: 'ocean', themeVersion: 2 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.shown()).toHaveLength(0);
  });

  it('drops everything while paused and replays nothing afterwards', async () => {
    const h = await setup();
    h.guide.handle(event('grab_started', 1));
    await vi.advanceTimersByTimeAsync(100);
    h.guide.setPaused(true);
    h.guide.handle(event('prize_won', 1, { toy: { typeId: 't', name: 'Cream Bunny', kind: 'bunny' } }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.shown()).toHaveLength(0);
    h.guide.setPaused(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.shown()).toHaveLength(0);
    expect(h.guide.debugStats().droppedPaused).toBe(1);
    h.guide.handle(event('retry_prompt', 1));
    await vi.advanceTimersByTimeAsync(400);
    expect(h.shown()).toHaveLength(1);
  });

  it('clears the line by itself after its display time', async () => {
    const h = await setup({ settings: { provider: 'local' } });
    h.guide.handle(event('welcome', 1));
    expect(h.guide.currentLine()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(7600);
    expect(h.guide.currentLine()).toBeNull();
    expect(h.lines[h.lines.length - 1]).toBeNull();
  });

  it('stops everything on dispose', async () => {
    const h = await setup();
    h.guide.handle(event('welcome', 1));
    await vi.advanceTimersByTimeAsync(50);
    h.guide.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.shown()).toHaveLength(0);
    h.guide.handle(event('prize_won', 1));
    expect(h.guide.currentLine()).toBeNull();
  });
});

describe('guide: cache', () => {
  const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  };

  it('serves small talk from cached GPT lines once enough variants exist', async () => {
    const h = await setup({ settings: { cache: 'session', frequency: 'chatty' } });
    for (let i = 0; i < 4; i++) {
      h.guide.handle(event('aim_help', 1));
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(GUIDE_COOLDOWN_MS.aim_help);
    }
    expect(h.server.lineCalls).toHaveLength(4);
    // The four oldest lines have left the "recent" window after a few other lines.
    for (let round = 2; round <= 7; round++) {
      h.guide.handle(event('empty_grab', round, { contact: 'none' }));
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(8000);
    }
    const before = h.server.lineCalls.length;
    h.guide.handle(event('aim_help', 8));
    const line = h.guide.currentLine()!;
    expect(line).not.toBeNull();
    expect(line.source).toBe('gpt');
    expect(h.server.lineCalls).toHaveLength(before); // no network needed
    expect(h.guide.debugStats().cachedLines).toBe(1);
  });

  it('always asks for a fresh line for results', async () => {
    const h = await setup({ settings: { cache: 'session' } });
    for (let round = 1; round <= 5; round++) {
      h.guide.handle(event('prize_won', round, { toy: { typeId: 't', name: 'Cream Bunny', kind: 'bunny' } }));
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(8000);
    }
    expect(h.server.lineCalls).toHaveLength(5);
  });

  it('stores text only in persistent mode and nothing when the cache is off', async () => {
    const storage = memoryStorage();
    const h = await setup({ storage, settings: { cache: 'persistent' } });
    h.guide.handle(event('welcome', 1));
    await vi.advanceTimersByTimeAsync(400);
    const stored = storage.data.get(LINE_CACHE_STORAGE_KEY)!;
    expect(stored).toContain('GPT line number 1 for you, friend.');
    expect(stored).not.toMatch(/sk-|systemPrompt|roundId/);
    h.guide.configure(config({ cache: 'off' }));
    expect(storage.data.has(LINE_CACHE_STORAGE_KEY)).toBe(false);
  });
});

describe('guide: speech paths', () => {
  it('reports the voice path that really played and keeps the line while it speaks', async () => {
    const ai = fakeSpeech('ai', { ms: 6000 });
    const babble = fakeSpeech('babble');
    const h = await setup({ speech: { ai: ai.provider, babble: babble.provider, system: fakeSpeech('system', { available: false }).provider } });
    // Before anything was spoken only the local path may be claimed.
    expect(h.status().voice).toBe('babble');
    h.guide.handle(event('welcome', 1));
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(200);
    const line = h.guide.currentLine()!;
    expect(line.speaking).toBe(true);
    expect(line.voice).toBe('ai');
    expect(h.status().voice).toBe('ai');
    expect(ai.spoken).toEqual(['GPT line number 1 for you, friend.']);
    expect(babble.spoken).toHaveLength(0);
    // Display time (~3.4 s) is over, but the audio is not: the subtitle stays.
    await vi.advanceTimersByTimeAsync(4500);
    expect(h.guide.currentLine()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2500);
    expect(h.guide.currentLine()).toBeNull();
  });

  it('falls back to the local voice when the AI voice cannot speak', async () => {
    const ai = fakeSpeech('ai', { works: false });
    const babble = fakeSpeech('babble');
    const h = await setup({ speech: { ai: ai.provider, babble: babble.provider, system: fakeSpeech('system', { available: false }).provider } });
    h.guide.handle(event('welcome', 1));
    await vi.advanceTimersByTimeAsync(600);
    expect(h.guide.currentLine()!.voice).toBe('babble');
    expect(h.status().voice).toBe('babble');
    expect(babble.spoken).toHaveLength(1);
  });

  it('prefers the system voice when selected and falls back to babble without one', async () => {
    const system = fakeSpeech('system');
    const babble = fakeSpeech('babble');
    const h = await setup({ settings: { provider: 'local', localVoice: 'system' }, speech: { system: system.provider, babble: babble.provider } });
    h.guide.handle(event('welcome', 1));
    await vi.advanceTimersByTimeAsync(300);
    expect(h.guide.currentLine()!.voice).toBe('system');
    const none = fakeSpeech('system', { available: false });
    const babble2 = fakeSpeech('babble');
    const h2 = await setup({ settings: { provider: 'local', localVoice: 'system' }, speech: { system: none.provider, babble: babble2.provider } });
    h2.guide.handle(event('welcome', 1));
    await vi.advanceTimersByTimeAsync(300);
    expect(h2.guide.currentLine()!.voice).toBe('babble');
  });

  it('shows subtitles only when voice is off or no voice exists', async () => {
    const babble = fakeSpeech('babble');
    const muted = await setup({ settings: { provider: 'local', voice: false }, speech: { babble: babble.provider } });
    muted.guide.handle(event('welcome', 1));
    await vi.advanceTimersByTimeAsync(300);
    expect(muted.guide.currentLine()!.voice).toBe('none');
    expect(muted.guide.currentLine()!.speaking).toBe(false);
    expect(babble.spoken).toHaveLength(0);
    expect(muted.status().voice).toBe('none');
    const silent = await setup({ settings: { provider: 'local', localVoice: 'none' } });
    silent.guide.handle(event('welcome', 1));
    await vi.advanceTimersByTimeAsync(300);
    expect(silent.guide.currentLine()!.voice).toBe('none');
    expect(silent.status().voice).toBe('none');
  });

  it('never lets two lines talk over each other', async () => {
    const babble = fakeSpeech('babble', { ms: 3000 });
    const h = await setup({ settings: { provider: 'local' }, speech: { babble: babble.provider } });
    h.guide.handle(event('grab_started', 1));
    await vi.advanceTimersByTimeAsync(300);
    h.guide.handle(event('prize_won', 1, { toy: { typeId: 't', name: 'Cream Bunny', kind: 'bunny' } }));
    await vi.advanceTimersByTimeAsync(300);
    h.guide.handle(event('user_requested_tip', 1));
    await vi.advanceTimersByTimeAsync(300);
    expect(babble.spoken).toHaveLength(3);
    expect(babble.stats().maxActive).toBe(1);
    expect(babble.stats().stopped).toBe(2);
  });

  it('stops the audio at once on silence() and when paused', async () => {
    const babble = fakeSpeech('babble', { ms: 5000 });
    const h = await setup({ settings: { provider: 'local' }, speech: { babble: babble.provider } });
    h.guide.handle(event('welcome', 1));
    await vi.advanceTimersByTimeAsync(300);
    expect(babble.stats().active).toBe(1);
    h.guide.silence();
    expect(babble.stats().active).toBe(0);
    expect(h.guide.currentLine()).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    h.guide.handle(event('prize_won', 2, { toy: { typeId: 't', name: 'Cream Bunny', kind: 'bunny' } }));
    await vi.advanceTimersByTimeAsync(300);
    expect(babble.stats().active).toBe(1);
    h.guide.setPaused(true);
    expect(babble.stats().active).toBe(0);
  });

  it('previews the configured voice and says which path played', async () => {
    const babble = fakeSpeech('babble');
    const h = await setup({ settings: { provider: 'local' }, speech: { babble: babble.provider } });
    const pending = h.guide.previewVoice();
    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toEqual({ ok: true, detail: 'Momo babble voice' });
    expect(babble.spoken[0]).toMatch(/Momo/);
    const none = await setup({ settings: { provider: 'local', localVoice: 'none' } });
    await expect(none.guide.previewVoice()).resolves.toMatchObject({ ok: false });
  });
});

describe('guide: connection test', () => {
  it('reports a missing key without pretending', async () => {
    const h = await setup({ server: fakeServer({ status: () => json({ ...STATUS, configured: false }) }) });
    const result = await h.guide.testConnection();
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/no OpenAI API key/i);
    expect(h.server.testCalls).toBe(0);
    expect(h.status().connection).toBe('local');
  });

  it('reports an unreachable server', async () => {
    const h = await setup({ server: fakeServer({ status: () => new TypeError('fetch failed') }) });
    await expect(h.guide.testConnection()).resolves.toMatchObject({ ok: false, latencyMs: null });
  });

  it('confirms GPT only after a real round trip', async () => {
    const h = await setup();
    expect(h.status().connection).toBe('checking');
    const result = await h.guide.testConnection();
    expect(result).toMatchObject({ ok: true, latencyMs: 420, sample: 'Aim for the tummy!' });
    expect(result.detail).toContain('gpt-6-luna');
    expect(h.status().connection).toBe('gpt');
  });

  it('surfaces a failed round trip as an error', async () => {
    const server = fakeServer({ test: () => json({ ok: false, code: 'upstream_auth', message: 'rejected', text: { ok: false, model: 'gpt-6-luna', latencyMs: 90, code: 'upstream_auth' } }) });
    const h = await setup({ server });
    const result = await h.guide.testConnection();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('upstream_auth');
    expect(h.status().connection).toBe('error');
  });

  it('verifies with a normal line request when the test endpoint is admin only', async () => {
    const server = fakeServer({
      test: () => json({ error: { code: 'forbidden', message: 'admin' } }, 401),
      line: () => ({ delay: 0, response: () => json({ text: 'Round bodies are easier to hold than ears.', emotion: 'think', shouldSpeak: true, model: 'gpt-6-luna', latencyMs: 210 }) }),
    });
    const h = await setup({ server });
    const pending = h.guide.testConnection();
    await vi.advanceTimersByTimeAsync(10);
    const result = await pending;
    expect(result).toMatchObject({ ok: true, latencyMs: 210, sample: 'Round bodies are easier to hold than ears.' });
    expect(server.lineCalls[0]!.body.event.type).toBe('user_requested_tip');
    expect(h.status().connection).toBe('gpt');
  });
});
