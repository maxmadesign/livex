# PLUSH PORTAL

> **中文简介** — PLUSH PORTAL 是一个在浏览器中运行的卡通 3D 抓娃娃机。爪子、绳索、娃娃全部由 Rapier 物理引擎以 120 Hz 固定步长真实模拟，抓取结果只取决于真实接触，没有隐藏的中奖概率。内置五个主题（樱花萌宠 / 动画伙伴 / 梦幻海洋 / 宇宙街机 / 显卡派对）共 31 个原创毛绒角色，每个角色都有用 Higgsfield 生成的高细节贴图模型；带稀有度、连击和积分系统；无人操作时自动回到演示模式并显示“点击开始”。音乐、音效和每个角色自己的声音来自 Higgsfield 生成的录音（加载失败时使用项目内合成的备用音频）。支持桌面横屏、32 寸竖屏、86 寸竖屏和手机四种显示预设（86 寸预设把操作面板和所有对话框放在屏幕中部 25%–75% 的安全区内；在非 9:16 的窗口里，竖屏预设会在居中的 9:16 区域内模拟真实屏幕），默认开启基于摄像头头部追踪的“窗口透视”（离轴投影，带倒计时校准），并带有 AI 向导 Momo（通过服务端代理调用 OpenAI，密钥来自 `.env`，也可在设置中替换；没有密钥时自动使用本地台词）。摄像头画面与人脸关键点只在本机处理，不上传、不保存。
>
> 除经典抓娃娃机外，柜体还可以变成另外三台机器：摇摇桥（把架在两根杆上的奖品箱一点点推下去）、翻落货架（5 次机会把货架上的零食盒推进出口，掉落 5 盒得奖）和闪耀冲刺（75 秒限时抓宝石，总价值达到 700 得奖，并有本机前 10 名排行榜）。玩家在机器大厅中切换；奖品同样只由物理结果决定，每个奖品只有一个领奖码，演示回合永远不发码。
>
> 本仓库没有在真实的 7840HS / 780M 主机、32 寸或 86 寸实体屏、真实手机、真实摄像头前的真人上做过验收，也没有人实际听过音频，详见下文“Verified here / needs real hardware”。

PLUSH PORTAL is a browser claw machine: a cartoon 3D cabinet full of soft plush
toys, a three-finger claw on a cable, and nothing scripted about the outcome.
The claw, the cable and every toy are simulated in a
[Rapier](https://rapier.rs) world stepped at a fixed 120 Hz (the plush softness you see is a
deformation driven by the real contacts); a round is won only when the toy's
centre of mass physically passes the prize chute sensor.

