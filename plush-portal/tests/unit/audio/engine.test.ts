/**
 * AudioEngine logic against a scripted Web Audio stand-in: no sound is produced,
 * but every node, source, start/stop and gain target is observable.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine, type AudioEnv } from '../../../src/audio/index';
import { buildSynthManifest, renderFileByKey, themeOfMusicFile, type AudioManifest } from '../../../src/audio/synth/index';
import type { AudioPort, AudioVolumes } from '../../../src/core/contracts';

const realManifest = JSON.parse(
  readFileSync(path.join(fileURLToPath(new URL('../../..', import.meta.url)), 'public', 'audio', 'manifest.json'), 'utf8'),
) as AudioManifest;

/* ------------------------------------------------------------ fake web audio */

class FakeParam {
  history: { kind: string; value: number; time: number }[] = [];
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
  cancelScheduledValues() {
    return this;
  }
}

class FakeNode {
  outputs: FakeNode[] = [];
  connect(node: FakeNode) {
    this.outputs.push(node);
    return node;
  }
  disconnect() {
    this.outputs = [];
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

interface FakeBuffer {
  name: string;
  duration: number;
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(): Float32Array;
  copyToChannel(): void;
}

function fakeBuffer(name: string, duration: number): FakeBuffer {
  return { name, duration, numberOfChannels: 2, sampleRate: 44100, length: Math.round(duration * 44100), getChannelData: () => new Float32Array(1), copyToChannel: () => undefined };
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  startArgs: { when: number; offset: number } | null = null;
  stopped = false;
  constructor(private readonly ctx: FakeContext) {
    super();
  }
  start(when = 0, offset = 0) {
    this.startArgs = { when, offset };
    this.ctx.started.push(this);
  }
  stop() {
    this.stopped = true;
  }
  /** What the browser does when playback reaches the end / the stop time. */
  end() {
    this.stopped = true;
    this.onended?.();
  }
}

class FakeContext {
  static instances: FakeContext[] = [];
  static broken = new Set<string>();
  static musicDurations = new Map<string, number>();
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  started: FakeSource[] = [];
  /** When false, resume() resolves without starting (autoplay policy). */
  allowResume = true;
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
    return fakeBuffer(name, FakeContext.musicDurations.get(name) ?? 0.5);
  }
  async resume() {
    if (this.allowResume && this.state !== 'closed') {
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
  /** Finishes every one-shot (non-looping) source that is still playing. */
  finishOneShots() {
    for (const s of this.started) if (!s.loop && !s.stopped) s.end();
  }
  liveLoops(name: string) {
    return this.started.filter((s) => s.loop && !s.stopped && s.buffer?.name === name);
  }
}

class FakeContextWithSink extends FakeContext {
  sink = 'unset';
  async setSinkId(id: string) {
    if (id === 'bad') throw new Error('NotFoundError: no such device');
    this.sink = id;
  }
}

/** Stands in for the synth worker; effects are really rendered, music is stubbed to keep the test fast. */
class FakeWorker {
  static created = 0;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { message: string }) => void) | null = null;
  terminated = false;
  constructor() {
    FakeWorker.created++;
  }
  postMessage(req: { id: number; type: 'describe' } | { id: number; type: 'render'; files: string[] }) {
    queueMicrotask(() => {
      if (req.type === 'describe') {
        this.onmessage?.({ data: { id: req.id, type: 'describe', manifest: buildSynthManifest() } });
        return;
      }
      for (const file of req.files) {
        if (themeOfMusicFile(file)) {
          this.onmessage?.({ data: { id: req.id, type: 'file', file, sampleRate: 44100, channels: [new Float32Array(44100 * 3), new Float32Array(44100 * 3)], loopStart: 0.25, loopEnd: 2.25 } });
          continue;
        }
        const rendered = renderFileByKey(file);
        if (rendered) this.onmessage?.({ data: { id: req.id, type: 'file', file, sampleRate: rendered.sampleRate, channels: rendered.channels } });
        else this.onmessage?.({ data: { id: req.id, type: 'missing', file } });
      }
      this.onmessage?.({ data: { id: req.id, type: 'done' } });
    });
  }
  terminate() {
    this.terminated = true;
  }
}

interface Setup {
  manifest?: AudioManifest | null;
  missing?: string[];
  broken?: string[];
  worker?: boolean;
  sink?: boolean;
  offline?: boolean;
}

function makeEnv(setup: Setup = {}): { env: Partial<AudioEnv>; clock: { now: number }; fetched: string[] } {
  const manifest = setup.manifest === undefined ? realManifest : setup.manifest;
  const missing = new Set(setup.missing ?? []);
  FakeContext.broken = new Set(setup.broken ?? []);
  FakeContext.musicDurations = new Map(Object.values(realManifest.music).map((m) => [m.file, m.duration]));
  const clock = { now: 1000 };
  const fetched: string[] = [];
  let seed = 1;
  const env: Partial<AudioEnv> = {
    AudioContextCtor: (setup.sink ? FakeContextWithSink : FakeContext) as unknown as AudioEnv['AudioContextCtor'],
    OfflineContextCtor: setup.offline === false ? null : (FakeContext as unknown as AudioEnv['OfflineContextCtor']),
    fetch: async (url: string) => {
      const file = url.replace(/^\/audio\//, '');
      fetched.push(file);
      if (file === 'manifest.json') {
        return manifest ? new Response(JSON.stringify(manifest), { status: 200 }) : new Response('not found', { status: 404 });
      }
      if (missing.has(file)) return new Response('not found', { status: 404 });
      return new Response(new TextEncoder().encode(file), { status: 200 });
    },
    createWorker: setup.worker ? () => new FakeWorker() as unknown as Worker : null,
    mediaDevices: null,
    now: () => clock.now,
    // Deterministic but varied.
    random: () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    },
  };
  return { env, clock, fetched };
}

const VOL: AudioVolumes = { master: 0.8, music: 0.5, sfx: 0.7, voice: 0.9, muted: false, ducking: 0.6 };
const flush = async (rounds = 12) => {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};
/** The context the engine plays through (offline decode contexts are also FakeContexts). */
const playbackContext = () => FakeContext.instances.filter((c) => c.gains.length >= 7).at(-1)!;
// Creation order inside the engine's graph.
const BUS = { master: 0, music: 1, duck: 2, musicMain: 3, preview: 4, sfx: 5, voice: 6 };

let engines: AudioPort[] = [];
function engineWith(setup: Setup = {}, preload = true) {
  const made = makeEnv(setup);
  const engine = createAudioEngine({ env: made.env, preload });
  engines.push(engine);
  return { engine, ...made };
}

beforeEach(() => {
  FakeContext.instances = [];
  FakeWorker.created = 0;
  engines = [];
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  for (const e of engines) e.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/* -------------------------------------------------------------------- tests */

describe('AudioEngine: locked state', () => {
  it('treats every call before unlock() as a safe no-op and creates no context', async () => {
    const { engine } = engineWith();
    expect(engine.status().state).toBe('locked');
    engine.setVolumes(VOL);
    engine.setTheme('ocean');
    engine.setMusicTrack('theme');
    engine.playSfx('ui_click');
    engine.setLoop('motor_trolley', 1);
    engine.stopVoice();
    engine.setVoiceActive(true);
    engine.setVoiceActive(false);
    engine.suspend();
    engine.resume();
    expect(engine.voiceBus()).toBeNull();
    const handle = engine.playVoice(new ArrayBuffer(8));
    await handle.done; // resolves immediately, nothing is queued
    await flush();
    expect(FakeContext.instances.filter((c) => c.gains.length > 0)).toHaveLength(0);
    expect(engine.status().state).toBe('locked');
  });

  it('stays locked (and says why) when the browser refuses to start audio', async () => {
    const { engine } = engineWith();
    const original = FakeContext.prototype.resume;
    FakeContext.prototype.resume = async function () {
      /* autoplay policy: nothing happens */
    };
    try {
      await engine.unlock();
    } finally {
      FakeContext.prototype.resume = original;
    }
    expect(engine.status().state).toBe('locked');
    expect(engine.status().detail).toMatch(/tap or click/);
    // A later gesture succeeds.
    await engine.unlock();
    expect(engine.status().state).toBe('running');
  });

  it('reports failure when Web Audio does not exist and downloads nothing', async () => {
    const made = makeEnv();
    const engine = createAudioEngine({ env: { ...made.env, AudioContextCtor: null } });
    engines.push(engine);
    await flush();
    await engine.unlock();
    expect(engine.status().state).toBe('failed');
    expect(engine.status().outputDeviceSupported).toBe(false);
    expect(made.fetched).toEqual([]);
    engine.playSfx('win');
    engine.setLoop('motor_winch', 1);
  });
});

describe('AudioEngine: running', () => {
  it('unlocks, applies remembered volumes and theme, and loops the music on the manifest loop points', async () => {
    const { engine, fetched } = engineWith();
    const seen: string[] = [];
    engine.subscribe((s) => seen.push(s.state));
    engine.setVolumes(VOL);
    engine.setTheme('sakura');
    await engine.unlock();
    await flush();
    const ctx = playbackContext();
    expect(engine.status()).toMatchObject({ state: 'running', usingFallbackSynth: false, musicTheme: 'sakura' });
    expect(seen).toContain('running');
    expect(ctx.gains[BUS.master]!.gain.value).toBeCloseTo(0.8);
    expect(ctx.gains[BUS.music]!.gain.value).toBeCloseTo(0.5);
    expect(ctx.gains[BUS.sfx]!.gain.value).toBeCloseTo(0.7);
    expect(ctx.gains[BUS.voice]!.gain.value).toBeCloseTo(0.9);
    const music = ctx.started.find((s) => s.buffer?.name === realManifest.music.sakura.file)!;
    expect(music.loop).toBe(true);
    expect(music.loopStart).toBeCloseTo(realManifest.music.sakura.loopStartSample / 44100, 9);
    expect(music.loopEnd).toBeCloseTo(realManifest.music.sakura.loopEndSample / 44100, 9);
    expect(music.loopEnd - music.loopStart).toBeGreaterThanOrEqual(60);
    expect(music.startArgs!.offset).toBeCloseTo(music.loopStart, 9);
    // Only the current theme's track was downloaded.
    expect(fetched.filter((f) => f.startsWith('music/'))).toEqual([realManifest.music.sakura.file]);
  });

  it('mutes through the master bus and clamps volumes', async () => {
    const { engine } = engineWith();
    await engine.unlock();
    const ctx = playbackContext();
    engine.setVolumes({ ...VOL, muted: true });
    expect(ctx.gains[BUS.master]!.gain.value).toBe(0);
    engine.setVolumes({ master: 7, music: -1, sfx: 0.3, voice: 2, muted: false, ducking: 5 });
    expect(ctx.gains[BUS.master]!.gain.value).toBe(1);
    expect(ctx.gains[BUS.music]!.gain.value).toBe(0);
    expect(ctx.gains[BUS.voice]!.gain.value).toBe(1);
  });

  it('cross-fades on theme change, never restarts the same track, and honours a track override', async () => {
    const { engine } = engineWith();
    engine.setTheme('sakura');
    await engine.unlock();
    await flush();
    const ctx = playbackContext();
    const musicSources = () => ctx.started.filter((s) => s.buffer?.name.startsWith('music/'));
    expect(musicSources()).toHaveLength(1);
    engine.setTheme('sakura');
    engine.setTheme('sakura', { immediate: true });
    await flush();
    expect(musicSources()).toHaveLength(1);

    engine.setTheme('cosmic');
    await flush();
    expect(musicSources().map((s) => s.buffer!.name)).toEqual([realManifest.music.sakura.file, realManifest.music.cosmic.file]);
    const [oldTrack, newTrack] = musicSources();
    expect(oldTrack!.stopped).toBe(true);
    expect(oldTrack!.outputs[0]).toBeInstanceOf(FakeGain);
    expect((oldTrack!.outputs[0] as FakeGain).gain.value).toBe(0); // faded out, not cut
    expect(newTrack!.stopped).toBe(false);
    expect(engine.status().musicTheme).toBe('cosmic');

    engine.setMusicTrack('ocean');
    await flush();
    expect(engine.status().musicTheme).toBe('ocean');
    engine.setTheme('storybook'); // the override wins
    await flush();
    expect(engine.status().musicTheme).toBe('ocean');
    engine.setMusicTrack('theme');
    await flush();
    expect(engine.status().musicTheme).toBe('storybook');
  });

  it('only keeps the latest request when themes change faster than tracks load', async () => {
    const { engine } = engineWith();
    await engine.unlock();
    engine.setTheme('sakura');
    engine.setTheme('ocean');
    engine.setTheme('cosmic');
    await flush();
    const ctx = playbackContext();
    const playing = ctx.started.filter((s) => s.buffer?.name.startsWith('music/') && !s.stopped);
    expect(playing.map((s) => s.buffer!.name)).toEqual([realManifest.music.cosmic.file]);
    expect(engine.status().musicTheme).toBe('cosmic');
  });

  it('keeps playing when the theme changes away and back before the other track has loaded', async () => {
    const { engine } = engineWith();
    engine.setTheme('sakura');
    await engine.unlock();
    await flush();
    const ctx = playbackContext();
    engine.setTheme('ocean');
    engine.setTheme('sakura');
    await flush();
    const music = ctx.started.filter((s) => s.buffer?.name.startsWith('music/'));
    expect(music.map((s) => s.buffer!.name)).toEqual([realManifest.music.sakura.file]);
    expect(music[0]!.stopped).toBe(false);
    expect(engine.status().musicTheme).toBe('sakura');
  });

  it('rotates effect variants, varies pitch slightly and picks the theme specific jingle', async () => {
    const { engine, clock } = engineWith();
    engine.setTheme('ocean');
    await engine.unlock();
    await flush();
    const ctx = playbackContext();
    const played: string[] = [];
    const rates: number[] = [];
    for (let i = 0; i < 12; i++) {
      clock.now += 100;
      engine.playSfx('plush_land');
      const s = ctx.started.at(-1)!;
      played.push(s.buffer!.name);
      rates.push(s.playbackRate.value);
      ctx.finishOneShots();
    }
    expect(new Set(played).size).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1]);
    expect(new Set(rates.map((r) => r.toFixed(4))).size).toBeGreaterThan(6);
    for (const r of rates) expect(Math.abs(r - 1)).toBeLessThan(0.08);

    clock.now += 100;
    engine.playSfx('win');
    expect(ctx.started.at(-1)!.buffer!.name).toBe('sfx/win_ocean.wav');
    engine.setTheme('cosmic');
    clock.now += 100;
    engine.playSfx('theme_sting', { pan: -0.5, volume: 0.5, pitch: 1.2 });
    const sting = ctx.started.at(-1)!;
    expect(sting.buffer!.name).toBe('sfx/theme_sting_cosmic.wav');
    expect(sting.playbackRate.value).toBeCloseTo(1.2, 5);
    expect((sting.outputs[0] as FakeGain).gain.value).toBeCloseTo(0.5 * realManifest.sfx.theme_sting.gain, 5);
  });

  it('never stacks rapid re-triggers or unlimited voices of one effect', async () => {
    const { engine, clock } = engineWith();
    await engine.unlock();
    await flush();
    const ctx = playbackContext();
    const before = ctx.started.length;
    for (let i = 0; i < 50; i++) engine.playSfx('dir_tick'); // same instant
    expect(ctx.started.length - before).toBe(1);
    for (let i = 0; i < 30; i++) {
      clock.now += 40;
      engine.playSfx('dir_tick');
    }
    expect(ctx.started.length - before).toBeLessThanOrEqual(4); // per-effect voice cap
    ctx.finishOneShots();
    clock.now += 40;
    engine.playSfx('dir_tick');
    expect(ctx.started.at(-1)!.buffer!.name).toMatch(/dir_tick/);
  });

  it('keeps exactly one source per motor loop, follows level and pitch, and stops cleanly', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { engine, clock } = engineWith();
    await engine.unlock();
    await flush();
    const ctx = playbackContext();
    const file = realManifest.loops.motor_trolley.file;
    for (let frame = 0; frame < 120; frame++) {
      clock.now += 16;
      engine.setLoop('motor_trolley', 0.5 + 0.4 * Math.sin(frame / 10), 1 + frame / 400);
    }
    const loops = ctx.liveLoops(file);
    expect(loops).toHaveLength(1);
    const gain = loops[0]!.outputs[0] as FakeGain;
    expect(gain.gain.value).toBeGreaterThan(0);
    expect(gain.gain.value).toBeLessThanOrEqual(realManifest.loops.motor_trolley.gain);
    expect(loops[0]!.playbackRate.value).toBeCloseTo(1 + 119 / 400, 5);
    // Level 0 fades first (no hard stop), then the source is released.
    clock.now += 16;
    engine.setLoop('motor_trolley', 0);
    expect(gain.gain.value).toBe(0);
    expect(ctx.liveLoops(file)).toHaveLength(1);
    for (let i = 0; i < 5; i++) {
      clock.now += 120;
      engine.setLoop('motor_trolley', 0);
      vi.advanceTimersByTime(120);
    }
    expect(ctx.liveLoops(file)).toHaveLength(0);
    // Starting again creates one fresh source.
    clock.now += 16;
    engine.setLoop('motor_trolley', 0.7);
    expect(ctx.liveLoops(file)).toHaveLength(1);
  });

  it('fades out a loop the game stopped updating (watchdog)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { engine, clock } = engineWith();
    await engine.unlock();
    await flush();
    const ctx = playbackContext();
    engine.setLoop('motor_winch', 1);
    expect(ctx.liveLoops(realManifest.loops.motor_winch.file)).toHaveLength(1);
    for (let i = 0; i < 12; i++) {
      clock.now += 120;
      vi.advanceTimersByTime(120);
    }
    expect(ctx.liveLoops(realManifest.loops.motor_winch.file)).toHaveLength(0);
  });

