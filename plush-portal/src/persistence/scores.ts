import type { ScoreRecord } from '../game/scoring';
import { readJson, removeKey, writeJson } from './storage';

/**
 * Best session score and lifetime total of the points system, kept on this
 * device only. Scores are not settings: they are never part of a configuration
 * export and are reset separately (Settings → System → Reset scores).
 */
export const SCORES_KEY = 'scores';
export const SCORES_VERSION = 1;

/** Upper bound for stored totals (keeps a corrupted or hostile value from overflowing the HUD). */
const MAX_POINTS = 999_999_999;

export function emptyScores(): ScoreRecord {
  return { best: 0, lifetime: 0 };
}

function points(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(MAX_POINTS, Math.floor(v)) : 0;
}

/** Cleans stored data; anything unusable (missing, corrupt, written by a newer build) becomes zero. */
export function sanitizeScores(raw: unknown): ScoreRecord {
  if (!raw || typeof raw !== 'object') return emptyScores();
  const o = raw as { version?: unknown; best?: unknown; lifetime?: unknown };
  if (typeof o.version !== 'number' || o.version > SCORES_VERSION) return emptyScores();
  const best = points(o.best);
  // The lifetime total can never be lower than one session of it.
  return { best, lifetime: Math.max(best, points(o.lifetime)) };
}

export function loadScores(): ScoreRecord {
  return sanitizeScores(readJson(SCORES_KEY));
}

export function saveScores(record: ScoreRecord): boolean {
  // Data written by a newer build is left alone (as with the settings): that build may still need it.
  const stored = readJson(SCORES_KEY);
  if (stored && typeof stored === 'object' && typeof (stored as { version?: unknown }).version === 'number' && (stored as { version: number }).version > SCORES_VERSION) return false;
  return writeJson(SCORES_KEY, { version: SCORES_VERSION, best: points(record.best), lifetime: points(record.lifetime) });
}

export function clearScores(): void {
  removeKey(SCORES_KEY);
}
