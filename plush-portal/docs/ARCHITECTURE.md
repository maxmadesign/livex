# Architecture

PLUSH PORTAL is a single-page app (Vite + React + TypeScript) with an
imperative 3D engine (Three.js), an authoritative physics simulation
(Rapier, WASM) and a small Node API server (Hono) that proxies the AI guide.

The one rule the structure exists to enforce:

> **The simulation decides, everything else observes.** `GameCore` owns the
> physics world, the claw, the grip logic and the round state machine. It has
> no dependency on rendering, audio, the DOM, React or settings objects, so the
> same code runs in the browser and in headless Node tests, and no graphics
> option can change the outcome of a round.

## Modules

```
                         ┌──────────────── src/ui (React) ────────────────┐
                         │ App · Hud · ScoreHud · AttractOverlay ·        │
                         │ CalibrationOverlay · Dialogs · SettingsDialog  │
                         └───────▲───────────────────────────┬────────────┘
                    reads state  │                           │ calls methods
                 (zustand stores)│                           ▼
 src/settings/store ─────────────┤                 src/app/Game.ts  (composition root)
 src/app/gameStore  ─────────────┘                           │
                                                             │ owns
      ┌──────────────────────┬───────────────────────┬───────┴────────┬──────────────────┐
      ▼                      ▼                       ▼                ▼                  ▼
 src/game + src/physics   src/scene + src/plush   src/perspective   ports (src/core/contracts.ts)
 GameCore (authoritative) Stage, Cabinet,         OffAxisCamera,    AudioPort   → src/audio
 PhysicsWorld, ClawRig,   ClawVisual, ToyVisuals, windowGeometry    GuidePort   → src/ai  ──► /api ──► server/
 GripMonitor,             Effects (FxApi),        + src/layout      TrackerPort → src/tracking
 RoundMachine,            PlushMaterial,          (solve, frame)
 RoundController, ToyField PlushDeformer
 scoring, rarity, attract
```

