/**
 * Small cache for GPT-written lines. It keeps a few variants per situation so
 * that Momo can (a) skip the network for low-priority chatter and (b) still
 * say something GPT wrote when a later request is slow or fails.
 *
 * Modes follow Settings → AI Guide → cache:
 *   off        – nothing is kept, stored data is removed
 *   session    – memory only
 *   persistent – memory + localStorage (bounded)
 *
 * Only text, emotion and the speak flag are stored. No keys, no prompts.
 */
import type { GuideEmotion, GuideEvent } from '../core/contracts';
import { hashString } from '../core/math';
import type { Lang, ThemeId } from '../core/types';
import { rewardFor, usableBrand } from './brand';
import { directionKey } from './lines/direction';
import type { LineLength } from './protocol';

export interface CachedLine {
  text: string;
  emotion: GuideEmotion;
  shouldSpeak: boolean;
}

export type CacheMode = 'off' | 'session' | 'persistent';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LINE_CACHE_STORAGE_KEY = 'plush-portal.ai.lines.v1';
const MAX_KEYS = 160;
const MAX_VARIANTS = 4;
const MAX_STORED_CHARS = 120_000;

export function defaultStorage(): StorageLike | null {
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    return storage ?? null;
  } catch {
    return null; // storage blocked (private mode, sandboxed iframe)
  }
}

export class LineCache {
  private mode: CacheMode = 'off';
  /** Insertion order doubles as LRU order (oldest first). */
  private entries = new Map<string, CachedLine[]>();

  constructor(private readonly storage: StorageLike | null = defaultStorage()) {}

  setMode(mode: CacheMode): void {
    if (mode === this.mode) return;
    const previous = this.mode;
    this.mode = mode;
    if (mode === 'off') this.entries.clear();
    if (mode === 'persistent') {
      this.load();
      this.save();
    } else if (previous === 'persistent' || mode === 'off') {
      // Leaving persistent mode (or switching the cache off) removes what was stored.
      try {
        this.storage?.removeItem(LINE_CACHE_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  getMode(): CacheMode {
    return this.mode;
  }

  get(key: string): CachedLine[] {
    if (this.mode === 'off') return [];
    const lines = this.entries.get(key);
    if (!lines) return [];
    // Refresh LRU position.
    this.entries.delete(key);
    this.entries.set(key, lines);
    return [...lines];
  }

  add(key: string, line: CachedLine): void {
    if (this.mode === 'off') return;
    const lines = this.entries.get(key) ?? [];
    const norm = line.text.trim();
    if (lines.some((l) => l.text === norm)) return;
    lines.push({ text: norm, emotion: line.emotion, shouldSpeak: line.shouldSpeak });
    while (lines.length > MAX_VARIANTS) lines.shift();
    this.entries.delete(key);
    this.entries.set(key, lines);
    while (this.entries.size > MAX_KEYS) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    if (this.mode === 'persistent') this.save();
  }

  clear(): void {
    this.entries.clear();
    try {
      this.storage?.removeItem(LINE_CACHE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  size(): number {
    return this.entries.size;
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(LINE_CACHE_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!Array.isArray(item) || typeof item[0] !== 'string' || !Array.isArray(item[1])) continue;
        const lines: CachedLine[] = [];
        for (const l of item[1] as unknown[]) {
          if (!l || typeof l !== 'object') continue;
          const o = l as Record<string, unknown>;
          if (typeof o.text !== 'string' || o.text.length === 0 || o.text.length > 400) continue;
          if (typeof o.emotion !== 'string') continue;
          lines.push({ text: o.text, emotion: o.emotion as GuideEmotion, shouldSpeak: o.shouldSpeak !== false });
        }
        if (lines.length > 0 && !this.entries.has(item[0])) this.entries.set(item[0], lines.slice(-MAX_VARIANTS));
        if (this.entries.size >= MAX_KEYS) break;
      }
    } catch {
      /* corrupt cache: start empty */
    }
  }

  private save(): void {
    if (!this.storage) return;
    try {
      let items = [...this.entries.entries()];
      let json = JSON.stringify(items);
      // Drop the oldest half until it fits the budget.
      while (json.length > MAX_STORED_CHARS && items.length > 1) {
        items = items.slice(Math.ceil(items.length / 2));
        json = JSON.stringify(items);
      }
      this.storage.setItem(LINE_CACHE_STORAGE_KEY, json);
    } catch {
      /* quota exceeded or storage blocked: memory cache still works */
    }
  }
}

/** Coarse description of the facts that change what a good line would be. */
export function factsCacheKey(event: GuideEvent): string {
  const f = event.facts;
  const demo = f.demo ? 'demo' : '';
  switch (event.type) {
    case 'empty_grab':
      return [demo, f.contact ?? 'none', directionKey(f.nearest) ?? '-', f.nearest?.name ?? ''].join('|');
    case 'slipped_after_grip':
      return [demo, f.slipReason ?? '-', f.contact ?? ''].join('|');
    case 'prize_won':
      return [demo, f.toy?.typeId ?? '', f.toy?.name ?? '', f.newCharacter ? 'new' : '', rewardKey(event)].join('|');
    case 'idle_hint':
    case 'user_requested_tip':
      return f.headTracking ? 'tracking' : '';
    case 'retry_prompt':
      return rewardKey(event) || (f.lossStreak >= 3 ? 'streak' : '');
    default:
      return '';
  }
}

/** A line inviting the player to scan a QR must never be reused when there is none (or vice versa). */
function rewardKey(event: GuideEvent): string {
  const reward = rewardFor(event.type, event.facts);
  return reward ? `qr:${reward.options}` : '';
}

export function lineCacheKey(parts: {
  event: GuideEvent;
  lang: Lang;
  theme: ThemeId;
  length: LineLength;
  model: string;
  /** System prompt + persona, so edited prompts do not reuse old lines. */
  promptText: string;
}): string {
  // Lines that name an event are kept apart from the theme's generic ones (both kits share a theme).
  const brand = usableBrand(parts.theme, parts.event.facts.brand);
  return [
    parts.event.type,
    brand ? `${parts.theme}@${brand.event}` : parts.theme,
    parts.lang,
    parts.length,
    parts.model || 'default',
    hashString(parts.promptText).toString(36),
    factsCacheKey(parts.event),
  ].join('~');
}
