/**
 * Studio music play-list: the takes of a theme play one after another, each from its
 * in point to its out point, joined by equal-power cross-fades that are centred on the
 * hand-over so the two beat grids meet in the middle of the fade. Nothing loops hard.
 *
 * All timing is in AudioContext time, so a suspended context (hidden page) simply pauses
 * the plan; the service timer only decides *when* to schedule the next hand-over.
 */
import type { StudioTake } from './manifest';

/** Seconds before a fade starts at which the hand-over is scheduled (sample-accurately). */
export const PLAYLIST_LOOKAHEAD = 6;
/** Seconds before a fade starts at which the next take is decoded. */
export const PLAYLIST_PREFETCH = 30;
/** Service period, ms. */
export const PLAYLIST_TICK_MS = 250;
const CURVE_POINTS = 64;

export type TakeShape = Pick<StudioTake, 'inPoint' | 'outPoint' | 'crossfade' | 'duration'>;

/** Cross-fade length a → b: a's fade, limited by the room before b's in point and after a's out point. */
export function transitionCrossfade(a: TakeShape, b: TakeShape): number {
  return Math.max(0.05, Math.min(a.crossfade, 2 * b.inPoint, 2 * (a.duration - a.outPoint)));
}

export interface Handover {
  /** Context time where the outgoing reaches its out point and the incoming its in point. */
  junction: number;
  fadeStart: number;
  fadeEnd: number;
  crossfade: number;
  /** Position in the incoming file at `fadeStart`. */
  incomingOffset: number;
  /** Context time at which position 0 of the incoming file would play. */
  incomingZero: number;
}

/**
 * Plans the hand-over from a take whose position 0 plays at context time `zero` to `next`.
 * `notBefore` (now + a small margin) moves a hand-over that is already late: the fade starts
 * then, the outgoing simply plays a little past its out point.
 */
export function planHandover(cur: TakeShape, zero: number, next: TakeShape, notBefore = -Infinity): Handover {
  let crossfade = transitionCrossfade(cur, next);
  let junction = zero + cur.outPoint;
  let fadeStart = junction - crossfade / 2;
  if (fadeStart < notBefore) {
    fadeStart = notBefore;
    // Keep the outgoing inside its file: shorten the fade if it would run off the end.
    const room = zero + cur.duration - fadeStart;
    crossfade = Math.max(0.05, Math.min(crossfade, room - 0.02));
    junction = fadeStart + crossfade / 2;
  }
  const incomingOffset = Math.max(0, next.inPoint - crossfade / 2);
  return { junction, fadeStart, fadeEnd: fadeStart + crossfade, crossfade, incomingOffset, incomingZero: fadeStart - incomingOffset };
}

/** The take after `current`: the next one in order when it is ready, otherwise the same take again. */
export function nextTakeIndex(current: number, count: number, ready: (index: number) => boolean): number {
  if (count <= 1) return current;
  const next = (current + 1) % count;
  return ready(next) ? next : current;
}

let curves: { fadeIn: Float32Array; fadeOut: Float32Array } | null = null;
/** Equal-power gain curves: cos / sin over a quarter period (shared, read-only). */
export function equalPowerCurves(): { fadeIn: Float32Array; fadeOut: Float32Array } {
  if (!curves) {
    const fadeIn = new Float32Array(CURVE_POINTS);
    const fadeOut = new Float32Array(CURVE_POINTS);
    for (let i = 0; i < CURVE_POINTS; i++) {
      const t = i / (CURVE_POINTS - 1);
      fadeIn[i] = Math.sin((t * Math.PI) / 2);
      fadeOut[i] = Math.cos((t * Math.PI) / 2);
    }
    curves = { fadeIn, fadeOut };
  }
  return curves;
}

export interface StudioPlayerDeps {
  ctx: BaseAudioContext;
  /** Node the play-list feeds (the engine's per-theme gain). */
  output: AudioNode;
  takes: TakeShape[];
  /** Decoded buffer of a take, or null when it is not decoded (yet). */
  buffer(index: number): AudioBuffer | null;
  /** Asks for a take to be decoded (asynchronous; `buffer` returns it once ready). */
  request(index: number): void;
  /** The play-list no longer needs this take's buffer (memory can be released). */
  release(index: number): void;
}

interface Item {
  take: number;
  zero: number;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * Plays one theme's play-list. Created by the engine once the first take is decoded; the
 * engine owns the theme fade (its `output` gain) and calls `stop` when the theme changes.
 */
export class StudioPlayer {
  private current: Item | null = null;
  private pending: { item: Item; handover: Handover; previous: Item } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /** Every hand-over planned so far (diagnostics and tests). */
  readonly history: { from: number; to: number; handover: Handover }[] = [];

