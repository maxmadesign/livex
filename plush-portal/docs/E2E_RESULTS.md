# End-to-end test results

Automated acceptance checks for PLUSH PORTAL: the Playwright browser suite (`tests/e2e`), the Vitest unit
suite (`tests/unit`), the type checks and the production build. This file records what was run on the
round-2 build, where, against which sources, what passed, and what these runs do **not** prove.

**Short version.** On commit `5a5ca12` both type checks pass, all **953 unit tests in 84 files** pass and the
production build succeeds. The whole browser suite (49 tests) ran once: **41 passed, 5 failed, 3 skipped**.
All 5 failures were **test bugs** (four specs had the test server's port hard-coded, one stability check
assumed a fixed collider total); after test-only fixes each of the five specs **passed when re-run on its
own**. No product defect was found by these runs. Nothing here was checked on a real GPU, phone, 32" or 86"
panel, camera or speaker, and nobody listened to any audio.

## Environment — read this first

| | |
| --- | --- |
| Where | A cloud container: 4 shared CPU cores, **no GPU, no display, no camera, no speakers, no phone** |
| Browser | Headless Chromium 158.0.8127.36 (Playwright 1.63.0) with **software WebGL** (ANGLE → SwiftShader, Vulkan) |
| Node | v22.23.5 |
| What is served | The **production build** (`vite build` into a scratch folder) served by the project's own server (`server/index.ts --serve-dist`) on port 8811 (`PLUSH_E2E_PORT=8811`, `PLUSH_E2E_DIST=<scratch>/dist-e2e`) |
| AI | The server ran **keyless**: `OPENAI_API_KEY` empty, `PLUSH_KEY_MANAGEMENT=off`, a fresh temporary `PLUSH_DATA_DIR`. Checked before the run: `/api/ai/status` → `configured: false`, `credential.source: "none"`. No request went to OpenAI. |
| Not used | A Ryzen 7 7840HS / Radeon 780M, any real GPU, a physical 32" or 86" screen, a real phone, a real camera or person, real touch hardware, audio output, Safari / Firefox, live OpenAI |

Viewport sizes (1280×720, 1080×1920, 2160×3840, 844×390, a 9:16 box inside 1280×720) prove layout rules, not
ergonomics, reach, readability or viewing comfort on a physical screen. Frame rates here (whole seconds per
frame on some tests) say nothing about a real GPU and are not reported as performance.

## Command results (this verification run, 2026-11-24 UTC)

| Command | Sources | Result |
| --- | --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | A | exit 0 (1.8 s) |
| `npx tsc --noEmit -p tsconfig.node.json` | A, and again after the test fixes | exit 0 both times (covers `tests/e2e` and `playwright.config.ts`) |
| `npx vitest run` | A | **84 files, 953 tests passed**, 0 failed, 0 skipped (38 s) |
| `npm run build` (tracking assets check → typecheck → `vite build`) | A | exit 0; 229 modules; main chunk 5.9 MB (2.1 MB gzip); no warnings in the log |
| `npm run e2e -- --trace off` (whole suite, once) | A | **41 passed, 5 failed, 3 skipped** of 49 tests; 17:04:45 → 18:08:19 (Playwright: 1.1 h) |
| The 5 failing specs, each re-run alone after test-only fixes | B | `05-input` 4/4, `13-camera-denied` 1/1, `13-camera-fallback` 1/1, `14-camera-fake` 1/1, `19-stability` 2/2 — **all passed** |

Sources:

* **A** — commit `5a5ca12` exactly (working tree clean when the build for the full run was made at 17:04).
* **B** — commit `5a5ca12` + the test-only fixes listed below + two uncommitted product edits that **another
  workstream** made while the full run was in progress (`src/scene/Cabinet.ts` at 17:38: placement of the
  "caution" sticker; `src/ui/game.css` at 17:59: Cosmic / GPU Party score and win-card colours, the phone
  call-to-action hand). The re-runs (18:10–18:17) rebuilt from that tree. None of the re-run specs asserts
  sticker placement or those colours.

Not run in this session: `npm ci` / a clean install into an empty `node_modules` (the folder is shared with
servers other sessions are running), and `npm run dev` (a dev server on 5173 belonging to another session was
already running; it was not touched).

## How the suite copes with software rendering

* One rendered frame can take seconds here, so most specs start the game with very cheap graphics (ordinary
  user settings seeded into `localStorage`: custom preset, render scale 0.35, shadows / AO / fur off,
  512 textures, auto-optimise off) and advance **game time** with the `?debug=1` API
  (`__plush.fastForward(sec)`: the same fixed 120 Hz physics steps the game runs, without rendering). Physics,
  rules, scoring and settlement are the real code; only the wall clock is skipped. Specs that need a preset
  pass `?quality=` instead (phone: `safe`; graphics change: Safe → Medium live).
* Buttons are operated with real pointer, keyboard and touch events. One test (desktop round in `02-rounds`)
  aims with the on-screen direction buttons only, in real time, like a player. Elsewhere
  `__plush.placeClaw(x, z)` puts the claw above a spot between rounds — a test shortcut for aiming, not
  player input.
* Every `window.__plush` call except `attract()` counts as player input, so slow steps never trigger the idle
  reset by accident; `22-idle-attract` therefore waits for the reset by watching the DOM only.
