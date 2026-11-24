# Brand kits (GTC)

The **gpu** theme is dressed by a *brand kit*: an event identity laid over the theme. The default
kit is **GTC** (host NVIDIA). A second kit, **neutral**, keeps the original "GPU Party" identity with
no real event, host or logo; it is meant for public demo copies.

Kit data lives in `src/brand/kits.ts` (shared by the browser and the API server). The browser picks
the build's kit in `src/brand/index.ts`.

## Palette

Every colour of the theme comes from `NVIDIA_PALETTE`: the 3D scene, the HUD, the dialogs, the light
show, the particles, the claim and staff pages.

| Name | Value | Used for |
|---|---|---|
| `green` | `#76B900` | Brand green: primary buttons (black lettering, 8.7:1), accents, focus rings, LEDs, the LED wall |
| `black` | `#000000` | Backgrounds, panels, lettering on green |
| `white` | `#FFFFFF` | Text, secondary buttons (outline), key light, white light effects |
| `gray950` … `gray100` | `#0D0D0D` … `#EEEEEE` | Neutral surfaces, cabinet metal and lacquer, dividers |
| `greenDeep` | `#5A8F00` | Derived shade: pressed states and 3D shading only |
| `greenLight` | `#A4D65E` | Derived tint: emitted light (glows) only, never lettering or logos |

Unit tests (`tests/unit/scene/brandScene.test.ts`, `tests/unit/brand/brandUi.test.ts`) fail if an
off-palette colour enters the theme. In the gpu theme, rarity is shown by brightness rather than hue
(common white, rare light green, epic green, legendary green and white), so the effects stay on palette.

## Official artwork: logo and font slots

The repository contains **no official GTC or NVIDIA artwork**. Each logo and the typeface are *slots*:

| File (in `assets/brand/gtc/`) | Where it appears | When it is missing |
|---|---|---|
| `gtc-logo.svg` (or `gtc-logo.png`) | The LED wall at the back of the cabinet, the loading screen, the attract screen, the claim page and the staff page | `gtc-logo.placeholder.svg` is shown: an original "GTC" wordmark with a green bar, **not** the official logo |
| `nvidia-logo.svg` (or `nvidia-logo.png`) | Small secondary mark at the upper left of the LED wall; footer of the claim page | Nothing is drawn |
| `fonts/NVIDIASans-Regular.woff2`, `fonts/NVIDIASans-Bold.woff2` | Theme UI, claim and staff pages | Inter (bundled, SIL OFL), then Helvetica / Arial |

**Adding the files**

- In the source tree: copy them into `public/assets/brand/gtc/` and run `npm run build` (or reload `npm run dev`).
- On a kiosk that already has a build: copy them into `dist/assets/brand/gtc/` and reload the page. `npm start` lists that folder live, so no rebuild is needed.
- Use the reversed versions (white or light artwork for dark backgrounds): the theme draws them on black.
- Prefer SVG. A PNG should be at least 2048 px wide with a transparent background.

**Rules the code follows**

- Logos are drawn exactly as supplied. They are never tinted, recoloured, stretched, distorted or animated.
- The 3D logo is drawn unlit and compensates for the scene's exposure and tone mapping. In a production render the placeholder's green bar measures `#76B900` exactly (`tests/e2e/25-gtc-scene.spec.ts`).
- Each logo sits on a black pad that keeps the kit's clear space: half the logo's height on every side.
- Light effects pass behind or around a logo, never over it. The LED wall shader blacks out the logo pads, and additive light sprites fade where they would cover them. Paper confetti is a physical object, like the toys and the claw, and may fly in front.
- **Settings → Themes** shows whether the official logo, the host logo and the brand font were found, or whether the placeholder and fallback are in use.

**Why there are no 404s for missing files**

The build writes `assets/brand/files.json`, a list of the brand files that exist. `npm start` serves a live version of it. The game reads it before loading a slot, so a missing official file is never requested. A missing file would otherwise appear as a console error on the kiosk.

Brand files are served with `cache-control: no-cache`, so a replaced logo shows up on the next load.

## Build flags

| Flag | Values | Effect |
|---|---|---|
| `VITE_BRAND` (build) | `gtc` (default) \| `neutral` | Which kit the game uses |
| `PLUSH_BRAND` (server) | `gtc` (default) \| `neutral` | Which kit the claim and staff pages use. Keep it equal to `VITE_BRAND`. |
| `VITE_REWARDS_DEMO` (build) | `1` | Public copies without the API server. The win card shows a code made in the browser, labelled **DEMO — not redeemable**, and its QR opens `example.com`. |

The public online copy is built with `VITE_BRAND=neutral VITE_REWARDS_DEMO=1`. It carries no GTC or NVIDIA name or mark.

## What the kit changes

- **3D:** LED wall with the event logo (`src/scene/ledWall.ts`, layout in `src/scene/brandScene.ts`).
  - Idle: slow green sweeps, scanlines and data packets.
  - Attract mode and wins: brighter, with outlines rippling from the logo pad.
  - Reduced motion: still.
  - Also: a truss with white spot fixtures, a black lacquered cabinet with a green stripe, black anodised fans with green rings in the side bays, and green / white light shows and particles.
- **Screens:**
  - Loading screen: event logo and green progress bar.
  - Attract screen: event logo, "Welcome to {event}" and **TAP TO PLAY**.
  - Win card: QR claim (see [REWARDS.md](REWARDS.md)).
  - All dialogs and the calibration countdown: palette only (`src/ui/theme-gpu.css`, `src/ui/BootScreen.tsx`, `src/ui/BrandLogo.tsx`).
- **Dialogue:** Momo becomes a GTC booth host: the keynote, sessions, hands-on labs, the exhibit hall, the startup showcase, posters, developers. It invents no schedules, prices, specs or announcements, and never speaks as a real person. Details: [AI.md](AI.md#gtc-kit-momo-as-a-gtc-booth-host).
- **Theme name:** "NVIDIA GTC" in the theme picker (neutral kit: "GPU Party").

## Responsibility for the marks

The GTC and NVIDIA names, logos and typeface are trademarks and assets of their owner. Whoever deploys
this kit needs the right to use them, and supplies them through the slots above. The UI shows no
notice about this.

The **Keynote Chief** plush is a caricature presenter in a leather jacket. Whether its likeness is
acceptable for a given event is also the deployer's decision. Its model can be replaced like any
other character (see [ASSETS.md](ASSETS.md)).

## Verified / not verified

- **Verified:**
  - In headless Chromium with software WebGL: the placeholder in every layout (desktop, 32" and 86" portrait, phone).
  - Its exact green in the 3D render.
  - The listing and the "official file found" branch, with stand-in files in unit tests and one temporary render of the host-logo position.
  - The neutral build carries no GTC / NVIDIA wording (see `docs/E2E_RESULTS.md`).
- **Not verified:**
  - Real official artwork (none in the repo).
  - A logo whose aspect differs a lot from the placeholder's 2.46:1. It is covered by the placement maths and its unit tests, not by a render.
  - Colour accuracy on a calibrated display.
  - The look on a real GPU or a physical 32" / 86" panel.
