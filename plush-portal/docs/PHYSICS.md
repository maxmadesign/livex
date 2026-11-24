# Physics and grab model

Everything that decides a round lives in `src/game` and `src/physics` and runs
headless (`GameCore`): the browser, the unit tests and the measuring tool
execute the same code with the same fixed step. Rendering, audio, the guide and
graphics quality cannot influence it (enforced by
`tests/unit/core/independence.test.ts`).

## Model

| Part | How it is simulated |
| --- | --- |
| World | Rapier 3D, fixed step 1/120 s, 8 solver iterations, deterministic for a given seed and input sequence. |
| Cabinet | 1.0 × 0.8 m mat, glass walls, exit chute 30 × 30 cm in the front-left corner with a 20 cm clear guard, prize bin below the floor. |
| Toys | One rigid body per toy, compound of convex hulls baked per character (`public/assets/plush/manifest.json`). Hulls are tagged `core` (body, head) or `appendage` (ears, tails, fins). |
| Claw | Dynamic hub hanging on a one-sided cable (it can pull, never push) from a kinematic trolley; three fingers on revolute joints driven by force-limited motors. The cable swings; `ropeSwing` sets how much the swing is damped. |
| Exit sensor | A volume inside the chute, below floor level. |

Collision rules for the soft parts: appendages rest on the mat, walls and bin,
but they do not prop toys apart, do not carry the claw and do not hang on the
exit guard. A claw therefore closes on the solid body of a toy instead of
standing on its ears, and a released prize cannot dangle on the guard by a tail.

### One round

`READY → AIMING → DESCENDING → CLOSING → LIFTING → TRANSPORTING → RELEASING → SETTLING → RESULT`
(`RoundMachine`: one grab per round, each phase has a watchdog, an award is
idempotent per `roundId`).

* **Descent.** The winch pays out cable; once the cable goes slack it only runs
  2.2 cm ahead of the claw, so the claw works its way down under its own weight.
  The descent ends when the palm rests on a toy, when the claw has stopped
  moving (floor, guard, wedged between toys), when the cable is fully paid out,
  or after the claw has been carried for 0.9 s in total. A finger tip touching a
  neighbour is not "landed": the claw gets time to slide past it.
* **Closing / lifting / transport / release** are plain motor and winch
  commands; what the toy does is up to the solver.
* **Result.** `won` only if this round's grip target passed the exit sensor with
  its centre of mass below the floor inside the chute. A toy that drops into the
  exit on its own is a stray (returned to the field), never a prize.
  `slipped` if a toy was gripped or lifted and did not arrive, with a reason
  (`eccentric`, `weak_support`, `contact_lost`, `transport_swing`, `overload`,
  `bounced_out`). `empty` otherwise.

### What holds a toy

1. **Contact physics.** Finger friction 1.25, motor torque
   `0.42 N·m × clawForce`. A centred grab cages the body between three fingers;
   an off-centre one is dragged towards the claw axis while the fingers close,
   or ends up held by two fingers and falls.
