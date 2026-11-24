/**
 * Speech service: picks the provider for the configured speech API, refuses
 * model / endpoint mismatches, caches identical requests and maps failures.
 */
import type { SpeechApi } from '../../src/ai/protocol';
import { describeSpeechMismatch, speechModelMatches, voiceSupported } from '../capabilities';
import { ApiFailure, mapUpstreamError } from '../errors';
import type { Logger } from '../log';
import { SpeechCache } from './cache';
import { mapRealtimeError } from './realtime';
import type { ServerSpeechProvider, SpeechResult } from './types';

export interface SpeechServiceConfig {
  speechApi: SpeechApi;
  speechModel: string;
  voice: string;
  speechConfigError: string;
  speechTimeoutMs: number;
}

export interface SpeechServiceDeps {
  config: SpeechServiceConfig;
  providers: Partial<Record<SpeechApi, ServerSpeechProvider>>;
  logger: Logger;
  cache?: SpeechCache;
}

export interface SpeechCall {
  text: string;
  lang: 'en' | 'zh' | 'ja';
  voice?: string;
  speed?: number;
  /** Already authorised model override, or undefined for the configured model. */
  model?: string;
  signal?: AbortSignal;
}

export interface SpeechService {
  synthesize(call: SpeechCall): Promise<SpeechResult & { api: SpeechApi; cached: boolean }>;
}

export function createSpeechService(deps: SpeechServiceDeps): SpeechService {
  const { config, providers, logger } = deps;
  const cache = deps.cache ?? new SpeechCache();
  return {
    async synthesize(call) {
      const api = config.speechApi;
      if (config.speechConfigError) throw new ApiFailure(503, 'model_mismatch', config.speechConfigError);
      const model = call.model ?? config.speechModel;
      // A text model must never reach a speech endpoint, nor a TTS model the Realtime API.
      if (!speechModelMatches(api, model)) throw new ApiFailure(400, 'model_mismatch', describeSpeechMismatch(api, model));
      const provider = providers[api];
      if (!provider) throw new ApiFailure(503, 'speech_unavailable', `No provider is available for the "${api}" speech API.`);
      const voice = call.voice && voiceSupported(api, call.voice) ? call.voice : config.voice;
      const speed = Math.min(1.5, Math.max(0.5, call.speed ?? 1));
      const key = SpeechCache.key({ api, model, voice, speed, lang: call.lang, text: call.text });
      const hit = cache.get(key);
      if (hit) return { ...hit, api, cached: true };
      try {
        const result = await provider.synthesize({
          text: call.text,
          lang: call.lang,
          voice,
          speed,
          model,
          timeoutMs: config.speechTimeoutMs,
          signal: call.signal,
        });
        cache.set(key, result);
        return { ...result, api, cached: false };
      } catch (error) {
        const failure = api === 'realtime' ? mapRealtimeError(error) : mapUpstreamError(error, 'speech');
        logger.info('speech failed', { api, model, code: failure.code });
        throw failure;
      }
    },
  };
}

export { SpeechCache } from './cache';
export { createSpeechApiProvider, type SpeechApiClient } from './speechApi';
export {
  createRealtimeSpeechProvider,
  openAiRealtimeConnect,
  mapRealtimeError,
  REALTIME_SAMPLE_RATE,
  type RealtimeConnect,
  type RealtimeConnection,
} from './realtime';
export { pcm16ToWav } from './wav';
export type { ServerSpeechProvider, SpeechJob, SpeechResult } from './types';
