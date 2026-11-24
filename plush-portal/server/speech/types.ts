import type { Lang } from '../../src/core/types';
import type { SpeechApi } from '../../src/ai/protocol';

export interface SpeechJob {
  text: string;
  lang: Lang;
  voice: string;
  /** 0.5–1.5 */
  speed: number;
  model: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface SpeechResult {
  audio: Uint8Array;
  mime: 'audio/mpeg' | 'audio/wav';
  model: string;
  voice: string;
  /** What the voice model reports it said (Realtime only); for diagnostics. */
  transcript?: string;
}

/**
 * One way of turning text into audio on the server. Each provider talks to
 * exactly one OpenAI interface; model ids are checked against that interface
 * before a provider is called (see capabilities.speechModelMatches).
 */
export interface ServerSpeechProvider {
  readonly api: SpeechApi;
  synthesize(job: SpeechJob): Promise<SpeechResult>;
}