* Dialogs pop in with a 260 ms animation; helpers wait for animations to finish before measuring rectangles.
  `__bootDone` is set before the first frame is on screen; the first frames (shader compilation) can block the
  page for 10–25 s, so timeouts are long (test timeout 7 min, some specs 15–25 min) and nothing races the clock.
* One worker, no retries.

## What was simulated, and how

| Thing | Simulation used | What it does **not** show |
| --- | --- | --- |
| 32" / 86" portrait screens | Viewports 1080×1920 and 2160×3840 with `?display=portrait32 / portrait86` | Physical size, reach, readability, glare |
| A 32" / 86" preset in a landscape window (R10) | `portrait32` / `portrait86` in a 1280×720 window → the game draws a centred 405×720 9:16 box | A real portrait panel |
| Phone held sideways (R3) | Chromium phone emulation: 844×390, `isMobile`, `hasTouch`, coarse pointer, `?display=mobile`, taps via `page.touchscreen` | A real iOS / Android device, cut-outs, landscape lock, full screen, heat, frame rate |
| Touch on a kiosk | `hasTouch` contexts; two simultaneous touch points through CDP `Input.dispatchTouchEvent` | A real touch panel, palm rejection, latency |
| Tab hidden / shown | `document.visibilityState` overridden + a `visibilitychange` event | Real background-tab throttling |
| Window blur | A dispatched `blur` event | OS-level focus changes |
| Camera present | Chromium's synthetic camera (`--use-fake-device-for-media-stream`): a moving test pattern, **no face** | Face detection, tracking accuracy, latency, the 3-2-1 calibration with a person |
| Camera denied | Same synthetic camera, prompt auto-answered "Block" (`--use-fake-ui-for-media-stream=deny`) | A real permission dialog |
| No camera | Permission granted, zero video devices | — |
| Head position | The "test viewpoint" sliders in Settings → Camera (reported as source `test`, never `tracking`) | Anything about real head tracking |
| No OpenAI key | The real server without a key | — |
| API unreachable | Every `/api/**` request aborted in the browser | — |
| Slow GPT | A **fake** `/api/ai/status` claiming a key and a fake `/api/ai/line` answering after 9 s | Real OpenAI behaviour; no real GPT text or speech was produced |
| Idle player (R8) | `system.idleSeconds` set to 10 s; no input of any kind until the reset | A real crowd walking past |
| Hostile / broken settings | Hand-made JSON files (garbage, foreign, version 99, array, out-of-range values) | — |
| Audio | A real `AudioContext` with no output device; gains, states, decoded buffers and the engine's calls are read in the page | Audible output, loudness as heard, taste |

## How to run

```bash
npm run e2e                                  # builds dist, serves it on :8799, runs everything (screenshots skipped)
PLUSH_E2E_PORT=8811 PLUSH_E2E_DIST=/tmp/x npm run e2e    # another port / build folder (as used for this run)
npx playwright test tests/e2e/06-outcomes.spec.ts --trace off       # one file
PLUSH_SHOTS=1 npx playwright test tests/e2e/20-screenshots.spec.ts  # regenerate docs/screenshots
```

Two Playwright projects: `chromium` (everything else) and `camera-fake` (`*camera-fake*.spec.ts`, Chromium
started with the synthetic camera). A server already answering on the chosen port is reused — make sure it is
a keyless one.

## Every spec, this build

"Full run" = the one complete `npm run e2e` on sources A. "Alone" = re-run of that spec file on its own on
sources B after the test fix. Numbers are from the last run of the test.

