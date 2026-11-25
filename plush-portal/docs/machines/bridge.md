# TIPPY BRIDGE (`bridge`)

The first machine genre after the classic claw machine (design: [docs/design/machines.md](../design/machines.md),
section 3.1). A printed box lies across two chrome bars over a pit. The claw cannot carry it away:
each try lifts one end a few centimetres and lets go in place, and the box stays exactly where physics
left it until it drops through the pit into the classic prize bin. A drop is a win, decided only by the
same opening test as classic.

Code: `src/game/machines/bridge.ts`. Tests: `tests/unit/machines/bridge.test.ts`. Sweep:
`tools/dev/machine-sweep.ts --machine bridge` (plug-in `tools/dev/sweeps/bridge.ts`).

## Layout as built

Fieldspec frame: +X right, +Y up, +Z towards the player, floor top y = 0, front glass z = 0.

| Part | As built | Design (3.1) |
| --- | --- | --- |
| Pit (floor hole + sensor) | x −0.42 … 0.02, z −0.38 … −0.06, sensor y −0.30 … −0.10, awardComY −0.06, overMargin 0.02 (inside `BIN`) | same |
| Bars ×2 | capsules along z, r 0.012, half length 0.15, centres x −0.287 / −0.113, y 0.10, z −0.22; inner gap 0.15 | same |
| Bar friction | **0.15, the bar's friction wins** (`frictionCombine: 'min'`: slick chrome) | 0.35, averaged with the box |
| Fences ×4 | acrylic, 0.01 thick, framing the pit, **0.22 high** | 0.16 high |
| Box | **0.24 (x) × 0.10 (y) × 0.10 (z)**, round 4 mm, 0.40 kg, friction 0.6, damping 0.35 / 2.2 | 0.24 × 0.10 × 0.13 |
| Start pose | centre of mass (−0.20 ± 0.01, 0.1625, −0.22 ± 0.02), yaw ± 4°, seeded by (seed, reset count) | same |
| Claw scale | move ×0.9, descend ×0.8, lift ×0.6, **force ×1.0**, grip assist ×0 | force ×0.8 |
| Partial lift | `liftDelta` 0.08 m from where the fingers closed | same |
| Home | (0.20, −0.50); two-step controls (−0.37, −0.13) | same |

`gap`, `boxMass`, `triesPerBox` and `controls` keep their settings defaults (0.15 m, 0.4 kg, 0, joystick).

## One try (`BridgeRules`)

1. READY / AIMING: the joystick, or the two-step buttons (below).
2. DESCENDING with classic landing detection, CLOSING.
3. LIFTING to the rope length at closing − `liftDelta`: one end comes up, the box is never carried.
4. TRANSPORTING in place, RELEASING (fingers open where they lifted).
5. SETTLING, the careful wind-up (all in `BridgeRules.windUp`):
   - **free**: fingers fully open, cable held, until the claw has not touched the box for 0.1 s
     (at most 0.5 s);
   - **wind**: the cable winds up; at 0.06 m/s while the claw still touches the box (for at most
     1.5 s of rubbing), at full lift speed otherwise. If the box rises with the claw (a finger hooked
     into it: centre of mass 8 mm above where it was), a **slip clutch** holds the cable whenever it
     pulls more than the claw's weight + 2 N, and after 0.4 s of holding the cable pays out 3 cm for
     0.3 s so the finger can slip out. A hooked box is tipped off the finger, never yanked up and flung.
   - **home**: the trolley heads home only once the cable is up. The claw never sweeps across the box
     low.
6. The try ends when the claw is up and on its way home (5 cm from the release spot, or home) and the
   box has been calm (< 0.02 m/s, < 0.2 rad/s) for 0.3 s; after 5 s it stops waiting for calm, never
   for the claw. The 7 s SETTLING watchdog stays behind all of it; a try that it ends with the claw low
   finishes its wind-up at the next READY before the trolley moves.

### Winning

The box wins when the opening test of section 2.5 holds: centre of mass below −0.06, over the opening
(± 2 cm), a collider in the sensor (`inOpening`). It is checked every step in every phase but ATTRACT;
the award is only paid in DESCENDING … SETTLING. A box that passes the test at another time (READY,
AIMING, RESULT) is remembered (`dropped`) and paid at the next DESCENDING: a box that falls while the
result is shown counts for the next try. Then `awardPrize(roundId, box.id, print)`, `box.inBin`,
`prizeDetected`; the result is `won` with the box and its print as the target. Every other try is
`empty` (never `slipped`: every lift ends in an intended release). Nothing else (no timer, no roll, no
counter) can award a box.

In practice a box drops **between the bars**, the classic bridge drop: tries walk and turn it until one
end leaves its bar; that end drops into the gap and the box jams there at 35-40°; working the raised end
then lets it slip through. A box whose centre of mass passes a bar leans its far end on the side fence
(the 12 cm strip forces it nearly upright), so tipping over a bar is rare.

### Progress, stuck and "Call staff"

