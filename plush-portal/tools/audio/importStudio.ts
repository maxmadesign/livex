/**
 * Imports the generated ("studio") recordings into public/audio/studio/ and the `studio`
 * section of public/audio/manifest.json.
 *
 *   npx tsx tools/audio/importStudio.ts --src <dir> [--urls <dir>/urls.tsv] [--report <file.json>]
 *
 * <dir> holds the raw downloads: music/<theme>_a.mp3 + <theme>_b.mp3, stingers/<theme>_win.mp3 +
 * <theme>_jackpot.mp3, sfx/<name>.mp3, voices/<assetId>.mp3. `urls.tsv` ("music/sakura_a<TAB>url")
 * records which Higgsfield result each file is; its basename is stored as provenance.
 *
 * Processing (needs ffmpeg with libmp3lame):
 *  - music: trim leading / trailing silence, estimate tempo, beats and bar lines, find where the
 *    generated intro ends and the outro starts, choose bar-aligned in / out points and a
 *    whole-beat cross-fade, normalise to −16 LUFS integrated with true peak ≤ −1 dBTP, MP3 160 kbit/s;
 *    the cross-fades between the takes are rendered and measured from the encoded files;
 *  - stingers: trim, fades, peak-normalise, MP3; play level (manifest gain) matched to the synthesised win jingle;
 *  - effects and voices: trim to the active sound, gate the generator's noise floor between events,
 *    click-free fades, DC removal, peak-normalise, 16-bit mono WAV (the format of the existing effects);
 *    play level matched to the synthesised effect they replace or join;
 *  - the trolley motor becomes a seamless loop (equal-power wrap cross-fade on a matched waveform position).
 * The synthesised set is never touched; it stays the fallback for every entry.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoopName, SfxName } from '../../src/core/contracts';
import { THEME_IDS, type ThemeId } from '../../src/core/types';
import {
  STUDIO_SCHEMA,
  studioSharedFiles,
  studioThemeFiles,
  type StudioLoop,
  type StudioManifest,
  type StudioOneShot,
  type StudioPlaylist,
  type StudioSource,
  type StudioTake,
  type StudioVoice,
} from '../../src/audio/studio/manifest';
import { transitionCrossfade } from '../../src/audio/studio/playlist';
import { decodeWav16, encodeWav16 } from '../../src/audio/synth/wav';
import {
  activeRegion,
  beatTimes,
  chooseTakePoints,
  dbToGain,
  durationOf,
  estimateDownbeats,
  estimateKey,
  estimateTempo,
  fadeEdges,
  frames,
  gainToDb,
  gate,
  loudnessEnvelope,
  makeSeamlessLoop,
  maxMomentaryLoudness,
  mono,
  onsetEnvelopes,
  removeDc,
  samplePeakDb,
  scale,
  sideToMidDb,
  simulateTransition,
  slicePcm,
  unusableReason,
  type Pcm,
  type TransitionReport,
} from './lib/studioAnalysis';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = path.join(ROOT, 'public', 'audio');
const STUDIO_DIR = 'studio';
const SR = 44100;

const args = process.argv.slice(2);
const argValue = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1]! : null;
};
const SRC = argValue('--src') ?? process.env.PLUSH_STUDIO_SRC ?? '';
const URLS = argValue('--urls') ?? (SRC ? path.join(SRC, 'urls.tsv') : '');
const REPORT = argValue('--report');
const BITRATE = argValue('--bitrate') ?? '160k';

export const LICENCE =
  'AI-generated through Higgsfield (music: ElevenLabs Music v2.5; effects: Mirelo text-to-audio) and processed by ' +
  'tools/audio/importStudio.ts. Check the Higgsfield / ElevenLabs terms for commercial use before shipping commercially.';

/* ------------------------------------------------------------------- ffmpeg */

function run(cmd: string, cmdArgs: string[], maxBuffer = 1024 * 1024 * 64): { ok: boolean; stdout: Buffer; stderr: string } {
  const res = spawnSync(cmd, cmdArgs, { maxBuffer });
  return { ok: res.status === 0, stdout: res.stdout ?? Buffer.alloc(0), stderr: (res.stderr?.toString() ?? '') + (res.error ? String(res.error) : '') };
}

