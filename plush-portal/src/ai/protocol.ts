/**
 * Wire protocol between the browser guide (`src/ai`) and the API proxy
 * (`server/`). Pure types and constants: no DOM, no Node, no secrets.
 */
import type { GuideEmotion, GuideEventType, GuideFacts } from '../core/contracts';
import type { Lang, ThemeId } from '../core/types';

export const GUIDE_EMOTIONS = ['happy', 'cheer', 'think', 'oops', 'calm'] as const satisfies readonly GuideEmotion[];

export type LineLength = 'short' | 'medium';

/** Hard limits enforced on both sides. */
export const AI_LIMITS = {
  maxRecentLines: 6,
  maxRecentLineChars: 200,
  maxPersonaChars: 400,
  maxSystemPromptChars: 4000,
  maxModelIdChars: 80,
  maxVoiceChars: 40,
  maxSpeechChars: 300,
  maxToyNameChars: 60,
  minTimeoutMs: 800,
  maxTimeoutMs: 8000,
  maxBodyBytes: 16 * 1024,
} as const;

export type ApiErrorCode =
  | 'no_key' // the server has no OpenAI key: use local lines
  | 'bad_request' // body failed validation
  | 'payload_too_large'
  | 'forbidden' // origin not allowed / admin token required
  | 'rate_limited' // this proxy's own limiter
  | 'timeout' // upstream did not answer in time
  | 'cancelled' // the browser went away
  | 'upstream_auth' // OpenAI rejected the server's credentials
  | 'upstream_rate_limited'
  | 'upstream_model' // model not found / not available to this key
  | 'upstream_rejected' // OpenAI rejected the request (4xx)
  | 'upstream_error' // OpenAI 5xx / network
  | 'bad_output' // model output failed schema / length validation
  | 'model_mismatch' // speech model does not belong to the configured speech API
  | 'speech_unavailable'
  | 'not_found'
  | 'internal';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

/* ----------------------------------------------------------------- status */

export type SpeechApi = 'speech' | 'realtime';

export interface StatusResponseBody {
  /** True when the server holds an OpenAI key. Says nothing about whether OpenAI accepts it. */
  configured: boolean;
  provider: 'openai';
  textModel: string;
  speechModel: string;
  speechApi: SpeechApi;
  voice: string;
  /** False: client supplied systemPrompt / persona / model are ignored. */
  allowClientPrompt: boolean;
  /** True: `/api/ai/test` and model overrides need the admin bearer token. */
  adminProtected: boolean;
  /** Empty when the speech configuration is consistent. */
  speechConfigError: string;
  /** Non-fatal notes (deprecated endpoints, ...). Never contains secrets. */
  warnings: string[];
  limits: {
    ratePerMin: number;
    maxSpeechChars: number;
    maxRecentLines: number;
    textTimeoutMs: number;
    speechTimeoutMs: number;
  };
  version: string;
}

/* ------------------------------------------------------------------- line */

export interface LineRequestBody {
  event: { type: GuideEventType; facts: GuideFacts };
  theme: ThemeId;
  lang: Lang;
  recentLines: string[];
  persona?: string;
  systemPrompt?: string;
  length: LineLength;
  model?: string;
  temperature?: number;
  /** Client's own time budget; the server never waits longer than this. */
  timeoutMs?: number;
}

export interface LineResponseBody {
  text: string;
  emotion: GuideEmotion;
  shouldSpeak: boolean;
  /** The model that really answered. */
  model: string;
  latencyMs: number;
}

/* ----------------------------------------------------------------- speech */

export interface SpeechRequestBody {
  text: string;
  voice?: string;
  speed?: number;
  lang: Lang;
  model?: string;
}

/** Response headers of a successful `/api/ai/speech` call (body = audio bytes). */
export const SPEECH_HEADERS = {
  model: 'x-plush-speech-model',
  api: 'x-plush-speech-api',
  voice: 'x-plush-voice',
  cache: 'x-plush-cache',
} as const;

/* ------------------------------------------------------------------- test */

export interface TestRequestBody {
  speech?: boolean;
  lang?: Lang;
}

export interface TestResponseBody {
  ok: boolean;
  /** Set when ok is false. */
  code?: ApiErrorCode;
  message?: string;
  text?: { ok: boolean; model: string; latencyMs: number; sample?: string; code?: ApiErrorCode };
  speech?: { ok: boolean; model: string; api: SpeechApi; latencyMs: number; bytes?: number; code?: ApiErrorCode };
}

/* ----------------------------------------------------------------- models */

export interface ModelsResponseBody {
  configured: boolean;
  text: { id: string; shutdownDate: string | null; sampling: 'temperature' | 'none'; reasoning: string | null }[];
  speech: { id: string; api: SpeechApi; shutdownDate: string | null }[];
}
