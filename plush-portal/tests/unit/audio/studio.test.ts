/**
 * Studio recordings: the manifest section and the shipped files, the play-list cross-fade
 * schedule, fallback to the synthesised set, character voices and tier-aware wins.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine } from '../../../src/audio/index';
import { parseStudioManifest, studioSharedFiles, studioThemeFiles, themeOfCharacter, type StudioManifest } from '../../../src/audio/studio/manifest';
import { CHARACTER_DUCK, CooldownGate, SHORT_VOICE_S, attractChimeDelayMs, characterVoicing, squeakPitch, winPlan, CHARACTER_COOLDOWN_MS } from '../../../src/audio/studio/moments';
import { KEY_CHANGE_FADE_IN, PLAYLIST_LOOKAHEAD, PLAYLIST_PREFETCH, StudioPlayer, equalPowerCurves, keysClash, nextTakeIndex, planHandover, transitionCrossfade } from '../../../src/audio/studio/playlist';
import { decodeWav16 } from '../../../src/audio/synth/wav';
import { SFX_NAMES, type AudioPort } from '../../../src/core/contracts';
import { THEME_IDS } from '../../../src/core/types';
import { RARITY_TABLE } from '../../../src/game/rarity';
import { BUS, FakeContext, FakeGain, flush, makeFakeEnv, playbackContext, reaches, type FakeSource } from './fakeWebAudio';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const AUDIO_DIR = path.join(ROOT, 'public', 'audio');
const shipped = JSON.parse(readFileSync(path.join(AUDIO_DIR, 'manifest.json'), 'utf8')) as Record<string, unknown> & { studio: unknown; music: Record<string, { file: string; duration: number }> };
const parsed = parseStudioManifest(shipped.studio);
const studio = parsed.studio as StudioManifest;

/* ------------------------------------------------------------- manifest */