function decode(file: string, channels = 2): Pcm {
  const res = run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', String(channels), '-ar', String(SR), '-'], 1024 * 1024 * 512);
  if (!res.ok) throw new Error(`ffmpeg could not decode ${file}: ${res.stderr}`);
  const all = new Float32Array(res.stdout.buffer, res.stdout.byteOffset, res.stdout.byteLength / 4);
  const n = Math.floor(all.length / channels);
  const out: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = all[i * channels + c]!;
    out.push(ch);
  }
  return { sampleRate: SR, channels: out };
}

/** Float WAV for handing processed audio to the encoder without quantising twice. */
function writeFloatWav(file: string, p: Pcm): void {
  const ch = p.channels.length;
  const n = frames(p);
  const data = Buffer.alloc(n * ch * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) data.writeFloatLE(p.channels[c]![i]!, (i * ch + c) * 4);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(ch, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * ch * 4, 28);
  header.writeUInt16LE(ch * 4, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}

function encodeMp3(src: string, target: string, channels: number): void {
  const res = run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
    '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
    // CBR (predictable size and frame timing); LAME's high-quality algorithm (-q 2).
    '-c:a', 'libmp3lame', '-b:a', BITRATE, '-compression_level', '2', '-ar', String(SR), '-ac', String(channels), target,
  ]);
  if (!res.ok) throw new Error(`ffmpeg could not encode ${target}: ${res.stderr}`);
}

/** Integrated loudness, loudness range and true peak as ffmpeg's ebur128 filter measures them. */
function ebur128(file: string): { lufs: number; lra: number; truePeak: number } {
  const res = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
  const text = res.stderr;
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const num = (re: RegExp) => {
    const m = re.exec(summary);
    return m ? Number(m[1]) : NaN;
  };
  return { lufs: num(/I:\s+(-?[\d.]+) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), truePeak: num(/Peak:\s+(-?[\d.inf]+) dBFS/) };
}

/* --------------------------------------------------------------- provenance */

function readUrls(): Map<string, string> {
  const map = new Map<string, string>();
  if (!URLS || !existsSync(URLS)) return map;
  for (const line of readFileSync(URLS, 'utf8').split('\n')) {
    const [key, url] = line.split('\t');
    if (key && url) map.set(key.trim(), url.trim());
  }
  return map;
}
const urls = readUrls();

function source(kind: 'music' | 'stingers' | 'sfx' | 'voices', name: string): StudioSource {
  const url = urls.get(`${kind}/${name}`);
  const model =
    kind === 'music' ? 'ElevenLabs Music v2.5' : kind === 'stingers' ? 'not recorded per file (ElevenLabs Music v2.5 or Mirelo text-to-audio)' : 'Mirelo text-to-audio';
  return { generator: 'Higgsfield', model, job: url ? path.basename(new URL(url).pathname) : null, input: `${kind}/${name}.mp3` };
}

/* ------------------------------------------------------- reference levels */

/** Loudest 400 ms of each synthesised effect as it plays (file level + manifest gain), LUFS. */
function synthReferences(manifest: { sfx: Record<string, { files: string[]; gain: number }>; loops: Record<string, { file: string; gain: number }> }): {
  sfx: Map<string, number>;
  loops: Map<string, number>;
} {
  const sfx = new Map<string, number>();
  for (const [name, e] of Object.entries(manifest.sfx)) {
    let best = -120;
    for (const f of e.files) {
      const full = path.join(OUT, f);
      if (!existsSync(full)) continue;
      const wav = decodeWav16(new Uint8Array(readFileSync(full)));
      best = Math.max(best, maxMomentaryLoudness({ sampleRate: wav.sampleRate, channels: wav.data }));
    }
    sfx.set(name, best + gainToDb(e.gain));
  }
  const loops = new Map<string, number>();
  for (const [name, e] of Object.entries(manifest.loops)) {
    const wav = decodeWav16(new Uint8Array(readFileSync(path.join(OUT, e.file))));
    const env = loudnessEnvelope({ sampleRate: wav.sampleRate, channels: wav.data }, 0.4, 0.05);
    const mean = 10 * Math.log10(Array.from(env).reduce((a, v) => a + Math.pow(10, v / 10), 0) / env.length);
    loops.set(name, mean + gainToDb(e.gain));
  }
  return { sfx, loops };
}

/* -------------------------------------------------------------------- music */

interface TakeReport {
  theme: ThemeId;
  take: string;
  rawDuration: number;
  trimmedLead: number;
  trimmedTail: number;
  bpm: number;
  beatStrength: number;
  downbeatConfidence: number;
  sourceLufs: number;
  gainDb: number;
  take_: StudioTake;
  notes: string[];
}