| Spec · test | Full run | Alone | Evidence |
| --- | --- | --- | --- |
| `01-load` · no console errors, no failed requests, boots to attract | pass | — | 97 requests, all same-origin, boot 5.6 s, 0 console errors, 0 uncaught exceptions, 0 failed / ≥ 400 responses; one app-log warning "Stored settings were incomplete… repaired" (the test seeds only the graphics section) |
| `01-load` · first run without a preset: device chooser inside reach, dismissible | pass | — | 4 device cards |
| `02-rounds` · desktop 1280×720, buttons only, real-time aim | pass | — | 6 presses, aim error 1.4 cm → won `sakura.monster` → win card → PLAY AGAIN |
| `02-rounds` · portrait32 1080×1920 | pass | — | won on the 1st centred grab, PLAY AGAIN |
| `02-rounds` · portrait86 2160×3840 | pass | — | won on the 1st centred grab, PLAY AGAIN |
| `02-rounds` · presets keep their own layout across reloads | pass | — | |
| `03-safe-zone` · 1080×1920: HUD, tutorial, every settings tab, theme picker, collection, win card | pass | — | panel 0.528–0.672 (centre 0.600 = anchor 0.6), START 0.556–0.632, menu row 0.643–0.665, dialog 0.258–0.742, win card 0.296–0.535, PLAY AGAIN 0.489–0.524 |
| `03-safe-zone` · 2160×3840 | pass | — | same normalised zones; START 292×292 px, direction button 132 px |
| `04-settings-dialog` · desktop / portrait32 / portrait86 (3 tests) | pass ×3 | — | dialog 905×691 / 1004×1843 / 874×929; tab list left (184 / 276 / 182 px), content right; Graphics tab 1543 / 2879 / 1629 px scrolls inside 574 / 1643 / 802 px |
| `04-settings-dialog` · short window 900×480 | pass | — | dialog 603×456, tab list 379 px in 379 px (no real overflow occurred, so only reachability is shown) |
| `05-input` · hold / release, lost capture, blur, hidden tab, dialog | pass | pass | |
| `05-input` · typing in a settings field | pass | pass | no movement, no grab |
| `05-input` · keyboard, diagonals | pass | pass | straight 0.420 m/s, diagonal 0.420 m/s (0.297 + 0.297) |
| `05-input` · two-finger touch diagonal, `touchcancel` | **fail** (test bug 1) | **pass** | two-finger diagonal 0.420 m/s |
| `06-outcomes` · centre grab wins; 2nd GRAB ignored; one award | pass | — | won on try 1, grip quality 0.62 |
| `06-outcomes` · empty spot | pass | — | nearest toy 38.6 cm away → `empty`, contact `none`, nothing awarded |
| `06-outcomes` · off-centre can slip | pass | — | 7 rounds: 4.5 cm off ×4 won (q 0.28–0.37); 6 cm off: 2 won, 1 **slipped (eccentric, during LIFTING, q 0.11)** |
| `07-settlement` · collection changes only at the chute sensor, once | pass | — | award and sensor in the same step (1188), toy inside the chute; restart during TRANSPORTING gives no credit |
| `07-settlement` · demo rounds never touch the collection | pass | — | demo round won, collection unchanged; take-over during DESCENDING |
| `09-themes` · five themes swap cabinet, characters, UI colours, music | pass | — | sakura `#ff8fb3`, storybook `#ff8a6b`, ocean `#6ab8e6`, cosmic `#9b7bff`, gpu `#76b900`; 18 toys of the theme's own 6 (GPU: 7) characters; music track = theme each time; collection lists 31 characters |
| `09-themes` · dialog text contrast in every theme | pass | — | 0 texts below 3:1 in all five themes |
| `09-themes` · theme picked mid-round waits | pass | — | Cosmic picked during LIFTING: stays sakura, "pending", changes after the round |
| `10-audio` · locked → running; volume, mute, preview, output device | pass | — | after START: context running 44.1 kHz, music `sakura`, `usingFallbackSynth` false (logged, not asserted); master 0.8 → 0.3 preview → mute → Cancel 0.8; Ocean preview on its own bus; `setSinkId` present, 0 outputs listed → explanatory note; mute survives reload |
| `11-settings` · preview, cancel, apply, persistence, reset tab | pass | — | language → `zh` gives `<html lang="zh-Hans">`, survives reload |
| `11-settings` · export / import, garbage rejected, clamping, no secrets | pass | — | export 8397 bytes, 9 sections, nothing key-like; hostile file clamped (`moveSpeed` 0.9, `toyCount` 6, `aimTimeLimit` 60, `master` 1, …) |
| `11-settings` · corrupt stored settings repaired; no raw translation keys | pass | — | |
| `12-ai-offline` · no key | pass | — | only `GET /api/ai/status` called; 4 local subtitles (first play, grab, prize, tip); test button: "Not connected: The server has no OpenAI API key; local lines are in use" |
| `12-ai-offline` · API unreachable | pass | — | same, playable |
| `12-ai-offline` · slow fake server claiming a key | pass | — | round won in 16.7 s wall time while 2 line requests hung; local lines only; states `checking → error`, never `gpt` |
| `12-ai-offline` · guide off | pass | — | no subtitles |
| `13-camera-denied` | **fail** (test bug 1) | **pass** | `NotAllowedError: Permission denied`; one `getUserMedia({video 640×480 ideal, 30 fps, user}, audio:false)`; eye fixed at (0, 0.856, 2.698); "Fixed viewpoint" |
| `13-camera-fallback` · no camera | **fail** (test bug 1) | **pass** | `NotFoundError: Requested device not found` → `no_device`, same fixed eye |
| `14-camera-fake` (project `camera-fake`) | **fail** (test bug 1) | **pass** | `fake_device_0` 640×480, video only; GPU delegate skipped on software GL → `worker-cpu`; 4 inferences, 0 faces → `searching`, view source `neutral`; off ends the track, on restarts; no request with a body |
| `17-viewpoint` · desktop 1280×720 | pass | — | window corners → NDC corners for every eye (max error 6.7·10⁻¹⁶); x ±0.25 → P[8] ∓0.93; y 0.2 → P[9] −0.94 → −2.24; z −0.3 → P[0] 2.34 → 1.28; still exact after resize 1280×720 → 1024×648 and render scale 0.35 → 0.7 |
| `17-viewpoint` · portrait86 1080×1920 | pass | — | same invariants (max error 4.4·10⁻¹⁶); after resize 864×1728 and render scale change |
| `18-graphics-midround` | pass | — | during LIFTING: custom-low → Safe (1116×627) → Medium (1280×720) preview: round, phase, steps, 18 toy poses, claw identical; after Apply largest toy movement 3.54 cm (the lifted toy), one result |
| `19-stability` · ten rounds + theme switches | **fail** (test bug 2) | **pass** | 10 rounds (5 won, 5 slipped) over sakura → ocean → cosmic → storybook → sakura: geometries 62 → 62 (max 63), textures 32 → 32, programs 21, bodies 24, joints 3, 18 toys; toy colliders = their proxies at all 10 checkpoints (75, 75, 93, 95, 78, 78, 72, 72, 75, 78), the other colliders 23 at every checkpoint, 0 stale handles; JS heap 54 MB throughout |
| `19-stability` · hidden tab mid-round | pass | pass | 0 steps while hidden, audio suspended; 0.125 s (15 steps) in the first 3 frames after 6 s hidden — no catch-up; largest toy displacement 5.62 cm; one result |
| `20-screenshots` · desktop / portrait32 / portrait86 (3 tests) | skipped | — | only run with `PLUSH_SHOTS` set; not run this round (see item 20 below) |
| `21-points` · demo track vs player track | pass | — | demo win (`sakura.tanuki`) scored 300 on the DEMO track, player best / lifetime 0, nothing stored; player win settled once: 850, stored `{best 850, lifetime 850}` |
| `22-idle-attract` · idle reset on 86" (touch) | pass | — | reset after 13.9 s wall time with `idleSeconds` 10: dialog closed, session cleared, light show `attract`; call to action 512×167 px at y 0.344–0.430 (inside 0.25–0.75), larger than START (y 0.555–0.632) |
| `23-frame` · portrait32 in 1280×720 | pass | — | root, canvas and HUD 405×720 at x 437; score popup inside the box (611, 316) |
| `23-frame` · portrait86 in 1280×720 | pass | — | same box; popup at (621, 253) |
| `23-frame` · 9:16 window used whole | pass | — | no box, no surround |
| `24-phone` · 844×390, taps, a full round | pass | — | profile `mobile`, landscape; D-pad 200 px, action 140 px, menu buttons 44 px, no overlaps; hold ▶ 0.3 s moved the claw 0.060 → 0.264, stopped at 0.274 (wall 0.370); round 2 won (`sakura.capybara`) |