  it('ducks the music while a voice plays, lets only one voice speak, and restores afterwards', async () => {
    const { engine } = engineWith();
    engine.setVolumes(VOL);
    engine.setTheme('sakura');
    await engine.unlock();
    await flush();
    const ctx = playbackContext();
    const duck = ctx.gains[BUS.duck]!;
    expect(duck.gain.value).toBe(1);
    expect(engine.voiceBus()!.input).toBe(ctx.gains[BUS.voice]);

    const bytes = new TextEncoder().encode('voice-one').buffer as ArrayBuffer;
    const first = engine.playVoice(bytes, { volume: 0.8, rate: 1.1 });
    expect(duck.gain.value).toBeCloseTo(0.4); // 1 - ducking, already before decoding finished
    await flush();
    expect(bytes.byteLength).toBeGreaterThan(0); // the caller's buffer was not detached
    const v1 = ctx.started.find((s) => s.buffer?.name === 'voice-one')!;
    expect(v1.playbackRate.value).toBeCloseTo(1.1);
    expect((v1.outputs[0] as FakeGain).outputs[0]).toBe(ctx.gains[BUS.voice]);

    let firstDone = false;
    void first.done.then(() => {
      firstDone = true;
    });
    const second = engine.playVoice(new TextEncoder().encode('voice-two').buffer as ArrayBuffer);
    await flush();
    expect(firstDone).toBe(true);
    expect(v1.stopped).toBe(true);
    expect(duck.gain.value).toBeCloseTo(0.4);
    const v2 = ctx.started.find((s) => s.buffer?.name === 'voice-two')!;
    let secondDone = false;
    void second.done.then(() => {
      secondDone = true;
    });
    v2.end();
    await flush();
    expect(secondDone).toBe(true);
    expect(duck.gain.value).toBe(1);

    // Manual hold for synthesised voices.
    engine.setVoiceActive(true);
    expect(duck.gain.value).toBeCloseTo(0.4);
    engine.stopVoice();
    expect(duck.gain.value).toBe(1);

    // An undecodable voice resolves and releases the duck.
    FakeContext.broken.add('bad-voice');
    const bad = engine.playVoice(new TextEncoder().encode('bad-voice').buffer as ArrayBuffer);
    await bad.done;
    expect(duck.gain.value).toBe(1);
  });

