/**
 * Server configuration. Everything comes from environment variables (or the
 * `.env` file loaded by index.ts). The API key lives only in this object on
 * the server; it is never serialised into responses or logs.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { KeyManagementMode, SpeechApi } from '../src/ai/protocol';
import { parseBrandId, type BrandId } from '../src/brand/kits';
import { isSafeHttpUrl } from '../src/rewards/protocol';
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
  /** Git-ignored folder for server-side state: a replaced key (secrets.json), the generated TLS pair. */
  dataDir: string;
  /** Who may replace the key at run time (PLUSH_KEY_MANAGEMENT). */
  keyManagement: KeyManagementMode;
  /** Check a new key against OpenAI (GET /v1/models) before storing it. */
  keyCheck: boolean;
  keyCheckTimeoutMs: number;
  /** Opt-in HTTPS listener for phones on the LAN (next to the plain HTTP one). */
  https: {
    enabled: boolean;
    port: number;
    host: string;
    /** User supplied PEM files; null = self-signed pair in `<dataDir>/tls`. */
    certFile: string | null;
    keyFile: string | null;
  };
  /** Brand kit of the claim and staff pages (PLUSH_BRAND; match it with the build's VITE_BRAND). */
  brand: BrandId;
  /** Prize claim codes and pages (docs/REWARDS.md). */
  rewards: RewardsConfig;
}

export interface RewardsConfig {
  /** PLUSH_REWARDS (default on). Off: no new codes; codes issued before stay viewable and redeemable. */
  enabled: boolean;
  /** Port of the LAN claim listener (PLUSH_CLAIM_PORT, default 8788; 0 = any free port). */
  claimPort: number;
  /** Interfaces the claim listener binds to (all, so phones on the booth network reach it). */
  claimHost: string;
  /** PLUSH_CLAIM_LAN (default on): start the claim listener next to the main server. */
  claimLan: boolean;
  /** PLUSH_CLAIM_PUBLIC_URL without trailing slash, or null: the base the QR codes point to instead. */
  publicUrl: string | null;
  /** PLUSH_REWARD_TTL_HOURS (default 24): how long a code stays valid. */
  ttlHours: number;
  /** Folders searched for the brand kit's logo / font files: the build first, then public/. */
  assetDirs: string[];
}

/**
 * Shorter admin tokens get a note in the start-up log (never in `warnings`: those are served by
 * GET /api/ai/status, and "the token is short" is worth knowing for someone guessing it).
 */
export const MIN_ADMIN_TOKEN_CHARS = 16;

/** A public claim base: an http(s) URL without credentials, query or fragment (trailing slashes dropped). */
export function parseClaimPublicUrl(value: string): string | null {
  const v = value.trim().replace(/\/+$/, '');
  if (!v || !isSafeHttpUrl(v) || v.includes('{code}')) return null;
  try {
    const url = new URL(v);
    if (url.search || url.hash) return null;
  } catch {
    return null;
  }
  return v;
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
  const projectRoot = path.resolve(here, '..');

  const managementRaw = clean(env.PLUSH_KEY_MANAGEMENT).toLowerCase();
  let keyManagement: KeyManagementMode = 'local';
  if (managementRaw === 'token' || managementRaw === 'off' || managementRaw === 'local') keyManagement = managementRaw;
  else if (managementRaw !== '') warnings.push(`PLUSH_KEY_MANAGEMENT "${managementRaw}" is not local, token or off; using local.`);
  if (keyManagement === 'token' && !clean(env.PLUSH_ADMIN_TOKEN)) {
    warnings.push('PLUSH_KEY_MANAGEMENT=token needs PLUSH_ADMIN_TOKEN; nobody can replace the key until one is set.');
  }
  const adminTokenRaw = clean(env.PLUSH_ADMIN_TOKEN);

  const certFile = clean(env.PLUSH_TLS_CERT) || null;
  const keyFile = clean(env.PLUSH_TLS_KEY) || null;
  if ((certFile === null) !== (keyFile === null)) warnings.push('PLUSH_TLS_CERT and PLUSH_TLS_KEY must be set together; using a self-signed certificate.');
  const pairComplete = certFile !== null && keyFile !== null;

  const publicUrlRaw = clean(env.PLUSH_CLAIM_PUBLIC_URL);
  const publicUrl = publicUrlRaw ? parseClaimPublicUrl(publicUrlRaw) : null;
  if (publicUrlRaw && !publicUrl) warnings.push('PLUSH_CLAIM_PUBLIC_URL must be an http(s) URL without query or fragment; using the claim listener.');
  const distDir = path.resolve(here, '..', clean(env.PLUSH_DIST_DIR) || 'dist');

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
    adminToken: adminTokenRaw || null,
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
    distDir,
    logLevel,
    version,
    dataDir: path.resolve(projectRoot, clean(env.PLUSH_DATA_DIR) || '.data'),
    keyManagement,
    keyCheck: bool(env.PLUSH_KEY_CHECK, true),
    keyCheckTimeoutMs: int(env.PLUSH_KEY_CHECK_TIMEOUT_MS, 6000, 1000, 30000),
    https: {
      enabled: argv.includes('--https') || bool(env.PLUSH_HTTPS, false),
      port: int(env.PLUSH_HTTPS_PORT, 8443, 1, 65535),
      // HTTPS exists for phones on the LAN, so it listens on every interface unless told otherwise.
      host: clean(env.PLUSH_HTTPS_HOST) || '0.0.0.0',
      certFile: pairComplete ? path.resolve(projectRoot, certFile) : null,
      keyFile: pairComplete ? path.resolve(projectRoot, keyFile) : null,
    },
    brand: parseBrandId(env.PLUSH_BRAND),
    rewards: {
      enabled: bool(env.PLUSH_REWARDS, true),
      claimPort: int(env.PLUSH_CLAIM_PORT, 8788, 0, 65535),
      claimHost: '0.0.0.0',
      claimLan: bool(env.PLUSH_CLAIM_LAN, true),
      publicUrl,
      ttlHours: int(env.PLUSH_REWARD_TTL_HOURS, 24, 1, 24 * 30),
      assetDirs: [distDir, path.join(projectRoot, 'public')],
    },
  };
}