2. **Limited assist** (`GripMonitor`). After the fingers have really closed on a
   toy (≥ 2 fingers in sustained contact with its solid body) a soft spring
   between palm and toy stands in for the cloth friction a rigid-body solver
   lacks. Its force is capped:

   `cap = weight × gripAssist × √clawForce × (0.1 + 1.9 × quality)`

   `quality` (0…1) is computed once from measured facts: number of fingers in
   contact, how well the claw was aimed (distance between the toy's centre and
   the claw axis when the grab started, relative to the toy's size), whether the
   finger tips are below the centre of mass, how much of the contact is on the
   solid body. The spring breaks, and stays broken, when the toy is pulled more
   than 5.5 cm out of place or no finger has touched it for 0.22 s. It never
   moves a toy towards the claw, it cannot be created without contact, and at
   `gripAssist = 0` the game is pure rigid-body physics.

There is no random number in the outcome path and no pre-decided result. The
only seeded randomness is the layout of the toys.

## Tuning

Constants (source of truth is the code):

| Table | Value |
| --- | --- |
| `CLAW_TUNING` (`ClawRig.ts`) | `fingerTorque 0.42`, `fingerSpeed 1.9`, `fingerFriction 1.25` |
| `GRIP_TUNING` (`GripMonitor.ts`) | `centerFull 0.2`, `centerNone 0.7` (fractions of the toy's reach), `centerFloor 0.35`, `twoFingers 0.62`, `assistBase 0.1`, `assistGain 1.9` |
| `ROUND_TUNING` (`RoundController.ts`) | `slackAllowance 0.022 m`, `stallSpeed 0.035 m/s`, `stallTime 0.12 s`, `maxSlackTime 0.9 s` |

Difficulty presets (`DIFFICULTY_PRESETS` in `src/app/presets.ts`) only change
physical parameters, all of them visible and editable in Settings → Gameplay:

| | move m/s | accel | descend | lift | clawForce | closeSpeed | gripAssist | ropeSwing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Easy | 0.40 | 2.6 | 0.50 | 0.38 | 1.3 | 1 | 1.4 | 0.30 |
| Arcade (default) | 0.42 | 2.4 | 0.55 | 0.42 | 1 | 1 | 1 | 0.55 |
| Skill | 0.46 | 2.2 | 0.60 | 0.44 | 1 | 1 | 0.6 | 0.85 |

## Measured outcomes

Measured with `tools/dev/grip-sweep.ts` on the headless simulation, default
field (18 toys, scale 0.92), all four themes × 2 seeds, every toy the trolley
can reach, a fresh field per round, two aim directions per offset; 915 rounds
per difficulty. "Offset" is the distance between the claw axis and the toy's
centre of mass when the button is pressed. Win % (any toy delivered):

| Offset | Easy | Arcade | Skill (patient) |
| --- | --- | --- | --- |
| 0 cm | 100 | 100 | 89 |
| 1.5 cm | 100 | 99 | 77 |
| 3 cm | 97 | 93 | 58 |
| 4.5 cm | 87 | 70 | 41 |
| 6 cm | 69 | 50 | 32 |
| 8 cm | 39 | 21 | 32 |
| 10 cm | 32 | 15 | 21 |
| Empty spot (chute, cleared gaps) | 24/24 `empty` | 24/24 `empty` | 24/24 `empty` |
| Seconds from button to result, win / empty | 5.8 / 4.5 | 5.5 / 4.3 | 5.3 / 4.1 |

Arcade in detail (n = 72 at 0 cm, 136–144 otherwise):

| Offset | won | slipped | empty | slip reasons |
| --- | --- | --- | --- | --- |
| 0 cm | 100 % | 0 % | 0 % | |
| 1.5 cm | 99 % | 1 % | 0 % | bounced_out 1 |
| 3 cm | 93 % | 6 % | 1 % | eccentric 5, weak_support 4 |
| 4.5 cm | 70 % | 27 % | 3 % | eccentric 38 |
| 6 cm | 50 % | 41 % | 10 % | eccentric 58 |
| 8 cm | 21 % | 51 % | 28 % | eccentric 69 |
| 10 cm | 15 % | 48 % | 37 % | eccentric 65 |

* Arcade, centred (≤ 1.5 cm) per character: 23 of 24 characters 100 %,
  `sakura.biribi` 83 % (n = 6 to 15 per character).
* Skill is measured with a patient player who waits (at most 2.5 s) for the
  claw to stop swinging before pressing the button. Pressing as soon as the
  trolley stops gives 64 % at 0 cm and 62 % at 3 cm: on Skill, patience is part
  of the skill. Skill centred per character ranges from 50 % (`sakura.sakuracat`)
  to 100 %.
* From 8 cm on, wins are mostly accidental catches of the neighbouring toy;
  Arcade and Skill are not distinguishable there (21–32 %).
* 300 consecutive rounds per theme with random aims and restocking (Arcade):
  51–60 % won, 22–27 % slipped, 13–22 % empty; no non-finite pose, no toy
  outside the cabinet or bin, toy count conserved, rigid-body count constant
  (24), collider count follows the character mix without growing, step time
  0.22–0.30 ms without a trend, no watchdog recovery. `bounced_out` (released
  over the exit but did not go in) did not occur in these 1,200 rounds and
  twice in the 2,745 sweep rounds.
* The attract-mode pilot (aims at the centre of a reachable toy through the
  normal input path) wins 85–100 % of its rounds, 40 rounds per theme.

These are simulation measurements on the development machine. They say nothing
about frame rate and they are not a hardware acceptance test.

### Known deviations

* 4.5 cm off-centre still wins about 70 % on Arcade (the design target was
  30–60 %). A closing three-finger claw physically drags a slightly off-centre
  toy to its axis; with the assist switched off entirely the figure is still
  about 64 %. Lowering it further would need a weaker claw, which makes centred
  grabs fail (tried: finger torque 0.34 → centred 94 %, one character at 50 %).
  The 30–60 % band is reached at about 6 cm instead.
* About half of the 18 toys of the default layout have their centre 1–3 cm
  (rarely up to 6 cm) outside the trolley's travel (the travel is inset so the
  open fingers clear the glass). They are grabbed with that offset.

## What "fair" means here

* The same aim on the same field gives the same result (deterministic; tested).
* The outcome is decided by contacts, friction, weight and swing during the
  round, never by a hidden roll, a payout schedule or the collection state.
* The assist is limited, needs real finger contact first, can only hold (never
  attract or teleport), and lets go for stated physical reasons.
* A prize counts once, only for this round's target, and only after it has
  passed the exit sensor.
* Difficulty changes claw strength, assist cap, speeds and cable swing. Nothing
  else, and graphics quality nothing at all.
* Aiming better measurably helps at every difficulty (tables above).

## Re-measuring

```
npx tsx tools/dev/grip-sweep.ts                        # Arcade offset sweep, all themes
npx tsx tools/dev/grip-sweep.ts --difficulty all       # Easy, Arcade, Skill
npx tsx tools/dev/grip-sweep.ts --difficulty skill --patient 2.5
npx tsx tools/dev/grip-sweep.ts --long 300             # stability, 300 rounds per theme
npx tsx tools/dev/grip-sweep.ts --demo 40              # attract-mode pilot
npx tsx tools/dev/grip-sweep.ts --assist 0 --tune fingerTorque=0.34   # experiments
```

The tool exits with a list of anomalies (double award, watchdog recovery, prize
detected outside the chute, toy outside the cabinet, toy left on the exit guard,
empty spot that was not `empty`). Regression tests for the same rules are in
`tests/unit/game`, `tests/unit/physics` and `tests/unit/core`.
