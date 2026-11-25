# SPARKLE RUSH (`rush`)

A timed score attack: 75 s of simulated time of quick grabs in a pile of giant gems and coins, scored
by value, with a local top-10 ranking. Design: `docs/design/machines.md`, section 3.3. Code:
`src/game/machines/rush.ts` (genre module) and `src/game/machines/pieces.ts` (shared item parts).

**Status: `available: false`.** Two gates fail:
1. **Caging**: a centred grab delivers 0.74-0.91 pieces (target ≥ 1.2). No value tuning gets the
   three-finger claw to hold more than one gem; this needs the design's fallback, the hub scoop
   attachment (section 2.7, WS-A's `ClawRig` / `PhysicsWorld`).
2. **Prize share**: at the default `rewardValue` 450, 67-79 % of runs qualify (target 25-35 %); the
   measured value is **600** (Arcade 29 %), a settings default change (see below).

The sweep also exposes a timer defect in `PlaySession` (WS-A; see *Timer*).

## Machine

- Geometry: `CLASSIC_FIELD` itself (floor, chute, 20 cm guard, sensor and bin as classic), so the
  classic dressing draws it. A piece on the floor can only arrive carried, never pushed in.
- A try (`RushRules`, `ItemRules`): full lift; **always to the chute** (`CLAW.dropX / dropZ`, waiting
  for the swing to calm), whatever the fingers caged rides along; SETTLING ends once every piece in
  play has been slower than 2 cm/s for 0.3 s (at least 0.3 s; cap 5 s). Pieces score once each in
  READY … SETTLING by the opening test; `won` with ≥ 1 piece, else `empty`.
- Claw scale: move ×1.2, descend ×1.25, lift ×1.25, close ×1.2 (design) **plus `ropeSwing` ×0.5**: a
  stiffer cable leaves less swing to wait for before a grab and over the chute (11-12 → 13 tries per
  run).
- Session: `timed`, `seconds` (75) on simulated time (PlaySession), starting at the first input.
  Game's auto-advance between tries is 0.35 s.

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
0.10 m, ±4 mm jitter) over the claw's reach plus 4 cm, clear of the glass and the chute guard
(`isFreeSpot`); a quarter of the gems lie table-down, the rest on a pavilion facet; coins flat. The
total value of a full pile is 1050.

