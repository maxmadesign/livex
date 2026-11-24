/**
 * Runtime audio engine (Web Audio). Implements the AudioPort contract:
 * buses (master / music / sfx / voice), studio music play-lists (two takes per
 * theme, equal-power cross-fades on the beat) or gapless looping synthesised
 * music, theme cross-fades, variant-rotating one-shots with an optional studio
 * layer, tier-aware win stingers, character voices, smooth motor loops, a voice
 * bus that ducks the music, tab suspend / resume and output-device selection.
 *
 * Assets come from public/audio (see manifest.json). Studio recordings (the
 * manifest's `studio` section) load per theme; whatever of them cannot be loaded
 * falls back to the synthesised set. If the manifest or a synthesised file cannot
 * be loaded, the same sounds are synthesised in a Worker from the code that
 * produced the files, and `status().usingFallbackSynth` is set.
 */
import {
  LOOP_NAMES,
  SFX_NAMES,
  type AudioPort,
  type AudioState,
  type AudioStatus,
  type AudioVolumes,
  type CharacterMoment,
  type LoopName,
  type SfxName,
  type SfxOptions,
  type VoiceHandle,
  type WinTier,
} from '../core/contracts';
import { THEME_IDS, type ThemeId, type Unsubscribe } from '../core/types';
import { parseStudioManifest, studioSharedFiles, studioThemeFiles, themeOfCharacter, type StudioManifest } from './studio/manifest';
import { CHARACTER_DUCK, CooldownGate, SHORT_VOICE_S, WIN_DUCK, attractChimeDelayMs, characterVoicing, squeakPitch, winPlan } from './studio/moments';
import { StudioPlayer } from './studio/playlist';
import { parseAudioManifest, type AudioManifest } from './synth/manifest';
import type { SynthRequest, SynthResponse } from './synthWorker';

/* ------------------------------------------------------------- environment */

type SynthRequestBody = { type: 'describe' } | { type: 'render'; files: string[] };
type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;
type OfflineContextCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/** Everything the engine needs from the browser; injectable so the logic can be unit tested. */
export interface AudioEnv {
  AudioContextCtor: AudioContextCtor | null;
  OfflineContextCtor: OfflineContextCtor | null;
  fetch: ((url: string) => Promise<Response>) | null;
  /** Creates the fallback synth worker; null when workers are unavailable. */
  createWorker: (() => Worker) | null;
  mediaDevices: Pick<MediaDevices, 'enumerateDevices'> | null;
  now: () => number;
  random: () => number;
}

export interface AudioEngineOptions {
  /** Base URL of the audio assets, default "/audio/". */
  baseUrl?: string;
  /** Start fetching the manifest and effects immediately (default true). */
  preload?: boolean;
  env?: Partial<AudioEnv>;
}

function defaultEnv(): AudioEnv {
  const g = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
    OfflineAudioContext?: OfflineContextCtor;
    webkitOfflineAudioContext?: OfflineContextCtor;
    fetch?: typeof fetch;
    Worker?: typeof Worker;
    navigator?: Navigator;
  };
  return {
    AudioContextCtor: g.AudioContext ?? g.webkitAudioContext ?? null,
    OfflineContextCtor: g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null,
    fetch: typeof g.fetch === 'function' ? (url: string) => g.fetch!(url) : null,
    createWorker:
      typeof g.Worker === 'function' ? () => new Worker(new URL('./synthWorker.ts', import.meta.url), { type: 'module' }) : null,
    mediaDevices: g.navigator?.mediaDevices ?? null,
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    random: Math.random,
  };
}

/* ----------------------------------------------------------------- tunables */

const MUSIC_FADE = 1.3;
const MUSIC_FADE_FAST = 0.08;
const PREVIEW_SECONDS = 12;
const MAX_CACHED_TRACKS = 2;
const MAX_ACTIVE_SFX = 28;
const MAX_ACTIVE_PER_NAME = 4;
const MIN_RETRIGGER_MS = 28;
const LOOP_SILENCE_STOP_MS = 320;
const LOOP_WATCHDOG_MS = 420;
const DUCK_ATTACK = 0.07;
const DUCK_RELEASE = 0.3;
const DUCK_HOLD = 0.12;
const DEFAULT_VOLUMES: AudioVolumes = { master: 0.8, music: 0.55, sfx: 0.8, voice: 0.9, muted: false, ducking: 0.6 };
/** Attract chime level (relative to a full-level effect). */
const ATTRACT_CHIME_VOLUME = 0.45;
/** Themes whose studio one-shots (stingers, voices) stay decoded: the current and the previous one. */
const MAX_STUDIO_THEMES = 2;

interface MusicBuffer {
  buffer: AudioBuffer;
  loopStart: number;
  loopEnd: number;
}

interface PlayingTrack {
  theme: ThemeId;
  /** Theme-level gain (theme cross-fades). */
  gain: GainNode;
  /** Synthesised looping track. */
  source: AudioBufferSourceNode | null;
  /** Studio play-list. */
  player: StudioPlayer | null;
}

interface LoopVoice {
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  level: number;
  lastCall: number;
  silentSince: number | null;
}

/** A started one-shot: its source and its own gain (for an interrupting fade). */
interface OneShot {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const errorText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
/** Studio recordings live under studio/; everything else is the synthesised set. */
const isStudioFile = (file: string) => file.startsWith('studio/');

class AudioEngine implements AudioPort {
  private readonly env: AudioEnv;
  private readonly baseUrl: string;
  private readonly listeners = new Set<(status: AudioStatus) => void>();
  private st: AudioStatus;
  private disposed = false;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicDuck: GainNode | null = null;
  private musicMain: GainNode | null = null;
  private previewBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private voiceBus_: GainNode | null = null;
  /** Turns the music down under win stingers (separate from the voice duck). */
  private stingerDuck: GainNode | null = null;

  private volumes: AudioVolumes = { ...DEFAULT_VOLUMES };
  private wantSuspended = false;
  private desiredSink: string | null = null;

  // Assets.
  private manifest: AudioManifest | null = null;
  private preparing: Promise<void> | null = null;
  private prepared = false;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly pendingBytes = new Map<string, ArrayBuffer>();
  private offline: OfflineAudioContext | null = null;
  /** Files whose synthesised samples could not become an AudioBuffer yet (no context before the first gesture). */
  private readonly deferredSynth = new Set<string>();
  private readonly failedFiles = new Set<string>();
  private readonly musicCache = new Map<ThemeId, MusicBuffer>();
  private readonly musicLoading = new Map<ThemeId, Promise<MusicBuffer | null>>();
  private loadDetail = '';

  // Fallback synth.
  private manifestSynthesised = false;
  private readonly synthesisedFiles = new Set<string>();
  private readonly musicUnavailable = new Set<ThemeId>();
  private worker: Worker | null = null;
  private workerBroken = false;
  private workerSeq = 0;
  private readonly workerCalls = new Map<number, (msg: SynthResponse) => void>();

  // Music.
  private theme: ThemeId | null = null;
  private trackOverride: ThemeId | 'theme' = 'theme';
  private playing: PlayingTrack | null = null;
  private musicToken = 0;
  private musicTarget: ThemeId | null = null;
  private preview: { source: AudioBufferSourceNode; gain: GainNode; timer: ReturnType<typeof setTimeout> } | null = null;
  private previewToken = 0;

  // Studio recordings.
  private studio: StudioManifest | null = null;
  /** Encoded music takes (fetched once, decoded on demand). */
  private readonly studioBytes = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly studioDecoded = new Map<string, AudioBuffer>();
  private readonly studioDecoding = new Map<string, Promise<AudioBuffer | null>>();
  /** Studio files that could not be fetched or decoded (their synthesised counterpart plays instead). */
  private readonly studioFailed = new Set<string>();
  /** Themes whose studio one-shots are loaded / loading, most recent last. */
  private readonly studioThemes = new Map<ThemeId, Promise<void>>();
  private readonly studioMusicFailed = new Set<ThemeId>();
  /** Synthesised effects that were skipped because a studio sample replaces them. */
  private readonly replacedSynth = new Set<SfxName>();
  private previewHeld: string | null = null;
  private winUntil = 0;
  private readonly characterGate = new CooldownGate();
  /** What each character is saying right now (cut short when it escalates to a more important moment). */
  private readonly characterVoices = new Map<string, OneShot[]>();
  private attractActive = false;
  private attractChimeEnabled = true;
  private attractTimer: ReturnType<typeof setTimeout> | null = null;

