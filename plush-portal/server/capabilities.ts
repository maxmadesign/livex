/**
 * What each model family accepts. The proxy only sends sampling / reasoning
 * parameters a model is known to support; unknown models get neither.
 *
 * Sources (checked 2026-11, see docs/AI.md):
 *   - openai-node 7.63.0 typings (model unions, deprecation notes, Realtime events)
 *   - OpenAI docs: model pages, "Reasoning models", "Using GPT-6.2", "Text to speech", deprecations
 * The table can not be verified against the live API from this repository's
 * build environment (no key); a 400 "unsupported parameter" answer is handled
 * at runtime by dropping the parameter and remembering that for the model.
 */
import type { SpeechApi } from '../src/ai/protocol';

/** Defaults used when the environment does not name a model. */
export const DEFAULT_TEXT_MODEL = 'gpt-6-luna';
export const DEFAULT_REALTIME_SPEECH_MODEL = 'gpt-realtime-2.1-mini';
export const DEFAULT_SPEECH_API_MODEL = 'gpt-4o-mini-tts';
export const DEFAULT_VOICE = 'marin';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';

export interface TextCapability {
  /** Value sent as `reasoning.effort`; null = do not send `reasoning` at all. */
  reasoningEffort: ReasoningEffort | null;
  /** Whether `temperature` may be sent (for GPT-5.1+/GPT-6 only together with effort "none"). */
  temperature: boolean;
  /** Short reason, shown in docs / diagnostics. */
  note: string;
}

interface Rule {
  test: RegExp;
  capability: TextCapability;
}

const RULES: Rule[] = [
  {
    // GPT-6 Luna / GPT-6 Sol accept effort "none"; sampling parameters are only valid with "none".
    test: /^gpt-6-(luna|sol)(-|$)/,
    capability: { reasoningEffort: 'none', temperature: true, note: 'effort none + temperature (GPT-6 Luna / Sol)' },
  },
  {
    // GPT-6 Astra, GPT-6.1 and GPT-6.2 reject "none" (and 6.1 Sol also "minimal"): use "low", no sampling.
    test: /^gpt-6(\.\d+)?-/,
    capability: { reasoningEffort: 'low', temperature: false, note: 'effort low, no sampling parameters (GPT-6 Astra / 6.1 / 6.2)' },
  },
  {
    // "pro" variants only accept high efforts: leave the model default untouched.
    test: /-pro(-|$)/,
    capability: { reasoningEffort: null, temperature: false, note: 'pro model: defaults only' },
  },
  {
    // GPT-5.1 / 5.2 default to "none" and accept temperature with it.
    test: /^gpt-5\.[12](-\d{4}-\d{2}-\d{2})?$/,
    capability: { reasoningEffort: 'none', temperature: true, note: 'effort none + temperature (GPT-5.1 / 5.2)' },
  },
  {
    // Rest of the GPT-5 family (5, 5.4, 5.5, 5.6, mini / nano): "low" is accepted everywhere, sampling is not.
    test: /^gpt-5(\.\d+)?(-|$)/,
    capability: { reasoningEffort: 'low', temperature: false, note: 'effort low, no sampling parameters (GPT-5 family)' },
  },
  {
    test: /^o\d/,
    capability: { reasoningEffort: 'low', temperature: false, note: 'o-series reasoning model' },
  },
  {
    // Non-reasoning chat models.
    test: /^gpt-4(\.1|o)(-|$)/,
    capability: { reasoningEffort: null, temperature: true, note: 'non-reasoning model: temperature only' },
  },
];

const UNKNOWN: TextCapability = { reasoningEffort: null, temperature: false, note: 'unknown model: no optional parameters' };

/** Runtime corrections learned from "unsupported parameter" answers. */
export interface LearnedOverride {
  noTemperature?: boolean;
  /** Replaces the effort from the table; null = stop sending `reasoning`. */
  reasoningEffort?: ReasoningEffort | null;
}

