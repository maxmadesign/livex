import type { AudioPort } from '../../core/contracts';
import type { SpeechRequestBody } from '../protocol';
import { SPEECH_HEADERS } from '../protocol';
import type { SpeechPlayback, SpeechProvider, SpeechRequest } from './types';

export interface AiSpeechInfo {
  ok: boolean;
  /** Non-localised detail for diagnostics. */
  detail: string;
  model: string | null;
  api: string | null;
  voice: string | null;
  latencyMs: number | null;
  cached: boolean;
}

export interface AiSpeechDeps {
  audio: AudioPort | null;
  fetchImpl: typeof fetch;
  baseUrl: string;
  now: () => number;
  /** Is an OpenAI voice possible at all (server configured, provider = openai)? */
  eligible: () => boolean;
  /** Time budget for one synthesis request. */
  timeoutMs: () => number;
  onResult?: (info: AiSpeechInfo) => void;
}

const MAX_CACHE_ENTRIES = 24;
const MAX_CACHE_BYTES = 6 * 1024 * 1024;
const FAILURES_BEFORE_PAUSE = 2;
const PAUSE_AFTER_FAILURES_MS = 60_000;

/**
 * OpenAI voice through the server proxy (`/api/ai/speech`). The browser never
 * sees a key; it receives finished audio bytes and plays them on the voice bus.
 * After repeated failures the provider steps aside for a minute so that lines
 * are not delayed again and again.
 */
export function createAiSpeech(deps: AiSpeechDeps): SpeechProvider & { reset(): void } {
  const cache = new Map<string, ArrayBuffer>();
  let cacheBytes = 0;
  let failures = 0;
  let pausedUntil = 0;

  const remember = (key: string, data: ArrayBuffer) => {
    if (data.byteLength > MAX_CACHE_BYTES / 4) return;
    cache.set(key, data);
    cacheBytes += data.byteLength;
    while (cache.size > MAX_CACHE_ENTRIES || cacheBytes > MAX_CACHE_BYTES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cacheBytes -= cache.get(oldest)?.byteLength ?? 0;
      cache.delete(oldest);
    }
  };

  const fail = (detail: string, latencyMs: number | null) => {
    failures += 1;
    if (failures >= FAILURES_BEFORE_PAUSE) pausedUntil = deps.now() + PAUSE_AFTER_FAILURES_MS;
    deps.onResult?.({ ok: false, detail, model: null, api: null, voice: null, latencyMs, cached: false });
    return null;
  };

  return {
    path: 'ai',
    available() {
      return deps.audio !== null && deps.eligible() && deps.now() >= pausedUntil;
    },
    reset() {
      failures = 0;
      pausedUntil = 0;
    },
    async speak(request: SpeechRequest): Promise<SpeechPlayback | null> {
      const audio = deps.audio;
      if (!audio || request.signal.aborted) return null;
      const key = [request.model, request.voiceName, request.speed.toFixed(2), request.lang, request.text].join('|');
      const started = deps.now();
      let data = cache.get(key) ?? null;
      let info: AiSpeechInfo = {
        ok: true,
        detail: 'cached AI audio',
        model: null,
        api: null,
        voice: null,
        latencyMs: 0,
        cached: true,
      };
      if (!data) {
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        request.signal.addEventListener('abort', onAbort, { once: true });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, deps.timeoutMs());
        try {
          const body: SpeechRequestBody = { text: request.text, lang: request.lang, speed: request.speed };
          if (request.voiceName) body.voice = request.voiceName;
          if (request.model) body.model = request.model;
          const response = await deps.fetchImpl(`${deps.baseUrl}/api/ai/speech`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (!response.ok) {
            let code = `HTTP ${response.status}`;
            try {
              const err = (await response.json()) as { error?: { code?: string } };
              if (err?.error?.code) code = err.error.code;
            } catch {
              /* not JSON */
            }
            return fail(`AI voice request failed (${code})`, deps.now() - started);
          }
          const type = response.headers.get('content-type') ?? '';
          if (!type.startsWith('audio/')) return fail('AI voice returned no audio', deps.now() - started);
          data = await response.arrayBuffer();
          if (data.byteLength < 64) return fail('AI voice returned empty audio', deps.now() - started);
          info = {
            ok: true,
            detail: 'AI audio received',
            model: response.headers.get(SPEECH_HEADERS.model),
            api: response.headers.get(SPEECH_HEADERS.api),
            voice: response.headers.get(SPEECH_HEADERS.voice),
            latencyMs: deps.now() - started,
            cached: response.headers.get(SPEECH_HEADERS.cache) === 'hit',
          };
          remember(key, data);
        } catch {
          if (request.signal.aborted) return null; // cancelled by the director: not a failure
          return fail(timedOut ? 'AI voice timed out' : 'AI voice unreachable', deps.now() - started);
        } finally {
          clearTimeout(timer);
          request.signal.removeEventListener('abort', onAbort);
        }
      }
      if (request.signal.aborted) return null;
      try {
        // decodeAudioData detaches its input, so the cache keeps the original and playback gets a copy.
        const handle = audio.playVoice(data.slice(0), { volume: 1, rate: 1 });
        failures = 0;
        deps.onResult?.(info);
        const stop = () => handle.stop();
        request.signal.addEventListener('abort', stop, { once: true });
        const done = handle.done.then(
          () => request.signal.removeEventListener('abort', stop),
          () => request.signal.removeEventListener('abort', stop),
        );
        return { path: 'ai', done, stop };
      } catch {
        return fail('AI audio could not be played', deps.now() - started);
      }
    },
  };
}