Totals: full run 41 / 5 / 3 (pass / fail / skip); after the fixes every non-skipped test has passed on this
build (46 pass, 0 fail, 3 skip), the five fixed ones only in their own re-run.

## Failures in the full run and how they were classified

| # | Tests | What failed | Classification | Fix (test-only) |
| --- | --- | --- | --- | --- |
| 1 | `05-input` touch, `13-camera-denied`, `13-camera-fallback`, `14-camera-fake` | The first three create their own browser context with `baseURL: 'http://127.0.0.1:8799'`, so with `PLUSH_E2E_PORT=8811` they got `net::ERR_CONNECTION_REFUSED` on the first `goto`. `14-camera-fake` counted every request not starting with `http://127.0.0.1:8799/` as "left the server": all 122 flagged URLs were `http://127.0.0.1:8811/…`. | **Test bug** — the specs ignored the port the config already makes configurable. With the default port they would pass. | Use Playwright's configured `baseURL` fixture (`05-input.spec.ts`, `13-camera-denied.spec.ts`, `13-camera-fallback.spec.ts`), and compare with its origin (`14-camera-fake.spec.ts`). |
| 2 | `19-stability` ten rounds | `expect(last.colliders).toBe(first.colliders)`: 98 at the start of sakura, 101 after round 10 (sakura). | **Test bug.** A toy has one collider per collision proxy and characters have different numbers of proxies; a won toy is restocked with another character, so the total follows the field's composition. In the failing run the total only changed after won rounds, never after slips. The re-run's split proves it: toy colliders equalled the proxies of the toys on the field at every checkpoint, the other (cabinet / claw / sensor) colliders stayed at 23 throughout, no stale handle. | `counts()` now also reports toy colliders, their proxies, the other colliders and stale handles; the test asserts toy colliders = proxies and no stale handle at every checkpoint and the other colliders unchanged at every checkpoint (stricter than before, across all themes), instead of an equal total. |

Note: the edits to the four port specs were made while the full run was in progress (before those specs were
reached), but Playwright kept the version it had loaded at start, so the full run still failed them; they were
re-run afterwards. **No product bug was found by this run.** No spec was flaky in the sense of failing and
then passing unchanged.

## Coverage map — original acceptance items (round 1)

"e2e" = browser specs above (run on this build); "unit" = Vitest files under `tests/unit` (all passing on
sources A).

