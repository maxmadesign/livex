# Audio

PLUSH PORTAL has two layers of sound:

1. **Studio recordings** (`public/audio/studio/`, the `studio` section of the manifest):
   AI-generated music, win / jackpot stingers, character voices and dramatic effects, made
   through Higgsfield (music: ElevenLabs Music v2.5; effects and voices: Mirelo text-to-audio)
   and processed by `tools/audio/importStudio.ts`. This is what plays normally.
2. **The synthesised set** (`public/audio/music/`, `public/audio/sfx/`): original music, every
   effect and both motor loops rendered from code by `src/audio/synth/` (pure TypeScript DSP)
   and written by `tools/audio/bake.ts`. It is complete on its own and is the automatic
   fallback for any studio file that cannot be loaded or decoded, and for themes or
   characters without a recording.

> **Licence.** The studio recordings are AI-generated. Check the Higgsfield / ElevenLabs
> (and Mirelo) terms for commercial use before shipping commercially. The manifest repeats
> this note (`studio.licence`) and records, per file, the generator, the model and the
> Higgsfield result (`source.job`, the basename of the result URL).

## Studio recordings

### What plays when

| Moment | Sound | Engine call |
| --- | --- | --- |
| Theme music | the theme's two ~2-minute takes as a play-list (below) | `setTheme`, `setMusicTrack` |
| Settings → Audio → Preview | the theme's first take from its in point, 12 s | `previewTrack` |
| Coin / START | `start_coin` (replaces the synthesised chime) | `playSfx('start_game')` |
| Claw descends / closes / lifts | `claw_descend` (replaces) / `claw_close` (layered on the synthesised servo) / `claw_lift` | `playSfx(...)` |
| Trolley motor | seamless studio loop, level and pitch follow the trolley speed | `setLoop('motor_trolley', level, pitch)` |
| Prize passes the chute | `prize_drop` (replaces `chute_drop`) | `playSfx('chute_drop')` |
| Win | tier-aware: common = theme win stinger · rare = + sparkle · epic = + confetti + firework · legendary = theme jackpot fanfare + jackpot bells + firework; the music ducks under the stinger | `playWin(theme, tier)` (`playSfx('win')` = common) |
| Character | the plush's own voice: lift (natural), win (×1.12 rate, brighter, + sparkle), slip (×0.86, lower) | `playCharacter(assetId, moment)` |
| Empty grab / slip | comic `empty_grab` (replaces) / `slip` (layered) | `playSfx(...)` |
| Combo, score count-up, countdown, glass, restock, calibration | `combo`, `score_count`, `countdown_tick` (replaces), `glass_tap` (replaces), `restock_rain`, `calibration_ok` | `playSfx(...)` |
| Modal opens | `ui_open` (layered) | `playSfx('ui_open')` |
| Attract / demo mode | `attract_chime` every 20–30 s at 0.45 × its level (setting `audio.attractChime`) | `setAttract(true)`, `setAttractChime(on)` |

Every new name (`claw_lift`, `combo`, `score_count`, `sparkle`, `firework`, `confetti`,
`jackpot`, `attract_chime`, `restock_rain`, `calibration_ok`, `plush_squeak`) is also an
ordinary effect with a synthesised recipe, so it plays (synthesised) when its sample is missing.
`replace` means only the sample plays; `layer` plays it on top of the synthesised effect — used
where the generated sound alone is thin (e.g. `claw_close` is 90 ms of signal).

### Music play-lists

Each theme has two takes. The engine plays take 1 from its very beginning, then alternates
take 2 → take 1 → take 2 … Each hand-over is an **equal-power cross-fade** (cos / sin gain
curves, `AudioParam.setValueCurveAtTime`) of four beats (1.9–2.4 s), **centred** on the hand-
over: the outgoing take reaches its out point and the incoming take its in point in the middle
of the fade, so the two beat grids meet there. Nothing loops hard and no take ever plays its
generated intro again or reaches its (cut-off) end. The schedule is in AudioContext time and is
set ~6 s ahead (sample-accurate); the next take is decoded ~30 s ahead, and a take nothing plays
is released (a decoded two-minute take is ≈45 MB). If the next take is not decoded in time the
current take cross-fades into itself (its in point). If a take ran out anyway (timers starved),
the next one starts at once with a 0.3 s fade. A theme switch cross-fades (≈1.3 s) to the new
theme's play-list; the synthesised track stays the fallback when the first take of a theme
cannot be fetched or decoded (`status().detail` then says so).