describe('studio manifest (public/audio/manifest.json → studio)', () => {
  it('parses without problems and covers every theme', () => {
    expect(parsed.problems).toEqual([]);
    expect(studio).not.toBeNull();
    expect(studio.licence).toMatch(/Higgsfield/);
    expect(studio.licence).toMatch(/commercial/);
    for (const theme of THEME_IDS) {
      expect(studio.music[theme]?.takes.length, theme).toBe(2);
      expect(studio.stingers[theme]?.win, `${theme} win`).toBeDefined();
      expect(studio.stingers[theme]?.jackpot, `${theme} jackpot`).toBeDefined();
    }
  });

  it('records provenance for every file', () => {
    const sources = [
      ...THEME_IDS.flatMap((t) => studio.music[t]!.takes.map((k) => k.source)),
      ...THEME_IDS.flatMap((t) => [studio.stingers[t]!.win!, studio.stingers[t]!.jackpot!].flatMap((s) => s.source)),
      ...Object.values(studio.sfx).flatMap((e) => e!.source),
      ...Object.values(studio.voices).map((v) => v.source),
    ];
    for (const s of sources) {
      expect(s.generator).toBe('Higgsfield');
      expect(s.model.length).toBeGreaterThan(3);
      expect(s.input).toMatch(/\.mp3$/);
      if (s.job !== null) expect(s.job).toMatch(/^hf_\d{8}_\d{6}_[0-9a-f-]{36}\.mp3$/);
    }
    // Voices, effects and the four recorded stingers carry their Higgsfield job.
    expect(Object.values(studio.voices).every((v) => v.source.job !== null)).toBe(true);
    expect(Object.values(studio.sfx).every((e) => e!.source.every((s) => s.job !== null))).toBe(true);
  });

  it('ships every listed file with the recorded size; music at −16 LUFS, true peak ≤ −1 dBTP, valid in / out points', () => {
    const files = new Set<string>();
    for (const theme of THEME_IDS) {
      for (const take of studio.music[theme]!.takes) {
        const full = path.join(AUDIO_DIR, take.file);
        expect(existsSync(full), take.file).toBe(true);
        expect(statSync(full).size, take.file).toBe(take.bytes);
        expect(take.lufs, take.file).toBeGreaterThan(-16.5);
        expect(take.lufs, take.file).toBeLessThan(-15.5);
        expect(take.truePeakDb, take.file).toBeLessThanOrEqual(-1);
        expect(take.duration, take.file).toBeGreaterThan(100);
        expect(take.inPoint, take.file).toBeGreaterThanOrEqual(take.crossfade / 2);
        expect(take.outPoint + take.crossfade / 2, take.file).toBeLessThanOrEqual(take.duration - 1);
        expect(take.outPoint - take.inPoint, take.file).toBeGreaterThan(80);
        expect(take.crossfade, take.file).toBeGreaterThanOrEqual(1.6);
        expect(take.crossfade, take.file).toBeLessThanOrEqual(3.6);
        // Whole beats at the take's tempo.
        expect((take.crossfade * take.bpm) / 60, take.file).toBeCloseTo(take.crossfadeBeats, 3);
        files.add(take.file);
      }
      for (const f of studioThemeFiles(studio, theme).oneShots) files.add(f);
    }
    for (const f of studioSharedFiles(studio)) files.add(f);
    for (const f of files) expect(existsSync(path.join(AUDIO_DIR, f)), f).toBe(true);
  });

  it('stores effects, voices and the loop as click-free 16-bit WAV, peak-normalised', () => {
    const wavs = [...studioSharedFiles(studio), ...Object.values(studio.voices).map((v) => v.file)];
    expect(wavs.length).toBeGreaterThan(40);
    for (const f of wavs) {
      const wav = decodeWav16(new Uint8Array(readFileSync(path.join(AUDIO_DIR, f))));
      expect(wav.sampleRate, f).toBe(44100);
      expect(wav.channels, f).toBe(1);
      let peak = 0;
      for (const v of wav.data[0]!) peak = Math.max(peak, Math.abs(v));
      const peakDb = 20 * Math.log10(peak);
      expect(peakDb, f).toBeLessThan(-0.5);
      expect(peakDb, f).toBeGreaterThan(-4);
      if (f.includes('/loops/')) continue;
      expect(Math.abs(wav.data[0]![0]!), f).toBeLessThan(0.02);
      expect(Math.abs(wav.data[0]!.at(-1)!), f).toBeLessThan(2e-3);
    }
    // The trolley loop wraps without a step bigger than its ordinary sample steps.
    const loop = decodeWav16(new Uint8Array(readFileSync(path.join(AUDIO_DIR, studio.loops.motor_trolley!.file)))).data[0]!;
    let sum = 0;
    for (let i = 1; i < loop.length; i++) sum += Math.abs(loop[i]! - loop[i - 1]!);
    expect(Math.abs(loop[0]! - loop.at(-1)!)).toBeLessThan((sum / loop.length) * 8);
  });

  it('maps effects only onto contract names and voices only onto real characters', () => {
    for (const name of Object.keys(studio.sfx)) expect(SFX_NAMES as readonly string[]).toContain(name);
    for (const e of Object.values(studio.sfx)) expect(['replace', 'layer']).toContain(e!.mode);
    const ids = Object.keys(studio.voices);
    expect(ids.length).toBeGreaterThanOrEqual(25);
    for (const id of ids) {
      expect(Object.keys(RARITY_TABLE), id).toContain(id);
      expect(themeOfCharacter(id)).not.toBeNull();
    }
    // What was not shipped is listed with the measured reason.
    for (const r of studio.rejected ?? []) expect(r.reason.length).toBeGreaterThan(20);
    for (const theme of THEME_IDS) expect(studio.bytes!.themes[theme]).toBeGreaterThan(1e6);
  });

  it('drops invalid entries one by one and rejects unknown schemas', () => {
    const copy = JSON.parse(JSON.stringify(shipped.studio)) as Record<string, any>;
    copy.music.ocean.takes[1].outPoint = 1; // out before in
    copy.voices['not an id'] = { file: 'x.wav', gain: 1 };
    copy.sfx.combo.mode = 'sometimes';
    copy.sfx.no_such_effect = copy.sfx.sparkle;
    const res = parseStudioManifest(copy);
    expect(res.studio!.music.ocean!.takes).toHaveLength(1);
    expect(res.studio!.voices['not an id']).toBeUndefined();
    expect(res.studio!.sfx.combo).toBeUndefined();
    expect((res.studio!.sfx as Record<string, unknown>).no_such_effect).toBeUndefined();
    expect(res.studio!.sfx.sparkle).toBeDefined();
    expect(res.problems.join(' ')).toMatch(/ocean\.takes\[1\]/);
    expect(res.problems.join(' ')).toMatch(/combo\.mode/);
    expect(parseStudioManifest({ ...copy, schema: 99 }).studio).toBeNull();
    expect(parseStudioManifest(undefined)).toEqual({ studio: null, problems: [] });
  });
});

/* ------------------------------------------------------------ play-list */

const A = { inPoint: 2, outPoint: 100, crossfade: 2, duration: 110 };
const B = { inPoint: 4, outPoint: 90, crossfade: 2.4, duration: 95 };