| # | Item | Covered by | Status here |
| --- | --- | --- | --- |
| 1 | Clean install, dev start, production build, no blocking console errors / 404s | `npm run build`; e2e `01-load` (production build) | Build and production load verified. Clean `npm ci` and `npm run dev` **not run** in this session (see above). |
| 2 | Desktop, 1080×1920, 2160×3840 each complete a round; presets don't overwrite each other | e2e `02-rounds` (4); unit `layout/solve`, `settings/store` | Verified (viewports only) |
| 3 | 86": start / direction / grab / result / play again / theme / close-settings in y 0.25–0.75 | e2e `03-safe-zone` (2), `22-idle-attract` (call to action); unit `layout/solve` | Verified at 1080×1920 and 2160×3840 (not on a panel) |
| 4 | "i" and central entry open the same dialog; tabs left / content right | e2e `04-settings-dialog` (4) | Verified; tab-list overflow scrolling itself never occurred |
| 5 | Hold-to-move, release, diagonals, blur, pointer cancel, dialog pause | e2e `05-input` (4), `24-phone`; unit `layout/phoneBehaviour` | Verified with synthetic events, not real touch hardware |
| 6 | Empty grab, win, grip-then-slip are real physical paths; one grab per round; no double settlement | e2e `06-outcomes` (3), `07-settlement`; unit `game/rounds`, `game/RoundMachine` | Verified |
| 7 | Prize counts only after it enters the exit; reset / theme switch / repeats never double-award | e2e `07-settlement` (2), `21-points`, `09-themes` (mid-round switch); unit `core/collection`, `game/RoundMachine`, `game/scoring` | Verified |
| 8 | Dents, sag, sway, squash / rebound, release recovery visible; no obvious clipping | — | **Not covered.** Needs a person looking at it on a real GPU. |
| 9 | Themes differ in characters, finish, lighting, UI, music, win feedback | e2e `09-themes` (3); unit `themes/*`, `audio/music` ("tracks are different pieces"), `audio/studio`, `fx/aura` (motif per theme) | Ids, palettes, casts, music track and stinger files differ per theme (measured). Finish / lighting / look **not judged** here. |
| 10 | Music and main SFX play; volume, mute, preview, AI ducking | e2e `10-audio`; scratch audio check below; unit `audio/engine`, `audio/studio`, `ai/speech` (music duck while the guide speaks) | Engine state, gains, decoded studio files and the SFX calls verified. **Nothing was heard.** |
| 11 | Settings preview / cancel / save / reset / import / export, persistence | e2e `11-settings` (3); unit `settings/*` | Verified |
| 12 | No key / offline / AI timeout / voice unavailable: game and local subtitles work | e2e `12-ai-offline` (4); unit `ai/director`, `ai/probe`, `ai/speech` (system / local voice fallback), `server/app` | Verified for no key, aborted API, fake slow server; voice fallback unit-tested only |
| 13 | Camera denied / ignored / missing / busy → fixed viewpoint | e2e `13-camera-denied`, `13-camera-fallback`; unit `tracking/cameraSource` (`NotReadableError` etc. → `in_use`), `tracking/faceTracker` (unanswered prompt never blocks) | Denied and missing verified in the browser; ignored and busy unit-tested only |
| 14 | Tracking off stops the video track; on recovers; status accurate | e2e `14-camera-fake`; unit `tracking/faceTracker` | Verified with the synthetic camera (lifecycle only) |
| 15 | Repeatable off-axis maths tests | unit `perspective/offAxis` (17), `perspective/OffAxisCamera` (12), `perspective/simulatedScreen` (6); e2e `17-viewpoint` | Verified |
| 16 | Real camera: lateral / vertical / depth, head turn, loss / re-acquire, bystander | unit tests on **synthetic** landmarks only (`tracking/eyeEstimator`, `headPose`, `primarySelector`, …) | **Not covered — needs a real camera and a real person.** Not faked. |
| 17 | Tracking never moves the claw; HUD does not drift; projection survives resize / dynamic resolution | e2e `17-viewpoint` (2); unit `core/independence`, `tracking/viewpointController` | Verified with the test viewpoint (not with real tracking) |
| 18 | Graphics quality never changes physics, win conditions, prize count, layout | e2e `18-graphics-midround`; unit `core/independence` ("never reads graphics settings"), `scene/graphicsTiers` | Verified |
| 19 | Many rounds / theme switches: no resource growth; background / return safe | e2e `19-stability` (2); unit `fx/pooling` (no pool growth after 60 rounds) | Verified (counts in software GL; no GPU memory measurement) |
| 20 | Screenshots of the layouts and themes; fix clipping / covered buttons / overflow / glare / unclear characters | e2e `20-screenshots` (skipped by default) | **Not redone this round.** `docs/screenshots/` still holds the 18 round-1 pictures (2026-11-24 07:57–08:19 UTC: four themes, no GPU Party, no phone layout, no score HUD or call to action). They do not show this build. |

## Coverage map — round-2 requests

