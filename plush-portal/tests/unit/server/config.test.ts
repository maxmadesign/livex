import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REALTIME_SPEECH_MODEL,
  DEFAULT_SPEECH_API_MODEL,
  DEFAULT_TEXT_MODEL,
  classifyModel,
  deprecationNote,
  isPlausibleModelId,
  speechApiAcceptsInstructions,
  speechModelMatches,
  textCapability,
  voiceSupported,
} from '../../../server/capabilities';
import { loadConfig } from '../../../server/config';
import { ApiFailure, isRetriable, mapUpstreamError, upstreamInfo } from '../../../server/errors';
import { makeRedactor } from '../../../server/log';
import { createRateLimiter } from '../../../server/rateLimit';
import { SpeechCache, pcm16ToWav } from '../../../server/speech';
import { extractLineOutput } from '../../../server/text';

describe('server configuration', () => {
  it('has safe defaults without any environment', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      port: 8787,
      host: '127.0.0.1',
      apiKey: null,
      baseUrl: null,
      textModel: DEFAULT_TEXT_MODEL,
      speechApi: 'realtime',
      speechModel: DEFAULT_REALTIME_SPEECH_MODEL,
      voice: 'marin',
      adminToken: null,
      allowClientPrompt: true,
      ratePerMin: 60,
      allowedOrigins: [],
      trustProxy: false,
      serveDist: false,
      speechConfigError: '',
      realtimeReasoningEffort: null,
    });
    expect(config.warnings).toEqual([]);
  });

  it('derives the speech API from the model and the model from the API', () => {
    expect(loadConfig({ OPENAI_SPEECH_API: 'speech' })).toMatchObject({ speechApi: 'speech', speechModel: DEFAULT_SPEECH_API_MODEL, speechConfigError: '' });
    expect(loadConfig({ OPENAI_SPEECH_MODEL: 'tts-1-hd' })).toMatchObject({ speechApi: 'speech', speechModel: 'tts-1-hd', speechConfigError: '' });
    expect(loadConfig({ OPENAI_SPEECH_MODEL: 'gpt-realtime-2.1' })).toMatchObject({ speechApi: 'realtime', speechModel: 'gpt-realtime-2.1', speechConfigError: '' });
    expect(loadConfig({ OPENAI_SPEECH_API: 'REALTIME ' }).speechApi).toBe('realtime');
  });

  it('flags a speech model that does not belong to the chosen API instead of guessing', () => {
    expect(loadConfig({ OPENAI_SPEECH_API: 'speech', OPENAI_SPEECH_MODEL: 'gpt-realtime-2.1-mini' }).speechConfigError).toMatch(/Realtime model/);
    expect(loadConfig({ OPENAI_SPEECH_API: 'realtime', OPENAI_SPEECH_MODEL: 'gpt-4o-mini-tts' }).speechConfigError).toMatch(/text-to-speech model/);
    expect(loadConfig({ OPENAI_SPEECH_MODEL: 'gpt-6-luna' }).speechConfigError).toMatch(/text model/);
    expect(loadConfig({ OPENAI_SPEECH_API: 'speech', OPENAI_SPEECH_MODEL: 'bad model!' }).speechConfigError).toMatch(/not a valid model id/);
  });

  it('warns about deprecated models and unusable values without failing', () => {
    expect(loadConfig({ OPENAI_SPEECH_API: 'speech' }).warnings.join(' ')).toMatch(/2027-01-06/);
    expect(loadConfig({ OPENAI_TEXT_MODEL: 'gpt-4o-mini' }).warnings.join(' ')).toMatch(/deprecated/);
    const odd = loadConfig({ OPENAI_TEXT_MODEL: 'not a model', OPENAI_VOICE: 'nova', OPENAI_BASE_URL: 'http://insecure.example/v1', OPENAI_SPEECH_API: 'telepathy' });
    expect(odd.textModel).toBe(DEFAULT_TEXT_MODEL);
    expect(odd.voice).toBe('marin'); // nova is not a Realtime voice
    expect(odd.baseUrl).toBeNull();
    expect(odd.warnings.length).toBeGreaterThanOrEqual(4);
    expect(loadConfig({ OPENAI_SPEECH_API: 'speech', OPENAI_VOICE: 'nova' }).voice).toBe('nova');
    expect(loadConfig({ OPENAI_BASE_URL: 'https://gateway.example/v1' }).baseUrl).toBe('https://gateway.example/v1');
  });

  it('parses flags, lists and numbers defensively', () => {
    const config = loadConfig(
      {
        OPENAI_API_KEY: '  sk-abc  ',
        PLUSH_API_PORT: '9000',
        PLUSH_ADMIN_TOKEN: ' secret ',
        PLUSH_ALLOW_CLIENT_PROMPT: 'false',
        PLUSH_RATE_LIMIT_PER_MIN: '99999999',
        PLUSH_ALLOWED_ORIGINS: 'https://a.example/, https://b.example ,,',
        PLUSH_TRUST_PROXY: '1',
        OPENAI_REALTIME_REASONING_EFFORT: 'LOW',
      },
      ['--serve-dist'],
      '1.2.3',
    );
    expect(config).toMatchObject({
      apiKey: 'sk-abc',
      port: 9000,
      adminToken: 'secret',
      allowClientPrompt: false,
      ratePerMin: 6000,
      allowedOrigins: ['https://a.example', 'https://b.example'],
      trustProxy: true,
      serveDist: true,
      realtimeReasoningEffort: 'low',
      version: '1.2.3',
    });
    expect(loadConfig({ PLUSH_API_PORT: 'abc', PLUSH_RATE_LIMIT_PER_MIN: '-5', OPENAI_REALTIME_REASONING_EFFORT: 'maximum' })).toMatchObject({
      port: 8787,
      ratePerMin: 1,
      realtimeReasoningEffort: null,
    });
  });
});

