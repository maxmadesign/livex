# Audio

Everything you hear in PLUSH PORTAL is **original and synthesised from code** in this
repository. There are no samples, no recordings and no third-party audio: the four music
tracks, every sound effect and both motor loops are rendered by `src/audio/synth/`
(pure TypeScript DSP) and written to `public/audio/` by `tools/audio/bake.ts`.

## Music

| Theme | Title | Key · tempo | Form | Loop | Palette |
| --- | --- | --- | --- | --- | --- |
| `sakura` | Petal Parade | F major · 112 BPM | A A′ B A″, 32 bars | 68.6 s | xylophone lead, glockenspiel answers, round synth pluck, koto bridge, snaps, shaker, wood blocks |
| `storybook` | Storybook Stroll | G major · 108 BPM swing | A A′ B A″, 32 bars | 71.1 s | clarinet and flute, felt piano, pizzicato strings and bass, celesta, brushes, wood blocks |
| `ocean` | Drift Glass | D major · 84 BPM | A B A′, 24 bars | 68.6 s | glass bowls, marimba in 3-3-2, breathing pad, sine sub, dusty half-time beat, bubbles, surf |
| `cosmic` | Neon Orbit | F♯ minor / A major · 126 BPM | verse chorus ×2, 32 bars | 60.9 s | pulse lead, arcade arpeggio with ping-pong delay, pumping pad and bass, four-on-the-floor, blips and arcade toms |

The scores live in `src/audio/synth/scores/*.ts` as chord progressions, melodies in a small
text notation and arrangement code. All tracks are levelled to −16 LUFS.

## Sound effects

One-shots for every name in `SFX_NAMES` (`src/core/contracts.ts`), with 2–4 variants where
repetition would be noticed, a `win` jingle and a `theme_sting` per theme, and two seamless
motor loops (`motor_trolley`, `motor_winch`) whose level and pitch the engine drives.
Recipes are in `src/audio/synth/sfx.ts`.

## Regenerating

```bash
npm run assets:audio                           # everything (needs ffmpeg with libmp3lame)
npm run assets:audio -- --only sfx             # effects and loops only
npm run assets:audio -- --only music
npm run assets:audio -- --music-format wav     # no ffmpeg needed, larger files
npm run assets:audio -- --bitrate 192k
```

The render is deterministic: two runs produce bit-identical files (checked with `md5sum`
over all 61 files). A full bake takes about 25 s.

## Files

- `public/audio/music/<theme>.mp3` – MP3, CBR 160 kbit/s, 44.1 kHz stereo, 1.25–1.46 MB each.
- `public/audio/sfx/*.wav` – 16-bit mono 44.1 kHz, 54 one-shots + 2 loops, 2.5 MB in total.
  Files are peak-normalised to −4 dBFS (loops −7 dBFS); how loud an effect plays is the
  `gain` in the manifest, not the level of the file.
- `public/audio/manifest.json` – what the engine loads: per track `file`, `duration`,
  `loopStart` / `loopEnd` (seconds, unrounded) and `loopStartSample` / `loopEndSample`, plus
  title, BPM, key, instruments and credits; per effect its variant `files`, optional
  `themes`, `gain`, `pitchVar`, `gainVar`; per loop `file`, `duration`, `gain`.