interface TransitionLine {
  theme: ThemeId;
  from: string;
  to: string;
  crossfade: number;
  beatDriftMs: number;
  report: TransitionReport;
}

const SILENCE_DB = -60;

function trimSilence(p: Pcm): { pcm: Pcm; lead: number; tail: number } {
  const m = mono(p);
  const thr = dbToGain(SILENCE_DB);
  let a = 0;
  while (a < m.length && Math.abs(m[a]!) < thr) a++;
  let b = m.length;
  while (b > a && Math.abs(m[b - 1]!) < thr) b--;
  // Keep 5 ms around the first / last audible sample.
  a = Math.max(0, a - Math.round(0.005 * SR));
  b = Math.min(m.length, b + Math.round(0.005 * SR));
  return { pcm: slicePcm(p, a / SR, b / SR), lead: a / SR, tail: (m.length - b) / SR };
}

function processMusic(tmp: string, report: { takes: TakeReport[]; transitions: TransitionLine[] }): Partial<Record<ThemeId, StudioPlaylist>> {
  const out: Partial<Record<ThemeId, StudioPlaylist>> = {};
  const dir = path.join(OUT, STUDIO_DIR, 'music');
  mkdirSync(dir, { recursive: true });
  for (const theme of THEME_IDS) {
    const takes: StudioTake[] = [];
    const decoded: Pcm[] = [];
    for (const suffix of ['a', 'b']) {
      const name = `${theme}_${suffix}`;
      const input = path.join(SRC, 'music', `${name}.mp3`);
      if (!existsSync(input)) {
        console.warn(`music  ${name}: missing input, skipped`);
        continue;
      }
      const raw = decode(input);
      const { pcm, lead, tail } = trimSilence(raw);
      const duration = durationOf(pcm);
      // Tempo, beats and bar lines from an 11 kHz mono copy.
      const m = mono(pcm);
      const down = new Float32Array(Math.floor(m.length / 4));
      for (let i = 0; i < down.length; i++) down[i] = (m[i * 4]! + m[i * 4 + 1]! + m[i * 4 + 2]! + m[i * 4 + 3]!) / 4;
      const onsets = onsetEnvelopes(down, SR / 4, 128);
      const tempo = estimateTempo(onsets);
      const beats = beatTimes(tempo, duration);
      const st = loudnessEnvelope(pcm, 3, 0.1);
      const bars = estimateDownbeats(onsets, beats, { env: st, hop: 0.1 });
      const points = chooseTakePoints(pcm, tempo.bpm, bars.times);
      const key = estimateKey(down, SR / 4);
      // Loudness: −16 LUFS integrated, true peak ≤ −1 dBTP, both measured on the encoded file
      // (the encoder's low-pass changes the K-weighted level slightly, so this iterates).
      const srcWav = path.join(tmp, `${name}.src.wav`);
      writeFloatWav(srcWav, pcm);
      const srcLoud = ebur128(srcWav);
      let gainDb = -16 - srcLoud.lufs;
      if (srcLoud.truePeak + gainDb > -1.2) gainDb = -1.2 - srcLoud.truePeak;
      const target = path.join(dir, `${name}.mp3`);
      let measured = { lufs: NaN, lra: NaN, truePeak: NaN };
      for (let attempt = 0; attempt < 4; attempt++) {
        const processed: Pcm = { sampleRate: SR, channels: pcm.channels.map((c) => Float32Array.from(c)) };
        scale(processed, dbToGain(gainDb));
        fadeEdges(processed, 3, 20);
        const procWav = path.join(tmp, `${name}.proc.wav`);
        writeFloatWav(procWav, processed);
        encodeMp3(procWav, target, 2);
        measured = ebur128(target);
        const tpRoom = -1 - measured.truePeak;
        const lufsError = -16 - measured.lufs;
        if (tpRoom >= 0 && Math.abs(lufsError) <= 0.1) break;
        gainDb += Math.min(lufsError, tpRoom - 0.1);
      }
      const back = decode(target);
      decoded.push(back);
      const take: StudioTake = {
        file: `${STUDIO_DIR}/music/${name}.mp3`,
        bytes: statSync(target).size,
        duration: round(durationOf(back), 4),
        bpm: round(tempo.bpm, 3),
        beatsPerBar: 4,
        key: key.key,
        inPoint: round(points.inPoint, 4),
        outPoint: round(points.outPoint, 4),
        crossfade: round(points.crossfade, 4),
        crossfadeBeats: points.crossfadeBeats,
        lufs: round(measured.lufs, 2),
        truePeakDb: round(measured.truePeak, 2),
        source: source('music', name),
      };
      takes.push(take);
      report.takes.push({
        theme,
        take: name,
        rawDuration: durationOf(raw),
        trimmedLead: lead,
        trimmedTail: tail,
        bpm: tempo.bpm,
        beatStrength: tempo.beatStrength,
        downbeatConfidence: bars.confidence,
        sourceLufs: srcLoud.lufs,
        gainDb,
        take_: take,
        notes: [...points.notes, `intro end ${points.introEnd.toFixed(2)} s, outro start ${points.outroStart.toFixed(2)} s, body ${points.bodyLufs.toFixed(1)} LUFS (pre-gain)`],
      });
      console.log(
        `music  ${name.padEnd(13)} ${durationOf(back).toFixed(2)} s  ${tempo.bpm.toFixed(2)} BPM (beat strength ${tempo.beatStrength.toFixed(2)}, bar conf ${bars.confidence.toFixed(2)})  ${key.key} (r ${key.correlation.toFixed(2)})  ` +
          `in ${take.inPoint.toFixed(2)}  out ${take.outPoint.toFixed(2)}  xfade ${take.crossfade.toFixed(2)} s/${take.crossfadeBeats} beats  ` +
          `${measured.lufs.toFixed(1)} LUFS  TP ${measured.truePeak.toFixed(1)} dBTP  ${(take.bytes / 1e6).toFixed(2)} MB`,
      );
    }
    if (takes.length === 0) continue;
    // Render every hand-over exactly as the engine schedules it and measure it.
    for (let i = 0; i < takes.length; i++) {
      const j = (i + 1) % takes.length;
      const a = takes[i]!;
      const b = takes[j]!;
      const xfade = transitionCrossfade(a, b);
      const rep = simulateTransition(decoded[i]!, a.outPoint, decoded[j]!, b.inPoint, xfade);
      // The grids meet in the middle of the fade; at its edges they are this far apart.
      const beatsInFade = Math.round(xfade / (60 / a.bpm));
      const drift = Math.abs((beatsInFade / 2) * (60 / a.bpm - 60 / b.bpm)) * 1000;
      report.transitions.push({ theme, from: a.file, to: b.file, crossfade: xfade, beatDriftMs: drift, report: rep });
      console.log(
        `       ${path.basename(a.file)} → ${path.basename(b.file)} (${xfade.toFixed(2)} s): before ${rep.before.toFixed(1)} / during ${rep.meanDuring.toFixed(1)} (${rep.minDuring.toFixed(1)}…${rep.maxDuring.toFixed(1)}) / after ${rep.after.toFixed(1)} LUFS, ` +
          `fade vs power sum ≤ ${rep.maxDeviation.toFixed(1)} LU, largest step ×${rep.maxStepRatio.toFixed(2)} of the music's own, beat drift at the fade edges ${drift.toFixed(0)} ms`,
      );
    }
    out[theme] = { title: `${THEME_TITLES[theme]} (studio set)`, takes };
  }
  return out;
}

