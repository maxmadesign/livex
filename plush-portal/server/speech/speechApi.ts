/**
 * Speech API provider: POST /v1/audio/speech with a text-to-speech model
 * (tts-1, tts-1-hd, gpt-4o-mini-tts). OpenAI has announced the shutdown of
 * these models for 2027-01-06; this path is kept for existing deployments and
 * the Realtime provider is the default.
 */
import { buildVoiceStyle } from '../../src/ai/prompt';
import { speechApiAcceptsInstructions } from '../capabilities';
import { ApiFailure } from '../errors';
import type { ServerSpeechProvider, SpeechJob, SpeechResult } from './types';

/** The slice of the OpenAI client this provider needs. */
export interface SpeechApiClient {
  audio: {
    speech: {
      create(
        body: Record<string, unknown>,
        options?: { timeout?: number; maxRetries?: number; signal?: AbortSignal },
      ): PromiseLike<{ arrayBuffer(): Promise<ArrayBuffer> }>;
    };
  };
}

export function createSpeechApiProvider(client: SpeechApiClient): ServerSpeechProvider {
  return {
    api: 'speech',
    async synthesize(job: SpeechJob): Promise<SpeechResult> {
      const body: Record<string, unknown> = {
        model: job.model,
        voice: job.voice.startsWith('voice_') ? { id: job.voice } : job.voice,
        input: job.text,
        response_format: 'mp3',
        speed: job.speed,
      };
      // tts-1 / tts-1-hd reject `instructions`; only send it where it is supported.
      if (speechApiAcceptsInstructions(job.model)) body.instructions = buildVoiceStyle(job.lang);
      const response = await client.audio.speech.create(body, { timeout: job.timeoutMs, maxRetries: 0, signal: job.signal });
      const audio = new Uint8Array(await response.arrayBuffer());
      if (audio.byteLength < 64) throw new ApiFailure(502, 'bad_output', 'The speech model returned no audio.');
      return { audio, mime: 'audio/mpeg', model: job.model, voice: job.voice };
    },
  };
}
