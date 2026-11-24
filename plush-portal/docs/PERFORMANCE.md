# Performance

> **Read this first.** The project's performance target is a Ryzen 7 7840HS
> with Radeon 780M integrated graphics at the Medium preset. **No such machine,
> and no machine with any GPU, was available during development.** The quality
> tiers below are *engineering starting budgets*. They are not measurements and
> nothing here should be read as "Medium runs at 60 fps on a 780M".
> The only numbers that were measured are in [Measured](#measured), and they
> come from software rendering in a cloud container.

- [Quality tiers (starting budgets)](#quality-tiers-starting-budgets)
- [What each option costs](#what-each-option-costs)
- [Internal resolution](#internal-resolution)
- [Automatic optimiser](#automatic-optimiser)
- [Performance panel](#performance-panel)
- [Measured](#measured)
- [Measuring on real hardware](#measuring-on-real-hardware)

## Quality tiers (starting budgets)

`GRAPHICS_PRESETS` in `src/app/presets.ts`. Choose one under *Settings →
Graphics* or with `?quality=`. **Engineering defaults, not measured guarantees.**

| | Safe | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Intended starting point for | Old or unknown integrated graphics, software rendering | 780M-class integrated graphics | Mid-range discrete GPU | High-end GPU, 4K |
| Frame-rate target | 30 | 60 | 60 | 60 |
| Render scale | 0.75 | 1.0 | 1.0 | 1.0 |
| Pixel budget | 0.9 MP | 2.1 MP (≈ 1080p) | 4.0 MP (≈ 1440p) | 8.3 MP (4K) |
| Model detail (focused / other toys) | LOD1 / LOD2 | LOD0 / LOD1 | LOD0 / LOD0 | LOD0 / LOD0 |
| Procedural texture size | 512 | 1024 | 2048 | 4096 |
| Shadow map | 1024 | 2048 | 4096 | 4096 |
| Ambient occlusion (GTAO) | off | off | 8 samples | 16 samples |
| Glass | no front reflection | subtle reflection | subtle reflection | real transmission (extra scene pass) |
| Reflections | static studio environment | static studio environment | cabinet environment, refreshed per round | cabinet environment, refreshed every 0.75 s |
| Plush detail | sheen only | 10 fur shells on the focused toy | 10 fur shells on the focused toy | 16 shells on the focused toy, 8 on all others |
| Softness detail | 4 dents | 4 dents | 6 dents, focused toy at LOD0 | 6 dents, all toys at LOD0 |
| Anti-aliasing | FXAA | FXAA | SMAA | MSAA 4× |
| Bloom | off | 0.25 | 0.30 | 0.30 |
| Decor particles | 20 | 60 | 150 | 300 |

The "intended for" row is the design intent behind each tier, nothing more.

What never changes with quality: the physics step (120 Hz), collision shapes,
grip rules, number of toys, HUD layout and HUD resolution. See
[ARCHITECTURE.md](ARCHITECTURE.md#why-graphics-cannot-change-outcomes).

## What each option costs

| Option | Cost driver |
| --- | --- |
| Render scale, pixel budget | Fragment work of every pass; the single most effective lever on integrated graphics. |
| Shadows | One extra depth pass over all shadow casters at 1024² / 2048² / 4096². |
| Ambient occlusion | Full-screen GTAO pass plus denoise; scales with pixels and sample count. |
| Anti-aliasing | FXAA / SMAA are full-screen post passes; MSAA multiplies the samples of the half-float scene target. |
| Bloom | Several down/up-sampling passes. |
| Glass = Transmission | Renders the scene once more for the transmission buffer. |
| Reflections = Cabinet | Re-renders a cube environment and prefilters it (once per round, or every 0.75 s when live). |
| Plush detail | Shell fur draws the toy mesh once per layer (instanced): 10 extra layers for one toy, or 8–16 for every toy. This dominates triangle count on High and Ultra (see the measured triangle counts below). |
| Model detail, softness detail | Vertex count of the toys (about 15 000 / 5 200 / 1 700 triangles per toy) and the per-vertex deformation shader. |
| Decor particles | Particle update on the CPU and their draw. |
| Frame-rate target 30 | Skips frames to hold 30 fps; the simulation is unaffected. |
| Head tracking | Face inference runs in a worker when possible, at *Tracking rate* (default 18 Hz) and *Camera resolution* (default 480p). It competes for CPU and, with the GPU delegate, for GPU time. |

## Internal resolution

`internal size = CSS size × device pixel ratio × render scale × optimiser scale`,
then scaled down uniformly if it exceeds the pixel budget (never below 0.2 × CSS
size). The canvas keeps its CSS size; the HUD is DOM and always native.
Examples measured in this environment:

| Viewport (CSS px, pixel ratio 1) | Preset | Internal 3D resolution |
| --- | --- | --- |
| 1280 × 720 | Safe | 960 × 540 (0.52 MP) |
| 1280 × 720 | Medium | 1280 × 720 (0.92 MP) |
| 1080 × 1920 | Medium | 1080 × 1920 (2.07 MP) |
| 2160 × 3840 (86" 4K portrait) | Medium | 1087 × 1932 (2.10 MP) — the budget halves each dimension |

## Automatic optimiser

`src/app/AdaptiveQuality.ts`, on by default (*Graphics → Auto optimise*). It
removes cost only while the frame-rate target is being missed, in a fixed order,
and gives it back when there is headroom.

| Step | Reduction |
| --- | --- |
| 1 | Decor particles to 30 % |
| 2 | Bloom off |
| 3 | Ambient occlusion off |
| 4 | Reflections → static studio environment |
| 5 | Glass: transmission → reflective |
| 6 – 8 | Internal resolution × 0.9, × 0.8, × 0.7 |
| 9 | Shadows one level down (4096 → 2048, or 2048 → 1024) |
| 10 – 11 | Internal resolution × 0.6, × 0.5 |

Steps that would change nothing for the current settings are skipped on the way
down: from Medium (AO off, static reflections, reflective glass) the order is
particles → bloom → resolution × 0.9 … — "AO off" is never waited for.

Rules:

- A sliding window of the last 120 frame times is evaluated about once per
  second: after at least 0.9 s of frame time and 30 samples, or — at very low
  frame rates — after at least 6 samples and 2.5 s.
- **Reduce** by one effective step when the 80th-percentile frame time is above
  `1.22 × (1000 / target)` on two evaluations in a row (20.3 ms at 60 fps, 40.7 ms at 30 fps).
- **Restore** one list position when it is below `0.72 ×` the target frame time on seven
  evaluations in a row (12 ms at 60 fps). The gap between the two thresholds and
  the slow recovery keep it from oscillating.
- After every change the window is cleared so the new configuration is judged on its own.
- A single frame longer than 250 ms is ignored as a hitch (shader compilation,
  tab switch). Two or more such frames in a row are a slow machine: they count,
  clamped to 250 ms each, so the optimiser also steps down on a device that
  renders at only a few frames per second.
- Changing a graphics setting clears all reductions. Nothing is written to the
  settings; the active reductions are shown in the Graphics tab and the performance panel.
- It never touches physics, input, the number of toys or the layout.

## Performance panel

*Graphics → Performance panel* shows, updated twice a second over the last 180 frames:

| Line | Content |
| --- | --- |
| 1 | Frames per second, mean frame time, 95th-percentile frame time |
| 2 | Physics time per frame and fixed steps per frame; tracking inference time and rate |
| 3 | Draw calls and triangles submitted per frame (all passes, including shadows and fur shells) |
| 4 | Internal 3D resolution in pixels and megapixels; active optimiser reductions |
| 5 | GPU time: shown as **"not available"**; JS heap in MB where the browser exposes it (Chromium) |

GPU time is not measured: web pages get it only through a timer-query
extension that most browsers disable, so the panel does not pretend to have it.
"Frame time" is the interval between animation frames, i.e. it includes
everything (CPU, GPU, compositor) but is quantised to the display refresh when the machine keeps up.

## Measured

Everything in this section was measured on **2026-11-24** in the development
container and nowhere else.

> **Environment:** headless Chromium 158 (Playwright), **SwiftShader software
> rendering** (ANGLE → Vulkan → SwiftShader, no GPU), 4 shared CPU cores
> (Intel Xeon @ 2.1 GHz), cloud container — **not representative of a 7840HS/780M**
> or of any real GPU. Other test jobs were running on the same four cores during
> the measurements (1-minute load average 7–17), which makes the frame times
> below even slower and noisier than software rendering alone would be.

### Browser frame time (software rendering)

Method: dev server, `?debug=1&camera=off&seed=7&quality=<preset>&display=<preset>`,
device pixel ratio 1, on the attract screen; 14 s warm-up, then
the intervals between `requestAnimationFrame` callbacks for 30 s.

| Preset | Display @ viewport | Internal resolution | Frames in 30 s | Median frame | 90th pct. | Draw calls | Triangles / frame (of which toys) | JS heap | Load avg. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Safe | desktop @ 1280 × 720 | 960 × 540 | 7 | 4.1 s | 12.8 s | 118 | 137 606 (31 257) | 58 MB | 7 – 12 |
| Medium | desktop @ 1280 × 720 | 1280 × 720 | 4 | 6.2 s | 16.9 s | 132 | 262 223 (93 558) | 61 MB | 13 – 14 |
| High | desktop @ 1280 × 720 | 1280 × 720 | 3 | 10.8 s | 12.5 s | 250 | 1 229 905 (269 949) | 61 MB | 14 – 16 |
| Ultra | desktop @ 1280 × 720 | 1280 × 720 | 1 | 42.8 s | — | 380 | 3 815 971 (2 429 541) | 61 MB | 16 – 17 |
| Medium | portrait32 @ 1080 × 1920 | 1080 × 1920 | 3 | 9.4 s | 15.8 s | 123 | 217 083 (93 558) | 61 MB | 16 – 17 |
| Medium | portrait86 @ 2160 × 3840 | 1087 × 1932 | 3 | 18.1 s | 20.5 s | 123 | 217 107 (93 558) | 61 MB | 15 |

How to read this:

- These are **seconds per frame**. A software rasteriser on four contended CPU
  cores says nothing about frame rate on a GPU; the only conclusions are that
  every tier and display preset starts, renders and keeps running without page
  errors, and that cost grows from Safe to Ultra as intended.
- An earlier single run of Safe @ 1280 × 720 with less competing load measured
  a median of about 1.2 s per frame (load not recorded), which shows how much of the figures above is contention.
- The automatic optimiser reduced nothing in any of these runs. They were taken
  with an earlier version that ignored *every* frame over 250 ms; the current
  version counts consecutive slow frames and is expected to step down in this
  environment. The runs were not repeated, so that is not shown in the table.
- **Draw calls, triangle counts, internal resolution and heap size do not depend
  on the hardware** and are the useful part of the table. Shell fur explains the
  jump in triangles from Medium to High and Ultra. "Triangles / frame" counts every pass.

### Physics step (headless Node)

Method: `GameCore` with the real collision proxies from
`public/assets/plush/manifest.json`, toy scale 0.92, seed 7, Node 22, one thread;
`performance.now()` around each `fixedStep()`. "Idle" = 1 200 steps with the
pile at rest; "round" = one complete round (aim, descend, close, lift, carry,
release, settle) steered at the toy nearest the field centre — all five rounds ended in a win.
The 1-minute load average was 17 on 4 cores during the run.

| Theme | Toys | Idle step, median | Idle step, 95th pct. | Round step, median | Round step, 95th pct. | Round length (simulated) |
| --- | --- | --- | --- | --- | --- | --- |
| sakura | 18 | 0.06 ms | 0.15 ms | 0.25 ms | 6.3 ms | 6.5 s |
| storybook | 18 | 0.09 ms | 0.24 ms | 0.19 ms | 1.0 ms | 6.3 s |
| ocean | 18 | 0.05 ms | 0.09 ms | 0.26 ms | 4.4 ms | 6.2 s |
| cosmic | 18 | 0.13 ms | 0.29 ms | 0.22 ms | 4.6 ms | 6.1 s |
| sakura | 30 (maximum) | 0.12 ms | 0.24 ms | 0.43 ms | 0.9 ms | 6.0 s |

How to read this:

- One step simulates 8.33 ms. The **median** step during a round took
  0.2–0.45 ms on this CPU, i.e. a few percent of real time; at 60 fps two steps run per frame.
- The 95th percentiles (and maxima of 5–40 ms, not listed) are dominated by the
  process being descheduled on the overloaded machine: they vary between 0.7 ms
  and 6 ms from run to run for the same scene, while the medians repeat. They
  are listed for completeness and should be re-measured on an idle machine.
- In the browser the same code runs as WASM on the main thread; it was not timed
  separately there because the software renderer starves it (the game's own
  counter showed the cap of five steps per frame being hit in five of the six runs).

### Not measured

- Any frame rate, frame-time distribution or GPU load on real graphics hardware
- Anything on a Ryzen 7 7840HS / Radeon 780M
- Head-tracking inference time with a real camera (GPU or CPU delegate)
- Memory use over long sessions, thermals, power draw
- Loading time over a real network, or on a cold cache on real storage
- Firefox and Safari

## Measuring on real hardware

Use this procedure to turn the starting budgets into facts. Record the results
in this file under a new heading that names the machine.

**Setup**

1. Production build: `npm run build && npm start`, open `http://127.0.0.1:8787/?seed=7` (a fixed seed gives the same pile every time).
2. Chrome or Edge, current stable. In `chrome://gpu` confirm that WebGL 2 is
   *hardware accelerated* and note the ANGLE backend and driver version. If it
   says SwiftShader or "software only", stop — the result would be meaningless.
3. Note: CPU, GPU, RAM (and whether it is dual-channel — it matters a lot for a
   780M), OS, power plan / plugged in, display resolution, refresh rate and OS scaling.
4. *Settings → Graphics*: turn the **Performance panel** on and **Auto optimise off** for the fixed-quality runs.
5. Close other applications; let the machine idle for a minute.

**Runs** — for each row let the attract demo run for 2 minutes, then play 10 rounds; note the panel values.

| Preset | Display preset @ resolution | Head tracking | Internal res. | FPS (attract) | p95 frame (attract) | FPS (while lifting a toy) | p95 frame (lifting) | Physics ms / frame | Tracking ms @ Hz |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Safe | desktop @ 1920 × 1080 | off | | | | | | | |
| Medium | desktop @ 1920 × 1080 | off | | | | | | | |
| Medium | desktop @ 1920 × 1080 | on | | | | | | | |
| High | desktop @ 1920 × 1080 | off | | | | | | | |
| Medium | portrait32 @ 1080 × 1920 | on | | | | | | | |
| Medium | portrait86 @ 2160 × 3840 | on | | | | | | | |
| High | portrait86 @ 2160 × 3840 | on | | | | | | | |

The moment a toy is lifted is the heaviest regular moment on Medium and High
(shell fur and full-detail deformation on the held toy), so measure it separately.

**Then**

- [ ] Repeat the Medium rows with **Auto optimise on**; note which reductions it settles on and whether it oscillates.
- [ ] All four themes at Medium (they differ in lights, particles and materials).
- [ ] 30 toys (*Themes & Toys → Toys in the machine*) at Medium.
- [ ] A 30-minute attract run: frame rate at the start and the end (thermal throttling), JS heap at the start and the end (leaks).
- [ ] Theme switch and settings changes while playing: note the longest frame.
- [ ] A DevTools Performance recording of one round for the CPU/GPU split, since the panel cannot show GPU time.
- [ ] If Medium misses 60 fps on the target machine: record which single change gets it there (pixel budget, shadows 1024, plush detail = sheen) and adjust the preset in `src/app/presets.ts` accordingly.

Acceptance against the project target can only be claimed from such a run on the target machine.