const THEME_TITLES: Record<ThemeId, string> = {
  sakura: 'Sakura Kawaii',
  storybook: 'Storybook Friends',
  ocean: 'Ocean Dream',
  cosmic: 'Cosmic Arcade',
  gpu: 'GPU Party',
};

/* -------------------------------------------------------------- one-shots */

interface OneShotPlan {
  /** Output file name (without extension) under studio/<dir>/. */
  out: string;
  dir: 'sfx' | 'stingers' | 'voices';
  format: 'wav' | 'mp3';
  /** Keep stereo (stingers); otherwise folded to mono. */
  stereo: boolean;
  targetLoudness: number;
  /** Keep everything down to this far below the peak (reverb tails). */
  rangeDb: number;
  gate: boolean;
  maxSeconds: number;
}

interface OneShotResult {
  file: string;
  bytes: number;
  duration: number;
  gain: number;
  fileLoudness: number;
  peakDb: number;
  notes: string[];
  rejected: string | null;
}

/** Trims, cleans and levels one generated sound; returns what was written (or why it was rejected). */
function processOneShot(input: string, plan: OneShotPlan, tmp: string): OneShotResult {
  const notes: string[] = [];
  const raw = decode(input);
  const side = sideToMidDb(raw);
  const stereo = plan.stereo && side > -30;
  let pcm: Pcm = stereo ? raw : { sampleRate: SR, channels: [mono(raw)] };
  const region = activeRegion(pcm, { rangeDb: plan.rangeDb, floorMarginDb: 6 });
  const unusable = unusableReason(region);
  if (unusable) return { file: '', bytes: 0, duration: 0, gain: 0, fileLoudness: -120, peakDb: region.peakDb, notes, rejected: unusable };
  let end = region.end;
  if (end - region.start > plan.maxSeconds) {
    end = region.start + plan.maxSeconds;
    notes.push(`cut to ${plan.maxSeconds} s`);
  }
  pcm = slicePcm(pcm, region.start, end);
  if (region.start > 0.005) notes.push(`lead trimmed ${(region.start * 1000).toFixed(0)} ms`);
  notes.push(`kept ${region.start.toFixed(3)}–${end.toFixed(3)} s of ${durationOf(raw).toFixed(2)} s`);
  removeDc(pcm);
  // The generators leave a noise floor 20–35 dB under the sound; close it between events.
  // The gate opens 12 dB over the floor's RMS (≈ its peaks), so steady textures pass untouched.
  if (plan.gate && region.peakDb - region.floorDb < 60) {
    gate(pcm, region.floorDb + 12, 24, 1.5, 70);
    notes.push(`noise floor ${region.floorDb.toFixed(0)} dBFS RMS gated (−24 dB below ${(region.floorDb + 12).toFixed(0)} dBFS)`);
  }
  const truncated = region.truncated && end >= durationOf(raw) - 0.05;
  fadeEdges(pcm, 1.5, truncated ? 90 : 25);
  if (truncated) notes.push('sound was cut off by the generator: 90 ms fade-out');
  // Peak-normalise the file; the play level is the manifest gain.
  const peak = samplePeakDb(pcm);
  const filePeak = plan.format === 'mp3' ? -1.5 : -1;
  scale(pcm, dbToGain(filePeak - peak));
  const fileLoudness = maxMomentaryLoudness(pcm);
  let gain = dbToGain(plan.targetLoudness - fileLoudness);
  if (gain > 1.6) {
    notes.push(`needs ${gainToDb(gain).toFixed(1)} dB to reach its target; capped at +4.1 dB`);
    gain = 1.6;
  }
  const dir = path.join(OUT, STUDIO_DIR, plan.dir);
  mkdirSync(path.dirname(path.join(dir, `${plan.out}.${plan.format}`)), { recursive: true });
  const target = path.join(dir, `${plan.out}.${plan.format}`);
  if (plan.format === 'wav') {
    writeFileSync(target, encodeWav16(pcm.channels, SR));
  } else {
    const w = path.join(tmp, `${path.basename(plan.out)}.proc.wav`);
    writeFloatWav(w, pcm);
    encodeMp3(w, target, pcm.channels.length);
  }
  return {
    file: `${STUDIO_DIR}/${plan.dir}/${plan.out}.${plan.format}`,
    bytes: statSync(target).size,
    duration: round(durationOf(pcm), 4),
    gain: round(gain, 4),
    fileLoudness: round(fileLoudness, 2),
    peakDb: round(samplePeakDb(pcm), 2),
    notes,
    rejected: null,
  };
}

