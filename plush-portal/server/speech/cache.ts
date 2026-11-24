import { createHash } from 'node:crypto';
import type { SpeechResult } from './types';

/** Small LRU for identical (api, model, voice, speed, lang, text) requests. Bounded by entries and bytes. */
export class SpeechCache {
  private readonly entries = new Map<string, SpeechResult>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = 64,
    private readonly maxBytes = 24 * 1024 * 1024,
  ) {}

  static key(parts: { api: string; model: string; voice: string; speed: number; lang: string; text: string }): string {
    return createHash('sha256')
      .update([parts.api, parts.model, parts.voice, parts.speed.toFixed(2), parts.lang, parts.text].join('\u0000'))
      .digest('hex');
  }

  get(key: string): SpeechResult | null {
    const hit = this.entries.get(key);
    if (!hit) return null;
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit;
  }

  set(key: string, value: SpeechResult): void {
    if (value.audio.byteLength > this.maxBytes / 4) return;
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.audio.byteLength;
      this.entries.delete(key);
    }
    this.entries.set(key, value);
    this.bytes += value.audio.byteLength;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.entries.get(oldest)?.audio.byteLength ?? 0;
      this.entries.delete(oldest);
    }
  }

  size(): number {
    return this.entries.size;
  }
}
