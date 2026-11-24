import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioPort, VoiceHandle } from '../../../src/core/contracts';
import { SPEECH_HEADERS } from '../../../src/ai/protocol';
import { createAiSpeech, type AiSpeechInfo } from '../../../src/ai/speech/aiSpeech';
import { createBabbleSpeech } from '../../../src/ai/speech/babble';
import { SpeechRouter } from '../../../src/ai/speech/router';
import { createSystemSpeech } from '../../../src/ai/speech/systemSpeech';
import type { SpeechPath, SpeechPlayback, SpeechProvider, SpeechRequest } from '../../../src/ai/speech/types';

const request = (overrides: Partial<SpeechRequest> = {}): SpeechRequest => ({
  text: 'Nice catch!',
  lang: 'en',
  emotion: 'cheer',
  speed: 1,
  voiceName: '',
  model: '',
  signal: new AbortController().signal,
  ...overrides,
});

/** Records what the audio engine was asked to do. */
function fakeAudio(options: { playMs?: number; bus?: boolean } = {}) {
  const played: { bytes: number; first: number }[] = [];
  const duck: boolean[] = [];
  let stops = 0;
  const audio = {
    playVoice(data: ArrayBuffer | AudioBuffer): VoiceHandle {
      const buffer = data as ArrayBuffer;
      played.push({ bytes: buffer.byteLength, first: new Uint8Array(buffer)[0] ?? -1 });
      // The real engine hands the buffer to decodeAudioData, which detaches it.
      structuredClone(buffer, { transfer: [buffer] });
      let finish: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const timer = setTimeout(finish, options.playMs ?? 900);
      return {
        done,
        stop: () => {
          stops++;
          clearTimeout(timer);
          finish();
        },
      };
    },
    voiceBus: () => null,
    setVoiceActive: (active: boolean) => void duck.push(active),
    stopVoice: () => {},
  } as unknown as AudioPort;
  return { audio, played, duck, stops: () => stops };
}

const audioResponse = (bytes = 4096, headers: Record<string, string> = {}) =>
  new Response(new Uint8Array(bytes).fill(9), {
    status: 200,
    headers: {
      'content-type': 'audio/wav',
      [SPEECH_HEADERS.model]: 'gpt-realtime-2.1-mini',
      [SPEECH_HEADERS.api]: 'realtime',
      [SPEECH_HEADERS.voice]: 'marin',
      [SPEECH_HEADERS.cache]: 'miss',
      ...headers,
    },
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AI voice through the proxy', () => {
  function setup(respond: (body: Record<string, unknown>, signal: AbortSignal) => Promise<Response> | Response, options: { eligible?: boolean; timeoutMs?: number } = {}) {
    const engine = fakeAudio();
    const bodies: Record<string, unknown>[] = [];
    const results: AiSpeechInfo[] = [];
    const provider = createAiSpeech({
      audio: engine.audio,
      baseUrl: '',
      now: () => Date.now(),
      eligible: () => options.eligible ?? true,
      timeoutMs: () => options.timeoutMs ?? 4000,
      onResult: (info) => results.push(info),
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe('/api/ai/speech');
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        return await respond(body, init!.signal!);
      }) as typeof fetch,
    });
    return { provider, engine, bodies, results };
  }

  it('fetches audio, plays it on the voice bus and reports what the server used', async () => {
    const h = setup(() => audioResponse());
    const playback = await h.provider.speak(request({ voiceName: 'coral', speed: 1.1, lang: 'ja', text: 'やったー！' }));
    expect(playback?.path).toBe('ai');
    expect(h.bodies[0]).toEqual({ text: 'やったー！', lang: 'ja', speed: 1.1, voice: 'coral' });
    expect(h.engine.played).toEqual([{ bytes: 4096, first: 9 }]);
    expect(h.results[0]).toMatchObject({ ok: true, model: 'gpt-realtime-2.1-mini', api: 'realtime', voice: 'marin', cached: false });
    let finished = false;
    void playback!.done.then(() => (finished = true));
    await vi.advanceTimersByTimeAsync(899);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(finished).toBe(true);
  });

  it('replays an identical line from its own cache without a second request', async () => {
    const h = setup(() => audioResponse());
    await h.provider.speak(request());
    await h.provider.speak(request());
    await h.provider.speak(request({ speed: 1.2 }));
    expect(h.bodies).toHaveLength(2);
    // The engine detaches what it is given; the cached copy must still be intact.
    expect(h.engine.played.map((p) => p.bytes)).toEqual([4096, 4096, 4096]);
    expect(h.results[1]).toMatchObject({ ok: true, cached: true });
  });

  it('gives way after errors instead of delaying every line', async () => {
    const h = setup(() => new Response(JSON.stringify({ error: { code: 'upstream_auth', message: 'x' } }), { status: 502, headers: { 'content-type': 'application/json' } }));
    expect(await h.provider.speak(request({ text: 'one' }))).toBeNull();
    expect(h.provider.available('en')).toBe(true);
    expect(await h.provider.speak(request({ text: 'two' }))).toBeNull();
    expect(h.results.map((r) => r.detail)).toEqual(['AI voice request failed (upstream_auth)', 'AI voice request failed (upstream_auth)']);
    expect(h.provider.available('en')).toBe(false); // paused after two failures
    await vi.advanceTimersByTimeAsync(61_000);
    expect(h.provider.available('en')).toBe(true);
    expect(h.engine.played).toHaveLength(0);
  });

  it('treats non-audio and empty answers as failures', async () => {
    const html = setup(() => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await html.provider.speak(request())).toBeNull();
    expect(html.results[0]!.detail).toBe('AI voice returned no audio');
    const empty = setup(() => audioResponse(10));
    expect(await empty.provider.speak(request())).toBeNull();
    expect(empty.results[0]!.detail).toBe('AI voice returned empty audio');
  });

  it('times out slow synthesis and aborts the request', async () => {
    let aborted = false;
    const h = setup(
      (_body, signal) =>
        new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
      { timeoutMs: 3000 },
    );
    const pending = h.provider.speak(request());
    await vi.advanceTimersByTimeAsync(3001);
    expect(await pending).toBeNull();
    expect(aborted).toBe(true);
    expect(h.results[0]).toMatchObject({ ok: false, detail: 'AI voice timed out' });
  });

  it('does not count a cancelled line as a failure and stops playback on abort', async () => {
    const controller = new AbortController();
    const h = setup(
      (_body, signal) =>
        new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    );
    const pending = h.provider.speak(request({ signal: controller.signal }));
    controller.abort();
    expect(await pending).toBeNull();
    expect(h.results).toHaveLength(0);
    expect(h.provider.available('en')).toBe(true);

    const playing = new AbortController();
    const ok = setup(() => audioResponse());
    const playback = await ok.provider.speak(request({ signal: playing.signal }));
    expect(playback).not.toBeNull();
    playing.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(ok.engine.stops()).toBe(1);
  });

  it('is unavailable without an audio engine or without a configured server', async () => {
    const none = createAiSpeech({ audio: null, baseUrl: '', now: () => 0, eligible: () => true, timeoutMs: () => 1000, fetchImpl: fetch });
    expect(none.available('en')).toBe(false);
    expect(await none.speak(request())).toBeNull();
    const h = setup(() => audioResponse(), { eligible: false });
    expect(h.provider.available('en')).toBe(false);
  });
});

