# PLUSH PORTAL

> **中文简介** — PLUSH PORTAL 是一个在浏览器中运行的卡通 3D 抓娃娃机。爪子、绳索、娃娃全部由 Rapier 物理引擎以 120 Hz 固定步长真实模拟，抓取结果只取决于真实接触，没有隐藏的中奖概率。内置四个主题（樱花萌宠 / 动画伙伴 / 梦幻海洋 / 宇宙街机）共 24 个原创毛绒角色，支持桌面横屏、32 寸竖屏和 86 寸竖屏三种显示预设（86 寸预设把操作面板和所有对话框放在屏幕中部 25%–75% 的安全区内），默认开启基于摄像头头部追踪的“窗口透视”（离轴投影），并带有 AI 向导 Momo（通过服务端代理调用 OpenAI；没有密钥时自动使用本地台词）。摄像头画面与人脸关键点只在本机处理，不上传、不保存。
>
> 本仓库没有在真实的 7840HS / 780M 主机、32 寸或 86 寸实体屏、真实摄像头前的真人、或真实 OpenAI 密钥下做过验收，详见下文“Verified here / needs real hardware”。

PLUSH PORTAL is a browser claw machine: a cartoon 3D cabinet full of soft plush
toys, a three-finger claw on a cable, and nothing scripted about the outcome.
The claw, the cable and every toy are simulated in a
[Rapier](https://rapier.rs) world stepped at a fixed 120 Hz (the plush softness you see is a
deformation driven by the real contacts); a round is won only when the toy's
centre of mass physically passes the prize chute sensor.

- Four complete themes — Sakura Kawaii, Storybook Friends, Ocean Dream, Cosmic Arcade — and 24
  original plush characters (six per theme), each with three LODs, collision proxies and soft-body deformation data.
- Three display presets: **desktop** (landscape), **portrait32** (32" portrait
  touch screen) and **portrait86** (86" portrait kiosk whose control panel and dialogs sit in
  the central 25 %–75 % band of the screen).
- **Window Perspective**: an off-axis projection driven by local head tracking
  (MediaPipe Face Landmarker), so the screen behaves like a pane of glass in
  front of the cabinet. On by default; the game is fully playable without a camera.
- Four original music tracks, 54 sound-effect clips and two motor loops, all synthesised by tools in this repo.
- **Momo**, an AI guide that comments on the game through a server-side OpenAI
  proxy, with a complete local fallback (lines + "babble" voice) when no key is configured.
- An eight-tab settings dialog (draft → preview → apply / cancel), import/export, public-display lock.
- English, 简体中文 and 日本語 UI.

## Quick start

Requires Node.js ≥ 20.19 and a browser with WebGL 2.

```bash
cd plush-portal
npm install
cp .env.example .env      # optional: add OPENAI_API_KEY for the cloud guide
npm run dev               # http://127.0.0.1:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `127.0.0.1:5173` **and** the API server (`tsx watch server/index.ts`) on `127.0.0.1:8787`; Vite proxies `/api` to it. |
| `npm run build` | `tsc` type-check, then a production build into `dist/`. |
| `npm start` | Serves `dist/` and the API from one process on `http://127.0.0.1:8787` (`tsx server/index.ts --serve-dist`). Run `npm run build` first. |
| `npm run preview` | Vite's static preview of `dist/` on `127.0.0.1:4173` (start `npm run dev:api` next to it for `/api`). |
| `npm run dev:web` / `npm run dev:api` | The two halves of `npm run dev` on their own. |

`predev`, `prebuild` and `prestart` run `tools/fetch-tracking-assets.mjs`: it
copies the MediaPipe WASM runtime from `node_modules` into the git-ignored
`public/mediapipe/wasm/` and verifies the committed face model
(`public/mediapipe/models/face_landmarker.task`, SHA-256 pinned, downloaded
again only if it is missing or corrupt). Nothing is loaded from a CDN at run time.

Ports: the API port is `PLUSH_API_PORT` (default 8787). If you change it,
export it in the shell as well — the Vite proxy reads the shell environment, not `.env`.
To serve other devices on the LAN set `PLUSH_API_HOST=0.0.0.0`. Camera access
needs a secure context: `localhost` / `127.0.0.1` or HTTPS.

