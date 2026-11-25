# TUMBLE SHELF (`shelf`)

Stacks of small printed snack boxes stand on a raised shelf with a lip. The claw knocks, drags or
carries them over the edge; every box that reaches the trough counts, several per try are possible.
Design: `docs/design/machines.md`, section 3.2. Code: `src/game/machines/shelf.ts` (genre module)
and `src/game/machines/pieces.ts` (what the two items genres share).

**Status:** `available: true` (offered in the lobby) with `rewardItems` 5: the gate "30-60 % of
sessions reach the prize" contradicted "0.8-1.6 items per try" with 3 boxes for a 5-try session, so
the prize line was raised to 5 boxes (Arcade 41 % of sessions; see *Gates*).

## How to play (for players)

- Stacks of little snack boxes stand on a shelf. Knock, drag or carry them over the front edge: every
  box that lands in the trough counts, and several in one try are worth more (×1.2 for two, ×1.5 for
  three, ×2 for four or more).
- You get **5 tries** per session (*Tries per session*). Drop **5 boxes** in one session
  (*Boxes for a prize*) and you win a plush: the rarest character printed on the boxes you dropped.
  The prize comes with one claim code on the session card where prize codes are on.
- Bigger boxes and rarer characters score more; today's pick adds ×1.5 to the points (not to the prize).
- After the last try the session card sums it up; PLAY AGAIN restacks the shelf for a new session.

## Layout (`shelfGeometry`)

fieldSpec frame: +X right, +Y up, +Z towards the player, floor top y = 0, front glass z = 0.

| Part | Rapier | Numbers (m) | Friction / restitution |
| --- | --- | --- | --- |
| Floor | 2 cuboids from `floorWithHole` | hole = the trough | 0.95 / 0.02 |
| Shelf block | cuboid | x −0.5…0.5, z −0.80…−0.30 (`shelfFront`), y 0…0.16 (`shelfY`) | `shelfFriction` 0.55 / 0.02 |
| Lip | cuboid (omitted at `lipHeight` < 1 mm) | along the front edge, 12 mm deep, `lipHeight` 0.014 tall | 0.4 / 0.05 |
| Gutter | cuboid turned 9.09° about +z | the front-right strip x 0…0.5, z −0.30…0; top from y 0.02 at x 0 to 0.10 at the right glass | 0.05, combine **Min** / 0.02 |
| Opening `trough` | sensor | x −0.50…0, z −0.30…0, y −0.30…−0.10 (inside the bin footprint) | — |
| Bin, glass, back wall | classic, unchanged | — | — |

With the Min combine the gutter's friction angle is 2.9° against a 9.1° slope: a box on it always
slides left into the trough. The shelf's front face is the gutter's back wall, the right glass its
end wall. Nothing that leaves the shelf can come to rest outside the opening (the sweep checks it
after every try).

## Items

| Look | Size (x × y × z) | Mass | Prints | Points factor | Stacks (of 8) |
| --- | --- | --- | --- | --- | --- |
| `snackS` | 0.055 cube, round 3 mm | 60 g | common / rare | ×1 | 5 (3 high) |
| `snackM` | 0.075 × 0.06 × 0.05 | 90 g | any | ×1.25 | 2 (3 high) |
| `snackL` | 0.09 × 0.075 × 0.06 | 135 g | rare / epic / legendary | ×1.5 | 1 (2 high) |

23 boxes, friction 0.6, restitution 0.05, damping 0.3 / 1.5. Rows z −0.39 / −0.53, columns
x −0.30 / −0.10 / 0.10 / 0.30; which spot gets which size is seeded, and so are the jitter (±4 mm,
±6°) and the prints (a seeded shuffle of the theme's characters per tier, like
`ToyField.nextAsset`). The tallest stack top is 0.338 m. A fresh layout is placed at rest and settled
off-screen until every box is slower than 4 mm/s (stacked boxes lean into place slowly), with the
rocking of slow boxes damped during that settle only (as `ToyField` does for plush).

## A try (`ShelfRules`, `ItemRules`)

1. READY / AIMING with the joystick.
2. DESCENDING, CLOSING as classic.
3. LIFTING all the way (`CLAW.ropeMin`).
4. TRANSPORTING **forward, always**: same x, z = `dropZ` (−0.18), waiting for the swing to calm.
5. RELEASING over the trough (or the gutter, which drains into it).
6. SETTLING: the claw heads home; the try ends once every box in play has been slower than 2 cm/s
   for 0.3 s (at least 0.5 s after a carried box, 0.3 s otherwise; cap 5 s).

Every snack that passes the opening test (centre of mass below −0.06, over the trough or already
under the floor slab, a collider touched the sensor) in READY … SETTLING is scored once
(`RoundMachine.scoreItem`), marked `inBin` and announced with `itemScored`. A box that falls during
RESULT is credited at the next READY, to the next try. `resultExtras`: `won` with ≥ 1 item, else
`empty` (never `slipped`), and `machine.items`.

## Session, prize, points

- Session: `tries` (5) tries; at least `rewardItems` (5) boxes earn **one** prize, the rarest printed
  character among the dropped boxes, the earliest drop on a tie (`awardSessionPrize`,
  `${sid}-${lastRoundId}-S`). Then the claw is locked until PLAY AGAIN (`newSession` restacks).
