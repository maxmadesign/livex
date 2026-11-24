# End-to-end test results

Automated browser acceptance tests for PLUSH PORTAL (`tests/e2e`, Playwright).
This file records what was run, where, and what it does and does not prove.

## Environment — read this first

| | |
| --- | --- |
| Where | A cloud container: 4 shared CPU cores, **no GPU, no display, no camera, no audio hardware, no OpenAI key** |
| Browser | Headless Chromium (Playwright 1.63) with **software WebGL** (ANGLE / SwiftShader) |
| What is served | The **production build** (`vite build`) by the project's own server (`server/index.ts --serve-dist`, port 8799, `OPENAI_API_KEY` forced empty) |
| Not used | A Ryzen 7 7840HS / Radeon 780M, a physical 32" or 86" screen, a real camera, a real person, real touch hardware, Safari / Firefox, live OpenAI |

Nothing below is a hardware acceptance. Viewport sizes (1280×720, 1080×1920,
2160×3840) prove layout rules, not ergonomics, reach or viewing comfort on a
physical screen. Frame rates in this container (0.5–3 frames per second for the
whole page) say nothing about a real GPU and are not reported as performance.

### How the suite copes with software rendering

* One rendered frame can take seconds here, so the specs start the game with
  very cheap graphics (ordinary user settings seeded into `localStorage`) and
  advance **game time** with the `?debug=1` API (`__plush.fastForward`, the same
  fixed 120 Hz steps the game runs, without rendering). Physics, rules and
  settlement are the real code; only the wall clock is skipped.
* Buttons are operated with real pointer / keyboard / touch events. One test
  (item 2, desktop) aims with the on-screen direction buttons only, in real
  time, like a player.
* `__plush.placeClaw(x, z)` is used in most other tests to put the claw above a
  spot between rounds. That is a test shortcut for aiming, not player input.

### What was simulated, and how

| Thing | Simulation used | What it does **not** show |
| --- | --- | --- |
| 32" / 86" portrait screens | Browser viewports 1080×1920 and 2160×3840 with `?display=portrait32/portrait86` | Physical size, reach, readability, glare |
| Tab hidden / shown | `document.visibilityState` overridden + a `visibilitychange` event | Real browser throttling of a background tab |
| Window blur | A dispatched `blur` event | OS-level focus changes |
| Touch | Chromium touch emulation (`Input.dispatchTouchEvent`, two touch points) | A real touch panel, palm rejection, latency |
| Camera present | Chromium's synthetic camera (`--use-fake-device-for-media-stream`): a moving test pattern, **no face** | Face detection, tracking accuracy, latency, calibration with a person |
| Camera denied | Same synthetic camera with the permission prompt auto-answered "Block" (`--use-fake-ui-for-media-stream=deny`) | A real permission dialog |
| No camera | Permission granted, zero video devices | — |
| Head position | The "test viewpoint" sliders in Settings → Camera (reported by the game as source `test`, never as tracking) | Anything about real head tracking |
| No OpenAI key | The real server without a key | — |
| API unreachable | Every `/api/**` request aborted in the browser | — |
| Slow GPT | A **fake** `/api/ai/status` claiming a key and a fake `/api/ai/line` that answers after 9 s | Real OpenAI behaviour; no real GPT text or speech was ever produced |
| Audio | A real `AudioContext` with no sound device; gains and states are read from the engine | Audible output, output-device switching |

## How to run

```bash
npm run e2e                                # builds dist, serves it on :8799, runs everything except the screenshots
npx playwright test tests/e2e/06-outcomes.spec.ts --trace off      # one file
PLUSH_SHOTS=1 npx playwright test tests/e2e/20-screenshots.spec.ts # regenerate docs/screenshots (≈15 min here)
PLUSH_E2E_DIST=dist-e2e npm run e2e        # build into another folder (keeps a dist/ that is being served elsewhere)
```

Two Playwright projects: `chromium` (everything) and `camera-fake`
(`*camera-fake*.spec.ts`, Chromium started with the synthetic camera).
One worker, no retries. The complete suite takes about 25–30 minutes in this container.

## Results by acceptance item