| Module | Files | Responsibility | May depend on |
| --- | --- | --- | --- |
| Core | `src/core/{types,contracts,events,math}.ts` | Shared types, typed event emitter, the three port interfaces | nothing |
| Simulation | `src/game/{GameCore,RoundMachine,RoundController,ToyField}.ts`, `src/physics/{PhysicsWorld,ClawRig,GripMonitor,fieldSpec}.ts` | Fixed-step world, claw rig, grip evaluation, round rules, toy placement | core, Rapier, manifest *types* |
| Machines (headless) | `src/game/machines/{ids,types,registry,classic,bridge,shelf,rush,pieces,session,daily}.ts` | A machine is data (`MachineDef`) plus a genre (`GenreModule`: geometry, try rules, field, points, session rule, session prize, attract aim); the registry; `PlaySession` (open / tries / timed sessions above the rounds); today's pick and the unlock rule. See [Machines](#machines) | core, simulation (no DOM) |
| Machine glue | `src/app/{MachineDirector,MachinePilot,machineSfx}.ts`, `src/persistence/machines.ts`, `src/ui/machines/*`, `src/scene/machines/*`, `src/scene/ItemVisuals.ts` | Switching behind the curtain, items settlement, the session card, session prize and its code, local rankings, today's pick, attract mode with several machines; the lobby, session HUD, try toast, session card and initials entry; the cabinet dressing and the items' rendering | all of the above |
| Points, rarity, attract | `src/game/{scoring,rarity,attract}.ts`, `src/persistence/scores.ts` | Rarity tier per character; pure `scoreRound` and the idempotent `ScoreKeeper` (player and demo tracks); `IdleTimer` (wall clock) and `AttractDirector` (demo rounds in attract mode); best / lifetime storage | core (headless, no DOM) |
| Assets | `src/plush/{manifest,PlushLibrary,PlushMaterial,PlushDeformer,customModels,fallbackGeometry,thumbnails}.ts` | Manifest contract (v4: optional textured model + provenance), GLB loading incl. texture tiers, plush shading (procedural and `PLUSH_TEXTURED` variants), visual soft-body deformation, user GLB import | core, Three.js |
| Scene | `src/scene/{Stage,Cabinet,ClawVisual,ToyVisuals,materials,textures}.ts`, `src/themes/themes.ts` | Renderer, post-processing, cabinet geometry, visuals that follow physics poses | assets, perspective |
| Lighting & materials | `src/scene/{environment,contactShadows,texgen,decor}.ts` | Per-theme procedural studio environment (PMREM) sized by tier, contact shadows (Medium and up), runtime detail maps (brushed metal, flake, weave, braid, normal maps), bevel / UV helpers and the GPU Party wall kit | Three.js, themes |
| Effects | `src/scene/Effects.ts`, `src/scene/fx/*` (`api.ts` = `FxApi`) | GPU particles in two instanced batches (≤ 2 draw calls, fixed pools), `celebrate(tier)`, bursts, rarity aura, light show (`idle` / `attract` / `win` / `jackpot`), LED energy | Three.js, themes |
| Perspective | `src/perspective/{offAxis,OffAxisCamera,windowGeometry}.ts` | Off-axis frustum, screen ↔ cabinet mapping (incl. the simulated 9:16 screen and phone size estimate) | core |
| Tracking | `src/tracking/*` | Camera, MediaPipe inference (worker or main thread), eye estimate, filters; countdown calibration (`countdown.ts`), auto-calibration policy (`autoCalibration.ts`), head direction (`headPose.ts`), baselines (`baseline.ts`), phone / low-power capture (`devicePolicy.ts`) | core |
| Audio | `src/audio/AudioEngine.ts`, `src/audio/studio/{manifest,playlist,moments}.ts`, `src/audio/synth/*` | Web Audio engine; studio music play-lists (two takes per theme, beat-aligned cross-fades), tier-aware win, character voices, dramatic effect layer, attract chime; the synthesised set as the complete fallback | core |
| AI guide | `src/ai/*` | Event → line (`GuideDirector`), server client and key client (`keyClient.ts`), local lines, speech, cache, settings migration (`settingsMigration.ts`) | core |
| Layout | `src/layout/{solve,frame,phone,safeArea,labelFit}.ts` | Pure HUD geometry solver (incl. the phone layout), the simulated 9:16 box, phone behaviour (guards, immersive mode, first-run setup), safe-area insets | settings types |
| Settings | `src/settings/{spec,store}.ts`, `src/persistence/*` | One specification for every setting, draft/apply store, migrations, storage | core |
| UI | `src/ui/*`, `src/i18n/*` | HUD, score HUD and popups, attract call to action, calibration overlay, dialogs, settings dialog, strings | stores, `Game` methods |
| Brand kit | `src/brand/{kits,index,files,fonts}.ts`, `src/scene/{ledWall,brandScene}.ts`, `src/ui/{BootScreen,BrandLogo}.tsx`, `src/ui/theme-gpu.css` | Event identity over the gpu theme (GTC; neutral for public copies): NVIDIA palette, logo and font slots resolved through `assets/brand/files.json`, the LED wall, branded screens ([BRAND.md](BRAND.md)) | core, Three.js |
| Prize claims | `src/rewards/{protocol,client,flow,policy,qr,cardLayout}.ts`, `src/ui/{RewardCard.tsx,reward.css}`, `src/ui/settings/tabRewards.tsx` | One claim code per real win from the kiosk's server, the QR win card, the idle-reset hold while it is up, the Rewards tab ([REWARDS.md](REWARDS.md)) | core, settings, stores |
| App | `src/app/{Game,bootstrap,gameStore,launch,presets,AdaptiveQuality,DemoPilot,nullPorts}.ts` | Wires everything, runs the frame loop | all of the above |
| Server | `server/{index,app,config,schemas,text,rateLimit,static,log,errors,capabilities,keys,net,tls,brandFiles}.ts`, `server/speech/`, `server/rewards/` | `/api/*`: OpenAI proxy, validation, rate limit, static hosting; replaceable key store (`keys.ts`), outbound proxy and CA handling (`net.ts`), self-signed HTTPS for phones (`tls.ts`), the brand-file listing (`brandFiles.ts`); prize codes, claim and staff pages and the LAN claim listener (`rewards/`) | Node only |
| Tools | `tools/plush/*` (incl. `import-generated.ts`, `generated.ts`, `manifestFile.ts`), `tools/audio/{bake,importStudio}.ts` + `tools/audio/lib/`, `tools/fetch-tracking-assets.mjs`, `tools/dev/*` | Asset generation, the generated-model and studio-audio import pipelines, development probes (never bundled) | Node only |