describe('system voice', () => {
  class FakeUtterance {
    voice: unknown = null;
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }
  function fakeSynth(voices: { lang: string; localService: boolean; name: string }[], behaviour: 'speaks' | 'silent' = 'speaks') {
    const spoken: FakeUtterance[] = [];
    let cancels = 0;
    const synth = {
      getVoices: () => voices,
      addEventListener: () => {},
      cancel: () => {
        cancels++;
        const last = spoken[spoken.length - 1];
        last?.onend?.();
      },
      speak: (utterance: FakeUtterance) => {
        spoken.push(utterance);
        if (behaviour === 'speaks') {
          setTimeout(() => utterance.onstart?.(), 50);
          setTimeout(() => utterance.onend?.(), 1500);
        }
      },
    };
    return { synth: synth as unknown as SpeechSynthesis, spoken, cancels: () => cancels };
  }

  beforeEach(() => vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance));

  it('is only available for languages the device has a voice for', () => {
    const { synth } = fakeSynth([{ lang: 'en-US', localService: true, name: 'Sam' }]);
    const provider = createSystemSpeech({ audio: null, volume: () => 1, synth });
    expect(provider.available('en')).toBe(true);
    expect(provider.available('zh')).toBe(false);
    expect(provider.available('ja')).toBe(false);
    expect(createSystemSpeech({ audio: null, volume: () => 1, synth: null }).available('en')).toBe(false);
  });

  it('speaks with a matching local voice, holds the music duck and applies the volume', async () => {
    const engine = fakeAudio();
    const { synth, spoken } = fakeSynth([
      { lang: 'zh-TW', localService: false, name: 'Remote TW' },
      { lang: 'zh-CN', localService: false, name: 'Remote CN' },
      { lang: 'zh-CN', localService: true, name: 'Local CN' },
    ]);
    const provider = createSystemSpeech({ audio: engine.audio, volume: () => 0.4, synth });
    const pending = provider.speak(request({ lang: 'zh', text: '抓到啦！', speed: 1.2 }));
    await vi.advanceTimersByTimeAsync(60);
    const playback = await pending;
    expect(playback?.path).toBe('system');
    const utterance = spoken[0]!;
    expect((utterance.voice as { name: string }).name).toBe('Local CN');
    expect(utterance.lang).toBe('zh-CN');
    expect(utterance.volume).toBe(0.4);
    expect(utterance.rate).toBeCloseTo(1.26, 5);
    expect(engine.duck).toEqual([true]);
    await vi.advanceTimersByTimeAsync(1500);
    await playback!.done;
    expect(engine.duck).toEqual([true, false]);
  });

  it('gives up when the engine never starts speaking', async () => {
    const { synth, cancels } = fakeSynth([{ lang: 'en-GB', localService: true, name: 'Kate' }], 'silent');
    const provider = createSystemSpeech({ audio: null, volume: () => 1, synth });
    const pending = provider.speak(request());
    await vi.advanceTimersByTimeAsync(1900);
    expect(await pending).toBeNull();
    expect(cancels()).toBeGreaterThanOrEqual(1);
  });

  it('stops immediately when the line is cancelled', async () => {
    const engine = fakeAudio();
    const controller = new AbortController();
    const { synth } = fakeSynth([{ lang: 'ja-JP', localService: true, name: 'Kyoko' }]);
    const provider = createSystemSpeech({ audio: engine.audio, volume: () => 1, synth });
    const pending = provider.speak(request({ lang: 'ja', signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(60);
    const playback = await pending;
    let finished = false;
    void playback!.done.then(() => (finished = true));
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(true);
    expect(engine.duck).toEqual([true, false]);
  });
});

describe('babble voice without an audio bus', () => {
  it('reports itself unavailable until the audio engine is unlocked', async () => {
    const engine = fakeAudio();
    const provider = createBabbleSpeech(engine.audio);
    expect(provider.available('en')).toBe(false);
    expect(await provider.speak(request())).toBeNull();
    expect(createBabbleSpeech(null).available('zh')).toBe(false);
  });
});

describe('speech router', () => {
  function scripted(path: SpeechPath, behaviour: 'plays' | 'refuses' | 'dies' | 'throws', available = true) {
    let calls = 0;
    let stops = 0;
    const provider: SpeechProvider = {
      path,
      available: () => available,
      async speak(req): Promise<SpeechPlayback | null> {
        calls++;
        if (behaviour === 'refuses') return null;
        if (behaviour === 'throws') throw new Error('boom');
        let finish: () => void = () => {};
        const done = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const timer = setTimeout(finish, behaviour === 'dies' ? 20 : 2000);
        const stop = () => {
          stops++;
          clearTimeout(timer);
          finish();
        };
        req.signal.addEventListener('abort', stop, { once: true });
        return { path, done, stop };
      },
    };
    return { provider, calls: () => calls, stops: () => stops };
  }
  const router = (ai: SpeechProvider, system: SpeechProvider, babble: SpeechProvider) => new SpeechRouter({ ai, system, babble }, () => Date.now());

  it('uses the first path that really produces sound', async () => {
    const ai = scripted('ai', 'refuses');
    const system = scripted('system', 'plays', false);
    const babble = scripted('babble', 'plays');
    const r = router(ai.provider, system.provider, babble.provider);
    expect(r.usable(['ai', 'system', 'babble'], 'en')).toEqual(['ai', 'babble']);
    const pending = r.speak(['ai', 'system', 'babble'], request());
    await vi.advanceTimersByTimeAsync(200);
    expect((await pending)?.path).toBe('babble');
    expect(ai.calls()).toBe(1);
    expect(system.calls()).toBe(0);
    expect(r.isSpeaking()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.isSpeaking()).toBe(false);
  });

  it('moves on when a path throws or its audio ends immediately', async () => {
    const ai = scripted('ai', 'throws');
    const system = scripted('system', 'dies');
    const babble = scripted('babble', 'plays');
    const r = router(ai.provider, system.provider, babble.provider);
    const pending = r.speak(['ai', 'system', 'babble'], request());
    await vi.advanceTimersByTimeAsync(400);
    expect((await pending)?.path).toBe('babble');
  });

  it('returns null when nothing can speak', async () => {
    const r = router(scripted('ai', 'refuses').provider, scripted('system', 'refuses').provider, scripted('babble', 'refuses').provider);
    const pending = r.speak(['ai', 'system', 'babble'], request());
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toBeNull();
    expect(await r.speak([], request())).toBeNull();
  });

  it('stops the previous utterance when a new one starts', async () => {
    const babble = scripted('babble', 'plays');
    const r = router(scripted('ai', 'refuses', false).provider, scripted('system', 'refuses', false).provider, babble.provider);
    const first = r.speak(['babble'], request({ text: 'one' }));
    await vi.advanceTimersByTimeAsync(200);
    await first;
    const second = r.speak(['babble'], request({ text: 'two' }));
    await vi.advanceTimersByTimeAsync(200);
    await second;
    expect(babble.stops()).toBe(1);
    r.stop();
    expect(babble.stops()).toBe(2);
    expect(r.isSpeaking()).toBe(false);
  });
});