**Seamless loops.** MP3 encoders and decoders add delay and padding, so the loop is not
"the whole file". Each track is rendered as a truly periodic signal (note tails, delay and
reverb of the last bar ring into the first bar; the limiter's gain curve is periodic too) and
the file is laid out as `[last 0.25 s of the loop][loop][first 1.5 s of the loop]`. Any window
of one loop length inside the file is therefore seamless, whatever offset a decoder adds; the
engine loops an `AudioBufferSourceNode` on the manifest's loop points. Loop lengths are whole
multiples of 1152 samples (one MP3 frame), the tempo is nudged by < 0.01 BPM to get there.

## Replacing a track or an effect

1. Put the new file under `public/audio/` (any format the target browsers can decode with
   `decodeAudioData`: MP3 and WAV everywhere, FLAC / Ogg in current browsers).
2. Edit its entry in `public/audio/manifest.json`:
   - music: `file`, `duration`, `loopStart`, `loopEnd`, `loopStartSample`, `loopEndSample`
     (at the manifest `sampleRate`), `bytes` (> 0), `title`, `credits`. For music that was
     not rendered periodically, pick loop points on identical material (for example bar 1
     and the repeat of bar 1) or set them to the whole file and accept a gap.
   - effects: add the file to `files` (or to `themes.<theme>`), set `gain`.
3. `tests/unit/audio/manifest.test.ts` asserts that the shipped files match the
   synthesiser; adjust the "reproducible" test when shipping hand-made audio.

`npm run assets:audio` rewrites the manifest and the generated files, so keep hand-made
replacements under different file names.

## Runtime (`src/audio/AudioEngine.ts`)

`createAudioEngine({ baseUrl? })` returns the `AudioPort` used by the game.

- Buses: music → duck → master, sfx → master, voice → master, with a gentle limiter on the
  master. `setVolumes` is remembered before `unlock()` and applied afterwards.
- `unlock()` must run inside a user gesture. It never throws; `status()` says `running`,
  or `locked` with the reason when the browser refused. Effects are fetched and decoded
  before the first gesture (offline context), so the first tap can already make sound.
- Music: only the current theme is downloaded; other tracks load on demand and at most two
  decoded tracks are kept. Theme changes cross-fade (≈1.3 s); selecting the same theme
  again, or a new round, never restarts the track. `setMusicTrack` overrides the theme,
  `previewTrack` plays a 12 s preview over the muted game music.
- Effects: variants rotate (never the same twice in a row) with small random pitch / gain
  changes; rapid re-triggers and more than four overlapping voices of one effect are dropped.
- Motor loops: `setLoop(name, level, pitch)` is called every frame; one source per loop,
  smooth ramps, level 0 fades and then releases the source, and a watchdog fades a loop the
  game stopped updating.
- Voice: `playVoice` (encoded bytes or an `AudioBuffer`) and `setVoiceActive` duck the music
  by the `ducking` volume; a new voice replaces the previous one.
- `suspend()` (tab hidden) stops voices, motors and effects that are still ringing, and
  drops new sounds instead of queueing them; `resume()` continues the music where it was.
- `playVoice`'s `rate` is a playback rate: it changes speed *and* pitch. Ask the speech
  service for the speaking speed and keep `rate` at 1 for natural voices.
- Output device: `enumerateDevices` + `AudioContext.setSinkId`. Where the browser lacks
  `setSinkId` the engine reports `supported: false` with the reason.

**Fallback.** If the manifest or any file cannot be loaded or decoded, the same sounds are
rendered in the browser by `src/audio/synthWorker.ts` (the code that baked the files) and
`status().usingFallbackSynth` is `true`; `status().detail` says whether everything or only
some files are synthesised. Without Worker support the effects are rendered on the main
thread one per timer tick and the music is reported as unavailable.

## Verification

Automated (`npx vitest run tests/unit/audio`, 80 tests, ≈25 s):

- every track ≥ 60 s, finite, below 0 dBFS, at −16 ± 0.6 LUFS, no drop-outs, real stereo,
  no click at the seam, file layout periodic;
- measured from the rendered audio: each track fits its own tempo better than the other
  three (onset autocorrelation) and its strongest pitch classes are the notes of its key;
  loudness envelopes of different tracks are uncorrelated (|r| ≤ 0.26);
- melodies fill their bars and land on chord tones on strong beats; jingles differ per theme;
- every effect renders finite, normalised, with silent edges, no DC and no dominant top
  octave; motor loops are exactly periodic; renders are deterministic;
- the shipped manifest lists every `SFX_NAMES` / `LOOP_NAMES` entry, every file exists and
  parses, MP3 lengths cover the loop points, shipped WAVs equal a fresh render;
- engine logic against a scripted Web Audio stand-in: locked no-ops, autoplay refusal,
  volumes / mute, loop points, cross-fade, latest-request-wins, variant rotation, themed
  jingles, re-trigger limits, one source per motor loop, watchdog, ducking, single voice,
  no restart when a theme changes away and back, suspend / resume (voices, motors and
  ringing effects stop; nothing is replayed), preview, dispose, all fallback paths, output
  devices.

In headless Chromium (Playwright, `--autoplay-policy=no-user-gesture-required`, real files
through a Vite dev server):

- all 60 files decode with `decodeAudioData`; decoded MP3 durations equal the manifest;
- a looping `AudioBufferSourceNode` rendered across the loop point in an
  `OfflineAudioContext` continues sample-exactly at `loopStart`; in the encoded files the
  sample step at the wrap is 0.002–0.055, the same size as ordinary neighbouring samples
  (mean 0.016–0.028);
- the real engine: unlock 108–188 ms, music and every effect produce output, two sources
  for two motor loops over 56 frames, silence after stop and after the watchdog, 20 rapid
  triggers → 1 source, ducking to silence and back, mute, theme switch, track override,
  preview, suspend / resume;
- fallback: with all assets missing the worker synthesises the effects in 0.9–1.4 s and a
  track in 2–6 s while the page keeps rendering (worst frame 51–60 ms); with single files
  broken only those are synthesised; without a worker the effects still play and the music
  is reported as unavailable; without Web Audio the state is `failed`.
- the engine and its worker bundle with `vite build` (engine 28 kB, worker 77 kB; the
  synthesiser is not part of the main bundle).
- loudness of the shipped MP3s measured by ffmpeg `ebur128`: −16.4 LUFS each, true peak
  −1.4 … −2.8 dBFS.

Not verified here: nobody has *listened* to the result (this environment has no audio
output; balance and timbre were judged from spectra, levels and music-theory checks only),
Safari and Firefox, iOS unlock behaviour, and switching real output devices (headless
Chromium lists none).