describe('model capabilities', () => {
  it('classifies model ids by the API they belong to', () => {
    const cases: [string, ReturnType<typeof classifyModel>][] = [
      ['gpt-6-luna', 'text'],
      ['gpt-6.2-astra', 'text'],
      ['gpt-5.4-mini', 'text'],
      ['o3', 'text'],
      ['gpt-4o-mini-tts', 'speech'],
      ['tts-1-hd', 'speech'],
      ['gpt-realtime-2.1-mini', 'realtime'],
      ['gpt-4o-realtime-preview', 'realtime'],
      ['gpt-audio-1.5', 'realtime'],
      ['gpt-realtime-whisper', 'other'],
      ['gpt-4o-transcribe', 'other'],
      ['text-embedding-3-small', 'other'],
      ['gpt-image-2', 'other'],
      ['whatever', 'other'],
    ];
    for (const [model, kind] of cases) expect(classifyModel(model), model).toBe(kind);
    expect(speechModelMatches('speech', 'gpt-4o-mini-tts')).toBe(true);
    expect(speechModelMatches('speech', 'gpt-realtime-2.1-mini')).toBe(false);
    expect(speechModelMatches('realtime', 'gpt-realtime-2.1-mini')).toBe(true);
    expect(speechModelMatches('realtime', 'gpt-6-luna')).toBe(false);
    expect(speechModelMatches('speech', 'gpt-6-luna')).toBe(false);
  });

  it('applies runtime corrections conservatively', () => {
    expect(textCapability('gpt-6-luna')).toMatchObject({ reasoningEffort: 'none', temperature: true });
    expect(textCapability('gpt-6-luna', { noTemperature: true })).toMatchObject({ reasoningEffort: 'none', temperature: false });
    // Without effort "none" a reasoning family does not take sampling parameters.
    expect(textCapability('gpt-6-luna', { reasoningEffort: 'low' })).toMatchObject({ reasoningEffort: 'low', temperature: false });
    expect(textCapability('gpt-6-luna', { reasoningEffort: null })).toMatchObject({ reasoningEffort: null, temperature: false });
    expect(textCapability('gpt-4.1', { noTemperature: true })).toMatchObject({ reasoningEffort: null, temperature: false });
    expect(textCapability('totally-unknown')).toMatchObject({ reasoningEffort: null, temperature: false });
  });

  it('knows voices, instruction support, deprecations and valid ids', () => {
    expect(voiceSupported('realtime', 'marin')).toBe(true);
    expect(voiceSupported('realtime', 'nova')).toBe(false);
    expect(voiceSupported('speech', 'nova')).toBe(true);
    expect(voiceSupported('realtime', 'voice_abc123')).toBe(true);
    expect(voiceSupported('speech', 'robot')).toBe(false);
    expect(speechApiAcceptsInstructions('gpt-4o-mini-tts-2025-12-15')).toBe(true);
    expect(speechApiAcceptsInstructions('tts-1')).toBe(false);
    expect(deprecationNote('gpt-4o-mini-tts')).toMatch(/2027-01-06/);
    expect(deprecationNote('gpt-realtime-mini')).toMatch(/2027-01-20/);
    expect(deprecationNote('gpt-6-luna')).toBeNull();
    expect(deprecationNote('gpt-realtime-2.1-mini')).toBeNull();
    expect(isPlausibleModelId('gpt-6.2-sol')).toBe(true);
    expect(isPlausibleModelId('ft:gpt-6-luna:org::id')).toBe(true);
    expect(isPlausibleModelId('gpt 6')).toBe(false);
    expect(isPlausibleModelId('../etc/passwd')).toBe(false);
    expect(isPlausibleModelId('')).toBe(false);
  });
});