| # | Request | Covered by | Status here |
| --- | --- | --- | --- |
| R1 | Very high-precision models, materials, textures, environment | unit `plush/library`, `plush/manifest`, `plush/material`, `plush/importGenerated`, `scene/graphicsTiers`, `scene/texgen`, `scene/toyVisuals`; e2e `01-load` (all textured assets load, no 404) | Loading, LOD / texture-tier choice and fallbacks verified. **Visual quality not judged** — needs eyes on a real GPU. |
| R2 | Supplied OpenAI key is the default; replaceable in Settings | unit `server/keys` (21), `server/app` (37), `server/config`, `server/sdk-integration` (mock OpenAI) | Server-side key logic unit-tested with fake keys. **Not covered by e2e by design** (the suite must run keyless); e2e `11` / `12` only show that no key-like string reaches the page, the export or `localStorage`. Live use of the real key: not tested here. |
| R3 | Playable on (widescreen) phones, 32" and 86" | e2e `24-phone`, `02-rounds`, `03-safe-zone`, `23-frame`; unit `layout/phoneLayout`, `phoneBehaviour`, `phoneCss`, `labelFit` | Verified in emulation (844×390 phone, 1080×1920, 2160×3840). **Real phones / panels not tested.** Upright phone and other phone sizes: unit only. |
| R4 | Points per toy triggering special, particle and light effects | e2e `21-points`; unit `game/scoring`, `game/rarity`, `persistence/scores`, `fx/tiers`, `fx/aura`, `fx/pooling`, `fx/scaling`, `fx/render` | Scoring, settlement-once, demo track, storage verified; effect escalation by tier unit-tested (counts, modes). **How "cool" it looks: not judged.** |
| R5 | Camera on phone and computer for the naked-eye 3D effect | e2e `14-camera-fake` (desktop, synthetic camera); unit `tracking/devicePolicy`, `cameraTransform` (sensor rotation / mirror), `backends`, `server/tls` (HTTPS for phones) | Camera lifecycle on desktop Chromium only. **No phone camera, no face, no 3D effect seen.** |
| R6 | NVIDIA-keynote-style theme (original "Keynote Chief", plush GPU items, pile, own SFX and music) | e2e `09-themes` (GPU Party: 7 own characters, own palette, own music track); unit `themes/gpuTheme`, `themes/gpuDesigns`, `audio/gpu`; scratch audio check (own takes, stingers, 7 voices) | Theme content and audio files verified. Cuteness, likeness and trademark questions are not testable here (see README). |
| R7 | Camera on → 3-second countdown → current head direction / eye position becomes the baseline; adjustable in Settings | unit `tracking/countdown` (16), `countdownTracker` (13), `autoCalibration` (13), `baseline` (7), `calibrationOverlay` (5) | **Unit tests on synthetic faces only.** No e2e (the synthetic camera has no face, so a countdown can only fail with `no_face`). Needs a real camera and person on each device. |
| R8 | Idle N s → full reset into a self-playing demo with win effects; big central "tap to start" | e2e `22-idle-attract`, `07-settlement` (demo never counts), `21-points` (demo track); unit `game/attract` (real physics), `app/demoPilot` | Verified on 86" emulation (reset, dialog closed, call to action in the band, demo wins scored on the DEMO track). The look of the call to action and the effects: not judged. |
| R9 | English default, Chinese switchable; AI still speaks English after switching | e2e `11-settings` (switch to `zh` → `zh-Hans`, persists); unit `settings/spec` (default `en`), `ai/probe` ("English by default, whatever the interface language"; English local lines with a Chinese UI), `i18n/completeness` | UI switch and the guide-language rule verified; **spoken GPT English not heard / not tested live** (no key). |
| R10 | 32" and 86" modes simulate a 9:16 portrait screen | e2e `23-frame` (3); unit `layout/frame` (22), `perspective/simulatedScreen` (6) | Verified (405×720 box in a 1280×720 window, popups inside the box, projection uses the simulated panel) |
| R11 | Dramatic, game-like SFX; different plushies sound different; detailed, finished, per-theme music | e2e `10-audio`, `09-themes` (music track per theme); scratch audio check below; unit `audio/studio` (29), `audio/studioAnalysis` (7), `audio/music` (11), `audio/gpu` (5), `audio/engine`, `audio/sfx`, `audio/synth` | Wiring and files verified: every theme plays its own two studio takes, a won toy triggers **its own** recorded voice on lift and win, tiered win stingers, and the effect layer. Unit tests measure loudness, loop seams and cross-fades. **Nobody listened**, so drama, "real game music" quality and musical fit are unjudged (the two takes of a theme are in different keys — see docs/AUDIO.md). |

### Scratch audio check (item 10, R6, R11), not part of the suite

A one-off script (`<scratch>/final-v1/audio-check.cjs`, sources B) against my own keyless server (port 8812,
`/api/ai/status` → `configured: false`): for each theme, boot with `?theme=<id>&camera=off`, press START,
wrap the engine's `playSfx` / `playWin` / `playCharacter`, play centred grabs until a win, and record the
fetched `/audio/` files and, for each character call, whether the started sound is that character's own
decoded studio voice buffer.

| Theme | Music | Won toy (tier) | Character voice | Fetched |
| --- | --- | --- | --- | --- |
| sakura | "running; studio music", studio player on `sakura_a` / `sakura_b` | `sakura.monster` (epic) | own voice on lift and win | 6 voices, win + jackpot stingers of sakura |
| storybook | studio, `storybook_a` / `_b` | `storybook.dino` (rare) | own voice on lift and win | 6 voices, storybook stingers |
| ocean | studio, `ocean_a` / `_b` | `ocean.jellyfish` (epic) | own voice on lift and win | 6 voices, ocean stingers |
| cosmic | studio, `cosmic_a` / `_b` | `cosmic.starbear` (rare) | own voice on lift and win | 6 voices, cosmic stingers |
| gpu | studio, `gpu_a` / `_b` | `gpu.chief` (legendary) | own voice on lift and win | 7 voices, gpu stingers |

Sequence in every won round: `grab_confirm → claw_descend → claw_touch → claw_close → plush_rub → claw_lift →
voice(lift) → claw_open → chute_drop → playWin(theme, tier) → voice(win) → score_count → collect_unlock`.
0 HTTP errors; the only console messages were SwiftShader / three.js performance warnings. The manifest has
31 distinct voice files for 31 characters. This proves which sounds are triggered and loaded, not how they
sound.

## Earlier findings (round 1), not re-checked by this run

