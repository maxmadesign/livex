/**
 * Server configuration. Everything comes from environment variables (or the
 * `.env` file loaded by index.ts). The API key lives only in this object on
 * the server; it is never serialised into responses or logs.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { SpeechApi } from '../src/ai/protocol';
import {
  DEFAULT_REALTIME_SPEECH_MODEL,
  DEFAULT_SPEECH_API_MODEL,
  DEFAULT_TEXT_MODEL,
  DEFAULT_VOICE,
  classifyModel,
  deprecationNote,
  describeSpeechMismatch,
  isPlausibleModelId,
  speechModelMatches,
  voiceSupported,
} from './capabilities';
import type { LogLevel } from './log';

export interface ServerConfig {
  port: number;
  host: string;
  /** null = no key: the proxy answers "no_key" and the game uses local lines. */
  apiKey: string | null;
  baseUrl: string | null;
  textModel: string;
  speechModel: string;
  speechApi: SpeechApi;
  voice: string;
  /** Optional `reasoning.effort` for Realtime speech sessions; null = not sent. */
  realtimeReasoningEffort: string | null;
  /** Empty when the speech configuration is consistent. */
  speechConfigError: string;
  warnings: string[];
  adminToken: string | null;
  allowClientPrompt: boolean;
  ratePerMin: number;
  allowedOrigins: string[];
  trustProxy: boolean;
  textTimeoutMs: number;
  speechTimeoutMs: number;
  serveDist: boolean;
  distDir: string;
  logLevel: LogLevel;
  version: string;
}

type Env = Record<string, string | undefined>;

const clean = (value: string | undefined): string => (value ?? '').trim();

function bool(value: string | undefined, fallback: boolean): boolean {
  const v = clean(value).toLowerCase();
  if (v === '') return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(clean(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function loadConfig(env: Env, argv: readonly string[] = [], version = '0.0.0'): ServerConfig {
  const warnings: string[] = [];
  const apiKey = clean(env.OPENAI_API_KEY) || null;

  let textModel = clean(env.OPENAI_TEXT_MODEL) || DEFAULT_TEXT_MODEL;
  if (!isPlausibleModelId(textModel)) {
    warnings.push(`OPENAI_TEXT_MODEL is not a valid model id; using ${DEFAULT_TEXT_MODEL}.`);
    textModel = DEFAULT_TEXT_MODEL;
  } else if (classifyModel(textModel) !== 'text') {
    warnings.push(`OPENAI_TEXT_MODEL "${textModel}" does not look like a text model for the Responses API.`);
  }
  const textDeprecation = deprecationNote(textModel);
  if (textDeprecation) warnings.push(textDeprecation);

  // Speech: an API and a model that belongs to it. Either can be derived from the other.
  const apiRaw = clean(env.OPENAI_SPEECH_API).toLowerCase();
  let speechModel = clean(env.OPENAI_SPEECH_MODEL);
  let speechApi: SpeechApi;
  let speechConfigError = '';
  if (apiRaw === 'speech' || apiRaw === 'realtime') {
    speechApi = apiRaw;
  } else {
    if (apiRaw !== '') warnings.push(`OPENAI_SPEECH_API "${apiRaw}" is not "speech" or "realtime"; deriving it from the model.`);
    speechApi = speechModel && classifyModel(speechModel) === 'speech' ? 'speech' : 'realtime';
  }
  if (!speechModel) speechModel = speechApi === 'speech' ? DEFAULT_SPEECH_API_MODEL : DEFAULT_REALTIME_SPEECH_MODEL;
  if (!isPlausibleModelId(speechModel)) {
    speechConfigError = 'OPENAI_SPEECH_MODEL is not a valid model id.';
  } else if (!speechModelMatches(speechApi, speechModel)) {
    speechConfigError = describeSpeechMismatch(speechApi, speechModel);
  }
  const speechDeprecation = deprecationNote(speechModel);
  if (speechDeprecation && !speechConfigError) warnings.push(speechDeprecation);

  let voice = clean(env.OPENAI_VOICE) || DEFAULT_VOICE;
  if (!voiceSupported(speechApi, voice)) {
    warnings.push(`OPENAI_VOICE "${voice}" is not available for the ${speechApi} API; using ${DEFAULT_VOICE}.`);
    voice = DEFAULT_VOICE;
  }

  const effort = clean(env.OPENAI_REALTIME_REASONING_EFFORT).toLowerCase();
  const realtimeReasoningEffort = ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(effort) ? effort : null;

  const baseUrlRaw = clean(env.OPENAI_BASE_URL);
  let baseUrl: string | null = null;
  if (baseUrlRaw) {
    try {
      const url = new URL(baseUrlRaw);
      if (url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1') baseUrl = baseUrlRaw;
      else warnings.push('OPENAI_BASE_URL must use https; ignoring it.');
    } catch {
      warnings.push('OPENAI_BASE_URL is not a valid URL; ignoring it.');
    }
  }

  const logRaw = clean(env.PLUSH_LOG_LEVEL).toLowerCase();
  const logLevel: LogLevel = logRaw === 'silent' || logRaw === 'error' || logRaw === 'debug' ? logRaw : 'info';
  const here = path.dirname(fileURLToPath(import.meta.url));

  return {
    port: int(env.PLUSH_API_PORT, 8787, 1, 65535),
    host: clean(env.PLUSH_API_HOST) || '127.0.0.1',
    apiKey,
    baseUrl,
    textModel,
    speechModel,
    speechApi,
    voice,
    realtimeReasoningEffort,
    speechConfigError,
    warnings,
    adminToken: clean(env.PLUSH_ADMIN_TOKEN) || null,
    allowClientPrompt: bool(env.PLUSH_ALLOW_CLIENT_PROMPT, true),
    ratePerMin: int(env.PLUSH_RATE_LIMIT_PER_MIN, 60, 1, 6000),
    allowedOrigins: clean(env.PLUSH_ALLOWED_ORIGINS)
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter((origin) => origin.length > 0),
    trustProxy: bool(env.PLUSH_TRUST_PROXY, false),
    textTimeoutMs: int(env.PLUSH_TEXT_TIMEOUT_MS, 6000, 1000, 30000),
    speechTimeoutMs: int(env.PLUSH_SPEECH_TIMEOUT_MS, 12000, 2000, 60000),
    serveDist: argv.includes('--serve-dist') || bool(env.PLUSH_SERVE_DIST, false),
    distDir: path.resolve(here, '..', clean(env.PLUSH_DIST_DIR) || 'dist'),
    logLevel,
    version,
  };
}