- **Progress** (presentation and guide only) = max(shift, tilt, turn), each 0..1: shift = |COM.x −
  centerX| / 0.087, tilt = |tilt| / 25°, turn = (L − span) / (L − gap) with span = L·|cos yaw| +
  W·|sin yaw|. It is in `result.machine.progress` / `progressGain`.
- **Stuck** (`result.machine.stuck`, `field.stuck()`), evaluated at RESULT. A try is *stale* when it
  leaves the box off the bars and moves it less than 5 mm and turns it less than 3°. The box is stuck
  when it is sunk deeper than 4.25 cm below its resting height (the design's "COM y < 0.12") and one
  stale try has passed (`wedged`), or after 3 stale tries in a row (`stale`). A box lying on both bars
  is never stuck. (Progress saturates at 1 for a tilted box, so the pose is compared, not progress.)
  The usual jam before a drop is only 1.8 cm below rest and is not called stuck after one miss.
- **Call staff** (`field.staffReset()`, boundary only): the box goes back to its next seeded start pose
  (same body, same print). Never an award. Refused for a won or dropped box and while the claw hangs
  low over the pit. Attract mode calls staff by itself at the ATTRACT boundary.

### Field (`BridgeField`)

- `fill`: the prints are a seeded shuffle of the theme's characters; the first box is placed at rest.
- `atBoundary` (READY, ATTRACT; GameCore settles it off-screen): a won box (or none) → the next printed
  box on its start pose; a box that fell unpaid → kept for its award when a player's READY follows,
  otherwise replaced; attract + stuck → staff reset; `triesPerBox` used up → back to the start pose
  (never a pity win). A placement waits, inside the off-screen settle, until no claw part hangs low
  over the pit (a box is never placed into the fingers).
- `resetForTakeover`: a new player gets the box back on its start pose (or a fresh box after a win).
- `missing()` is 0: the classic restock never runs here.

### Two-step controls (`controls: 'twoStep'`)

`BridgeRules.filterInput` (player rounds; demo rounds keep the joystick): stage `x`, button 1 held =
`inputX > 0` moves +x only (z input ignored, −x ignored); releasing it moves to stage `z`; button 2 held
= `inputZ < 0` moves −z only; releasing it drops the claw. The controller emits `axisStage` (`x`, `z`,
then `null`). The two-step home is the front-left corner.

### Attract pilot (`bridgeModule.aim`, `bridgeAimAt`)

The end of the box already further from the middle (by round on a centred box), 1.5 cm in from it along
the box's long axis and **2.5 cm towards the player** (`BRIDGE_AIM.dz`: the claw's back finger is 0.10 m
behind its axis, the two front ones 0.05 m in front, so this puts every finger beside a 0.10 m box
instead of one on its top). A box tilted more than 12° is worked at its raised end. Patience 2.5 s.

## Tuning: what was measured

Every step below is a sweep of the real `GameCore` (tools/dev/machine-sweep.ts; small runs were
3-4 seeds × 25-30 tries, the decisive ones 8 seeds × 40 tries with 160 + 160 single tries).

1. **The design's numbers lift nothing.** With a 0.13 m deep box, one finger always lands on the box's
   top edge: the open claw spreads about 0.15 m front to back between its finger tips (back finger 0.10 m
   behind the axis, front fingers 0.05 m in front), less than 0.13 m plus two tip radii. The claw tips
   off, the other fingers scrape the faces, and the box moved about 1 mm per try (no win in 30 tries).
   The grip assist cannot help: it needs two fingers in real contact first.
2. **A 0.10 m deep box** lets the claw straddle it, but only within a ±1 cm band, and a squeeze in the
   middle then lifted the whole box. Two physics problems showed up and were fixed in the rules, not
   the numbers:
   - *the cable flung the box out of the pit*: a finger stayed hooked in the box after the release
     (fingers only 62 % open), the winch wound up against it, the stiff cable (2600 N/m) stored the
     energy and threw box and claw when the finger slipped → the careful wind-up with the slip clutch;
   - *a box was placed into the claw*: a try that ended with the claw still low (the old 5 s cap) let
     the next box be placed at its start pose inside the fingers → the cap never ends a try with the
     claw low, the field defers placement until the claw is clear.
3. **Slick bars make tries add up.** With friction averaged (0.475) most tries changed nothing and a
   few changed everything (median gain 0, stuck 25-50 %). With the bar's own friction winning (0.10-0.16)
   a lifted end lets the box slide on the other bar: median 4-7 tries, stuck 0-6 %. 0.10-0.13 gave too
   many one-try wins from random aims (12-17 %); 0.15-0.16 brought them down to about 2 %.
4. **Taller fences.** At 0.16 m a box sliding fast on the slick bars could jump the back or side fence
   (and land on the floor outside the pit). At 0.22 m none did in any later sweep.
5. **Claw force ×1.0.** ×0.8 lifts nothing; ×1.1 and ×1.2 hang the whole box from a lucky squeeze more
   often (random-aim one-try wins 2.5-4.4 %); ×1.0 keeps them near 2 % with the same median.