describe('play-list cross-fade schedule', () => {
  it('centres an equal-power fade on the out point of one take and the in point of the next', () => {
    expect(transitionCrossfade(A, B)).toBe(2);
    expect(transitionCrossfade(B, { ...A, inPoint: 0.6 })).toBeCloseTo(1.2, 9); // limited by the incoming pre-roll
    const h = planHandover(A, 10, B);
    expect(h.junction).toBe(110);
    expect(h.fadeStart).toBe(109);
    expect(h.fadeEnd).toBe(111);
    expect(h.incomingOffset).toBe(3);
    // The incoming file is at its in point exactly at the junction.
    expect(h.junction - h.incomingZero).toBeCloseTo(B.inPoint, 9);
    const { fadeIn, fadeOut } = equalPowerCurves();
    expect(fadeIn[0]).toBe(0);
    expect(fadeOut[0]).toBe(1);
    expect(fadeIn.at(-1)).toBeCloseTo(1, 9);
    expect(fadeOut.at(-1)).toBeCloseTo(0, 6);
    for (let i = 0; i < fadeIn.length; i++) expect(fadeIn[i]! ** 2 + fadeOut[i]! ** 2).toBeCloseTo(1, 5);
  });

  it('starts a late hand-over at once and keeps the outgoing take inside its file', () => {
    const h = planHandover(A, 10, B, 109.5);
    expect(h.fadeStart).toBe(109.5);
    expect(h.crossfade).toBe(2);
    const veryLate = planHandover(A, 10, B, 119.5); // 0.5 s of A left
    expect(veryLate.fadeEnd).toBeLessThanOrEqual(10 + A.duration);
  });

  it('does not overlap takes in different keys: fade out to the out point, then start at the in point', () => {
    const Akey = { ...A, key: 'D major' };
    const Bkey = { ...B, key: 'A♭ major' };
    expect(keysClash(Akey, Bkey)).toBe(true);
    expect(keysClash(Akey, { ...B, key: ' d  MAJOR ' })).toBe(false);
    expect(keysClash({ key: 'A♭ major' }, { key: 'Ab major' })).toBe(false);
    expect(keysClash(Akey, B)).toBe(false); // no estimate: keep the centred cross-fade
    const h = planHandover(Akey, 10, Bkey);
    expect(h.mode).toBe('sequential');
    expect(h.fadeEnd).toBe(10 + A.outPoint); // the outgoing take is silent by its out point
    expect(h.fadeStart).toBe(10 + A.outPoint - A.crossfade);
    expect(h.incomingStart).toBeGreaterThanOrEqual(h.fadeEnd); // no overlap at all
    expect(h.incomingOffset).toBe(B.inPoint);
    expect(h.incomingStart - h.incomingZero).toBeCloseTo(B.inPoint, 9);
    expect(h.incomingFade).toBe(KEY_CHANGE_FADE_IN);
    expect(h.junction).toBe(h.fadeEnd);
    // Late: the fade-out starts at once, stays inside the outgoing file, the incoming still follows it.
    const late = planHandover(Akey, 10, Bkey, 109.5);
    expect(late.fadeStart).toBe(109.5);
    expect(late.incomingStart).toBeGreaterThanOrEqual(late.fadeEnd);
    const veryLate = planHandover(Akey, 10, Bkey, 119.5);
    expect(veryLate.fadeEnd).toBeLessThanOrEqual(10 + A.duration);
    expect(veryLate.incomingStart).toBeGreaterThanOrEqual(veryLate.fadeEnd);
    // Every shipped theme: its two takes are in different keys, so both hand-overs are sequential.
    for (const theme of THEME_IDS) {
      const [a, b] = studio.music[theme]!.takes;
      for (const [x, y] of [[a!, b!], [b!, a!]]) {
        const plan = planHandover(x, 0, y);
        expect(plan.mode, `${theme} ${x.key} → ${y.key}`).toBe(keysClash(x, y) ? 'sequential' : 'crossfade');
        if (plan.mode === 'sequential') expect(plan.incomingStart, theme).toBeGreaterThanOrEqual(plan.fadeEnd);
      }
    }
  });

  it('alternates the takes and repeats the current one when the next is not decoded', () => {
    expect(nextTakeIndex(0, 2, () => true)).toBe(1);
    expect(nextTakeIndex(1, 2, () => true)).toBe(0);
    expect(nextTakeIndex(0, 2, () => false)).toBe(0);
    expect(nextTakeIndex(0, 1, () => true)).toBe(0);
  });
});