### Launch parameters

| Parameter | Values | Effect |
| --- | --- | --- |
| `?display=` (alias `?profile=`) | `desktop` \| `portrait32` \| `portrait86` | Selects the display preset and remembers it (skips the first-run chooser). |
| `?theme=` | `sakura` \| `storybook` \| `ocean` \| `cosmic` | Starting theme. |
| `?lang=` | `en` \| `zh` \| `ja` | UI language. |
| `?quality=` | `safe` \| `medium` \| `high` \| `ultra` | Applies a graphics preset. |
| `?camera=off` | | Never asks for the camera in this session. |
| `?seed=` | integer | Fixed toy layout (repeatable tests). |
| `?debug=1` | | Exposes `window.__plush` (state, fast-forward, log) for tests and tools. |

Kiosk example: `http://127.0.0.1:8787/?display=portrait86&lang=zh`.

## Controls

| Input | Action |
| --- | --- |
| On-screen direction pad (touch / mouse, hold) | Move the claw |
| Arrow keys or `W` `A` `S` `D` | Move the claw |
| Big button, `Space` or `Enter` | **START** → **GRAB** → **PLAY AGAIN** |
| `F` | Toggle full screen |
| `Esc` | Close the open dialog (settings: same as Cancel) |

A round: *start → aim → grab*. The claw descends until it lands, closes, lifts,
carries whatever it holds to the chute at the front-left, opens and returns.
After a miss the next round is ready about a second later. With nobody playing,
the machine runs a demo round by itself (can be switched off).

## Feature overview

| Area | Summary | Details |
| --- | --- | --- |
| Physics & rules | 120 Hz fixed step, cable as a one-sided spring, motorised fingers, real contacts, slip reasons, idempotent prize award. | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PHYSICS.md](docs/PHYSICS.md) |
| Characters & assets | Procedural SDF modelling → GLB (meshopt) + `manifest.json`; in-app GLB import per character slot. | [docs/ASSETS.md](docs/ASSETS.md) |
| Display presets | Normalised layout solver, safe zone, panel anchor, per-preset settings. | [docs/DISPLAYS.md](docs/DISPLAYS.md) |
| Window Perspective | Off-axis frustum from the tracked eye position; quick calibration. | [docs/CALIBRATION.md](docs/CALIBRATION.md), [docs/DISPLAYS.md](docs/DISPLAYS.md) |
| Settings | Eight tabs, 100+ settings, presets, import/export, lock. | [docs/SETTINGS.md](docs/SETTINGS.md) |
| Graphics tiers | Safe / Medium / High / Ultra + automatic optimiser. | [docs/PERFORMANCE.md](docs/PERFORMANCE.md) |
| Audio | Four original tracks, SFX, motor loops, ducking, fallback synthesiser. | [docs/AUDIO.md](docs/AUDIO.md) |
| AI guide | Server proxy, structured lines, speech, local fallback, rate limits. | [docs/AI.md](docs/AI.md) |
| Test results | What the automated suites cover and their last recorded run. | [docs/E2E_RESULTS.md](docs/E2E_RESULTS.md) |

## AI guide configuration

The OpenAI key is read **only** by the API server from the environment / `.env`:

```bash
# .env  (never committed)
OPENAI_API_KEY=sk-...
```

It is never sent to the browser, never stored in `localStorage`, never placed in
a URL, never logged and never exported with the settings. Without a key the
server still runs: `/api/ai/status` reports `configured: false`, the AI routes answer
`no_key`, and Momo uses her built-in lines and local voice; the settings dialog then shows "Local lines".
Model names, the two speech interfaces, rate limiting and the public-deployment
options are documented in [docs/AI.md](docs/AI.md) and `.env.example`.

## Regenerating assets

All shipped assets are produced by scripts in this repository; the outputs are
committed, so none of these steps is needed to run the game.