interface SfxRoute {
  sample: string;
  name: SfxName;
  mode: 'replace' | 'layer';
  /** Target = reference effect's loudness + offset (dB). */
  ref: SfxName;
  offsetDb: number;
  pitchVar: number;
  gainVar: number;
  rangeDb?: number;
  maxSeconds?: number;
}

/**
 * How each generated effect joins the game's effects. 'layer' is used where the generated
 * sound is a short or thin event on its own (measured: < 120 ms of signal, or a noisy tail),
 * so the moment never gets weaker than the synthesised effect it joins.
 */
const SFX_ROUTES: SfxRoute[] = [
  { sample: 'start_coin', name: 'start_game', mode: 'replace', ref: 'start_game', offsetDb: 1.5, pitchVar: 0, gainVar: 0 },
  { sample: 'claw_descend', name: 'claw_descend', mode: 'replace', ref: 'claw_descend', offsetDb: 0, pitchVar: 0.02, gainVar: 0.04 },
  { sample: 'claw_close', name: 'claw_close', mode: 'layer', ref: 'claw_close', offsetDb: -3, pitchVar: 0.03, gainVar: 0.05 },
  { sample: 'claw_lift', name: 'claw_lift', mode: 'replace', ref: 'claw_descend', offsetDb: 0, pitchVar: 0.02, gainVar: 0.04 },
  { sample: 'prize_drop', name: 'chute_drop', mode: 'replace', ref: 'chute_drop', offsetDb: 2, pitchVar: 0.03, gainVar: 0.05 },
  { sample: 'empty_grab', name: 'empty_grab', mode: 'replace', ref: 'empty_grab', offsetDb: 1.5, pitchVar: 0.02, gainVar: 0.03 },
  { sample: 'slip', name: 'slip', mode: 'layer', ref: 'slip', offsetDb: -2, pitchVar: 0.04, gainVar: 0.05 },
  { sample: 'combo', name: 'combo', mode: 'replace', ref: 'win', offsetDb: -4, pitchVar: 0, gainVar: 0.02 },
  { sample: 'jackpot', name: 'jackpot', mode: 'replace', ref: 'win', offsetDb: -3, pitchVar: 0, gainVar: 0, maxSeconds: 3.2 },
  { sample: 'score_count', name: 'score_count', mode: 'replace', ref: 'ui_click', offsetDb: -1, pitchVar: 0.03, gainVar: 0.05 },
  { sample: 'sparkle', name: 'sparkle', mode: 'replace', ref: 'win', offsetDb: -7, pitchVar: 0.03, gainVar: 0.05 },
  { sample: 'firework', name: 'firework', mode: 'replace', ref: 'win', offsetDb: -2, pitchVar: 0.04, gainVar: 0.05 },
  { sample: 'confetti', name: 'confetti', mode: 'layer', ref: 'win', offsetDb: -8, pitchVar: 0.04, gainVar: 0.05 },
  { sample: 'countdown_tick', name: 'countdown_tick', mode: 'replace', ref: 'countdown_tick', offsetDb: 1, pitchVar: 0.01, gainVar: 0.03 },
  { sample: 'ui_open', name: 'ui_open', mode: 'layer', ref: 'ui_open', offsetDb: -4, pitchVar: 0.01, gainVar: 0.03 },
  { sample: 'attract_chime', name: 'attract_chime', mode: 'replace', ref: 'theme_sting', offsetDb: -6, pitchVar: 0, gainVar: 0 },
  { sample: 'restock_rain', name: 'restock_rain', mode: 'replace', ref: 'restock_drop', offsetDb: -1, pitchVar: 0.02, gainVar: 0.04 },
  { sample: 'glass_tap', name: 'glass_tap', mode: 'replace', ref: 'glass_tap', offsetDb: 0, pitchVar: 0.06, gainVar: 0.12 },
  { sample: 'calibration_ok', name: 'calibration_ok', mode: 'replace', ref: 'ui_open', offsetDb: 2, pitchVar: 0, gainVar: 0 },
];