describe('server building blocks', () => {
  it('refills the token bucket over time and bounds its memory', () => {
    let t = 0;
    const limiter = createRateLimiter(60, () => t);
    for (let i = 0; i < 60; i++) expect(limiter.take('a').ok).toBe(true);
    const blocked = limiter.take('a');
    expect(blocked).toMatchObject({ ok: false, retryAfterSec: 1 });
    expect(limiter.take('b').ok).toBe(true);
    t += 1000;
    expect(limiter.take('a').ok).toBe(true); // one token per second at 60/min
    expect(limiter.take('a').ok).toBe(false);
    expect(limiter.take('a', 5)).toMatchObject({ ok: false, retryAfterSec: 5 });
    t += 3_600_000;
    for (let i = 0; i < 6000; i++) limiter.take(`client-${i}`);
    expect(limiter.size()).toBeLessThanOrEqual(5001);
  });

  it('builds a valid mono 16-bit WAV', () => {
    const wav = pcm16ToWav([new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7])], 24000);
    const view = new DataView(wav.buffer);
    expect(Buffer.from(wav.subarray(0, 4)).toString()).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 6);
    expect(Buffer.from(wav.subarray(12, 16)).toString()).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(28, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6); // odd trailing byte dropped
    expect([...wav.subarray(44)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('evicts old speech from the cache by count and size', () => {
    const cache = new SpeechCache(2, 1000);
    const clip = (n: number) => ({ audio: new Uint8Array(n), mime: 'audio/wav' as const, model: 'm', voice: 'v' });
    cache.set('a', clip(100));
    cache.set('b', clip(100));
    expect(cache.get('a')).not.toBeNull(); // refreshes "a"
    cache.set('c', clip(100));
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).not.toBeNull();
    cache.set('huge', clip(900)); // larger than a quarter of the budget: not kept
    expect(cache.get('huge')).toBeNull();
    const k1 = SpeechCache.key({ api: 'realtime', model: 'm', voice: 'v', speed: 1, lang: 'en', text: 'Hi' });
    const k2 = SpeechCache.key({ api: 'realtime', model: 'm', voice: 'v', speed: 1.1, lang: 'en', text: 'Hi' });
    expect(k1).not.toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('extracts only structured fields from upstream errors', () => {
    const error = Object.assign(new Error('Incorrect API key provided: sk-live-123'), { status: 401, code: 'invalid_api_key', param: null, type: 'invalid_request_error' });
    expect(upstreamInfo(error)).toEqual({ status: 401, code: 'invalid_api_key', param: '', type: 'invalid_request_error', name: 'Error' });
    const mapped = mapUpstreamError(error, 'text');
    expect(mapped).toBeInstanceOf(ApiFailure);
    expect(mapped.code).toBe('upstream_auth');
    expect(mapped.message).not.toContain('sk-live-123');
    expect(mapUpstreamError(new TypeError('fetch failed'), 'speech').code).toBe('upstream_error');
    expect(isRetriable(Object.assign(new Error('x'), { status: 500 }))).toBe(true);
    expect(isRetriable(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isRetriable(Object.assign(new Error('x'), { status: 400 }))).toBe(false);
    expect(isRetriable(Object.assign(new Error('x'), { name: 'APIUserAbortError' }))).toBe(false);
    expect(upstreamInfo({ code: 'weird code; DROP TABLE' }).code).toBe('weirdcodeDROPTABLE');
  });

  it('redacts secrets in any text', () => {
    const redact = makeRedactor(['my-admin-token-123', null, 'short']);
    expect(redact('token my-admin-token-123 and sk-proj-abcdef123456 and Bearer zzzzyyyyxxxx1234')).toBe(
      'token [redacted] and sk-[redacted] and Bearer [redacted]',
    );
    expect(redact('short stays, it is too short to be a secret')).toContain('short');
  });

  it('reads structured output from any message item', () => {
    const good = { text: 'Hi!', emotion: 'happy', shouldSpeak: true };
    expect(extractLineOutput({ output_text: JSON.stringify(good) })).toEqual({ ok: true, value: good });
    expect(extractLineOutput({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"text": 1}' }] }] })).toEqual({ ok: false, reason: 'schema_mismatch' });
    expect(extractLineOutput({ output: [] })).toEqual({ ok: false, reason: 'no_text' });
    expect(extractLineOutput(null)).toEqual({ ok: false, reason: 'no_text' });
    expect(extractLineOutput({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] })).toEqual({ ok: false, reason: 'incomplete:max_output_tokens' });
  });
});