describe('StudioPlayer against a fake AudioContext', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
  afterEach(() => vi.useRealTimers());

  function setup(ready = [true, true], takes: (typeof A & { key?: string })[] = [A, B]) {
    const ctx = new FakeContext();
    ctx.state = 'running';
    const out = ctx.createGain();
    const decoded = ready.map((r, i) => (r ? { name: `take${i}`, duration: takes[i]!.duration } : null));
    const requests: number[] = [];
    const releases: number[] = [];
    const player = new StudioPlayer({
      ctx: ctx as unknown as BaseAudioContext,
      output: out as unknown as AudioNode,
      takes,
      buffer: (i) => (decoded[i] as unknown as AudioBuffer) ?? null,
      request: (i) => {
        requests.push(i);
      },
      release: (i) => {
        releases.push(i);
      },
    });
    const advance = (to: number) => {
      while (ctx.currentTime < to) {
        ctx.currentTime = Math.min(to, ctx.currentTime + 0.25);
        vi.advanceTimersByTime(250);
      }
    };
    return { ctx, out, player, requests, releases, advance, decoded };
  }

  it('plays take 1 from its start, then hands over to take 2 on the planned, sample-accurate schedule', () => {
    const { ctx, out, player, requests, releases, advance } = setup();
    expect(player.start(0, 0)).toBe(true);
    const first = ctx.started[0]!;
    expect(first.buffer!.name).toBe('take0');
    expect(first.startArgs).toEqual({ when: 0, offset: 0 });
    expect(reaches(first, out)).toBe(true);
    const fadeStart = A.outPoint - A.crossfade / 2;
    advance(fadeStart - PLAYLIST_PREFETCH - 1);
    expect(requests).toEqual([]);
    advance(fadeStart - PLAYLIST_PREFETCH + 0.5);
    expect(requests).toContain(1); // the next take is decoded well ahead
    advance(fadeStart - PLAYLIST_LOOKAHEAD - 0.5);
    expect(ctx.started).toHaveLength(1);
    advance(fadeStart - PLAYLIST_LOOKAHEAD + 0.5);
    expect(ctx.started).toHaveLength(2);
    const second = ctx.started[1]!;
    expect(second.buffer!.name).toBe('take1');
    expect(second.startArgs!.when).toBeCloseTo(fadeStart, 9);
    expect(second.startArgs!.offset).toBeCloseTo(B.inPoint - A.crossfade / 2, 9);
    // Equal-power curves on both items, over the same window.
    const inCurve = (second.outputs[0] as FakeGain).gain.history.find((h) => h.kind === 'curve')!;
    const outCurve = (first.outputs[0] as FakeGain).gain.history.find((h) => h.kind === 'curve')!;
    expect(inCurve.time).toBeCloseTo(fadeStart, 9);
    expect(outCurve.time).toBeCloseTo(fadeStart, 9);
    expect(inCurve.duration).toBeCloseTo(A.crossfade, 9);
    expect(inCurve.curve![0]).toBe(0);
    expect(outCurve.curve![0]).toBe(1);
    expect(first.stopAt).toBeCloseTo(fadeStart + A.crossfade + 0.05, 9);
    expect(player.history[0]!.handover.junction).toBeCloseTo(A.outPoint, 9);
    // Once the fade is over, take 1's buffer is released.
    advance(fadeStart + A.crossfade + 0.5);
    expect(releases).toEqual([0]);
    // Take 2 → take 1 on take 2's own schedule.
    const zero2 = fadeStart - (B.inPoint - A.crossfade / 2);
    advance(zero2 + B.outPoint - B.crossfade / 2 - PLAYLIST_LOOKAHEAD + 0.5);
    expect(ctx.started.map((s) => s.buffer!.name)).toEqual(['take0', 'take1', 'take0']);
    expect(ctx.started[2]!.startArgs!.offset).toBeCloseTo(A.inPoint - transitionCrossfade(B, A) / 2, 9);
    player.stop(ctx.currentTime);
    expect(ctx.started.every((s) => s.stopped)).toBe(true);
  });

  it('takes in different keys: the outgoing fades out to its out point, then the incoming starts at its in point', () => {
    const Akey = { ...A, key: 'D major' };
    const Bkey = { ...B, key: 'A♭ major' };
    const { ctx, player, releases, advance } = setup([true, true], [Akey, Bkey]);
    player.start(0, 0);
    const first = ctx.started[0]!;
    advance(A.outPoint - A.crossfade / 2 - PLAYLIST_LOOKAHEAD + 0.5);
    expect(ctx.started).toHaveLength(2);
    const second = ctx.started[1]!;
    const outCurve = (first.outputs[0] as FakeGain).gain.history.find((h) => h.kind === 'curve')!;
    const inCurve = (second.outputs[0] as FakeGain).gain.history.find((h) => h.kind === 'curve')!;
    // Fade-out ends exactly at A's out point; B starts there (not earlier) from its in point.
    expect(outCurve.time).toBeCloseTo(A.outPoint - A.crossfade, 9);
    expect(outCurve.time + outCurve.duration!).toBeCloseTo(A.outPoint, 9);
    expect(second.startArgs!.when).toBeGreaterThanOrEqual(outCurve.time + outCurve.duration! - 1e-9);
    expect(second.startArgs!.offset).toBeCloseTo(B.inPoint, 9);
    expect(inCurve.time).toBeCloseTo(A.outPoint, 9);
    expect(inCurve.duration).toBeCloseTo(KEY_CHANGE_FADE_IN, 9);
    expect(inCurve.curve![0]).toBe(0);
    expect(first.stopAt).toBeCloseTo(A.outPoint + 0.05, 9);
    expect(player.history[0]!.handover.mode).toBe('sequential');
    advance(A.outPoint + KEY_CHANGE_FADE_IN + 0.5);
    expect(releases).toEqual([0]);
    // B → A: the same, on B's own schedule.
    const zero2 = A.outPoint - B.inPoint;
    advance(zero2 + B.outPoint - B.crossfade / 2 - PLAYLIST_LOOKAHEAD + 0.5);
    expect(ctx.started.map((s) => s.buffer!.name)).toEqual(['take0', 'take1', 'take0']);
    expect(ctx.started[2]!.startArgs!.when).toBeCloseTo(zero2 + B.outPoint, 9);
    expect(ctx.started[2]!.startArgs!.offset).toBeCloseTo(A.inPoint, 9);
    player.stop(ctx.currentTime);
    expect(ctx.started.every((s) => s.stopped)).toBe(true);
  });

  it('cross-fades take 1 into itself when take 2 is not decoded in time (no gap, no hard loop)', () => {
    const { ctx, player, advance } = setup([true, false]);
    player.start(0, 0);
    advance(A.outPoint - A.crossfade / 2 - PLAYLIST_LOOKAHEAD + 0.5);
    expect(ctx.started.map((s) => s.buffer!.name)).toEqual(['take0', 'take0']);
    expect(ctx.started[1]!.startArgs!.offset).toBeCloseTo(A.inPoint - A.crossfade / 2, 9);
    player.stop(ctx.currentTime);
  });
});

