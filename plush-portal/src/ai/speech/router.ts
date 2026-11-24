import type { Lang } from '../../core/types';
import type { SpeechPath, SpeechPlayback, SpeechProvider, SpeechRequest } from './types';

/** A playback that ends this quickly did not really play (decode failure, blocked output). */
const MIN_REAL_PLAYBACK_MS = 140;

export type SpeechProviders = Record<SpeechPath, SpeechProvider>;

/**
 * Tries the speech paths in order and returns the first one that really starts
 * making sound. Exactly one utterance can be active at a time: starting a new
 * one stops the previous one.
 */
export class SpeechRouter {
  private current: SpeechPlayback | null = null;
  private generation = 0;

  constructor(
    private readonly providers: SpeechProviders,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Paths that could speak `lang` right now, in the given preference order. */
  usable(order: readonly SpeechPath[], lang: Lang): SpeechPath[] {
    return order.filter((path) => this.providers[path].available(lang));
  }

  async speak(order: readonly SpeechPath[], request: SpeechRequest): Promise<SpeechPlayback | null> {
    this.stop();
    const generation = ++this.generation;
    for (const path of order) {
      if (request.signal.aborted || generation !== this.generation) return null;
      const provider = this.providers[path];
      if (!provider.available(request.lang)) continue;
      let playback: SpeechPlayback | null = null;
      try {
        playback = await provider.speak(request);
      } catch {
        playback = null;
      }
      if (!playback) continue;
      if (request.signal.aborted || generation !== this.generation) {
        playback.stop();
        return null;
      }
      // Guard against "played" audio that ended immediately.
      const startedAt = this.now();
      const endedEarly = await Promise.race([
        playback.done.then(() => this.now() - startedAt < MIN_REAL_PLAYBACK_MS),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), MIN_REAL_PLAYBACK_MS)),
      ]);
      if (endedEarly && !request.signal.aborted && generation === this.generation) continue;
      if (request.signal.aborted || generation !== this.generation) {
        playback.stop();
        return null;
      }
      this.current = playback;
      void playback.done.then(() => {
        if (this.current === playback) this.current = null;
      });
      return playback;
    }
    return null;
  }

  /** Stops whatever is playing and cancels attempts that are still starting. */
  stop(): void {
    this.generation++;
    const playback = this.current;
    this.current = null;
    playback?.stop();
  }

  isSpeaking(): boolean {
    return this.current !== null;
  }
}
