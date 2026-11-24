import type { ApiErrorBody, ApiErrorCode } from '../src/ai/protocol';

/** An error that maps to a JSON `{ error: { code, message } }` response. Messages are written by us, never copied from upstream. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    /** Extra response headers (e.g. Retry-After). */
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiFailure';
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

interface UpstreamErrorLike {
  status?: unknown;
  code?: unknown;
  param?: unknown;
  type?: unknown;
  name?: unknown;
  message?: unknown;
}

export interface UpstreamInfo {
  status: number | null;
  code: string;
  param: string;
  type: string;
  name: string;
}

const safeToken = (value: unknown): string => (typeof value === 'string' ? value.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) : '');

/** Extracts only harmless, structured fields from an SDK / network error. */
export function upstreamInfo(error: unknown): UpstreamInfo {
  const e = (error ?? {}) as UpstreamErrorLike;
  return {
    status: typeof e.status === 'number' ? e.status : null,
    code: safeToken(e.code),
    param: safeToken(e.param),
    type: safeToken(e.type),
    name: safeToken(e.name),
  };
}

export function isAbortError(error: unknown): boolean {
  const name = upstreamInfo(error).name;
  return name === 'APIUserAbortError' || name === 'AbortError';
}

export function isTimeoutError(error: unknown): boolean {
  const name = upstreamInfo(error).name;
  return name === 'APIConnectionTimeoutError' || name === 'TimeoutError';
}

/** 429, 5xx and connection problems are worth one more try. */
export function isRetriable(error: unknown): boolean {
  const info = upstreamInfo(error);
  if (isAbortError(error)) return false;
  if (info.status === null) return true; // connection error / timeout
  return info.status === 429 || info.status === 408 || info.status === 409 || info.status >= 500;
}

/** Translates an upstream failure into our own error vocabulary (no upstream text is forwarded). */
export function mapUpstreamError(error: unknown, what: 'text' | 'speech'): ApiFailure {
  if (error instanceof ApiFailure) return error;
  const info = upstreamInfo(error);
  const hint = info.code ? ` (${info.code})` : '';
  if (isAbortError(error)) return new ApiFailure(499, 'cancelled', 'The request was cancelled.');
  if (isTimeoutError(error)) return new ApiFailure(504, 'timeout', `OpenAI did not answer the ${what} request in time.`);
  if (info.status === null) return new ApiFailure(502, 'upstream_error', `Could not reach OpenAI for the ${what} request.`);
  if (info.status === 401 || info.status === 403) {
    return new ApiFailure(502, 'upstream_auth', `OpenAI rejected the server's credentials${hint}. Check OPENAI_API_KEY on the server.`);
  }
  if (info.status === 404) {
    return new ApiFailure(502, 'upstream_model', `The configured ${what} model is not available to this API key${hint}.`);
  }
  if (info.status === 429) {
    return new ApiFailure(503, 'upstream_rate_limited', `OpenAI is rate limiting this key or the quota is exhausted${hint}.`, {
      'retry-after': '10',
    });
  }
  if (info.status >= 500) return new ApiFailure(502, 'upstream_error', `OpenAI had a server error (${info.status}).`);
  const param = info.param ? `, parameter "${info.param}"` : '';
  return new ApiFailure(502, 'upstream_rejected', `OpenAI rejected the ${what} request (${info.status}${hint}${param}).`);
}
