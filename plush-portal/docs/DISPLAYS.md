# Display presets, layout and installation

PLUSH PORTAL has three display presets. A preset is a named set of **layout**
values (where the controls are) and **viewing** values (where the screen and the
player are in the real world). Each preset keeps its own values, so one
configuration file can serve a desk, a 32" kiosk and an 86" wall.

> **Not verified on hardware.** Everything below was developed with browser
> viewports of the right pixel shape (1920×1080, 1080×1920, 2160×3840). That
> proves the layout rules. It does not prove reach, readability, glare or
> viewing comfort on a physical 32" or 86" panel — see the checklists at the end.

- [The three presets](#the-three-presets)
- [Normalised coordinates, safe zone and anchor](#normalised-coordinates-safe-zone-and-anchor)
- [What the solver guarantees](#what-the-solver-guarantees)
- [Four different "sizes"](#four-different-sizes)
- [Window ↔ cabinet mapping](#window--cabinet-mapping)
- [Installing on an 86" portrait display](#installing-on-an-86-portrait-display)
- [32" portrait display](#32-portrait-display)
- [Desktop](#desktop)
- [First run and `?display=`](#first-run-and-display)

## The three presets

Defaults from `PROFILE_DEFAULTS` in `src/settings/spec.ts`. Every value is
editable under *Settings → Layout* and *Settings → Camera & Parallax*.

| | `desktop` | `portrait32` | `portrait86` |
| --- | --- | --- | --- |
| Intended for | Landscape monitor or laptop, mouse + keyboard | 32" 9:16 touch display | 86" 9:16 floor-standing display |
| Design size (units) | 1920 × 1080 | 1080 × 1920 | 1080 × 1920 |
| Panel style | *split*: direction pad and grab button in the lower corners | *bar*: one panel along the bottom | *bar*: one panel in the middle band |
| Safe zone (top – bottom) | 0 – 1 | 0 – 1 | **0.25 – 0.75** |
| Panel anchor Y | 0.84 | 0.865 | **0.60** |
| Panel width | 0.94 | 0.94 | 0.60 |
| UI scale | 1.00 | 1.00 | 0.66 |
| Button size (design units) | 84 | 104 | 100 |
| Play floor line Y | 0.69 | 0.60 | 0.48 |
| Screen size (m) | 0.531 × 0.299 (24" 16:9) | 0.398 × 0.708 | 1.071 × 1.904 |
| Bottom edge above floor (m) | 0.95 | 1.00 | 0.12 |
| Game window | browser window (approximate) | fills the screen | fills the screen |
| Reference eye (right, up, distance from screen centre; m) | 0, 0.14, 0.62 | 0, 0.20, 0.62 | 0, 0.50, 0.95 |
| Camera position (from screen centre; m) / tilt down | 0, 0.16, 0 / 4° | 0, 0.37, 0 / 8° | 0, 0.98, 0 / 18° |
| Largest view offset x, y, z (m) | 0.30, 0.22, 0.30 | 0.40, 0.30, 0.35 | 0.70, 0.50, 0.55 |
| Closest viewing distance (m) | 0.30 | 0.30 | 0.45 |

Shared defaults: auto-fit on, text size 1.0, side margin 0.035, top/bottom
margin 0.02, grab button on the right, standard HUD density, camera field of view 63°.

## Normalised coordinates, safe zone and anchor

Layout positions are fractions of the viewport: **x = 0 left … 1 right,
y = 0 top … 1 bottom**. Nothing in the layout is stored in pixels.

- **Safe zone** (`safeTop`, `safeBottom`): the vertical band in which everything
  the player must touch has to be. On an 86" portrait screen the top quarter is
  above most people's reach and the bottom quarter is at knee height, hence
  0.25–0.75. On the other presets the zone is the whole screen.
- **Panel anchor** (`anchorY`): where the *centre* of the main control panel
  (direction pad, grab button, compact menu) sits. 0.60 on the 86" preset
  places it in the lower-middle of the safe zone.
- **Play floor line** (`floorY`): where the front edge of the toy floor meets
  the glass on screen. The 3D scene is laid out around it (see below), so the
  toys always sit above the panel.

UI position and eye height are independent: the anchor is a layout value, the
reference eye is a viewing value. Moving the panel does not change the perspective and vice versa.

*Settings → Layout → Show safe-zone guides* draws the zone, the anchor and the
floor line over the game with their numeric values.

## What the solver guarantees

`solveLayout(profile, layoutSettings, viewportWidth, viewportHeight)` in
`src/layout/solve.ts` is a pure function; the HUD and the 3D scene both use its result.

1. **Unit.** One design unit = `min(vw/1920, vh/1080)` CSS px (desktop) or
   `vw/1080` (portrait), times the UI scale. All HUD sizes are multiples of it,
   so the layout is identical at any resolution with the same shape.
2. **Minimum zone.** A safe zone less than 30 % of the height is replaced by 0.35–0.65.
3. **The panel is inside the safe zone.** Its top and bottom are clamped into
   the zone (minus half the vertical margin) wherever the anchor asks for. A move
   of more than 1 % of the screen height is reported as `adjusted`; smaller nudges are silent.
4. **The panel fits.** With auto-fit on, a panel taller than 62 % of the zone
   (bar) / 50 % (split), or than 40 % of the screen, shrinks the UI scale until it fits; a bar wider
   than the allowed panel width shrinks likewise. The result reports `adjusted`, shown as a note in the Layout tab.
5. **Dialogs are inside the safe zone.** Every dialog (settings, collection,
   theme picker, tutorial, device chooser) is positioned in the `modal`
   rectangle, which lies within the zone; long content scrolls inside the dialog.
6. **Momo never covers toys.** Bar layouts with a restricted zone place the
   guide directly under the panel if it fits inside the zone, otherwise directly
   above it; split layouts place it at the side under the title row.
7. **Toys stay above the controls.** With auto-fit on (bar layouts), the floor
   line is moved up if necessary so it is above the panel (or above Momo when she is above the panel).
   It is always kept within 0.28–0.86.
8. **Results and toasts** in bar layouts are placed relative to the panel and kept inside the zone.

What it does **not** guarantee:

- The title row (logo, theme chip, camera status) and the round **i** button
  stay at the top of the screen on every preset. On `portrait86` they are
  outside the 25–75 % band. They are not needed to play: settings, collection,
  theme and help are also in the compact menu inside the control panel, which is always in the zone.
- With auto-fit off the sizes are taken literally; only the clamp of rule 3 still applies.

Solver output for the default presets (computed with the code above, not measured on a device):

| Preset @ viewport (CSS px) | Unit (px) | Button (px) | Panel top – bottom | Panel width | Dialog top – bottom | Momo | Floor line |
| --- | --- | --- | --- | --- | --- | --- | --- |
| desktop @ 1920 × 1080 | 1.000 | 84 | 0.701 – 0.979 | 0.93 | 0.02 – 0.98 | side, 0.126 – 0.235 | 0.69 |
| desktop @ 1280 × 720 | 0.667 | 56 | 0.701 – 0.979 | 0.93 | 0.02 – 0.98 | side | 0.69 |
| portrait32 @ 1080 × 1920 | 1.000 | 104 | 0.752 – 0.978 | 0.93 | 0.02 – 0.98 | above panel, 0.685 – 0.747 | 0.60 |
| portrait86 @ 1080 × 1920 | 0.660 | 66 | 0.528 – 0.672 | 0.60 | 0.258 – 0.742 | below panel, 0.676 – 0.716 | 0.48 |
| portrait86 @ 2160 × 3840 | 1.320 | 132 | 0.528 – 0.672 | 0.60 | 0.258 – 0.742 | below panel, 0.676 – 0.716 | 0.48 |

None of the default presets needs an adjustment at these sizes (`adjusted` is false for all five rows).

## Four different "sizes"

| Size | What it is | Who sets it | Used for |
| --- | --- | --- | --- |
| **CSS size** | Viewport in CSS pixels (`innerWidth × innerHeight`) | Browser window / OS scaling | All layout maths. The HUD is laid out in CSS pixels and rendered by the browser at native sharpness. |
| **Device pixel ratio** | Physical pixels per CSS pixel | OS display scaling, browser zoom | Sharpness of the HUD; starting point for the 3D resolution. |
| **Physical size** | Metres of glass (`screenW`, `screenH`, `bottomElevation`) | You, in *Camera & Parallax → Screen & installation* | Window Perspective only: converting the tracked eye position (metres) into the scene. It cannot be detected by a browser. |
| **Internal 3D resolution** | Size of the WebGL drawing buffer | Graphics settings | Cost and sharpness of the 3D view only. |

Internal resolution = CSS size × device pixel ratio × *Render scale* (× the
automatic optimiser's scale), then reduced uniformly if it exceeds the *Pixel
budget* (megapixels). The canvas keeps its CSS size; the browser scales the
image. Example: an 86" 4K panel in portrait is 2160 × 3840 physical pixels
(8.3 MP). With the Medium preset's 2.1 MP budget the 3D view is rendered at
1087 × 1932 and upscaled, while the HUD stays at native resolution.
*Settings → Graphics* shows the resolution currently in use.

The physical size of a control is `CSS px × (physical width ÷ CSS width)`. With
the defaults the basic button size (*Button size*, the edge of one direction
button) comes out at roughly 65 mm on a 1.071 m wide 86" panel and 38 mm on a
0.398 m wide 32" panel, whatever the OS scaling is, because the unit follows
the viewport width. The round grab button is 2.15× that, the compact menu buttons 0.62×. These are computed values — check them with a ruler on the real device.

## Window ↔ cabinet mapping

The screen is treated as a pane of glass in the front of the cabinet
(`src/perspective/windowGeometry.ts`).

- The cabinet is modelled in metres. The play field is 1.0 m wide and 0.8 m
  deep; with its frame the machine needs a virtual window at least **1.06 m** wide.
- Virtual window width = `max(1.06, 1.3 × aspect)`, height = width ÷ aspect.
  Portrait screens show exactly the machine's width (1.06 × 1.88 m at 9:16);
  landscape screens show at least 1.3 m of height and get a display bay on each
  side of the play field (2.31 × 1.30 m at 16:9).
- The **front edge of the play floor lies in the window plane** at the floor
  line `floorY`. Because it is in the plane of the glass, its position on screen
  does not move when the viewpoint changes — the controls below it never end up over toys.
  The floor line is limited so the gantry stays visible above and at least 0.3 m of the prize bin below.
- **Scale** = virtual width ÷ physical width of the effective window. The eye
  position measured in real metres is multiplied by it. On the 86" preset the
  scale is 0.99 — the cabinet is essentially life-size and the geometry is that
  of a real window. On the 32" preset it is 2.66 and on a 24" desktop about 4.4:
  the cabinet is a miniature behind the glass, and head movement is scaled up accordingly.
- *Fills the screen* (kiosk presets): the canvas is assumed to be the whole
  panel; the physical width is the shorter (portrait) or longer (landscape) of the two screen dimensions.
- *Browser window* (desktop preset): the physical size and position of the
  window on the monitor are estimated from `screen.width`, the window position and the entered
  monitor size. Browsers do not report these precisely, so the result is approximate.
- The frustum is then `left/right = near × (∓W/2 − ex) / ez`, `bottom/top = near × (∓H/2 − ey) / ez`
  (`src/perspective/offAxis.ts`). The camera does not rotate towards the window centre.

Without tracking the eye is the preset's **reference eye**. Tracking,
calibration, filtering and loss handling are in [CALIBRATION.md](CALIBRATION.md).

## Installing on an 86" portrait display

Assumed by the defaults — change the numbers if your installation differs:

| Quantity | Default | On the wall |
| --- | --- | --- |
| Active area | 1.071 m wide × 1.904 m tall | — |
| Bottom edge above the floor | 0.12 m | top edge at 2.02 m, screen centre at 1.07 m |
| Safe zone 0.25 – 0.75 | — | from 1.55 m down to 0.60 m above the floor |
| Panel anchor 0.60 | — | panel centre about 0.88 m above the floor |
| Reference eye | 0.50 m above centre, 0.95 m away | eyes at 1.57 m, about one step back |
| Camera | 0.98 m above centre, tilted 18° down | on top of the bezel (about 2.05 m), looking down at the player |

Steps:

1. **Operating system.** Rotate the display to portrait in the OS. Use 200 %
   scaling on a 4K panel (CSS viewport 1080 × 1920, pixel ratio 2) or 100 %
   (2160 × 3840, ratio 1) — the layout is the same either way.
2. **Browser.** Start in kiosk / full-screen mode on
   `http://<host>:8787/?display=portrait86` (append `&lang=zh` etc.). The origin must be
   `localhost` or HTTPS for the camera. Allow the camera permanently for that origin.
3. **Measure the glass** (active area, not the bezel) and the height of its
   bottom edge; enter them under *Camera & Parallax → Screen & installation*.
   *Set eye height from installation* then sets the vertical reference eye for a
   typical player (1.15 / 1.40 / 1.60 / 1.75 m) from those two numbers.
4. **Mount the camera** centred on the top edge, tilted down so that a person
   standing at playing distance is fully in frame. Enter its position relative
   to the screen centre and its tilt, rotation and field of view under *Camera mounting*.
5. **Calibrate** with a person of typical height at the usual distance
   (*Quick calibration*, [CALIBRATION.md](CALIBRATION.md)).
6. **Layout.** Turn on *Show safe-zone guides*. Check with the shortest and the
   tallest expected player that the panel is comfortable; move *Control panel
   height* or the zone if not. For children-only venues a lower anchor (0.65–0.70) and zone is reasonable.
7. **Graphics.** Start with Medium and read
   [PERFORMANCE.md](PERFORMANCE.md) before raising the pixel budget — 8.3 MP is a lot for an integrated GPU.
8. **Lock.** *System → Public display lock* hides the full settings behind a PIN.

Real-device checks that nobody has done yet:

- [ ] Every control reachable by a 1.2 m child and a 1.9 m adult without stretching or bending
- [ ] Text readable at 0.8–1.5 m; nothing important in the top or bottom quarter
- [ ] Touch accuracy at the panel edges; palm rejection; multi-touch on pad + grab at once
- [ ] Perspective feels like a window from the reference position and while walking past
- [ ] No visible seam or scaling artefacts from the upscaled 3D view
- [ ] Frame rate and thermals over an hour of attract mode

## 32" portrait display

Defaults assume a 0.398 × 0.708 m active area whose bottom edge is 1.00 m above
the floor (a counter-top or pole-mounted kiosk), the player's eyes 0.62 m away
and 0.20 m above the screen centre (about 1.55 m), and a camera on the top bezel tilted 8° down.

- CSS viewport 1080 × 1920 (a 1080p panel at 100 %, or a 4K panel at 200 %).
- The whole screen is the safe zone; the panel is docked at the bottom
  (0.75–0.98) and Momo sits just above it.
- The cabinet appears at 1 : 2.66 scale. Head movement has a strong effect at
  this size; reduce *Sideways / Up-down sensitivity* if it feels exaggerated.
- Same installation steps as above with `?display=portrait32`.

Checks to do on a real unit: thumb reach across the bottom bar for left- and
right-handed players (*Grab button side*), readability at arm's length, camera framing for seated and standing players.

## Desktop

- Landscape, any window size; the layout scales with the shorter side.
  Below roughly 1280 × 720 the buttons become small for touch — it is meant for mouse and keyboard.
- Direction pad bottom-left, grab button bottom-right (swap with *Grab button side*).
- *Game window: Browser window (approximate)* is the default: the perspective
  assumes a 24" monitor (0.531 × 0.299 m) and estimates where the window is on
  it. Enter your monitor's real size for a better result, or press `F` and
  switch to *Fills the screen* for an exact one.
- Webcam assumed on top of the monitor (0.16 m above centre, tilted 4° down).

## First run and `?display=`

- On the first start (no preset stored) a chooser asks **"Which screen is
  this?"** and highlights a suggestion from the viewport shape: landscape →
  desktop; portrait → `portrait86` if the viewport is at least 1600 CSS px wide
  or 3000 tall, otherwise `portrait32`. Closing the chooser accepts the suggestion.
- `?display=desktop|portrait32|portrait86` (alias `?profile=`) selects the
  preset directly, stores it, and skips the chooser. Use it in kiosk start URLs.
- The preset can be changed any time under *Settings → Layout → Display
  preset*. Switching presets does not copy values between them.
- *Reset this preset* (Layout tab) restores the layout values of the active
  preset only. Its screen geometry, camera mounting and calibration are reset
  from the Camera & Parallax tab (*Reset this tab*), which in turn keeps the layout.
- Resizing or rotating the window re-solves the layout at once; the cabinet
  shell is rebuilt a quarter of a second later (never in the middle of a grab).