/** Inputs that are deliberately not shipped, with the measurement that decided it. */
const SFX_NOT_USED: Record<string, string> = {
  button: 'a steady tonal sound for its whole 0.5 s (crest factor 12 dB, spectral flatness 0.06, no transient): not a button press; the synthesised clicks stay',
};

/* ----------------------------------------------------------------------- main */

function round(v: number, digits = 3): number {
  const k = Math.pow(10, digits);
  return Math.round(v * k) / k;
}

function main(): void {
  if (!SRC || !existsSync(SRC)) throw new Error('pass --src <dir with music/ stingers/ sfx/ voices/> (or set PLUSH_STUDIO_SRC)');
  if (!run('ffmpeg', ['-hide_banner', '-version']).ok) throw new Error('ffmpeg is required (with libmp3lame)');
  const manifestPath = path.join(OUT, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown> & {
    sfx: Record<string, { files: string[]; gain: number }>;
    loops: Record<string, { file: string; gain: number }>;
  };
  const refs = synthReferences(manifest);
  const ref = (name: string) => {
    const v = refs.sfx.get(name);
    if (v === undefined) throw new Error(`no synthesised reference for ${name}`);
    return v;
  };
  const tmp = mkdtempSync(path.join(tmpdir(), 'plush-studio-'));
  const report = {
    references: Object.fromEntries([...refs.sfx].map(([k, v]) => [k, round(v, 2)])),
    takes: [] as TakeReport[],
    transitions: [] as TransitionLine[],
    oneShots: [] as { input: string; output: string; result: OneShotResult; target: number }[],
    loop: null as unknown,
  };
  // Start from a clean studio folder so removed inputs do not leave stale files behind.
  rmSync(path.join(OUT, STUDIO_DIR), { recursive: true, force: true });
  const studio: StudioManifest = {
    schema: STUDIO_SCHEMA,
    generator: 'tools/audio/importStudio.ts',
    licence: LICENCE,
    music: {},
    stingers: {},
    sfx: {},
    loops: {},
    voices: {},
    rejected: [],
  };
  try {
    studio.music = processMusic(tmp, report);

    // Stingers: the theme's win jingle and jackpot fanfare.
    for (const theme of THEME_IDS) {
      const entry: { win?: StudioOneShot; jackpot?: StudioOneShot } = {};
      for (const kind of ['win', 'jackpot'] as const) {
        const name = `${theme}_${kind}`;
        const input = path.join(SRC, 'stingers', `${name}.mp3`);
        if (!existsSync(input)) continue;
        const target = ref('win') + (kind === 'win' ? 1 : 3);
        const r = processOneShot(input, { out: name, dir: 'stingers', format: 'mp3', stereo: true, targetLoudness: target, rangeDb: 50, gate: false, maxSeconds: 9 }, tmp);
        report.oneShots.push({ input: `stingers/${name}`, output: r.file, result: r, target });
        if (r.rejected) {
          studio.rejected!.push({ input: `stingers/${name}.mp3`, reason: r.rejected });
          console.log(`sting  ${name.padEnd(18)} REJECTED: ${r.rejected}`);
          continue;
        }
        entry[kind] = {
          files: [r.file],
          gain: r.gain,
          pitchVar: 0,
          gainVar: 0,
          mode: 'replace',
          duration: r.duration,
          fileLoudness: r.fileLoudness,
          targetLoudness: round(target, 2),
          peakDb: r.peakDb,
          bytes: r.bytes,
          source: [source('stingers', name)],
          notes: r.notes,
        };
        console.log(`sting  ${name.padEnd(18)} ${r.duration.toFixed(2)} s  gain ${r.gain.toFixed(3)}  ${(r.bytes / 1024).toFixed(0)} kB  ${r.notes.join('; ')}`);
      }
      if (entry.win || entry.jackpot) studio.stingers[theme] = entry;
    }

    // Effects.
    for (const route of SFX_ROUTES) {
      const input = path.join(SRC, 'sfx', `${route.sample}.mp3`);
      if (!existsSync(input)) continue;
      const target = ref(route.ref) + route.offsetDb;
      const r = processOneShot(input, { out: route.sample, dir: 'sfx', format: 'wav', stereo: false, targetLoudness: target, rangeDb: route.rangeDb ?? 36, gate: true, maxSeconds: route.maxSeconds ?? 2.6 }, tmp);
      report.oneShots.push({ input: `sfx/${route.sample}`, output: r.file, result: r, target });
      if (r.rejected) {
        studio.rejected!.push({ input: `sfx/${route.sample}.mp3`, reason: r.rejected });
        console.log(`sfx    ${route.sample.padEnd(15)} REJECTED: ${r.rejected}`);
        continue;
      }
      studio.sfx[route.name] = {
        files: [r.file],
        gain: r.gain,
        pitchVar: route.pitchVar,
        gainVar: route.gainVar,
        mode: route.mode,
        duration: r.duration,
        fileLoudness: r.fileLoudness,
        targetLoudness: round(target, 2),
        peakDb: r.peakDb,
        bytes: r.bytes,
        source: [source('sfx', route.sample)],
        notes: r.notes,
      };
      console.log(`sfx    ${route.sample.padEnd(15)} → ${route.name.padEnd(14)} ${route.mode.padEnd(7)} ${r.duration.toFixed(2)} s  gain ${r.gain.toFixed(3)}  ${r.notes.join('; ')}`);
    }
    for (const [sample, reason] of Object.entries(SFX_NOT_USED)) {
      if (existsSync(path.join(SRC, 'sfx', `${sample}.mp3`))) studio.rejected!.push({ input: `sfx/${sample}.mp3`, reason });
    }

    // The trolley motor: a seamless loop.
    const motorIn = path.join(SRC, 'sfx', 'motor_trolley_loop.mp3');
    if (existsSync(motorIn)) {
      const raw = decode(motorIn);
      const m: Pcm = { sampleRate: SR, channels: [mono(raw)] };
      removeDc(m);
      const loop = makeSeamlessLoop(m, 0.45, durationOf(m) - 0.25, 0.25);
      fadeEdges(loop.pcm, 0, 0);
      const peak = samplePeakDb(loop.pcm);
      scale(loop.pcm, dbToGain(-3 - peak));
      const file = `${STUDIO_DIR}/loops/motor_trolley.wav`;
      mkdirSync(path.join(OUT, STUDIO_DIR, 'loops'), { recursive: true });
      writeFileSync(path.join(OUT, file), encodeWav16(loop.pcm.channels, SR));
      const env = loudnessEnvelope(loop.pcm, 0.4, 0.05);
      const mean = 10 * Math.log10(Array.from(env).reduce((a, v) => a + Math.pow(10, v / 10), 0) / env.length);
      const target = refs.loops.get('motor_trolley')! + 1.5;
      const gain = round(Math.min(1.6, dbToGain(target - mean)), 4);
      const entry: StudioLoop = {
        file,
        duration: round(durationOf(loop.pcm), 6),
        gain,
        bytes: statSync(path.join(OUT, file)).size,
        seamStepRatio: round(loop.seamStepRatio, 3),
        source: source('sfx', 'motor_trolley_loop'),
      };
      studio.loops['motor_trolley' as LoopName] = entry;
      report.loop = { ...entry, start: loop.start, end: loop.end, crossfade: loop.crossfade, seamPercentile: round(loop.seamPercentile, 3), levelRangeLu: round(loop.levelRange, 2) };
      console.log(
        `loop   motor_trolley   ${entry.duration.toFixed(3)} s (source ${loop.start.toFixed(3)}–${loop.end.toFixed(3)} s, wrap cross-fade ${loop.crossfade} s)  ` +
          `seam step ×${loop.seamStepRatio.toFixed(2)} of the mean step (larger than ${(loop.seamPercentile * 100).toFixed(0)} % of the loop's own steps), level range over two passes ${loop.levelRange.toFixed(1)} LU, gain ${gain}`,
      );
    }

    // Character voices.
    const voiceDir = path.join(SRC, 'voices');
    const voiceTarget = ref('win') - 3;
    for (const name of existsSync(voiceDir) ? readdirSync(voiceDir).filter((f) => f.endsWith('.mp3')).sort() : []) {
      const id = name.replace(/\.mp3$/, '');
      const [theme, slug] = id.split('.');
      if (!theme || !slug) continue;
      const r = processOneShot(path.join(voiceDir, name), { out: `${theme}/${slug}`, dir: 'voices', format: 'wav', stereo: false, targetLoudness: voiceTarget, rangeDb: 34, gate: true, maxSeconds: 1.5 }, tmp);
      report.oneShots.push({ input: `voices/${id}`, output: r.file, result: r, target: voiceTarget });
      if (r.rejected) {
        studio.rejected!.push({ input: `voices/${name}`, reason: r.rejected });
        console.log(`voice  ${id.padEnd(24)} REJECTED: ${r.rejected}`);
        continue;
      }
      const v: StudioVoice = { file: r.file, gain: r.gain, duration: r.duration, bytes: r.bytes, source: source('voices', id), notes: r.notes };
      studio.voices[id] = v;
      console.log(`voice  ${id.padEnd(24)} ${r.duration.toFixed(2)} s  gain ${r.gain.toFixed(3)}  ${r.notes.join('; ')}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // Download size per theme (play-list + stingers + its characters) and shared (effects + loop).
  const size = (file: string) => {
    const full = path.join(OUT, file);
    return existsSync(full) ? statSync(full).size : 0;
  };
  const themes: Partial<Record<ThemeId, number>> = {};
  for (const theme of THEME_IDS) {
    const f = studioThemeFiles(studio, theme);
    themes[theme] = [...f.music, ...f.oneShots].reduce((a, file) => a + size(file), 0);
  }
  const shared = studioSharedFiles(studio).reduce((a, file) => a + size(file), 0);
  studio.bytes = { themes, shared };
  for (const theme of THEME_IDS) console.log(`bytes  ${theme.padEnd(10)} ${((themes[theme] ?? 0) / 1e6).toFixed(2)} MB (play-list, stingers, voices)`);
  console.log(`bytes  shared     ${(shared / 1e6).toFixed(2)} MB (effects, loop)`);

  manifest.studio = studio;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote  ${path.relative(ROOT, manifestPath)} (studio section)`);
  if (REPORT) {
    writeFileSync(REPORT, JSON.stringify(report, null, 2));
    console.log(`wrote  ${REPORT}`);
  }
}

main();