| Command | Output |
| --- | --- |
| `npm run assets:plush` | `public/assets/plush/<theme>/<slug>.glb` + `public/assets/plush/manifest.json` from `tools/plush/designs/*.ts` |
| `npm run assets:audio` | Music, SFX and `public/audio/manifest.json` from `tools/audio/bake.ts`. MP3 music needs `ffmpeg` with libmp3lame on the PATH; `npm run assets:audio -- --music-format wav` works without it. |
| `npm run assets:tracking` | MediaPipe WASM copy + face model check (same script as `predev`) |
| `npm run assets` | All three of the above |

How to add or replace a character: [docs/ASSETS.md](docs/ASSETS.md).

## Tests

```bash
npm test          # Vitest unit tests (tests/unit): round state machine, fixed-step loop,
                  # simulation/rendering independence, layout solver, window geometry,
                  # settings, off-axis projection, tracking, audio, AI guide, API server, i18n
npm run e2e       # Playwright (tests/e2e): builds, serves dist + API on :8799,
                  # drives the real game in headless Chromium
```

The end-to-end suite runs in headless Chromium with software WebGL
(SwiftShader), where a frame can take seconds; it therefore advances game time
through the `?debug=1` API instead of waiting on the clock, and it never talks
to OpenAI (`OPENAI_API_KEY` is forced empty). Coverage and the last recorded
results are in [docs/E2E_RESULTS.md](docs/E2E_RESULTS.md).

## Project layout

| Path | Contents |
| --- | --- |
| `index.html`, `src/main.tsx` | Entry point |
| `src/app/` | Composition root (`Game.ts`), bootstrap, UI store, launch parameters, presets, automatic optimiser, demo pilot |
| `src/core/` | Shared types, event emitter, maths, the audio / guide / tracker port contracts |
| `src/game/` | `GameCore`, round state machine, round controller, toy field — no DOM, no rendering |
| `src/physics/` | Rapier world, claw rig, grip monitor, field dimensions |
| `src/plush/` | Manifest types, GLB loading, plush material and deformation, custom model import |
| `src/scene/` | Renderer and post-processing (`Stage`), cabinet, claw and toy visuals, effects, procedural textures |
| `src/themes/` | The four theme definitions |
| `src/perspective/` | Off-axis projection, virtual window geometry |
| `src/tracking/` | Camera, MediaPipe inference (worker or main thread), eye estimation, filtering, calibration |
| `src/layout/` | HUD layout solver |
| `src/settings/` | Settings specification and store |
| `src/ui/` | React HUD, dialogs and the settings dialog |
| `src/audio/` | Web Audio engine, fallback synthesiser |
| `src/ai/` | Guide director, prompt, local lines, speech, cache |
| `src/i18n/` | Strings (en / zh / ja) |
| `src/persistence/`, `src/diagnostics/` | Local storage helpers, collection, redacted in-memory log |
| `server/` | Hono API server: OpenAI proxy, validation, rate limiting, static hosting of `dist/` |
| `tools/plush/` | SDF modelling DSL, mesher, GLB writer, character designs |
| `tools/audio/` | Music and SFX synthesis |
| `tools/dev/` | Headless probes and screenshot helpers used during development |
| `public/assets/plush/`, `public/audio/`, `public/mediapipe/` | Baked characters, audio, face model |
| `tests/unit/`, `tests/e2e/` | Vitest and Playwright suites |
| `docs/` | Documentation listed above |

`viewer.html` is a development-only asset viewer
(`/viewer.html?theme=sakura`); it is not linked from the game.

## Privacy

- **Camera**: video only (`audio: false`; the microphone is never requested).
  Frames and face landmarks are processed on the device by a local WASM model;
  they are never uploaded, recorded or stored, and never sent to the AI guide.
  The only tracking data that is persisted is the calibration (a depth constant
  and a neutral position per display preset). MediaPipe's usage logging is switched off and the
  inference worker refuses every request to another origin.
- **AI guide**: only game facts leave the device (event type, theme, toy name,
  result, language) and only to your own API server, which forwards them to OpenAI when a key is configured.
- **Storage**: settings and the prize collection live in `localStorage`;
  imported custom models live in IndexedDB. Nothing is sent to a server.
