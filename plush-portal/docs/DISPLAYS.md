# Display presets, layout and installation

PLUSH PORTAL has four display presets. A preset is a named set of **layout**
values (where the controls are) and **viewing** values (where the screen and the
player are in the real world). Each preset keeps its own values, so one
configuration file can serve a desk, a 32" kiosk, an 86" wall and a phone.

> **Not verified on hardware.** Everything below was developed with browser
> viewports of the right pixel shape (1920×1080, 1080×1920, 2160×3840, and
> Playwright's emulated iPhone / Pixel viewports). That proves the layout rules.
> It does not prove reach, readability, glare or viewing comfort on a physical
> 32" or 86" panel or on a real phone — see the checklists at the end.

- [The four presets](#the-four-presets)
- [Normalised coordinates, safe zone and anchor](#normalised-coordinates-safe-zone-and-anchor)
- [What the solver guarantees](#what-the-solver-guarantees)
- [Four different "sizes"](#four-different-sizes)
- [Window ↔ cabinet mapping](#window--cabinet-mapping)
- [Installing on an 86" portrait display](#installing-on-an-86-portrait-display)
- [32" portrait display](#32-portrait-display)
- [Desktop](#desktop)
- [Phones](#phones)
- [First run and `?display=`](#first-run-and-display)

## The four presets

Defaults from `PROFILE_DEFAULTS` in `src/settings/spec.ts`. Every value is
editable under *Settings → Layout* and *Settings → Camera & Parallax*.

| | `desktop` | `portrait32` | `portrait86` | `mobile` |
| --- | --- | --- | --- | --- |
| Intended for | Landscape monitor or laptop, mouse + keyboard | 32" 9:16 touch display | 86" 9:16 floor-standing display | Phone held sideways (upright also playable), touch |
| Design size (units) | 1920 × 1080 | 1080 × 1920 | 1080 × 1920 | 1300 × 600 sideways (600 units on the short side) |
| Panel style | *split*: direction pad and grab button in the lower corners | *bar*: one panel along the bottom | *bar*: one panel in the middle band | sideways *split* (pad and button in the display bays), upright *bar* |
| Safe zone (top – bottom) | 0 – 1 | 0 – 1 | **0.25 – 0.75** | 0 – 1, minus the screen's cut-outs |
| Panel anchor Y | 0.84 | 0.865 | **0.60** | 0.86 (docked at the bottom) |
| Panel width | 0.94 | 0.94 | 0.60 | 1.00 |
| UI scale | 1.00 | 1.00 | 0.66 | 1.00 |
| Button size (design units) | 84 | 104 | 100 | 100 (= 56–68 CSS px, never under 44) |
| Side / top-bottom margin | 0.035 / 0.02 | 0.035 / 0.02 | 0.035 / 0.02 | 0.02 / 0.025 |
| Play floor line Y | 0.69 | 0.60 | 0.48 | 0.70 (upright: placed above Momo by auto-fit) |
| Screen size (m) | 0.531 × 0.299 (24" 16:9) | 0.398 × 0.708 | 1.071 × 1.904 | 0.141 × 0.065 = *estimate from CSS pixels* (see [Phones](#phones)) |
| Bottom edge above floor (m) | 0.95 | 1.00 | 0.12 | 1.10 |
| Game window | browser window (approximate) | fills the screen | fills the screen | browser window (size estimated) |
| Reference eye (right, up, distance from screen centre; m) | 0, 0.14, 0.62 | 0, 0.20, 0.62 | 0, 0.50, 0.95 | 0, 0, **0.35** |
| Camera position (from screen centre; m) / tilt down | 0, 0.16, 0 / 4° | 0, 0.37, 0 / 8° | 0, 0.98, 0 / 18° | −0.065, 0, 0 / 0° (left end of a phone turned top-to-the-left) |
| Largest view offset x, y, z (m) | 0.30, 0.22, 0.30 | 0.40, 0.30, 0.35 | 0.70, 0.50, 0.55 | 0.12, 0.09, 0.15 |
| Closest viewing distance (m) | 0.30 | 0.30 | 0.45 | 0.18 |

Shared defaults: auto-fit on, text size 1.0, grab button on the right, standard HUD density, camera field of view 63°.

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

`solveLayout(profile, layoutSettings, viewportWidth, viewportHeight, insets?)` in
`src/layout/solve.ts` is a pure function; the HUD and the 3D scene both use its result.
`insets` are the screen's cut-outs (`env(safe-area-inset-*)`, measured by
`src/layout/safeArea.ts`; zero outside a browser and on screens without cut-outs) and
default to the browser's current values, so the HUD and the scene always agree.

1. **Unit.** One design unit = `min(vw/1920, vh/1080)` CSS px (desktop),
   `vw/1080` (portrait) or `clamp(short side/600, 0.56, 0.68)` (phone), times the UI scale.
   All HUD sizes are multiples of it, so the layout is identical at any resolution with the same shape.
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
9. **Cut-outs are kept clear.** Panel, title row and dialogs stay inside the
   viewport minus the reported safe-area insets (notch, punch hole, home indicator).
10. **Phones** (`mobile`) get exact rectangles for each part of the panel
    (`layout.controls`: pad, big button, status line, compact menu) and these extra rules —
    every main control ≥ 56 CSS px where the screen allows it and every touch target
    ≥ 44 CSS px always; no two controls overlap; Momo's block, at its largest
    (`guide.maxH`), never reaches a control or the title row. See [Phones](#phones).

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
The phone preset's numbers are in [Phones](#phones).

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
  `screen.width/height` is first turned to the viewport's orientation when only that fits
  (iOS always reports the upright size, also with the phone sideways).
- *Phones* (phone preset, screen size left at its nominal 0.141 × 0.065 m): the size is
  estimated as CSS pixels × 0.163 mm (0.157 mm at a pixel ratio ≤ 2.2). Published panels
  measure 0.147–0.183 mm per CSS pixel, so the estimate is within about ±12 %. The
  resulting scale is 16–27 (see [Phones](#phones)); `layout.estimated` says when it was used.
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

## Phones

The `mobile` preset is for a phone held **sideways**; held upright it is fully
playable too. The solver's phone path is `solvePhone` in `src/layout/solve.ts`,
the styles are the *phones* section of `src/ui/hud.css`, the behaviour is
`src/layout/phone.ts`.

### Sideways (the intended way)

- **Units.** One design unit is `clamp(short side / 600, 0.56, 0.68)` CSS px. A phone's
  CSS pixel is about 0.16 mm on every phone, so sizes come out physically alike:
  text 14–17 px, direction buttons 56–68 px (≈ 9–11 mm), the big button 2.15× that.
- **Controls in the display bays.** The landscape window shows a display bay on
  each side of the cabinet (`machineSpan` in `windowGeometry.ts`). The direction pad
  sits in the bottom-left bay, the big START / GRAB / PLAY AGAIN button in the
  bottom-right bay, vertically centred on the pad (swap with *Grab button side*).
  The pad is shrunk (not under 56 px) to stay in its bay; on 16:9 phones it may reach a few pixels over the cabinet's frame bar, never over the glass.
- **Status line and compact menu** (settings, collection, theme, help — every one
  44 px) sit between them at the bottom, below the play floor. The status line has its own backing.
- **Compact title row** (either way up): one touch target high (44 px); logo smaller, the theme
  chip hidden (it does not fit beside the logo on a phone; the theme is one tap away in the menu).
- **Momo** stands in the bay above the big button with her bubble stacked above
  her, below the title row. On screens up to 330 px tall (a phone in Chrome with its
  toolbar) she stands beside a one-to-two-line bubble instead. The bubble's height is
  capped (`PHONE.bubble*` in `solve.ts` = the `max-height` rules in `hud.css`, checked by
  `tests/unit/layout/phoneCss.test.ts`) so the block never grows into a control; a long line ends in
  an ellipsis after three lines (two upright or on short screens) — the voice still says all of it.
  When the room is squeezed (font scale 1.3+ on short phones, the panel moved up, very short screens)
  the solver reports how many whole lines still fit (`guide.lines`, 0–3) and the phone panel passes it
  to `hud.css` (`data-guide-lines`): the bubble shows fewer lines instead of covering the big button;
  with no room even for Momo (`guide.hidden`, extreme settings only) her block is hidden.
- **Big button label**: at large font scales or with long words (Japanese スタート / もういちど) the
  label shrinks just enough that no word is split across lines (`src/layout/labelFit.ts`, all presets).

### Upright

Choice: **a real upright layout plus a one-time hint**, not a blocking "rotate
your phone" screen. Many people keep the rotation lock on, and Safari on iPhone
cannot lock a page to landscape, so a blocking overlay would leave them with a
dead screen; the upright window also shows the cabinet at full width (1.06 m
over the phone's width), so the toys are not smaller than sideways.

- Like the 32" preset scaled down: cabinet on top, Momo in one row just above the
  panel, the floor line placed just above Momo, and one **opaque** panel docked at
  the bottom — status line (at most two lines, then an ellipsis) and compact menu in its
  top row, pad and big button in the row below. The solver keeps the panel under 45 % of the height and leaves the
  cabinet the room its gantry needs (the floor line is at least 0.84 × width down the screen).
- For seven seconds a dark chip under the title row says *Turn your phone
  sideways for the best view*; a tap hides it at once. It is shown once per page load.

### Cut-outs, touch, dialogs

- `index.html` asks for `viewport-fit=cover`, so the page reaches under the notch and the
  home indicator; the solver keeps every control, the title row and the dialogs inside
  `env(safe-area-inset-*)` (measured once per viewport size by `src/layout/safeArea.ts`).
- Touch targets: main controls 56+ px where the screen allows it, nothing under 44 px —
  compact-menu and dialog buttons, close buttons, settings tabs, toggles (76 × 44),
  segmented choices, inputs, sliders and Momo herself.
- Dialogs (settings, collection, theme picker, how-to-play, device chooser) fill the
  usable area with thin header and footer bars; content scrolls inside. Settings tabs
  become an **icon rail with short labels** on the left when sideways and a
  **horizontally scrolling strip** at the top when upright (fields then use one column).
  Form fields use 16 px text so iOS does not zoom into them.

### Phone behaviour

- No page zoom, scrolling, pull-to-refresh, text selection or long-press menus during
  play: `touch-action` (none on the game, pan only inside dialogs), `overscroll-behavior: none`,
  `user-select: none`, `-webkit-touch-callout: none`, a fixed `body`, and document guards
  for iOS pinch gestures, two-finger moves, `contextmenu` and `selectstart` outside form fields.
- The **first START tap** asks for full screen and then a landscape orientation lock
  (once per page load, only for the phone preset on a touch screen). Chrome on Android
  allows both; Safari on iPhone allows neither for a page — every refusal is ignored.
  Leaving full screen releases the lock. Pausing when the page is hidden is unchanged.
- **First run on a phone** (phone preset on a touch screen, once per device, never over
  `?quality=`, never into an open settings draft): the *Safe* graphics preset — 30 fps
  target, 512 textures, no fur shells, pixel-density cap 1.25 and at most 0.7 MP of 3D
  pixels. If that preset is ever raised above 1.5 device pixels per CSS pixel, the phone
  setup lowers the cap (and the preset then shows as *Custom*).
- Direction buttons also release on any `pointerup` / `pointercancel` of their pointer
  anywhere, when the last finger leaves the screen, on window blur and when the page is
  hidden — the claw never keeps moving after the finger is lifted.
- `index.html` also sets `theme-color`, `mobile-web-app-capable`,
  `apple-mobile-web-app-capable`, a translucent status bar and `format-detection`;
  `public/manifest.webmanifest` lets the game be added to the home screen and start
  full screen in landscape.

### Window Perspective on a phone

- Screen size: estimated from CSS pixels (see [Window ↔ cabinet mapping](#window--cabinet-mapping))
  while *Screen width / height* are left at the preset's nominal 0.141 × 0.065 m;
  enter the real active-area size for an exact window. *Settings → Layout* shows the estimate.
- Viewing distance: the reference eye is 0.35 m in front of the screen centre (phone held in the hands).
- Camera: the default lens position (−0.065, 0, 0) is the left end of a phone turned
  with its top to the left, the usual way. `phoneCameraPosition(angle, w, h)` in
  `windowGeometry.ts` gives the position for any rotation (top edge = camera); the
  tracker does not use it yet.

Solver output (computed by the code above at default settings, not measured on a device;
physical width at a pixel ratio of 3):

| Viewport (CSS px) | Unit | Pad button / big button / menu (px) | Where | Momo (screen Y) | Floor line | Window width, scale | Adjusted |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iPhone 15 Pro, full screen @ 852 × 393 | 0.655 | 66 / 141 / 44 | pad 17–219, button 694–835 (cabinet 266–586) | side 0.22–0.52 | 0.700 | 139 mm, ×20.3 | no |
| same, cut-outs 0 / 59 / 21 / 59 | 0.655 | 66 / 141 / 44 | pad 59–261, button 652–793 | side 0.19–0.49 | 0.700 | 139 mm, ×20.3 | no |
| iPhone 15 Pro in Safari @ 734 × 343 | 0.572 | 57 / 123 / 44 | pad 15–191, button 596–719 (cabinet 227–507) | side 0.21–0.52 | 0.700 | 120 mm, ×23.3 | no |
| Pixel 7 in Chrome @ 863 × 360 | 0.600 | 60 / 129 / 44 | pad 17–202, button 717–846 (cabinet 285–578) | side 0.22–0.52 | 0.700 | 141 mm, ×22.2 | no |
| iPhone SE (16:9) @ 667 × 375 | 0.625 | 57 / 123 / 44 | pad 13–190, button 531–654 (cabinet 181–486) | side 0.26–0.56 | 0.700 | 105 mm (DPR 2), ×22 | no |
| Pixel 5 in Chrome @ 802 × 293 | 0.560 | 56 / 120 / 44 | pad 16–189, button 666–786 (cabinet 282–520) | side 0.30–0.45 | 0.700 | 131 mm, ×27.2 | no |
| iPhone 15 Pro upright in Safari @ 393 × 659 | 0.655 | 57 / 123 / 44 | panel 0.606–0.975 | above panel 0.51–0.60 | 0.501 | 64 mm, ×16.5 | no |
| Pixel 7 upright, full screen @ 412 × 915 | 0.680 | 68 / 146 / 44 | panel 0.673–0.975 | above panel 0.60–0.67 | 0.594 | 67 mm, ×15.8 | no |

Testing without a phone: Playwright's phone devices (e.g. `devices['iPhone 15 Pro landscape']`,
`devices['Pixel 7']`) emulate size, pixel ratio and a coarse pointer, but **no cut-outs**;
`?debug=1&insets=top,right,bottom,left` (CSS px, one value = all sides) makes the game
behave as if the screen reported them.

Real-device checks that nobody has done yet:

- [ ] Thumb reach of pad and big button on a small (5.4") and a large (6.7") phone, both hands
- [ ] Pad + big button pressed at the same time; no accidental zoom, scroll, selection or system menu
- [ ] Notch / Dynamic Island on either side, home indicator, Android gesture bar; rounded corners
- [ ] Full screen and landscape lock on Chrome for Android; behaviour on Safari (neither available)
- [ ] Frame rate and heat with the Safe preset over ten minutes; battery drain
- [ ] Window Perspective with the front camera at 30–40 cm; the estimated screen size against a ruler

## First run and `?display=`

- On the first start (no preset stored) a chooser asks **"Which screen is
  this?"** and highlights a suggestion from the viewport shape: a touch screen
  (coarse pointer) whose short side is at most 500 CSS px → `mobile`; otherwise
  landscape → desktop; portrait → `portrait86` if the viewport is at least 1600 CSS px wide
  or 3000 tall, otherwise `portrait32`. Closing the chooser accepts the suggestion.
  On the 86" preset all four cards lie inside the 25–75 % band.
- `?display=desktop|portrait32|portrait86|mobile` (alias `?profile=`) selects the
  preset directly, stores it, and skips the chooser. Use it in kiosk start URLs.
- The preset can be changed any time under *Settings → Layout → Display
  preset*. Switching presets does not copy values between them.
- *Reset this preset* (Layout tab) restores the layout values of the active
  preset only. Its screen geometry, camera mounting and calibration are reset
  from the Camera & Parallax tab (*Reset this tab*), which in turn keeps the layout.
- Resizing or rotating the window re-solves the layout at once; the cabinet
  shell is rebuilt a quarter of a second later (never in the middle of a grab).
