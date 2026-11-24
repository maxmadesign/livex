import type { GuidePort } from '../core/contracts';
import { GuideDirector, type GuideConfig, type GuideDeps, type GuideStats } from './GuideDirector';
import type { StatusResponseBody } from './protocol';

/** The guide as the app uses it: the `GuidePort` contract plus configuration. */
export type Guide = GuidePort & {
  /** Call whenever AI settings, UI language or the theme change. */
  configure(cfg: GuideConfig): void;
  /** Counters for the diagnostics panel. */
  debugStats(): GuideStats;
  /** Last `/api/ai/status` answer (no secrets), or null when the server was not reachable. */
  serverStatus(): StatusResponseBody | null;
};

/**
 * Creates Momo. `audio` may be null (audio engine failed or is not unlocked
 * yet); the guide then shows subtitles only or uses the system voice.
 */
export function createGuide(deps: GuideDeps): Guide {
  return new GuideDirector(deps);
}