- **Exports**: the configuration export contains settings only — no keys, no
  PIN, no camera images, no face data, no collection.
- **Logs**: the diagnostic log is kept in memory and redacted; the server log never contains keys or full prompts.

## Verified here / needs real hardware

Everything in this repository was developed and tested in a cloud container:
headless Chromium with **software** WebGL (SwiftShader), four shared CPU cores,
no GPU, no camera, no display, no OpenAI key.

What that environment can show (see [docs/E2E_RESULTS.md](docs/E2E_RESULTS.md)
and the unit tests): the game logic and physics, the layout rules at the three
preset viewport sizes, the settings flow, the fallbacks, the server proxy
against a mocked OpenAI client, and the tracking mathematics on synthetic input.

What it **cannot** show, and what is therefore **not verified**:

| Not verified | Why | How to verify |
| --- | --- | --- |
| Frame rate on a Ryzen 7 7840HS / Radeon 780M (or any real GPU) | No such machine was available. The quality tiers are engineering starting budgets, not measurements. | [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — measurement checklist |
| Look, reach and readability on a physical 32" or 86" portrait screen | Only browser viewports of the same pixel shape were used. A viewport proves layout, not ergonomics or viewing comfort. | [docs/DISPLAYS.md](docs/DISPLAYS.md) |
| Head tracking and Window Perspective with a real camera and a real person | Only synthetic input was used: generated landmarks in the unit tests and, at most, Chromium's fake camera test pattern in the end-to-end suite. Mouse or slider input is not camera validation. | [docs/CALIBRATION.md](docs/CALIBRATION.md) |
| Live OpenAI text and speech | No API key was available. The default model names were checked against the installed OpenAI SDK's type definitions only, never against the live API. | [docs/AI.md](docs/AI.md) |
| Touch input on real touch hardware, audio output devices, Safari and Firefox | Only Chromium with synthetic pointer events was used. | Manual pass |

Other known limitations:

- The automatic optimiser ignores frames longer than 250 ms (so that shader
  compilation hitches do not trigger it); on a machine that is *that* slow it does nothing — pick the Safe preset by hand.
- In `window` mode (desktop preset) the physical size and position of the browser
  window are estimated from CSS pixels, so the perspective is approximate; kiosk presets assume full screen.
- GPU time is not shown in the performance panel (WebGL 2 timer queries are not used); it shows frame time, physics time, draw calls and triangles.
- Imported `.glb` models are static meshes; they keep the collision shape and weight of the slot they replace. Draco-compressed files are rejected.
- The settings lock PIN is a convenience for public displays, not a security boundary: it is stored in the browser.
- `sakura.biribi` is an original character in a slot marked *replaceable*; no third-party or licensed character ships with this project.

## Licences and provenance

| Item | Origin | Licence |
| --- | --- | --- |
| Game code, tools, 24 plush characters, cabinet art, textures | Original work in this repository; characters are generated by `tools/plush`, textures procedurally at run time | — (project is `private`; no licence file is included) |
| Music (4 tracks), 54 sound-effect clips, 2 motor loops | Original, synthesised by `tools/audio/bake.ts` | as above |
| Fonts: Fredoka, M PLUS Rounded 1c, Noto Sans SC, ZCOOL KuaiLe | `@fontsource-variable/fredoka`, `@fontsource/m-plus-rounded-1c`, `@fontsource/noto-sans-sc`, `@fontsource/zcool-kuaile` (bundled, no web requests) | SIL Open Font License 1.1 |
| Face Landmarker model + WASM runtime | `@mediapipe/tasks-vision` 1.2.3 and Google's `face_landmarker.task` | Apache-2.0 |
| Physics | `@dimforge/rapier3d-compat` 0.21 | Apache-2.0 |
| Rendering | `three` 0.187 | MIT |
| UI / state / validation / server | `react` 19, `zustand`, `zod`, `hono` | MIT |
| OpenAI client (server only) | `openai` | Apache-2.0 |
| Asset pipeline (build time only) | `meshoptimizer`, `@gltf-transform/*` | MIT |

No third-party characters, music or sound recordings are included.
