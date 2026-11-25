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
- [Lighting, environment and materials](#lighting-environment-and-materials)
- [Automatic optimiser](#automatic-optimiser)
- [Performance panel](#performance-panel)
- [Measured](#measured)
- [Measuring on real hardware](#measuring-on-real-hardware)

## Quality tiers (starting budgets)

`GRAPHICS_PRESETS` in `src/app/presets.ts`. Choose one under *Settings →
Graphics* or with `?quality=`. **Engineering defaults, not measured guarantees.**

| | Safe | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Intended starting point for | Phones, old or unknown integrated graphics, software rendering | 780M-class integrated graphics at ≈ 1080p | Mid-range discrete GPU, 1440p, 32" portrait | High-end GPU, 4K, 86" portrait |
| Frame-rate target | 30 | 60 | 60 | 60 |
| Render scale | 1.0 | 1.0 | 1.0 | 1.0 |
| Pixel-density cap (`maxDpr`) | 1.25 × | 2 × | 3 × | 3 × |
| Pixel budget | 0.7 MP | 2.1 MP (≈ 1080p) | 4.0 MP (≈ 1440p) | 8.3 MP (4K) |
| Model detail (focused / other toys) | LOD1 / LOD2 | LOD0 / LOD1, LOD2 while a toy is under 150 px tall on screen | LOD0 / LOD0 | LOD0 / LOD0 |
| Toy meshes in the shadow and contact-shadow passes | LOD2 | LOD2 | LOD1 | LOD1 |
| Printed surfaces (back wall / mat, fascia, badge, decals, emblem) | 512 / 512 | 1024 / 512–1024 | 2048 / 1024 | 4096 / 2048 |
| Tiled detail maps (normal / roughness) | 256 | 512 | 1024 | 1024 |
| Cabinet materials | plain PBR (no clearcoat, no anisotropy, no detail maps) | clearcoat lacquer, anisotropic brushed metal, woven mat with sheen, scratched glass, stippled rubber | + metallic flake under the lacquer, braided cable, bolts / hinge pins / spring, finer bevels | as High, highest tessellation |
| Studio environment (prefiltered cube face) | 256 | 256 | 512 | 512 — the size of the live capture it lights (1024 with static reflections) |
| Key-light shadow | 1024, PCF | 2048, PCF | 4096, VSM (soft) | 4096, VSM (soft) |
| Contact shadows under toys and claw | off | 256², every 2nd frame, only when something in it moved | 512², every frame, only when something in it moved | as High |
| Ambient occlusion (GTAO) | off | off | 8 samples | 16 samples |
| Glass | no front reflection | subtle reflection | subtle reflection | real transmission (extra scene pass) |
| Reflections | static studio environment | static studio environment | cabinet capture per round (512) | cabinet capture every 0.75 s (512) |
| Plush detail | sheen only (no fur shells) | 10 fur shells on the focused toy | 10 fur shells on the focused toy | 16 shells on the focused toy, 8 on all others |
| Softness detail | 4 dents | 4 dents | 6 dents, focused toy at LOD0 | 6 dents, all toys at LOD0 |
| Anti-aliasing | FXAA | FXAA | SMAA | MSAA 4× |
| Bloom | off | 0.25 | 0.30 | 0.30 |
| Decor particles | 20 | 60 | 150 | 300 |
| Effects intensity / light show | 0.5 / off | 1.0 / on | 1.2 / on | 1.5 / on |
| Viewer light (*Light from your position*) | off | on: one spot light, 1024² PCF shadow map redrawn only when the eye or a toy / the claw moved | on: 2048² soft shadow (VSM) | as High |

The "intended for" row is the design intent behind each tier, nothing more.
Cabinet and claw tessellation (bevel segments, radial segments) and the small
details (bolts, hinge pins, strain-relief spring, wound cable, fan bolts) follow the
*Textures* setting, so they come with the tier without a separate option.

What never changes with quality: the physics step (120 Hz), collision shapes,
grip rules, number of toys, HUD layout and HUD resolution. See
[ARCHITECTURE.md](ARCHITECTURE.md#why-graphics-cannot-change-outcomes).

## What each option costs

| Option | Cost driver |
| --- | --- |
| Render scale, pixel budget, pixel-density cap | Fragment work of every pass; the single most effective lever on integrated graphics and phones. A phone reporting a device pixel ratio of 3 renders 9× the pixels of its CSS size without the cap. |
| Shadows | One depth pass over all shadow casters at 1024² / 2048² / 4096², rendered **once per frame** by a pre-pass in `Stage.render` (`renderShadows`; the renderer's automatic shadow update is off, so the ambient-occlusion and depth-of-field passes, which render the scene again, no longer redraw the map). Toys are drawn with a coarse LOD (table above) and fur shells are left out. On High the map is a variance shadow map: two extra blur passes over the 4096² map (16 taps), and three.js also draws every *shadow-receiving* mesh into it. The cabinet therefore keeps its ceiling, frame and walls out of the receivers (they are merged separately from the receiving risers and mats); otherwise the lacquered ceiling would shade the whole play field on High and Ultra. |
| Contact shadows | One extra draw of the toys (coarse LOD, with the same soft-body deformation as the visible toy) and the claw (no cabinet, no shells) into a 256² / 512² height map from below, four tiny blur passes, one transparent floor quad. Re-rendered only when a toy moved or deformed, a toy appeared or left, or the claw moved while low enough to darken the floor (`ToyVisuals` change counter plus the claw's pose; otherwise the previous map is reused). Off on Safe and Low shadows. |
| Ambient occlusion | Full-screen GTAO pass plus denoise; scales with pixels and sample count. |
| Anti-aliasing | FXAA / SMAA are full-screen post passes; MSAA multiplies the samples of the half-float scene target. |
| Bloom | Several down/up-sampling passes. |
| Glass = Transmission | Renders the scene once more for the transmission buffer. |
| Reflections = Cabinet | Re-renders a cube environment from the middle of the play volume and prefilters it (once per round at up to 512, or every 0.75 s when live: 256, 512 on Ultra). While captures are used, the studio that lights them is prefiltered at the capture's size, so each lit material compiles a single shader variant (three.js builds the environment size into every program). |
| Textures | GPU memory (see the table under [Lighting, environment and materials](#lighting-environment-and-materials)) and generation time at theme load (canvas drawing and normal-map maths on the CPU, ≈ 0.1–1 s). Clearcoat, sheen and anisotropy add BRDF work on the cabinet surfaces from Medium up. |
| Plush detail | Shell fur draws the toy mesh once per layer (instanced): 10 extra layers for one toy, or 8–16 for every toy. This dominates triangle count on High and Ultra (see the measured triangle counts below). |
| Model detail, softness detail | Vertex count of the toys (procedural models about 15 000 / 5 200 / 1 700 triangles per LOD, textured models about 41 000 / 12 000 / 4 000) and the per-vertex deformation shader. Medium picks LOD2 for toys under 150 px tall on screen (`LOD2_BELOW_PX` in `src/scene/ToyVisuals.ts`; at 1280 × 720 that is every toy on the field, at 1080p most of them; the focused / held toy always gets LOD0). |
| Decor particles | Particle update on the CPU and their draw. |
| Effects (celebrations, light show) | 2 draw calls and one shared shader program per render target, no textures; about 260 KB of GPU buffers and 0.65 MB of CPU pools. Particle scale per tier 0.26 / 1 / 2.08 / 3.94 (× 0.4 with reduced motion). Drawn only in the main view, never in reflection captures or override passes (figures from the effects review). |
| Frame-rate target 30 | Skips frames to hold 30 fps; the simulation is unaffected. |
| Viewer light | One more light in every lit shader (a spot light: one cone test and one shadow lookup per fragment). Its shadow map is a depth pass over the shadow casters (toys with their coarse shadow mesh, the claw) at 1024² (Medium) or 2048² VSM (High, which also draws every receiver), done in the same pre-pass as the key light's, and only on frames where the eye or a caster moved (`Stage.poseSignature`): a resting machine viewed from a still eye redraws nothing. |
| Head tracking | Face inference runs in a worker when possible, at *Tracking rate* (default 18 Hz) and *Camera resolution* (default 480p). It competes for CPU and, with the GPU delegate, for GPU time. |

## Internal resolution

`internal size = CSS size × min(device pixel ratio, pixel-density cap) × render scale × optimiser scale`,
then scaled down uniformly if it exceeds the pixel budget (never below 0.2 × CSS
size). The canvas keeps its CSS size; the HUD is DOM and always native.

| Viewport (CSS px, pixel ratio) | Preset | Internal 3D resolution | Source |
| --- | --- | --- | --- |
| 1280 × 720, 1 | Safe | 1116 × 627 (0.70 MP) — the budget limits it | measured |
| 1280 × 720, 1 | Medium | 1280 × 720 (0.92 MP) | measured |
| 390 × 844 (phone, `display=mobile`), 3 | Safe | 488 × 1055 (0.51 MP) — the pixel-density cap, not the budget, limits it | measured |
| 1080 × 1920, 1 | Medium | 1080 × 1920 (2.07 MP) | measured (earlier run) |
| 2160 × 3840 (86" 4K portrait), 1 | Medium | 1087 × 1932 (2.10 MP) — the budget halves each dimension | measured (earlier run) |

## Lighting, environment and materials

**Studio environment** (`src/scene/environment.ts`). Image-based lighting and
reflections come from a procedural studio built per theme and prefiltered with
three.js' PMREM generator: a graded room in the theme's ceiling / wall / floor
colours, a long ceiling light strip directly above the play field (it matches the
cabinet's own diffuser), a thinner strip above the player, two tall side softboxes
tinted towards the theme's LED colours (only lightly on the dark themes), a rim
panel behind the cabinet, a large dim front fill, a floor bounce, and a ring of
small arcade lights that give chrome and glass their glints. The cube face size
follows the texture tier (256 / 256 / 512 / 1024; three.js r187 never prefilters
below 256). *Reflections = Cabinet* captures the real interior from the middle of
the play volume; the capture is always lit by the studio, never by the previous
capture, so there is no feedback. While captures are in use they replace the studio
everywhere, so the studio is then prefiltered at the capture's size (512 per round on
High, 512 every 0.75 s on Ultra): a second size would compile every lit material
twice and keep an unused 1024 cube (≈ 67 MB) in memory.

**Shadows** (`src/scene/Stage.ts`, `src/scene/contactShadows.ts`). The key light
(above, slightly front-left) casts the main shadow: hardware PCF on Low and
Medium, a wide-blur variance shadow map on High (the broad, noise-free penumbra of
a cabinet lit by a large diffuser). Shadows are never fully black
(`shadow.intensity` 0.88). From Medium up, *contact shadows* add the soft dark
rim where toys touch the mat and a faint, wide shadow under the descending claw:
the toys and the claw are rendered from below into a height-coded map, blurred
and laid over the mat (never over the chute opening).

<a id="viewer-light"></a>**Viewer light** (`src/scene/viewerLight.ts`, setting *Graphics → Light from your
position*, `graphics.viewerLight`). The player stands in front of the glass like someone in the
arcade, and a small light where they are shines in: one `SpotLight` aimed at the middle of the play
field, warm white (neutral white in the GPU / brand-kit theme), with a wide soft edge (full strength
within 0.62 m of the field's centre, gone at 1.45 m). It follows the same filtered eye the off-axis
camera uses — head tracking, drag-to-peek, the attract sway or the reference eye — in every layout,
so it is exactly as smooth as the view and never jitters on its own. It is not *exactly* at the eye:
a light at the eye throws every shadow straight behind its caster, where that eye cannot see it. It
sits a little above the eye (`VIEWER_LIFT` 0.2 of its distance to the field, about 11°) and leads it
sideways (`VIEWER_LEAD` 1.7× the eye's distance from the window's centre line), so the shadows of the
claw and the toys peek out below them and visibly slide over the mat and the back wall, the other
way, when the player moves. The light reaching the field's centre is the same at every viewing
distance (decay 1, normalised there: 1.1, against the key light's 2.4–3.1). While it is on, the
unshadowed fill is lowered (sky / ground light × 0.6, studio environment × 0.8) so the scene keeps its
brightness instead of washing out. Shadow per tier: none on *Shadows* Off / Low; 1024² PCF on Medium;
2048² VSM, wider blur on High and Ultra. The map is drawn in the key light's pre-pass with the toys'
coarse shadow meshes, and only when the eye or a caster moved: the toys' and the claw's poses are
compared, rounded to half a millimetre, so resting toys do not redraw it. The Safe preset turns the
light off (it costs every lit fragment on a phone); stored settings without the key take it from
their preset. With reduced motion it still follows the eye (the eye itself is what reduced motion
calms). Presentation only: no collider, nothing the simulation reads.

**Materials** (`src/scene/materials.ts`, procedural maps in
`src/scene/textures.ts` / `src/scene/texgen.ts`, all generated at run time):

| Surface | Medium and up | High and up |
| --- | --- | --- |
| Cabinet frame, claw cap | clearcoat lacquer | metallic flake normal map under the coat |
| Rails, gantry, claw drum, knuckles | brushed / anodised metal: groove normal map, streaked roughness, anisotropic highlight; UVs run along each part | stronger anisotropy |
| Chrome (beads, posts, claw body) | mirror chrome | faint scratch roughness map |
| Side glass, chute acrylic | Fresnel-weighted coverage, full-strength reflections (premultiplied blending), edge tint, micro-scratches and wipe marks | — |
| Front glass overlay | reflection streaks that follow the viewer, scratches catching light inside them | — |
| Floor mat, bay mats | quilting plus a woven fabric normal map, sheen | finer weave (128 threads per tile) |
| Claw tips, wheels | stippled soft-touch rubber | — |
| Cable | steel | braided normal map at a constant 7 mm pitch |
| Decals | printed stickers (WIN!, FREE PLAY, MIND THE CLAW, PRIZE arrow) with a clear coat | — |

All colour textures use mipmaps and the renderer's anisotropic filtering (up to
4× / 8× / 16× by texture size). Approximate texture memory of one theme's cabinet
(RGBA8 with mip chains, `CabinetMaterials.textureBytes()`), plus the
environment and shadow targets:

| | Safe | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Cabinet textures (GPU theme, measured before the brand kit; Medium is now 37.5 MB) | 8.7 MB | 40.7 MB | 78.0 MB | 222 MB (89 MB of it the 4K back wall) |
| Studio environment (half-float cube + mips; the generator keeps a source cube of the same size up to 512) | ≈ 4 (+ 4) MB | ≈ 4 (+ 4) MB | ≈ 17 (+ 17) MB, + 17 MB capture | ≈ 17 (+ 17) MB, + 17 MB live capture (static reflections: ≈ 67 MB, no capture) |
| Key-light shadow map | 4 MB depth | 17 MB depth | ≈ 200 MB (VSM: two RG16F targets + depth) | as High |
| Viewer-light shadow map | — (light off) | 4 MB depth | ≈ 50 MB (VSM, 2048²) | as High |

**GPU theme (brand kit)** (`pattern: 'circuit'`). Printed-circuit wallpaper and
the server-hall backdrop, now in the NVIDIA palette only. The back wall of the
play field is an LED wall (`src/scene/ledWall.ts`, layout in `src/scene/brandScene.ts`)
carrying the brand kit's event logo. The logo is an unlit plane on a black pad;
its shader undoes exposure and Neutral tone mapping, so the logo keeps its
colours exactly. Behind it run animated green sweeps, scanlines and data
packets; they stand still with reduced motion. Above the wall is a slim truss
with five white spot fixtures. In landscape the side bays carry black anodised
case fans with spinning rotors, floating chips and lit traces. The "GPU" block
letters, the chip-carrier emblem and the lightning bolts are gone.

Measured on Medium, desktop 1280 × 720, gpu theme, software GL, against the
previous build served side by side:

| | Before | After |
| --- | --- | --- |
| Draw calls per frame | 149–171 | 148–170 |
| Triangles per frame | 242k–314k | 237k–309k |
| Textures | 57 | 57 |
| Shader programs | — | +2 (LED wall, logo) |
| Cabinet textures | 40.7 MB | 37.5 MB |

**Logo slots.** The logos and the brand font are files the owner drops into
`public/assets/brand/gtc/` (or `dist/assets/brand/gtc/` on a built kiosk). Until
then an original placeholder wordmark is shown. The neutral kit uses the
original emblem `public/assets/themes/gpu/logo.svg`. See [BRAND.md](BRAND.md).

## Automatic optimiser

`src/app/AdaptiveQuality.ts`, on by default (*Graphics → Auto optimise*). It
removes cost only while the frame-rate target is being missed, in a fixed order,
and gives it back when there is headroom.

| Step | Id | Shown as (English) | Reduction |
| --- | --- | --- | --- |
| 1 | `particles` | fewer decor particles | Decor particles to 30 % |
| 2 | `bloom` | bloom off | Bloom off |
| 3 | `ao` | ambient occlusion off | Ambient occlusion off |
| 4 | `reflections` | studio reflections | Reflections → static studio environment |
| 5 | `glass` | reflective glass | Glass: transmission → reflective |
| 6 – 8 | `scale90` … `scale70` | 3D resolution 90 % … 70 % | Internal resolution × 0.9, × 0.8, × 0.7 |
| 9 | `shadows` | shadows one level lower | Shadows one level down: 4096 VSM → 2048 PCF (High), or 2048 → 1024 with contact shadows off (Medium) |
| 10 – 11 | `scale60`, `scale50` | 3D resolution 60 %, 50 % | Internal resolution × 0.6, × 0.5 |

The Graphics tab lists active reductions by their translated labels
(`src/i18n/strings/graphics.ts`, keys `graphics.step.<id>` from
`reductionLabelKey()`), never by id, and shows only the current resolution step
(`visibleReductions()`: "3D resolution 70 %", not "90 %, 80 %, 70 %"). Step 9 on High switches the shadow filter
from VSM to PCF, which makes three.js recompile the lit materials once; that
single long frame is ignored by the hitch rule below.

Steps that would change nothing for the current settings are skipped on the way
down: from Medium (AO off, static reflections, reflective glass) the order is
particles → bloom → resolution × 0.9 … — "AO off" is never waited for.

Rules:

- Frame times are judged in consecutive windows of about one second: a window
  closes after at least 0.9 s of frame time and 30 samples, or — at very low
  frame rates — after at least 6 samples and 2.5 s. Each window is judged on its own frames only.
- **Reduce** by one effective step when the 80th-percentile frame time is above
  `1.22 × (1000 / target)` in three windows in a row (20.3 ms at 60 fps, 40.7 ms at 30 fps).
  A dip of a second or two therefore removes nothing. When the machine is far
  over budget (80th percentile above `2.5 ×` the target frame time) two steps are taken at once.
- **Restore** one list position when it is below `0.72 ×` the target frame time in seven
  windows in a row (12 ms at 60 fps). The gap between the two thresholds and
  the slow recovery keep it from oscillating.
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

### Render statistics per tier (environment and materials round)

> These numbers predate round 3 (coarse shadow meshes, a single shadow pass per frame, contact
> shadows refreshed on change, view-dependent LOD on Medium, warm-up against the composer target);
> see [Triangle budget (round 3)](#triangle-budget-round-3) for the current counts.

Method: production build served by `vite preview`, headless Chromium (SwiftShader),
`?debug=1&camera=off&seed=7&display=desktop&theme=gpu&quality=<tier>` at 1280 × 720, device
pixel ratio 1, attract screen (1-minute load average 23–55 from other jobs); values read from
`renderer.info` after the second rendered frame following boot (Ultra: the first). The GPU Party theme still showed the Cosmic characters (its own plush models were
not in the manifest yet), so the toy share of the triangles is that of the Cosmic toys.
Draw calls and triangles count every pass of that frame (shadow map, contact-shadow pass on the
frames that refresh it, main pass, post). These numbers do not depend on the hardware; frame
times were not measured in this round (seconds per frame in software rendering, see below).

| Tier | Internal resolution | Draw calls | Triangles | Shader programs | Geometries | Textures | Cabinet textures | Environment / shadow / contact |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Safe | 1116 × 627 (0.70 MP) | 133 | 217 294 | 39 | 81 | 35 | 8.7 MB | 256 / 1024 PCF / off |
| Safe, phone (`display=mobile`, 390 × 844 CSS, pixel ratio 3) | 488 × 1055 (0.51 MP) | 120 | 179 926 | 35 | 76 | 35 | 8.7 MB | 256 / 1024 PCF / off |
| Medium | 1280 × 720 (0.92 MP) | 148 | 530 643 | 58 | 89 | 54 | 40.7 MB | 256 / 2048 PCF / 256², every 2nd frame |
| High | 1280 × 720 (0.92 MP) | 373 | 4 103 050 | 71 | 92 | 68 | 78.0 MB | 512 (+ 512 cabinet capture) / 4096 VSM / 512² |
| Ultra | 1280 × 720 (0.92 MP) | 554 | 8 222 090 | 94 | 98 | 77 | 222 MB | 1024 (+ 256 live capture) / 4096 VSM / 512² — before the review fixes below |
| High, Sakura (own textured characters) | 1280 × 720 | 334 | 4 086 260 | 71 | 73 | 67 | 72.7 MB | as High |
| High, Storybook (own textured characters) | 1280 × 720 | 334 | 4 079 929 | 71 | 73 | 67 | 72.7 MB | as High |
| High, Ocean (own textured characters) | 1280 × 720 | 333 | 4 083 479 | 71 | 72 | 67 | 72.7 MB | as High |
| High, Cosmic (own textured characters) | 1280 × 720 | 335 | 4 076 012 | 71 | 73 | 67 | 72.7 MB | as High |

The frame-to-frame spread is noticeable on Medium because its contact shadows are refreshed on
every other frame only. Most of the High / Ultra triangles are toys: the new textured characters
(about 41 000 triangles at LOD0) are drawn in the main pass, the shadow pass (VSM also draws every
shadow *receiver*, fur shells included), the contact-shadow pass and, on Ultra, with fur shells on
every toy. Console output of every run: no shader compile errors, no page errors
(the only warnings were "KHR_parallel_shader_compile extension not supported" and the GPU Party
placeholder-toy notice).

After the review of this round two changes altered these numbers: the cabinet merges its
shadow-receiving parts separately from the rest (one more draw call in landscape; under VSM the
lacquered ceiling no longer shades the play field), and while cabinet captures are used the
studio is prefiltered at the capture's size (512 on Ultra, so the lit materials compile once
instead of once per environment size). Re-measured the same way (load average about 8–18):

| Tier | Internal resolution | Draw calls | Triangles | Shader programs (environment size compiled in) | Cabinet textures | Environment / shadow / contact |
| --- | --- | --- | --- | --- | --- | --- |
| Safe | 1116 × 627 (0.70 MP) | 134 | 217 360 | 39 (22 × 256) | 8.7 MB | 256 / 1024 PCF / off |
| Medium | 1280 × 720 (0.92 MP) | 149 | 530 659 | 58 (28 × 256) | 40.7 MB | 256 / 2048 PCF / 256² |
| High | 1280 × 720 (0.92 MP) | 375 | 4 085 578 | 71 (32 × 512) | 78.0 MB | 512 (+ 512 capture) / 4096 VSM / 512² |
| Ultra (960 × 540 viewport) | 960 × 540 (0.52 MP) | 557 | 8 186 742 | 74 (36 × 512) | 222 MB | 512 (+ 512 live capture) / 4096 VSM / 512² |

### Triangle budget (round 3)

Target set for this round: Medium (desktop 1280 × 720, 18 toys) at about 500 000 triangles per
frame or less, all passes included, in normal play and in attract mode, without visible quality
loss in the main view; High and Ultra may stay richer. What changed (details under
[What each option costs](#what-each-option-costs) and in [ASSETS.md](ASSETS.md#lods)):

- the key-light shadow map is drawn once per frame by a pre-pass, with each toy's coarse shadow
  mesh (LOD2 on Low / Medium, LOD1 on High / Ultra) and without fur shells; before, it was drawn
  with the toys' main LOD and — on High and Ultra — a second time by the ambient-occlusion pass;
- the contact-shadow pass uses the same coarse meshes, now with the toys' soft-body deformation,
  and is re-rendered only when something in it moved;
- Medium draws non-focused toys smaller than 150 px on screen with LOD2 (every toy on the field at
  1280 × 720, where they are 74–103 px tall); the focused / held toy keeps LOD0 and its fur shells.

Method: production builds of the state before and after this round, headless Chromium
(SwiftShader), `?debug=1&camera=off&seed=7&display=desktop&theme=sakura&quality=<tier>` at 1280 × 720
(Ultra 960 × 540: triangle and call counts do not depend on the viewport), device pixel ratio 1.
Per-pass counts come from wrapping `renderer.shadowMap.render` and the contact-shadow update and
reading `renderer.info` after each rendered frame; every row covers five or more consecutive
frames ("–" separates the lowest and highest frame). Attract = the demo pilot playing; ready = a
player round with the claw parked over a toy; held = the toy lifted. 1-minute load average
during the runs: 4–15 (other jobs on the same four cores), which affects nothing below.

| Tier, state | Whole frame before | Whole frame after | Draw calls before → after | Toys, main pass before → after | Shadow map before → after | Contact map before → after |
| --- | --- | --- | --- | --- | --- | --- |
| Safe, attract / ready | 205 618 | 205 618 | 115 → 115 | 71 982 → 71 982 | 75 118 → 75 118 | off |
| Safe, held | 221 608 | 213 608 | 115 → 115 | 79 982 → 79 982 | 83 118 → 75 118 | off |
| **Medium, attract** | 516 543 – 732 546 | **228 513 – 300 501** | 130–152 → 130–152 | 215 997 → 71 982 | 221 605 → 77 590 | 216 001 → 71 986 (refreshed in 2 of 5 frames) |
| **Medium, ready** | 516 485 – 732 556 | **228 455 – 300 511** | 130–152 → 130–152 | 215 997 → 71 982 | 221 605 → 77 590 | 216 001 → 71 986 |
| **Medium, held** | 694 994 – 940 282 | **385 693 – 457 697** | 118–140 → 118–140 | 365 268 → 229 253 | 250 876 → 77 590 | 245 272 → 71 986 |
| Medium, GPU Party, attract | 530 653 – 746 657 (Cosmic stand-ins) | 242 175 – 314 159 (own characters) | 149–171 → 149–171 | 215 994 → 71 974 | 221 602 → 77 582 | 215 998 → 71 978 |
| Medium, GPU Party, held (review) | not measured | 399 141 – 471 129 | → 150–172 | → 228 984 | → 77 582 | → 0 / 71 974 (refreshed in 2 of 4 frames) |
| High, attract | 4 064 818 | 2 210 799 | 336 → 273 | 741 471 → 741 471 | 1 606 142 (drawn twice: 126 calls) → 277 597 (once: 63 calls) | 741 475 → 216 001 |
| High, held (see the note below) | 2 645 171 – 4 544 863 | 1 474 239 | 178–327 → 177 | 861 471 → 861 471 | 923 071 – 1 846 142 → 277 597 | 741 475 → 216 001 |
| High, held, optimiser off (review) | not measured | 2 450 759 – 2 450 813 | → 275 | → 861 471 | → 277 597 | → 215 997 |
| Ultra, attract (960 × 540) | 8 033 850 | 5 007 831 | 499 → 400 | 1 317 327 → 1 317 327 | 2 798 430 → 297 885 (63 calls; shells left out) | 741 475 → 216 001 |

**Note on the High "held" rows (review).** Software rendering takes seconds per frame, so the
automatic optimiser (*Auto-optimise*, on by default) starts switching effects off during a run;
by the time a toy is held on High it had turned ambient occlusion off, which removes the AO
pass's second drawing of the whole scene (≈ 1 M triangles, ~100 calls). The first High "held"
row was measured that way (177 calls), and its "before" range mixes optimiser states, so it is
not a like-for-like comparison. With the optimiser switched off after boot
(`graphics.autoOptimize = false`), High measured 1 994 834 – 2 210 853 triangles in attract
(251–273 calls, the same as the row above) and 2 450 759 – 2 450 813 with a held toy (275 calls,
Sakura, every frame refreshing the contact map). A "before" build of High with the optimiser off
did not finish its round within 50 minutes of software rendering and has no row. The Medium rows
are hardly affected in triangles: before *Shadows* (the ninth step, which would also remove the
contact map) the optimiser only reduces particles, bloom, glass and resolution there, and the
contact map was still being refreshed in every Medium run of the review. Not in any of these
counts: the cabinet capture of *Reflections* "refresh" / "live" (High once after a change, Ultra
every 0.75 s: six cube faces of the whole scene) runs in `Stage.render` before `renderer.info` is
reset, so it never shows up in a per-frame reading.

Medium now stays under 500 000 triangles in every measured frame (the highest is a held toy on a
frame that also refreshes the contact map). Where the triangles of a held-toy frame on Medium go:
the toy in the claw 41 k (LOD0) plus 120 k of fur shells (10 layers on LOD1), the other 17 toys
68 k, the shadow map 78 k, the contact map 72 k when it is refreshed, the cabinet, claw, effects
and post-processing about 78 k.

**Quality check of the Medium change.** Screenshots of the same frame (Sakura, round ready,
1280 × 720, device pixel ratio 1 and 2) with the non-focused toys at LOD1 and at LOD2 differ by a
mean of 0.12 / 255 per channel over the frame (1.8 / 255 over the toy area). Side by side at 2–3 ×
zoom a few toys show slightly different shading (the capybara's head is a little darker with LOD2);
no texture seams or missing parts were seen. The before / after frames of the whole round state
differ by 0.32 / 255. If the difference matters on a large display, lower `LOD2_BELOW_PX` in
`src/scene/ToyVisuals.ts` (0 disables it; Medium then measured 372 k triangles in the ready state
on a frame without a contact refresh; with a held toy on a contact-refresh frame it would be about
590 k, estimated from the per-pass counts above, not measured).

**Shader programs** (`renderer.info.programs` after boot and after the first grab; "canvas-keyed"
= compiled for the canvas' output colour space and tone mapping, i.e. never used by the scene,
which is drawn into the composer's half-float target; the last post-processing pass — FXAA on
Safe / Medium, SMAA on High — legitimately draws to the canvas, Ultra's MSAA needs none). `Stage.warmUp()` now compiles against the composer's target and also compiles the fur-shell
variant, which used to be built on the first aim:

| Tier | Before: at boot / after grab (canvas-keyed) | After: at boot / after grab (canvas-keyed) |
| --- | --- | --- |
| Safe | 39 / 39 (18) | 24 / 24 (1) |
| Medium | 58 / 52 (21) | 39 / 33 (1) |
| High | 71 / 63 (23) | 50 / 41 (1) |
| Ultra (attract only) | 74 (23) | 50 (0) |

Review of round 3: two programs were still built during the first round, i.e. as a hitch on the
first grab — the contact pass's plain height material (only the claw uses it, and only once it
comes within 20 cm of the floor) on Medium and High, and on High / Ultra the instanced variant of
the ambient-occlusion pass's normal material (first drawn for the fur shells of the aimed toy).
`Stage.warmUp()` now compiles both (`ContactShadows.compile`, and the AO normal material on the
late objects). Counted by wrapping `linkProgram` / `useProgram` of the WebGL context from page
load (Sakura, 1280 × 720, automatic optimiser off for High):

| Tier | Before the fix: linked during warm-up / first frames / first round | After |
| --- | --- | --- |
| Medium | 40 / 3 (both contact blur passes, the toys' contact height material) / 1 (claw contact height) | 42 / 2 (both blur passes, first frame) / 0 |
| High (before = with the contact fix already in) | 55 / 0 / 1 (AO normal material, instanced) | 56 / 0 / 0 |

Every program linked during warm-up was used by a later frame (none wasted); the only one keyed
for the canvas is the final FXAA / SMAA pass.

**Textures of the textured toys** (GPU memory, RGBA8 with mip chains; three maps per character,
the roughness map capped at 1024²; display-bay toys share their characters' textures):

| Textures setting | Per character | Six characters | GPU Party (seven) |
| --- | --- | --- | --- |
| 512 (Safe) | 4 MB | 24 MB | 28 MB |
| 1K (Medium) | 16 MB | 96 MB | 112 MB |
| 2K and 4K (High, Ultra) | 48 MB | 288 MB | 336 MB |

Texture objects counted by `renderer.info.memory.textures` (all textures, cabinet included) at
boot, Sakura: Safe 34, Medium 53, High 67, Ultra 76 (unchanged by this round).

### Asset sizes per theme

`public/assets/plush` after round 3 (all 31 characters with a generated model). What a theme
downloads depends on the *Textures* setting: the generated GLB with its embedded 512² textures
always, plus the 1K or 2K WebP files.

| Theme | Characters | Procedural GLBs | Generated GLBs (LODs + embedded 512² textures) | 1K textures | 2K textures | On disk | Downloaded at 512 / 1K / 2K |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sakura | 6 | 1.3 MB | 4.4 MB | 1.7 MB | 7.7 MB | 15.1 MB | 4.4 / 6.0 / 12.1 MB |
| storybook | 6 | 1.3 MB | 5.1 MB | 2.0 MB | 9.6 MB | 18.1 MB | 5.1 / 7.1 / 14.7 MB |
| ocean | 6 | 1.3 MB | 4.6 MB | 1.7 MB | 8.1 MB | 15.7 MB | 4.6 / 6.3 / 12.7 MB |
| cosmic | 6 | 1.3 MB | 4.6 MB | 1.7 MB | 7.8 MB | 15.4 MB | 4.6 / 6.3 / 12.4 MB |
| gpu | 7 | 1.4 MB | 7.3 MB | 3.4 MB | 12.4 MB | 24.5 MB | 7.3 / 10.7 / 19.7 MB |
| all | 31 | 6.7 MB | 25.9 MB | 10.5 MB | 45.7 MB | 88.9 MB | |

### Browser frame time (software rendering)

> The table below predates the environment / materials round (new studio environment, contact
> shadows, VSM on High, tiered materials and tessellation); its draw-call and triangle columns are
> therefore lower than the current ones above.

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

### Physics after the proxy changes

Round 3 changed the collision proxies of `sakura.tanuki`, `ocean.jellyfish`, `ocean.seal`,
`cosmic.spacerobot`, `gpu.chief`, `gpu.bot` and `gpu.pixel` (see
[ASSETS.md](ASSETS.md#fitting-the-collision-proxies-to-a-generated-model)). Grab outcomes were
re-measured headless with the offset sweep of `tools/dev/grip-sweep.ts` (Arcade, real physics,
toy scale 0.92, 18 toys): eight field seeds per theme for the three themes with changed
characters (the same sweep run on the old and the new manifest, so the seeds and aims are
identical), six for GPU Party. "Centred" is 0 and 1.5 cm from the centre of mass together;
win shares with the number of rounds in brackets.

| Character | Centred, before → after | 3 cm off | 4.5 cm off |
| --- | --- | --- | --- |
| `sakura.tanuki` | 100 % (39) → 100 % (43) | 88 % → 89 % | 85 % → 57 % |
| `ocean.jellyfish` | 100 % (41) → 100 % (39) | 93 % → 100 % | 74 % → 88 % |
| `ocean.seal` | 100 % (39) → 100 % (39) | 96 % → 100 % | 65 % → 69 % |
| `cosmic.spacerobot` | 100 % (38) → 97 % (38) | 84 % → 84 % | 78 % → 63 % |
| `gpu.chief` | 95 % (21) → 95 % (21) | 93 % → 86 % | 64 % → 64 % |
| `gpu.bot` | 100 % (27) → 100 % (27) | 82 % → 89 % | 71 % → 59 % |
| `gpu.pixel` | 96 % (27) → 96 % (27) | 71 % → 82 % | 25 % → 25 % |

All themes together (three seeds): centred 100 % / 99 % → 100 % / 100 % (0 / 1.5 cm), 3 cm 92 % → 93 %,
4.5 cm 69 % → 68 %. No world anomalies in the final runs; one intermediate GPU Party run (final chief
design, before the last pixel change) ended one round with the chief resting on the chute guard, and
the run with the final designs had none, so that pile-dependent case may still occur occasionally. The tanuki was
unusually forgiving far off-centre before (85 % at 4.5 cm against 56–79 % for the other Sakura
characters); with a hull for its big tail and its deeper body it is now in that range. The space
robot lost the collider of a wind-up key that its generated model does not have, so off-centre
grabs from behind can no longer catch an invisible handle. The other characters of these themes
moved by up to ±12 points at 4.5 cm (the pile around them changed); centred grabs stayed at
96–100 %. The headless tests in `tests/unit/game` (fixed seeds, real assets) pass.

### Viewer light (round 4)

Method: production build served by the API server, headless Chromium (SwiftShader, no GPU),
`?debug=1&camera=off&seed=7&display=desktop&theme=sakura&quality=medium` at 1280 × 720, device pixel
ratio 1, a player round in READY with the claw at home, automatic optimiser switched off after boot.
Each case is one `Stage.render` timed between two 1-pixel read-backs (which make the browser finish
the queued GPU work); the four cases took turns frame by frame, six frames each, because the frame
time of the loaded software rasteriser drifted by a factor of two within minutes (1-minute load
average 15–23 from other jobs on the same four cores). Draw calls and triangles count every pass of
the frame, read from `renderer.info`.

| Case | Draw calls | Triangles | Viewer-light map drawn | Frame, median (min) |
| --- | --- | --- | --- | --- |
| Light off, eye still | 139 | 246 983 | — | 3.84 s (3.29 s) |
| Light on, eye still | 139 | 246 983 | 0 of 6 frames | 3.78 s (2.89 s) |
| Light on, eye moving | 169 | 324 573 | 6 of 6 frames | 5.18 s (3.15 s) |
| Light off, eye moving | 139 | 246 983 | — | 4.40 s (2.35 s) |

So: with a still eye and resting toys the light costs no draw call and no triangle (its map is not
redrawn) and no measurable time; a frame that redraws its 1024² map adds 30 draw calls and about
78 000 triangles (the toys' coarse shadow meshes and the claw) and was 0.8–1.3 s slower here, which
is within the noise of this machine. What it costs on real integrated graphics (one more light in
every lit fragment, one small depth pass while the player moves) was **not measured**. The proof
screenshots (eye left, right, high and low, desktop and portrait32, Sakura and GPU Party) show the
claw's shadow on the back wall sliding the other way as the eye moves; on the GPU Party theme the back
wall is the LED screen, which is unlit, so its shadows land on the mat and the toys only. Checked
the same way on the other tiers (800 × 450): High draws the 2048² soft map (291 draw calls, 2.26 M
triangles in a still frame, the High tier's own cost), Safe leaves the light off (118 calls); no
console errors or shader compile errors in any of these runs.

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