  // One-shots and loops.
  private readonly lastVariant = new Map<string, number>();
  private readonly lastTrigger = new Map<string, number>();
  private readonly activeByName = new Map<string, number>();
  private activeSfx = 0;
  private readonly activeSources = new Set<AudioBufferSourceNode>();
  private readonly loops = new Map<LoopName, LoopVoice>();
  private loopTimer: ReturnType<typeof setInterval> | null = null;

  // Voice.
  private voiceToken = 0;
  private voiceSource: AudioBufferSourceNode | null = null;
  private voiceResolve: (() => void) | null = null;
  private voicePlaying = false;
  private voiceManual = false;

  constructor(options: AudioEngineOptions = {}) {
    this.env = { ...defaultEnv(), ...options.env };
    let base = options.baseUrl ?? '/audio/';
    if (!base.endsWith('/')) base += '/';
    this.baseUrl = base;
    this.st = {
      state: 'locked',
      detail: 'waiting for a user gesture',
      usingFallbackSynth: false,
      musicTheme: null,
      outputDeviceSupported: this.sinkSupported(),
    };
    if (options.preload !== false && this.env.fetch) void this.prepare();
  }

  /* ---------------------------------------------------------------- status */

  status(): AudioStatus {
    return { ...this.st };
  }

  subscribe(listener: (status: AudioStatus) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setStatus(patch: Partial<AudioStatus>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof AudioStatus)[]) {
      if (this.st[key] !== patch[key]) changed = true;
    }
    if (!changed) return;
    this.st = { ...this.st, ...patch };
    const snapshot = this.status();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('[audio] status listener threw', error);
      }
    }
  }

  private setState(state: AudioState, detail: string): void {
    this.setStatus({ state, detail });
  }

  private sinkSupported(): boolean {
    const Ctor = this.env.AudioContextCtor;
    return !!Ctor && typeof (Ctor.prototype as unknown as { setSinkId?: unknown }).setSinkId === 'function';
  }

  /* ---------------------------------------------------------------- unlock */

  async unlock(): Promise<void> {
    if (this.disposed) return;
    if (!this.env.AudioContextCtor) {
      this.setState('failed', 'Web Audio API is not available in this browser');
      return;
    }
    if (!this.ctx) {
      try {
        this.createGraph();
      } catch (error) {
        this.setState('failed', `could not create an AudioContext (${errorText(error)})`);
        return;
      }
    }
    const ctx = this.ctx!;
    // resume() has to be issued inside the user gesture, i.e. before the first await.
    let resumeError: string | null = null;
    if (ctx.state !== 'running' && !this.wantSuspended) {
      try {
        this.kickSilentBuffer();
        await Promise.race([ctx.resume(), new Promise<void>((resolve) => setTimeout(resolve, 1500))]);
      } catch (error) {
        resumeError = errorText(error);
      }
    }
    if (this.disposed) return;
    if (ctx.state === 'closed') {
      this.setState('failed', 'the AudioContext was closed');
      return;
    }
    if (ctx.state !== 'running' && !this.wantSuspended) {
      this.setState('locked', `the browser has not allowed audio yet${resumeError ? ` (${resumeError})` : ''}: tap or click to enable sound`);
      return;
    }
    if (!this.prepared) this.setState('loading', this.loadDetail || 'loading sounds');
    await this.prepare();
    if (this.disposed) return;
    await this.decodePending();
    this.refreshRunState();
    void this.applyMusic(false);
  }

  /** iOS only fully unlocks output once a buffer source was started inside the gesture. */
  private kickSilentBuffer(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* not fatal */
    }
  }

  private createGraph(): void {
    const Ctor = this.env.AudioContextCtor!;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const master = ctx.createGain();
    // Gentle safety limiter so stacked effects can never clip the output.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    const musicBus = ctx.createGain();
    const musicDuck = ctx.createGain();
    const musicMain = ctx.createGain();
    const previewBus = ctx.createGain();
    musicMain.connect(musicDuck);
    previewBus.connect(musicDuck);
    const sfxBus = ctx.createGain();
    sfxBus.connect(master);
    const voiceBus = ctx.createGain();
    voiceBus.connect(master);
    // Created last so the bus order above stays stable: music → duck → stinger duck → music bus.
    const stingerDuck = ctx.createGain();
    musicDuck.connect(stingerDuck);
    stingerDuck.connect(musicBus);
    musicBus.connect(master);
    this.stingerDuck = stingerDuck;
    this.master = master;
    this.musicBus = musicBus;
    this.musicDuck = musicDuck;
    this.musicMain = musicMain;
    this.previewBus = previewBus;
    this.sfxBus = sfxBus;
    this.voiceBus_ = voiceBus;
    this.applyVolumes(true);
    ctx.onstatechange = () => this.onContextState();
    if (this.desiredSink !== null) void this.setOutputDevice(this.desiredSink);
  }

  private onContextState(): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    if (ctx.state === 'closed') {
      this.setState('failed', 'the AudioContext was closed');
    } else if (ctx.state === 'suspended' && this.st.state === 'running') {
      this.setState('suspended', this.wantSuspended ? 'suspended while the page is hidden' : 'interrupted by the system; interact to resume');
    } else if (ctx.state === 'running' && (this.st.state === 'suspended' || this.st.state === 'locked')) {
      if (this.prepared && !this.wantSuspended) {
        this.refreshRunState();
        void this.applyMusic(false);
      }
    }
  }

  private refreshRunState(): void {
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    if (ctx.state === 'closed') return;
    if (this.wantSuspended || ctx.state !== 'running') {
      if (this.wantSuspended && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
      this.setState('suspended', this.wantSuspended ? 'suspended while the page is hidden' : 'waiting for the browser to resume audio');
      return;
    }
    if (!this.manifest) {
      this.setState('failed', this.loadDetail || 'no audio assets could be loaded');
      return;
    }
    const missing = this.missingEffects();
    let detail = 'running';
    if (this.st.usingFallbackSynth) {
      detail = this.manifestSynthesised
        ? 'running on the built-in synthesiser (the audio files could not be loaded)'
        : `running; ${this.synthesisedFiles.size} sound file(s) could not be loaded and are synthesised instead`;
    }
    if (missing.length) detail += `; unavailable: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`;
    if (this.musicUnavailable.size) detail += `; music unavailable: ${[...this.musicUnavailable].join(', ')}`;
    if (this.studio) {
      detail += this.playing?.player ? '; studio music' : this.playing ? '; synthesised music' : '';
      if (this.studioMusicFailed.size) detail += `; studio music unavailable for ${[...this.studioMusicFailed].join(', ')} (synthesised track instead)`;
      if (this.studioFailed.size) detail += `; ${this.studioFailed.size} studio file(s) not loaded`;
    }
    this.setState('running', detail);
  }

  private missingEffects(): string[] {
    const m = this.manifest;
    if (!m) return [...SFX_NAMES, ...LOOP_NAMES];
    const out: string[] = [];
    const has = (files: string[] | undefined) => !!files && files.some((f) => this.buffers.has(f));
    for (const name of SFX_NAMES) if (!has(m.sfx[name].files) && !has(this.studio?.sfx[name]?.files)) out.push(name);
    for (const name of LOOP_NAMES) {
      const studioLoop = this.studio?.loops[name];
      if (!this.buffers.has(m.loops[name].file) && !(studioLoop && this.buffers.has(studioLoop.file))) out.push(name);
    }
    return out;
  }

  /* ---------------------------------------------------------------- assets */

  private url(file: string): string {
    return this.baseUrl + file;
  }

  /** Loads the manifest and every effect / loop. Safe to call repeatedly. */
  private prepare(): Promise<void> {
    if (!this.preparing) {
      this.preparing = this.prepareInner().catch((error) => {
        console.error('[audio] preparing assets failed', error);
      }).then(() => {
        this.prepared = true;
      });
    }
    return this.preparing;
  }

  private async prepareInner(): Promise<void> {
    if (!this.env.AudioContextCtor) {
      this.loadDetail = 'Web Audio API is not available in this browser';
      return; // nothing could ever be played; do not download or render anything
    }
    let manifest: AudioManifest | null = null;
    let reason = '';
    if (this.env.fetch) {
      try {
        const res = await this.env.fetch(this.url('manifest.json'));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as unknown;
        const parsed = parseAudioManifest(json);
        manifest = parsed.manifest;
        if (!manifest) reason = parsed.problems.slice(0, 3).join('; ');
        else {
          const studio = parseStudioManifest((json as { studio?: unknown }).studio);
          if (studio.problems.length) console.warn(`[audio] studio section: ${studio.problems.slice(0, 4).join('; ')}`);
          this.studio = studio.studio;
        }
      } catch (error) {
        reason = errorText(error);
      }
    } else {
      reason = 'fetch is not available';
    }
    if (this.disposed) return;
    if (!manifest) {
      console.warn(`[audio] manifest unavailable (${reason}); using the built-in synthesiser`);
      manifest = await this.describeFallback();
      if (!manifest) {
        this.loadDetail = `audio assets unavailable (${reason}) and the built-in synthesiser could not start`;
        return;
      }
      this.manifest = manifest;
      this.manifestSynthesised = true;
      this.setStatus({ usingFallbackSynth: true });
      await this.synthesise(this.effectFiles(manifest));
      return;
    }
    this.manifest = manifest;
    // Synthesised effects a studio sample replaces are only loaded if that sample fails.
    if (this.studio) {
      for (const name of SFX_NAMES) if (this.studio.sfx[name]?.mode === 'replace') this.replacedSynth.add(name);
    }
    const files = [...this.effectFiles(manifest), ...(this.studio ? studioSharedFiles(this.studio) : [])];
    await this.loadFiles(files, true);
    await this.backfillStudioFailures();
    if (this.failedFiles.size > 0 && !this.disposed) {
      const failed = [...this.failedFiles];
      const ok = await this.synthesise(failed);
      if (ok > 0) this.setStatus({ usingFallbackSynth: true });
    }
    if (this.theme) void this.ensureStudioTheme(this.theme);
  }

  /** Fetches and decodes files into `buffers` (six at a time); failures are recorded, never thrown. */
  private async loadFiles(files: string[], progress: boolean): Promise<void> {
    let done = 0;
    const queue = [...files];
    const worker = async () => {
      for (;;) {
        const file = queue.shift();
        if (file === undefined || this.disposed) return;
        try {
          const res = await this.env.fetch!(this.url(file));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const bytes = await res.arrayBuffer();
          const buffer = await this.decode(bytes);
          if (buffer) this.buffers.set(file, buffer);
          else this.pendingBytes.set(file, bytes);
        } catch (error) {
          if (isStudioFile(file)) this.studioFailed.add(file);
          else this.failedFiles.add(file);
          console.warn(`[audio] could not load ${file}: ${errorText(error)}`);
        }
        done++;
        if (!progress) continue;
        this.loadDetail = `loading sounds ${done}/${files.length}`;
        // Progress for a loading screen, without one notification per file.
        if (this.st.state === 'loading' && (done % 8 === 0 || done === files.length)) this.setStatus({ detail: this.loadDetail });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  /** A studio sample that replaces a synthesised effect failed: load (or synthesise) that effect after all. */
  private async backfillStudioFailures(): Promise<void> {
    const m = this.manifest;
    if (!m || !this.studio || this.studioFailed.size === 0) return;
    const files: string[] = [];
    for (const name of [...this.replacedSynth]) {
      const e = this.studio.sfx[name];
      if (!e || e.files.some((f) => !this.studioFailed.has(f))) continue;
      this.replacedSynth.delete(name);
      for (const f of this.synthFilesOf(m, name)) if (!this.buffers.has(f)) files.push(f);
    }
    for (const name of LOOP_NAMES) {
      const l = this.studio.loops[name];
      if (l && this.studioFailed.has(l.file) && !this.buffers.has(m.loops[name].file)) files.push(m.loops[name].file);
    }
    if (files.length === 0) return;
    await this.loadFiles(files, false);
  }

  private synthFilesOf(manifest: AudioManifest, name: SfxName): string[] {
    const e = manifest.sfx[name];
    const files = new Set<string>(e.files);
    if (e.themes) for (const theme of THEME_IDS) for (const f of e.themes[theme] ?? []) files.add(f);
    return [...files];
  }

  private effectFiles(manifest: AudioManifest): string[] {
    const files = new Set<string>();
    for (const name of SFX_NAMES) {
      if (this.replacedSynth.has(name)) continue;
      for (const f of this.synthFilesOf(manifest, name)) files.add(f);
    }
    for (const name of LOOP_NAMES) {
      // The synthesised motor stays loaded only where no studio loop replaces it.
      if (this.studio?.loops[name]) continue;
      files.add(manifest.loops[name].file);
    }
    return [...files];
  }

  /* ------------------------------------------------------- studio assets */

  /**
   * Loads a theme's studio one-shots (win / jackpot stingers, character voices) and starts
   * fetching its music takes. Only the current and the previous theme stay in memory.
   */
  private ensureStudioTheme(theme: ThemeId): Promise<void> {
    const existing = this.studioThemes.get(theme);
    if (existing) {
      // Most recent last.
      this.studioThemes.delete(theme);
      this.studioThemes.set(theme, existing);
      return existing;
    }
    const loading = (async () => {
      await this.prepare();
      const studio = this.studio;
      if (!studio || this.disposed) return;
      const { music, oneShots } = studioThemeFiles(studio, theme);
      // The first take first: it is what plays when the theme starts.
      for (const file of music) void this.fetchStudioBytes(file);
      await this.loadFiles(oneShots.filter((f) => !this.buffers.has(f)), false);
    })();
    this.studioThemes.set(theme, loading);
    // Forget themes beyond the newest two (their stingers and voices); never the selected or playing one.
    for (const old of [...this.studioThemes.keys()]) {
      if (this.studioThemes.size <= MAX_STUDIO_THEMES) break;
      if (old === theme || old === this.theme || old === this.playing?.theme) continue;
      this.studioThemes.delete(old);
      if (this.studio) {
        const files = studioThemeFiles(this.studio, old);
        for (const f of files.oneShots) this.buffers.delete(f);
        for (const f of files.music) {
          this.studioBytes.delete(f);
          if (!this.studioFileInUse(f)) this.studioDecoded.delete(f);
        }
      }
    }
    return loading;
  }

  private fetchStudioBytes(file: string): Promise<ArrayBuffer | null> {
    let p = this.studioBytes.get(file);
    if (!p) {
      p = (async () => {
        if (!this.env.fetch) return null;
        try {
          const res = await this.env.fetch(this.url(file));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.arrayBuffer();
        } catch (error) {
          this.studioFailed.add(file);
          console.warn(`[audio] could not load ${file}: ${errorText(error)}`);
          return null;
        }
      })();
      this.studioBytes.set(file, p);
    }
    return p;
  }

  /** Decodes a studio music take with the live context (null when it cannot be had). */
  private decodeStudioTake(file: string): Promise<AudioBuffer | null> {
    const done = this.studioDecoded.get(file);
    if (done) return Promise.resolve(done);
    if (this.studioFailed.has(file)) return Promise.resolve(null);
    let p = this.studioDecoding.get(file);
    if (!p) {
      p = (async () => {
        const bytes = await this.fetchStudioBytes(file);
        const ctx = this.ctx;
        if (!bytes || !ctx || this.disposed) return null;
        try {
          const buffer = await ctx.decodeAudioData(bytes.slice(0));
          this.studioDecoded.set(file, buffer);
          return buffer;
        } catch (error) {
          this.studioFailed.add(file);
          console.warn(`[audio] could not decode ${file}: ${errorText(error)}`);
          return null;
        }
      })().finally(() => this.studioDecoding.delete(file));
      this.studioDecoding.set(file, p);
    }
    return p;
  }

  private studioFileInUse(file: string): boolean {
    if (file === this.previewHeld) return true;
    const p = this.playing?.player;
    if (!p || !this.studio || !this.playing) return false;
    const takes = this.studio.music[this.playing.theme]?.takes ?? [];
    return takes.some((t, i) => t.file === file && (p.currentTake === i || this.studioDecoding.has(file)));
  }

  /** Decoded takes are large (≈45 MB for two minutes); drop the ones nothing plays. */
  private releaseStudioTake(file: string): void {
    if (!this.studioFileInUse(file)) this.studioDecoded.delete(file);
  }

  /** Decodes with the live context, or with an offline context before the first gesture. */
  private async decode(bytes: ArrayBuffer): Promise<AudioBuffer | null> {
    const copy = bytes.slice(0); // decodeAudioData detaches its input
    if (this.ctx && this.ctx.state !== 'closed') return this.ctx.decodeAudioData(copy);
    const Offline = this.env.OfflineContextCtor;
    if (Offline) {
      try {
        this.offline ??= new Offline(1, 1, 44100);
        return await this.offline.decodeAudioData(copy);
      } catch {
        return null; // try again with the real context after the first gesture
      }
    }
    return null;
  }

  /** Decodes files that were fetched before any context could decode them. */
  private async decodePending(): Promise<void> {
    if (!this.ctx) return;
    if (this.deferredSynth.size > 0) {
      const files = [...this.deferredSynth].filter((f) => !f.startsWith('music/'));
      this.deferredSynth.clear();
      await this.synthesise(files);
    }
    if (this.pendingBytes.size === 0) return;
    const entries = [...this.pendingBytes.entries()];
    this.pendingBytes.clear();
    const failed: string[] = [];
    await Promise.all(
      entries.map(async ([file, bytes]) => {
        try {
          this.buffers.set(file, await this.ctx!.decodeAudioData(bytes));
        } catch {
          if (isStudioFile(file)) this.studioFailed.add(file);
          else failed.push(file);
        }
      }),
    );
    // A studio sample that failed to decode brings its synthesised effect back (loaded now, with the context).
    await this.backfillStudioFailures();
    for (const f of this.failedFiles) if (!this.buffers.has(f) && !failed.includes(f)) failed.push(f);
    if (failed.length) {
      const ok = await this.synthesise(failed);
      if (ok > 0) this.setStatus({ usingFallbackSynth: true });
    }
  }

  private makeBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer | null {
    const length = channels[0]?.length ?? 0;
    if (length === 0) return null;
    let buffer: AudioBuffer | null = null;
    const Ctor = (globalThis as unknown as { AudioBuffer?: new (o: AudioBufferOptions) => AudioBuffer }).AudioBuffer;
    try {
      if (this.ctx) buffer = this.ctx.createBuffer(channels.length, length, sampleRate);
      else if (Ctor) buffer = new Ctor({ numberOfChannels: channels.length, length, sampleRate });
    } catch {
      buffer = null;
    }
    if (!buffer) return null;
    channels.forEach((data, c) => buffer!.copyToChannel(data as Float32Array<ArrayBuffer>, c));
    return buffer;
  }

  /* -------------------------------------------------------- fallback synth */

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.workerBroken || !this.env.createWorker) return null;
    try {
      const worker = this.env.createWorker();
      worker.onmessage = (ev: MessageEvent<SynthResponse>) => {
        const call = this.workerCalls.get(ev.data.id);
        if (call) call(ev.data);
      };
      worker.onerror = (ev) => {
        console.warn('[audio] synth worker failed', ev.message);
        this.workerBroken = true;
        for (const [id, call] of [...this.workerCalls]) call({ id, type: 'error', message: ev.message || 'worker error' });
        this.worker = null;
      };
      this.worker = worker;
      return worker;
    } catch (error) {
      console.warn(`[audio] could not start the synth worker: ${errorText(error)}`);
      this.workerBroken = true;
      return null;
    }
  }

  private workerRequest(req: SynthRequestBody, onMessage: (msg: SynthResponse) => void): Promise<boolean> {
    const worker = this.ensureWorker();
    if (!worker) return Promise.resolve(false);
    const id = ++this.workerSeq;
    return new Promise<boolean>((resolve) => {
      this.workerCalls.set(id, (msg) => {
        if (msg.type === 'done' || msg.type === 'describe' || msg.type === 'error') {
          this.workerCalls.delete(id);
          onMessage(msg);
          resolve(msg.type !== 'error');
        } else {
          onMessage(msg);
        }
      });
      worker.postMessage({ ...req, id } as SynthRequest);
    });
  }

  private async describeFallback(): Promise<AudioManifest | null> {
    let manifest: AudioManifest | null = null;
    const ok = await this.workerRequest({ type: 'describe' }, (msg) => {
      if (msg.type === 'describe') manifest = msg.manifest;
    });
    if (ok && manifest) return manifest;
    // No worker: fall back to the main thread for the (small) effects only.
    try {
      const mod = await import('./synth/fallbackManifest');
      return mod.buildSynthManifest();
    } catch {
      return null;
    }
  }

  /** Renders files with the synthesiser; returns how many buffers were produced. */
  private async synthesise(files: string[], onMusic?: (file: string, music: MusicBuffer) => void): Promise<number> {
    if (files.length === 0) return 0;
    let produced = 0;
    const accept = (file: string, channels: Float32Array[], sampleRate: number, loopStart?: number, loopEnd?: number) => {
      const buffer = this.makeBuffer(channels, sampleRate);
      if (!buffer) {
        if (!this.ctx) this.deferredSynth.add(file); // render again once a context exists
        return;
      }
      this.deferredSynth.delete(file);
      produced++;
      this.synthesisedFiles.add(file);
      if (loopStart !== undefined && loopEnd !== undefined && onMusic) onMusic(file, { buffer, loopStart, loopEnd });
      else this.buffers.set(file, buffer);
      this.failedFiles.delete(file);
    };
    const ok = await this.workerRequest({ type: 'render', files }, (msg) => {
      if (msg.type === 'file') accept(msg.file, msg.channels, msg.sampleRate, msg.loopStart, msg.loopEnd);
    });
    if (ok) return produced;
    if (produced > 0) return produced;
    // Main-thread fallback: effects only, one per timer tick. Music is too heavy to render here.
    try {
      const mod = await import('./synth/renderFile');
      for (const file of files) {
        if (this.disposed) break;
        if (file.startsWith('music/')) continue;
        const rendered = mod.renderFileByKey(file);
        if (rendered) accept(file, rendered.channels, rendered.sampleRate);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } catch (error) {
      console.warn(`[audio] main-thread synth fallback failed: ${errorText(error)}`);
    }
    return produced;
  }

  /* --------------------------------------------------------------- volumes */

  setVolumes(volumes: AudioVolumes): void {
    this.volumes = {
      master: clamp(volumes.master, 0, 1),
      music: clamp(volumes.music, 0, 1),
      sfx: clamp(volumes.sfx, 0, 1),
      voice: clamp(volumes.voice, 0, 1),
      muted: !!volumes.muted,
      ducking: clamp(volumes.ducking, 0, 1),
    };
    this.applyVolumes(false);
  }

  private applyVolumes(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const v = this.volumes;
    const set = (node: GainNode | null, value: number) => {
      if (!node) return;
      if (immediate) node.gain.value = value;
      else node.gain.setTargetAtTime(value, ctx.currentTime, 0.03);
    };
    set(this.master, v.muted ? 0 : v.master);
    set(this.musicBus, v.music);
    set(this.sfxBus, v.sfx);
    set(this.voiceBus_, v.voice);
    this.updateDuck(immediate);
  }

  private updateDuck(immediate = false, hold = 0): void {
    const ctx = this.ctx;
    const duck = this.musicDuck;
    if (!ctx || !duck) return;
    const active = this.voicePlaying || this.voiceManual;
    const target = active ? 1 - this.volumes.ducking : 1;
    if (immediate) {
      duck.gain.value = target;
      return;
    }
    const t = ctx.currentTime;
    duck.gain.cancelScheduledValues(t);
    duck.gain.setTargetAtTime(target, t + (active ? 0 : hold), (active ? DUCK_ATTACK : DUCK_RELEASE) / 3);
  }

  /* ----------------------------------------------------------------- music */

  setTheme(themeId: ThemeId, options?: { immediate?: boolean }): void {
    if (!(THEME_IDS as readonly string[]).includes(themeId)) return;
    this.theme = themeId;
    // Studio stingers, voices and the play-list are fetched for the selected theme only.
    if (this.env.fetch && (this.studio || !this.prepared)) void this.ensureStudioTheme(themeId);
    void this.applyMusic(!!options?.immediate);
  }

  setMusicTrack(track: ThemeId | 'theme'): void {
    if (track !== 'theme' && !(THEME_IDS as readonly string[]).includes(track)) return;
    this.trackOverride = track;
    void this.applyMusic(false);
  }

  private desiredTrack(): ThemeId | null {
    return this.trackOverride === 'theme' ? this.theme : this.trackOverride;
  }

  private canPlay(): boolean {
    return !this.disposed && !!this.ctx && this.ctx.state !== 'closed' && this.prepared && (this.st.state === 'running' || this.st.state === 'suspended');
  }

  private async applyMusic(immediate: boolean): Promise<void> {
    if (!this.canPlay()) return;
    const target = this.desiredTrack();
    if (target === this.musicTarget) return; // already playing or already being loaded
    this.musicTarget = target;
    const token = ++this.musicToken;
    if (target === null) {
      this.fadeOutPlaying(immediate ? MUSIC_FADE_FAST : MUSIC_FADE);
      this.setStatus({ musicTheme: null });
      return;
    }
    if (this.playing?.theme === target) {
      // Changed away and back before the other track had loaded: keep playing, do not restart.
      this.setStatus({ musicTheme: target });
      return;
    }
    const fade = () => (immediate ? MUSIC_FADE_FAST : this.playing ? MUSIC_FADE : 0.6);
    // The studio play-list when it exists and its first take decodes; otherwise the synthesised track.
    if (await this.studioMusicReady(target)) {
      if (this.disposed || token !== this.musicToken) return;
      if (this.startStudio(target, fade())) {
        this.musicUnavailable.delete(target);
        if (this.st.state === 'running') this.refreshRunState();
        return;
      }
    }
    if (this.disposed || token !== this.musicToken) return;
    const music = await this.loadMusic(target);
    if (this.disposed || token !== this.musicToken) return;
    if (!music) {
      this.musicTarget = this.playing?.theme ?? null;
      console.warn(`[audio] music for "${target}" is unavailable`);
      this.musicUnavailable.add(target);
      if (this.st.state === 'running') this.refreshRunState();
      return;
    }
    this.musicUnavailable.delete(target);
    this.startTrack(target, music, fade());
    this.trimMusicCache();
    if (this.st.state === 'running') this.refreshRunState();
  }

  /** Decodes the first take of a theme's studio play-list; false when there is none or it failed. */
  private async studioMusicReady(theme: ThemeId): Promise<boolean> {
    const takes = this.studio?.music[theme]?.takes;
    if (!takes || takes.length === 0) return false;
    const first = await this.decodeStudioTake(takes[0]!.file);
    if (!first) {
      if (!this.studioMusicFailed.has(theme)) console.warn(`[audio] studio music for "${theme}" is unavailable; playing the synthesised track`);
      this.studioMusicFailed.add(theme);
      return false;
    }
    this.studioMusicFailed.delete(theme);
    return true;
  }

  private fadeOutPlaying(seconds: number): void {
    const ctx = this.ctx;
    const old = this.playing;
    if (!ctx || !old) return;
    this.playing = null;
    const t = ctx.currentTime;
    const stopAt = t + seconds * 1.6 + 0.05;
    try {
      // setTargetAtTime continues from whatever the gain is right now, so a fade
      // that interrupts another fade never jumps.
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setTargetAtTime(0, t, Math.max(0.01, seconds / 3.5));
      old.source?.stop(stopAt);
    } catch {
      try {
        old.source?.stop();
      } catch {
        /* already stopped */
      }
    }
    if (old.source) {
      const source = old.source;
      source.onended = () => {
        source.disconnect();
        old.gain.disconnect();
      };
    }
    if (old.player) {
      old.player.stop(stopAt);
      // Free the decoded takes once the fade is over in context time (a hidden page pauses it).
      const cleanup = () => {
        if (this.disposed) return;
        if (this.ctx && this.ctx.currentTime < stopAt) {
          setTimeout(cleanup, 500);
          return;
        }
        old.gain.disconnect();
        if (this.studio && this.playing?.theme !== old.theme) {
          for (const take of this.studio.music[old.theme]?.takes ?? []) this.releaseStudioTake(take.file);
        }
      };
      setTimeout(cleanup, (seconds * 1.6 + 0.3) * 1000);
    }
  }

  private startTrack(theme: ThemeId, music: MusicBuffer, fade: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicMain) return;
    this.fadeOutPlaying(fade);
    const source = ctx.createBufferSource();
    source.buffer = music.buffer;
    source.loop = true;
    source.loopStart = music.loopStart;
    source.loopEnd = music.loopEnd;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.setTargetAtTime(1, t, Math.max(0.01, fade / 3.5));
    source.connect(gain);
    gain.connect(this.musicMain);
    source.start(t, music.loopStart);
    this.playing = { theme, source, gain, player: null };
    this.setStatus({ musicTheme: theme });
  }

  /** Starts a theme's studio play-list from the beginning of its first take (its intro). */
  private startStudio(theme: ThemeId, fade: number): boolean {
    const ctx = this.ctx;
    const playlist = this.studio?.music[theme];
    if (!ctx || !this.musicMain || !playlist) return false;
    const takes = playlist.takes;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.setTargetAtTime(1, t, Math.max(0.01, fade / 3.5));
    gain.connect(this.musicMain);
    const player = new StudioPlayer({
      ctx,
      output: gain,
      takes,
      buffer: (i) => this.studioDecoded.get(takes[i]!.file) ?? null,
      request: (i) => void this.decodeStudioTake(takes[i]!.file),
      release: (i) => this.releaseStudioTake(takes[i]!.file),
    });
    this.fadeOutPlaying(fade);
    if (!player.start(0, 0)) {
      gain.disconnect();
      return false;
    }
    this.playing = { theme, source: null, gain, player };
    this.setStatus({ musicTheme: theme });
    return true;
  }

  private loadMusic(theme: ThemeId): Promise<MusicBuffer | null> {
    const cached = this.musicCache.get(theme);
    if (cached) {
      // Refresh recency.
      this.musicCache.delete(theme);
      this.musicCache.set(theme, cached);
      return Promise.resolve(cached);
    }
    let loading = this.musicLoading.get(theme);
    if (!loading) {
      loading = this.loadMusicInner(theme).finally(() => this.musicLoading.delete(theme));
      this.musicLoading.set(theme, loading);
    }
    return loading;
  }

  private async loadMusicInner(theme: ThemeId): Promise<MusicBuffer | null> {
    const manifest = this.manifest;
    const ctx = this.ctx;
    if (!manifest || !ctx) return null;
    const entry = manifest.music[theme];
    let result: MusicBuffer | null = null;
    if (!this.st.usingFallbackSynth || entry.bytes > 0) {
      try {
        const res = await this.env.fetch!(this.url(entry.file));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        if (buffer.duration + 0.02 < entry.loopEnd) throw new Error('decoded file is shorter than its loop points');
        const rate = manifest.sampleRate > 0 ? manifest.sampleRate : 44100;
        result = {
          buffer,
          loopStart: Number.isInteger(entry.loopStartSample) ? entry.loopStartSample / rate : entry.loopStart,
          loopEnd: Number.isInteger(entry.loopEndSample) ? entry.loopEndSample / rate : entry.loopEnd,
        };
      } catch (error) {
        console.warn(`[audio] could not load ${entry.file}: ${errorText(error)}; synthesising it instead`);
      }
    }
    if (!result && !this.disposed) {
      await this.synthesise([entry.file], (_file, music) => {
        result = music;
      });
      if (result) this.setStatus({ usingFallbackSynth: true });
    }
    if (result) this.musicCache.set(theme, result);
    return result;
  }

  /** Decoded tracks are large (≈25 MB each); keep only the most recent ones. */
  private trimMusicCache(): void {
    for (const theme of [...this.musicCache.keys()]) {
      if (this.musicCache.size <= MAX_CACHED_TRACKS) break;
      if (theme === this.playing?.theme || theme === this.musicTarget) continue;
      this.musicCache.delete(theme);
    }
  }

  previewTrack(themeId: ThemeId | null): void {
    const token = ++this.previewToken;
    if (themeId === null) {
      this.stopPreview();
      return;
    }
    void (async () => {
      // The preview button is a user gesture, so it may also unlock audio.
      if (this.st.state === 'locked') await this.unlock();
      if (token !== this.previewToken || !this.canPlay() || this.st.state !== 'running') return;
      // The studio recording when there is one (from its in point, past any intro), else the synthesised loop.
      const take = this.studio?.music[themeId]?.takes[0];
      let studioFile: string | null = null;
      let music: MusicBuffer | null = null;
      if (take) {
        const buffer = await this.decodeStudioTake(take.file);
        if (buffer) {
          studioFile = take.file;
          music = { buffer, loopStart: take.inPoint, loopEnd: take.outPoint };
        }
      }
      if (!music) music = await this.loadMusic(themeId);
      const ctx = this.ctx;
      if (!music || !ctx || !this.previewBus || !this.musicMain || token !== this.previewToken) return;
      this.stopPreview(true);
      this.previewHeld = studioFile;
      const source = ctx.createBufferSource();
      source.buffer = music.buffer;
      source.loop = true;
      source.loopStart = music.loopStart;
      source.loopEnd = music.loopEnd;
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(1, t + 0.25);
      source.connect(gain);
      gain.connect(this.previewBus);
      source.start(t, music.loopStart);
      this.musicMain.gain.cancelScheduledValues(t);
      this.musicMain.gain.setTargetAtTime(0, t, 0.08);
      const timer = setTimeout(() => {
        if (this.preview?.source === source) this.stopPreview();
      }, PREVIEW_SECONDS * 1000);
      this.preview = { source, gain, timer };
      this.trimMusicCache();
    })();
  }

  private stopPreview(keepMainSilent = false): void {
    const ctx = this.ctx;
    const p = this.preview;
    this.preview = null;
    const held = this.previewHeld;
    this.previewHeld = null;
    if (held) {
      this.releaseStudioTake(held);
      // A previewed take of a theme that is not in use: drop its encoded bytes too.
      const owner = this.studio ? THEME_IDS.find((t) => this.studio!.music[t]?.takes.some((k) => k.file === held)) : undefined;
      if (owner && owner !== this.theme && owner !== this.playing?.theme && owner !== this.desiredTrack()) this.studioBytes.delete(held);
    }
    if (p) {
      clearTimeout(p.timer);
      if (ctx) {
        const t = ctx.currentTime;
        try {
          p.gain.gain.cancelScheduledValues(t);
          p.gain.gain.setTargetAtTime(0, t, 0.06);
          p.source.stop(t + 0.4);
        } catch {
          /* already stopped */
        }
        p.source.onended = () => {
          p.source.disconnect();
          p.gain.disconnect();
        };
      }
    }
    if (ctx && this.musicMain && !keepMainSilent) {
      this.musicMain.gain.cancelScheduledValues(ctx.currentTime);
      this.musicMain.gain.setTargetAtTime(1, ctx.currentTime, 0.15);
    }
  }

  /* ----------------------------------------------------------------- sfx */

  playSfx(name: SfxName, options: SfxOptions = {}): void {
    if (!this.sfxReady()) return;
    if (name === 'win') {
      // The theme's studio win stinger (common tier) when it is loaded; never two wins on top of each other.
      if (this.theme && this.stingerBuffer(this.theme, 'win')) {
        this.playWin(this.theme, 'common', { delay: options.delay, volume: options.volume });
        return;
      }
      if (this.env.now() < this.winUntil) return;
    }
    this.playEffect(name, options);
  }

  private sfxReady(): boolean {
    const ctx = this.ctx;
    return !!ctx && !!this.manifest && !!this.sfxBus && this.st.state === 'running' && ctx.state === 'running';
  }

  /** Plays an effect: its studio sample ('replace'), the synthesised one, or both ('layer'). */
  private playEffect(name: SfxName, options: SfxOptions, started?: OneShot[]): boolean {
    const manifest = this.manifest!;
    const now = this.env.now();
    const last = this.lastTrigger.get(name);
    if (last !== undefined && now - last < MIN_RETRIGGER_MS && !options.delay) return false;
    if (this.activeSfx >= MAX_ACTIVE_SFX || (this.activeByName.get(name) ?? 0) >= MAX_ACTIVE_PER_NAME) return false;
    let played = false;
    const studio = this.studio?.sfx[name];
    const studioFiles = studio ? studio.files.filter((f) => this.buffers.has(f)) : [];
    if (studio && studioFiles.length > 0) played = this.playVariant(name, `${name}|studio`, studioFiles, studio, options, started);
    if (!studio || studioFiles.length === 0 || studio.mode === 'layer') {
      const entry = manifest.sfx[name];
      if (entry) {
        const themed = this.theme && entry.themes ? entry.themes[this.theme] : undefined;
        const files = (themed && themed.length ? themed : entry.files).filter((f) => this.buffers.has(f));
        if (files.length > 0) played = this.playVariant(name, `${name}|${themed ? this.theme : ''}`, files, entry, options, started) || played;
      }
    }
    if (played) this.lastTrigger.set(name, now);
    return played;
  }

  /** Picks a variant (never the same one twice in a row) and plays it with the entry's random variation. */
  private playVariant(name: SfxName, key: string, files: string[], entry: { gain: number; pitchVar: number; gainVar: number }, options: SfxOptions, started?: OneShot[]): boolean {
    const prev = this.lastVariant.get(key) ?? -1;
    let index = Math.floor(this.env.random() * files.length);
    if (files.length > 1 && index === prev) index = (index + 1 + Math.floor(this.env.random() * (files.length - 1))) % files.length;
    this.lastVariant.set(key, index);
    const rate = (options.pitch ?? 1) * (1 + (this.env.random() * 2 - 1) * entry.pitchVar);
    const gain = (options.volume ?? 1) * entry.gain * (1 + (this.env.random() * 2 - 1) * entry.gainVar);
    const shot = this.startOneShot(this.buffers.get(files[index]!)!, { gain, rate, pan: options.pan, delay: options.delay, key: name });
    if (shot && started) started.push(shot);
    return shot !== null;
  }

  /** Starts one buffer on the SFX bus with voice accounting (suspend stops it; per-key cap). */
  private startOneShot(buffer: AudioBuffer, o: { gain: number; rate?: number; pan?: number; delay?: number; key: string }): OneShot | null {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return null;
    if (this.activeSfx >= MAX_ACTIVE_SFX || (this.activeByName.get(o.key) ?? 0) >= MAX_ACTIVE_PER_NAME) return null;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = clamp(o.rate ?? 1, 0.25, 4);
    const gain = ctx.createGain();
    gain.gain.value = clamp(o.gain, 0, 2);
    source.connect(gain);
    let tail: AudioNode = gain;
    if (o.pan && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp(o.pan, -1, 1);
      gain.connect(panner);
      tail = panner;
    }
    tail.connect(this.sfxBus);
    const key = o.key;
    this.activeSfx++;
    this.activeByName.set(key, (this.activeByName.get(key) ?? 0) + 1);
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      this.activeSfx = Math.max(0, this.activeSfx - 1);
      this.activeByName.set(key, Math.max(0, (this.activeByName.get(key) ?? 1) - 1));
      source.disconnect();
      gain.disconnect();
      if (tail !== gain) tail.disconnect();
    };
    source.start(ctx.currentTime + Math.max(0, o.delay ?? 0));
    return { source, gain };
  }

  /* ------------------------------------------------------ dramatic layer */

  private stingerBuffer(theme: ThemeId, which: 'win' | 'jackpot'): AudioBuffer | null {
    const entry = this.studio?.stingers[theme]?.[which];
    if (!entry) return null;
    for (const f of entry.files) {
      const b = this.buffers.get(f);
      if (b) return b;
    }
    return null;
  }

  playWin(themeId: ThemeId, tier: WinTier, options: { delay?: number; volume?: number } = {}): void {
    if (!this.sfxReady()) return;
    const now = this.env.now();
    if (now < this.winUntil) return; // the previous win is still ringing
    // The requested theme's stingers, else the current theme's (e.g. right after a theme change).
    let theme: ThemeId = (THEME_IDS as readonly string[]).includes(themeId) ? themeId : (this.theme ?? THEME_IDS[0]);
    if (!this.stingerBuffer(theme, 'win') && !this.stingerBuffer(theme, 'jackpot') && this.theme) theme = this.theme;
    const parts = winPlan(tier, { win: !!this.stingerBuffer(theme, 'win'), jackpot: !!this.stingerBuffer(theme, 'jackpot') });
    const base = Math.max(0, options.delay ?? 0);
    const volume = options.volume ?? 1;
    let longest = 0;
    for (const part of parts) {
      if (part.kind === 'stinger') {
        const buffer = this.stingerBuffer(theme, part.which)!;
        const entry = this.studio!.stingers[theme]![part.which]!;
        if (this.startOneShot(buffer, { gain: entry.gain * part.volume * volume, delay: base + part.delay, key: 'stinger' })) {
          longest = Math.max(longest, part.delay + buffer.duration);
        }
      } else if (this.playEffect(part.name, { delay: base + part.delay + 0.001, volume: part.volume * volume })) {
        if (part.name === 'win') longest = Math.max(longest, part.delay + (this.manifest?.sfx.win.duration ?? 1.5));
      }
    }
    if (longest > 0) {
      this.duckUnderStinger(WIN_DUCK[tier], base, longest);
      this.winUntil = now + (base + longest * 0.8) * 1000;
    }
  }

  /** Turns the music down while a stinger plays and brings it back as the stinger rings out. */
  private duckUnderStinger(depth: number, delay: number, seconds: number): void {
    const ctx = this.ctx;
    const g = this.stingerDuck?.gain;
    if (!ctx || !g) return;
    const t = ctx.currentTime + delay;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(depth, t, 0.06);
    g.setTargetAtTime(1, t + Math.max(0.5, seconds - 0.8), 0.45);
  }

  playCharacter(assetId: string, moment: CharacterMoment, options: { delay?: number; pan?: number; volume?: number } = {}): void {
    if (!this.sfxReady() || typeof assetId !== 'string') return;
    if (!this.characterGate.allow(assetId, this.env.now(), moment)) return;
    // A more important moment inside the cooldown (the lifted toy slips): cut the previous cry short.
    this.interruptCharacter(assetId);
    const v = characterVoicing(moment, this.env.random);
    const base = Math.max(0, options.delay ?? 0);
    const volume = (options.volume ?? 1) * v.volume;
    const voice = this.studio?.voices[assetId];
    const buffer = voice ? this.buffers.get(voice.file) : undefined;
    const started: OneShot[] = [];
    if (voice && buffer && themeOfCharacter(assetId)) {
      const shot = this.startOneShot(buffer, { gain: voice.gain * volume, rate: v.rate, pan: options.pan, delay: base + v.delay, key: 'character' });
      if (shot) started.push(shot);
      // A near-empty recording (a 0.1–0.35 s blip) gets the character's own squeak layered under it.
      if (buffer.duration < SHORT_VOICE_S) {
        this.playEffect('plush_squeak', { pitch: squeakPitch(assetId) * v.rate, volume, pan: options.pan, delay: base + v.delay + 0.001 }, started);
      }
    } else {
      // Characters without their own voice still sound different: a squeak at their own pitch.
      this.playEffect('plush_squeak', { pitch: squeakPitch(assetId) * v.rate, volume, pan: options.pan, delay: base + v.delay + 0.001 }, started);
    }
    if (started.length) {
      this.characterVoices.set(assetId, started);
      // Lift / slip cries get a light music duck for their length; a ringing win ducks deeper already.
      const buffer = started[0]!.source.buffer;
      if (moment !== 'win' && buffer && this.env.now() >= this.winUntil) {
        this.duckUnderStinger(CHARACTER_DUCK, base + v.delay, buffer.duration / Math.max(0.25, v.rate) + 0.5);
      }
    }
    if (v.layer) this.playEffect(v.layer.name, { delay: base + v.layer.delay, volume: v.layer.volume * (options.volume ?? 1) });
  }

  /** Fades out (≈60 ms, no click) whatever the character is still saying, or cancels it if it has not started. */
  private interruptCharacter(assetId: string): void {
    const ctx = this.ctx;
    const shots = this.characterVoices.get(assetId);
    this.characterVoices.delete(assetId);
    if (!ctx || !shots) return;
    const t = ctx.currentTime;
    for (const { source, gain } of shots) {
      if (!this.activeSources.has(source)) continue; // already ended
      try {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setTargetAtTime(0, t, 0.015);
        source.stop(t + 0.1);
      } catch {
        /* already stopped */
      }
    }
  }

  setAttract(active: boolean): void {
    if (this.attractActive === !!active) return;
    this.attractActive = !!active;
    this.scheduleAttractChime();
  }

  setAttractChime(enabled: boolean): void {
    if (this.attractChimeEnabled === !!enabled) return;
    this.attractChimeEnabled = !!enabled;
    this.scheduleAttractChime();
  }

  private scheduleAttractChime(): void {
    if (this.attractTimer !== null) clearTimeout(this.attractTimer);
    this.attractTimer = null;
    if (!this.attractActive || !this.attractChimeEnabled || this.disposed) return;
    this.attractTimer = setTimeout(() => {
      this.attractTimer = null;
      // Dropped (not queued) while locked or suspended, like every other effect.
      if (this.attractActive && this.attractChimeEnabled) this.playSfx('attract_chime', { volume: ATTRACT_CHIME_VOLUME });
      this.scheduleAttractChime();
    }, attractChimeDelayMs(this.env.random));
  }

  /* ----------------------------------------------------------------- loops */

  setLoop(name: LoopName, level: number, pitch = 1): void {
    const ctx = this.ctx;
    const manifest = this.manifest;
    const now = this.env.now();
    let voice = this.loops.get(name);
    if (!voice) {
      voice = { source: null, gain: null, level: 0, lastCall: now, silentSince: null };
      this.loops.set(name, voice);
    }
    voice.lastCall = now;
    const lv = Number.isFinite(level) ? clamp(level, 0, 1) : 0;
    if (!ctx || !manifest || !this.sfxBus || this.st.state !== 'running') {
      voice.level = 0;
      return;
    }
    // The studio loop when it is loaded, else the synthesised one.
    const studioLoop = this.studio?.loops[name];
    const studioBuffer = studioLoop ? this.buffers.get(studioLoop.file) : undefined;
    const synth = manifest.loops[name];
    const buffer = studioBuffer ?? (synth ? this.buffers.get(synth.file) : undefined);
    const entry = studioBuffer ? studioLoop : synth;
    if (!entry || !buffer) return;
    const t = ctx.currentTime;
    if (lv > 0.002) {
      if (!voice.source) {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(this.sfxBus);
        source.start(t, this.env.random() * buffer.duration);
        voice.source = source;
        voice.gain = gain;
      }
      voice.silentSince = null;
      voice.level = lv;
      voice.gain!.gain.setTargetAtTime(lv * entry.gain, t, 0.035);
      voice.source.playbackRate.setTargetAtTime(clamp(Number.isFinite(pitch) ? pitch : 1, 0.4, 2.5), t, 0.05);
      this.ensureLoopTimer();
    } else if (voice.source) {
      if (voice.silentSince === null) {
        voice.silentSince = now;
        voice.level = 0;
        voice.gain!.gain.setTargetAtTime(0, t, 0.04);
      }
    }
  }

  private ensureLoopTimer(): void {
    if (this.loopTimer !== null) return;
    this.loopTimer = setInterval(() => this.serviceLoops(), 120);
  }

  /** Stops loops that faded out, and loops the game stopped updating (pause, crash, tab switch). */
  private serviceLoops(): void {
    const ctx = this.ctx;
    const now = this.env.now();
    let anyActive = false;
    for (const voice of this.loops.values()) {
      if (!voice.source) continue;
      if (voice.silentSince === null && now - voice.lastCall > LOOP_WATCHDOG_MS) {
        voice.silentSince = now;
        voice.level = 0;
        if (ctx) voice.gain!.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      }
      if (voice.silentSince !== null && now - voice.silentSince > LOOP_SILENCE_STOP_MS) {
        this.killLoop(voice);
      } else {
        anyActive = true;
      }
    }
    if (!anyActive && this.loopTimer !== null) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  private killLoop(voice: LoopVoice): void {
    try {
      voice.source?.stop();
    } catch {
      /* already stopped */
    }
    voice.source?.disconnect();
    voice.gain?.disconnect();
    voice.source = null;
    voice.gain = null;
    voice.level = 0;
    voice.silentSince = null;
  }

  private stopAllLoops(): void {
    for (const voice of this.loops.values()) if (voice.source) this.killLoop(voice);
    if (this.loopTimer !== null) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  /* ----------------------------------------------------------------- voice */

  playVoice(data: ArrayBuffer | AudioBuffer, options: { volume?: number; rate?: number } = {}): VoiceHandle {
    this.stopVoiceSource();
    const token = ++this.voiceToken;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const handle: VoiceHandle = {
      done,
      stop: () => {
        if (token === this.voiceToken) this.stopVoiceSource();
        finish();
      },
    };
    const ctx = this.ctx;
    if (!ctx || !this.voiceBus_ || this.st.state !== 'running' || ctx.state !== 'running') {
      finish();
      return handle;
    }
    this.voiceResolve = finish;
    // Duck immediately so the music is already down when the first word starts.
    this.voicePlaying = true;
    this.updateDuck();
    const start = (buffer: AudioBuffer) => {
      if (token !== this.voiceToken || !this.ctx || !this.voiceBus_ || this.st.state !== 'running') {
        finish();
        return;
      }
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = clamp(options.rate ?? 1, 0.5, 2);
      const gain = this.ctx.createGain();
      gain.gain.value = clamp(options.volume ?? 1, 0, 2);
      source.connect(gain);
      gain.connect(this.voiceBus_);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        if (this.voiceSource === source) {
          this.voiceSource = null;
          this.voicePlaying = false;
          this.voiceResolve = null;
          this.updateDuck(false, DUCK_HOLD);
        }
        finish();
      };
      this.voiceSource = source;
      source.start();
    };
    const fail = (error: unknown) => {
      console.warn(`[audio] voice could not be played: ${errorText(error)}`);
      if (token === this.voiceToken) {
        this.voicePlaying = false;
        this.voiceResolve = null;
        this.updateDuck(false, 0);
      }
      finish();
    };
    if (typeof (data as AudioBuffer).getChannelData === 'function') {
      start(data as AudioBuffer);
    } else {
      ctx.decodeAudioData((data as ArrayBuffer).slice(0)).then(start, fail);
    }
    return handle;
  }

  private stopVoiceSource(): void {
    this.voiceToken++;
    const source = this.voiceSource;
    this.voiceSource = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      source.disconnect();
    }
    const resolve = this.voiceResolve;
    this.voiceResolve = null;
    if (this.voicePlaying) {
      this.voicePlaying = false;
      this.updateDuck(false, 0);
    }
    resolve?.();
  }

  voiceBus(): { context: AudioContext; input: AudioNode } | null {
    if (!this.ctx || !this.voiceBus_ || this.st.state !== 'running') return null;
    return { context: this.ctx, input: this.voiceBus_ };
  }

  setVoiceActive(active: boolean): void {
    if (this.voiceManual === active) return;
    this.voiceManual = active;
    this.updateDuck(false, active ? 0 : DUCK_HOLD);
  }

  stopVoice(): void {
    this.stopVoiceSource();
    if (this.voiceManual) {
      this.voiceManual = false;
      this.updateDuck(false, 0);
    }
  }

  /* -------------------------------------------------------- suspend/resume */

  suspend(): void {
    this.wantSuspended = true;
    const ctx = this.ctx;
    if (!ctx || this.disposed) return;
    // Nothing may carry over: voices end, motors stop, effects that are still ringing are cut,
    // and new one-shots are simply dropped while suspended.
    this.stopVoice();
    this.stopAllLoops();
    for (const source of [...this.activeSources]) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    if (ctx.state === 'running') {
      void ctx.suspend().then(
        () => {
          if (this.wantSuspended && this.st.state === 'running') this.setState('suspended', 'suspended while the page is hidden');
        },
        () => undefined,
      );
    }
    if (this.st.state === 'running') this.setState('suspended', 'suspended while the page is hidden');
  }

  resume(): void {
    this.wantSuspended = false;
    const ctx = this.ctx;
    if (!ctx || this.disposed || ctx.state === 'closed') return;
    if (this.st.state !== 'suspended') return;
    void ctx.resume().then(
      () => {
        if (this.wantSuspended || this.disposed) return;
        if (ctx.state === 'running') {
          this.refreshRunState();
          void this.applyMusic(false);
        } else {
          this.setState('locked', 'the browser needs a tap or click to resume sound');
        }
      },
      (error) => this.setState('locked', `could not resume audio (${errorText(error)}); tap or click to enable sound`),
    );
  }

  /* -------------------------------------------------------- output devices */

  async listOutputDevices(): Promise<{ supported: boolean; reason?: string; devices: { id: string; label: string }[] }> {
    if (!this.sinkSupported()) {
      return { supported: false, reason: 'This browser cannot route Web Audio to a chosen output device (AudioContext.setSinkId is missing).', devices: [] };
    }
    const md = this.env.mediaDevices;
    if (!md || typeof md.enumerateDevices !== 'function') {
      return { supported: false, reason: 'Device enumeration is unavailable (needs HTTPS or localhost).', devices: [] };
    }
    try {
      const all = await md.enumerateDevices();
      const outs = all.filter((d) => d.kind === 'audiooutput');
      const devices = outs.map((d, i) => ({ id: d.deviceId, label: d.label || (d.deviceId === 'default' || d.deviceId === '' ? 'System default' : `Output ${i + 1}`) }));
      const unlabeled = outs.length > 0 && outs.every((d) => !d.label);
      return {
        supported: true,
        devices,
        reason: outs.length === 0 ? 'The browser did not list any audio outputs.' : unlabeled ? 'The browser hides device names until media permission is granted.' : undefined,
      };
    } catch (error) {
      return { supported: false, reason: `Could not list devices (${errorText(error)}).`, devices: [] };
    }
  }

  async setOutputDevice(deviceId: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.sinkSupported()) return { ok: false, reason: 'AudioContext.setSinkId is not supported by this browser.' };
    this.desiredSink = deviceId;
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!ctx) return { ok: true, reason: 'Will be applied when audio starts.' };
    try {
      await ctx.setSinkId!(deviceId === 'default' ? '' : deviceId);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: errorText(error) };
    }
  }

  /* --------------------------------------------------------------- dispose */

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.previewToken++;
    this.musicToken++;
    this.stopVoice();
    this.stopAllLoops();
    if (this.preview) clearTimeout(this.preview.timer);
    this.preview = null;
    if (this.attractTimer !== null) clearTimeout(this.attractTimer);
    this.attractTimer = null;
    try {
      this.playing?.source?.stop();
    } catch {
      /* already stopped */
    }
    if (this.playing?.player && this.ctx) this.playing.player.stop(this.ctx.currentTime);
    this.playing = null;
    this.worker?.terminate();
    this.worker = null;
    this.workerCalls.clear();
    this.buffers.clear();
    this.pendingBytes.clear();
    this.musicCache.clear();
    this.studioBytes.clear();
    this.studioDecoded.clear();
    this.studioThemes.clear();
    this.characterVoices.clear();
    this.listeners.clear();
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') {
      ctx.onstatechange = null;
      void ctx.close().catch(() => undefined);
    }
  }
}

export function createAudioEngine(options?: AudioEngineOptions): AudioPort {
  return new AudioEngine(options);
}