- **Five complete themes** — Sakura Kawaii, Storybook Friends, Ocean Dream, Cosmic Arcade and **GPU Party**
  (black-and-lime tech party: a twin-fan card, a chip, a fan, a server rack, a robot, a pixel cube and the
  Keynote Chief) — with **31 original plush characters** (six per theme, seven for GPU Party).
  *GPU Party is an original theme: no real company, brand, logo, product name or person is used; its emblem
  (`public/assets/themes/gpu/logo.svg`) is an original drawing that only an owner with permission may replace with
  an official logo, and the guide is told never to name real companies, products or people. The generated model of
  the Keynote Chief reads closer to a recognisable public figure than its design — whoever ships the assets decides
  whether that likeness is acceptable ([ASSETS.md](docs/ASSETS.md#textured-ai-generated-models)).*
- **AI-generated, high-detail plush models.** Every character is drawn with a textured model generated with
  Higgsfield (concept image, then image-to-3D) from its original procedural design: about 41k / 12k / 4k triangle
  LODs and PBR textures (512 / 1K / 2K, following *Graphics → Textures*). Collision shapes, mass and the fallback
  model still come from the procedural design. Provenance (job ids, raw-file hash) and the licence note are in the
  manifest and in *Settings → Themes & Toys*: **check Higgsfield's current terms** (ownership and commercial use depend
  on the account plan) before distributing them.
- **Studio music, effects and character voices.** Each theme plays two ~2-minute studio music takes cross-faded on
  the beat, tier-aware win stingers and a jackpot fanfare, a dramatic effect layer (coin, claw, chute, fireworks,
  confetti, combo, score count-up, restock rain, attract chime, …) and **the characters' own voices** when they are
  lifted, win or slip (all 31 have a recorded voice; a character whose recording is missing or fails to load
  squeaks at its own pitch instead). These are AI-generated through Higgsfield (music: ElevenLabs Music v2.5; effects and voices:
  Mirelo text-to-audio) — **check the Higgsfield / ElevenLabs (and Mirelo) terms before commercial use**
  ([AUDIO.md](docs/AUDIO.md)). An original synthesised set made by tools in this repo (five music tracks, 70 one-shots,
  two motor loops) is the complete fallback for anything that does not load.
- **Points, rarity and combos.** Every character has a rarity (common 100 · rare 250 · epic 500 · legendary 1000
  points); first catches, clean grabs and win streaks (×1.5 / ×2 / ×3) add more; the effects, light show and win
  sound escalate with the tier. Best session and lifetime points are kept on the device. Presentation only — the
  physics decides every round.
- **Four machines in one cabinet.** Besides the classic claw (*Plush Classic*), players pick in the **machine
  lobby** (the MACHINES button): **Tippy Bridge** (a printed prize box across two bars over a pit: lift one end
  per try until it drops through), **Tumble Shelf** (5 tries to knock snack boxes off a shelf; 5 boxes in one
  session win a plush) and **Sparkle Rush** (a 75 s run grabbing gems and coins; a gem value of 700 wins a plush,
  a local top-10 board with three initials). The three show a session HUD (tries, clock, progress); every machine
  keeps its own points and best score; one machine a day earns ×1.5 points (*today's pick*); machines can unlock
  with collected prizes. The physics decides every outcome on every machine, and every prize gets exactly one
  claim code ([docs/machines/](docs/machines/), [REWARDS.md](docs/REWARDS.md#which-machine-gives-what)).
- **Idle reset and a self-playing attract mode.** After `system.idleSeconds` (default 60 s) without input the
  machine resets (dialogs closed, session cleared) and plays clearly labelled demo rounds with a large
  **TAP TO PLAY** call to action; a tap takes over at once.
- Four display presets: **desktop** (landscape), **portrait32** (32" portrait touch screen), **portrait86** (86"
  portrait kiosk whose control panel and dialogs sit in the central 25 %–75 % band of the screen) and **mobile**
  (phones, held sideways or upright, thumb-sized controls, full screen on the first tap). In a browser window of
  another shape the two portrait presets **simulate their 9:16 screen** in a centred box, laid out and projected
  exactly as on the real panel.
- **Window Perspective**: an off-axis projection driven by local head tracking
  (MediaPipe Face Landmarker), so the screen behaves like a pane of glass in
  front of the cabinet, with a **3-2-1 countdown calibration** that takes the player's current position and head
  direction as the centre (automatic when the camera starts). On by default; the game is fully playable without a camera.
- Particle effects, a rarity aura and a light show (at most two extra draw calls), per-theme studio lighting,
  contact shadows and detailed cabinet materials, scaled by four graphics tiers.
- **Momo**, an AI guide that comments on the game through a server-side OpenAI
  proxy, with a complete local fallback (lines + "babble" voice) when no key is configured. The key comes from
  `.env` and can be replaced in *Settings → AI Guide* (stored on the server, never in the browser). Momo speaks
  English by default; *Guide speaks → Interface language* follows the UI.
- **HTTPS for phones on the LAN** (`npm run start:https` / `npm run dev:https`, self-signed certificate) so a phone's
  browser allows the camera.
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

No `.env`? You can also paste a key in *Settings → AI Guide → OpenAI API key* (stored server-side in
`.data/secrets.json`; *Restore default* goes back to `.env`).

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `127.0.0.1:5173` **and** the API server (`tsx watch server/index.ts`) on `127.0.0.1:8787`; Vite proxies `/api` to it. |
| `npm run build` | `tsc` type-check, then a production build into `dist/`. |
| `npm start` | Serves `dist/` and the API from one process on `http://127.0.0.1:8787` (`tsx server/index.ts --serve-dist`). Run `npm run build` first. |
| `npm run preview` | Vite's static preview of `dist/` on `127.0.0.1:4173` (start `npm run dev:api` next to it for `/api`). |
| `npm run dev:web` / `npm run dev:api` | The two halves of `npm run dev` on their own. |
| `npm run dev:https` | Vite over HTTPS on `0.0.0.0:5173` (self-signed certificate in `.data/tls`) plus the API, for phones on the LAN. |
| `npm run start:https` | `npm start` plus HTTPS on `:8443` (`PLUSH_HTTPS_PORT`). Phone steps: [docs/AI.md](docs/AI.md#https-for-phones-on-the-lan). |

`predev`, `prebuild`, `prestart` (and their `:https` variants) run `tools/fetch-tracking-assets.mjs`: it
copies the MediaPipe WASM runtime from `node_modules` into the git-ignored
`public/mediapipe/wasm/` and verifies the committed face model
(`public/mediapipe/models/face_landmarker.task`, SHA-256 pinned, downloaded
again only if it is missing or corrupt). Nothing is loaded from a CDN at run time.

Ports: the API port is `PLUSH_API_PORT` (default 8787), set in `.env` or the
shell; the server and the Vite proxy both read it.
To serve other devices on the LAN set `PLUSH_API_HOST=0.0.0.0`. Camera access
needs a secure context: `localhost` / `127.0.0.1` or HTTPS (`npm run start:https`).
Outbound calls honour `HTTPS_PROXY` / `NO_PROXY` and `NODE_EXTRA_CA_CERTS` / `SSL_CERT_FILE` without flags.

### Launch parameters

| Parameter | Values | Effect |
| --- | --- | --- |
| `?display=` (alias `?profile=`) | `desktop` \| `portrait32` \| `portrait86` \| `mobile` | Selects the display preset and remembers it (skips the first-run chooser). |
| `?theme=` | `sakura` \| `storybook` \| `ocean` \| `cosmic` \| `gpu` | Starting theme. |
| `?lang=` | `en` \| `zh` \| `ja` | UI language. |
| `?quality=` | `safe` \| `medium` \| `high` \| `ultra` | Applies a graphics preset. |
| `?camera=off` | | Never asks for the camera in this session. |
| `?seed=` | integer | Fixed toy layout (repeatable tests). |
| `?machine=` | `classic` \| `bridge` \| `shelf` \| `rush` | The home machine for this page load: attract mode plays it and the idle reset returns to it. Never saved; an unknown value is ignored, and *Settings → Game → Machines → Home machine* applies again on the next load. |
| `?debug=1` | | Exposes `window.__plush` (state, fast-forward, log, score, attract) for tests and tools. Every call except `attract()` counts as player input for the idle reset. |
| `?debug=1&insets=` | `top,right,bottom,left` (CSS px) | Pretends the screen has cut-outs (notch, home indicator) — Playwright cannot emulate them. |
| `?models=procedural` | | Draws the procedural models instead of the textured AI-generated ones (comparison, troubleshooting). |

Kiosk example: `http://127.0.0.1:8787/?display=portrait86&lang=zh` (add `&machine=rush` to open on Sparkle Rush).

### GTC booth in five steps

1. Put the official artwork into `public/assets/brand/gtc/` (`gtc-logo.svg`, optional `nvidia-logo.svg` and the
   NVIDIA Sans `.woff2` files), then `npm run build`. Without them an original placeholder wordmark is shown
   ([docs/BRAND.md](docs/BRAND.md)).
2. `npm start` on the kiosk PC. Prize codes are on by default; the claim page for visitors' phones listens on
   port 8788 of the PC's LAN address. Connect the PC to the network the visitors' phones use, or set
   `PLUSH_CLAIM_PUBLIC_URL` / a claim link ([docs/REWARDS.md](docs/REWARDS.md)).
3. Open `http://127.0.0.1:8787/?display=portrait86&theme=gpu` in full screen (`F`).
4. *Settings → Rewards*: discount wording, swag store link, and check that *Who can open it* says *Phones on this
   network*. **Preview card**, then scan its QR code with a phone to confirm the page opens.
5. Staff redeem codes on `http://127.0.0.1:8787/staff/rewards` (on the kiosk, or anywhere with the admin token).

All four machines are offered in the lobby by default, and each gives claim codes in the GPU theme: one per
won plush or bridge box, one per Tumble Shelf session or Sparkle Rush run that reaches its prize line
([docs/REWARDS.md](docs/REWARDS.md#which-machine-gives-what)). To run a single machine, set *Settings → Game →
Machines → Home machine* (or add `&machine=…` to the URL in step 3) and switch *Machine lobby* off.

## Controls

| Input | Action |
| --- | --- |
| On-screen direction pad (touch / mouse, hold) | Move the claw |
| Arrow keys or `W` `A` `S` `D` | Move the claw |
| Big button, `Space` or `Enter` | **START** → **GRAB** → **PLAY AGAIN** |
| **TAP TO PLAY** (attract mode) | Same as START: stops the demo and starts a round |
| **MACHINES** (control panel menu) | Opens the machine lobby between tries: ◀ ▶ (or arrow keys, a swipe) to browse, PLAY / `Enter` to switch, `Esc` to close |
| **Call staff** (Tippy Bridge) | Puts a stuck box back on the bars (never a win) |
| Buttons **1** and **2** (Tippy Bridge, *Two buttons* controls) | Hold 1 to move right, then hold 2 to move back; letting go of 2 drops the claw |
| ▲ ▼ ◀ ▶, letters, `Enter` (Sparkle Rush top-10 run) | Enter three initials |
| `F` | Toggle full screen |
| `Esc` | Close the open dialog (settings: same as Cancel) |

A round: *start → aim → grab*. The claw descends until it lands, closes, lifts,
carries whatever it holds to the chute at the front-left, opens and returns.
After a miss the next round is ready about a second later. The first time START
is pressed on a device a short how-to-play card is shown (*Show how-to-play on first start*).
A won prize scores points by its rarity; the session score, combo and best session are shown next to the top bar
(beside the control panel on 86").

With nobody playing, the machine is in **attract mode**: it plays clearly labelled demo rounds by itself (DEMO badge
and a separate DEMO score that is never stored; *Demo when idle* switches them off), with a light show, a soft
chime every 20–30 s and a large **TAP TO PLAY** call to action in the middle of the reachable area. When a player
walks away, *Reset after no input* (`system.idleSeconds`, default 60 s, 0 = never) brings the machine back there:
open dialogs close, the session score is cleared and the field is restocked.

## Feature overview

| Area | Summary | Details |
| --- | --- | --- |
| Physics & rules | 120 Hz fixed step, cable as a one-sided spring, motorised fingers, real contacts, slip reasons, idempotent prize award. | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PHYSICS.md](docs/PHYSICS.md) |
| Points & attract mode | Rarity tiers, scoring, combos, idle reset, demo rounds, call to action. | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SETTINGS.md](docs/SETTINGS.md#1-game) |
| Machines | Plush Classic, Tippy Bridge, Tumble Shelf, Sparkle Rush: the lobby, sessions (open, 5 tries, 75 s), session prizes with one claim code, the Sparkle Rush top 10 with initials, today's pick ×1.5, unlock by prizes, attract mode on the home machine (optionally visiting every machine), `?machine=`. Classic is bit-identical to before (golden trace). | [docs/machines/](docs/machines/), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#machines), [docs/SETTINGS.md](docs/SETTINGS.md#machines), [docs/design/machines.md](docs/design/machines.md) |
| Characters & assets | Procedural SDF modelling → GLB (meshopt) + `manifest.json` (collision proxies, mass, fallback); textured AI-generated models imported with `npm run assets:import`; any character slot also accepts an ordinary `.glb`, through the manifest or by in-app import. | [docs/ASSETS.md](docs/ASSETS.md) |
| Display presets | Normalised layout solver, safe zone, panel anchor, per-preset settings, phone layout, simulated 9:16 screen. | [docs/DISPLAYS.md](docs/DISPLAYS.md) |
| Window Perspective | Off-axis frustum from the tracked eye position; countdown calibration, head-turn effect, distance calibration. | [docs/CALIBRATION.md](docs/CALIBRATION.md), [docs/DISPLAYS.md](docs/DISPLAYS.md) |
| Settings | Nine tabs, 100+ settings, presets, import/export, lock. | [docs/SETTINGS.md](docs/SETTINGS.md) |
| Graphics tiers | Safe / Medium / High / Ultra + automatic optimiser; environment lighting, effects and light show. | [docs/PERFORMANCE.md](docs/PERFORMANCE.md) |
| Audio | Studio music play-lists, win stingers, character voices and effects; the synthesised fallback set; ducking. | [docs/AUDIO.md](docs/AUDIO.md) |
| AI guide | Server proxy, replaceable key, structured lines, speech, local fallback, rate limits, HTTPS for phones; a GTC booth-host persona in the GTC theme. | [docs/AI.md](docs/AI.md) |
| GTC brand kit | The gpu theme as an NVIDIA GTC booth: brand palette, LED wall with the event logo, branded loading / attract / win screens. Official logos and font are drop-in files (an original placeholder until then); a neutral kit for public copies. | [docs/BRAND.md](docs/BRAND.md) |
| Prize claims | After a real win the card shows a QR code; visitors scan it to collect the plush at the booth or take a swag discount. One-time codes issued by the kiosk's server, claim page on the LAN, staff page to redeem. | [docs/REWARDS.md](docs/REWARDS.md) |
| Test results | What the automated suites cover and their last recorded run. | [docs/E2E_RESULTS.md](docs/E2E_RESULTS.md) |

## AI guide configuration

The OpenAI key is read by the API server from the environment / `.env`:

```bash
# .env  (never committed)
OPENAI_API_KEY=sk-...
```

The browser only ever sends a replacement key once (*Settings → AI Guide → OpenAI API key*); the server
stores it in the git-ignored `.data/` folder and never sends a key back — the page only sees where the key in use
comes from and its last four characters. By default only a browser on the server machine (or one with
`PLUSH_ADMIN_TOKEN`) may replace it (`PLUSH_KEY_MANAGEMENT`). A key is never stored in `localStorage`, never placed in
a URL, never logged and never exported with the settings. Without a key the
server still runs: `/api/ai/status` reports `configured: false`, the AI routes answer
`no_key`, and Momo uses her built-in lines and local voice; the settings dialog then shows "Local lines".
Model names, the two speech interfaces, rate limiting and the public-deployment
options are documented in [docs/AI.md](docs/AI.md) and `.env.example`.

## Regenerating assets

All shipped assets are produced by scripts in this repository, or — for the AI-generated models and studio
recordings — processed by them from generator output that is not part of the repository; the outputs are
committed, so none of these steps is needed to run the game.

| Command | Output |
| --- | --- |
| `npm run assets:plush` | `public/assets/plush/<theme>/<slug>.glb` + `public/assets/plush/manifest.json` from `tools/plush/designs/*.ts` (procedural models, collision proxies, mass) |
| `npm run assets:import -- --raw <dir>` | Imports Higgsfield-generated GLBs (`<dir>/<theme>.<slug>.glb`, not part of the repo) as textured models: `<slug>.gen.glb` + WebP textures and `model.textured` / `source` in the manifest ([ASSETS.md](docs/ASSETS.md#textured-ai-generated-models)) |
| `npm run assets:audio` | The synthesised music, SFX and `public/audio/manifest.json` from `tools/audio/bake.ts` (keeps the manifest's `studio` section). MP3 music needs `ffmpeg` with libmp3lame on the PATH; `npm run assets:audio -- --music-format wav` works without it. |
| `npx tsx tools/audio/importStudio.ts --src <dir>` | Processes downloaded studio recordings into `public/audio/studio/` and the manifest's `studio` section (needs ffmpeg) ([AUDIO.md](docs/AUDIO.md)) |
| `npm run assets:tracking` | MediaPipe WASM copy + face model check (same script as `predev`) |
| `npm run assets` | `assets:plush`, `assets:audio` and `assets:tracking` (not the two imports, which need the generated source files) |

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
to OpenAI: the server it starts has `OPENAI_API_KEY` empty, `PLUSH_KEY_MANAGEMENT=off` (a key saved in
Settings on this machine is ignored) and a fresh temporary `PLUSH_DATA_DIR`. `PLUSH_E2E_PORT` and
`PLUSH_E2E_DIST` move it to another port / build folder; a server already answering on that port is reused.
Run one spec with `npx playwright test tests/e2e/<file>`. Coverage and the last recorded
results are in [docs/E2E_RESULTS.md](docs/E2E_RESULTS.md).

Machines have two more headless checks (Node, no browser):

```bash
npx tsx tools/dev/golden-classic.ts --check              # classic replays its recorded trace bit for bit
npx tsx tools/dev/machine-sweep.ts --machine bridge      # fairness gates of a machine (bridge | shelf | rush),
                                                         # --difficulty all, --perf; exit 1 on a failed gate
```

## Project layout

| Path | Contents |
| --- | --- |
| `index.html`, `src/main.tsx` | Entry point |
| `src/app/` | Composition root (`Game.ts`), bootstrap, UI store, launch parameters, presets, automatic optimiser, demo pilot; `MachineDirector` and `MachinePilot` (machines) |
| `src/core/` | Shared types, event emitter, maths, the audio / guide / tracker port contracts |
| `src/game/` | `GameCore`, round state machine, round controller, toy field, rarity, scoring, idle timer and attract director — no DOM, no rendering; `machines/`: the machine registry, the bridge, shelf and rush genres, play sessions, today's pick |
| `src/physics/` | Rapier world, claw rig, grip monitor, field dimensions |
| `src/plush/` | Manifest types, GLB loading (textured and procedural models), plush material and deformation, custom model import |
| `src/scene/` | Renderer and post-processing (`Stage`), environment lighting, contact shadows, cabinet, claw and toy visuals, procedural textures; `fx/` particles, aura and light show |
| `src/themes/` | The five theme definitions |
| `src/perspective/` | Off-axis projection, virtual window geometry (incl. the simulated 9:16 screen and phones) |
| `src/tracking/` | Camera, MediaPipe inference (worker or main thread), eye and head-direction estimation, filtering, countdown and distance calibration, phone capture policy |
| `src/layout/` | HUD layout solver (incl. phones), 9:16 frame, safe-area insets, phone behaviour |
| `src/settings/` | Settings specification, store and migrations |
| `src/ui/` | React HUD, score HUD, attract call to action, calibration overlay, dialogs and the settings dialog; `machines/`: lobby, session HUD, try toast, session card, initials entry |
| `src/audio/` | Web Audio engine, studio play-lists and moments, fallback synthesiser |
| `src/ai/` | Guide director, prompt, local lines (incl. the GTC booth-host pools), speech, cache, key client |
| `src/brand/` | Brand kits (GTC, neutral), NVIDIA palette, logo / font slots, the brand-file listing |
| `src/rewards/` | Prize-claim protocol, client, flow, QR encoding, win-card geometry |
| `src/i18n/` | Strings (en / zh / ja) |
| `src/persistence/`, `src/diagnostics/` | Local storage helpers, collection, scores, redacted in-memory log |
| `server/` | Hono API server: OpenAI proxy, key store, proxy / CA handling, HTTPS listener, validation, rate limiting, static hosting of `dist/`; `server/rewards/` prize codes, claim and staff pages, the LAN claim listener |
| `tools/plush/` | SDF modelling DSL, mesher, GLB writer, character designs, generated-model importer |
| `tools/audio/` | Music and SFX synthesis, studio-recording import |
| `tools/dev/` | Headless probes and screenshot helpers used during development |
| `public/assets/plush/`, `public/assets/themes/`, `public/assets/brand/`, `public/audio/`, `public/mediapipe/` | Characters (procedural + textured), the neutral GPU Party emblem, the brand-kit slots (put the official GTC / NVIDIA files here, see its README), audio (synthesised + studio), face model |
| `tests/unit/`, `tests/e2e/` | Vitest and Playwright suites |
| `docs/` | Documentation listed above |

`viewer.html` is a development-only asset viewer
(`/viewer.html?theme=sakura`); it is not linked from the game.

## Privacy

- **Camera**: video only (`audio: false`; the microphone is never requested).
  Frames and face landmarks are processed on the device by a local WASM model;
  they are never uploaded, recorded or stored, and never sent to the AI guide.
  The only tracking data that is persisted is the calibration (a depth constant,
  a neutral position and a head-direction baseline per display preset). MediaPipe's usage logging is switched off and the
  inference worker refuses every request to another origin.
- **AI guide**: only game facts leave the device (event type, theme, toy name,
  result, language) and only to your own API server, which forwards them to OpenAI when a key is configured.
- **Storage**: settings, the prize collection, the best / lifetime points and the machines' top-10 boards (three
  initials a player typed, a score and a time — no other personal data, never sent anywhere, not even to the
  guide) live in `localStorage`;
  imported custom models live in IndexedDB. Nothing of this is sent to a server. A replacement OpenAI key typed in
  the settings is the one exception that goes to *your* API server (once), which keeps it in `.data/secrets.json`.
- **Exports**: the configuration export contains settings only — no keys, no
  PIN, no camera or audio device ids, no camera images, no face data, no collection, no scores.
- **Logs**: the diagnostic log is kept in memory and redacted; the server log never contains keys or full prompts.

## Verified here / needs real hardware

Everything in this repository was developed and tested in a cloud container:
headless Chromium with **software** WebGL (SwiftShader), four shared CPU cores,
no GPU, no camera, no display, no speakers, no phone.

What that environment can show (see [docs/E2E_RESULTS.md](docs/E2E_RESULTS.md)
and the unit tests): the game logic and physics, the points and the idle reset, the layout rules at the
preset viewport sizes (including Playwright's emulated phones and the simulated 9:16 box in a 1280 × 720 window),
the settings flow, the fallbacks, the server proxy against a mocked OpenAI client, the tracking mathematics on
synthetic input, audio files by measurement (loudness, loop seams, cross-fades rendered offline) and render
statistics (draw calls, triangles, shader programs) — not frame rates.
The live OpenAI path was exercised once with a real key (below).

What it **cannot** show, and what is therefore **not verified**:

| Not verified | Why | How to verify |
| --- | --- | --- |
| Frame rate on a Ryzen 7 7840HS / Radeon 780M (or any real GPU) | No such machine was available. The quality tiers are engineering starting budgets, not measurements. | [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — measurement checklist |
| Look, reach and readability on a physical 32" or 86" portrait screen | Only browser viewports of the same pixel shape were used. A viewport proves layout, not ergonomics or viewing comfort. | [docs/DISPLAYS.md](docs/DISPLAYS.md) |
| Head tracking, the countdown calibration and Window Perspective with a real camera and a real person | Only synthetic input was used: generated landmarks in the unit tests and, at most, Chromium's fake camera test pattern (no face) in the end-to-end suite. Mouse or slider input is not camera validation. The stability thresholds and the head-turn default are untested with people. | [docs/CALIBRATION.md](docs/CALIBRATION.md) |
| Live OpenAI text and speech beyond a smoke test | A smoke test passed on 2026-11-24 through the container's HTTPS proxy with a real key: one text line and one Realtime voice line (byte count only — nobody listened), including a run where the proxy's CA came only from `SSL_CERT_FILE` loaded by the server. A second live check (10 GTC-theme lines) confirmed the booth-host persona and led to a prompt fix: the model had invited a QR scan for a win without a QR. Longer sessions, rate limits in practice and use from a phone were not tried. | [docs/AI.md](docs/AI.md) |
| How the music, effects and character voices sound | Nobody has listened to any of it. Loudness, loop seams and cross-fades were measured; taste, drama and musical fit are unjudged, and the two music takes of a theme are in different keys. | [docs/AUDIO.md](docs/AUDIO.md) |
| Phones | Only Chromium's phone emulation (size, pixel ratio, touch, coarse pointer): no real iOS / Android device, cut-outs, landscape lock, HTTPS certificate acceptance, front camera, battery or heat. | [docs/DISPLAYS.md](docs/DISPLAYS.md#phones) |
| Look of the textured models, effects and lighting on a real GPU | Screenshots from software rendering only; whole-frame triangle counts at Medium are about twice the procedural models'. | [docs/PERFORMANCE.md](docs/PERFORMANCE.md), [docs/ASSETS.md](docs/ASSETS.md) |
| Touch input on real touch hardware, audio output devices, Safari and Firefox | Only Chromium with synthetic pointer and touch events was used. | Manual pass |
| The official GTC / NVIDIA artwork in the game | None is in the repository; only the original placeholder and stand-in files in tests were drawn. A logo of a very different shape is covered by the placement maths, not by a render. | Drop the files in ([docs/BRAND.md](docs/BRAND.md)) and check *Settings → Themes* and each screen |
| Whether Tippy Bridge, Tumble Shelf and Sparkle Rush are fair and fun for real players | The prize rates and tries per prize come from headless sweeps of an attract pilot with 2 cm aim noise (the gates in [docs/machines/](docs/machines/)), not from people. Unit tests check the rules, sessions, session prizes and codes; the e2e specs `29-machines-glue` and `30-lobby` drove the machines in headless Chromium. | Booth dry run; tune *Tries per session*, *Boxes for a prize* and *Gem value for a prize* |
| Frame rate of the three new machines on real hardware | Their draw calls and triangles were counted on software rendering ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)); no frame rate was measured. | [docs/PERFORMANCE.md](docs/PERFORMANCE.md) checklist on each machine |
| Scanning the claim QR with real phones, and the claim page on event Wi-Fi | The QR was decoded from screenshots with a QR decoder and the claim page was opened in emulated phones on the container's own network. Event Wi-Fi often isolates clients, so phones may not reach the kiosk's LAN address. | Booth dry run; [docs/REWARDS.md](docs/REWARDS.md) (public claim link option) |

Other known limitations:

- The automatic optimiser can only lower quality down to half the internal resolution of the selected preset; on a machine
  that is still too slow, pick the Safe preset by hand. Its behaviour on real GPUs is untested.
- In `window` mode (desktop preset) the physical size and position of the browser
  window are estimated from CSS pixels, so the perspective is approximate; kiosk presets assume full screen.
- GPU time is not shown in the performance panel (WebGL 2 timer queries are not used); it shows frame time, physics time, draw calls and triangles.
- Replacement models (an ordinary `.glb` referenced from the manifest, or imported in the app) are static meshes shown with their own materials; they keep the collision shape and weight of the slot and get no paint masks, shell fur or LODs. Draco-compressed files are not supported.
- The settings lock PIN is a convenience for public displays, not a security boundary: it is stored in the browser.
- `sakura.biribi` is an original character in a slot marked *replaceable*; no third-party or licensed character ships with this project. To put a licensed model there, point the slot's manifest entry at its `.glb` ([docs/ASSETS.md](docs/ASSETS.md#adding-or-replacing-a-character)).

## Licences and provenance

| Item | Origin | Licence |
| --- | --- | --- |
| Game code, tools, 31 plush character designs (procedural models, collision proxies), cabinet art, textures, GPU Party emblem | Original work in this repository; designs are built by `tools/plush`, textures procedurally at run time | — (project is `private`; no licence file is included) |
| Textured plush models (`*.gen.glb`, `*.gen-*.webp`) | AI-generated with Higgsfield (gpt_image_2_6 concept, meshy_v7 image-to-3D) from the original designs; provenance per character in `public/assets/plush/manifest.json` | Check Higgsfield's current terms of service (ownership and commercial use depend on the account plan) before distributing |
| Studio music, stingers, effects and character voices (`public/audio/studio/`) | AI-generated through Higgsfield (ElevenLabs Music v2.5; Mirelo text-to-audio), processed by `tools/audio/importStudio.ts`; provenance per file in `public/audio/manifest.json` | Check the Higgsfield / ElevenLabs (and Mirelo) terms before commercial use |
| Synthesised music (5 tracks), 70 sound-effect clips, 2 motor loops | Original, synthesised by `tools/audio/bake.ts` | as for the game code |
| Fonts: Fredoka, M PLUS Rounded 1c, Noto Sans SC, ZCOOL KuaiLe | `@fontsource-variable/fredoka`, `@fontsource/m-plus-rounded-1c`, `@fontsource/noto-sans-sc`, `@fontsource/zcool-kuaile` (bundled, no web requests) | SIL Open Font License 1.1 |
| Face Landmarker model + WASM runtime | `@mediapipe/tasks-vision` 1.2.3 and Google's `face_landmarker.task` | Apache-2.0 |
| Physics | `@dimforge/rapier3d-compat` 0.21 | Apache-2.0 |
| Rendering | `three` 0.187 | MIT |
| UI / state / validation / server | `react` 19, `zustand`, `zod`, `hono` | MIT |
| OpenAI client (server only) | `openai` | Apache-2.0 |
| Proxy-aware fetch, WebSocket (server only) | `undici`, `ws` | MIT |
| Asset pipeline (build time only) | `meshoptimizer`, `@gltf-transform/*` | MIT |

No third-party characters are included, and no music or sound recordings other than the AI-generated studio set above.