`src/app/bootstrap.ts` creates the two stores, applies the launch parameters
(and, on a phone's first run, the Safe graphics preset), constructs the audio
engine, the guide and the tracker (each wrapped so that a failure yields a
*null port* instead of an exception) and finally the `Game`.

### Pipelines added in this version

| Pipeline | Path | What it does |
| --- | --- | --- |
| Generated plush models | Higgsfield concept image → image-to-3D GLB (outside the repo) → `npm run assets:import` (`tools/plush/import-generated.ts`) → `public/assets/plush/<theme>/<slug>.gen.glb` + WebP textures (512 embedded, 1K, 2K) + `model.textured` and `source` in the manifest | Fits the raw model to the procedural design of the same id (uniform scale, base on the floor), transfers softness / fur / AO from the design, builds three LODs with meshoptimizer, records provenance (job ids, raw-file hash, licence note) and a proxy-fit verdict. Physics keeps the design's proxies; the procedural GLB is the fallback. [ASSETS.md](ASSETS.md#textured-ai-generated-models) |
| Studio audio | Higgsfield audio results → `npx tsx tools/audio/importStudio.ts --src <dir>` → `public/audio/studio/` + the manifest's `studio` section | Loudness normalisation, tempo / beat analysis and in / out points for the music takes, trimming, gating and seamless loops for effects and voices, per-file provenance and licence note. [AUDIO.md](AUDIO.md#studio-recordings) |
| Synthesised audio | `npm run assets:audio` (`tools/audio/bake.ts`) | The complete original fallback set (music per theme, every effect, motor loops); keeps the `studio` section. |

## One frame

`Game.frame(now)` is the only `requestAnimationFrame` callback.

```
frame(now)
 ├─ frame limiter (30 fps target only)
 ├─ dt = clamp(now − last, 0 … 0.25 s)
 ├─ update(now, dt)                                   ← wrapped in try / recover
 │   ├─ unless paused:
 │   │   steps = FixedStepper.advance(dt)             ← 1/120 s steps, at most 5 per frame,
 │   │   repeat steps times:                             the rest of the backlog is dropped
 │   │     DemoPilot.update()      (attract demo only)
 │   │     GameCore.fixedStep():
 │   │        RoundController.preStep   inputs → trolley / winch / finger targets
 │   │        ClawRig.preStep           motors, cable spring
 │   │        GripMonitor.preStep       assist spring (if a grip exists)
 │   │        PhysicsWorld.step         Rapier, 8 solver iterations
 │   │        ClawRig.postStep          read back hub, cable slack, finger angles
 │   │        RoundController.postStep  milestones, slip check, prize sensor
 │   │     collect impacts, restock queue
 │   │   updateFlow(dt)    attract demo rounds, auto "play again" after a miss, guide hints
 │   │   updateAudio(dt)   motor loops, attract chime on / off (one-shots come from simulation events)
 │   ├─ idle reset check          IdleTimer (wall clock) → Game.idleReset() → attract mode
 │   ├─ ToyVisuals.update(alpha)   interpolate prev/current poses, feed contacts and
 │   │                             impacts to PlushDeformer (dents, sag, squash, sway)
 │   ├─ ClawVisual.update(alpha), aim ring / beam
 │   ├─ updateShow()               rarity aura, lift burst, light-show mode, call-to-action sparkles
 │   ├─ cabinet LEDs (win energy + light show), Effects.update
 │   ├─ updateEye()                tracker.sampleEye(now) → eyeToWorld → Stage.setEyeWorld
 │   └─ Stage.render(dt)           OffAxisCamera projection → composer (AO, bloom, AA, …)
 └─ recordPerf()                   frame-time window → UI store, AdaptiveQuality.sample()
```

After `updateAudio`, three presentation steps follow every frame (also while paused, unless noted):

- **Idle reset.** `IdleTimer.due(system.idleSeconds, active)` on the wall clock, with the applied (not the
  previewed) `idleSeconds`. A running player round and a running
  calibration countdown count as activity; input events (`pointerdown`, `pointermove`, `keydown`, `wheel`,
  `touchstart`) and every `Game` input method touch the timer. When due, `Game.idleReset()` closes dialogs (a settings
  draft is cancelled), silences the guide, clears the test viewpoint, cancels a calibration, clears the session score,
  restocks and enters attract mode (`AttractDirector.enter`).
- **Attract mode.** `updateFlow` lets `AttractDirector` start demo rounds (the `DemoPilot` steers them) and hold their
  results; `pressStart()` (START, the call to action, `Space` / `Enter`) leaves at once: demo round reset, claw home,
  field refilled, a player round in READY.
- **Effects follow the game** (`updateShow`): the rarity aura around a held toy, the lift burst, the light-show base
  mode (`attract` in attract mode, else `idle`; a demo's running win / jackpot show is cancelled with `off` when a player
  takes over or the idle reset runs) and the call-to-action sparkles. Every `FxApi` call goes through `safeFx`, so a
  failing effect is logged and skipped instead of tripping the frame loop's error recovery.

### Moments: what the game sends to effects and audio

| Simulation event | Effects (`FxApi`) | Audio (`AudioPort`) |
| --- | --- | --- |
| `grabStarted` | `burst('grab')` at the claw | (the GRAB button already played `grab_confirm`) |
| `clawTouch` | `burst('contact')` when it is a toy | `playSfx('claw_touch')` (quieter when it is not a toy) |
| `liftStarted` | — | `playSfx('claw_lift')`; if a toy is held, `playCharacter(id, 'lift')` (that character's own voice, 0.25 s later, panned to the toy) |
| lifted milestone, while held | `burst('lift')`, then `aura(pos, tier)` every frame | — |
| `slipped` | `burst('slip')` | `playSfx('slip')`, `playCharacter(id, 'slip')` |
| `prizeDetected` (the win, scored here) | `celebrate(tier)` (epic starts the `win` light show, legendary the `jackpot` show); `lightShow('jackpot')` for a ×3 combo below legendary; `burst('score')`, `burst('combo')` from the 2nd win in a row | `playSfx('chute_drop')`, `playWin(theme, tier)` (stinger · sparkle · confetti + firework · jackpot fanfare + bells), `playCharacter(id, 'win')`, `playSfx('combo')` from the 2nd win in a row; quieter in demo rounds |
| a "+N" score popup | — | `playSfx('score_count')` |
| `result` won | `burst('drop')` where the prize lands | `playWin` only if the exit event did not already play it; `collect_unlock` for a new character |
| `result` empty | — | `playSfx('empty_grab')` |
| restock starts / each toy | `burst('restock')` per toy | `playSfx('restock_rain')` once, `restock_drop` per toy |
| attract mode | `lightShow('attract')`, `burst('cta')` every 2.4 s | `setAttract(true)` → a chime every 20–30 s (`audio.attractChime`) |
| calibration countdown / done | — | `countdown_tick` each second, `calibration_ok` when the baseline is taken |

Rarity tiers come from `src/game/rarity.ts`; the same tier drives the points, the aura, the celebration, the cabinet
LED energy and the win sound.

Points worth knowing:

- **Fixed step.** `FIXED_DT = 1/120` s. Rendering interpolates between the last
  two physics poses with `alpha`, so motion is smooth at any refresh rate and
  the simulation is identical at 30, 60 or 144 Hz.
- **No spiral of death.** At most five steps run per frame; if the machine
  cannot keep up, simulated time slows down instead of the frame time growing.
- **Pausing** is a set of reasons (`modal`, `hidden`, `context`, `boot`,
  `theme`). While any is present no steps run and the stepper is reset, so
  nothing "catches up" afterwards. The view still renders (settings are previewed live).
- **The eye is sampled per rendered frame**, not per inference result: the
  tracker extrapolates/filters to `now`, so a 15–30 Hz tracker still gives a smooth view.
- **The camera never rotates.** Head movement only changes the frustum (see
  [DISPLAYS.md](DISPLAYS.md#window--cabinet-mapping)); the HUD is DOM and does not move.

## Round state machine

`RoundMachine` (`src/game/RoundMachine.ts`) holds the phase and validates every
transition; `RoundController` requests transitions when a **physical
milestone** is observed. There are no timers that decide an outcome — the
timers below are only minimum waits or watchdogs.

```
 ATTRACT ──start()──► READY ──first move──► AIMING
    ▲                  ▲  │                    │
    │ idle             │  └──────grab()────────┤ grab() / aim time limit
    │           next() │                       ▼
    │                  │                   DESCENDING ──landed──► CLOSING ──closed──► LIFTING
    │                  │                                                                 │ lifted
    │                  │                                                                 ▼
    └──toAttract()── RESULT ◄──finish()── SETTLING ◄──released── RELEASING ◄──arrived── TRANSPORTING
```

Not drawn: any player phase returns to ATTRACT on the idle reset (`system.idleSeconds`; an unfinished round is
abandoned without an award), demo rounds run from ATTRACT and back (`AttractDirector`), and
`abort()` (error recovery, *Restart this round*) returns any phase to READY or ATTRACT.
One grab is accepted per round.

| Transition | Milestone (all measured in the simulation) | Watchdog |
| --- | --- | --- |
| DESCENDING → CLOSING | The palm rests on a toy and the cable has gone slack, **or** the claw has stopped moving with a slack cable (floor, chute guard, wedged), **or** the cable is fully paid out. A fingertip brushing a neighbour does not count. | 7 s |
| CLOSING → LIFTING | The finger joints have stopped moving (≥ 0.42 s), at the latest after 1.5 s. `GripMonitor.establish()` then records the grip facts: fingers in contact, centring, support under the toy, share of *core* vs *appendage* contact, finger opening. | 4 s |
| LIFTING → TRANSPORTING | The winch has reached the travel height. | 7 s |
| TRANSPORTING → RELEASING | The trolley has arrived **and**, if a toy is carried, the swing has calmed (or 6 s passed). The destination is the chute only while a toy is held; if it is lost on the way the claw goes home instead. | 10 s |
| RELEASING → SETTLING | Fingers fully open (minimum 0.5 s when a toy was held, 0.18 s otherwise). | 4 s |
| SETTLING → RESULT | *Won:* the prize has been awarded and has landed in the bin (or 1.6 s after the award). *Not won:* the target has stopped falling (minimum 0.9 s / 0.3 s), at the latest after 3.2 s. | 7 s |
| RESULT → READY | Player presses PLAY AGAIN; after a miss it advances by itself after about a second. | — |

Outcome rules:

- **Prize**: only in `LIFTING … SETTLING`, only for the toy that was gripped
  this round, and only when its centre of mass is inside the chute sensor volume
  (below the play floor, over the chute opening). `RoundMachine.awardPrize(roundId, toyId, typeId)`
  is idempotent: the prize id is `<sessionId>-<roundId>`, a second call for the same round returns nothing,
  and the collection de-duplicates by prize id.
- **Strays**: a toy that is knocked into the chute without being this round's gripped target is
  never a prize; it is flagged (`strayInBin`) and removed from the bin at the next round boundary.
- **Slip**: while lifting and transporting the grip is re-evaluated every step.
  A toy that is no longer supported is released with a reason
  (`eccentric`, `weak_support`, `contact_lost`, `transport_swing`, `overload`, `bounced_out`).
- **Result**: `won`, `slipped` (was held, then lost) or `empty`, plus the contact level reached
  (`none` / `touched` / `gripped` / `lifted`), which drives the guide's and the HUD's feedback.
- **Points** are presentation: `Game` settles each round once through `ScoreKeeper.settle` (idempotent per round id) —
  a win when the prize passes the exit sensor (so the popup appears where the prize leaves the field), a slip or an
  empty grab from the round result. Demo rounds score on their own track and are never stored. Nothing in the
  simulation reads the score.
- **Watchdog**: if a phase overruns, the machine emits `watchdog` and the controller forces the
  next milestone so the claw always returns home; the round then ends with whatever really happened.

Grip physics, the assist spring and the tuning constants are described in [PHYSICS.md](PHYSICS.md).

## Machines

The cabinet can be one of four machines: **Plush Classic** (`classic`, the claw machine above), **Tippy
Bridge** (`bridge`), **Tumble Shelf** (`shelf`) and **Sparkle Rush** (`rush`). Design and every deviation:
[design/machines.md](design/machines.md); rules and measurements per machine: [machines/](machines/).

- **One simulation identity, a rebuildable stack.** `GameCore` keeps one `RoundMachine`, one controller
  event emitter and one `PlaySession` for the page's lifetime: round ids keep counting across machines
  (claim codes and prize ids stay unique) and listeners bound once keep working. The physics stack —
  world, claw, grip monitor, round controller, field — belongs to the machine. `GameCore.setMachine`
  (round boundary only) ends a running session without a result, disposes the old stack, builds a fresh
  one from the machine's `FieldGeometry` (floor or floor with a hole, chute guard, opening, fixtures such
  as bars, fences, the shelf and its gutter, the claw's home), fills and settles it off-screen and
  restarts the round. Classic after any number of switches is a fresh classic world.
- **Classic is untouched.** On classic the controller's try rules are `null` and today's code runs
  verbatim. `tools/dev/golden-classic.ts --check` replays a recorded classic script (player rounds,
  restocks, demo rounds, a takeover) and compares every phase, event and pose hash with the committed
  trace; `tests/unit/machines` runs it plus a classic → other machine → classic round trip.
- **A try on another machine** goes through `TryRules` (`beginTry`, `liftTarget`, `transportTarget`,
  `beginSettling`, `postStep`, `canFinish`, `resultExtras`, and `filterInput` for the bridge's two-button
  controls). Outcomes keep the one physical test of every machine: the centre of mass below the opening's
  award height, over the opening, a collider touched the sensor. Prize machines (classic, bridge) award
  through `RoundMachine.awardPrize`; the bridge latches a drop outside its award phases and pays it at
  the player's next grab. Items machines (shelf, rush) score each item once through
  `RoundMachine.scoreItem` in READY … SETTLING (several per try; a late fall counts towards the next try).
- **Sessions** sit above the rounds (`PlaySession`): `open` (classic, bridge: never ends by itself),
  `tries` (shelf: ends at the RESULT of the last try) and `timed` (rush: a clock on simulated time, so a
  paused game pauses it, started by the first move; the try under way when it runs out completes and
  counts). At the end of a tries / timed session the genre may grant one session prize
  (`RoundMachine.awardSessionPrize`, once per round id, never for demo rounds) and input stays locked
  until PLAY AGAIN starts a new session. Demo rounds never start or count towards a session.
- **`MachineDirector`** (`src/app`) holds everything that depends on which machine is played, so
  `Game` keeps hook lines only: the switch (curtain, rewards and cards cleared, visuals cleared,
  `setMachine`, cabinet and claw visual rebuilt, the machine's own score record, warm-up), items
  settlement (`scoreTry`, today's bonus, once per round id), the session card and its one claim code, the
  local rankings (rush), today's pick, the unlock mode, the guide's machine events, attract mode with
  several machines (`MachinePilot` steers through the player's input path with the genre's aim; the
  idle reset returns to the home machine; the optional attract cycle) and the `ui.machine` slice.
- **Nothing outside physics decides.** Points, today's bonus, rankings and the lobby are presentation;
  the independence test (`tests/unit/core/independence.test.ts`) covers `src/game/machines` like the
  rest of `src/game`.
- **Adding a machine**: a variant of an existing genre is one more `MachineDef` with its own `params`; a
  new genre is one module file plus one registry line, kept `available: false` until its tests, sweeps
  (`tools/dev/machine-sweep.ts --machine <id>`) and e2e pass.

## UI ↔ engine communication

Two vanilla zustand stores and three ports; no React state is authoritative.

| Channel | Direction | Content |
| --- | --- | --- |
| `GameStore` (`src/app/gameStore.ts`) | engine → UI | Phase, demo flag, result, prize, score (session, streak, best, lifetime, last award) and score popups, toasts, open modal, display preset, effective render resolution, automatic reductions, perf snapshot, tracker / audio / guide status (incl. the calibration phase), boot progress |
| `SettingsStore` (`src/settings/store.ts`) | UI ↔ engine | Applied settings, the draft being edited, `view()` = draft or applied |
| `Game` methods | UI → engine | `setDirection`, `grab`, `pressStart`, `playAgain`, `chooseProfile`, `restartRound`, `restockNow`, `resetScores`, `dismissPopup`, … (calibration goes straight to the tracker port: `startCalibration`) |
| `AudioPort`, `GuidePort`, `TrackerPort` (`src/core/contracts.ts`) | engine → subsystem | Narrow interfaces; each has a null implementation in `src/app/nullPorts.ts` |
| Simulation events | simulation → `Game` | `RoundMachine`: `phase`, `result`, `award` (`session: true` for a session prize), `watchdog`, `abort`, `aimTick`, `item`; `RoundController`: `grabStarted`, `clawTouch`, `gripEvaluated`, `liftStarted`, `slipped`, `released`, `prizeDetected`, `strayInBin`, `recovered`, `itemScored`, `axisStage`; `PlaySession`: `started`, `second`, `timeLow`, `over`; `PhysicsWorld.impacts` |
| Machine slice and methods | engine ↔ UI | `GameStore.machine` (the machine, its session, the coin plate, staff and lobby availability, today's pick), `sessionResult` (the session card), `rankEntry` (a top-10 place waiting for initials); `Game.selectMachine`, `openLobby`, `machineAction('staff')`, `stepInput`, `newSession`, `submitInitials`, `machineCards` |

React components subscribe to store slices and call `Game` methods; they never
touch Three.js or Rapier objects. Score popups are positioned by `Game.toScreen`, which projects a world point to
CSS pixels **relative to the game's box** (the canvas): the HUD, popups and dialogs are laid out inside that box,
which is the whole window except when a 9:16 screen is simulated (`src/layout/frame.ts`, [DISPLAYS.md](DISPLAYS.md#simulated-916-screen)). `Game` translates simulation events into store
updates, sounds and guide events. The guide receives *facts* (`GuideFacts`: phase,
attempt and win counts, outcome, contact level, slip reason, toy name, where the
nearest toy was relative to the claw) — never images, landmarks or free text from the player.

## Why graphics cannot change outcomes

- `GameCore` receives only numbers: `RoundParams` (speeds, forces, assist),
  `FieldOptions` (count, scale, density, mass scale, seed), toy friction and the
  bin floor height. No graphics setting is among them.
  (The bin floor height follows the display layout — how much of the prize bin fits on screen. It lies
  below the prize sensor, so it changes where a won toy comes to rest, not whether it is won.)
- Physics uses the **collision proxies** from the manifest (convex hulls), never
  render meshes, LODs or deformed vertices. Soft-body deformation is visual only
  and is driven *from* contacts, not the other way round.
- The step is fixed and independent of frame rate and render resolution.
- The automatic optimiser may change particles, bloom, AO, reflections, glass,
  internal resolution and shadow resolution — and nothing else.
- Prize detection is a physics sensor, not a screen-space or animation test.

This boundary is enforced by a test: `tests/unit/core/independence.test.ts`
walks the run-time import graph of `src/game` and `src/physics` and fails if it
reaches the scene, UI, app shell, audio, AI, tracking, themes, perspective or
layout code. The headless harness (`tests/unit/game/harness.ts`) and the probes
in `tools/dev/` (`round-probe.ts`, `grip-sweep.ts`) play complete rounds through
the same `GameCore` in Node, without a browser.

## Settings: apply modes and the draft

Every setting is declared once in `src/settings/spec.ts` (type, default, range,
apply mode). Three apply modes exist:

| Mode | Takes effect | Examples |
| --- | --- | --- |
| `live` | Immediately, also while only previewed in the open dialog | Graphics, audio, layout, camera, language |
| `round` | From the applied settings at the next round boundary | Claw speeds and force, grip assist, friction, restock mode |
| `rebuild` | Rebuilds the toy field / theme at the next round boundary | Theme, toy count, toy weight, toy size, pile density, disabled toys, custom models |

Draft flow:

1. Opening the dialog calls `beginEdit()` — the store clones the applied settings into `draft`. The game pauses.
2. Edits go to the draft. `Game.onSettingsChanged` pushes **live** values from `view()` to the renderer, audio, tracker, guide and layout, so they are previewed immediately.
3. **Cancel** (also `Esc`, the close button and the backdrop) calls `cancelEdit()` — the draft is dropped and the live values snap back to the applied ones.
4. **Apply** calls `applyEdit()` — the draft becomes the applied settings and is persisted. `round` and `rebuild` values are read **only** from applied settings; if a round is in progress a rebuild is queued (`pendingChange`) and runs when the round is over.

Details that follow from this: choosing a display preset in the Layout tab is
previewed at once and reverts on Cancel like any other live value; sanitising and cross-field
invariants (for example "safe zone at least 30 % tall") are applied on load and import; a preset
(graphics or difficulty) becomes `custom` as soon as one of its values is edited.

## Error handling and fallbacks

| Failure | Behaviour |
| --- | --- |
| Exception inside a frame | `Game.recover`: logged, the round is reset to a known phase, a toast is shown; the loop keeps running. |
| A phase never reaches its milestone | Phase watchdog (see above) forces the sequence forward. |
| WebGL context lost | `Stage` stops rendering (`preventDefault` on the event so the browser may restore it) and the game pauses with reason `context`; on `webglcontextrestored` the scene, the post-processing chain and the environment map are rebuilt and the game resumes. |
| Tab hidden | Pauses the simulation and the guide, suspends audio and tracking; resumes without catch-up. |
| A character GLB is missing, corrupt or has no meshes | `src/plush/fallbackGeometry.ts` supplies a simple two-ball stand-in in the character's main colour; physics is unaffected because it uses the manifest proxies. The problem is logged and listed under *System → Warnings*. |
| A character GLB is an ordinary glTF model without the plush vertex attributes | Not an error: it is rendered with its own materials plus the shared soft-body deformation (see [ASSETS.md](ASSETS.md#adding-or-replacing-a-character)). |
| Audio files missing / decoding fails | A studio take, stinger, voice or effect that cannot be loaded falls back to the synthesised file of the same name (music: the theme's synthesised track); if those are missing too, the engine switches to the built-in synthesiser (worker) and reports `usingFallbackSynth`. |
| A textured (generated) model or a texture tier is missing or broken | `PlushLibrary` falls back to the embedded 512 textures, then to the procedural model of the same character, with a warning; `?models=procedural` forces the procedural models. |
| An effect throws | `Game.safeFx` logs it and skips the effect; the round is not touched. |
| No audio permission yet | The game tries `unlock()` at boot (kiosks that allow autoplay play the attract demo with music); otherwise state `locked`, and audio starts on the first tap, click or key anywhere. |
| Camera denied, absent, busy, insecure context, model load failure | The tracker reports a specific state; the view uses the reference eye position (plus a slow drift on the attract screen, unless reduced motion is on) and the game is fully playable. The HUD chip shows the state. |
| Face lost during play | Hold the last position, then ease back to neutral, then blend in again when a face returns ([CALIBRATION.md](CALIBRATION.md)). |
| AI server unreachable, no key, timeout, invalid response, rate limited | The guide answers from local lines within its time budget; status shows the reason ([AI.md](AI.md)). |
| Subsystem constructor throws | `bootstrap` substitutes a null port; the rest of the game is unaffected. |
| Corrupt or newer-version stored settings | Sanitised field by field, or replaced by defaults; `repaired` is flagged. |
| React render error in the HUD | `HudBoundary` logs it and remounts the HUD (up to three times, then the HUD is hidden); the 3D game keeps running. |

## Server

`server/index.ts` starts a Hono app (`server/app.ts`):

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Liveness and version |
| `GET /api/ai/status` | `configured` (whether a key is present — never the key itself), model names, speech interface, limits, `credential` (source and last-four fingerprint) |
| `GET /api/ai/key`, `POST /api/ai/key`, `POST /api/ai/key/test`, `DELETE /api/ai/key` | Show, replace, check and restore the OpenAI key (stored in `<PLUSH_DATA_DIR>/secrets.json`; only from the server machine or with the admin token, per `PLUSH_KEY_MANAGEMENT`) |
| `POST /api/ai/line` | One guide line (validated facts in, structured line out) |
| `POST /api/ai/speech` | Speech audio for a line |
| `POST /api/ai/test`, `GET /api/ai/models` | Connection test and model list for the settings dialog |

Requests are validated with zod (`server/schemas.ts`), rate limited per client,
time-boxed, and logged without secrets. With `--serve-dist` the same process
serves the production build; `--https` / `PLUSH_HTTPS=1` adds an HTTPS listener with a self-signed certificate
for phones on the LAN. Outbound calls honour `HTTPS_PROXY` / `NO_PROXY` and `NODE_EXTRA_CA_CERTS` /
`SSL_CERT_FILE` without Node flags. Full description: [AI.md](AI.md).