  it('drops sounds while suspended instead of queueing them, and resumes', async () => {
    const { engine, clock } = engineWith();
    engine.setTheme('sakura');
    await engine.unlock();
    await flush();
    const ctx = playbackContext();
    engine.setLoop('motor_trolley', 1);
    const voice = engine.playVoice(new TextEncoder().encode('line').buffer as ArrayBuffer);
    engine.playSfx('win');
    const ringing = ctx.started.at(-1)!;
    await flush();
    engine.suspend();
    await flush();
    expect(engine.status().state).toBe('suspended');
    expect(ctx.state).toBe('suspended');
    await voice.done; // voices never carry over a pause
    expect(ringing.stopped).toBe(true); // nor does the tail of an effect
    expect(ctx.liveLoops(realManifest.loops.motor_trolley.file)).toHaveLength(0);
    const before = ctx.started.length;
    clock.now += 500;
    engine.playSfx('win');
    engine.setLoop('motor_trolley', 1);
    const dropped = engine.playVoice(new TextEncoder().encode('late').buffer as ArrayBuffer);
    await dropped.done;
    expect(ctx.started.length).toBe(before);
    engine.resume();
    await flush();
    expect(engine.status().state).toBe('running');
    expect(ctx.started.length).toBe(before); // nothing was replayed
    clock.now += 500;
    engine.playSfx('win');
    expect(ctx.started.length).toBe(before + 1);
  });

