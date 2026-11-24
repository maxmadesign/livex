import type { GuideEmotion } from '../../core/contracts';
import type { Lang } from '../../core/types';

/** A way of turning one of Momo's lines into sound. */
export type SpeechPath = 'ai' | 'system' | 'babble';

export interface SpeechRequest {
  text: string;
  lang: Lang;
  emotion: GuideEmotion;
  /** 0.7–1.3, from settings. */
  speed: number;
  /** AI voice id; '' = server default. */
  voiceName: string;
  /** AI speech model override; '' = server default. */
  model: string;
  /** Aborted when the line is cancelled (pre-empted, stale, paused, silenced). */
  signal: AbortSignal;
}

export interface SpeechPlayback {
  path: SpeechPath;
  /** Resolves when the audio ended or was stopped. Never rejects. */
  done: Promise<void>;
  stop(): void;
}

export interface SpeechProvider {
  readonly path: SpeechPath;
  /** Cheap check: could this provider speak `lang` right now? */
  available(lang: Lang): boolean;
  /**
   * Starts speaking. Resolves with a playback once audio has really started,
   * or with null when this provider could not speak (the router then tries the
   * next one). Must never throw.
   */
  speak(request: SpeechRequest): Promise<SpeechPlayback | null>;
}