In / out points come from the audio, not from guesses (`tools/audio/lib/studioAnalysis.ts`):
tempo from the autocorrelation of a spectral-flux onset envelope with a 120 BPM log-normal prior,
refined on a 0.04 % grid; the beat phase from broadband + low-band (kick / bass) onsets; the bar
line from which of the four beat positions carries the strongest low-band onsets and loudness
jumps (this "bar" estimate is weak — confidence 1.0–1.25 — so the hand-over is beat-aligned and
only probably bar-aligned); the body level as the median 1 s loudness of the middle 60 %; the
in point as the first bar line where the music has reached body level (−1.5 LU) and the whole
fade window sits at full level; the out point as the last such bar line before the level falls
away or 2 s before the end of the file. Measured on the shipped files:

| Take | Duration | Tempo | Key (est.) | In | Out | Cross-fade | LUFS | True peak | Size |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sakura_a.mp3` | 120.0 s | 120.0 BPM | D major | 2.02 s | 116.02 s | 2.00 s (4 beats) | −16.0 | −3.2 dBTP | 2.40 MB |
| `sakura_b.mp3` | 120.0 s | 118.0 BPM | A♭ major | 1.53 s | 115.46 s | 2.03 s (4 beats) | −16.0 | −3.4 dBTP | 2.40 MB |
| `storybook_a.mp3` | 120.0 s | 110.0 BPM | D minor | 8.77 s | 115.68 s | 2.18 s (4 beats) | −16.0 | −4.0 dBTP | 2.40 MB |
| `storybook_b.mp3` | 120.0 s | 112.0 BPM | C minor | 2.70 s | 116.28 s | 2.14 s (4 beats) | −16.0 | −3.1 dBTP | 2.40 MB |
| `ocean_a.mp3` | 110.0 s | 100.0 BPM | C major | 2.40 s | 105.62 s | 2.40 s (4 beats) | −15.9 | −4.0 dBTP | 2.20 MB |
| `ocean_b.mp3` | 120.0 s | 104.0 BPM | D major | 5.77 s | 116.57 s | 2.31 s (4 beats) | −16.0 | −3.3 dBTP | 2.40 MB |
| `cosmic_a.mp3` | 110.0 s | 124.0 BPM | E major | 2.45 s | 106.98 s | 1.94 s (4 beats) | −16.0 | −3.8 dBTP | 2.20 MB |
| `cosmic_b.mp3` | 120.0 s | 122.0 BPM | A minor | 1.48 s | 115.62 s | 1.97 s (4 beats) | −16.0 | −3.4 dBTP | 2.40 MB |
| `gpu_a.mp3` | 120.0 s | 128.0 BPM | E♭ major | 16.42 s | 115.83 s | 1.88 s (4 beats) | −16.0 | −3.0 dBTP | 2.40 MB |
| `gpu_b.mp3` | 120.0 s | 126.0 BPM | E major | 2.30 s | 116.59 s | 1.90 s (4 beats) | −16.0 | −3.7 dBTP | 2.40 MB |

LUFS and true peak are ffmpeg `ebur128` on the encoded files. Most takes start at full level
(no intro to skip) and are still at full level when the file ends (the generator cut them at
120 s); `cosmic_*` end with a 1.5 s decay. Keys are a chroma / Krumhansl estimate (correlation
0.72–0.96) and are shown because the two takes of a theme are **not** in the same key —
see "Known limits".

Every hand-over rendered from the encoded files exactly as the engine schedules it
(`simulateTransition`; loudness = 400 ms momentary, LUFS):

| Hand-over | Fade | Before | During (mean) | After | Mix vs power sum of the two | Largest sample step vs the music's own | Beat offset at the fade edges |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sakura a → b | 2.00 s | −15.4 | −16.6 | −16.7 | ≤ 0.7 LU | ×0.97 | 17 ms |
| sakura b → a | 2.03 s | −15.6 | −16.3 | −17.1 | ≤ 0.7 LU | ×0.59 | 17 ms |
| storybook a → b | 2.18 s | −15.5 | −16.6 | −17.7 | ≤ 0.4 LU | ×0.44 | 19 ms |
| storybook b → a | 2.14 s | −15.5 | −15.4 | −15.8 | ≤ 0.1 LU | ×0.70 | 19 ms |
| ocean a → b | 2.40 s | −15.5 | −17.8 | −17.7 | ≤ 0.3 LU | ×1.07 | 46 ms |
| ocean b → a | 2.31 s | −15.8 | −16.2 | −16.5 | ≤ 0.3 LU | ×0.87 | 46 ms |
| cosmic a → b | 1.94 s | −16.0 | −15.7 | −16.3 | ≤ 0.4 LU | ×0.69 | 16 ms |
| cosmic b → a | 1.97 s | −15.4 | −16.7 | −16.8 | ≤ 0.5 LU | ×0.92 | 16 ms |
| gpu a → b | 1.88 s | −15.5 | −16.0 | −16.5 | ≤ 0.2 LU | ×0.77 | 15 ms |
| gpu b → a | 1.90 s | −15.6 | −16.6 | −17.6 | ≤ 0.1 LU | ×1.00 | 15 ms |

"Mix vs power sum" ≈ 0 means the fade itself adds no dip or bump (no cancellation); the level
differences between before / after are the music's own dynamics. The largest sample step inside
the fade is never more than 1.07 × the largest step of the plain music in the 4 s before it, i.e.
the fade adds no click. The beat offset is how far apart the two grids drift by the edges of the
fade (different tempos); they coincide in its middle.

### Stingers

Per theme a win stinger and a jackpot fanfare (MP3 160 kbit/s stereo, trimmed, peak −1.5 dBFS;
the play level is the manifest `gain`, set so the loudest 400 ms sits 1 dB (win) / 3 dB (jackpot)
above the synthesised win jingle). During a stinger the music is ducked (common 0.5, rare 0.45,
epic 0.35, legendary 0.22 of its level) and comes back as the stinger rings out; a second win
while one is still ringing (80 % of its length) is ignored, so `playWin` at the chute and the
result's `playSfx('win')` never stack.

| Theme | win | jackpot |
| --- | --- | --- |
| sakura | 5.54 s, gain 0.79 | 5.60 s, gain 0.77 |
| storybook | 5.37 s, gain 0.84 | 7.49 s, gain 0.83 |
| ocean | 4.51 s, gain 0.94 | 6.98 s, gain 1.01 |
| cosmic | 5.40 s, gain 0.82 | 6.76 s, gain 0.88 |
| gpu | 2.83 s, gain 0.70 | 7.39 s, gain 0.86 |

### Effects

16-bit mono WAV (all inputs were mono: side/mid < −58 dB), peak −1 dBFS. Play level: the
loudest 400 ms (momentary loudness) of the synthesised effect it replaces or joins, plus an
offset (+1.5 dB for start / empty grab, +2 dB for the prize drop, −2…−4 dB for layers).

| Effect name | Sample | Mode | Length | Gain | Plays at (LUFS, loudest 400 ms) |
| --- | --- | --- | --- | --- | --- |
| `start_game` | start_coin.wav | replace | 2.49 s | 1.47 | −16.1 |
| `claw_descend` | claw_descend.wav | replace | 1.75 s | 0.64 | −20.4 |
| `claw_close` | claw_close.wav | layer | 0.09 s | 0.39 | −24.6 |
| `claw_lift` | claw_lift.wav | replace | 1.25 s | 0.76 | −20.4 |
| `chute_drop` | prize_drop.wav | replace | 0.70 s | 1.08 | −19.0 |
| `empty_grab` | empty_grab.wav | replace | 1.49 s | 0.74 | −15.2 |
| `slip` | slip.wav | layer | 2.00 s | 0.98 | −20.6 |
| `combo` | combo.wav | replace | 0.67 s | 0.48 | −19.2 |
| `jackpot` | jackpot.wav | replace | 2.98 s | 0.73 | −18.2 |
| `score_count` | score_count.wav | replace | 1.23 s | 0.93 | −26.1 |
| `sparkle` | sparkle.wav | replace | 1.37 s | 0.28 | −22.2 |
| `firework` | firework.wav | replace | 1.22 s | 1.38 | −17.2 |
| `confetti` | confetti.wav | layer | 1.38 s | 1.60 | −23.2 |
| `countdown_tick` | countdown_tick.wav | replace | 0.22 s | 0.78 | −25.1 |
| `ui_open` | ui_open.wav | layer | 0.60 s | 0.61 | −23.4 |
| `attract_chime` | attract_chime.wav | replace | 2.49 s | 0.75 | −22.4 |
| `restock_rain` | restock_rain.wav | replace | 1.95 s | 0.79 | −23.2 |
| `glass_tap` | glass_tap.wav | replace | 0.44 s | 0.48 | −27.8 |
| `calibration_ok` | calibration_ok.wav | replace | 0.10 s | 1.34 | −17.4 |

Not shipped: `button.mp3` — a steady tonal sound for its whole 0.5 s (crest factor 12 dB,
spectral flatness 0.06, no transient), not a button press; the synthesised clicks stay.

**Trolley motor loop** (`studio/loops/motor_trolley.wav`, 2.28 s): cut from 0.37–2.65 s of the
3 s recording, starting where the waveform is calm; the last 0.25 s are equal-power cross-faded
with the 0.25 s before the loop start, so the wrap continues the original signal. Measured: the
step across the wrap is 0.38 × the mean sample step (smaller than 75 % of the loop's own
steps); momentary loudness over two passes varies by 4.4 LU (the motor's own texture).

### Character voices

One ~1.5 s generated sound per plush (`studio/voices/<theme>/<slug>.wav`), trimmed to its
active part (0.10–1.50 s), the generator's noise floor gated, levelled to the same loudness
(3 dB under the win jingle; gain capped at 1.6, which six very peaky voices reach). The same
file is played per moment: lift ×1.0, win ×1.12 (+ sparkle, 0.35 s after the call), slip ×0.86
playback rate (±2 % random). A character never repeats a moment, or steps back to a less
important one, within 2.6 s; different characters start at least 0.3 s apart. Inside the 2.6 s a
character may still escalate (lift → slip → win): in headless rounds a lifted toy slips
0.37–1.79 s after `liftStarted` (9 of 9 slips measured), so without this the slip cry would never
be heard. The escalating moment fades the character's previous voice out (15 ms time constant,
source stopped 0.1 s later) so the two never pile up. A lift / slip cry ducks the music to 0.7
(−3 dB) for its length unless a win is ringing (that duck is deeper already): measured in the
built app at the default volumes, a lift cry's loudest 400 ms (−19.7 dBFS) only matched the
music's (−19.2 dBFS) while the claw and winch sound at the same moment. All 31 are shipped. The
first takes of `cosmic.astrocat` (loudest 50 ms −61.7 dBFS) and `ocean.jellyfish` (−46.5 dBFS, 8.7 dB
over its own floor) were silent / noise; both were regenerated once with a more explicit prompt and
re-imported. Any character without a recording (or whose file fails to load) uses the synthesised
`plush_squeak` instead, pitched per id (0.82–1.24, stable hash).

### Processing (`tools/audio/importStudio.ts`)

```bash
npx tsx tools/audio/importStudio.ts --src <raw dir> [--urls <raw dir>/urls.tsv] [--report report.json] [--bitrate 160k]
```

`<raw dir>` holds the downloads as `music/<theme>_a.mp3` + `_b.mp3`, `stingers/<theme>_win.mp3` +
`_jackpot.mp3`, `sfx/<name>.mp3`, `voices/<assetId>.mp3`; `urls.tsv` maps `music/sakura_a` etc. to
the Higgsfield result URL (its basename becomes `source.job`). Needs ffmpeg with libmp3lame.
The tool rewrites `public/audio/studio/` and the manifest's `studio` section and leaves the
synthesised set alone (`tools/audio/bake.ts` in turn keeps the `studio` section). Steps:

- **music**: trim leading / trailing silence (< −60 dBFS), analyse (above), gain to −16 LUFS
  integrated with true peak ≤ −1 dBTP — measured by ffmpeg `ebur128` on the encoded file and
  iterated, because the encoder's 16 kHz low-pass lowers the K-weighted level by ≈0.4 LU —
  3 ms / 20 ms edge fades, MP3 CBR 160 kbit/s (LAME, `-compression_level 2`); every hand-over is
  rendered from the encoded files and measured;
- **stingers**: trim to the active sound, fades (25 ms, 90 ms where the generator cut the sound
  off), peak −1.5 dBFS, MP3 160 kbit/s stereo, gain from the synthesised win jingle;
- **effects and voices**: mono fold-down, trim to the active sound (10 ms peaks above
  max(peak − 36 dB, quietest 100 ms + 16 dB)), 20 Hz DC high-pass, downward expander (−24 dB
  below the quietest 100 ms + 12 dB, 1.5 ms attack, 70 ms release) against the generator's noise
  floor, raised-cosine fades (1.5 ms in, 25 ms / 90 ms out), peak −1 dBFS, 16-bit WAV; a sound
  that is silent or only a steady quiet floor is rejected (listed in `studio.rejected`);
- **motor loop**: as above.

Re-running the tool on the same inputs produced bit-identical files and manifest (`md5sum` over all 69 files).
A run takes ≈1.5 min on four shared cores. Without `--urls`, `source.job` is null.

**Provenance gap:** `urls.tsv` from the generation run lists the effects, the voices and the
cosmic / gpu stingers, but not the music takes nor the sakura / storybook / ocean stingers, so
those files carry `job: null` (their model is ElevenLabs Music v2.5 for the music; "not
recorded per file" for the stingers). Add their lines to `urls.tsv` and re-run to fill them in.

### Sizes and loading

Nothing studio blocks boot: the manifest and the shared effects + loop (2.36 MB) load in the
background like the synthesised effects did; a theme's play-list, stingers and voices are
fetched when the theme is selected (only that theme), and only the first take is decoded before
its music starts (≈0.4 s in headless Chromium). Studio stingers / voices of at most two themes
stay in memory. Synthesised effects that a studio sample replaces are not downloaded unless that
sample fails.

| Theme | Downloaded for the theme (play-list + stingers + voices) |
| --- | --- |
| sakura | 5.63 MB |
| storybook | 5.66 MB |
| ocean | 5.42 MB |
| cosmic | 5.41 MB |
| gpu | 5.79 MB |
| shared (effects + motor loop) | 2.36 MB |

`public/audio/studio/` is 30 MB in the repository (music 23 MB, voices 3.1 MB, effects 2.2 MB,
stingers 1.2 MB, loop 0.2 MB).

### Known limits

- Nobody has listened to any of this: this environment has no audio output. Levels, fades,
  timing and decoding are measured (tables above); taste, musical fit and "drama" are not.
- **The two takes of a theme are in different keys** by the estimate (e.g. sakura D major vs
  A♭ major, gpu E♭ vs E major), so the 2 s hand-overs will clash harmonically for a moment. The
  fades are short and beat-aligned for that reason; regenerating the B takes in the A take's key
  (and tempo) would make the hand-overs musical.
- Tempos differ by 2–4 % between takes: the grids meet in the middle of the fade and are 15–46 ms
  apart at its edges.
- Several generated effects are short or thin (the reason for the `layer` mode), several voices
  are short (`storybook.astronaut` 0.10 s, `sakura.tanuki` 0.26 s, `gpu.bot` 0.35 s), and some
  were cut off by the generator (90 ms fade-outs). Regenerating those would help more than any
  processing.

## Synthesised music

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
Recipes are in `src/audio/synth/sfx.ts`. The eleven names of the dramatic layer have recipes
too (whistle-boom-crackle firework, bell cascade, celesta sparkle, rubber squeak, …), levelled
to about the loudness their studio samples play at, so the fallback keeps the same balance.

## Regenerating

```bash
npm run assets:audio                           # everything (needs ffmpeg with libmp3lame)
npm run assets:audio -- --only sfx             # effects and loops only
npm run assets:audio -- --only music
npm run assets:audio -- --music-format wav     # no ffmpeg needed, larger files
npm run assets:audio -- --bitrate 192k
```

The render is deterministic: two runs produce bit-identical files (checked with `md5sum`
over all 61 files; adding the eleven new effects left the 58 earlier effect files bit-identical).
A full bake takes about 25 s. A bake keeps the manifest's `studio` section.

## Files

- `public/audio/music/<theme>.mp3` – MP3, CBR 160 kbit/s, 44.1 kHz stereo, 1.25–1.46 MB each.
- `public/audio/sfx/*.wav` – 16-bit mono 44.1 kHz, 70 one-shots + 2 loops, 3.6 MB in total.
  Files are peak-normalised to −4 dBFS (loops −7 dBFS); how loud an effect plays is the
  `gain` in the manifest, not the level of the file.
- `public/audio/manifest.json` – what the engine loads: per track `file`, `duration`,
  `loopStart` / `loopEnd` (seconds, unrounded) and `loopStartSample` / `loopEndSample`, plus
  title, BPM, key, instruments and credits; per effect its variant `files`, optional
  `themes`, `gain`, `pitchVar`, `gainVar`; per loop `file`, `duration`, `gain`; and the optional
  `studio` section (schema `src/audio/studio/manifest.ts`): `music.<theme>.takes[]` (`file`,
  `duration`, `bpm`, `key`, `inPoint`, `outPoint`, `crossfade`, `crossfadeBeats`, `lufs`,
  `truePeakDb`, `bytes`, `source`), `stingers.<theme>.win|jackpot`, `sfx.<name>` (`files`,
  `gain`, `mode`, `targetLoudness`, …), `loops.motor_trolley`, `voices.<assetId>`, `rejected[]`,
  `bytes` and `licence`. The parser drops invalid studio entries one by one; the rest stays
  usable and the synthesised set covers what was dropped.

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

- Buses: music → duck → stinger duck → master, sfx → master, voice → master, with a gentle
  limiter on the master. `setVolumes` is remembered before `unlock()` and applied afterwards.
  Studio effects, stingers and character voices play on the sfx bus (SFX volume and mute apply).
- `unlock()` must run inside a user gesture. It never throws; `status()` says `running`,
  or `locked` with the reason when the browser refused. Effects are fetched and decoded
  before the first gesture (offline context), so the first tap can already make sound.
- Music: only the current theme is downloaded; other tracks load on demand and at most two
  decoded tracks are kept. Theme changes cross-fade (≈1.3 s); selecting the same theme
  again, or a new round, never restarts the track. `setMusicTrack` overrides the theme,
  `previewTrack` plays a 12 s preview over the muted game music (the studio take from its in
  point when there is one). With studio takes the music is a play-list (`src/audio/studio/playlist.ts`,
  see "Music play-lists"); the voice duck and the volume / mute settings work the same way.
- Dramatic layer: `playWin(theme, tier)`, `playCharacter(assetId, moment)`, `setAttract(active)`,
  `setAttractChime(enabled)` (see "What plays when"); pure decisions in `src/audio/studio/moments.ts`.
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

Automated (`npx vitest run tests/unit/audio`, 129 tests, ≈30–45 s):

- studio (`studio.test.ts`, `studioAnalysis.test.ts`): the shipped `studio` section parses
  without problems, covers every theme (two takes, win + jackpot), every listed file exists with
  its recorded size, takes at −16 ± 0.5 LUFS and ≤ −1 dBTP with valid centred fade windows and
  whole-beat cross-fades, WAVs mono / peak-normalised / click-free, the loop wraps without a
  large step, voices only for real character ids, invalid entries dropped one by one;
  hand-over planning (centred equal-power fade, late hand-over, take alternation, repeat when
  the next take is not decoded); the real `StudioPlayer` on a fake context (prefetch 30 s ahead,
  sample-accurate start / offset / curves 6 s ahead, release after the fade, take 1 → 2 → 1);
  the engine with studio files: lazy per-theme downloads, play-list instead of a hard loop,
  theme cross-fade, fallback to the synthesised track when a take is missing or undecodable,
  replace vs layer, a failed studio effect bringing its synthesised effect back, the studio
  motor loop, studio preview; character voicing / cooldown / escalation (lift → slip → win, the
  earlier voice faded out) / squeak pitch and the engine path;
  win layering per tier, stinger duck, no stacking, fallback to the synthesised jingle; the
  attract chime period, level and switches; analysis on synthetic signals (tempo ±0.5 BPM, beat
  grid within 25 ms of the kicks, bar lines, in / out points around a quiet intro and a fade-out,
  no dip in a rendered hand-over, seamless loop, active region / rejection, BS.1770 loudness);

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

- studio (`browser_check.cjs` in the round-3 scratch area, real files through a Vite dev server):
  all 68 studio files fetched decode (one take was routed to 404 on purpose), decoded durations
  within 0.04 ms of the manifest; every hand-over rendered by the real `StudioPlayer` in an
  `OfflineAudioContext` (suspended 5 s before the fade to run its scheduler) matches a
  sample-by-sample JS mix of the same plan at 22–60 dB SNR (the residual is sub-sample start
  interpolation), its largest step inside the fade is 0.66–1.16 × the largest step in the 3 s
  before, and its RMS before / during / after the fade stays within 2.4 dB; the real engine:
  unlock 505 ms, studio music audible 416 ms after unlock, only sakura's files plus the shared
  effects fetched, then only ocean's on a theme change (406 ms to switch), legendary win = 3
  sources and a second win ignored, character win = voice + sparkle, cooldown honoured, an
  unknown id squeaks, one source for the motor loop, the 404 take falls back to the synthesised
  storybook track (with the reason in `status().detail`), studio preview audible, suspend /
  resume;
- all 60 synthesised files decode with `decodeAudioData`; decoded MP3 durations equal the manifest;
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
Safari and Firefox (including whether they strip the MP3 encoder delay as Chromium does — a
decoder that does not shifts both takes equally, so the hand-over alignment is unaffected),
iOS unlock behaviour, memory use of decoded studio takes on low-memory devices, and switching
real output devices (headless Chromium lists none).
