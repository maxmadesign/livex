# Head Tracking / Window Perspective — calibration and installation

Head tracking makes the screen behave like the glass front of the cabinet: the 3D
view is rendered for the real position of the player's eyes (head-coupled,
off-axis perspective), so objects at different depths show different parallax
while the window frame and the HUD stay put.

This document covers the tracking side: conventions, the countdown calibration
(baseline), the quick distance calibration, parameters, phones, mounting,
troubleshooting and what was (and was not) verified.
Code: `src/tracking/` (pipeline), `src/perspective/` (projection).

---

## 1. Coordinate conventions

All distances are metres.

**Screen / window space** (what `TrackerPort.sampleEye()` returns)

- origin: centre of the effective game window (for a full-screen kiosk: centre of the picture)
- `+X` to the viewer's right, `+Y` up, `+Z` out of the screen towards the viewer
- the cabinet lives at `z < 0`, eyes are at `z > 0`

**Camera space** — `+X` to the camera's right (image right), `+Y` down, `+Z` along
the optical axis. The camera looks at the viewer, so for an ideally mounted camera
`camera +X = screen −X`: a player who steps to *their* right appears on the *left*
of the raw camera image.

**Image frames** (`src/tracking/frameGeometry.ts` is the only place that knows about these)

| frame | meaning |
| --- | --- |
| raw | exactly what `getUserMedia` delivers |
| upright | raw rotated clockwise by `camRotation`, so faces are upright (what the detector and the preview see) |
| true | upright with the horizontal mirror removed when `mirror` is on |

The calibration preview is drawn mirror-like (flipped) for a normal camera and is
**not** flipped again for a camera that already mirrors — the flip happens exactly once.

---

## 2. Pipeline

```
camera frame (video only, ~640×480)
  → MediaPipe FaceLandmarker (worker, local WASM + local model, 15–20 Hz)
  → primary player association (position continuity, bystanders ignored)
  → eye estimate in camera space (rigid 3D fit, see below)
  → camera-to-screen transform (rotation, mirror, pitch / yaw / roll, camera position)
  → One Euro filter, outlier gate, dead zone        (+ head direction → head-turn offset, One Euro)
  → view mapping (baseline, gains, soft limits, minimum distance)
  → ViewpointController (hold / return / re-acquire, 60 Hz interpolation)
  → OffAxisCamera (asymmetric frustum)
```