Pieces dropped on top of the layer (the design's "a few on top") rolled off for seconds — fresh piles
did not settle within 3 s — and a deeper pile did not make a grab cage more (topShare 0.3: 1.00 per
grab, 0.45: 0.83). With one layer, 30 of 32 fresh layouts (8 seeds × 4 restacks) came to rest in
0.4-0.9 s; the other two ran to the 3 s cap with one coin still spinning slowly on the floor.
Off-screen settles damp slow rocking, as `ToyField`
does for plush.

## Points, prize, ranking

- Points (`rushModule.scoreTry`): Σ value × difficulty, +25 % for a handful (3+ pieces in one try),
  × the daily bonus once. `extras`: `handful`, `daily`.
- Prize (`rushReward`): raw value (Σ values, no multipliers) ≥ `rewardValue` → one prize; tier by band
  (≥ 1× common, ≥ 1.5× rare, ≥ 2× epic, ≥ 3× legendary); the first character of that tier in
  `session.prints` (the app orders it least-collected first), falling back to lower tiers.
  `rewardValue` 0 = never.
- Ranking data shape (for WS-D's `src/persistence/machines.ts`): `RankEntry { initials, score, at,
  difficulty }`, `RANK_SIZE` 10, `INITIALS_PATTERN` `/^[A-Z]{3}$/`, `rankPosition` / `insertRank`
  (score descending, the older entry first on a tie) and `runPoints` (a run's points without the daily
  bonus). Demo rounds never start a session, so they never produce a run to rank.
- Pilot (`rushAim`): the best value-within-7-cm / (1 + distance) target with room around it, aimed at
  its centre of mass; patience 1.0 s. Attract refills below 50 % of the pile.

## Gates (`npx tsx tools/dev/machine-sweep.ts --machine rush --difficulty all --perf`)

Per difficulty: 8 seeds × (10 centred grabs on a fresh pile, no aim noise) and 24 timed runs (3 per
seed) by the pilot with 2 cm Gaussian aim noise, the 0.35 s hold in RESULT and the bin cleared at
every boundary. 144 s for all three presets.

| Gate (design 3.3) | Target | Easy | **Arcade** | Skill |
| --- | --- | --- | --- | --- |
| pieces per centred grab | ≥ 1.2 | 0.91 | **0.82** (fail) | 0.74 |
| run tries that score | ≥ 70 % | 87 % | **83 %** | 78 % |
| tries per 75 s run (median, range) | 12-16 | 13 (12-14) | **13 (12-15)** | 13 (12-13) |
| physics step p95 in busy phases | ≤ 1.5 ms | 0.23 ms | **0.27 ms** | 0.25 ms |
| runs reaching `rewardValue` 450 | 25-35 % | 79 % | **67 %** (fail) | 79 % |
| pieces scored without a carry (centre of mass never above the 20 cm guard) | 0 | 0 | **0** | 0 |
| runs that let a try start after the clock ran out | 0 | 0 | **3 of 24** | 2 of 24 |

Step time (Arcade, busy phases): p50 0.12 ms, p95 0.27 ms, p99 0.58 ms; the single worst step was
40 ms (a single outlier on this shared 4-CPU box). Centred grabs (Arcade): 0 × 16,
1 × 62, 2 × 2.

**Raw value per run** (Arcade, sorted): 260 335 365 390 410 425 435 435 475 485 510 520 545 550 560
580 590 600 600 610 620 630 675 675; median 532. At the settings step of 50, **600** gives 29 % of
runs (Easy 33 %, Skill 25 %); 550 gives 46 %. Changing it means `src/settings/spec.ts`
(`machines.rush.rewardValue`) and `RUSH_DEFAULTS` together (the contract test holds them equal).

### Caging (what was tried)

4 seeds × 8 centred grabs each, the same pile rules otherwise:

| Change | Pieces per centred grab |
| --- | --- |
| design (radius ×1, pitch 0.088, 12 % on top) | 0.92 |
| pitch 0.076 / 0.11 | 0.88 / 0.92 |
| `radiusScale` 0.7 / 0.85 / 1.15 / 1.2 | 0.71 / 1.04 / 0.92 / 1.04 |
| 30 % / 45 % of the pieces on top | 1.00 / 0.83 |
| close speed ×1.6 | 1.00 |
| claw force ×1.4 | 1.04 |
| aim at the value centroid of the cluster | 0.88 |

The closed fingers converge to about 2 cm from the axis: they hold the piece under the hub, and a
neighbour between two fingers is left behind. A second piece only rides along when it lies on the
first. The scoop disc (a hub attachment collider, about 1 day in WS-A's files) is the documented next
step; with it the sweep should be re-run before `available: true`.

### Timer

`PlaySession.preStep` handles the clock running out in AIMING (forced grab), READY (the run ends) and
busy phases (the run ends at the RESULT). In **RESULT** — Game's 0.35 s hold between tries — it marks
the run expired but neither ends it nor lets a later step do so, so the player gets one more full
try (3 of 24 Arcade runs). The fix belongs in `src/game/machines/session.ts` (WS-A): end the run in
RESULT as in READY. `tests/unit/machines/rush.test.ts` holds it as an `it.fails` case that will flip
when the fix lands.

## Unit tests

`tests/unit/machines/rush.test.ts`: classic geometry and claw scale; 44 pieces with the value table in
one layer clear of the guard; settle < 3 s and determinism; the pieces / radius settings; always to
the chute; ≥ 60 % of well-aimed grabs score; over 120 random grabs nothing scores without a carry;
a 75 s run ends on time at a RESULT with one prize at the threshold (and none above it) and a step
p95 within 1.5 ms; no award after the run; the timer edge cases (aiming, between tries, busy, and
the RESULT hold as `it.fails`); demo rounds never start a run; a classic → rush → classic round trip.
`tests/unit/machines/pieces.test.ts`: points, prize bands and order, ranking order and initials.
