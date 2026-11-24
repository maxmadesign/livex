/**
 * Realtime provider: text in, audio out over the Realtime API (WebSocket).
 * No microphone and no input audio are involved. One short-lived session per
 * line:
 *
 *   session.update            (audio output only, voice, speed, style instructions)
 *   conversation.item.create  (user message with the line as input_text)
 *   response.create
 *   ← response.output_audio.delta ...  (base64 PCM16, 24 kHz mono)
 *   ← response.done
 *
 * Event names and payload shapes follow the Realtime types of the installed
 * openai SDK (they are type-checked below). The Realtime model speaks the line
 * as a response, so the wording is strongly steered but not guaranteed to be
 * verbatim; subtitles always show the intended text.
 */
import type OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import type { RealtimeClientEvent, RealtimeServerEvent } from 'openai/resources/realtime/realtime';
import { buildVoiceStyle } from '../../src/ai/prompt';
import { ApiFailure } from '../errors';
import type { ServerSpeechProvider, SpeechJob, SpeechResult } from './types';
import { pcm16ToWav } from './wav';

export const REALTIME_SAMPLE_RATE = 24000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/** Minimal connection surface, so tests can script the server side of a session. */
export interface RealtimeConnection {
  /** Resolves when the socket is open, rejects when it could not be opened. */
  opened: Promise<void>;
  send(event: RealtimeClientEvent): void;
  onEvent(listener: (event: RealtimeServerEvent) => void): void;
  onError(listener: (error: unknown) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}
export type RealtimeConnect = (model: string) => RealtimeConnection;

/** Opens Realtime sessions with the official SDK's WebSocket helper (needs the `ws` package). */
export function openAiRealtimeConnect(client: OpenAI): RealtimeConnect {
  return (model: string) => {
    const rt = new OpenAIRealtimeWS({ model }, client);
    const opened = new Promise<void>((resolve, reject) => {
      rt.socket.once('open', () => resolve());
      rt.socket.once('error', (error) => reject(error));
      rt.socket.once('unexpected-response', (_request, response) => {
        reject(new Error(`Unexpected server response: ${response.statusCode ?? 'unknown'}`));
      });
    });
    opened.catch(() => {}); // consumers attach their own handlers; never leave it unhandled
    return {
      opened,
      send: (event) => rt.send(event),
      onEvent: (listener) => {
        rt.on('event', listener);
      },
      onError: (listener) => {
        rt.on('error', listener);
      },
      onClose: (listener) => {
        rt.socket.on('close', () => listener());
      },
      close: () => {
        try {
          rt.close();
        } catch {
          /* already closed */
        }
      },
    };
  };
}

const safeCode = (value: unknown): string => (typeof value === 'string' ? value.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) : '');

/** Maps Realtime / WebSocket failures to our error vocabulary without forwarding upstream text. */
export function mapRealtimeError(error: unknown): ApiFailure {
  if (error instanceof ApiFailure) return error;
  const e = (error ?? {}) as { error?: { code?: unknown; type?: unknown }; code?: unknown; message?: unknown };
  const code = safeCode(e.error?.code) || safeCode(e.code);
  const type = safeCode(e.error?.type);
  const message = typeof e.message === 'string' ? e.message : '';
  const handshake = /Unexpected server response: (\d{3})/.exec(message);
  const status = handshake ? Number(handshake[1]) : null;
  const hint = code ? ` (${code})` : '';
  if (status === 401 || status === 403 || /invalid_api_key|authentication/.test(code)) {
    return new ApiFailure(502, 'upstream_auth', `OpenAI rejected the server's credentials for the Realtime API${hint}.`);
  }
  if (status === 404 || /model_not_found|invalid_model/.test(code)) {
    return new ApiFailure(502, 'upstream_model', `The configured Realtime voice model is not available to this API key${hint}.`);
  }
  if (status === 429 || /rate_limit|insufficient_quota/.test(code)) {
    return new ApiFailure(503, 'upstream_rate_limited', `OpenAI is rate limiting the Realtime API for this key${hint}.`, { 'retry-after': '10' });
  }
  if (type === 'invalid_request_error') {
    return new ApiFailure(502, 'upstream_rejected', `OpenAI rejected the Realtime voice request${hint}.`);
  }
  return new ApiFailure(502, 'upstream_error', `The Realtime voice connection failed${status ? ` (${status})` : hint}.`);
}