- Points (`shelfModule.scoreTry`, pure): per box the print's tier base (40 / 100 / 200 / 400) × size
  factor, × difficulty, × multi-drop (2 ×1.2, 3 ×1.5, 4+ ×2), × the daily bonus once; no combo across
  tries. The result is a `RoundScore` plus `items`, `extras` (`multiDrop`, `daily`) and `dailyBonus`.
- Attract: `atBoundary('ATTRACT')` restacks when fewer than 60 % of the boxes are left; READY never
  refills (fallen stacks stay fallen). A takeover (`resetForTakeover`) restacks.
- Pilot (`shelfAim`): the box nearest the lip, aimed 4 cm in front of it so the back finger drags it
  forward; every third demo round the top of a back-row stack. Patience 1.5 s.

## Tuning

The design's claw (`gripAssist` ×0.6, full force) and 40 / 60 / 90 g boxes made the shelf trivial:
the three fingers close around a whole 3-high stack and the forward transport drops all of it.

| Claw scale, mass | Player | Items per try | Tries that score | Sessions ≥ 3 |
| --- | --- | --- | --- | --- |
| design (assist ×0.6), ×1 | pilot, no noise | 2.80 | 100 % | 100 % |
| design, ×1 | pilot + 2 cm noise | 2.04 | 83 % | 100 % |
| assist 0, force ×0.5, ×1 | pilot + 2 cm | 1.51 | 74 % | 100 % |
| assist 0, force ×0.3, ×1 | pilot + 2 cm | 1.10 | 61 % | 88 % |
| assist 0, force ×0.4, ×1.5 | pilot + 2 cm | 0.82 | 54 % | 69 % |
| assist 0, force ×0.5, ×2 | pilot + 2 cm | 0.72 | 48 % | 75 % |
| assist 0, force ×0.3, ×2 | pilot + 2 cm | 0.36 | 31 % | 31 % |

(4 seeds × 20 tries each, Arcade.) Chosen: **`claw` `{ gripAssist: 0, clawForce: 0.4 }` and the
masses ×1.5** (60 / 90 / 135 g): a weak claw with no
assist mostly brings one box, a whole stack only now and then (Arcade: 1 box in 114 of 320 tries,
3 in 30). Lip height, shelf friction and box
friction moved the numbers far less than the claw and the mass.

## Gates (`npx tsx tools/dev/item-sweep.ts --machine shelf --difficulty all --perf`)

8 seeds (11, 28, …, 130; themes rotate), 40 tries each = 64 sessions of 5 tries per difficulty, the
attract pilot's aim with 2 cm Gaussian noise, Game's auto-advance hold (1.15 s, 2.0 s after items),
the bin cleared at every boundary, PLAY AGAIN after each session. 128 s for all three presets.

| Gate (design 3.2) | Target | Easy | **Arcade** | Skill |
| --- | --- | --- | --- | --- |
| items per try | 0.8-1.6 | 1.18 | **0.85** | 0.64 |
| tries that score | ≥ 35 % | 73 % | **56 %** | 45 % |
| sessions reaching 3 boxes | 30-60 % | 92 % | **80 %** (fail) | 63 % |
| stacks stable (worst move in 5 s idle, 64 fills) | < 2 mm | 0.28 mm | **0.16 mm** | 0.42 mm |
| boxes at rest in front of the shelf | 0 | 0 | **0** | 0 |
| anomalies (NaN, escaped, watchdog, scored outside the trough) | 0 | 0 | **0** | 0 |

Per try (Arcade): 0 × 142, 1 × 114, 2 × 34, 3 × 30. 124 of the 272 scored boxes came down the
gutter. Physics step during play: p50 0.14 ms, p95 0.32 ms.

**Why the session gate cannot pass with 5 tries and 3 boxes.** At ≥ 0.8 items per try a session
averages ≥ 4 boxes; even with the clumpy distribution above (a whole stack now and then) about 80 %
of sessions reach 3. Below 60 % needs about 0.6 items per try (Skill: 0.64 → 63 %), which fails the
first gate. The two gates only meet with another prize threshold (same Arcade runs):

| `rewardItems` | Easy | Arcade | Skill |
| --- | --- | --- | --- |
| 3 (the design's number) | 92 % | 80 % | 63 % |
| 4 | 86 % | 63 % | 41 % |
| **5 (default now)** | 72 % | 41 % | 22 % |

Taken: `rewardItems` 5 (Arcade 41 %), in `src/settings/spec.ts` (`machines.shelf.rewardItems`) and in
`SHELF_DEFAULTS` together (the contract test holds them equal); the machine is `available: true`.

## Unit tests

`tests/unit/machines/shelf.test.ts` (geometry, Min combine on the gutter, 23 boxes in 8 stacks with the
tier rules, determinism, stability fresh and restacked, takeover restack and the 60 % attract refill,
one push = N scored items with distinct ids and one `won`, the gutter drains from any x, a fall in
RESULT counts for the next try, the forward transport, items per grab, the 5-try session and its
rarest-print prize, no credit after the session, demo rounds never start a session, the pilot, a
classic → shelf → classic round trip) and `tests/unit/machines/pieces.test.ts` (points, prize, pools).
