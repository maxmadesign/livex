# Settings reference

The settings dialog opens from the round **i** button (top right) or the first
button of the control-panel menu. It has eight tabs. Every setting is declared
once in `src/settings/spec.ts` (type, default, range, apply mode); the tables
below were regenerated from that specification (and the English labels in
`src/i18n/strings/`) for this version, so paths, defaults and ranges are the real ones.

- [How editing works](#how-editing-works)
- [Game](#1-game) · [Themes & Toys](#2-themes--toys) · [Layout](#3-layout) · [Graphics](#4-graphics) · [Audio](#5-audio) · [AI Guide](#6-ai-guide) · [Camera & Parallax](#7-camera--parallax) · [System](#8-system)
- [Presets](#presets)
- [Import and export](#import-and-export)
- [Public display lock](#public-display-lock)
- [Where settings are stored](#where-settings-are-stored)

## How editing works

- Opening the dialog pauses the game and starts a **draft**. Changes are
  previewed at once behind the dialog ("Unsaved changes — previewing").
- **Apply** saves the draft. **Cancel**, `Esc`, the close button and tapping
  outside the dialog discard it and restore what was applied before.
- **Reset this tab** restores the defaults of the current tab (in the draft —
  it still needs Apply). On *Layout* it resets only the layout of the active
  display preset; on *Camera & Parallax* it resets the tracking settings plus
  that preset's viewing geometry and calibration, and keeps its layout.
- The **Applies** column:

| Value | Meaning |
| --- | --- |
| live | Takes effect immediately, including as a preview while the dialog is open. |
| next round | Changes the game itself. Read only from applied settings, used from the next round on. |
| rebuild | Rebuilds the toy field or theme. Happens when the current round is over; the dialog marks these "after this round". |

Values are clamped to their range and snapped to their step when set, loaded or imported.

## 1. Game

Sections: Difficulty · Claw movement · Grip · Round · Player help.

| Setting | Path | Default | Range / options | Applies |
| --- | --- | --- | --- | --- |
| Difficulty | `gameplay.difficulty` | `arcade` | `easy` · `arcade` · `skill` · `custom` | next round |
| Move speed | `gameplay.moveSpeed` | 0.42 | 0.15 … 0.9 (step 0.01) m/s | next round |
| Acceleration | `gameplay.moveAccel` | 2.4 | 0.5 … 8 (step 0.1) m/s² | next round |
| Descend speed | `gameplay.descendSpeed` | 0.55 | 0.2 … 1.2 (step 0.01) m/s | next round |
| Lift speed | `gameplay.liftSpeed` | 0.42 | 0.15 … 1 (step 0.01) m/s | next round |
| Cable swing | `gameplay.ropeSwing` | 0.55 | 0 … 1.5 (step 0.05) | next round |
| Claw force | `gameplay.clawForce` | 1 | 0.3 … 2 (step 0.05) | next round |
| Closing speed | `gameplay.closeSpeed` | 1 | 0.4 … 2.5 (step 0.05) | next round |
| Grip assist | `gameplay.gripAssist` | 1 | 0 … 1.5 (step 0.05) | next round |
| Toy friction | `gameplay.toyFriction` | 1 | 0.4 … 1.6 (step 0.05) | next round |
| Toy weight | `gameplay.toyMass` | 1 | 0.6 … 1.8 (step 0.05) | rebuild |
| Aim time limit | `gameplay.aimTimeLimit` | 0 | 0 … 60 (step 1) s | next round |
| Restocking | `gameplay.restock` | `afterWin` | `afterWin` After every win · `whenLow` When running low · `manual` | next round |
| Points | `gameplay.scoring` | on | on / off | live |
| Aim ring | `gameplay.aimReticle` | on | on / off | live |
| Aim beam | `gameplay.aimBeam` | on | on / off | live |
| Show how-to-play on first start | `gameplay.tips` | on | on / off | live |

- *Difficulty* is a preset over eight physical values (see [Presets](#presets)). It never sets a win rate; there is none.
- *Grip assist*: a limited hold that is created only after at least two fingers really touch a toy and that lets go when overloaded. `0` = pure friction.
- *Cable swing*: `0` = stiff cable, `1` = free swinging.
- *Aim time limit*: `0` = no limit; when time runs out the claw drops where it is.
- *Restocking*: `afterWin` refills the field after every win, `whenLow` when 60 % or fewer of the toys are left, `manual` only with the button.
- *Show how-to-play on first start*: the how-to-play card appears once, the first time a player presses START on this device.
- *Points*: the score shown next to the top bar (beside the control panel on 86"), "+N" popups at the prize exit,
  combo badge and a points breakdown on the win card. Presentation only: switching it off hides the score and awards
  nothing, it never changes the claw or the physics. The tab shows the points legend:

  | | Common | Rare | Epic | Legendary |
  | --- | --- | --- | --- | --- |
  | Base points | 100 | 250 | 500 | 1000 |
  | Characters | 10 | 10 | 6 | 5 |

  A win scores `round((round(base × difficulty) + first catch + clean grab) × combo)`: difficulty Easy ×0.8,
  Arcade ×1, Skill ×1.5, Custom ×1; *first catch* (first time this character is collected) +50 % of base;
  *clean grab* (grip centring ≥ 0.8 and at least three fingers on the toy) +20 % of base; combo for consecutive
  wins ×1.5 (2nd), ×2 (3rd), ×3 (4th and later). A slip scores 10 and an empty grab 0; both end the combo.
  Every round is settled exactly once (`src/game/scoring.ts`, rarity table in `src/game/rarity.ts`).
- The **session** score starts at 0 when a player takes over from attract mode and is cleared by the idle reset.
  **Best session** and **lifetime points** are stored on the device (see [storage](#where-settings-are-stored));
  demo rounds score on a separate DEMO track that is never stored. *System → Reset scores* clears both.
- Buttons: **Restart this round**, **Restock now**.

## 2. Themes & Toys

Sections: Theme · Characters in this theme · Play field · Custom models.

| Setting | Path | Default | Range / options | Applies |
| --- | --- | --- | --- | --- |
| Theme | `themes.current` | `sakura` | `sakura` · `storybook` · `ocean` · `cosmic` · `gpu` | rebuild |
| themes.disabledToys | `themes.disabledToys` | *(none)* | ≤ 48 ids | rebuild |
| Toys in the machine | `gameplay.toyCount` | 18 | 6 … 30 (step 1) | rebuild |
| Toy size | `themes.toyScale` | 0.92 | 0.8 … 1.25 (step 0.01) | rebuild |
| Pile density | `themes.stackDensity` | 0.2 | 0 … 1 (step 0.05) | rebuild |
| themes.customModels | `themes.customModels` | *(none)* | ≤ 24 entries | rebuild |

- *Theme* is chosen with five cards — Sakura Kawaii, Storybook Friends, Ocean Dream, Cosmic Arcade, GPU Party (also
  reachable from the HUD's theme chip and menu). `?theme=` sets it at launch.
- *Characters in this theme*: one switch per character ("In the machine"), with its size, weight and status
  (*Original character*, *Original — slot ready for a licensed model*, *Your imported model*). At least one character stays switched on.
  Switched-off ids are stored in `themes.disabledToys`.
- Characters whose shipped model is AI-generated carry an **AI-generated (Higgsfield)** line (the generator and the
  manifest's licence note appear on hover), and a note under the list explains it: the model was made with Higgsfield
  (concept image, then image-to-3D) from the original design, collision shape, weight and fallback model come from
  that design, and Higgsfield's current terms decide ownership and commercial use. Provenance per character is in
  `public/assets/plush/manifest.json` (`source`); see [ASSETS.md](ASSETS.md).
- *Replace model… / Use built-in model*: per-character GLB import, stored as references in `themes.customModels`
  (the file itself is in IndexedDB). Limits: [ASSETS.md](ASSETS.md#in-app-glb-import).
- *Pile density*: `0` = one tidy layer, `1` = a tall pile.
- Button: **Rearrange toys**.

## 3. Layout

Sections: Display preset · Interactive zone · Sizes · Scene. Values belong to
the **active display preset**; each preset keeps its own
(`profiles.desktop`, `profiles.portrait32`, `profiles.portrait86`, `profiles.mobile`). All are *live*.

| Setting | Path | Default | Options |
| --- | --- | --- | --- |
| Display preset | `display.profile` | *(empty → first-run chooser)* | `desktop` · `portrait32` · `portrait86` · `mobile` |

| Setting | Path (`profiles.<preset>.layout.…`) | desktop | portrait32 | portrait86 | mobile | Range / options |
| --- | --- | --- | --- | --- | --- | --- |
| Auto-fit | `autoFit` | on | on | on | on | on / off |
| Zone top | `safeTop` | 0 | 0 | 0.25 | 0 | 0 … 0.6 (step 0.01) |
| Zone bottom | `safeBottom` | 1 | 1 | 0.75 | 1 | 0.4 … 1 (step 0.01) |
| Control panel height | `anchorY` | 0.84 | 0.865 | 0.6 | 0.86 | 0.2 … 0.95 (step 0.005) |
| Control panel width | `panelWidth` | 0.94 | 0.94 | 0.6 | 1 | 0.3 … 1 (step 0.01) |
| Grab button side | `handedness` | `right` | `right` | `right` | `right` | `right` · `left` |
| Show safe-zone guides | `showGuides` | off | off | off | off | on / off |
| UI scale | `uiScale` | 1 | 1 | 0.66 | 1 | 0.4 … 1.8 (step 0.01) |
| Text size | `fontScale` | 1 | 1 | 1 | 1 | 0.75 … 1.6 (step 0.01) |
| Button size | `touchSize` | 84 | 104 | 100 | 100 | 56 … 180 (step 2) px |
| Side margin | `marginX` | 0.035 | 0.035 | 0.035 | 0.02 | 0 … 0.15 (step 0.005) |
| Top / bottom margin | `marginY` | 0.02 | 0.02 | 0.02 | 0.025 | 0 … 0.15 (step 0.005) |
| HUD density | `hudDensity` | `standard` | `standard` | `standard` | `standard` | `minimal` · `standard` · `rich` |
| Play floor height | `floorY` | 0.69 | 0.6 | 0.48 | 0.7 | 0.3 … 0.85 (step 0.005) |
| Simulate 9:16 screen | `frame` | `fill` | `simulate916` | `simulate916` | `fill` | `simulate916` (on) · `fill` (off) |

- Positions are fractions of the screen (0 = top / left, 1 = bottom / right); the dialog shows them as percentages. *Button size* is in design units
  (on the phone preset one unit is the phone's short side ÷ 600, so 100 ≈ 56–68 CSS px; no touch target is ever under 44 px).
- *Simulate 9:16 screen* is shown for portrait32 and portrait86 only (it has no effect on the other presets). On, a
  browser window of another shape shows the game in the largest centred 9:16 box, laid out and projected exactly as on
  the real panel; a 9:16 window is used whole. A read-out under the switch gives the box, the window and the physical
  size in use. Details: [DISPLAYS.md](DISPLAYS.md#simulated-916-screen).
- On the phone preset the tab also shows the estimated physical screen size (from CSS pixels) used by Window Perspective.
- The tab shows a miniature of the solved layout, the viewport read-out
  ("Viewport … CSS px · pixel ratio … · design … · 1 unit = … px") and a note when auto-fit had to adjust something.
- **Reset this preset** restores the layout values of the active preset. Its screen geometry, camera mounting and calibration are not touched (reset those from the Camera tab).
- Background and guidance: [DISPLAYS.md](DISPLAYS.md).

## 4. Graphics

Sections: Quality · 3D resolution · Detail · Effects & light show · Image. All are *live*.

| Setting | Path | Default | Range / options | Applies |
| --- | --- | --- | --- | --- |
| Preset | `graphics.preset` | `medium` | `safe` · `medium` · `high` · `ultra` · `custom` | live |
| Auto optimise | `graphics.autoOptimize` | on | on / off | live |
| Frame-rate target | `graphics.targetFps` | `60` | `30` · `60` · `120` | live |
| Render scale | `graphics.renderScale` | 1 | 0.35 … 1.5 (step 0.05) | live |
| Pixel budget | `graphics.maxPixels` | 2.1 | 0.4 … 8.3 (step 0.1) MP | live |
| Pixel density cap | `graphics.maxDpr` | 2 | 0.75 … 4 (step 0.25) × | live |
| Anti-aliasing | `graphics.aa` | `fxaa` | `off` · `fxaa` · `smaa` · `msaa2` MSAA 2× · `msaa4` MSAA 4× | live |
| Model detail | `graphics.lod` | `medium` | `low` · `medium` · `high` | live |
| Textures | `graphics.textures` | `1k` | `512` · `1k` · `2k` · `4k` | live |
| Shadows | `graphics.shadows` | `medium` | `off` · `low` · `medium` · `high` | live |
| Ambient occlusion | `graphics.ao` | `off` | `off` · `low` · `high` | live |
| Glass | `graphics.glass` | `medium` | `low` Simple · `medium` Reflective · `high` Transmission | live |
| Reflections | `graphics.reflections` | `static` | `static` Studio · `refresh` Cabinet (per round) · `live` Cabinet (live) | live |
| Plush detail | `graphics.fur` | `shell` | `flat` · `sheen` · `shell` Fuzzy (held toy) · `shellHigh` Fuzzy (all toys) | live |
| Softness detail | `graphics.deform` | `basic` | `basic` · `fine` · `ultra` | live |
| Decor particles | `graphics.particles` | 60 | 0 … 300 (step 10) | live |
| Effects intensity | `graphics.fxIntensity` | 1 | 0 … 1.5 (step 0.05) | live |
| Light show | `graphics.lightShow` | on | on / off | live |
| Bloom | `graphics.bloom` | 0.25 | 0 … 1 (step 0.05) | live |
| Exposure | `graphics.exposure` | 1 | 0.6 … 1.6 (step 0.02) | live |
| Tone mapping | `graphics.toneMapping` | `neutral` | `aces` · `agx` · `neutral` | live |
| Depth of field | `graphics.dof` | off | on / off | live |
| Motion blur (frame blend) | `graphics.motionBlur` | off | on / off | live |
| Performance panel | `graphics.perfPanel` | off | on / off | live |

- The tab shows the resolution in use ("Rendering now: W × H (MP, ×CSS size)") and what the automatic optimiser has reduced,
  as translated labels ("3D resolution 70 %", only the current resolution step); the performance panel uses the same labels.
- *Pixel density cap*: the highest device pixel ratio the 3D view renders at (phones report 3 or more). The internal
  resolution is CSS size × min(device pixel ratio, cap) × render scale, then limited to the pixel budget.
- *Effects intensity* scales particle bursts and light effects (grab, lift, win celebrations by rarity, combo, restock,
  attract sparkles); `0` = none. *Light show*: moving light beams, floor pools and a light chase on epic and legendary
  wins, on a ×3 combo and while the machine waits for a player; celebrations keep their particles when it is off.
  Reduced motion lowers both further (no flashes, no strobing).
- Quality never changes physics, grip rules, toy count or layout. The HUD is always rendered at native resolution.
- *Glass*: Simple / Reflective / Transmission. *Reflections*: Studio (static environment) / Cabinet, refreshed per round / Cabinet, live.
- *Plush detail*: Flat / Sheen / Fuzzy shell fur on the held toy / on all toys. *Softness detail*: number of simultaneous dents and mesh density used for deformation.
- *Depth of field* and *Motion blur* are off by default so every toy stays sharp.
- Preset contents, the optimiser and the performance panel: [PERFORMANCE.md](PERFORMANCE.md).

## 5. Audio

Sections: Volume · Music · Output. All are *live*.

| Setting | Path | Default | Range / options | Applies |
| --- | --- | --- | --- | --- |
| Mute everything | `audio.muted` | off | on / off | live |
| Master | `audio.master` | 0.8 | 0 … 1 (step 0.01) | live |
| Music | `audio.music` | 0.55 | 0 … 1 (step 0.01) | live |
| Sound effects | `audio.sfx` | 0.8 | 0 … 1 (step 0.01) | live |
| Momo’s voice | `audio.voice` | 0.9 | 0 … 1 (step 0.01) | live |
| Lower music while Momo talks | `audio.ducking` | 0.6 | 0 … 1 (step 0.05) | live |
| Music track | `audio.track` | `theme` | `theme` Follow theme · `sakura` Sakura Kawaii · `storybook` Storybook Friends · `ocean` Ocean Dream · `cosmic` Cosmic Arcade · `gpu` GPU Party | live |
| Chime in demo mode | `audio.attractChime` | on | on / off | live |
| Output device | `audio.outputDevice` | *(empty)* | text ≤ 256 (never exported) | live |

- *Music track*: follow the theme, or pin one of the five theme tracks. Each theme plays its studio music (two takes
  cross-faded in turn) where the recordings load, and its synthesised track otherwise. **Preview / Stop** plays it in the dialog.
- *Chime in demo mode*: a soft chime every 20–30 s while the machine plays by itself.
- *Lower music while Momo talks* is the ducking depth.
- *Output device* lists devices only in browsers that support choosing one; otherwise the system default is used. The id is never exported.
- The tab shows the audio state (locked until the first tap, loading, running, suspended, failed) and whether the built-in synthesiser replaced missing files.
- Details: [AUDIO.md](AUDIO.md).

## 6. AI Guide

Sections: OpenAI API key · Momo · Connection · Voice · Personality. All are *live*.

| Setting | Path | Default | Range / options | Applies |
| --- | --- | --- | --- | --- |
| AI guide | `ai.enabled` | on | on / off | live |
| Speech bubble | `ai.subtitles` | on | on / off | live |
| Voice | `ai.voice` | on | on / off | live |
| How often Momo talks | `ai.frequency` | `normal` | `quiet` Rarely · `normal` · `chatty` | live |
| Line length | `ai.length` | `short` | `short` · `medium` | live |
| Guide speaks | `ai.voiceLanguage` | `en` | `en` Always English · `ui` Interface language | live |
| Lines come from | `ai.provider` | `openai` | `openai` OpenAI / GPT · `local` Built-in lines only | live |
| Text model | `ai.model` | *(empty)* | text ≤ 80 | live |
| Wait for GPT at most | `ai.timeoutMs` | 2500 | 800 … 8000 (step 100) ms | live |
| Creativity | `ai.temperature` | 0.9 | 0 … 1.5 (step 0.05) | live |
| Line cache | `ai.cache` | `session` | `off` · `session` This session · `persistent` Keep on this device | live |
| Voice without AI | `ai.localVoice` | `babble` | `babble` Momo babble · `system` System voice · `none` Bubble only | live |
| Voice model | `ai.speechModel` | *(empty)* | text ≤ 80 | live |
| Voice name | `ai.voiceName` | *(empty)* | text ≤ 40 | live |
| Speaking speed | `ai.voiceSpeed` | 1 | 0.7 … 1.3 (step 0.05) | live |
| Personality notes | `ai.personality` | *(empty)* | text ≤ 400 | live |
| System prompt | `ai.systemPrompt` | *(empty)* | text ≤ 4000 | live |

- **The API key is not a setting.** The server reads it from `.env` → `OPENAI_API_KEY`. The **OpenAI API key** block
  at the top of the tab shows where the key in use comes from (".env default" / "replaced in settings" / none) and its
  last four characters, and can replace it: **Save** sends the typed key to the server once (stored server-side in the
  git-ignored `.data/secrets.json`), **Test** checks it, **Restore default** goes back to `.env`. This acts on the server
  at once, independent of Apply / Cancel. By default only a browser on the server machine (or one with the admin token)
  may change it; elsewhere the block is read-only. It is hidden while the public-display lock is on. The key is never
  stored in the browser, put in a URL or exported. Details: [AI.md](AI.md#the-openai-key).
- *Guide speaks*: `en` keeps Momo (bubble, GPT lines, local lines, voice) in English whatever the interface language;
  `ui` follows the interface language. It replaces the older `ai.language`: stored or imported data with that key is
  migrated on load (an explicit Chinese / Japanese guide that matched the interface → `ui`, everything else → `en`).
- *Lines come from*: `openai` uses the server proxy when it is configured and falls back to built-in lines; `local` never calls the server.
- *Text model*, *Voice model*: empty = the server's configured model. Server operators can forbid client overrides. *Creativity* is only sent to models that accept a temperature.
- *Wait for GPT at most*: after this time the local line is used instead.
- *Voice without AI*: Momo babble (synthesised), the system speech voice, or bubble only.
- *System prompt*: empty = the built-in Momo prompt. Buttons: **Copy built-in prompt**, **Restore built-in prompt**, **Test connection**, **Preview voice**.
- Momo only receives game facts. Camera images and face data never leave the device.
- Details: [AI.md](AI.md).

## 7. Camera & Parallax

Sections: Head Tracking / Window Perspective · Status · Calibration · Distance scale (advanced) · Test viewpoint ·
Screen & installation · Camera mounting · Mapping · Smoothing & recovery · Tracking engine. All are *live*.

Tracking (shared by all presets):

| Setting | Path | Default | Range / options | Applies |
| --- | --- | --- | --- | --- |
| Head tracking | `camera.enabled` | on | on / off | live |
| Camera | `camera.deviceId` | *(empty)* | text ≤ 256 (never exported) | live |
| Follow smoothing | `camera.smoothMs` | 70 | 0 … 400 (step 5) ms | live |
| Jitter filter cutoff | `camera.filterMinCutoff` | 1.4 | 0.2 … 6 (step 0.1) Hz | live |
| Jitter filter speed gain | `camera.filterBeta` | 6 | 0 … 40 (step 0.5) | live |
| Dead zone | `camera.deadzoneMm` | 2 | 0 … 25 (step 0.5) mm | live |
| Outlier threshold | `camera.outlierM` | 0.35 | 0.05 … 1.5 (step 0.01) m | live |
| Hold after losing the face | `camera.lostHoldMs` | 700 | 100 … 4000 (step 50) ms | live |
| Return to neutral over | `camera.returnMs` | 1500 | 200 … 6000 (step 50) ms | live |
| Blend back in over | `camera.reacquireMs` | 450 | 50 … 2500 (step 50) ms | live |
| Calibrate when the camera starts | `camera.autoCalibrate` | on | on / off | live |
| Calibration countdown | `camera.calibrationSeconds` | 3 | 1 … 10 (step 1) s | live |
| Head turn effect | `camera.headWeight` | 0.4 | 0 … 1.5 (step 0.05) | live |
| Phone / low-power capture | `camera.lowPower` | `auto` | `auto` · `on` · `off` | live |
| Camera resolution | `camera.resolution` | `480p` | `360p` · `480p` · `720p` | live |
| Tracking rate | `camera.inferenceHz` | 18 | 5 … 30 (step 1) Hz | live |
| Faces to follow | `camera.numFaces` | 2 | 1 … 4 (step 1) | live |
| Processing | `camera.delegate` | `auto` | `auto` · `gpu` · `cpu` | live |
| *(written by the calibration)* head baseline | `camera.headBaseline.<preset>.yaw` / `.pitch` | 0 / 0 | -60 … 60 (step 0.1) ° each, for `desktop`, `portrait32`, `portrait86`, `mobile` | live |

- *Calibrate when the camera starts* / *Calibration countdown*: a 3-2-1 countdown (`calibrationSeconds`), then the
  player's current head position and direction become the neutral view of the active preset. It runs automatically
  each time the camera is switched on (only at READY / in attract mode, no dialog open), from **Calibrate now** in this
  tab, from the **Recalibrate view** chip next to the camera status in the top bar, and on 86" from the camera button in
  the control-panel menu (the top bar is above the reachable band there). Procedure: [CALIBRATION.md](CALIBRATION.md).
- *Head turn effect*: turning the head (relative to the calibrated direction) also shifts the view that way;
  `0` = off. Only used once the preset is calibrated.
- *Phone / low-power capture*: `auto` uses 360p, at most 12 tracking updates per second and one face on phones and
  low-power devices; `on` / `off` force it. The tab shows the capture values in use.
- `camera.headBaseline.<preset>` holds the head direction captured by the countdown calibration (yaw + = to the
  player's right, pitch + = up); the eye position of the same calibration is `profiles.<preset>.view.calNeutral`.

Viewing geometry (per display preset, under `profiles.<preset>.view`):

| Setting | Path (`profiles.<preset>.view.…`) | desktop | portrait32 | portrait86 | mobile | Range / options |
| --- | --- | --- | --- | --- | --- | --- |
| Reference distance | `refDistance` | 0.62 | 0.62 | 0.95 | 0.35 | 0.2 … 5 (step 0.01) m |
| Game window | `windowMode` | `window` | `fullscreen` | `fullscreen` | `window` | `fullscreen` Fills the screen · `window` Browser window (approximate) |
| Screen width | `screenW` | 0.531 | 0.398 | 1.071 | 0.141 | 0.04 … 4 (step 0.001) m |
| Screen height | `screenH` | 0.299 | 0.708 | 1.904 | 0.065 | 0.04 … 4 (step 0.001) m |
| Bottom edge above floor | `bottomElevation` | 0.95 | 1 | 0.12 | 1.1 | 0 … 2.5 (step 0.01) m |
| Reference eye position (x, y, z) | `eye` | [0, 0.14, 0.62] | [0, 0.2, 0.62] | [0, 0.5, 0.95] | [0, 0, 0.35] | each -3 … 5 m |
| Camera position (x, y, z) | `camPos` | [0, 0.16, 0] | [0, 0.37, 0] | [0, 0.98, 0] | [-0.065, 0, 0] | each -3 … 3 m |
| Camera tilt down | `camPitch` | 4 | 8 | 18 | 0 | -60 … 60 (step 0.5) ° |
| Camera pan | `camYaw` | 0 | 0 | 0 | 0 | -60 … 60 (step 0.5) ° |
| Camera roll | `camRoll` | 0 | 0 | 0 | 0 | -45 … 45 (step 0.5) ° |
| Sensor rotation | `camRotation` | `0` | `0` | `0` | `0` | `0` 0° · `90` 90° · `180` 180° · `270` 270° |
| Camera field of view | `hfov` | 63 | 63 | 63 | 63 | 30 … 130 (step 0.5) ° |
| Camera image is already mirrored | `mirror` | off | off | off | off | on / off |
| Viewpoint mode | `mode` | `relative` | `relative` | `relative` | `relative` | `relative` Relative to calibration · `absolute` Absolute position |
| Sideways sensitivity | `gainX` | 1 | 1 | 1 | 1 | 0 … 3 (step 0.05) |
| Up / down sensitivity | `gainY` | 1 | 1 | 1 | 1 | 0 … 3 (step 0.05) |
| Distance sensitivity | `gainZ` | 1 | 1 | 1 | 1 | 0 … 3 (step 0.05) |
| Largest offset (x, y, z) | `maxOffset` | [0.3, 0.22, 0.3] | [0.4, 0.3, 0.35] | [0.7, 0.5, 0.55] | [0.12, 0.09, 0.15] | each 0.02 … 2 m |
| Closest viewing distance | `minDistance` | 0.3 | 0.3 | 0.45 | 0.18 | 0.15 … 2 (step 0.01) m |
| Calibrated | `calibrated` | off | off | off | off | on / off |
| Depth constant | `calDepthK` | 0 | 0 | 0 | 0 | 0 … 500 (step 0.01) |
| Neutral measurement (x, y, z) | `calNeutral` | [0, 0.14, 0.62] | [0, 0.2, 0.62] | [0, 0.5, 0.95] | [0, 0, 0.35] | each -5 … 5 m |

- Positions are metres relative to the centre of the screen: x right, y up, z towards the viewer.
  `calNeutral` is measured relative to the centre of the game window, which is the same point when the game fills the screen.
- *Camera* (`camera.deviceId`) is chosen from the detected cameras; empty = the browser's default. The id is never exported.
- **Start camera now / Stop camera**, a mirrored **preview that is shown only in this tab**, and the status line.
- *Distance scale (advanced)*: **Calibrate current position** averages about a second of stable samples and stores `calibrated`, `calDepthK` and `calNeutral`; **Re-centre** makes the current head position the neutral one without changing the depth constant.
  These three are normally written by the calibration, not typed. **Clear calibration** also clears the head baseline.
- *Phone preset*: while its screen size is left at the default, Window Perspective estimates the real size from the
  phone's CSS pixels (about 0.16 mm each).
- **Test viewpoint** sliders move the eye by hand to check the projection. They are not camera tracking; **Back to live view** ends the test.
- **Set eye height from installation**: four buttons (1.15 / 1.40 / 1.60 / 1.75 m) set the vertical reference eye to
  that eye height minus the height of the screen centre (*Bottom edge above floor* + half the *Screen height*).
- The tab shows the effective window ("W × H m · scale").
- Video only — the microphone is never requested. Frames and landmarks stay on the device; nothing is recorded, stored or sent to the AI guide.
- Procedure and troubleshooting: [CALIBRATION.md](CALIBRATION.md).

## 8. System

Sections: General · Configuration · Reset · Public display lock · Diagnostics.

| Setting | Path | Default | Range / options | Applies |
| --- | --- | --- | --- | --- |
| Language | `system.language` | `en` | `en` English · `zh` 简体中文 · `ja` 日本語 | live |
| Reset after no input | `system.idleSeconds` | 60 | 0 … 600 (step 5) s | live |
| Demo when idle | `system.attractDemo` | on | on / off | live |
| Reduced motion | `system.reducedMotion` | `system` | `system` Follow system · `on` · `off` | live |
| Lock full settings | `system.lockSettings` | off | on / off | live |
| PIN (stays on this device) | `system.lockPin` | *(empty)* | text ≤ 8 (never exported) | live |
| Detailed log | `system.verboseLog` | off | on / off | live |

- *Reduced motion*: follow the OS preference, or force on / off. Gameplay is unchanged.
- *Reset after no input*: after this many seconds without any input (pointer, touch, key, wheel — measured on the wall
  clock, also while a dialog is open; a player round that is still running counts as activity, and so does a running
  calibration countdown) the machine resets fully: open dialogs close (a settings draft is cancelled), the guide stops,
  the session score and combo are cleared, the field is restocked and the machine returns to attract mode with its
  call to action. `0` = never. The idle clock uses the applied value: a time changed (or imported) in the open dialog
  counts from **Apply**, so it can never close the dialog it is being edited in. It replaces the older `system.attractIdleSec` (default 45, 10 … 600 s): a customised old
  value is carried over on load and on import when `idleSeconds` was never chosen.
- *Demo when idle*: in attract mode the machine plays clearly labelled demo rounds by itself (DEMO badge, DEMO score;
  nothing is counted or stored). A tap on the call to action, START, `Space` or `Enter` stops the demo at once and starts
  a player round with a full machine.
- **Reset scores** (two-step confirm) clears the best session score and the lifetime points; the line above it shows both.
- **Toggle full screen** (also the `F` key).
- **Export configuration / Import configuration…** — see below.
- **Reset all settings** (keeps the display preset, the language and the collection) and **Clear collection** (keeps settings); both ask for a second tap.
- Diagnostics: version line ("physics 120 Hz fixed step · renderer WebGL 2"), asset warnings, and the recent redacted log with **Copy diagnostics** / **Clear log**.
  *Detailed log* additionally records every phase change and every round result (outcome, contact level, grip quality, slip reason) there.

## Presets

Presets write a fixed set of values; editing any of those values afterwards switches the preset to `custom`.

**Difficulty** (`DIFFICULTY_PRESETS` in `src/app/presets.ts` — that file is authoritative; these are its values when this document was generated):

| | Move speed | Acceleration | Descend | Lift | Claw force | Closing speed | Grip assist | Cable swing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Easy | 0.4 | 2.6 | 0.5 | 0.38 | 1.3 | 1 | 1.4 | 0.3 |
| Arcade (default) | 0.42 | 2.4 | 0.55 | 0.42 | 1 | 1 | 1 | 0.55 |
| Skill | 0.46 | 2.2 | 0.6 | 0.44 | 1 | 1 | 0.6 | 0.85 |

All three change only physical quantities. What they do to grip behaviour, and
how they were tuned, is in [PHYSICS.md](PHYSICS.md).

**Graphics** (`GRAPHICS_PRESETS`):

| | Safe | Medium (default) | High | Ultra |
| --- | --- | --- | --- | --- |
| Render scale | 1.0 | 1.0 | 1.0 | 1.0 |
| Pixel budget (MP) | 0.7 | 2.1 | 4.0 | 8.3 |
| Pixel density cap | 1.25 | 2 | 3 | 3 |
| Frame-rate target | 30 | 60 | 60 | 60 |
| Model detail | low | medium | high | high |
| Textures | 512 | 1K | 2K | 4K |
| Shadows | low | medium | high | high |
| Ambient occlusion | off | off | low | high |
| Glass | Simple | Reflective | Reflective | Transmission |
| Reflections | Studio | Studio | Cabinet (per round) | Cabinet (live) |
| Plush detail | Sheen | Fuzzy (held toy) | Fuzzy (held toy) | Fuzzy (all toys) |
| Softness detail | basic | basic | fine | ultra |
| Anti-aliasing | FXAA | FXAA | SMAA | MSAA 4× |
| Bloom | 0 | 0.25 | 0.30 | 0.30 |
| Decor particles | 20 | 60 | 150 | 300 |
| Effects intensity | 0.5 | 1 | 1.2 | 1.5 |
| Light show | off | on | on | on |

`?quality=safe|medium|high|ultra` applies one at launch. A fresh installation
starts with exactly the Medium values, except on a phone: the first run with the phone preset on a touch screen
applies Safe (unless `?quality=` is given). Stored data from before *Pixel density cap*, *Effects intensity* and
*Light show* existed takes those values from its stored preset (`GRAPHICS_PRESET_ADDITIONS` in `src/settings/spec.ts`).

**Display presets** are described in [DISPLAYS.md](DISPLAYS.md).

## Import and export

*System → Export configuration* downloads `plush-portal-config.json`:

```json
{
  "app": "plush-portal",
  "version": 1,
  "exportedAt": "2026-11-24T06:00:00.000Z",
  "settings": {
    "system": { "language": "en", "attractDemo": true },
    "display": { "profile": "portrait86" },
    "profiles": {
      "desktop": { "layout": {}, "view": {} },
      "portrait32": { "layout": {}, "view": {} },
      "portrait86": { "layout": {}, "view": {} },
      "mobile": { "layout": {}, "view": {} }
    },
    "gameplay": {}, "themes": {}, "graphics": {}, "audio": {}, "ai": {}, "camera": {}
  }
}
```

(Abbreviated: each object holds all of its settings.)

What is in it: every setting in this document except the three marked "never
exported", for all four display presets. That includes the calibration numbers
(a depth constant, a neutral eye position and a head baseline per preset), your guide prompt and
personality text, and references to imported models.

What is **never** in it:

| Excluded | Why |
| --- | --- |
| OpenAI API key, admin token | They exist only on the server; a key typed in the AI tab is sent to the server once and never kept in the browser. |
| Settings PIN (`system.lockPin`) | Marked `noExport` in the specification. |
| Camera and audio-output device ids (`camera.deviceId`, `audio.outputDevice`) | Also `noExport`: they identify hardware of one browser on one machine. |
| Camera images, video, face landmarks | They are never stored anywhere, so there is nothing to export. |
| Prize collection, best / lifetime points | Stored separately. |
| Imported model files | Only the reference is exported; the file stays in this browser's IndexedDB. |
| Logs | Kept in memory only. |

*Import configuration…* accepts a file only if it is JSON with
`"app": "plush-portal"` and a version this build understands (newer versions are refused). Then:

- unknown keys are dropped, every value is clamped to its range, missing values get defaults;
- the PIN and the lock state of **this** device are kept, whatever the file says;
- this device's display preset stays selected if one has been chosen (the file's preset is used only on a device that has none yet); the per-preset values themselves are imported for all four presets;
- retired keys are migrated as on load (`system.attractIdleSec` → `system.idleSeconds`, `ai.language` → `ai.voiceLanguage`);
- model references whose file is not on this device fall back to the built-in model (with a warning);
- the result goes into the draft: it is previewed, and only **Apply** saves it.

Rejections are reported as `invalid_json`, `not_a_config` or `unsupported_version`.

## Public display lock

*System → Lock full settings* together with a PIN (up to 8 characters) turns the
settings dialog into a small **Player options** panel:

| Still available to players |
| --- |
| Language |
| Mute everything, master volume |
| Head tracking on / off |
| AI guide on / off |

Entering the PIN unlocks the full dialog until the page is reloaded. The lock
only takes effect once a PIN is set. Playing never needs a PIN or a login.

The PIN is a convenience against casual changes on a kiosk, **not a security
feature**: it is stored unencrypted in this browser's `localStorage` and checked
in the page. Anyone with access to the browser's developer tools or storage can
read or remove it. Protect a public installation with the operating system's kiosk mode.

## Where settings are stored

| Data | Location | Key |
| --- | --- | --- |
| Settings | `localStorage` | `plush-portal/settings` — an object with `version` (1) and `settings` |
| Collection | `localStorage` | `plush-portal/collection/v1` |
| Best session score and lifetime points | `localStorage` | `plush-portal/scores` — `version`, `best`, `lifetime` (demo points are never stored) |
| Phone first-run setup done | `localStorage` | `plush-portal/phone-setup` |
| "How-to-play shown" flag | `localStorage` | `plush-portal/tutorial-seen` |
| Guide line cache (only with *Line cache: Keep on this device*) | `localStorage` | `plush-portal.ai.lines.v1` |
| Imported models | IndexedDB | database `plush-portal-models` |
| Replacement OpenAI key (server side, not the browser) | file on the API server | `<PLUSH_DATA_DIR>/secrets.json` (default `.data/`, mode 0600) |

On load the stored settings are sanitised field by field; data written by a
newer version, or unreadable data, is replaced by defaults. Cross-field rules
are enforced as well: the safe zone is at least 30 % of the screen tall, the
panel anchor stays inside it, and the reference eye is never closer than the
minimum viewing distance.
