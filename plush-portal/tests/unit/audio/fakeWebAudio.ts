/**
 * Scripted Web Audio stand-in for the studio tests: no sound, but every node, source,
 * start / stop, gain automation (including value curves) and the context clock are
 * observable and controllable.
 */
import type { AudioEnv } from '../../../src/audio/index';

export class FakeParam {
  history: { kind: string; value: number; time: number; curve?: Float32Array; duration?: number }[] = [];
  constructor(public value = 0) {}
  setValueAtTime(value: number, time: number) {
    this.value = value;
    this.history.push({ kind: 'set', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number) {
    this.value = value;
    this.history.push({ kind: 'target', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.history.push({ kind: 'ramp', value, time });
    return this;
  }
  setValueCurveAtTime(curve: Float32Array, time: number, duration: number) {
    this.value = curve[curve.length - 1]!;
    this.history.push({ kind: 'curve', value: this.value, time, curve, duration });
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

export class FakeNode {
  outputs: FakeNode[] = [];
  connect(node: FakeNode) {
    this.outputs.push(node);
    return node;
  }
  disconnect() {
    this.outputs = [];
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export interface FakeBuffer {
  name: string;
  duration: number;
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(): Float32Array;
  copyToChannel(): void;
}

export function fakeBuffer(name: string, duration: number): FakeBuffer {
  return { name, duration, numberOfChannels: 2, sampleRate: 44100, length: Math.round(duration * 44100), getChannelData: () => new Float32Array(1), copyToChannel: () => undefined };
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  startArgs: { when: number; offset: number } | null = null;
  stopAt: number | null = null;
  stopped = false;
  constructor(private readonly ctx: FakeContext) {
    super();
  }
  start(when = 0, offset = 0) {
    this.startArgs = { when, offset };
    this.ctx.started.push(this);
  }
  stop(when?: number) {
    this.stopped = true;
    this.stopAt = when ?? this.ctx.currentTime;
  }
  end() {
    this.stopped = true;
    this.onended?.();
  }
}

export class FakeContext {
  static instances: FakeContext[] = [];
  static broken = new Set<string>();
  static durations = new Map<string, number>();
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  started: FakeSource[] = [];
  decoded: string[] = [];
  constructor() {
    FakeContext.instances.push(this);
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource(this);
    this.sources.push(s);
    return s;
  }
  createDynamicsCompressor() {
    const n = new FakeNode() as FakeNode & Record<string, FakeParam>;
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new FakeParam(0);
    return n;
  }
  createStereoPanner() {
    const n = new FakeNode() as FakeNode & { pan: FakeParam };
    n.pan = new FakeParam(0);
    return n;
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return fakeBuffer('synth', length / sampleRate);
  }
  async decodeAudioData(bytes: ArrayBuffer) {
    const name = new TextDecoder().decode(bytes);
    if (FakeContext.broken.has(name)) throw new Error('EncodingError: Unable to decode audio data');
    this.decoded.push(name);
    return fakeBuffer(name, FakeContext.durations.get(name) ?? 0.5);
  }
  async resume() {
    if (this.state !== 'closed') {
      this.state = 'running';
      this.onstatechange?.();
    }
  }
  async suspend() {
    if (this.state === 'running') {
      this.state = 'suspended';
      this.onstatechange?.();
    }
  }
  async close() {
    this.state = 'closed';
  }
  /** Sources started (and not stopped) that play the given file. */
  playing(name: string) {
    return this.started.filter((s) => s.buffer?.name === name && !s.stopped);
  }
}

export interface FakeEnvSetup {
  manifest: unknown;
  missing?: string[];
  broken?: string[];
}

/** Engine environment over the fake context; the fetch "body" of a file is its own path. */
export function makeFakeEnv(setup: FakeEnvSetup): { env: Partial<AudioEnv>; clock: { now: number }; fetched: string[] } {
  const missing = new Set(setup.missing ?? []);
  FakeContext.broken = new Set(setup.broken ?? []);
  const clock = { now: 1000 };
  const fetched: string[] = [];
  let seed = 7;
  const env: Partial<AudioEnv> = {
    AudioContextCtor: FakeContext as unknown as AudioEnv['AudioContextCtor'],
    OfflineContextCtor: FakeContext as unknown as AudioEnv['OfflineContextCtor'],
    fetch: async (url: string) => {
      const file = url.replace(/^\/audio\//, '');
      fetched.push(file);
      if (file === 'manifest.json') return new Response(JSON.stringify(setup.manifest), { status: 200 });
      if (missing.has(file)) return new Response('not found', { status: 404 });
      return new Response(new TextEncoder().encode(file), { status: 200 });
    },
    createWorker: null,
    mediaDevices: null,
    now: () => clock.now,
    random: () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    },
  };
  return { env, clock, fetched };
}

export const flush = async (rounds = 16) => {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

/** The context the engine plays through (offline decode contexts are FakeContexts too). */
export const playbackContext = () => FakeContext.instances.filter((c) => c.gains.length >= 8).at(-1)!;

/** Creation order of the engine's graph. */
export const BUS = { master: 0, music: 1, duck: 2, musicMain: 3, preview: 4, sfx: 5, voice: 6, stingerDuck: 7 };

/** Follows a node's outputs until a node in `targets` is reached. */
export function reaches(node: FakeNode, target: FakeNode, depth = 6): boolean {
  if (node === target) return true;
  if (depth === 0) return false;
  return node.outputs.some((n) => reaches(n, target, depth - 1));
}