  it('stays suspended when unlock() finishes while the page is hidden', async () => {
    const { engine } = engineWith({}, false);
    engine.setTheme('sakura');
    const unlocking = engine.unlock();
    engine.suspend();
    await unlocking;
    await flush();
    expect(engine.status().state).toBe('suspended');
    expect(playbackContext().state).toBe('suspended');
    engine.resume();
    await flush();
    expect(engine.status().state).toBe('running');
    expect(engine.status().musicTheme).toBe('sakura');
  });

  it('previews a track and returns to the main music', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { engine } = engineWith();
    engine.setTheme('sakura');
    const unlocking = engine.unlock();
    await vi.advanceTimersByTimeAsync(10);
    await unlocking;
    await vi.advanceTimersByTimeAsync(10);
    const ctx = playbackContext();
    engine.previewTrack('ocean');
    await vi.advanceTimersByTimeAsync(10);
    const preview = ctx.started.find((s) => s.buffer?.name === realManifest.music.ocean.file)!;
    expect(preview).toBeDefined();
    expect((preview.outputs[0] as FakeGain).outputs[0]).toBe(ctx.gains[BUS.preview]);
    expect(ctx.gains[BUS.musicMain]!.gain.value).toBe(0);
    expect(engine.status().musicTheme).toBe('sakura'); // the game's music is unchanged
    await vi.advanceTimersByTimeAsync(13_000); // previews end by themselves
    expect(preview.stopped).toBe(true);
    expect(ctx.gains[BUS.musicMain]!.gain.value).toBe(1);
    engine.previewTrack('cosmic');
    await vi.advanceTimersByTimeAsync(10);
    engine.previewTrack(null);
    expect(ctx.gains[BUS.musicMain]!.gain.value).toBe(1);
  });

  it('releases everything on dispose', async () => {
    const { engine } = engineWith({ worker: true });
    engine.setTheme('sakura');
    await engine.unlock();
    await flush();
    const ctx = playbackContext();
    engine.setLoop('motor_trolley', 1);
    engine.dispose();
    await flush();
    expect(ctx.state).toBe('closed');
    expect(ctx.liveLoops(realManifest.loops.motor_trolley.file)).toHaveLength(0);
    engine.playSfx('win');
    engine.setTheme('ocean');
    await engine.unlock();
    expect(FakeContext.instances.filter((c) => c.gains.length >= 7)).toHaveLength(1);
  });
});