export function textCapability(model: string, learned?: LearnedOverride): TextCapability {
  const base = RULES.find((rule) => rule.test.test(model))?.capability ?? UNKNOWN;
  if (!learned) return base;
  const reasoningEffort = learned.reasoningEffort !== undefined ? learned.reasoningEffort : base.reasoningEffort;
  let temperature = base.temperature && !learned.noTemperature;
  // On reasoning families sampling parameters are only valid together with effort "none".
  if (base.reasoningEffort === 'none' && reasoningEffort !== 'none') temperature = false;
  return { reasoningEffort, temperature, note: `${base.note} (adjusted at runtime)` };
}

export type ModelKind = 'text' | 'speech' | 'realtime' | 'other';

/** Which API a model id belongs to, judged by its name. */
export function classifyModel(model: string): ModelKind {
  const id = model.toLowerCase();
  if (/(^|-)tts(-|$)/.test(id)) return 'speech';
  if (/realtime/.test(id) && !/whisper|transcribe/.test(id)) return 'realtime';
  if (/^gpt-audio/.test(id)) return 'realtime';
  if (/transcribe|whisper|embedding|moderation|image|dall-e|sora|search|codex|computer-use|deep-research/.test(id)) return 'other';
  if (/^(gpt-\d|o\d|chatgpt-)/.test(id)) return 'text';
  return 'other';
}

/** Does `model` belong to the given speech API? Mismatches are rejected, never "tried". */
export function speechModelMatches(api: SpeechApi, model: string): boolean {
  return classifyModel(model) === (api === 'speech' ? 'speech' : 'realtime');
}

export function describeSpeechMismatch(api: SpeechApi, model: string): string {
  const kind = classifyModel(model);
  const expected =
    api === 'speech'
      ? 'a text-to-speech model for /v1/audio/speech (tts-1, tts-1-hd, gpt-4o-mini-tts)'
      : 'a Realtime model (gpt-realtime-2.1-mini, gpt-realtime-2.1, ...)';
  const got =
    kind === 'text'
      ? 'a text model'
      : kind === 'speech'
        ? 'a text-to-speech model'
        : kind === 'realtime'
          ? 'a Realtime model'
          : 'not a recognised speech model';
  return `Speech API "${api}" needs ${expected}, but "${model}" is ${got}.`;
}

/** Built-in voices per API (custom voices use ids that start with "voice_"). */
export const REALTIME_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const;
export const SPEECH_API_VOICES = [...REALTIME_VOICES, 'fable', 'onyx', 'nova'] as const;

export function voiceSupported(api: SpeechApi, voice: string): boolean {
  if (/^voice_[A-Za-z0-9_-]{1,60}$/.test(voice)) return true;
  const list: readonly string[] = api === 'speech' ? SPEECH_API_VOICES : REALTIME_VOICES;
  return list.includes(voice);
}

/** Only gpt-4o-mini-tts style models take a free-text `instructions` field on /v1/audio/speech. */
export function speechApiAcceptsInstructions(model: string): boolean {
  return /^gpt-4o-mini-tts/.test(model);
}

/** Models whose shutdown has been announced; surfaced as a warning, never blocked. */
export function deprecationNote(model: string): string | null {
  if (/^(tts-1|gpt-4o-mini-tts)/.test(model)) {
    return `${model} uses the Speech API, which OpenAI has scheduled to shut down on 2027-01-06; the recommended replacement is ${DEFAULT_REALTIME_SPEECH_MODEL} through the Realtime API.`;
  }
  if (/^gpt-realtime(-mini)?(-2025-\d{2}-\d{2})?$/.test(model) || /^gpt-audio-mini/.test(model)) {
    return `${model} is deprecated (announced shutdown 2027-01-20).`;
  }
  if (/^gpt-4(\.1|o)/.test(model)) return `${model} is deprecated (announced shutdown 2027-01-14 or earlier).`;
  if (/^gpt-5(-mini|-nano)?(-2025-08-07)?$/.test(model)) return `${model} is deprecated (announced shutdown 2026-12-11).`;
  return null;
}

/** Model ids are restricted to a conservative character set before they are used anywhere. */
export function isPlausibleModelId(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(model);
}