"Build" says which build the spec was last run against — see [Run record](#run-record).

| # | What is checked | Result | Build | Evidence (numbers from the last run of that spec) |
| --- | --- | --- | --- | --- |
| 1 | Production build loads cleanly | **pass** | F | 74 requests, all same-origin; 0 console errors, 0 uncaught exceptions, 0 failed requests, 0 HTTP ≥ 400; boots to attract mode with 18 toys. First run without a preset (720×1280): device chooser shown, dismissible. `01-load` |
| 2 | A full round through the real HUD on the three layouts; presets keep their own layout | **pass** | F | Desktop 1280×720: START → direction buttons only (real press-and-hold, 6 presses, aim error 1.4 cm) → GRAB → won → win card → PLAY AGAIN → next round. Portrait 32" 1080×1920 and portrait 86" 2160×3840: START, holding ▶ moves the claw > 5 cm, GRAB (claw placed by the test), won on the first grab, PLAY AGAIN. Layout: portrait86 `uiScale 0.8 / anchorY 0.56` and portrait32 `uiScale 1.1` survive reloads, desktop untouched. `02-rounds` |
| 3 | Portrait 86": everything interactive inside normalised Y 0.25–0.75; top-right "i" exists | **pass** (after fix 2) | F | Same numbers (±0.001) at 1080×1920 and 2160×3840: panel 0.528–0.672 (centre 0.600 = anchor setting 0.60), direction pad 0.541–0.647, START 0.556–0.632, menu row 0.643–0.665; settings dialog 0.258–0.742 with Close 0.263–0.285 and Cancel / Apply 0.712–0.734; win card 0.316–0.519, its PLAY AGAIN 0.473–0.507. A scan of **every** visible button / input / tab / switch (all 8 settings tabs, also scrolled to the end; tutorial; theme picker; collection; win card) finds none outside the zone except the "i" (x > 0.8, y < 0.12). 4K: direction button 132 px, START 284 px. `03-safe-zone` |
| 4 | Both settings entries open the same dialog; tabs left, content right; 8 tabs; scrolling stays inside | **pass** (one part only partly exercised) | F | Gear in the panel and the "i" give the identical dialog rectangle and the same 8 tabs. Desktop: dialog 905×691, tab list 184 px wide, content from x = 372. Portrait 32": 1004×1843, tab list 276 px. Portrait 86": 874×929, tab list 182 px. Graphics tab content 1308 / 2485 / 1387 px scrolls inside a 574 / 1643 / 802 px area; dialog, footer and page do not move. At 900×480 the dialog is 603×456 and all tabs are reachable. **Not exercised:** the tab list never overflowed in any tested size (379 px in 379 px at 900×480), so only its `overflow-y: auto` and reachability were checked, not actual scrolling. `04-settings-dialog` |
| 5 | Input: hold / release, diagonal, cancel, lost capture, blur, hidden tab, dialogs, typing, keyboard | **pass** | F | Mouse hold moves, release stops (inputs read from the controller, claw at rest afterwards); dragging off the button keeps the hold; lost pointer capture, `blur`, hidden tab and an opening dialog each clear the input; a key held before a dialog does not resume after it; 0 physics steps while a dialog is open. Typing "wasd WASD ok", arrows and Space in a settings field: no movement, no grab. Arrows and WASD map to the four directions, opposite keys cancel. Straight 0.420 m/s, diagonal 0.420 m/s (0.297 + 0.297) with keys and with two touch points; `touchcancel` releases. Space starts / grabs, a second Space or Enter during the round is ignored. `05-input` |
| 6 | Honest outcomes: centre → win, empty spot → empty, off-centre → can slip; second GRAB ignored; one award | **pass** | F | Centred grab: won at the first try, grip quality 0.62, contact `lifted`. Empty spot 38.6 cm from the nearest of 6 toys: `empty`, contact `none`, nothing awarded, next round ready without input. Off-centre sweep, 7 rounds: 4.5 cm off → 4 wins (quality 0.37–0.42); 6 cm off → 1 `empty` (only touched), 1 win, 1 **`slipped` (reason `eccentric`, during LIFTING, quality 0.18)**. GRAB pressed again (button, API, Space) during DESCENDING / CLOSING / LIFTING: refused; exactly one result and at most one award per round; PLAY AGAIN twice starts one round. `06-outcomes` |
| 7 | Collection changes only after the chute sensor; no duplicates; demo rounds never count | **pass** | F | Counter is 0 at DESCENDING, CLOSING, LIFTING, TRANSPORTING and RELEASING; award and sensor happen in the same simulation step (1072) with the toy at y = −0.071 m inside the chute; exactly one award, one stored prize id. "Restart round" on the win card and with a toy in the air (TRANSPORTING): no credit. Theme switch: no re-credit; the next win is a new prize id; a reload restores the same collection. Demo: DEMO badge shown, a demo round that **won** left wins = 0 / attempts = 0 and showed no prize card; a player taking over mid-demo gets a normal round. `07-settlement` |
| 8 | — | **not covered** | — | No spec in this suite |
| 9 | Four themes change cabinet, characters, UI colours and music; a mid-round change is queued | **pass** | F | sakura `#ff8fb3` / storybook `#ff8a6b` / ocean `#6ab8e6` / cosmic `#9b7bff` primaries, four different accents and names; each theme: 18 toys of 6 of its own characters (no id shared between themes), music track = theme; the collection dialog lists 24 characters. Picked Cosmic during LIFTING: theme stays sakura, "pending" shown, the round ends with sakura toys, then the cabinet changes. Dialog text contrast (settings ×8 tabs, theme picker, collection, text on solid backgrounds): 0 texts below 3:1 in all four themes (after fixes 4–6). `09-themes` |
| 10 | Audio starts after START; volume / mute; track preview; honest output-device UI | **pass** (not heard) | F | `locked` before START; `running` after (AudioContext running, 44.1 kHz, real assets, no fallback synth), music = sakura. Master gain 0.8 → 0.3 as a live preview → 0 when muted → 0.8 after Cancel; music bus 0.55 → 0.2. Preview of the Ocean track plays on its own bus while the game keeps its track. Output device: `setSinkId` exists, the browser lists 0 outputs → the UI shows "The browser did not list any audio outputs." instead of a device list. Mute + Apply survives a reload. Nobody listened: there is no sound device here. `10-audio` |
| 11 | Settings: preview, cancel, apply, persistence, reset tab, export → import, garbage rejected, clamping | **pass** | F for the first two tests, E for the third | Preview changes the HUD while the stored value stays; Cancel and Escape restore; Apply stores (layout, gameplay, language → `zh-Hans`) and survives a reload; "Reset this tab" resets only that tab and only after Apply. Export: a 6410-byte download without PIN, device ids or anything key-like; import restores the values as a preview; invalid JSON, a foreign JSON, a version-99 file and an array are rejected with a message and change nothing; a hostile file is clamped (`moveSpeed 99 → 0.9`, `toyCount −5 → 6`, `aimTimeLimit 1e9 → 60`, `master 7 → 1`, `renderScale −50 → 0.35`, unknown enum → default, unknown section dropped, PIN not importable). Third test (E): corrupt stored settings are repaired at start; no settings tab shows a raw translation key. `11-settings` |
| 12 | No key / API unreachable / slow server: playable, local subtitles, never claims GPT | **pass** | E | No key: only `GET /api/ai/status` is called, connection `local`, 3 subtitles (first play, prize, tip) all marked "Local lines", the connection test answers "Not connected: The server has no OpenAI API key; local lines are in use". All `/api` requests aborted: same, playable, a round won. Fake slow server claiming a key: 2 line requests left hanging, the round was won in 3.8 s of wall time meanwhile, the subtitle is a local line, states seen `checking → error`, never `gpt`, the late fake answer never appears. Guide off: no subtitles. No key-like string in the page or in `localStorage`. `12-ai-offline` |
| 13 | Camera denied / absent → neutral view, status shown | **pass** | E | Before START: state `idle`, 0 camera requests. After START: `NotAllowedError: Permission denied` → `denied`; `NotFoundError: Requested device not found` → `no_device`. Each: one `getUserMedia({ video: {640×480 ideal, 30 fps, facingMode user}, audio: false })`, view source `neutral`, eye fixed at (0, 0.856, 2.698), chip shows the state with "… fixed view", a round is won, Settings → Camera shows "Fixed viewpoint"; test sliders report source `test` and never `tracking`; switching head tracking off shows `off`. `13-camera-denied`, `13-camera-fallback` |
| 14 | Synthetic camera: starts after START, off ends the track, on restarts | **pass** (camera lifecycle only) | E | Device `fake_device_0`, 640×480, video track only. Model and WASM load from this server; the GPU delegate is skipped on software WebGL, backend `worker-cpu`; 4 inferences at 238 ms each (≈1 per second here — not a performance figure). The test pattern has no face: 0 faces, state `searching`, view source `neutral` — the game does not pretend to track. Head tracking off: the track is `ended`, inference count stops; on: a new stream; Stop / Start buttons likewise. No request left the server, no request carried a body. **Face detection, tracking quality and calibration were not tested.** `14-camera-fake` |
| 15 | — | **not covered** | — | No spec in this suite |
| 16 | — | **not covered** | — | No spec in this suite |
| 17 | Test viewpoint changes the projection only; projection stays off-axis after resize and render-scale change | **pass** | E | Desktop and portrait 86". The four corners of the glass window project onto the four viewport corners for every eye position (largest error 6.7·10⁻¹⁶ NDC); P[8] = −2·ex/W, P[9] = −2·ey/H, P[0] = 2·ez/W, P[5] = 2·ez/H hold to 10⁻⁵; the camera never rotates. Desktop: neutral P[8] = 0; slider x = ±0.25 → P[8] = ∓0.93; y = 0.2 → P[9] −0.94 → −2.24; z = −0.3 → P[0] 2.34 → 1.28. Still exact and asymmetric after resizing the window (1280×720 → 1024×648) and after render scale 0.35 → 0.7 (3D buffer 448×252 → 896×504). HUD rectangles identical before / after; claw and all toy positions identical. Attract mode sways the viewpoint slowly; that sway is off-axis too. `17-viewpoint` |
| 18 | Graphics preset changed mid-round does not disturb the round | **pass** | E | During LIFTING: custom-low → Safe (3D buffer 960×540) → Medium (1280×720) as live preview: round id, phase, step count, all 18 toy poses, claw pose and physics object counts are **identical**. After Apply: 10 steps later, same toys, largest toy movement 3.76 cm (the toy being lifted), the round finishes with the same id and exactly one result. `18-graphics-midround` |
| 19 | Ten rounds + theme switches: resources return to the same level; hidden tab mid-round | **pass** | E | 10 rounds (7 won, 3 slipped) with sakura → ocean → cosmic → storybook → sakura: geometries 71 → 71 (max 72), textures 12 → 12, shader programs 40 throughout, rigid bodies 24, colliders 98 → 98, joints 3, 18 toys, JS heap 40 MB throughout. Hidden for 6 s during LIFTING: 0 steps while hidden, audio suspended; after returning 0.125 s (15 steps) in the first 3 frames — no catch-up of the 6 s; all poses finite and inside the cabinet, largest displacement 5.27 cm; the round ends with one result. `19-stability` |
| 20 | Screenshots of 3 layouts × 4 themes, a win card and the settings dialog per layout | **produced and reviewed** | see run record | 18 JPEGs, 95–209 KB, in `docs/screenshots/`. Defects seen are listed below. `20-screenshots` (skipped unless `PLUSH_SHOTS` is set) |

Items **8, 15 and 16** of the acceptance list have no spec in this browser
suite and are **not covered** here. Whatever they need (visual judgement of
plush softness, calibration with a real camera and person, performance on the
target hardware) cannot be established in this container; see "Verified here /
needs real hardware" in the README.

## Product defects found by these tests

### Fixed (small changes in `public/`, `src/ui/`, `src/app/`)

| # | Defect | Fix |
| --- | --- | --- |
| 1 | `index.html` referenced `/favicon.svg`, which did not exist → a 404 on every load | Added `public/favicon.svg` |
| 2 | Portrait 86": the theme chip in the top bar was a **button** at y = 0.03–0.045, outside the interactive zone 0.25–0.75 (the spec allows only the top-right "i" up there) | `src/ui/Hud.tsx`: where the top bar lies outside the interactive zone the chip is a plain label; themes open from the control panel |
| 3 | Settings → AI Guide → "Test connection" / "Preview voice" printed the raw placeholders, e.g. `Not connected: {detail} · The server has no OpenAI API key…` | `src/ui/settings/tabsB.tsx`: the detail is passed into the translated string (now `Not connected: The server has no OpenAI API key; local lines are in use`) |
| 4 | Cosmic (the dark theme): unselected segmented options, notes, inputs, selects, key/value boxes, theme cards and collection cards were **white text on white** (≈1.1:1) | `src/ui/hud.css`: light surfaces always use dark text |
| 5 | Cosmic: section headings, dialog titles and the direction arrows were drawn in the deep primary on dark surfaces (2.63:1) | `src/ui/hud.css`: these use the theme's light glow colour on Cosmic |
| 6 | Sakura / Storybook / Ocean: the selected tab and selected segmented option were white on the pastel primary (2.14 / 2.31 / 2.18:1) | `src/ui/hud.css`: selected states use the deep primary. Measured after the fix: no dialog text on a solid background below 3:1 in any theme |

Also added: read-only getters in the `?debug=1` API (`memory`, `bodies`, `audio`,
`guide`, `tracker`, `ui`, `settings`, `collection`) in `src/app/Game.ts`.

### Open (reported, not fixed)

| # | Where | Behaviour | Repro |
| --- | --- | --- | --- |
| A | `src/ai/GuideDirector.ts` `probe()` (`STATUS_TIMEOUT_MS = 4000`) | If the page is blocked for more than 4 s while it boots (here: software GL compiling shaders), the status request is aborted by its own timer although the server answered. The guide then says "AI server not reachable: local lines" and only asks again after 60 s. With a real key that means up to a minute of local lines after a slow start. Harmless without a key. | Headless Chromium, `/api/ai/status` answering `configured: true`, boot: `__plush.guide().status.detail` is "AI server not reachable…" until `probe(true)` |
| B | `src/app/AdaptiveQuality.ts` `STEPS` + `src/ui/settings/tabsA.tsx` (graphics note) | The "Auto optimiser active: …" note lists internal step ids (`particles, bloom, scale90, scale80, scale70, shadows`) instead of readable, translated labels, and lists every scale step instead of the current one | Preset Medium with Auto optimise on a slow machine, open Settings → Graphics |
| C | `src/ui/hud.css` `.pp-status` (desktop layout) | The status line below the play field has no backing or outline; on Cosmic the first words of "Tap START to play — it's free!" lie over the brightly lit prize chute and are nearly invisible | `docs/screenshots/desktop-cosmic-attract.jpg` |
| D | HUD control panel (`.pp-panel`) in both portrait layouts | The panel is translucent and sits in front of the cabinet's 3D front: the round "PLUSH PORTAL" badge is cut in half by the panel edge, and light strips / the round opening show through the panel as faint lines and rings | `docs/screenshots/portrait32-*-attract.jpg`, `portrait86-*-attract.jpg` |
| E | `src/ui/Hud.tsx` `DirButton` | Robustness note, not reproduced with real input: release relies on pointer capture. If `setPointerCapture` ever fails, a `pointerup` outside the button would not reach it and the direction would stay pressed until blur / pause. A window-level `pointerup` / `pointercancel` listener while pressed would close that gap. | Only with a synthetic sequence that releases the capture before the browser has established it |

## Visual review of the screenshots

`docs/screenshots/` holds 18 JPEGs (95–209 KB): `{desktop,portrait32,portrait86}-{sakura,storybook,ocean,cosmic}-attract.jpg`,
`…-win.jpg`, `…-settings.jpg`. Desktop is 1280×720, both portrait layouts are
1080×1920. Graphics preset **Medium** with the automatic optimiser switched off
(on software GL it would otherwise strip particles, bloom, shadows and lower
the 3D resolution, and the pictures would not show the preset). Rendered by
SwiftShader: anti-aliasing and timing differ on a real GPU; no claim is made
about how it looks on a physical 32" or 86" screen.

Every picture was looked at. What is right: the cabinet, glass, claw, prize
chute and the six characters of each theme are visible in all three layouts;
the four themes are clearly distinct in palette, wallpaper, decorations and
characters; the portrait 86" control panel sits in the middle band of the
screen with the toys above it; dialogs and the win card are inside that band;
the won toy is visible in the prize tray behind the win card.

Concrete defects seen:

1. **Desktop, Cosmic** — status line partly unreadable over the bright prize chute (open defect C).
2. **Portrait 32" and 86", all themes** — the 3D "PLUSH PORTAL" badge is half hidden behind the control panel; cabinet light strips and the round opening show through the translucent panel (open defect D).
3. **Portrait 86"** — the lower 40 % of the screen shows only the cabinet base (prize door, round opening). That keeps controls reachable, but a large part of the picture carries no play content.
4. **All layouts** — the attract-mode demo is not part of the pictures (they are taken before it starts); Momo has no speech bubble in attract mode.
5. **Win card, Cosmic** — the three `*-win.jpg` were taken while the card title used the light glow colour, which is weak against the bright centre of the card. The final stylesheet keeps the original deep purple for that title; the pictures were not retaken after that one-line change.
6. **Before the fixes above** the Cosmic settings dialog showed white-on-white option pills and an unreadable info box; the committed `*-settings.jpg` were retaken after the fix and are readable.

## Flakiness and timing

* No test failed intermittently once written correctly; there are no retries.
* Results that depend on grip tuning are written to tolerate re-tuning: a win is
  looked for over up to 8 centred grabs (the first grab won in every run so
  far), a slip over up to 16 off-centre grabs (found on the 7th in the last runs).
  If the physics is re-tuned so that centred grabs stop winning or nothing ever
  slips, these tests fail — which is the intent.
* The real-time, buttons-only aiming test depends on machine speed; it
  converged in 3–6 presses with 1.1–1.4 cm error here and takes longer on a loaded machine.
* Dialogs pop in with a 260 ms scale animation; measuring a rectangle before it
  ends gives a size 18 % too small. The helpers wait for finite animations (`settle`).
* `__bootDone` is set before the first frame is on screen; on software GL the
  first frames (shader compilation) can block the page for 10–25 s.
* Changes of the internal 3D resolution are applied at the start of the next
  rendered frame; the specs poll for them.

## Run record

| Build | Sources | When (UTC, 2026-11-24) |
| --- | --- | --- |
| **F** | The sources of commit `93094b4` (commit `c8b15d3` plus the `src/ui/hud.css` and `src/ui/settings/tabsB.tsx` fixes listed above) | `npm run e2e`, started 08:20:32 |
| **E** | The working tree between commits `94e3786` and `c8b15d3`, 07:10–07:45: fixes 1–3 present, grip tuning of `c8b15d3` possibly still in progress, **before** the `hud.css` contrast fixes 4–6 | single-file runs |

**Last full run (`npm run e2e`, build F): 27 passed, 13 failed, 3 skipped, 17.0 min.**

* The 27 passes are every test of `01-load`, `02-rounds`, `03-safe-zone`,
  `04-settings-dialog`, `05-input`, `06-outcomes`, `07-settlement`, `09-themes`,
  `10-audio` and the first two tests of `11-settings`.
* All 13 failures are `net::ERR_CONNECTION_REFUSED` on the first navigation:
  the test server on port 8799 stopped answering at about 08:36 while the run
  was in progress (the workspace was being changed by other work at that time;
  the cause was not established). They are the third test of `11-settings` and
  all of `12-ai-offline`, `13-camera-denied`, `13-camera-fallback`,
  `17-viewpoint`, `18-graphics-midround`, `19-stability` and `14-camera-fake`.
  **These specs were therefore not run against build F.** Each of them last
  passed in a single-file run against build E; the table above says so in the
  "Build" column. Build F differs from E in CSS colours and, possibly, grip
  tuning; none of these specs asserts colours, but a re-run on the final build
  is still owed.
* The 3 skipped tests are the screenshot tests (they only run with `PLUSH_SHOTS`).

Screenshots: the 12 attract and 3 win pictures come from a full screenshot run
at 07:57–08:13 (sources as build F except two later `hud.css` rules: the
selected-state colour of tabs / option pills, and the Cosmic win-card title
colour — see visual defect 5). The 3 settings pictures were retaken at
08:14–08:18 with the selected-state colour in place.

Unit tests (`npm test`) are not part of this file's runs; the coordinator's
last recorded figure for them is 39 files / 526 tests passing.