**Eye position.** The midpoint of the four eye corners gives the direction to the
eyes (eye corners do not move with gaze or blinks). Distance does *not* come from
MediaPipe's landmark `z`. Instead 25 rigid landmarks of the canonical 3D face
model (MediaPipe's own Procrustes basis without jaw and cheek points) are fitted
to their image positions with a scaled-orthographic camera in a virtual view that
looks straight at the face, refined by three POSIT iterations. The fitted scale
(pixels per metre at the face) is independent of head rotation, so turning or
nodding in place does not fake a depth change. Head orientation places the eyes relative to the face centre and, after a
calibration, feeds the optional head-turn term of the view mapping (section 3); it is
never used as the viewpoint by itself.

**Primary player.** The first steady face near the centre of the picture is
locked after ~0.3 s and then followed by position and size continuity only.
Everybody else in view is followed as an anonymous "other" and can never take
over, even while the player is briefly hidden. If the player leaves, the lock is
released after `lostHoldMs + 0.75 × returnMs` (≥ 1.2 s) and the next steady,
central face becomes the player. No identity features are computed or stored.

**Loss handling.** Brief loss: the viewpoint holds (`lostHoldMs`). Longer loss: it
eases back to the reference viewpoint (`returnMs`). When a face is found again the
view cross-fades onto it (`reacquireMs`). There is never a jump.

**Drag-to-peek (no face).** While no live sample drives the view (`ViewpointController`
mode neutral, hold or returning — camera off, denied, no face, not started), the
tracker asks its drag source (`FaceTracker.setDragSource`, installed by
`src/app/PeekDrag.ts`) once per rendered frame for an offset and adds it to the
viewpoint; the status then reports the view source **`drag`** ("Dragging to peek (not
the camera)"). Live tracking and the test viewpoint always win: a face that appears
mid-drag is cross-faded in starting from the dragged view, and the drag is dropped
until the finger lifts. The offset is limited to 85 % of `view.maxOffset` and
springs back to zero on release (details in
[DISPLAYS.md](DISPLAYS.md#depth-the-arcade-row-the-glass-and-drag-to-peek)).
`camera.dragPeek` (*Camera & Parallax → Drag to peek*, on by default) turns it off.
With the null tracker (tracking module failed to load) drag-to-peek is not available.

---

## 3. Countdown calibration (baseline)

The default calibration on every device (desktop, phone, 32", 86"). It needs no tape
measure: whatever position and head direction the player has when the countdown ends
becomes the centre of the view.

**Flow**

1. Head tracking is switched on and the camera starts (first press of START, or
   switching it on again later).
2. With `camera.autoCalibrate` on (default), the first time a face has been tracked
   steadily for 0.7 s, a countdown of `camera.calibrationSeconds` (default 3) starts
   automatically — but only while the round is READY or ATTRACT (or a demo round),
   no dialog is open and the page is visible. If the player starts aiming during the
   countdown, it is cancelled and runs again at the next READY / ATTRACT. This happens
   once per camera start (every re-enable counts).
3. The overlay shows a big 3-2-1 with a ring, "Look at the screen and hold still", a
   face-found indicator and Cancel.
4. After the countdown the tracker averages the newest **0.7 s** of raw samples as soon as
   they are steady (at least 4 samples — on a slow device inferring at only 3–5 Hz the window
   stretches back to hold them, never beyond 1 s; lateral spread ≤ 8 mm + 1.2 % of the distance, depth
   spread ≤ 10 mm + 2 %, head-direction spread ≤ 4°, and no drift between the first and the
   second half of the window — half those limits). Trimmed means (20 % off each end) make the
   result robust against the tail of a movement.
5. Success: a tick is shown for 1.8 s, the baseline is applied at once and stored for the
   **active display preset**. Failure after 3 s without a steady window: `no_face` (hardly
   any face samples) or `unstable` (too much movement), shown with **Retry** and **Skip**.
   A failure left on screen is dismissed after 30 s in view (time under a dialog does not
   count), and an automatic one also as soon as a
   round starts (it is not retried automatically). A running countdown or capture counts as
   activity for the game's idle reset (`system.idleSeconds`), so the reset never interrupts
   it; an idle reset that runs at any other time cancels a failed / finished calibration and
   clears its card.

"Calibrate now" in Settings → Camera & Parallax does the same by hand, and so does
**Recalibrate view** in the HUD while the camera is searching / tracking / lost: next to the
camera chip in the top bar, or — on 86" portrait, where the top bar is above the reachable band —
as the camera button in the control-panel menu (`menu-recalibrate`). Both use
`camera.calibrationSeconds`. Each second of the countdown ticks and a chime plays when the
baseline is taken (`countdown_tick`, `calibration_ok`). "Calibrate now" starts the camera
first if it is enabled but not running, or while the inference backend is being replaced; the
countdown waits for it). It is disabled on a page that is not HTTPS / localhost. A baseline
taken while the dialog is open goes into the dialog's draft like every other setting: **Apply**
keeps it, Cancel / closing the dialog drops it. Cancel / Skip never change the stored baseline. Contract: `TrackerPort.startCalibration(seconds)` /
`cancelCalibration()`, progress in `TrackerStatus.calibration`:

| phase | `remaining` | `detail` |
| --- | --- | --- |
| `idle` | 0 | `''`, or `rotated` after the camera picture rotated (prompt for a new baseline) |
| `countdown` | whole seconds left | `''`, or `waiting_camera` while the camera is still starting |
| `capturing` | 0 | `''` |
| `done` | 0 | `ok` (shown 1.8 s, then `idle`) |
| `failed` | 0 | `no_face`, `unstable`, `not_running` (head tracking off), `camera_lost`, `denied`, `no_device`, `in_use`, `insecure`, `model_error` |

Stop / switch-off cancel a running countdown (idle); a hidden page drops it (the
automatic one runs again later); a camera that disappears ends it with `camera_lost`.

**What is stored** (per display preset, `src/tracking/baseline.ts`):

| setting | meaning |
| --- | --- |
| `profiles.<id>.view.calNeutral` | eye position at the baseline (window space, m) — the same field the distance calibration ([3b](#3b-quick-distance-calibration)) uses |
| `profiles.<id>.view.calibrated` | `true` |
| `camera.headBaseline.<id>.yaw / .pitch` | head direction at the baseline, degrees, relative to facing the centre of the game window (0.1° grid) |

`calDepthK` (the distance scale) is kept as it is. The application persists the
`CalibrationEvent` (`kind: 'baseline'`); in this app the calibration coordinator in
`src/ui/CalibrationOverlay.tsx` writes `baselineWrites(profile, values)` and tells the
tracker the active preset (`setActiveProfile`).

**Baseline-relative view.** After calibration

```
viewpoint = eye_ref + gain ∘ ( (measured − calNeutral) + headTurn )        (soft limit maxOffset, minDistance)
headTurn  = headWeight × eye_ref.z × sin( shaped(head − directionToWindowCentre − headBaseline) )
```

`eye_ref` is the neutral, screen-centred eye at the design distance (`view.eye`). The head
direction is taken in screen space (camera tilt / roll / rotation removed) and compared with
the direction from the eyes to the window centre, so walking sideways while watching the
cabinet is pure position parallax, while turning the head away from the middle ("looking
around") moves the view in that direction. `shaped` = 2° dead zone, limited to 45°. With the
default `camera.headWeight = 0.4` a 20° turn moves the view about 8 cm on a desktop (0.62 m)
and about 12 cm on the 86" preset (0.95 m); 0 switches it off. The head term is filtered with
the same One Euro parameters as the position and applies only while the preset is calibrated.
Hold / return / re-acquire and the soft limits work exactly as before.

**Phones** (`camera.lowPower`, `src/tracking/devicePolicy.ts`): on phones / tablets (and
devices with ≤ 2 cores, or ≤ 4 cores and ≤ 4 GB) `auto` requests 360p, caps inference at
12 Hz and follows one face; `on` / `off` force it. The front camera is used (`facingMode:
'user'`) unless a device was chosen. Video only (`audio: false`), and only on HTTPS or
localhost — otherwise the overlay shows a notice with the page origin ("The camera needs a
secure page", 30 s or until OK) and the game keeps the fixed view. Phones rotate the camera picture with the
screen: a portrait ↔ landscape change of the frames (or a `screen.orientation` change) resets
the filters and the player lock and asks for a new baseline (automatic countdown with
`autoCalibrate`, otherwise a "Screen rotated — Calibrate / Not now" prompt). A hidden page
pauses inference.

**Overlay placement.** The card is placed inside the interactive safe zone (86" portrait:
25 %–75 % of the height), below the title bar and above the control panel; a short region
(landscape phone) gets a compact card with the ring beside the text. Only its buttons take
pointer input (`calib-cancel`, `calib-retry`, `calib-skip`, `calib-start`, `calib-notice-close`).

## 3b. Quick (distance) calibration

Optional, for installations: also measures the distance scale (the camera's field of view).
Open **Settings → Camera & Parallax → Distance scale (advanced)**.

1. Stand where players normally stand, at the *reference distance* from the screen
   (`refDistance`; defaults: desktop 0.62 m, 32" 0.62 m, 86" 0.95 m — measure it once
   with a tape for a kiosk).
2. Look at the middle of the screen and hold still.
3. Press **Calibrate this position** and keep still for about one second.
4. Move left / right, up / down, closer / further to check the result. **Re-centre
   here** makes the current position the centre again without changing the scale.

What the routine does (`src/tracking/calibration.ts`):

- waits until ~1 s of samples are stable (eye position jitter < 14 % of the eye
  distance, scale jitter < 3.5 %), otherwise fails with `unstable` / `no_face` after 5 s;
- solves the camera's focal constant so that the eyes are exactly `refDistance`
  in front of the screen plane, taking camera position and tilt into account. This
  absorbs both the unknown field of view of the webcam and the size of the player's face;
- stores the measured eye position as the neutral pose.

Results are written to the active display profile:

| setting | meaning |
| --- | --- |
| `profiles.<id>.view.calDepthK` | focal length (px at a 640 px wide frame) × 63 mm. `0` = not calibrated, derive from `hfov` |
| `profiles.<id>.view.calNeutral` | measured eye position (window space) that maps onto the reference eye |
| `profiles.<id>.view.calibrated` | `true` once a calibration or re-centre exists |

**Modes** (`view.mode`)

- `relative` (default): `viewpoint = eye + gain × (measured − calNeutral)`. The calibrated
  pose always maps onto the reference eye `view.eye`, movement around it is 1:1 (with
  gain 1). Robust against imprecise mounting values.
- `absolute`: `viewpoint = eye + gain × (measured − eye)`, i.e. the measured position is
  used directly. Physically exact only if the camera position, tilt and the depth
  calibration are right.

Before any calibration both modes behave like `absolute` with the estimated field of
view (`hfov`, default 63°) and an average face size. Typical uncalibrated error: depth
scales with the real / assumed focal length (a 78° webcam configured as 63° reads
~25 % too far); sideways positions are affected far less.

---

## 4. Parameters

Per display profile (`profiles.<id>.view`):

| field | unit | meaning |
| --- | --- | --- |
| `screenW`, `screenH` | m | size of the visible picture |
| `bottomElevation` | m | height of the bottom edge above the floor (installation note, used for eye-height hints) |
| `windowMode` | – | `fullscreen`: the canvas is the whole panel. `window`: a browser window; its physical size and offset are derived from CSS pixels (approximate) |
| `eye` | m | reference (neutral) eye position relative to the window centre |
| `camPos` | m | lens position relative to the screen centre (x right, y up, z towards the viewer) |
| `camPitch` | ° | positive = camera tilted **down** |
| `camYaw` | ° | positive = camera turned towards the viewer's **right** |
| `camRoll` | ° | fine roll, clockwise as seen by the viewer |
| `camRotation` | 0/90/180/270 | clockwise rotation that makes the camera image upright (sideways mounted sensors) |
| `hfov` | ° | horizontal field of view of the raw frame; only used while `calDepthK = 0` |
| `mirror` | – | on only if the camera itself delivers a mirrored image |
| `mode` | – | `relative` / `absolute`, see above |
| `gainX/Y/Z` | – | sensitivity per axis, 1 = physically correct |
| `maxOffset` | m | soft limit of the offset from `eye` (linear up to 75 %, then a smooth shoulder) |
| `minDistance` | m | the viewpoint never gets closer to the screen |
| `refDistance` | m | distance from the screen during the distance calibration (3b) |

Global (`camera`):

| field | default | meaning |
| --- | --- | --- |
| `enabled` | on | Head Tracking / Window Perspective |
| `deviceId` | – | preferred camera (falls back to any camera if it is gone) |
| `resolution` | 480p | requested frame size (360p / 480p / 720p); the negotiated size is shown in the status |
| `inferenceHz` | 18 | upper bound for inferences per second (one inference in flight, newest frame only); `lowPower` caps it |
| `numFaces` | 2 | faces watched, so bystanders can be told apart from the player |
| `delegate` | auto | `auto`, `gpu`, `cpu` – see "Backends" |
| `smoothMs` | 70 | time constant of the per-frame follow smoothing |
| `filterMinCutoff`, `filterBeta` | 1.4 Hz, 6 | One Euro filter (positions in metres) |
| `deadzoneMm` | 2 | movements smaller than this are ignored |
| `outlierM` | 0.35 | larger jumps between two samples are ignored unless they persist (≥ 3 samples, ≥ 180 ms) |
| `lostHoldMs` / `returnMs` / `reacquireMs` | 700 / 1500 / 450 | loss handling |
| `autoCalibrate` | on | countdown calibration after every camera start (section 3) |
| `calibrationSeconds` | 3 | countdown length, s |
| `headWeight` | 0.4 | head-turn effect (0 = off), see section 3 |
| `lowPower` | auto | phone / low-power capture: 360p, ≤ 12 Hz, 1 face (`auto` / `on` / `off`) |
| `headBaseline.<id>` | 0 / 0 | head-direction baseline per preset, written by the countdown calibration |

The manual **test viewpoint** sliders move the viewpoint by hand (same soft limits).
They are reported as source `test` everywhere and are never shown as camera tracking.

---

## 5. Nominal geometry

| profile | picture W × H | reference eye (x, y, z) | camera (x, y, z), pitch | notes |
| --- | --- | --- | --- | --- |
| Desktop | 0.531 × 0.299 m (24" 16:9, editable) | 0, 0.14, 0.62 | 0, 0.16, 0 · 4° | webcam on top of the monitor; `windowMode: window` |
| Portrait 32 | 0.398 × 0.708 m | 0, 0.20, 0.62 | 0, 0.37, 0 · 8° | camera on the top edge |
| Portrait 86 | 1.071 × 1.904 m | 0, 0.50, 0.95 | 0, 0.98, 0 · 18° | camera on the top edge, bottom edge 0.12 m above the floor |

These are starting values for nominal 9:16 panels. Measure the real installation:

- **picture size**: the lit area, not the bezel;
- **camera position**: from the centre of the picture to the lens (86": the top edge is
  0.952 m above the centre);
- **reference eye**: where a typical player's eyes are. Eye height above the floor minus
  (`bottomElevation` + `screenH / 2`) gives `eye.y`; e.g. 1.60 m eyes, 86" panel 0.12 m
  above the floor → `1.60 − (0.12 + 0.952) ≈ 0.53`. Lower it for venues with many children;
- **UI anchor** (`layout.anchorY`) and eye height are independent settings.

The projection only needs the *ratio* between eye position and window size, so the
same code drives a life-size 86" cabinet and a miniature on a desktop monitor.

---

## 6. Mounting notes

- Put the camera on the vertical centre line, on the top (or bottom) edge, lens flush
  with the screen plane (`camPos.z ≈ 0`).
- Tilt it so that a player at the usual position is roughly in the middle of the
  picture; enter that tilt as `camPitch` (down = positive). An 86" panel with a camera
  1 m above the picture centre needs about 15–25° down.
- A wide lens (≥ 70° horizontal) is recommended for 86" so that tall and short players
  stay in frame at 0.6–1.5 m. Portrait panels: mount the camera sideways if that gives
  more vertical coverage and set `camRotation` to the value that shows faces upright in
  the preview.
- Front light on faces helps; strong back light (windows, spotlights behind the player)
  hurts. Masks and sunglasses reduce accuracy; a cap over the eyes can prevent detection.
- Pages must be served over **HTTPS or `http://localhost`**. In a kiosk shell that embeds
  the game in an `<iframe>`, add `allow="camera; autoplay; fullscreen"`.
- The camera permission is requested on the first press of Start. If it is denied,
  ignored, missing or busy, the game simply runs with the fixed reference viewpoint.

---

## 7. Integration (developers)

```ts
import { createFaceTracker } from '@/tracking';

const tracker = createFaceTracker();
tracker.configure({ camera: settings.camera, view: profile.view, window: physicalWindow });
tracker.onCalibration(({ values }) => saveToActiveProfile(values)); // then configure() again
startButton.onclick = () => void tracker.start();                   // never await this in the game flow

// every render frame
const source = tracker.sampleEye(performance.now(), eye);           // metres, window space
eyeToWorld(layout, eye, world);                                     // src/perspective/windowGeometry.ts
camera.setEyeWorld(world[0], world[1], world[2]);
```

- `PhysicalWindow = { widthM, heightM, centerOffsetM }` is the game window on the
  physical screen (`computeWindowLayout()` in `src/perspective/windowGeometry.ts`
  provides `physWidth`, `physHeight`, `physOffsetX/Y`).
- `start()` resolves when start-up settled; while the browser prompt is open it stays
  pending. `sampleEye()` always returns a usable viewpoint.
- `stop()` (or `camera.enabled = false`) stops every `MediaStreamTrack`, terminates the
  worker and releases the model. `setPaused(true)` pauses inference for hidden tabs
  without releasing the camera.
- Calibration values are applied inside the tracker immediately, but the application
  owns the settings: persist the `CalibrationEvent` values and pass them back through
  `configure()`, otherwise the next `configure()` call reverts them (`baselineWrites()` lists
  the writes; the head-direction baseline is only replaced when the configured value changes).
- `startCalibration(seconds)` / `cancelCalibration()` run the countdown calibration;
  `setActiveProfile(id)` (or `TrackerConfig.profile`) selects the preset whose
  `camera.headBaseline` is used. The game passes `profile` with every `configure()` call
  (`Game.configureTracker`), so the active preset reaches the tracker even when no overlay is mounted. The automatic start is not inside the tracker: it is the pure
  `AutoCalibrationPolicy` (`src/tracking/autoCalibration.ts`), driven from the overlay.
- `diagnostics()` also reports the head direction (`measurement.head`), the capture parameters
  really in use (`capture`), the head baseline and the last captured baseline.
- `tracker.diagnostics()` exposes the probe log of every backend, the latest
  measurement and counters for the diagnostics panel.

### Backends

Nothing is assumed to work; every backend is created and validated with a real
inference before it is used:

| `camera.delegate` | order |
| --- | --- |
| `auto` | worker + GPU → worker + CPU → main thread + CPU. A GPU delegate that would run on a software rasteriser (SwiftShader, llvmpipe) is skipped in favour of the CPU path |
| `gpu` | worker + GPU → main + GPU → worker + CPU → main + CPU |
| `cpu` | worker + CPU → main + CPU |

A backend that fails three inferences in a row while running is replaced by the next
one. MediaPipe needs WebGL2 to upload frames even with the CPU delegate.

On hardware where the game and the tracker share an integrated GPU, `cpu` can be the
better choice (it keeps the GPU for rendering); compare both with the performance panel.

### Assets

`npm run assets:tracking` copies the WASM runtime from the pinned
`@mediapipe/tasks-vision` package to `public/mediapipe/wasm/` (git-ignored) and verifies
`public/mediapipe/models/face_landmarker.task` (size + SHA-256, re-downloaded only if
missing or corrupt). Nothing is loaded from a CDN at run time.

---

## 8. Privacy

- Video only (`audio: false`); the camera is opened only after the player pressed Start.
- Frames and landmarks are processed in memory on the device. Nothing is recorded,
  stored or sent — not to the AI guide either. Only the eye position (three numbers) leaves
  the tracking module, and only to the renderer.
- MediaPipe Tasks 1.x contains a usage-metrics logger that would upload performance
  statistics to `odml.pa.googleapis.com` every minute and when a task is closed (see the
  "Privacy Notice" in the package README). The tracker switches that logger off right
  after creating the task, and the inference worker additionally refuses every
  non-local network request. Verified by monitoring all requests for 66 s plus shutdown.
- The preview exists only while the calibration panel is open.

---

## 9. Troubleshooting

| symptom | check |
| --- | --- |
| "Camera blocked on this page" | serve over HTTPS / localhost; iframe needs `allow="camera"` |
| "Camera not allowed" | allow the camera in the browser's site settings, then switch Head Tracking off and on |
| "No camera found" / "unavailable" | cable, another app using the camera, OS privacy switch |
| "Tracking could not start" | WebGL2 disabled or WASM blocked; see the probe log in diagnostics |
| view moves the wrong way sideways | `mirror` is set wrongly (or a mirroring virtual camera is in use) |
| view tilts / moves diagonally | `camRotation` wrong (faces must be upright in the preview) or `camRoll` |
| depth effect too strong / weak, distance wrong | run the distance calibration (3b, *Distance scale (advanced)*) at a measured `refDistance` |
| view is offset although standing centrally | re-centre, or check `camPos` / `camPitch` in absolute mode |
| jitter while standing still | raise `deadzoneMm` or `smoothMs`, lower `filterMinCutoff` |
| view lags behind | lower `smoothMs`, raise `filterBeta`, raise `inferenceHz` if the device can do it |
| someone else is being followed | they were the first steady face in the centre; the lock is released ~2 s after they leave |
| tracking rate low | lower `resolution`, set `numFaces` to 1, try `delegate: cpu` / `gpu`, or `lowPower: on` |
| countdown ends with "Too much movement" | hold still for a second (a phone held in the hand: rest the elbows) and Retry |
| countdown ends with "Your face wasn't visible" | face the screen, light on the face, not too far / too close to the camera |
| view drifts sideways when only turning the head | intended head-turn effect; lower `headWeight` (0 = off) |
| phone: view off-centre after turning it | calibrate again (the prompt / automatic countdown follows a rotation) |

---

## 10. Verified / not verified

Automated (run `npx vitest run tests/unit/tracking tests/unit/perspective`):

- off-axis projection: window corners stay at the screen corners for arbitrary eye
  positions, window-plane points are fixed, parallax matches the similar-triangles
  formula per depth, `near < eye distance`, matrix equals Three's `makePerspective`,
  inverses in sync, `updateProjectionMatrix()` cannot reset the frustum, generalized
  projection for tilted windows;
- eye estimator with a synthetic pinhole camera: position error < 1 mm over the whole
  frame for 50–110° lenses and 0.35–2 m; depth changes < 0.5 % over ±35° yaw / ±25° pitch
  (naive inter-ocular distance: > 15 %); mirror, sensor rotation, noise, wrong focal length;
- camera transform, view mapping, One Euro frame-rate independence, outlier / dead zone,
  hold / return / re-acquire timelines, passer-by scenarios, calibration maths, backend
  selection, permission error mapping and the tracker life cycle with fake camera + backend.

Real browser (headless Chromium, software WebGL, cloud container; fake camera fed with
a looping clip built from MediaPipe's own sample portrait — **not** a live person):

- worker + CPU, worker + GPU, main + CPU and main + GPU all initialise; `auto` picks
  worker + CPU here because WebGL is SwiftShader. Inference at 640×480: ~30–50 ms on the
  CPU path, ~160–240 ms with the GPU delegate on software WebGL;
- face moved towards image-left / right / up / closer → measured eye moves to +X / −X /
  +Y / nearer with the expected magnitudes; identical results for a 90° rotated sensor
  clip with `camRotation = 90`;
- loss → hold → return → neutral → re-acquire; a larger second face crossing the picture
  does not move the viewpoint; calibration, re-centre and test viewpoint;
- no device, permission denied, insecure origin, iframe without / with `allow="camera"`;
  `stop()` ends the video track (`readyState: "ended"`), restart works; production build
  of the worker; no external network requests.

Countdown calibration (this round, unit tests in `tests/unit/tracking/`: `countdown`,
`countdownTracker`, `autoCalibration`, `headPose`, `baseline`, `devicePolicy`,
`calibrationOverlay`): the countdown state machine and its 3-2-1 timing, averaging of
synthetic noisy sample streams (40 noise seeds: steady players always pass, 6 cm/s sideways
or 10 cm/s towards the screen always fail), `no_face` / `unstable` / camera failures,
cancel without changing the baseline, retry, waiting for the camera, stop / hide / unplug,
the baseline-relative mapping with the head-turn term (sign, magnitude, gain 0, limits) on the
fake-camera tracker with synthetic faces, per-preset persistence through the settings store
and a reload, the automatic-start policy (enable / re-enable, round gate, dialogs, hidden
page, rotation, skip), phone capture parameters and overlay placement inside the 86" band.
These use synthetic landmarks, not a person.

Not verified here (needs real hardware / people):

- the countdown calibration, the stability thresholds and the head-turn effect with a real
  person in front of a real camera, on a real phone (front camera, rotation, battery /
  thermal behaviour, iOS Safari / Android Chrome), on real 32" / 86" panels;

- a live human in front of a real camera: sideways / vertical / depth movement, turning
  the head in place, loss and re-capture, a real passer-by, glasses, masks, lighting;
- accuracy of the default mounting values on real 32" / 86" panels;
- inference rate and GPU-vs-CPU choice on the target Ryzen 7 7840HS / Radeon 780M, and
  the frame-time impact of tracking on the game;
- Safari and Firefox (only Chromium was run).
