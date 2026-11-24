/**
 * Thin, failure-tolerant wrapper around localStorage. Private windows, blocked
 * storage or quota errors must never break the game: reads fall back to null
 * and writes report false.
 */
const PREFIX = 'plush-portal/';

export function readJson(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    globalThis.localStorage?.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