export interface RealtimeProviderOptions {
  /** Optional `reasoning.effort` for reasoning-capable Realtime models; null = field not sent. */
  reasoningEffort?: string | null;
}

export function createRealtimeSpeechProvider(connect: RealtimeConnect, options: RealtimeProviderOptions = {}): ServerSpeechProvider {
  return {
    api: 'realtime',
    synthesize(job: SpeechJob): Promise<SpeechResult> {
      return new Promise<SpeechResult>((resolve, reject) => {
        let connection: RealtimeConnection;
        try {
          connection = connect(job.model);
        } catch (error) {
          reject(mapRealtimeError(error));
          return;
        }
        const chunks: Uint8Array[] = [];
        let audioBytes = 0;
        let transcript = '';
        let settled = false;
        let stage: 'opening' | 'configuring' | 'speaking' = 'opening';

        const finish = (error: ApiFailure | null, result?: SpeechResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          job.signal?.removeEventListener('abort', onAbort);
          connection.close();
          if (error) reject(error);
          else resolve(result!);
        };
        const timer = setTimeout(
          () => finish(new ApiFailure(504, 'timeout', 'The Realtime voice did not finish in time.')),
          job.timeoutMs,
        );
        const onAbort = () => finish(new ApiFailure(499, 'cancelled', 'The request was cancelled.'));
        if (job.signal?.aborted) {
          onAbort();
          return;
        }
        job.signal?.addEventListener('abort', onAbort, { once: true });

        const voice = job.voice.startsWith('voice_') ? { id: job.voice } : job.voice;
        const sessionUpdate: RealtimeClientEvent = {
          type: 'session.update',
          session: {
            type: 'realtime',
            output_modalities: ['audio'],
            instructions: buildVoiceStyle(job.lang),
            audio: {
              // Text in, audio out: no input audio, so automatic turn detection is switched off.
              input: { turn_detection: null },
              output: { format: { type: 'audio/pcm', rate: REALTIME_SAMPLE_RATE }, voice, speed: job.speed },
            },
            ...(options.reasoningEffort
              ? { reasoning: { effort: options.reasoningEffort as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' } }
              : {}),
          },
        };
        const sendLine = () => {
          const item: RealtimeClientEvent = {
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: `Read this line aloud exactly as written:\n${job.text}` }],
            },
          };
          const respond: RealtimeClientEvent = { type: 'response.create', response: { output_modalities: ['audio'] } };
          connection.send(item);
          connection.send(respond);
        };

        connection.onError((error) => finish(mapRealtimeError(error)));
        connection.onClose(() =>
          finish(new ApiFailure(502, 'upstream_error', 'The Realtime connection closed before the audio was complete.')),
        );
        connection.onEvent((event) => {
          if (settled) return;
          switch (event.type) {
            case 'session.updated':
              if (stage === 'configuring') {
                stage = 'speaking';
                sendLine();
              }
              break;
            case 'response.output_audio.delta': {
              const chunk = Buffer.from(event.delta, 'base64');
              audioBytes += chunk.byteLength;
              if (audioBytes > MAX_AUDIO_BYTES) {
                finish(new ApiFailure(502, 'bad_output', 'The Realtime voice produced far more audio than expected.'));
                return;
              }
              chunks.push(chunk);
              break;
            }
            case 'response.output_audio_transcript.done':
              transcript = typeof event.transcript === 'string' ? event.transcript : '';
              break;
            case 'response.done': {
              const status = event.response.status ?? 'unknown';
              if (status === 'completed' && audioBytes > 0) {
                finish(null, {
                  audio: pcm16ToWav(chunks, REALTIME_SAMPLE_RATE),
                  mime: 'audio/wav',
                  model: job.model,
                  voice: job.voice,
                  transcript: transcript || undefined,
                });
              } else {
                const reason = safeCode(event.response.status_details?.error?.code) || safeCode(event.response.status_details?.reason) || status;
                finish(new ApiFailure(502, 'bad_output', `The Realtime voice response ended without usable audio (${reason}).`));
              }
              break;
            }
            case 'error':
              finish(mapRealtimeError(event));
              break;
            default:
              break;
          }
        });
        connection.opened.then(
          () => {
            if (settled) return;
            stage = 'configuring';
            connection.send(sessionUpdate);
          },
          (error) => finish(mapRealtimeError(error)),
        );
      });
    },
  };
}