/* ----------------------------------------------------------- the engine */

let engines: AudioPort[] = [];
function engineWith(opts: { missing?: string[]; broken?: string[]; manifest?: unknown } = {}) {
  FakeContext.instances = [];
  FakeContext.durations = new Map<string, number>();
  for (const theme of THEME_IDS) {
    for (const t of studio.music[theme]!.takes) FakeContext.durations.set(t.file, t.duration);
    for (const s of [studio.stingers[theme]!.win!, studio.stingers[theme]!.jackpot!]) FakeContext.durations.set(s.files[0]!, s.duration);
    FakeContext.durations.set(shipped.music[theme]!.file, shipped.music[theme]!.duration);
  }
  const made = makeFakeEnv({ manifest: opts.manifest ?? shipped, missing: opts.missing, broken: opts.broken });
  const engine = createAudioEngine({ env: made.env });
  engines.push(engine);
  return { engine, ...made };
}

beforeEach(() => {
  engines = [];
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  for (const e of engines) e.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const takeFile = (theme: (typeof THEME_IDS)[number], i: number) => studio.music[theme]!.takes[i]!.file;

describe('AudioEngine with studio recordings', () => {
  it('plays the theme play-list and downloads only that theme (plus the shared effects)', async () => {
    const { engine, fetched } = engineWith();
    engine.setTheme('sakura');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    expect(engine.status()).toMatchObject({ state: 'running', musicTheme: 'sakura', usingFallbackSynth: false });
    expect(engine.status().detail).toMatch(/studio music/);
    const music = ctx.playing(takeFile('sakura', 0));
    expect(music).toHaveLength(1);
    expect(music[0]!.loop).toBe(false); // a play-list, not a hard loop
    expect(music[0]!.startArgs!.offset).toBe(0);
    expect(reaches(music[0]!, ctx.gains[BUS.musicMain]!)).toBe(true);
    // Lazy per theme: sakura's takes, stingers and voices; nothing of another theme; no synthesised track.
    const studioFiles = fetched.filter((f) => f.startsWith('studio/'));
    for (const theme of THEME_IDS.filter((t) => t !== 'sakura')) {
      expect(studioFiles.some((f) => f.includes(`/${theme}_`) || f.includes(`/voices/${theme}/`)), theme).toBe(false);
    }
    expect(studioFiles).toContain(takeFile('sakura', 1));
    expect(studioFiles).toContain(studio.stingers.sakura!.win!.files[0]);
    expect(studioFiles.some((f) => f.startsWith('studio/voices/sakura/'))).toBe(true);
    expect(fetched.filter((f) => f.startsWith('music/'))).toEqual([]);
    // Synthesised effects a studio sample replaces are not downloaded.
    expect(fetched).not.toContain('sfx/start_game_1.wav');
    expect(fetched).toContain(studio.sfx.start_game!.files[0]);
  });

  it('cross-fades to the next theme’s play-list and stops the old one', async () => {
    const { engine } = engineWith();
    engine.setTheme('sakura');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    engine.setTheme('cosmic');
    await flush(30);
    expect(engine.status().musicTheme).toBe('cosmic');
    const old = ctx.started.find((s) => s.buffer?.name === takeFile('sakura', 0))!;
    expect(old.stopped).toBe(true);
    expect(old.stopAt!).toBeGreaterThan(ctx.currentTime); // faded, not cut
    expect(ctx.playing(takeFile('cosmic', 0))).toHaveLength(1);
  });

  it('falls back to the synthesised track when a theme’s studio take cannot be loaded', async () => {
    const { engine } = engineWith({ missing: [takeFile('ocean', 0)] });
    engine.setTheme('ocean');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    expect(engine.status().musicTheme).toBe('ocean');
    expect(engine.status().detail).toMatch(/studio music unavailable for ocean/);
    const synth = ctx.playing(shipped.music.ocean!.file);
    expect(synth).toHaveLength(1);
    expect(synth[0]!.loop).toBe(true);
  });

  it('also falls back when a studio take does not decode', async () => {
    const { engine } = engineWith({ broken: [takeFile('gpu', 0)] });
    engine.setTheme('gpu');
    await engine.unlock();
    await flush(30);
    expect(playbackContext().playing(shipped.music.gpu!.file)).toHaveLength(1);
  });

  it('replaces or layers effects as the manifest says, and brings a synthesised effect back when its sample fails', async () => {
    const failing = studio.sfx.empty_grab!.files[0]!;
    const { engine, clock, fetched } = engineWith({ missing: [failing] });
    engine.setTheme('storybook');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    const names = () => ctx.started.map((s) => s.buffer?.name);
    let before = ctx.started.length;
    clock.now += 100;
    engine.playSfx('start_game');
    expect(names().slice(before)).toEqual([studio.sfx.start_game!.files[0]]);
    before = ctx.started.length;
    clock.now += 100;
    engine.playSfx('claw_close'); // layer: synthesised + studio
    expect(names().slice(before).sort()).toEqual(expect.arrayContaining([studio.sfx.claw_close!.files[0], expect.stringMatching(/^sfx\/claw_close_\d\.wav$/)]));
    expect(ctx.started.length - before).toBe(2);
    // The failed studio sample: its synthesised variants were fetched after all and play.
    expect(fetched.filter((f) => /^sfx\/empty_grab_\d\.wav$/.test(f)).length).toBeGreaterThan(0);
    before = ctx.started.length;
    clock.now += 100;
    engine.playSfx('empty_grab');
    expect(names().slice(before)[0]).toMatch(/^sfx\/empty_grab_\d\.wav$/);
    for (const s of ctx.started.slice(before)) expect(reaches(s, ctx.gains[BUS.sfx]!)).toBe(true);
  });

  it('uses the studio motor loop with its own level', async () => {
    const { engine } = engineWith();
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    engine.setLoop('motor_trolley', 1, 1.1);
    const loop = ctx.started.find((s) => s.loop && s.buffer?.name === studio.loops.motor_trolley!.file)!;
    expect(loop).toBeDefined();
    expect((loop.outputs[0] as FakeGain).gain.value).toBeCloseTo(studio.loops.motor_trolley!.gain, 6);
    expect(loop.playbackRate.value).toBeCloseTo(1.1, 6);
    engine.setLoop('motor_trolley', 0);
  });

  it('previews the studio recording from its in point on the preview bus', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { engine } = engineWith();
    engine.setTheme('sakura');
    const unlocking = engine.unlock();
    await vi.advanceTimersByTimeAsync(10);
    await unlocking;
    await vi.advanceTimersByTimeAsync(50);
    const ctx = playbackContext();
    engine.previewTrack('ocean');
    await vi.advanceTimersByTimeAsync(50);
    const p = ctx.playing(takeFile('ocean', 0)).find((s) => reaches(s, ctx.gains[BUS.preview]!))!;
    expect(p).toBeDefined();
    expect(p.startArgs!.offset).toBeCloseTo(studio.music.ocean!.takes[0]!.inPoint, 9);
    expect(ctx.gains[BUS.musicMain]!.gain.value).toBe(0);
    engine.previewTrack(null);
    expect(ctx.gains[BUS.musicMain]!.gain.value).toBe(1);
  });
});

/* ------------------------------------------------------ dramatic layer */

describe('character voices', () => {
  it('voices each moment differently: win brighter with a sparkle, slip lower', () => {
    const fixed = () => 0.5;
    const lift = characterVoicing('lift', fixed);
    const win = characterVoicing('win', fixed);
    const slip = characterVoicing('slip', fixed);
    expect(win.rate).toBeGreaterThan(lift.rate);
    expect(slip.rate).toBeLessThan(lift.rate);
    expect(win.layer?.name).toBe('sparkle');
    expect(lift.layer).toBeNull();
    expect(slip.layer).toBeNull();
    for (const m of [lift, win, slip]) expect(m.delay).toBeGreaterThanOrEqual(0);
  });

  it('never repeats a character within its cooldown, and keeps a short gap between characters', () => {
    const gate = new CooldownGate();
    expect(gate.allow('sakura.bunny', 0)).toBe(true);
    expect(gate.allow('sakura.bunny', CHARACTER_COOLDOWN_MS - 1)).toBe(false);
    expect(gate.allow('sakura.tanuki', 100)).toBe(false); // global gap
    expect(gate.allow('sakura.tanuki', 400)).toBe(true);
    expect(gate.allow('sakura.bunny', CHARACTER_COOLDOWN_MS + 1)).toBe(true);
  });

  it('lets a character escalate inside its cooldown (lift → slip → win), never repeat or step back', () => {
    // Headless rounds: a lifted toy slips 0.37–1.79 s after liftStarted, well inside the cooldown.
    const gate = new CooldownGate();
    expect(gate.allow('sakura.bunny', 0, 'lift')).toBe(true);
    expect(gate.allow('sakura.bunny', 400, 'lift')).toBe(false);
    expect(gate.allow('sakura.bunny', 450, 'slip')).toBe(true);
    expect(gate.allow('sakura.bunny', 900, 'slip')).toBe(false);
    expect(gate.allow('sakura.bunny', 1200, 'lift')).toBe(false);
    expect(gate.allow('sakura.bunny', 1500, 'win')).toBe(true); // slipped, but bounced into the chute
    expect(gate.allow('sakura.tanuki', 1600, 'win')).toBe(false); // other characters still keep the gap
    expect(gate.allow('sakura.bunny', 2000, 'slip')).toBe(false);
  });

  it('gives characters without a voice a squeak at their own, stable pitch', () => {
    expect(squeakPitch('x.a')).toBe(squeakPitch('x.a'));
    const pitches = Object.keys(RARITY_TABLE).map(squeakPitch);
    for (const p of pitches) {
      expect(p).toBeGreaterThanOrEqual(0.82);
      expect(p).toBeLessThanOrEqual(1.24);
    }
    expect(new Set(pitches.map((p) => p.toFixed(2))).size).toBeGreaterThan(15);
  });

  it('plays a character’s own voice on the effects bus, layered for a win, with a cooldown; unknown ids squeak', async () => {
    const { engine, clock } = engineWith();
    engine.setTheme('sakura');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    const voice = studio.voices['sakura.bunny']!;
    let before = ctx.started.length;
    engine.playCharacter('sakura.bunny', 'win');
    const started = ctx.started.slice(before);
    const v = started.find((s) => s.buffer?.name === voice.file)!;
    expect(v).toBeDefined();
    expect(v.playbackRate.value).toBeGreaterThan(1.08);
    expect((v.outputs[0] as FakeGain).gain.value).toBeCloseTo(voice.gain, 6);
    expect(reaches(v, ctx.gains[BUS.sfx]!)).toBe(true);
    expect(started.some((s) => s.buffer?.name === studio.sfx.sparkle!.files[0])).toBe(true);
    // Cooldown: the same character again right away is ignored.
    before = ctx.started.length;
    clock.now += 500;
    engine.playCharacter('sakura.bunny', 'slip');
    expect(ctx.started.length).toBe(before);
    clock.now += CHARACTER_COOLDOWN_MS;
    engine.playCharacter('sakura.bunny', 'slip');
    const slip = ctx.started.slice(before).find((s) => s.buffer?.name === voice.file)!;
    expect(slip.playbackRate.value).toBeLessThan(0.9);
    // An id without a recording: the synthesised squeak, pitched for that id.
    before = ctx.started.length;
    clock.now += 1000;
    engine.playCharacter('future.friend', 'lift');
    const squeak = ctx.started.slice(before)[0]!;
    expect(squeak.buffer!.name).toMatch(/^sfx\/plush_squeak_\d\.wav$/);
    expect(squeak.playbackRate.value).toBeGreaterThan(squeakPitch('future.friend') * 0.9);
    expect(squeak.playbackRate.value).toBeLessThan(squeakPitch('future.friend') * 1.1);
  });

  it('layers the character’s own squeak under a near-empty voice (< 0.4 s), not under a full one', async () => {
    const { engine, clock } = engineWith();
    // The shipped voices are all longer than SHORT_VOICE_S now; the engine decides on the decoded
    // buffer's length, so a near-empty recording is simulated by decoding it as 0.1 s.
    const short = studio.voices['storybook.astronaut']!;
    const full = studio.voices['storybook.cowpony']!;
    expect(full.duration).toBeGreaterThan(SHORT_VOICE_S);
    FakeContext.durations.set(short.file, 0.1);
    FakeContext.durations.set(full.file, full.duration);
    engine.setTheme('storybook');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    let before = ctx.started.length;
    engine.playCharacter('storybook.astronaut', 'lift');
    const blip = ctx.started.slice(before);
    expect(blip).toHaveLength(2);
    expect(blip[0]!.buffer!.name).toBe(short.file);
    expect(blip[1]!.buffer!.name).toMatch(/^sfx\/plush_squeak_\d\.wav$/);
    // The squeak is pitched for this character (× the moment's rate, ± the effect's own variation).
    const want = squeakPitch('storybook.astronaut') * blip[0]!.playbackRate.value;
    expect(blip[1]!.playbackRate.value).toBeGreaterThan(want * 0.9);
    expect(blip[1]!.playbackRate.value).toBeLessThan(want * 1.1);
    clock.now += 1000;
    before = ctx.started.length;
    engine.playCharacter('storybook.cowpony', 'lift');
    const voiced = ctx.started.slice(before);
    expect(voiced).toHaveLength(1);
    expect(voiced[0]!.buffer!.name).toBe(full.file);
  });

  it('a lifted toy that slips cries out at once, cutting its lift voice short without a click', async () => {
    const { engine, clock } = engineWith();
    engine.setTheme('sakura');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    const voice = studio.voices['sakura.capybara']!;
    let before = ctx.started.length;
    engine.playCharacter('sakura.capybara', 'lift', { delay: 0.25 });
    const lift = ctx.started.slice(before).find((s) => s.buffer?.name === voice.file)!;
    expect(lift).toBeDefined();
    // A light music duck under the cry (no win is ringing), released as it ends.
    const duck = ctx.gains[BUS.stingerDuck]!.gain.history.filter((h) => h.kind === 'target');
    expect(duck.at(-2)).toMatchObject({ value: CHARACTER_DUCK });
    expect(duck.at(-1)).toMatchObject({ value: 1 });
    before = ctx.started.length;
    clock.now += 450;
    engine.playCharacter('sakura.capybara', 'slip');
    const slip = ctx.started.slice(before).find((s) => s.buffer?.name === voice.file)!;
    expect(slip).toBeDefined();
    expect(slip.playbackRate.value).toBeLessThan(lift.playbackRate.value);
    // The lift cry fades to zero (time constant 15 ms) before its source stops.
    expect(lift.stopped).toBe(true);
    expect((lift.outputs[0] as FakeGain).gain.history.at(-1)).toMatchObject({ kind: 'target', value: 0 });
    expect(lift.stopAt!).toBeGreaterThanOrEqual(ctx.currentTime + 0.09);
    expect(slip.stopped).toBe(false);
    // The same moment again inside the cooldown stays ignored.
    before = ctx.started.length;
    clock.now += 300;
    engine.playCharacter('sakura.capybara', 'slip');
    expect(ctx.started.length).toBe(before);
  });
});

describe('tier-aware wins', () => {
  it('layers by tier', () => {
    const all = { win: true, jackpot: true };
    const names = (tier: Parameters<typeof winPlan>[0], a = all) => winPlan(tier, a).map((p) => (p.kind === 'stinger' ? `stinger:${p.which}` : p.name));
    expect(names('common')).toEqual(['stinger:win']);
    expect(names('rare')).toEqual(['stinger:win', 'sparkle']);
    expect(names('epic')).toEqual(['stinger:win', 'confetti', 'firework']);
    expect(names('legendary')).toEqual(['stinger:jackpot', 'jackpot', 'firework']);
    expect(names('legendary', { win: true, jackpot: false })).toEqual(['stinger:win', 'jackpot', 'firework']);
    expect(names('rare', { win: false, jackpot: false })).toEqual(['win', 'sparkle']);
  });

  it('plays the theme’s jackpot fanfare for a legendary win, ducks the music, and never stacks wins', async () => {
    const { engine, clock } = engineWith();
    engine.setTheme('gpu');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    let before = ctx.started.length;
    engine.playWin('gpu', 'legendary');
    const names = ctx.started.slice(before).map((s) => s.buffer!.name);
    expect(names).toContain(studio.stingers.gpu!.jackpot!.files[0]);
    expect(names).toContain(studio.sfx.jackpot!.files[0]);
    expect(names).toContain(studio.sfx.firework!.files[0]);
    const duck = ctx.gains[BUS.stingerDuck]!.gain.history.filter((h) => h.kind === 'target');
    expect(duck.at(-2)!.value).toBeLessThan(0.3);
    expect(duck.at(-1)!.value).toBe(1);
    // A character crying out while the fanfare rings leaves the (deeper) win duck alone.
    const duckEvents = ctx.gains[BUS.stingerDuck]!.gain.history.length;
    clock.now += 500;
    engine.playCharacter('gpu.card', 'slip');
    expect(ctx.gains[BUS.stingerDuck]!.gain.history.length).toBe(duckEvents);
    // A second win (or the result's plain 'win') while the fanfare rings is ignored.
    before = ctx.started.length;
    clock.now += 1000;
    engine.playWin('gpu', 'common');
    engine.playSfx('win');
    expect(ctx.started.length).toBe(before);
    clock.now += 10_000;
    engine.playSfx('win'); // the studio win stinger (common)
    expect(ctx.started.slice(before).map((s) => s.buffer!.name)).toEqual([studio.stingers.gpu!.win!.files[0]]);
  });

  it('epic: win stinger + confetti (synthesised and studio) + firework', async () => {
    const { engine } = engineWith();
    engine.setTheme('ocean');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    const before = ctx.started.length;
    engine.playWin('ocean', 'epic');
    const names = ctx.started.slice(before).map((s) => s.buffer!.name);
    expect(names).toContain(studio.stingers.ocean!.win!.files[0]);
    expect(names).toContain(studio.sfx.confetti!.files[0]);
    expect(names.some((n) => /^sfx\/confetti_\d\.wav$/.test(n))).toBe(true);
    expect(names).toContain(studio.sfx.firework!.files[0]);
  });

  it('falls back to the synthesised theme jingle when the stingers are missing', async () => {
    const st = studio.stingers.cosmic!;
    const { engine } = engineWith({ missing: [st.win!.files[0]!, st.jackpot!.files[0]!] });
    engine.setTheme('cosmic');
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    const before = ctx.started.length;
    engine.playWin('cosmic', 'rare');
    const names = ctx.started.slice(before).map((s) => s.buffer!.name);
    expect(names).toContain('sfx/win_cosmic.wav');
    expect(names).toContain(studio.sfx.sparkle!.files[0]);
  });
});

describe('attract chime', () => {
  it('chimes every 20–30 s while attract mode is on and the setting allows it', async () => {
    expect(attractChimeDelayMs(() => 0)).toBe(20_000);
    expect(attractChimeDelayMs(() => 0.999)).toBeLessThan(30_000);
    const { engine, clock } = engineWith();
    await engine.unlock();
    await flush(30);
    const ctx = playbackContext();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const chimes = () => ctx.started.filter((s) => s.buffer?.name === studio.sfx.attract_chime!.files[0]);
    // The engine's clock and its timers move together, one second at a time.
    const pass = (ms: number) => {
      for (let t = 0; t < ms; t += 1000) {
        clock.now += 1000;
        vi.advanceTimersByTime(1000);
      }
    };
    engine.setAttract(true);
    pass(19_000);
    expect(chimes()).toHaveLength(0);
    pass(12_000);
    expect(chimes()).toHaveLength(1);
    const gain = (chimes()[0]!.outputs[0] as FakeGain).gain.value;
    expect(gain).toBeLessThan(studio.sfx.attract_chime!.gain); // reduced level
    pass(60_000);
    expect(chimes().length).toBeGreaterThanOrEqual(3);
    const n = chimes().length;
    engine.setAttractChime(false);
    pass(60_000);
    expect(chimes()).toHaveLength(n);
    engine.setAttractChime(true);
    engine.setAttract(false);
    pass(60_000);
    expect(chimes()).toHaveLength(n);
  });
});

// Keep the type import used (FakeSource is referenced by helpers' return types).
export type { FakeSource };