describe('AudioEngine: fallback synthesiser', () => {
  it('synthesises everything when the manifest is missing and says so', async () => {
    const { engine, clock } = engineWith({ manifest: null, worker: true });
    engine.setTheme('ocean');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    expect(FakeWorker.created).toBe(1);
    expect(engine.status()).toMatchObject({ state: 'running', usingFallbackSynth: true, musicTheme: 'ocean' });
    expect(engine.status().detail).toMatch(/synthesiser/);
    const before = ctx.started.length;
    clock.now += 100;
    engine.playSfx('grab_confirm');
    engine.setLoop('motor_winch', 0.5);
    expect(ctx.started.length).toBe(before + 2);
    const music = ctx.started.find((s) => s.loop && s.loopEnd === 2.25)!;
    expect(music.loopStart).toBe(0.25);
  });

  it('re-renders after the first gesture when buffers could not be created earlier', async () => {
    // Node has no AudioBuffer constructor, like browsers that only build buffers through a context.
    const { engine, clock } = engineWith({ manifest: null, worker: true });
    await flush(30); // preload: the worker delivered samples but there is no context yet
    expect(FakeContext.instances.filter((c) => c.gains.length > 0)).toHaveLength(0);
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    expect(engine.status()).toMatchObject({ state: 'running', usingFallbackSynth: true });
    expect(engine.status().detail).not.toMatch(/unavailable/);
    clock.now += 100;
    const before = ctx.started.length;
    engine.playSfx('start_game');
    expect(ctx.started.length).toBe(before + 1);
  });

  it('synthesises only the files that failed to load or decode', async () => {
    const brokenLoop = realManifest.loops.motor_winch.file;
    const { engine, clock } = engineWith({ missing: ['sfx/ui_click_1.wav', realManifest.music.ocean.file], broken: [brokenLoop], worker: true });
    engine.setTheme('ocean');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    expect(engine.status()).toMatchObject({ state: 'running', usingFallbackSynth: true, musicTheme: 'ocean' });
    expect(engine.status().detail).toMatch(/3 sound file/);
    engine.setLoop('motor_winch', 1);
    expect(ctx.started.filter((s) => s.loop && s.buffer?.name === 'synth' && !s.stopped).length).toBeGreaterThanOrEqual(1);
    // Every click variant is playable, including the synthesised one.
    const names = new Set<string>();
    for (let i = 0; i < 12; i++) {
      clock.now += 100;
      engine.playSfx('ui_click');
      names.add(ctx.started.at(-1)!.buffer!.name);
      ctx.finishOneShots();
    }
    expect(names.has('synth')).toBe(true);
    expect(names.size).toBe(3);
  });

  it('renders effects on the main thread when no worker can be created; music is reported unavailable', async () => {
    const { engine, clock } = engineWith({ manifest: null, worker: false });
    engine.setTheme('sakura');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    expect(engine.status()).toMatchObject({ state: 'running', usingFallbackSynth: true, musicTheme: null });
    expect(engine.status().detail).toMatch(/music unavailable: sakura/);
    const before = ctx.started.length;
    clock.now += 100;
    engine.playSfx('prize_out');
    expect(ctx.started.length).toBe(before + 1);
  }, 30_000);

  it('decodes after the first gesture when nothing can decode earlier', async () => {
    const { engine, clock } = engineWith({ offline: false });
    await flush(20); // preload finishes with raw bytes only
    await engine.unlock();
    await flush();
    const ctx = playbackContext();
    expect(engine.status()).toMatchObject({ state: 'running', usingFallbackSynth: false });
    clock.now += 100;
    engine.playSfx('ui_open');
    expect(ctx.started.at(-1)!.buffer!.name).toBe('sfx/ui_open_1.wav');
  });
});

