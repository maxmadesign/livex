/**
 * Browser side of the OpenAI key block in Settings → AI Guide.
 *
 * The key typed in Settings is sent exactly once, in the body of
 * POST /api/ai/key, to the game's own server, which stores it server-side.
 * Nothing here keeps it: no settings field, no localStorage / IndexedDB, no
 * URL, no log line, no diagnostics. Answers only carry the source and a
 * masked fingerprint ("…wxyz").
 */
import type { ApiErrorBody, ApiErrorCode, CredentialResponseBody, CredentialStatus, KeyCheckResult } from './protocol';

export interface KeyCallResult {
  ok: boolean;
  /** Present whenever the server answered with a key status. */
  credential: CredentialStatus | null;
  check: { result: KeyCheckResult; latencyMs: number } | null;
  /** Error code from the server, 'network' when it could not be reached, or `HTTP <status>`. */
  code: ApiErrorCode | 'network' | `HTTP ${number}` | null;
  /** Server-written message (never contains the key). */
  message: string | null;
}

export interface KeyClientOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Only needed when the server is protected with PLUSH_ADMIN_TOKEN and this is not the server machine. Kept by the caller in memory only. */
  adminToken?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body: unknown, options: KeyClientOptions): Promise<KeyCallResult> {
  const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!fetchImpl) return { ok: false, credential: null, check: null, code: 'network', message: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (options.adminToken) headers.authorization = `Bearer ${options.adminToken}`;
  try {
    const response = await fetchImpl(`${(options.baseUrl ?? '').replace(/\/+$/, '')}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    const answer = data as Partial<CredentialResponseBody> & Partial<ApiErrorBody>;
    const credential = answer?.credential && typeof answer.credential.source === 'string' ? answer.credential : null;
    const code = answer?.error?.code ?? answer?.code ?? (response.ok ? null : (`HTTP ${response.status}` as const));
    return {
      ok: response.ok && answer?.ok === true,
      credential,
      check: answer?.check ?? null,
      code,
      message: answer?.error?.message ?? answer?.message ?? null,
    };
  } catch {
    return { ok: false, credential: null, check: null, code: 'network', message: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Source and fingerprint of the key in use, and whether this browser may change it. */
export function fetchKeyStatus(options: KeyClientOptions = {}): Promise<KeyCallResult> {
  return call('GET', '/api/ai/key', undefined, options);
}

/** Sends a new key once; the server checks, stores and uses it. The caller must clear its input afterwards. */
export function saveKey(key: string, options: KeyClientOptions = {}): Promise<KeyCallResult> {
  return call('POST', '/api/ai/key', { key: key.trim() }, options);
}

/** Checks `key` without storing it, or the key in use when `key` is empty. */
export function testKey(key: string | null, options: KeyClientOptions = {}): Promise<KeyCallResult> {
  const candidate = key?.trim();
  return call('POST', '/api/ai/key/test', candidate ? { key: candidate } : {}, options);
}

/** Forgets the replaced key: the server goes back to OPENAI_API_KEY from .env. */
export function restoreDefaultKey(options: KeyClientOptions = {}): Promise<KeyCallResult> {
  return call('DELETE', '/api/ai/key', undefined, options);
}