6. Tried and dropped: a wider pit (x half 0.24-0.25, so a box can tip over a bar): one-try wins rose to
   4.4 %; a slip clutch on the partial lift too (stop at the claw's weight + 60 % of the box's): the
   median rose to 15-20 tries and random one-try wins did not fall; a lower lift (0.05-0.07 m): no gain.

The knobs, if a gate drifts after integration: `barFriction` (most sensitive: +0.01 ≈ +1 try on the
median), `BRIDGE_LAYOUT.barCombine`, `claw.clawForce`, `liftDelta`, the box depth (`box[2]`), `gap`
(setting), `boxMass` (setting).

## Sweep results (gates of section 3.1)

`npx tsx tools/dev/machine-sweep.ts --machine bridge --difficulty all --perf`: 8 seeds × 40 tries per
difficulty, theme sakura, the attract pilot's strategy with a simulated player's aim error (σ 1 cm on x
and z, patience 2.5 s). "One-try" batches: 8 × 20 fresh boxes with the pilot's aim, 8 × 20 with random
aims anywhere over the box (± 16 cm × ± 11 cm, a player hunting for a lucky single try). Unfinished
boxes at the end of a seed count as "never won" in the median.

| Run | Boxes won / played | Median tries per box (won only) | p25-p75 (won) | One-try, pilot | One-try, random aims | First try on a box in play | Stuck boxes | Anomalies | Step median / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Arcade** (gate; seeds 11 + 17i) | 40 / 48 | **5.5** (5.0) | 4-8 | **1/160 (0.6 %)** | 3/160 (1.9 %) | 0/48 | **2/48 (4.2 %)** | **0** | **0.044 / 0.086 ms** |
| Arcade, independent seeds (`--seedBase 500`) | 48 / 55 | 5.0 (5.0) | 4-6 | 1/160 (0.6 %) | 2/160 (1.3 %) | 0/55 | 0/55 (0 %) | 0 | – |
| Easy | 39 / 46 | 6.0 (5.0) | 3.5-8.5 | 3/160 (1.9 %) | 6/160 (3.8 %) | 0/46 | 0/46 (0 %) | 0 | – |
| Skill | 47 / 52 | 5.5 (5.0) | 4-7 | 2/160 (1.3 %) | 3/160 (1.9 %) | 4/52 | 2/52 (3.8 %) | 0 | – |

Every run: 320 tries, about 7 s of simulated time per try, about 60-65 s of wall time on this shared
4-CPU machine. **The gates pass on Arcade on both seed sets, so the machine is `available: true`.** On
Easy (claw force 1.3) a hunt for a lucky single try wins 3.8 % of the time, above the 3 % this sweep
applies to random aims (the design's gate is the pilot's rate, 1.9 % there); Skill's in-play first
tries won 4 of 52 boxes (its 160-try batch: 1.3 %). Both are noted, not gated: the design gates are
Arcade's.

Design gates (Arcade): median tries per box 4-8, one-try wins < 3 %, stuck < 10 % of boxes, 0 anomalies,
median step ≤ 0.5 ms. Anomalies checked after every try: non-finite poses, escaped bodies, the box
leaving the pit, the box held up after a try, a try ending with the claw low, watchdog recoveries, more
than one award per try, a win without its award, an award without the opening test.

## Debug impulses (e2e)

`window.__plush.machineDebug.nudge(dx, dz, dy)` is an impulse (N·s) at the box's centre (no torque).
A single centred push cannot reliably win: it walks the box ~4 cm, its far end drops into the gap and the
box jams (the jam needs its raised end worked). The recipe used by
`tests/unit/machines/bridge.test.ts` ("the debug impulses the e2e uses"), on `?machine=bridge&seed=7`:

1. Start a player round; stay in READY (no grab yet). The box rests asleep, so the result does not
   depend on frame timing.
2. `nudge(0.2, 0, 0)`, `fastForward(1)`: the box jams in the gap.
3. Up to 12 times, while the box's `machineDebug.itemPoses()` y is above 0: on even turns
   `nudge(0, 0, 1)` (up), on odd turns `nudge(±0.2, 0, 0)` (−0.2 on turns 1, 5, 9; +0.2 on 3, 7, 11);
   `fastForward(1)` after each. Seed 7 falls after the first upward nudge; 38 of seeds 1-40 fall within
   12 nudges (seeds 31 and 32 stay jammed: use seed 7).
4. No award yet (READY is not an award phase). Drop the claw (`grab`), `fastForward(4)`: exactly one
   `award` (the fallen box is paid at that grab), the collection +1 for the print.

## Known limits

- The claw geometry decides the box depth: a deeper box needs a different claw (out of scope, 2.7).
- Wins are mostly drops between the bars after a jam; a box leaning on the side fence with its centre
  of mass past a bar can need several tries (or staff).
- The two-step mapping assumes the app feeds button 1 as `inputX > 0` and button 2 as `inputZ < 0`.
- No rendering here: the box (`ItemVisuals`), the bars, fences and the floor with its hole (`Cabinet` +
  `src/scene/machines`) are WS-E's. Until they land, `?machine=bridge` in the browser plays the right
  physics in a classic-looking cabinet with nothing of the bridge drawn.