  constructor(private readonly deps: StudioPlayerDeps) {}

  /** Starts take `index` at file position `offset` (default: the very beginning, intro included). */
  start(index = 0, offset = 0): boolean {
    const buffer = this.deps.buffer(index);
    if (!buffer || this.stopped) return false;
    const t = this.deps.ctx.currentTime;
    const item = this.makeItem(index, buffer, t - offset);
    item.gain.gain.setValueAtTime(1, t);
    item.source.start(t, offset);
    this.current = item;
    this.timer = setInterval(() => this.service(), PLAYLIST_TICK_MS);
    this.service();
    return true;
  }

  /** Context time at which the current take reaches its out point (null when stopped). */
  nextJunction(): number | null {
    return this.current ? this.current.zero + this.deps.takes[this.current.take]!.outPoint : null;
  }

  get currentTake(): number | null {
    return this.current?.take ?? null;
  }

  private makeItem(take: number, buffer: AudioBuffer, zero: number): Item {
    const ctx = this.deps.ctx;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(this.deps.output);
    const item: Item = { take, zero, source, gain };
    source.onended = () => this.onEnded(item);
    return item;
  }

  /** Schedules the next hand-over once it is close; prefetches the next take earlier. */
  service(): void {
    if (this.stopped || !this.current) return;
    const ctx = this.deps.ctx;
    const now = ctx.currentTime;
    if (this.pending) {
      // The previous hand-over completed: release what the outgoing take held.
      if (now >= this.pending.handover.fadeEnd + 0.1) {
        const old = this.pending.previous;
        this.pending = null;
        if (old.take !== this.current.take) this.deps.release(old.take);
      } else {
        return;
      }
    }
    const takes = this.deps.takes;
    const cur = this.current;
    const shape = takes[cur.take]!;
    const wanted = (cur.take + 1) % takes.length;
    const fadeStart = cur.zero + shape.outPoint - shape.crossfade / 2;
    if (now >= fadeStart - PLAYLIST_PREFETCH && wanted !== cur.take) this.deps.request(wanted);
    if (now < fadeStart - PLAYLIST_LOOKAHEAD) return;
    const nextIndex = nextTakeIndex(cur.take, takes.length, (i) => this.deps.buffer(i) !== null);
    const buffer = this.deps.buffer(nextIndex);
    if (!buffer) return; // cannot happen for the current take unless it was released; try again next tick
    const handover = planHandover(shape, cur.zero, takes[nextIndex]!, now + 0.05);
    this.schedule(cur, nextIndex, buffer, handover);
  }

  private schedule(cur: Item, nextIndex: number, buffer: AudioBuffer, h: Handover): void {
    const ctx = this.deps.ctx;
    const { fadeIn, fadeOut } = equalPowerCurves();
    const next = this.makeItem(nextIndex, buffer, h.incomingZero);
    const now = ctx.currentTime;
    next.gain.gain.setValueAtTime(0, now);
    next.gain.gain.setValueCurveAtTime(fadeIn, h.fadeStart, h.crossfade);
    next.source.start(h.fadeStart, h.incomingOffset);
    cur.gain.gain.cancelScheduledValues(h.fadeStart);
    cur.gain.gain.setValueCurveAtTime(fadeOut, h.fadeStart, h.crossfade);
    try {
      cur.source.stop(h.fadeEnd + 0.05);
    } catch {
      /* already stopped */
    }
    this.history.push({ from: cur.take, to: nextIndex, handover: h });
    this.pending = { item: next, handover: h, previous: cur };
    this.current = next;
  }

  /** A take ran to the end of its file without a hand-over (timers starved): continue at once. */
  private onEnded(item: Item): void {
    item.source.disconnect();
    item.gain.disconnect();
    if (this.stopped || this.current !== item) return;
    const takes = this.deps.takes;
    const nextIndex = nextTakeIndex(item.take, takes.length, (i) => this.deps.buffer(i) !== null);
    const buffer = this.deps.buffer(nextIndex);
    if (!buffer) return;
    const t = this.deps.ctx.currentTime;
    const offset = takes[nextIndex]!.inPoint;
    const next = this.makeItem(nextIndex, buffer, t - offset);
    next.gain.gain.setValueAtTime(0, t);
    next.gain.gain.linearRampToValueAtTime(1, t + 0.3);
    next.source.start(t, offset);
    this.current = next;
    this.pending = null;
  }

  /** Stops every source at context time `when` (the engine fades its output gain first). */
  stop(when: number): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const item of [this.current, this.pending?.previous]) {
      if (!item) continue;
      try {
        item.source.stop(when);
      } catch {
        /* already stopped */
      }
    }
    this.current = null;
    this.pending = null;
  }

  get isStopped(): boolean {
    return this.stopped;
  }
}
