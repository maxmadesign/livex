/**
 * Momo's line through the OpenAI Responses API with a strict structured
 * output. The model only decides the wording: which round / event a line
 * belongs to is tracked by the application and never read from the model.
 */
import { zodTextFormat } from 'openai/helpers/zod';
import type { GuideFacts } from '../src/core/contracts';
import { buildInstructions, buildLineInput } from '../src/ai/prompt';
import type { LineResponseBody } from '../src/ai/protocol';
import { fitLine } from '../src/ai/textLength';
import { textCapability, type LearnedOverride } from './capabilities';
import { ApiFailure, isAbortError, isRetriable, mapUpstreamError, upstreamInfo } from './errors';
import type { Logger } from './log';
import { LineOutputSchema, type LineOutput, type LineRequest } from './schemas';

/** The slice of the OpenAI client this module needs (the real SDK client satisfies it; tests pass a fake). */
export interface ResponsesClient {
  responses: {
    create(
      body: Record<string, unknown>,
      options?: { timeout?: number; maxRetries?: number; signal?: AbortSignal },
    ): PromiseLike<unknown>;
  };
}

export interface LineGeneratorDeps {
  client: ResponsesClient;
  logger: Logger;
  now: () => number;
  /** Corrections learned at runtime, keyed by model id. Shared across requests. */
  learned: Map<string, LearnedOverride>;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface LineJob {
  request: LineRequest;
  model: string;
  /** False: client supplied prompt / persona are ignored. */
  useClientPrompt: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
}

const LINE_FORMAT = zodTextFormat(LineOutputSchema, 'momo_line', {
  description: 'One short line spoken by Momo, the claw machine mascot.',
});

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface OutputPart {
  type?: unknown;
  text?: unknown;
  refusal?: unknown;
}
interface OutputItem {
  type?: unknown;
  content?: unknown;
}

/**
 * Finds the structured line in a Responses API result. It scans every message
 * item instead of trusting the first one, because a response can contain more
 * than one message item.
 */
export function extractLineOutput(response: unknown): { ok: true; value: LineOutput } | { ok: false; reason: string } {
  const r = (response ?? {}) as { status?: unknown; output?: unknown; output_text?: unknown; incomplete_details?: { reason?: unknown } };
  const candidates: string[] = [];
  let refused = false;
  if (Array.isArray(r.output)) {
    for (const item of r.output as OutputItem[]) {
      if (!item || item.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const part of item.content as OutputPart[]) {
        if (part?.type === 'output_text' && typeof part.text === 'string') candidates.push(part.text);
        if (part?.type === 'refusal') refused = true;
      }
    }
  }
  if (typeof r.output_text === 'string' && r.output_text.trim()) candidates.push(r.output_text);
  for (const candidate of candidates) {
    try {
      const parsed = LineOutputSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return { ok: true, value: parsed.data };
    } catch {
      /* not JSON: try the next part */
    }
  }
  if (refused) return { ok: false, reason: 'refusal' };
  if (r.status === 'incomplete') {
    const why = typeof r.incomplete_details?.reason === 'string' ? r.incomplete_details.reason : 'unknown';
    return { ok: false, reason: `incomplete:${why.replace(/[^a-z_]/gi, '').slice(0, 40)}` };
  }
  return { ok: false, reason: candidates.length === 0 ? 'no_text' : 'schema_mismatch' };
}

function buildBody(job: LineJob, learned: LearnedOverride | undefined): Record<string, unknown> {
  const { request, model } = job;
  const capability = textCapability(model, learned);
  const reasons = capability.reasoningEffort !== null && capability.reasoningEffort !== 'none';
  const body: Record<string, unknown> = {
    model,
    instructions: buildInstructions({
      systemPrompt: job.useClientPrompt ? request.systemPrompt : undefined,
      persona: job.useClientPrompt ? request.persona : undefined,
      lang: request.lang,
      length: request.length,
    }),
    input: buildLineInput({
      event: { type: request.event.type, facts: request.event.facts as GuideFacts },
      theme: request.theme,
      recentLines: request.recentLines,
    }),
    text: { format: LINE_FORMAT },
    // Reasoning tokens count against this limit, so reasoning models get more room.
    max_output_tokens: reasons ? 900 : 240,
    store: false,
  };
  if (capability.reasoningEffort !== null) body.reasoning = { effort: capability.reasoningEffort };
  if (capability.temperature && typeof request.temperature === 'number') body.temperature = request.temperature;
  return body;
}

/**
 * If OpenAI says a parameter is not supported by this model, remember it and
 * tell the caller to retry without it.
 */
function learnFromRejection(model: string, error: unknown, body: Record<string, unknown>, learned: Map<string, LearnedOverride>): boolean {
  const info = upstreamInfo(error);
  if (info.status !== 400) return false;
  const param = info.param.toLowerCase();
  const current = learned.get(model) ?? {};
  if ((param.includes('temperature') || param.includes('top_p')) && 'temperature' in body && !current.noTemperature) {
    learned.set(model, { ...current, noTemperature: true });
    return true;
  }
  if (param.includes('reasoning') && 'reasoning' in body) {
    const sent = (body.reasoning as { effort?: string }).effort;
    // "none" is the usual culprit: fall back to "low" once, then stop sending the field.
    const next = sent === 'none' ? 'low' : null;
    if (current.reasoningEffort === next) return false;
    learned.set(model, { ...current, reasoningEffort: next, noTemperature: true });
    return true;
  }
  return false;
}

export async function generateLine(deps: LineGeneratorDeps, job: LineJob): Promise<LineResponseBody> {
  const { client, logger, now, learned } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const started = now();
  const deadline = started + job.timeoutMs;
  let attempt = 0;
  let lastError: unknown = null;

  // At most two upstream calls: the first try plus one retry (backoff or parameter correction).
  while (attempt < 2) {
    attempt++;
    const remaining = deadline - now();
    if (remaining < 250) break;
    const body = buildBody(job, learned.get(job.model));
    try {
      const response = await client.responses.create(body, { timeout: remaining, maxRetries: 0, signal: job.signal });
      const extracted = extractLineOutput(response);
      if (!extracted.ok) {
        logger.info('line rejected', { model: job.model, reason: extracted.reason });
        throw new ApiFailure(502, 'bad_output', `The model did not return a usable line (${extracted.reason}).`);
      }
      const fitted = fitLine(extracted.value.text, job.request.lang, job.request.length);
      if (!fitted) {
        logger.info('line rejected', { model: job.model, reason: 'length' });
        throw new ApiFailure(502, 'bad_output', 'The model returned a line that is empty or far too long.');
      }
      const served = (response as { model?: unknown }).model;
      return {
        text: fitted.text,
        emotion: extracted.value.emotion,
        shouldSpeak: extracted.value.shouldSpeak,
        model: typeof served === 'string' && served ? served : job.model,
        latencyMs: Math.round(now() - started),
      };
    } catch (error) {
      if (error instanceof ApiFailure) throw error;
      lastError = error;
      if (isAbortError(error) || job.signal?.aborted) break;
      const info = upstreamInfo(error);
      logger.info('upstream text error', { model: job.model, status: info.status ?? 'network', code: info.code, param: info.param, attempt });
      if (attempt >= 2) break;
      if (learnFromRejection(job.model, error, body, learned)) continue;
      if (!isRetriable(error)) break;
      const wait = Math.min(400, Math.max(120, (deadline - now()) / 4));
      if (deadline - now() - wait < 400) break;
      await sleep(wait);
    }
  }
  if (lastError === null) throw new ApiFailure(504, 'timeout', 'OpenAI did not answer the text request in time.');
  throw mapUpstreamError(lastError, 'text');
}