Round 1 listed open defects A–E (AI status probe aborted by a busy boot, untranslated optimiser step ids,
the Cosmic status line over the bright chute, the translucent portrait panel over the 3D badge, release
relying on pointer capture). Round-2 work reports a fix for A (unit `ai/probe` "robust against a busy page
and a slow start") and for B (translated optimiser labels); C, D and E were not re-examined here, and none of
them is visible to the specs above. They need the screenshot pass (item 20) or a manual check.

## Flakiness and timing

* No test failed and then passed unchanged. The five failures above were deterministic test bugs.
* Outcomes of a seeded plan vary between runs: rendered frames between debug calls also advance real game
  time, so `19-stability` saw 6 / 4 / 0 (won / slipped / empty) in the full run and 5 / 5 / 0 in the re-run
  with the same aims. Specs that need a win or a slip look for one over several grabs (up to 8 centred, up to 16
  off-centre) for this reason.
* The real-time, buttons-only aiming test depends on machine speed (6 presses, 1.4 cm here).
* Slowest files: `09-themes` 11.7 min (the contrast scan over 5 themes is 7.6 min), `11-settings` 5.7 min,
  `04-settings-dialog` 5.7 min. The whole suite took 63.6 min on this loaded 4-core machine.
* The first frames after boot (shader compilation on software GL) can block the page for 10–25 s; changes of
  the internal 3D resolution apply at the next rendered frame, so specs poll for them.

## Run record

| When (UTC, 2026-11-24) | What | Sources | Result |
| --- | --- | --- | --- |
| 17:03 | type checks, `npx vitest run`, `npm run build` | A | pass (953 / 953 unit tests) |
| 17:04:45 – 18:08:19 | `PLUSH_E2E_PORT=8811 PLUSH_E2E_DIST=<scratch>/dist-e2e npm run e2e -- --trace off` | A | 41 passed, 5 failed, 3 skipped |
| 18:10 – 18:17 | `npx playwright test tests/e2e/<spec>.spec.ts --trace off` for the five failing specs, one at a time | B | 9 / 9 tests passed |
| 18:18 – 18:20 | scratch audio check, 5 themes | B | see above |

Logs and the audio-check output are in the session scratch folder `final-v1/` (`e2e-full.log`,
`rerun-*.log`, `audio-check.json`); they are not part of the repository.

## Post-verification fixes (2026-11-24, 18:50 – 19:52 UTC)

Targeted fixes from the completeness critic's must-fix list, applied after the runs above. Rows above
are unchanged; where they disagree with this section, this section is newer.

| # | Fix | Files | Checked by |
| --- | --- | --- | --- |
| 1 | Guide facts use the guide's language (`guideLanguage`), so a Chinese UI no longer puts Chinese toy names into English lines, GPT prompts or the voice | `src/app/Game.ts` | new e2e `12-ai-offline` "Chinese interface: …": zh UI, real win, line "First time catching Marumon! …" (no CJK, English name). This adds the toy-name case the R9 row lacked. |
| 2 | Jackpot beam strobe 3 Hz → 2 Hz (`JACKPOT_STROBE_HZ`) | `src/scene/fx/constants.ts`, `LightShow.ts` | new unit `fx/scaling` "strobe stays below 3 Hz" (period ≥ 0.45 s; fails with 3 Hz) |
| 3 | Studio takes in different keys no longer overlap: fade out to the out point, then the next take from its in point with a 0.3 s fade-in (all 5 shipped pairs differ) | `src/audio/studio/playlist.ts` | new unit `audio/studio` plan test (incoming start ≥ fade end, late hand-overs, every shipped pair) and a `StudioPlayer` schedule test; existing cross-fade tests and `studioAnalysis` unchanged and passing |
| 4 | Voices shorter than 0.4 s (astronaut 0.10 s, tanuki 0.26 s, bot 0.35 s) get the character's own squeak layered under them | `src/audio/AudioEngine.ts`, `src/audio/studio/moments.ts` | new unit `audio/studio`: a 0.10 s voice starts 2 sources, a 1.49 s voice 1. No voice was regenerated; capybara is still about 6 dB under its target. |
| 5 | Attract mode is no longer silent: theme selected and `unlock()` tried at boot; any pointerdown / pointerup / touchend / keydown unlocks while `locked` | `src/app/Game.ts` | e2e `10-audio` (new attract test; the "locked until START" test now emulates an autoplay block, because Playwright's Chromium always allows autoplay, even with `--autoplay-policy`) |
| 6 | Phone preset: while `camPos` is the default, the lens position follows `screen.orientation.angle` (90 left, 270 right, 0 top), refreshed on orientation `change` (a 90 ↔ 270 turn fires no resize) | `src/perspective/windowGeometry.ts`, `src/app/Game.ts` | new unit `layout/windowGeometry` (angles 0 / 90 / 270, user value kept); built app in Chromium phone emulation via CDP: 90 → [−0.051, 0, 0], 270 → [0.051, 0, 0], 0 → [0, 0.051, 0]. Not tried on a phone. |
| 7 | Phone calibration card buttons 40 → 44 px | `src/ui/calibration.css` | layout check at 844×390, en / ja / zh, four card states: every button 44 px tall, the ja failure card is 108 px in its 108 px region (no clip, no overflow) |
| 8 | GPU Party: dark lettering (#10140c) on filled buttons and the call to action (white was 2.4:1 on the primary, 1.6:1 on the accent) | `src/ui/hud.css` | new e2e `09-themes` "GPU Party: filled buttons …": START 11.9, call to action 7.7, GRAB 7.7, PLAY AGAIN 11.9 (both) : 1 |
| 9 | Screenshot spec: phone 844×390 and the 86" preset simulated in 1280×720 added; demo rounds off for the pictures (a theme switch outlasted the 1.6 s demo delay and the spec failed on "READY") | `tests/e2e/20-screenshots.spec.ts` | `PLUSH_SHOTS=1`: 5 / 5 passed, 38.1 min; `docs/screenshots/` replaced by 35 pictures of this build (5 layouts × 5 themes in attract, plus a win card and the settings dialog per layout) |
| 10 | Docs: GPU row in the synthesised-music table, the key-aware hand-over, short-voice squeak and boot unlock | `docs/AUDIO.md`, `docs/ARCHITECTURE.md` | — |

Not covered by the fixes, and still open: the pastel themes also draw white lettering on light faces
(about 1.7–2.4:1 by the same formula, with a dark text shadow that the formula ignores); the phone win
card still overlaps the menu row (visible in `mobile-win.jpg`); the GPU float, the tension cue and the
other optional items of the critic's list were not attempted.

| When (UTC) | What | Result |
| --- | --- | --- |
| 18:58, 19:53 | `tsc --noEmit` (both configs) | exit 0 |
| 19:05 | `npx vitest run` | 958 / 958 passed (84 files) |
| 19:07 | clean copy (`git ls-files`, no `node_modules`, `.env`, `.data`) → `npm ci` (exit 0) → keyless `npm run dev` (`OPENAI_API_KEY=` `PLUSH_KEY_MANAGEMENT=off`) | Vite on 5174, API `configured:false`, source `none`; the page booted to ATTRACT with frames advancing, 0 console errors; `npm run typecheck` exit 0 |
| 19:07 – 19:10 | e2e `01-load`, `10-audio` | 4 / 4 passed |
| 19:11 – 19:13 | e2e new `12` zh and `09` GPU tests | 2 test-selector bugs fixed in the new tests, then passed |
| 19:14 – 19:19 | e2e `05-input`, `22-idle-attract`, `24-phone` | 6 / 6 passed |
| 19:19 – 19:31 | e2e `09-themes`, `12-ai-offline` (whole files) | 9 / 9 passed |
| 19:14 – 19:52 | e2e `20-screenshots` with `PLUSH_SHOTS=1` | 5 / 5 passed |

All e2e runs used a keyless server built from this tree (`--serve-dist`, own port); software WebGL,
no audio output, no camera, no phone and no large panel.

## Round 4 (joystick, window, viewer light, machines): full run

Production build, headless Chromium with software WebGL (SwiftShader), one worker, keyless API server,
4 shared CPU cores. Commit 263086f (the machine round with all four machines offered), 2.2 h.

| Spec | Result |
| --- | --- |
| 01-load | 2/2 |
| 02-rounds | 4/4 |
| 03-safe-zone | 2/2 (the MACHINES button inside the 86" band) |
| 04-settings-dialog | 4/4 |
| 05-input (joystick) | 4/4 |
| 06-outcomes | 3/3 |
| 07-settlement | 2/2 |
| 09-themes | 5/5 (no text below 3:1 in any theme) |
| 10-audio | 2/2 |
| 11-settings | 3/3 |
| 12-ai-offline | 5/5 |
| 13-camera-denied, 13-camera-fallback | 1/1, 1/1 |
| 14-camera-fake | 1/1 |
| 17-viewpoint | 2/2 |
| 18-graphics-midround | 1/1 |
| 19-stability | 2/2 |
| 20-screenshots | skipped by design (runs with PLUSH_SHOTS=1) |
| 21-points | 1/1 |
| 22-idle-attract | 1/1 |
| 23-frame | 3/3 |
| 24-phone | 1/1 (MACHINES in the menu row; upright: top bar) |
| 25-gtc-dialogue, 25-gtc-scene | 2/2, 2/2 |
| 26-rewards-client | 5/5 |
| 27-rewards-integration (real server, QR decoded) | 7/7 |
| 28-peek (drag-to-peek) | 3/3 |
| 29-machines-glue (switches, settlement, no leaks) | 2/2 |
| 30-lobby (lobby, sessions, initials, ranking) | 5/5 |

Total: 81 tests, 76 passed, 5 skipped (20-screenshots), 0 failed. Specs 29 and 30 passed again on the
later fixes (82cdb89). Under heavy load (load average 12-20), 03 at 1080 × 1920 and 25-gtc-dialogue's
first test have timed out; both pass at normal load and in this run.

Play-through on the same build (keyless, Medium): classic, Tippy Bridge, Tumble Shelf (a full 5-try
session with its prize) and Sparkle Rush (time up, initials, rank 1) in desktop, portrait 32", simulated
portrait 86" and phone, in sakura and the GPU theme: 0 console errors, 0 page errors, 0 failed requests;
the GPU claim QR decoded on desktop, 32" and 86" (the phone shows the code and a claim link by design).
Not verified: real GPUs, real phones and panels, real cameras, real phone scans of the QR.
