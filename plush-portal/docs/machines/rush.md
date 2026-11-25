# SPARKLE RUSH (`rush`)

A timed score attack: 75 s of simulated time of quick grabs in a pile of giant gems and coins, scored
by value, with a local top-10 ranking. Design: `docs/design/machines.md`, section 3.3 (and the
scoop of section 2.7, notes WS-S). Code: `src/game/machines/rush.ts` (genre module, pile, the
scoop's numbers), `src/game/machines/pieces.ts` (shared item parts), `src/physics/ClawRig.ts`
(`fitScoop`).

**Status: `available: false`** only because the pile is not drawn yet. Every gate passes on Easy and
Arcade with the scoop and `rewardValue` 700; Skill stays under the caging and prize-share gates
(see *Gates*).

The sweep also exposes a timer defect in `PlaySession` (WS-A; see *Timer*).

## Machine

- Geometry: `CLASSIC_FIELD` itself (floor, chute, 20 cm guard, sensor and bin as classic), so the
  classic dressing draws it. A piece on the floor can only arrive carried, never pushed in.
- The claw carries a **scoop** (below), fitted by `rushModule.createField` while the stack is built.
- A try (`RushRules`, `ItemRules`): full lift; **always to the chute** (`CLAW.dropX / dropZ`, waiting
  for the swing to calm), whatever the cup carries rides along; SETTLING ends once every piece in
  play has been slower than 2 cm/s for 0.3 s (at least 0.3 s; cap 5 s). Pieces score once each in
  READY … SETTLING by the opening test; `won` with ≥ 1 piece, else `empty`.
- Claw scale: move ×1.2, descend ×1.25, lift ×1.25, close ×1.2 (design) **plus `ropeSwing` ×0.5**: a
  stiffer cable leaves less swing to wait for before a grab and over the chute (11-12 → 13 tries per
  run without the scoop, 12 with it). Move ×1.3 did not add a try (12, range 11-13).
- Session: `timed`, `seconds` (75) on simulated time (PlaySession), starting at the first input.
  Game's auto-advance between tries is 0.35 s.

## The scoop (`RUSH_SCOOP`, `ClawRig.fitScoop`)

Three curved petals, one on each finger tip. Each petal is two wall plates on an arc around the
claw's axis and two floor strips reaching in towards it, fixed to its finger body in the closed
pose; petals never collide with each other (claw parts only meet statics and toys).

| Number | Value | Meaning |
| --- | --- | --- |
| `closedAngle` | 0.10 rad | the fingers stop closing here: the petals meet as a cup of radius 3.93 cm (the finger tips' distance from the axis at that angle) |
| `halfAngle` | 1.0 rad | each petal covers 115° of the ring; closed, three narrow slits remain between them |
| `segments` / `floorSegments` | 2 / 2 | wall plates and floor strips per petal (12 colliders in all) |
| `wallHeight` | 3 cm | wall above the floor's outer edge |
| `floorTilt` | 0.2 rad | the floor rises towards the wall: a shallow cone (0.7 cm over the radius) |
| `floorInner` | 5 mm | where the floor strips end near the axis |
| `thickness` | 3 mm plates | — |
| `mass` | 120 g for the three | friction 0.9 (walls and floor) |

How it catches: while the claw is open the petals stay within the bare claw's reach (about 0.10 m
from the axis) and each floor strip hangs lowest at its inner edge, so the claw lands on those edges
around the target. Closing drives the edges in along the floor, rising about a centimetre: they slide
under the target and whatever lies between the fingers, and the walls close the cup around them.

The fingers' `setFingers(0..1)` spans `closedAngle … openAngle` with a scoop. Classic, bridge and
shelf never call `fitScoop`: their claws have no petal, close to 0 as before, and the classic golden
trace is identical.

**Look** (`ClawVisual`): each petal is a revolved shell with a rolled rim and closed ends in the
theme's claw lacquer (`clawCap`), plus a chrome bead along the rim at High and Ultra. Open, three
lacquered petals sit at the finger tips; closed, they read as a cup under the hub (checked on a
Medium page at 1920 × 1080, the rush scoop fitted to the classic claw through the debug API, since
rush is not offered yet).

## Pieces (`RUSH_PIECES`, `pieceCounts`)

| Look | Collider | Radius (m) | Mass | Value | Count (44) |
| --- | --- | --- | --- | --- | --- |
| `gemEmerald` | 17-point brilliant hull | 0.034 × `radiusScale` | 30 g | 10 | 14 |
| `gemSapphire` | same | 0.036 | 32 g | 25 | 10 |
| `gemRuby` | same | 0.038 | 34 g | 50 | 6 |
| `gemDiamond` | same | 0.040 | 36 g | 150 | 2 |
| `coin` | 12-gon prism hull, 10 mm | 0.026 | 12 g | 5 | 12 |

Friction 0.7, restitution 0.1, damping 0.3 / 1.5. `pieces` (24-48) scales the mix by largest
remainder, always with at least one diamond. The pile is **one layer** on a hexagonal grid (pitch
**0.09 m**, 66 cells for 44 pieces, ±4 mm jitter) over the claw's reach plus 4 cm, clear of the glass
and the chute guard (`isFreeSpot`). Every piece is placed in its **resting pose at its resting
height**: a quarter of the gems table-down, the rest on a pavilion facet (table tilted
atan 0.86 = 40.7°, so the facet lies flat), coins flat. The total value of a full pile is 1050.

- Pitch: with the scoop a centred grab brings 1.34 pieces at 9 cm and 1.22 at 10 cm (32 seeds × 10
  grabs each): more neighbours lie within the closing petals.
- Poses: a gem placed at the old 70° rolled back to 40.7°, about 9 mm, into its neighbours. In the
  resting pose a fresh pile is at rest at once (0.34 s, the settle's minimum, on every sweep seed).
- `RushField.settle` ends with up to 0.75 s of undamped steps when the damped part has not brought
  the pile to rest: the per-step damping kept a coin wedged 6 mm into the floor under a ruby's edge
  shivering until the cap (one fresh pile in 32 at 9 cm); undamped, the solver frees it in a few
  steps (2.61 s in all).

Pieces dropped on top of the layer (the design's "a few on top") rolled off for seconds — fresh piles
did not settle within 3 s — and a deeper pile did not make a grab cage more (bare claw, topShare 0.3:
1.00 per grab, 0.45: 0.83).

## Points, prize, ranking

- Points (`rushModule.scoreTry`): Σ value × difficulty, +25 % for a handful (3+ pieces in one try),
  × the daily bonus once. `extras`: `handful`, `daily`.
- Prize (`rushReward`): raw value (Σ values, no multipliers) ≥ `rewardValue` (**700**) → one prize;
  tier by band (≥ 1× common, ≥ 1.5× rare, ≥ 2× epic, ≥ 3× legendary); the first character of that
  tier in `session.prints` (the app orders it least-collected first), falling back to lower tiers.
  `rewardValue` 0 = never.
- Ranking data shape (for WS-D's `src/persistence/machines.ts`): `RankEntry { initials, score, at,
  difficulty }`, `RANK_SIZE` 10, `INITIALS_PATTERN` `/^[A-Z]{3}$/`, `rankPosition` / `insertRank`
  (score descending, the older entry first on a tie) and `runPoints` (a run's points without the daily
  bonus). Demo rounds never start a session, so they never produce a run to rank.
- Pilot (`rushAim`): the best value-within-7-cm / (1 + distance) target with room around it, aimed at
  its centre of mass; patience 1.0 s. Attract refills below 50 % of the pile.

## Gates (`npx tsx tools/dev/item-sweep.ts --machine rush --difficulty all --perf`)

Per difficulty: 8 seeds × (10 centred grabs on a fresh pile, no aim noise) and 48 timed runs (6 per
seed) by the pilot with 2 cm Gaussian aim noise, the 0.35 s hold in RESULT and the bin cleared at
every boundary. About 11 min for all three presets under a load average of 8-10.

| Gate (design 3.3) | Target | Easy | **Arcade** | Skill |
| --- | --- | --- | --- | --- |
| pieces per centred grab | ≥ 1.2 | 1.31 | **1.31** | 1.13 (fail) |
| run tries that score | ≥ 70 % | 94 % | **93 %** | 91 % |
| tries per 75 s run (median, range) | 12-16 | 12 (10-13) | **12 (11-13)** | 12 (11-13) |
| physics step p95 in busy phases | ≤ 1.5 ms | 1.01 ms | **0.93 ms** | 0.97 ms |
| runs reaching `rewardValue` 700 | 25-35 % | 27 % | **27 %** | 21 % (fail) |
| pieces scored without a carry (centre of mass never above the 20 cm guard) | 0 | 0 | **0** | 0 |
| runs that let a try start after the clock ran out | 0 | 0 | **0** | 0 |
| anomalies | 0 | 0 | **0** | 0 |

Centred grabs (Arcade): 0 × 1, 1 × 54, 2 × 24, 3 × 1. Run tries (Arcade): 0 × 41, 1 × 376, 2 × 156,
3 × 11, 4 × 1. Step time (Arcade, busy phases): p50 0.38 ms, p95 0.93 ms, p99 1.32 ms; single
outliers of 25-35 ms on this shared box. Without the scoop the p95 was 0.23-0.27 ms: pieces in the cup
touch several plates at once. Two plates of each kind per petal cost about a fifth less than three
with the same caging.

**Raw value per run** (Arcade, 48 runs, sorted): 360 395 420 490 515 515 555 555 565 565 575 590 590
595 595 605 605 610 610 610 620 630 635 645 645 650 665 665 670 675 680 690 695 695 695 700 700 700
700 710 715 730 735 740 740 750 750 765; median 645. At the settings step of 50: 600 → 69 %,
650 → 48 %, **700 → 27 %** (Easy 27 %, Skill 21 %). The first three runs of each seed alone (the
sweep's earlier 24 runs) gave 21 % at 700: the share's standard error over 24 runs is about 9
points, as wide as the band, hence 48 runs. `rewardValue` 700 is `RUSH_DEFAULTS` and the settings default `machines.rush.rewardValue`
(the contract test holds them equal).

Skill (cable swing ×0.85 before the rush scale, grip assist 0.6) lands off target more often: 10
of 80 centred grabs caught nothing (Arcade 1).

### Caging (what was tried)

Centred grabs as in the sweep (the pilot's targets, no aim noise, Arcade); "n" = grabs measured.
Before the scoop (WS-C, 4 seeds × 8 grabs): design 0.92; pitch 0.076 / 0.11: 0.88 / 0.92;
`radiusScale` 0.7 / 0.85 / 1.15 / 1.2: 0.71 / 1.04 / 0.92 / 1.04; 30 % / 45 % on top: 1.00 / 0.83;
close speed ×1.6: 1.00; claw force ×1.4: 1.04; aim at the value centroid: 0.88. The closed fingers
converge to about 2 cm from the axis: they hold the piece under the hub, and a neighbour between two
fingers is left behind.

| Attachment | n | Pieces per centred grab |
| --- | --- | --- |
| none (same runs, for comparison) | 32 / 320 | 0.91 / 0.90 |
| a disc on the hub, 12 cm under it, radius 6 cm (the design's "scoop disc") | 32 | 1.00 |
| flat plates on the finger tips (no closing stop) | 32 | 0.84-0.97 |
| tip plates with an inward lip | 32 | 1.00-1.09 |
| closing stop 0.22 rad, flat walls and lips | 32 | 0.81-0.97 |
| curved petals (a cup), flat floor, pitch 0.10, stop 0.12-0.21 | 32-80 | 0.88-1.13 |
| curved petals, flat floor, pitch 0.09 | 160 | 1.10-1.23 |
| … floor as one convex sector per petal instead of strips | 160 | 1.02-1.14 |
| … slick floor (friction 0.1, the plate's own value wins) | 160 | 1.21 |
| … narrower petals (0.7 rad) | 160 | 1.16-1.18 |
| … no walls | 160 | 1.10 |
| … floor tilted 0.3 rad / 0.5 rad (a shallow cone) | 160 | 1.33-1.35 / 1.26-1.30 |
| … tilt 0.3, stop 0.10 | 160 + 160 | 1.42, other seeds 1.31 |
| **tilt 0.2, stop 0.10, 3 cm walls, resting poses (built)** | 320 | **1.33**; walls 4 / 5 cm: 1.29 / 1.34 |
| built scoop, pitch 0.10 | 320 | 1.22 |

What still loses pieces:
- About one grab in ten lands with a petal on a neighbouring piece; the cup then closes above the
  target (0.3-1.0 pieces on those grabs). The floor tilt cut these landings most; narrower petals
  cut them further but caught less.
- In about one grab in 70-150 a piece wedges between a petal and the lower part of its finger rod
  and rides along to the next try (that try's SETTLING then runs to its 5 s cap).

### Timer

`PlaySession.preStep` handles the clock running out in AIMING (forced grab), READY (the run ends) and
busy phases (the run ends at the RESULT). In **RESULT** — Game's 0.35 s hold between tries — it marks
the run expired but neither ends it nor lets a later step do so, so the player gets one more full
try (WS-C saw 3 of 24 Arcade runs; none in the 144 runs of the final sweep). The fix belongs in
`src/game/machines/session.ts` (WS-A): end the run in RESULT as in READY.
`tests/unit/machines/rush.test.ts` holds it as an `it.fails` case that will flip when the fix lands.

## Unit tests

`tests/unit/machines/rush.test.ts`: classic geometry and claw scale; 44 pieces with the value table in
one layer clear of the guard; settle < 3 s (with the claw hanging from its cable, as GameCore
settles) and determinism; the pieces / radius settings; the scoop (only the rush claw has one and the
others keep three colliders per finger; `fitScoop` before or after the claw is built, once; the
fingers stop at the cup, whose floor then covers the axis and opens clear of it; a centred grab
cages ≥ 1.2 pieces on average over 2 seeds × 10 grabs); always to the chute; ≥ 60 % of well-aimed
grabs score; over 120 random grabs nothing scores without a carry; a 75 s run ends on time at a
RESULT with one prize at the threshold (and none above it) and a step p95 within 1.5 ms; no award
after the run; the timer edge cases (aiming, between tries, busy, and the RESULT hold as
`it.fails`); demo rounds never start a run; a classic → rush → classic round trip.
`tests/unit/machines/pieces.test.ts`: points, prize bands and order (default threshold 700),
ranking order and initials.