describe('AudioEngine: output devices', () => {
  it('explains when the browser cannot choose an output device', async () => {
    const { engine } = engineWith();
    const list = await engine.listOutputDevices();
    expect(list.supported).toBe(false);
    expect(list.reason).toMatch(/setSinkId/);
    expect((await engine.setOutputDevice('x')).ok).toBe(false);
    expect(engine.status().outputDeviceSupported).toBe(false);
  });

  it('lists outputs and applies the chosen sink, also when chosen before unlock', async () => {
    const made = makeEnv({ sink: true });
    const engine = createAudioEngine({
      env: {
        ...made.env,
        mediaDevices: {
          enumerateDevices: async () =>
            [
              { kind: 'audioinput', deviceId: 'mic', label: 'Mic', groupId: '', toJSON: () => ({}) },
              { kind: 'audiooutput', deviceId: 'default', label: '', groupId: '', toJSON: () => ({}) },
              { kind: 'audiooutput', deviceId: 'hdmi', label: 'HDMI', groupId: '', toJSON: () => ({}) },
            ] as MediaDeviceInfo[],
        },
      },
    });
    engines.push(engine);
    expect(engine.status().outputDeviceSupported).toBe(true);
    const list = await engine.listOutputDevices();
    expect(list.supported).toBe(true);
    expect(list.devices).toEqual([
      { id: 'default', label: 'System default' },
      { id: 'hdmi', label: 'HDMI' },
    ]);
    expect((await engine.setOutputDevice('hdmi')).ok).toBe(true); // remembered
    await engine.unlock();
    await flush();
    const ctx = playbackContext() as FakeContextWithSink;
    expect(ctx.sink).toBe('hdmi');
    expect(await engine.setOutputDevice('bad')).toMatchObject({ ok: false });
    expect((await engine.setOutputDevice('default')).ok).toBe(true);
    expect(ctx.sink).toBe('');
  });
});
