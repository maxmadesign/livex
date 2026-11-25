# PLUSH PORTAL round 4B: more machine types (minimal-change design)

Scope: item 3 of the request ("besides the classic claw machine, make different game types"). Items 1 and 2
(negative-space scene, joystick and control deck) belong to round 4A. This design stays compatible with 4A: the
joystick feeds the same `RoundController.inputX / inputZ` in [-1, 1], and the deck buttons call `Game` methods
defined here.

The angle is **minimal change**. There is one field (1.0 × 0.8 m), one chute and prize sensor, and one claw. Each new
machine is three things:

1. a list of **static fixtures** (bars, a slide, a shelf, a lip) added to the existing floor;
2. a set of **items** (prize box, snack boxes, gems, coins). Each item is an ordinary `ToyBody` with a synthetic
   `PlushAsset` built from the existing proxy primitives, plus an `ItemTag`;
3. a **rules object** that switches a few `RoundController` branches (which items count, where the claw goes, when a
   round has settled), and a small headless **session** (tries, timer).

Classic is the default machine. It uses the code paths it uses today: every new branch is selected by a rules value
that classic never takes, classic creates no extra Rapier body, and a **golden-trace test** recorded before any change
proves the classic simulation stays bit-for-bit identical.

Proposed original names (working id → display name):

| id (stable, `?machine=`) | Display name (en / zh / ja) | Genre |
| --- | --- | --- |
| `classic` | Plush Classic / 经典抓娃娃 / クラシック | the current game, unchanged |
| `bridge` | Teeter Bridge / 平衡桥 / シーソーブリッジ | a boxed prize on two bars, several tries |
| `tower` | Tumble Ledge / 翻落台 / ころころレッジ | stacks of snack boxes on a shelf with a lip |
| `gemrush` | Sparkle Scoop / 闪亮宝石冲刺 / キラキラすくい | 75 s timed score attack with gems and coins, top-10 |

None of these copies a name, character, piece of art or level from the reference app. The boxes carry the project's
own plush characters, drawn from the existing thumbnails.

---

## 1. The machine abstraction

### 1.1 Where things live

```
src/core/machines.ts            ids, kinds, ItemTag, ItemAward, session snapshot (pure types, no runtime deps)
src/physics/fixtures.ts         FixtureSpec + buildFixtures(world, body, specs)      (headless)
src/game/machines/types.ts      MachineDef, MachineRules, ItemDef, ClawTweaks, MachineConfig
src/game/machines/classic.ts    CLASSIC (fixtures [], rules = today's behaviour)
src/game/machines/bridge.ts     BRIDGE def + BridgeRuntime
src/game/machines/tower.ts      TOWER def + TowerRuntime
src/game/machines/gemrush.ts    GEMRUSH def + GemRuntime
src/game/machines/items.ts      itemAsset(def, character?) → synthetic PlushAsset; item placement helpers
src/game/machines/session.ts    MachineSession (tries / timer / end reasons / session reward)
src/game/machines/runtime.ts    MachineRuntime interface + BaseRuntime (shared helpers)
src/game/machines/twoStep.ts    optional two-step control filter (bridge)
src/game/machines/daily.ts      dailyPick(date, ids) and unlock rules (pure)
src/game/machines/index.ts      MACHINE_DEFS, machineDef(id), createRuntime(core, cfg), applyClawTweaks
src/persistence/machines.ts     machines/v1: per-machine best, top-10 ranking, play counts
src/app/MachineFlow.ts          Game-side glue: switching, session flow, item settlement, rewards, guide
src/scene/ItemVisuals.ts        instanced boxes / gems / coins, printed art atlas
src/scene/machineFixtures.ts    draws FixtureSpec[] with the cabinet's materials
src/ui/MachineLobby.tsx         lobby carousel (modal 'machines')
src/ui/SessionCard.tsx          session summary, ranking initials, reward QR (reuses RewardCard)
src/ui/MachineChip.tsx          machine chip + session strip (tries / time / items)
src/i18n/strings/machine.ts     the `machine.*` namespace (en / zh / ja)
tools/dev/machine-sweep.ts      headless tuning and measurement per machine
tools/dev/golden-classic.ts     records the classic golden trace
```

Everything in `src/game/machines` and `src/physics/fixtures.ts` is headless and is checked by the existing
`tests/unit/core/independence.test.ts`. That test walks every file under `src/game` and `src/physics`, so new files are
covered with no change to it.

### 1.2 Types

```ts
// src/core/machines.ts: no runtime dependencies (imported by settings, UI, AI, server)
export const MACHINE_IDS = ['classic', 'bridge', 'tower', 'gemrush'] as const;
export type MachineId = (typeof MACHINE_IDS)[number];
export const MACHINE_KINDS = ['classic', 'bridge', 'tower', 'gems'] as const;
export type MachineKind = (typeof MACHINE_KINDS)[number];
export const ITEM_KINDS = ['prizeBox', 'snackBox', 'gem', 'coin'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type SessionKind = 'open' | 'tries' | 'timed';
export type SessionState = 'idle' | 'running' | 'over';
export type SessionEndReason = 'tries' | 'time' | 'won';

/** Carried by every ToyBody that is a machine item (absent on plush toys). */
export interface ItemTag {
  kind: ItemKind;
  /** 'box' | 'snack' | 'coin' | 'gem.s' | 'gem.l' | 'gem.star' */
  variant: string;
  /** Raw value before difficulty / daily-pick multipliers (scoring is presentation). */
  value: number;
  /** Manifest id of the character printed on a box; null for gems and coins. */
  character: string | null;
}

/** One item that reached the prize sensor (RoundMachine.awardItem). */
export interface ItemAward {
  prizeId: string;        // `${sessionId}-${roundId}-${index}`
  roundId: number;
  toyId: string;
  kind: ItemKind;
  variant: string;
  value: number;
  character: string | null;
  /** 1-based order within the round (multi-drop bonus). */
  index: number;
  demo: boolean;
}

export interface MachineSessionSnapshot {
  kind: SessionKind;
  state: SessionState;
  triesUsed: number;
  /** 0 = unlimited. */
  triesTotal: number;
  /** Whole simulated seconds left; -1 = untimed. */
  secondsLeft: number;
  /** Items scored this session and their raw value sum. */
  items: number;
  value: number;
  reason: SessionEndReason | null;
  /** Character earned by the session rule (tower / gem rush), else null. */
  reward: string | null;
}
```

```ts
// src/core/types.ts: RoundResult gains two OPTIONAL fields, set only on non-classic machines
  machine?: MachineId;
  /** Items that reached the prize sensor during this round (anyItem machines). */
  items?: ItemAward[];
```

```ts
// src/physics/fixtures.ts (headless; the physics layer never imports src/game)
export type FixtureShape =
  | { type: 'box'; hx: number; hy: number; hz: number }
  /** Capsule of `radius` along a world axis, `halfLength` = half the straight part. */
  | { type: 'bar'; radius: number; halfLength: number; axis: 'x' | 'y' | 'z' };

/** Render-only hint for src/scene/machineFixtures.ts (physics ignores it). */
export type FixtureLook = 'bar' | 'post' | 'gutter' | 'rail' | 'shelf' | 'lip' | 'block' | 'none';

export interface FixtureSpec {
  id: string;
  shape: FixtureShape;
  /** Centre, metres, world frame of src/physics/fieldSpec.ts (+Y up, floor top y = 0, glass z = 0). */
  pos: Vec3;
  rot?: Quat;
  friction: number;
  restitution: number;
  /** 'min' for the slick slide (an item slides whatever its own friction). Default 'average'. */
  frictionCombine?: 'average' | 'min';
  look: FixtureLook;
}

/** Adds the fixtures to `body` (a fixed body) with STATIC_GROUPS; returns the collider handles. */
export function buildFixtures(world: RAPIER.World, body: RAPIER.RigidBody, specs: readonly FixtureSpec[]): RAPIER.Collider[];
```

```ts
// src/game/machines/types.ts
import type { FixtureSpec } from '../../physics/fixtures';

export type ItemShape =
  | { type: 'box'; size: Vec3; round: number }                          // → roundCuboid proxy
  | { type: 'gem'; radius: number; height: number; sides: number }      // → hull (bipyramid)
  | { type: 'coin'; radius: number; thickness: number; sides: number }; // → hull (prism)

export interface ItemDef {
  kind: ItemKind;
  variant: string;
  value: number;
  shape: ItemShape;
  mass: number;
  friction: number;
  restitution: number;
  linearDamping: number;
  angularDamping: number;
  /** Effects tier of gems / coins; boxes use their printed character's rarity. */
  tier: RarityTier;
}

export interface MachineRules {
  /** 'gripTarget' = classic (only this round's grip target, LIFTING…SETTLING); 'anyItem' = every item in the sensor counts, in any phase but ATTRACT. */
  prize: 'gripTarget' | 'anyItem';
  /** 'ifHolding' = classic; 'chuteAlways' = after lifting, always open over the chute (scoop). */
  transport: 'ifHolding' | 'chuteAlways';
  /** 'target' = classic; 'calm' = RESULT only once every body has stopped moving. */
  settle: 'target' | 'calm';
  session: { kind: SessionKind; endOnWin: boolean };
  /** Points for a slipped / empty round. Classic: SCORING_RULES.slipPoints / 0. */
  consolation: { slipped: number; empty: number };
  /** Seconds in RESULT before the next try starts by itself; null = wait for PLAY AGAIN. */
  autoAdvance: { miss: number | null; win: number | null };
  /** 'twoStep': first left/right only, then back/front only, release drops (player rounds only). */
  control: 'free' | 'twoStep';
  /** Items that reach the sensor go into the collection as their printed character. */
  collectItems: boolean;
  reward: { kind: 'perPrize' } | { kind: 'sessionItems' } | { kind: 'sessionValue' };
  /** 'classic' = gameplay.restock; else the machine's runtime refills. */
  refill: 'classic' | 'onWin' | 'sessionEnd';
}

/** Multipliers applied to the RoundParams built from the gameplay settings (absent = ×1). */
export interface ClawTweaks {
  moveSpeed?: number; moveAccel?: number; descendSpeed?: number; liftSpeed?: number;
  clawForce?: number; closeSpeed?: number; gripAssist?: number; ropeSwing?: number;
}

export interface MachineDef {
  id: MachineId;
  kind: MachineKind;
  /** false = no chute guard walls (the slide / shelf feeds the chute). */
  chuteGuard: boolean;
  fixtures: readonly FixtureSpec[];
  rules: MachineRules;
  claw: ClawTweaks;
  items: readonly ItemDef[];
  /** Collection wins needed when machines.unlock = 'progress'. */
  unlockWins: number;
}

/** Values latched from the applied settings at each session start (like RoundParams at READY). */
export interface MachineConfig {
  difficulty: 'easy' | 'arcade' | 'skill' | 'custom';
  tries: number;            // bridge / tower
  seconds: number;          // gemrush
  rewardMin: number;        // tower: items, gemrush: raw value
  control: 'free' | 'twoStep';
}
```

```ts
// src/game/machines/runtime.ts
export interface MachineRuntime {
  readonly def: MachineDef;
  readonly session: MachineSession;
  /** Lays out the machine's contents (replaces ToyField.fill). Deterministic for (assets, seed, difficulty). */
  fill(assets: readonly PlushAsset[], seed: number): void;
  /** GameCore.fixedStep, after RoundController.postStep: session timer, stuck watch. */
  postStep(dt: number): void;
  /** New config; latched at the next session start. */
  setConfig(cfg: MachineConfig): void;
  /** START from attract: back to the start layout (called by AttractDirector.leave). */
  resetForNewPlayer(): void;
  /** PLAY AGAIN after a session ended: refill / next box per the rules. */
  newSession(): void;
  /** Every round boundary (READY / RESULT / ATTRACT): bin, top-ups, stuck checks. */
  onRoundBoundary(phase: RoundPhase): void;
  /** "Call staff": re-places a stuck prize at its start pose. Never awards anything. */
  staffReset(): boolean;
  /** Where the attract pilot aims this round; null = DemoPilot's classic pick. */
  demoAim(round: number): { toy: ToyBody | null; x: number; z: number } | null;
  snapshot(): { session: MachineSessionSnapshot; stuck: boolean; progress: 'closer' | 'same' | 'stuck' | null };
}
```

`MachineSession` (src/game/machines/session.ts) has its own `Emitter` with these events: `started`,
`tick { secondsLeft }` (on whole seconds), `over { reason, items, value, reward, roundId }` and `stuck { kind }`.

### 1.3 Core changes file by file

Each change is selected by a value that CLASSIC never has. Line numbers refer to the current tree.

**`src/physics/PhysicsWorld.ts`**
- `PhysicsOptions` (79–83) gains `chuteGuard?: boolean` (default true) and `fixtures?: readonly FixtureSpec[]`
  (default []).
- `buildCabinet` (173–229) wraps the two guard walls (208–212) in `if (this.options.chuteGuard !== false)`. The floor,
  glass and sensor stay as they are. One chute, one sensor.
- In the constructor (127–135), `buildFixtures()` runs **after** `buildBin()` and only when `fixtures.length > 0`.
  Classic therefore creates no extra fixed body, and every collider handle is what it is today. Fixture colliders get
  `StaticKind` `'fixture'` (15) so impacts are classified.
- `addToy(asset, position, rotation, scale, massScale, opts?: AddToyOptions)` (305–352).
  `AddToyOptions = { item?: ItemTag; friction?; restitution?; linearDamping?; angularDamping? }`. Without `opts` the code
  path is unchanged. `ToyBody` (52–65) gains an optional `item?: ItemTag`.
- `setToyFriction` (262–265) skips toys with `item`: items keep their own material.

**`src/game/RoundMachine.ts`**
- The constructor (88) takes `(sessionId, startRoundId = 0)`. **This is required.** A rebuilt core must never reuse a
  round id. Prize ids are `${sessionId}-${roundId}` (192), the score keeper settles by round id (scoring.ts:184–204), and
  the claim server deduplicates on *page session + round id* (src/rewards/protocol.ts:7, 85–86;
  src/rewards/client.ts:82–83). If round ids restarted at 1 after a machine switch, the server would hand back the
  previous machine's code.
- New `awardItem(roundId, toyId, typeId, collect): PrizeAward | null`. It is refused when `roundId` is stale, in
  `ATTRACT`, or when the toy id was already awarded (a `Set` that lives as long as the RoundMachine). The prize id is
  `${sessionId}-${roundId}-${index}`. It emits the same `award` event; `PrizeAward` gains optional
  `index?: number; collect?: boolean`. `beginRound` (128–134) clears the per-round list, exposed as
  `get roundItems(): readonly PrizeAward[]`.
- `awardPrize` (185–200) and `AWARD_PHASES` (38) are untouched.

**`src/game/RoundController.ts`**: constructor (83–95) gains `rules: MachineRules = CLASSIC_RULES, machineId: MachineId = 'classic'`.
- `requestGrab` (120–125): `if (this.grabGate && !this.grabGate()) return false;`. The gate is set by the session
  (`setGrabGate`). A new `forceGrab()` sets `grabQueued` past the gate, for time-up in a timed session (the claw drops
  where it is, like the aim timer at 265–273).
- `preStep` READY/AIMING (250–279): when `rules.control === 'twoStep' && !m.demo`, the clamped `x, z` pass through a
  `TwoStepInput` filter. Its stages are 'x' then 'z', and releasing in stage 'z' queues the grab. It emits
  `axisStage { stage: 'x' | 'z' | null }` for the deck and joystick (round 4A).
- `onPhase('TRANSPORTING')` (191–197):
  `this.destinationIsChute = this.wasHolding || rules.transport === 'chuteAlways'`. For classic this is the same value as
  today. postStep TRANSPORTING (357–361) only diverts home when `rules.transport !== 'chuteAlways'`.
- postStep: `rules.prize === 'anyItem' ? this.checkItems() : this.checkStrays()` replaces the trailing
  `checkStrays()` (394), and `checkPrize()` (421–433) returns at once for anyItem. `checkItems()` (new) is
  `checkStrays()` (436–451) with one difference: an **item** whose centre of mass is below `PRIZE_SENSOR.awardComY` and
  over the chute is marked `inBin` and passed to `machine.awardItem(…)`. On success it emits
  `itemScored { roundId, toy, award }`; if refused (ATTRACT, or already awarded) it emits `strayInBin` as today.
- postStep SETTLING (374–390) gains `else if (rules.settle === 'calm')`, placed before the classic not-won branch.
  `calmTime` grows while `phys.maxToySpeed() < 0.05`, and the round finishes when `(t > 0.6 && calmTime > 0.25) || t > 4`.
  The 7 s watchdog stays.
- `buildResult` (471–506): for anyItem the outcome is `won` when `machine.roundItems.length > 0`, otherwise the classic
  slipped/empty logic. `prizeId` is the first item's id, and `machine` and `items` are added. For classic neither field
  is added, so the result object keeps its exact shape.

**`src/game/GameCore.ts`**
- `GameCoreOptions` gains `machine?: MachineDef` (default CLASSIC), `startRoundId?: number` and
  `machineConfig?: MachineConfig`.
- The constructor (37–45) passes `chuteGuard` and `fixtures` to PhysicsWorld, `startRoundId` to RoundMachine, and
  `def.rules` and `def.id` to RoundController. It then sets `this.runtime = def.kind === 'classic' ? null : createRuntime(this, cfg)`.
- `fixedStep` (48–56) gains one line after `controller.postStep`: `this.runtime?.postStep(FIXED_DT);`.
- `populate` (59–70): `if (this.runtime) { this.runtime.fill(assets, seed); this.settle(3); } else { …unchanged… }`.

**`src/game/ToyField.ts`**: **no change.** Game passes `count: 0` for non-classic machines (Game.fieldOptions,
Game.ts:301). `missing()` (193) is then always 0, so every classic restock path is a no-op on other machines with no
gate at all: `afterRoundBoundary` (Game.ts:933–952), the ATTRACT top-up (Game.ts:668–669), the idle reset (Game.ts:630),
`restockNow`, and `AttractDirector.resetField` (attract.ts:121–135). `clearBin` (213) and `clearFallen` (224) remove
awarded items exactly as they remove prizes.

**`src/game/attract.ts`**: `leave()` (109–114) gains `this.core.runtime?.resetForNewPlayer();` before
`this.resetField()`. Nothing else changes; demo scheduling (141–163) works for every machine.

**`src/app/DemoPilot.ts`**: `pick()` (63–88) starts with
`const plan = core.runtime?.demoAim(this.rounds); if (plan) { this.target = plan.toy; this.aimX = …; this.wait = 0.9; return; }`.
The classic pick is untouched. When a plan has `toy === null`, the target check in `update()` (98) treats the plan as
alive while `aimTime` runs. Demo rounds always use free control.

**`src/physics/fieldSpec.ts`, `ClawRig.ts`, `GripMonitor.ts`: no change.** The claw, its reach (`CLAW.minX…maxZ`), the
chute (`CHUTE`), the sensor (`PRIZE_SENSOR`) and the drop point (`CLAW.dropX/dropZ`) are shared by every machine.
`GripMonitor.evaluate` (GripMonitor.ts:275–316) reads `asset.footprint`, `asset.size` and the collider roles, which the
synthetic item assets provide.

### 1.4 How per-machine geometry, contents and win detection are expressed

- **Geometry.** `MachineDef.fixtures` is a `FixtureSpec[]` in the fieldSpec frame. The same array feeds physics
  (`buildFixtures`) and rendering (`machineFixtures.ts`), so tuning a bar height moves both. The prize opening is always
  the existing chute (CHUTE, fieldSpec.ts:22–30). When the drop zone is elsewhere, a **gutter** (a tilted slab with
  `frictionCombine: 'min'`) carries items into it.
- **Contents.** `runtime.fill()` calls `phys.addToy(itemAsset(def, character), pos, rot, 1, 1, { item, friction, … })`.
  `itemAsset` builds a `PlushAsset` whose `proxies` are one `cuboid` (round > 0), or a `hull` for gems and coins: the
  existing `ProxyGeometry` cases (manifest.ts:16–21), with no new collider code. It also sets `model.lods = []`. Because
  `ToyVisuals.create` returns early when the library has no model (ToyVisuals.ts:248–250), items never get plush
  visuals; `ItemVisuals` draws them instead.
- **Win detection.** Classic uses `prize: 'gripTarget'`: today's `checkPrize`, one award per round. The new machines use
  `prize: 'anyItem'`: any item whose centre of mass is inside the sensor volume, below `awardComY` and over the chute
  counts once (`awardItem`, idempotent per toy). The test is the same one `checkPrize` uses today
  (RoundController.ts:425–428). No timer, roll or script decides a result.

### 1.5 Session versus round

A **round** is unchanged: one grab, the phase machine of RoundMachine.ts:14–25, one `result`.

A **session** is what a player gets for one START or PLAY AGAIN:

| kind | used by | ends when | between rounds |
| --- | --- | --- | --- |
| `open` | classic | never (today's behaviour; the session score ends on idle reset) | field persists, classic restock |
| `tries` | bridge (10), tower (5) | tries used up, or (bridge) the prize was won | **field persists**: the box stays where it was, fallen stacks stay fallen |
| `timed` | gem rush (75 s) | the simulated timer reaches 0, then the current round finishes | field persists, top-up below 25 items |

- `MachineSession` lives inside the headless core (`core.runtime.session`) and counts in **simulated** time (fixed
  steps), so headless tests and the browser behave identically. Paused steps do not count: the timer stands still while
  a dialog is open, which gives no advantage because nothing moves.
- The session starts on the first player READY after attract or after `newSession()`. It counts a try on each player
  DESCENDING. The timer starts on the first movement input, and the session is judged on each player `result`.
- When time runs out in READY/AIMING, it calls `controller.forceGrab()`: the last claw drops where it is. When time runs
  out in a busy phase, that round finishes normally. Either way the session ends `over` at the following RESULT.
- Demo rounds never touch the session: no tries, no timer.
- Multi-win tries: several `awardItem` per round, each settled once by its own prize id.
- Game does not auto-advance after a session-over RESULT (Game.ts:1424–1435 gains the guard). The session card waits
  for PLAY AGAIN, which calls `runtime.newSession()` and then `m.next(false)`.
- Session rewards (tower, gem rush) are computed headless from physics facts (item count, raw value sum) at `over`.
  Points never decide a reward.

### 1.6 Does the claw vary?

Not structurally: the same three-finger rig, reach, drop point and travel height on every machine. Each machine only
scales the existing RoundParams (`ClawTweaks`, applied in `Game.roundParams`, Game.ts:286–299, through
`applyClawTweaks`). The values are latched at round boundaries as today (RoundController.ts:97–113).

| | moveSpeed | descendSpeed | liftSpeed | clawForce | closeSpeed | gripAssist | ropeSwing | transport |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| classic | ×1 | ×1 | ×1 | ×1 | ×1 | ×1 | ×1 | ifHolding |
| bridge | ×0.9 | ×0.85 | ×1 | ×0.9 | ×1 | **×0** (friction only) | ×0.8 | ifHolding |
| tower | ×1 | ×1 | ×1 | ×1 | ×1 | ×0.6 | ×1 | ifHolding |
| gemrush | ×1.35 | ×1.25 | ×1.35 | ×1 | ×1.2 | **×0** (cage only) | ×0.8 | **chuteAlways** |

With `gripAssist` at 0, `GripMonitor` never creates the spring (GripMonitor.ts:340: `if (this.settings.assist > 0)`).

### 1.7 Keeping classic byte-for-byte identical

1. **Golden trace first** (migration step 0, before any core edit). `tools/dev/golden-classic.ts` plays 3 seeds × 2
   themes (sakura, gpu) × 4 scripted rounds through the harness (tests/unit/game/harness.ts). Every 60 steps it records
   a hash of all body poses, plus every RoundResult and award. The output is committed as
   `tests/unit/game/__golden__/classic.json`, and `tests/unit/game/classicGolden.test.ts` asserts equality. The
   existing bit-for-bit test (rounds.test.ts:185–204) only compares two runs of the same build; the golden test compares
   against the build before round 4.
2. Classic sends no `opts` to `addToy`, no fixtures and `chuteGuard: true`, so Rapier creation order and handles are
   unchanged.
3. Every new RoundController branch is chosen by a rules value classic never has. `runtime` is `null` for classic.
4. Machine switching **rebuilds GameCore from scratch** rather than editing a live world. Switching back to classic gives
   a world built exactly like the one at boot.
5. Scoring: `scoreRound` (scoring.ts:103–144) is not edited. Today's pick never selects classic (§3.4), so no
   multiplier reaches classic either.

---

## 2. The machines

Coordinates are metres in the fieldSpec frame: x from −0.5 (left glass) to +0.5, z from 0 (front glass) to −0.8
(back), floor top y = 0. The shared limits are:
- the chute: x ∈ [−0.5, −0.2], z ∈ [−0.3, 0] (fieldSpec.ts:22–30);
- the claw axis reach: x ∈ [−0.37, 0.37], z ∈ [−0.67, −0.13] (fieldSpec.ts:66–69);
- the drop point (−0.345, −0.155);
- at travel height (rope 0.10) the hub centre is at y 0.66 and the finger tips at **y ≈ 0.476**, so everything at rest
  must stay below about 0.44;
- the open claw is about 0.28 m across at the elbows and 0.20 m at the tips.

### 2.0 The shared "gutter" (used by bridge and tower)

The prize slide covers the front strip to the right of the chute and drains into it. It is a static slab, as its top
surface:
- from (x = −0.20, y = 0.02) to (x = +0.32, y = 0.10), z ∈ [−0.30, 0];
- slope θ = atan(0.08 / 0.52) = 8.75°;
- friction 0.05 with `frictionCombine: 'min'`, so an item slides whatever its own friction (the friction angle is 2.9°);
- an end block at x ∈ [0.32, 0.34], y ∈ [0, 0.12] closes the high end.

```
gutter slab: box hx 0.263 hy 0.010 hz 0.150, pos (0.0615, 0.0501, -0.150),
             rot about +Z by +8.75° = quat (0, 0, 0.0763, 0.9971), look 'gutter'
end block:   box hx 0.010 hy 0.060 hz 0.150, pos (0.330, 0.060, -0.150), look 'block'
```

With the gutter in place, `chuteGuard: false`: the guard walls (PhysicsWorld.ts:208–212) would stop items sliding in.

### 2.1 Teeter Bridge (`bridge`)

Top view:

```
 z=-0.80 ┌──────────────────────────── back wall ──────────────────────────┐
         │                         empty floor (claw home · at 0.06,-0.40)  │
 z=-0.312├─────────── back rail (acrylic, y 0…0.16) ─────────────┐          │
 z=-0.27 │  CHUTE   ┊ o══════════ bar (y 0.26, r 0.012) ═══════o │          │
         │  (hole)  ┊ post   ┌─box 0.12×0.22─┐            post  │ end      │
         │ x -0.5…  ┊        └───────────────┘   gutter ← 8.75° │ block    │
 z=-0.11 │   -0.2   ┊ o══════════ bar ═══════════════════════o  │          │
 z=0     └───────────────────────── front glass ─────────────────┴──────────┘
                -0.2 -0.19                                 0.31 0.34
```

**Fixtures** (look):

| id | shape | pos | friction / rest. |
| --- | --- | --- | --- |
| `bar.back` | bar r 0.012, halfLength 0.24, axis x | (0.06, 0.26, −0.27) | 0.35 / 0.05 (`bar`) |
| `bar.front` | bar r 0.012, halfLength 0.24, axis x | (0.06, 0.26, −0.11) | 0.35 / 0.05 |
| `post.l.b`, `post.l.f` | bar r 0.010, halfLength 0.13, axis y | (−0.19, 0.17, −0.27 / −0.11) | 0.3 / 0.05 (`post`) |
| `post.r.b`, `post.r.f` | bar r 0.010, halfLength 0.10, axis y | (0.31, 0.20, −0.27 / −0.11) | 0.3 / 0.05 |
| `rail.back` | box hx 0.27 hy 0.08 hz 0.006 | (0.07, 0.08, −0.306) | 0.3 / 0.05 (`rail`) |
| `gutter`, `gutter.end` | §2.0 | §2.0 | 0.05 min / 0.02 |

Twelve static colliders in one extra fixed body; `chuteGuard: false`. The bars end at x = −0.18, so the drop point
over the chute stays clear of them.

**Item: the prize box.**
- Shape: `prizeBox`, variant `box`, roundCuboid 0.12 (x) × 0.09 (y) × 0.22 (z), round 0.004.
- Material: mass 0.6 kg, friction 0.55, restitution 0.03, damping 0.2 / 0.8.
- Value: `2 × TIER_POINTS[rarity(character)]`, i.e. 200 / 500 / 1000 / 2000.
- Start pose: centre (0.05, 0.317, −0.19), yaw 0, long axis along z, lying across both bars. The bars are 0.16 apart
  centre to centre (inner gap 0.136), so each end overhangs its bar by 0.03 m.
- It falls through when it is slid more than about 3 cm along z, or turned by more than about 70° (0.12 < 0.136).
- The printed character is chosen round-robin over the enabled theme characters by the field RNG, with every third box
  rarer, mirroring DemoPilot's rare preference. One box at a time.

**Win rule (physics).** The box's centre of mass enters the sensor (below `awardComY = −0.06`, over the chute). It gets
there either through the gap onto the gutter and then the chute, or by being lifted and carried by friction alone and
dropped at the drop point (rare with assist 0 and 0.6 kg). `rules`: `{ prize: 'anyItem', transport: 'ifHolding',
settle: 'calm', session: { kind: 'tries', endOnWin: true }, consolation: { slipped: 10, empty: 0 },
autoAdvance: { miss: 1.15, win: null }, control: cfg.control, collectItems: true, reward: { kind: 'perPrize' },
refill: 'onWin' }`.

**What the claw does.** Centred over the box, the back finger lands on top of the box: its tip reaches 0.10 m, and the
box's half-length is 0.11 m. The two front fingers straddle the box's sides. Closing pinches the front end, and lifting
tilts the box, which slips and drops back shifted or turned. Pressing near an overhanging end tips the box about the
nearer bar. Physics decides; the intended feel is "several tries, visible progress".

**Failure modes and anti-exploit.**

| Case | Detected by (runtime, at RESULT) | Handling |
| --- | --- | --- |
| Box wedged between the bars, below bar level, asleep, not in the sensor | box COM y < 0.24 and speed < 0.02 for 1 s | `stuck: 'below'`. The session strip shows **Call staff**; `staffReset()` re-places the box at the start pose with **no award**. Attract does it by itself. |
| Box fell behind the rail onto the floor | COM outside the bridge AABB x [−0.22, 0.36], z [−0.32, 0] | `stuck: 'off'`, same handling |
| Box upright on the gutter, not sliding | COM below 0.2, not in the sensor, asleep | same handling. The slick gutter makes this rare; the tuning sweep counts it. |
| No progress in 4 tries | pose change < 2 mm and < 1° | guide hint "try the other end" (§2.1 guide); never an award |
| Lifting it out every time (too easy) | sweep metric "carried out %" | tuning: mass, claw tweaks |
| Pushing it down with the hub's weight | not an exploit: the hub weighs 0.45 kg and lands vertically | none |

Tries are counted on the grab, so idling gives nothing. A new player (START from attract) always gets a fresh box: no
inherited "almost falling" box, which is fairer at a kiosk. The box only persists between one player's tries.

**Scoring.**
`settleItem` = round(value × DIFFICULTY_MULTIPLIER × dailyBonus) + first-catch bonus (+50 % of the tier base, as in
classic) + "few tries" bonus (won within 3 tries: +25 %). There is no combo: the session ends on the win. A slip scores
10, an empty grab 0.

**Prize.** One won box adds its printed character to the collection, with prize id `${sid}-${rid}-1` and
`collectItems: true`. It requests one claim code `perPrize`: `prizeId = character id`, `prizeName = character name`,
`tier = rarity`. That is what staff hand out (REWARDS.md:117 ff.). The claim token pattern accepts `.` and `:`
(server/rewards/validate.ts:33–43).

**Guide (event types).**
- `machine_changed` on entering the bridge: "Push one end until the box slips between the bars!"
- `empty_grab` / `slipped_after_grip` with `facts.machine.progress`. `closer` gives "It moved! Again on the same end."
  `same` gives "Try the other end." `stuck` gives "Stuck? Press Call staff."
- `prize_won`: the existing win, QR and new-character lines, plus `facts.machine.kind = 'bridge'`.
- `session_over` with reason `tries` and `facts.machine.items = 0`: "Out of tries; it's nearly there!"

**Sounds and effects** (existing names only, no new audio assets):
- Box against a bar, an `ImpactEvent.against === 'fixture'`: `playSfx('claw_touch', {volume: 0.45})`.
- Box hits the gutter: `plush_land`.
- In the sensor: `chute_drop`, then `playWin(theme, tier)` and `playCharacter(character, 'win')`.
- Effects: `celebrate(tier, EXIT_POS)` and `burst('score')`; `burst('contact')` where the claw first touches the box;
  `aura` while the box is lifted, at the character's tier.

**DemoPilot.** `demoAim` aims at the box end with the smallest remaining overhang beyond its bar, at
`centre ± axis × (L/2 − 0.025)` clamped to the reach. It switches ends after two tries without progress. Target: a demo
win in ≤ 8 demo tries on average. A won box is re-placed by `refill: 'onWin'`, and `staffReset` runs by itself in
attract.

**Difficulty knobs** (contents only, latched at fill):

| | Easy | Arcade | Skill |
| --- | --- | --- | --- |
| box start offset along z (towards the gap) | +0.012 | 0 | 0 |
| box start yaw | 8° | 0° | 0° |
| box mass | 0.5 kg | 0.6 kg | 0.7 kg |
| tries per session (`machines.bridgeTries`) | 12 | 10 | 8 (setting default 10) |

The difficulty presets' claw values apply as well (DIFFICULTY_PRESETS, presets.ts:102–106). Fixture-level knobs (bar
gap 0.16 m, bar friction 0.35) are tuning constants, not settings: changing them would need a core rebuild on every
difficulty change.

### 2.2 Tumble Ledge (`tower`)

Side section at x = 0 (z to the right goes towards the back):

```
 y 0.476 ─ ─ ─ ─ ─ ─ claw tips at travel height ─ ─ ─ ─ ─ ─ ─ ─ ─
 y 0.352                       ▇▇ row B (4 high, z -0.50)
 y 0.304            ▇▇ row A (3 high, z -0.38)
 y 0.172      lip ▐
 y 0.160  ════════╧════════════════════════════════ shelf top ═══ (z -0.30 … -0.80)
 gutter 0.02…0.10 │                     shelf block (solid to the floor)
 z = 0 (glass)  -0.30                                                  -0.80
```

**Fixtures:**

| id | shape | pos | friction / rest. |
| --- | --- | --- | --- |
| `shelf` | box hx 0.50 hy 0.08 hz 0.25 | (0, 0.08, −0.55) | 0.6 / 0.05 (`shelf`) |
| `lip` | box hx 0.50 hy 0.006 hz 0.006 | (0, 0.166, −0.306) | 0.4 / 0.05 (`lip`) |
| `gutter`, `gutter.end` | §2.0 | §2.0 | 0.05 min / 0.02 |

Four static colliders; `chuteGuard: false`. The shelf's front face at z = −0.30 is the chute's back edge for x < −0.2,
and the back wall of the gutter for x > −0.2. Anything that goes over the lip falls into the chute, or onto the gutter
and then into the chute. Items cannot leave the shelf any other way: walls at the sides and back.

**Items: snack boxes.**
- Shape: `snackBox`, variant `snack`, roundCuboid 0.075 × 0.048 × 0.055, round 0.003.
- Material: mass 0.07 kg, friction 0.45, restitution 0.05, damping 0.2 / 0.9.
- Value by printed character rarity: common 30, rare 50, epic 80, legendary 120.
- Row A, stacks 3 high: z = −0.38 (arcade), x ∈ {−0.32, −0.16, 0, 0.16, 0.32}.
- Row B, stacks 4 high: z = −0.50, x ∈ {−0.24, −0.08, 0.08, 0.24}.
- 31 items. The tallest stack top is at 0.352, 12 cm below the travelling finger tips; a carried snack hangs to about
  0.40 and clears both rows.

**Win rule (physics).** Every snack box whose centre of mass enters the sensor counts, several per try, in any phase but
ATTRACT. `rules`: `{ prize: 'anyItem', transport: 'ifHolding', settle: 'calm',
session: { kind: 'tries', endOnWin: false }, consolation: { slipped: 0, empty: 0 }, autoAdvance: { miss: 1.15, win: 2.2 },
control: 'free', collectItems: false, reward: { kind: 'sessionItems' }, refill: 'sessionEnd' }`. A snack the claw grabs
is carried to the drop point (the classic path) and counts too.

**Technique (physics only).** Aim about 3 cm behind a stack: the back finger lands behind it, and while closing pushes
the stack forward over the lip. Lifting the top box out of a back-row stack can topple the box into row A and start a
cascade.

**Failure modes and anti-exploit.**
- A box balanced on the lip stays until bumped (the genre).
- Toppled boxes lying flat on the shelf can still be knocked.
- Stacks are settled off-screen before the player sees them (`calmWobble` applies during settle only,
  ToyField.ts:260–273). The fill must pass a stability test: no item moves more than 2 mm in 5 s idle.
- Claw sweeping stacks while travelling is impossible: the clearance is above 12 cm.
- Late falls (a box teetering after RESULT) count for the round in progress, or for the session card while it is shown
  (§1.5).

**Scoring.** `settleItem` per box = round(value × difficulty × dailyBonus × multiDrop(index)) where
`multiDrop = [1, 1.5, 2, 2, …]` (the 2nd box in the same try ×1.5, the 3rd and later ×2). The popup appears at
EXIT_POS, as in classic.

**Prize.** Snack boxes do not go into the collection one by one (`collectItems: false`). At session end, if items ≥
`machines.towerRewardItems` (default 3), the session earns **one** character: the rarest printed character among the
dropped boxes, ties broken by drop order. It goes into the collection with prize id `${sid}-${lastRoundId}-S`, and one
claim code is requested with `roundId = lastRoundId`. A session has at most one code, and its round id is unique.

**Guide.**
- `machine_changed`: "Knock the boxes over the edge; everything that falls is yours."
- `item_scored` (new, cooldown 6 s; `facts.machine.items` = this try's items): "Two at once!"
- `empty_grab` with `progress`.
- `session_over` with items, value and reward: "5 boxes! That earns you {toy}."

**Sounds and effects.**
- Each box in the sensor: `chute_drop`, `score_count`, `burst('score', EXIT_POS, tier)`.
- The 2nd and later in the same try: `combo` and `burst('combo')`.
- A box against the shelf or lip: `plush_land` at volume 0.4.
- Session reward: `celebrate(tier)` and `playWin`.
- Refill at session end: `restock_rain`, plus `burst('restock')` per stack.

**DemoPilot.** `demoAim` picks the row-A stack whose top box is nearest the lip, and aims 3 cm behind its centre.
Round 3 of each demo cycle grabs a row-B top box instead. In attract, `onRoundBoundary('ATTRACT')` refills all stacks
when fewer than 60 % are left.

**Difficulty knobs.**

| | Easy | Arcade | Skill |
| --- | --- | --- | --- |
| row A gap behind the lip | 0.02 | 0.04 | 0.06 |
| snack mass | 0.06 | 0.07 | 0.08 |
| tries per session | 6 | 5 | 4 |

The lip height (0.012) is a tuning constant.

### 2.3 Sparkle Scoop (`gemrush`)

**Fixtures:** none. **`chuteGuard: true`**: the classic 20 cm guard stays, so floor gems can only arrive by being
carried, never pushed in. The geometry is exactly classic.

**Items:**

| variant | kind | shape | mass | friction | value | tier | count (arcade) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `coin` | coin | 12-gon prism r 0.019, thickness 0.006 | 0.012 | 0.40 | 10 | common | 36 |
| `gem.s` | gem | 6-gon bipyramid r 0.016, h 0.026 | 0.015 | 0.30 | 25 | rare | 24 |
| `gem.l` | gem | 6-gon bipyramid r 0.024, h 0.036 | 0.030 | 0.30 | 60 | epic | 8 |
| `gem.star` | gem | 5-gon bipyramid r 0.026, h 0.030 | 0.030 | 0.30 | 250 | legendary | 2 |

70 single-hull bodies, against classic's 18 toys of about 6 hulls each.

**Placement.** Items are rejection-sampled with the existing `isFreeSpot(x, z, 0.03)` (ToyField.ts:32–37) and dropped
from 0.02–0.12 m in three layers, then settled for 2 s off-screen.

**Win rule (physics).** After lifting, the claw always opens over the chute (`transport: 'chuteAlways'`). Whatever was
caged and survives the trip falls in, and every item in the sensor counts. `rules`: `{ prize: 'anyItem',
transport: 'chuteAlways', settle: 'calm', session: { kind: 'timed', endOnWin: false }, consolation: { slipped: 0, empty: 0 },
autoAdvance: { miss: 0.3, win: 0.6 }, control: 'free', collectItems: false, reward: { kind: 'sessionValue' },
refill: 'sessionEnd' }`. At each round boundary the runtime tops the field up to 70 when fewer than 25 items are left.
These are restock drops with the restock effects.

**Timer.** `machines.gemSeconds` (default 75) of simulated time, starting at the first movement. When it hits 0 in
READY/AIMING, `forceGrab()` runs (the last claw drops where it is). A grab in flight finishes and counts. Then the
session is `over` with reason `time`. With the gem tweaks a grab cycle is about 3.8 s, so a player gets 15–18 grabs per
session.

**Failure modes and anti-exploit.**
- Pushing gems in: blocked by the classic guard.
- Pausing the timer with the menu: the timer is in simulated time and the field is frozen too, so there is no
  advantage. Kiosks can lock settings (SETTINGS.md, "Public display lock").
- A ranking spammed with junk initials: initials are A–Z only, with a tiny 3-letter blocklist, one entry per session,
  and demo rounds never rank.
- Physics load: the 70-body worst case is measured by the sweep tool (target: below 0.6 ms per step on this machine).

**Scoring.** `settleItem` per item = round(value × difficulty × dailyBonus × scoopBonus). `scoopBonus` is 1, or ×1.5
for the 3rd and later items of the same grab. The session score is shown big. The ranking is a per-machine top-10 of
the session score (`machines/v1`), with 3-letter initials.

**Prize.** Gems and coins never go into the collection. At session end, if the raw value is ≥
`machines.gemRewardValue` (default 600), the session earns one character. The band is ≥ 1× rewardMin common, ≥ 2× rare,
≥ 3× epic, ≥ 4× legendary, and the character is the first enabled character of that tier in the theme (RARITY_TABLE,
rarity.ts:22–59), falling back to the nearest lower tier. That character goes into the collection, and one claim code
is requested with the session's last round id.

**Guide.**
- `machine_changed`: "75 seconds, as many sparkles as you can scoop!"
- `item_scored` (cooldown 6 s) on 3 or more items in one grab.
- `idle_hint` (existing) with `secondsLeft`.
- `session_over` with score, rank and reward: "{n} points, number {rank} today!"

**Sounds and effects.**
- Per item: `chute_drop`, plus `sparkle` for gems.
- 3 or more in one grab: `combo`.
- Each of the last 5 s: `countdown_tick`.
- Time up: `empty_grab`, then the session card. A top-10 place: `jackpot`, plus `lightShow('jackpot')`.
- `aura` on a held star gem; `burst('score', EXIT_POS, tier)` per item.

**DemoPilot.** `demoAim` puts a 5 cm grid over the reach and picks the cell with the most item value within 6 cm,
excluding the chute guard margin (DemoPilot.ts:72). Demo rounds are single grabs: no timer, no ranking.

**Difficulty knobs:** counts per variant (easy +20 % coins), `machines.gemSeconds` (Easy 90 / Arcade 75 / Skill 60 when
the setting is at its default), and the claw tweaks.

### 2.4 Plush Classic (`classic`)

Unchanged: no fixtures, `chuteGuard: true`, the ToyField pile, `prize: 'gripTarget'`, `session: open`, rewards per
prize, the classic restock setting, and today's DemoPilot pick and scoring.

### 2.5 Summary of "what is a prize"

| Machine | Collection | Claim QR (src/rewards) | Points |
| --- | --- | --- | --- |
| classic | each won plush | per won plush (today) | today's table |
| bridge | each won box → its character | per won box | 2 × tier points, +first catch, +few tries |
| tower | session ≥ N boxes → rarest printed character | one per qualifying session | per box, multi-drop |
| gemrush | session value ≥ V → character of the value band | one per qualifying session | per item, scoop bonus; top-10 |

Demo rounds never count, persist or request codes: the `demo` flag is on every award, `RewardFlow.onWin` already
refuses demos (flow.ts:109), and the ranking ignores demos.

---

## 3. Lobby and flow

### 3.1 Screens and states

```
 ATTRACT on machines.default ──START / CTA──► player READY (default machine)
     ▲                                             │  MACHINES button (menu row) or the deck's
     │ idle reset: back to machines.default        │  "leave machine" (round 4A), only at a boundary
     │ (core rebuild while in attract)             ▼
     │                                   LOBBY (modal 'machines', carousel)
     │                                     │ pick ─► confirm if a tries/timed session is running and triesUsed > 0
     │                                     ▼
     │                             switching curtain (themeBusy) ─► READY on the picked machine
     │                                     │ (session idle → running on the first input)
     │                      session over ──┴─► SESSION CARD: summary, initials (if top-10), reward QR
     │                                             ├─ PLAY AGAIN ─► newSession() → READY
     └──────────────── idle ───────────────────────┴─ MACHINES ─► LOBBY
```

- **The lobby** (`MachineLobby.tsx`) is a `Modal` (src/ui/Modal.tsx). It therefore always stays inside the layout's
  modal rectangle, which keeps it inside the 86" reach band y 0.25–0.75, the 32" zone, the simulated 9:16 frame and
  the phone safe area. No new layout geometry is needed.
- **Lobby cards:** name, genre tag, one-line rule, this device's best, top-3 of the ranking (gem rush), a "TODAY'S PICK
  ×1.5" ribbon, a lock with "win {n} more" when `unlock = 'progress'`, and PLAY.
- **Lobby layout:** a horizontal scroll-snap row on desktop and phone landscape; a 2 × 2 grid on portrait 32" and 86".
  All touch targets are ≥ `layout.touch`.
- **The MACHINES button** (`menu-machines`) sits in the existing menu row (Hud.tsx:213–245) and is disabled while
  `machine.busy`. A switch therefore always happens at a round boundary, with no queued-switch path.
- **Session strip** (`machine-session`) inside the ScoreHud rectangle. It shows tries as ●●●○○ and the time as 0:42 with
  an item count. Living inside ScoreHud, it is laid out wherever the score already is, and the call to action keeps
  avoiding it (AttractOverlay.tsx:43–78 uses `scoreHudRect`).
- **Session card** in the result card slot (Hud.tsx:495–560): items, score, tries used, ranking place with three letter
  slots (▲/▼ buttons at `layout.touch`, plus the keyboard), the reward QR (the existing `RewardCard`), PLAY AGAIN and
  MACHINES.
- **Mid-session results:** a gem rush mid-session result is a compact toast (`result-miss` style, "+3 gems"), not the
  big win card. The big card is the session card.
- **Deck and coin plate** (round 4A): the coin counter plate shows the session strip's data (tries, time or items). The
  "call staff" button calls `game.staffReset()` and is enabled only while `ui.machine.stuck`. "Inventory" opens the
  collection. "Leave machine" opens the lobby.

### 3.2 Switching machines: `Game.selectMachine(id)`

Implemented in `MachineFlow.switchTo`, called from Game:

1. Refuse when `core.machine.busy && !demo`.
2. Set `themeBusy` (curtain) and pause with reason `'theme'`.
3. `startRoundId = core.machine.roundId`. Reset rewards, the score session, popups, the pilot and the aura.
4. Dispose the old core. `this.core = new GameCore({ …same as Game.ts:235–241, machine: machineDef(id), startRoundId, machineConfig })`.
5. `this.attract = new AttractDirector(this.core)`. Re-run `bindCore()`: the old listeners die with the old emitters.
6. Recreate `ClawVisual` for the new claw (Game.ts:349–352), clear `toyVisuals` and `itemVisuals`, then run
   `rebuildScene(false)` (the Cabinet gets the machine's fixtures) and `populate()`.
7. A player switch calls `core.machine.start(false)`, which goes ATTRACT → READY with round id `startRoundId + 1`.
   A switch while in attract stays in ATTRACT.
8. Unpause, emit guide `machine_changed`, write `ui.machine`.

The cost is a fresh Rapier world plus a 1.5–3 s off-screen settle (180–360 fixed steps) plus a Cabinet rebuild.
`ItemVisuals.warmUpObjects()` joins `Stage.warmUp()` at boot, so the gem and box materials do not compile on the first
switch.

### 3.3 Persistence

- `machines/v1` (`src/persistence/machines.ts`, same failure-tolerant storage as storage.ts):
  `{ version: 1, best: Partial<Record<MachineId, number>>, ranking: Partial<Record<MachineId, RankEntry[]>>, plays: Partial<Record<MachineId, number>> }`,
  where `RankEntry = { initials: /^[A-Z]{3}$/, score: number, at: number, theme: ThemeId, difficulty }`.
  - Top-10 per machine, sorted by score, then earlier first.
  - Sanitised like `sanitizeScores` (scores.ts:24–32); a newer version is left alone.
  - Settings → System → Reset scores also clears this record.
- The global `scores` record (best session and lifetime) stays v1 and unchanged. Switching machine starts a new score
  session, so "best" stays meaningful. Per-machine bests live in `machines/v1`.
- The collection (collection/v1) is unchanged. Session rewards use prize ids `…-S`; item awards use `…-n`.
- The player's machine choice is **not** persisted: a kiosk returns to `machines.default` on idle and on reload.

### 3.4 Today's pick

`dailyPick(date, candidates)`: FNV-1a of the local date `YYYY-MM-DD`, modulo the candidates. The candidates are the
machines that are not hidden and are unlocked, **excluding classic**, so classic scoring stays identical. It returns null
when only classic is left. The bonus `machines.dailyBonus` (default ×1.5) multiplies item points (and nothing physical).
It is shown as the ribbon and as "×1.5" in the session strip. Tests inject the clock.

### 3.5 Attract, demo and idle reset with several machines

- **Attract** plays demo rounds on the current machine. After an idle reset that is `machines.default` (classic unless
  the operator changed it).
- Optional `machines.attractTour` (off by default): every 3 demo rounds while in ATTRACT, switch to the next lobby
  machine. This is a core rebuild in ATTRACT; it hitches briefly, so it is off by default.
- **Idle reset** (Game.ts:615–634) gains `machineFlow.onIdleReset()`. If the current machine is not the default, it
  switches back. Otherwise the field state stays until START, when `AttractDirector.leave` calls
  `runtime.resetForNewPlayer()` (fresh box, fresh stacks, full gems). A running session is abandoned without reward.
  Items already scored stay scored: they were settled at the exit.
- The QR hold (`rewards.holdsIdle`, Game.ts:1354) is unchanged, and the session card's QR uses the same `RewardFlow`.
- **Demo labelling:** the DEMO badge, demo score track and `demo` flags work as today. The CTA gains a subtitle with
  the machine name (`machine.<id>.name`).

### 3.6 Settings (`src/settings/spec.ts`, new group after `gameplay`, 390–419)

```ts
  machines: {
    /** Machine shown in attract mode and returned to on the idle reset (?machine= sets it). */
    default: en('classic', MACHINE_IDS, 'rebuild'),
    /** Players may open the machine lobby. Off: the kiosk stays on `default`. */
    lobby: bool(true),
    /** Machines hidden from the lobby (ids). Classic cannot be hidden. */
    hidden: strList(8, 24, 'live'),
    /** 'all' = every machine open; 'progress' = machines open with prizes won (bridge 1, tower 3, gemrush 5). */
    unlock: en('all', ['all', 'progress'] as const),
    /** A different machine is "today's pick" every day and earns more points there (never classic). */
    dailyPick: bool(true),
    dailyBonus: num(1.5, 1, 3, 0.1, 'live', '×'),
    /** Attract mode visits the lobby machines in turn (each switch rebuilds the machine off-screen). */
    attractTour: bool(false),
    /** Tries per Teeter Bridge session. */
    bridgeTries: num(10, 3, 30, 1, 'round'),
    /** Bridge controls: 'free' joystick, or 'twoStep' (left / right first, then back / front, release drops). */
    bridgeControl: en('free', ['free', 'twoStep'] as const, 'round'),
    /** Tries per Tumble Ledge session. */
    towerTries: num(5, 1, 20, 1, 'round'),
    /** Tumble Ledge: dropped boxes per session that earn a prize (collection + claim code). */
    towerRewardItems: num(3, 1, 30, 1, 'round'),
    /** Sparkle Scoop session length. */
    gemSeconds: num(75, 30, 120, 5, 'round', 's'),
    /** Sparkle Scoop: raw gem value per session that earns a prize. */
    gemRewardValue: num(600, 100, 5000, 50, 'round'),
  },
```

- Values marked `round` latch at the next **session start**: `runtime.setConfig` is called at each READY, and
  `MachineSession` latches the config only when it starts a session.
- `machines.default` is a `rebuild` value. It is applied in `applyQueuedRebuild` (Game.ts:955) only while in attract;
  otherwise at the next idle reset. A switch is never previewed from the draft.
- `SETTINGS_VERSION` stays 1: missing keys are filled with defaults by the sanitiser (spec.ts:702–704).
- UI: a "Machines" section in the Game tab (`src/ui/settings/tabGameplay.tsx`), with labels `set.machine.*`.

### 3.7 Launch parameter

`?machine=classic|bridge|tower|gemrush`:
- `launch.ts` (15–29) adds `machine: pick<MachineId>(q.get('machine'), MACHINE_IDS)` to `LaunchParams`.
- `bootstrap.ts` (82–86) adds `if (launch.machine) state.set('machines.default', launch.machine)`, the same pattern as
  `?theme=`.
- The game boots straight into that machine.
- `tests/e2e/helpers.ts` `BootOptions` gains `machine?: MachineId`.

### 3.8 i18n keys (namespace `machine`, file `src/i18n/strings/machine.ts`, en / zh / ja)

The file is registered in `src/i18n/all.ts` and `FEATURE_STRING_TABLES`, so the namespace tests
(tests/unit/i18n/featureStrings.test.ts) cover it.

```
machine.classic.name / .tag / .rules      machine.bridge.name / .tag / .rules
machine.tower.name / .tag / .rules        machine.gemrush.name / .tag / .rules
machine.lobby.title  machine.lobby.play  machine.lobby.current  machine.lobby.locked {n}
machine.lobby.pick   machine.lobby.bonus {mult}  machine.lobby.best {points}  machine.lobby.top
machine.lobby.leave.confirm  machine.lobby.leave.ok  machine.switching  machine.chip
machine.session.tries {left} {total}  machine.session.time {s}  machine.session.items {n}
machine.session.over  machine.session.timeUp  machine.session.outOfTries  machine.session.won
machine.card.items {n}  machine.card.score {points}  machine.card.again  machine.card.lobby  machine.card.reward {toy}
machine.rank.title  machine.rank.enter  machine.rank.ok  machine.rank.place {n}  machine.rank.none
machine.staff.button  machine.staff.done  machine.stuck
machine.axis.x  machine.axis.z  machine.toast.locked  machine.cta {name}
machine.popup.items {n}  machine.popup.scoop
set.machine.section  set.machine.default  set.machine.lobby  set.machine.hidden  set.machine.unlock
set.machine.dailyPick  set.machine.dailyBonus  set.machine.attractTour  set.machine.bridgeTries
set.machine.bridgeControl  set.machine.towerTries  set.machine.towerRewardItems  set.machine.gemSeconds
set.machine.gemRewardValue   (+ `.hint` for each set.machine.* key)
```

### 3.9 Guide contract (src/ai, src/core/contracts.ts, server/schemas.ts)

- `GUIDE_EVENT_TYPES` (contracts.ts:159–171) gains `machine_changed`, `item_scored` and `session_over`.
- `GUIDE_PRIORITY` and `GUIDE_COOLDOWN_MS` (GuideDirector.ts:44–75) get, for those three in order: priority 2 / 2 / 3,
  cooldown 1 200 / 6 000 / 0 ms.
- `EVENT_TASKS` (prompt.ts:107) gains one task line each.
- `GuideFacts` (contracts.ts:177–208) gains
  `machine?: { id; kind; triesLeft?; secondsLeft?; items?; sessionItems?; value?; rank?: number | null; progress?: 'closer' | 'same' | 'stuck' | null; reason?: SessionEndReason | null } | null`.
- `FactsSchema` (server/schemas.ts:27–65) gets the same object as `z.strictObject(…).nullable().optional()`. Facts
  are numbers and enums only, never free text.
- New local line keys (src/ai/lines/types.ts:9–40): `machine.bridge`, `machine.tower`, `machine.gemrush`,
  `machine.classic`, `item`, `item.multi`, `bridge.closer`, `bridge.same`, `bridge.stuck`, `session.over`,
  `session.rank`, `session.reward`. Each needs ≥ 2 lines × 5 themes × 3 languages, because
  tests/unit/ai/lines.test.ts:117–131 iterates every event type × theme × language.

---

## 4. Rendering

### 4.1 Cabinet (fixtures and the chute)

- `Cabinet` takes the `MachineDef` as a 4th constructor argument. The call site is `Game.rebuildScene`
  (Game.ts:327–356).
- `build()` calls `buildMachineFixtures(b, M, def.fixtures, detail)` from `src/scene/machineFixtures.ts`, merged into
  the same material buckets, so there are no extra draw calls beyond the buckets.
- Looks:

| look | Drawn as | Material (existing CabinetMaterials) |
| --- | --- | --- |
| `bar` | CylinderGeometry, the tier's radial segments, plus end caps | chrome |
| `post` | cylinder with a ball cap | chrome |
| `gutter` | box (the slab) with a printed arrow decal pointing at the chute | acrylic + sign |
| `rail` | box | acrylic + acrylicEdge |
| `shelf` | box with an accent strip on the front face | enamel + accent |
| `lip` | box | chrome |
| `block` | box | dark |

- The chute guard walls and their edge, post and sign (Cabinet.ts:306–317) are drawn only when `def.chuteGuard`.
  Without the guard, the sign moves onto the gutter's end block.
- Budget: below 3 k triangles, +0 draw calls. Shelf and gutter receive shadows.
- Round 4A dresses the neighbouring cabinets beyond the side glass. They may use
  `neighbourMachines(current): [MachineKind, MachineKind]` from `src/game/machines/index.ts` to show a bar set or a
  shelf silhouette. This is render-only and optional.

### 4.2 ItemVisuals (`src/scene/ItemVisuals.ts`)

API: `sync(toys)`, `update(alpha)`, `setArt(theme, thumbnails)`, `clear()`, `warmUpObjects()`, `viewStats()`,
`dispose()`. The class mirrors ToyVisuals, and pose interpolation is the same slerp (ToyVisuals.ts:419–426).

| Item | Mesh | Instances | Triangles (main pass) |
| --- | --- | --- | --- |
| prize box | RoundedBoxGeometry, 2 segments, plus a clear front "window" with the printed character's plush **LOD2** inside (render-only child, Medium and up; Safe shows the art only) | 1 | ≈ 600 + 4–8 k |
| snack box | BoxGeometry, InstancedMesh, per-instance atlas cell (`InstancedBufferAttribute aCell` via `onBeforeCompile`) | ≤ 40 | 480 |
| coin | 12-segment cylinder, InstancedMesh | ≤ 45 | ≤ 2.2 k |
| gem.s / gem.l / gem.star | bipyramid (6 / 6 / 5 sides), one InstancedMesh per variant | ≤ 30 / 10 / 2 | ≤ 0.6 k |

**Printed art.**
- One `CanvasTexture` atlas per theme: 1024² on Medium, 512² on Safe, 2048² on High and Ultra (following
  `graphics.textures`), with 256² cells.
- Each cell is the theme's box colours, the character's portrait from `ui.thumbnails[id]` (the data URLs produced by
  `renderThumbnails`, src/plush/thumbnails.ts), the name in the display font, and a rarity stripe.
- Portraits arrive asynchronously (Game.queueThumbnails, Game.ts:1624). Until then a cell shows the palette and the
  name. Game subscribes to `ui.thumbnails` and calls `setArt`, which redraws the 2D canvas and sets
  `texture.needsUpdate`.

**Materials.**
- Boxes: MeshStandardMaterial (cardboard, roughness 0.8).
- Gems: MeshStandardMaterial with roughness 0.08, metalness 0.1, envMapIntensity 1.6 and a small emissive tint (bloom
  glints). No transmission, on any tier.
- Coins: metalness 1, roughness 0.3, gold or silver.

**Shadows.** Boxes cast shadows on every tier with shadows on. Gems and coins cast them on High and Ultra only.

**Contact shadows** (Medium and up): items do **not** join the contact pass in this round. It would need an instanced
variant of the contact material (contactShadows.ts), and this is a known visual limitation. The key-light shadow covers
boxes.

**Interaction with ToyVisuals.** Items have no `library` entry, so ToyVisuals skips them (ToyVisuals.ts:248–250).
`toyVisuals.heldToy` and `focus` can point at an item harmlessly. Game uses `toyPosition` (Game.ts:748–752), which
falls back to the physics pose.

### 4.3 Budgets (Medium)

Item machines have **no plush pile**. The classic Medium held-toy frame peaks at 457 697 triangles, of which the toys'
main pass is about 229 k (PERFORMANCE.md "Triangle budget (round 3)").

Estimates, to be measured in step 6:

| Machine | Estimated whole frame | Draw calls |
| --- | --- | --- |
| bridge | ≈ 160–190 k (cabinet, claw, effects, post 78 k; box + window plush ≈ 9 k × 3 passes; display bays unchanged) | ≈ 120 |
| tower | ≈ 150 k | ≈ 118 |
| gemrush | ≈ 155 k | ≈ 122 |

Round 4A's neighbour cabinets and visible gantry add to the same frame. The joint budget is 470 k, so 4A has at least
280 k of headroom in item machines and the same headroom as today in classic.

Physics budget:
- target ≤ 0.6 ms per step headless for gemrush (70 bodies), measured by `tools/dev/machine-sweep.ts --perf`;
- bridge and tower are expected below classic (1 and 31 single-collider bodies).

---

## 5. Migration plan (each step keeps the game and every test green)

| Step | What | Gate |
| --- | --- | --- |
| **0. Scaffold** (lead, before forking) | (a) `tools/dev/golden-classic.ts` and the **golden fixture recorded on the untouched tree**, plus `classicGolden.test.ts`. (b) `src/core/machines.ts`; RoundResult optional fields; `src/physics/fixtures.ts`. (c) PhysicsWorld options, `addToy` opts, `ItemTag`, `setToyFriction` skip, StaticKind 'fixture'. (d) RoundMachine `startRoundId` and `awardItem`. (e) `src/game/machines/{types,runtime,classic,index,session}.ts`: CLASSIC def; bridge / tower / gemrush **defs with this document's fixture and item numbers**; `createRuntime` throws for them; MachineSession skeleton. (f) the `machines` settings group; `?machine=` parsing; the `ui.machine` slice (`INITIAL_MACHINE`) and ModalId `'machines'` (gameStore.ts:36). (g) the `machine.*` i18n file with every key in 3 languages. (h) the three guide event types: facts.machine, server schema, priority / cooldown / tasks, and `resolveSituation` mapping them to **existing** line keys for now (`machine_changed` → `theme`, `item_scored` → `win`, `session_over` → `retry`), so the lines tests pass. (i) Game public stubs `selectMachine`, `openLobby`, `staffReset`, `submitInitials` (toast "coming"). (j) the `ItemVisuals` class with no-op methods; `ScoreKeeper.settleItem` signature (returns null); `persistence/machines.ts` signatures. | `tsc` both configs, `vitest run`, golden passes; the e2e smoke `01-load` and `02-rounds` pass |
| 1. Core plumbing (WS-A) | RoundController rules branches, GameCore machine / runtime / startRoundId, AttractDirector hook, DemoPilot hook, session timer, twoStep | golden passes after **every** commit; new core unit tests |
| 2. Machines (WS-B) | the three runtimes, fills, stuck detection, demoAim, `machine-sweep.ts`, tuning | per-machine unit tests, sweep anomaly list empty |
| 3. Rendering (WS-D) | machineFixtures, conditional chute visuals, ItemVisuals, art atlas, warm-up | `?machine=` does nothing visible yet without WS-C, so it is tested in a scene unit test and by a debug-only route (`__plush.selectMachine`); classic screenshot spec unchanged |
| 4. App glue (WS-C) | MachineFlow, Game hooks, settleItem, rewards and collection rules, machines/v1, daily pick, debug API | the classic e2e specs unchanged and green; new unit tests |
| 5. UI, guide, i18n (WS-E) | lobby, chip and session strip, session card, settings section, dedicated guide lines, e2e `28-machines` | i18n and lines tests; `03-safe-zone` updated |
| 6. Integration (lead) | merge order A → B → D → C → E; full e2e; measure budgets; docs (new `docs/MACHINES.md`, updates to ARCHITECTURE, PHYSICS, SETTINGS, REWARDS, PERFORMANCE, AI) | full suite, golden, perf rows recorded |

**Existing tests that must change:**
- `tests/e2e/03-safe-zone.spec.ts:4`: add `menu-machines` (and the lobby) to the HUD-in-safe-zone list. Round 4A
  separately replaces the `dir-*` ids.
- `tests/e2e/helpers.ts`: `BootOptions.machine`, which sets `?machine=`.
- `tests/unit/settings/spec.test.ts:55–77`: assert `machines.default === 'classic'` and `machines.lobby === true`. The
  generic checks (19, 182) cover the rest automatically.
- `tests/unit/ai/lines.test.ts` and `brandLines.test.ts`: no edit needed if the line banks are complete. They iterate
  `GUIDE_EVENT_TYPES` (lines.test.ts:121, brandLines.test.ts:85 and 146), and their `variants(type)` helper may need
  facts variants for the new types (`facts.machine` with progress, reason and rank).
- `tests/unit/server/schemas.test.ts`: add accept and reject cases for `facts.machine`, including extra keys inside it.
- `tests/e2e/20-screenshots.spec.ts`: one extra screenshot per machine (desktop, sakura, attract frozen with
  `attractTime = 0`).
- `tests/e2e/22-idle-attract.spec.ts`: an added case (idle reset returns to the default machine). The existing cases
  stay as they are.
- Unchanged and expected to stay green untouched: `independence.test.ts` (it scans the new files), `rounds.test.ts`,
  `ToyField.test.ts`, `attract.test.ts`, `demoPilot.test.ts`, `RoundMachine.test.ts`, `scoring.test.ts`,
  `19-stability.spec.ts` (classic collider counts), `07-settlement`, `21-points`, `26/27-rewards`.

---

## 6. Parallel implementation split

The scaffold (step 0) is committed first. After that, each workstream owns its files exclusively; "touch" means a few
hook lines in a file owned by someone else, listed here so merges are predictable.

| WS | Owner of (exclusive) | Touches (hook lines only) | Delivers |
| --- | --- | --- | --- |
| **A: core framework** | `src/game/RoundController.ts`, `src/game/GameCore.ts`, `src/game/machines/{session,twoStep,runtime}.ts`, `src/physics/{PhysicsWorld,fixtures}.ts` (after the scaffold), `tests/unit/game/{classicGolden,session,RoundController.items}.test.ts`, `tests/unit/physics/fixtures.test.ts` | `src/game/attract.ts` (1 line), `src/app/DemoPilot.ts` (pick hook, 6 lines) | rules branches, session timer and forced grab, runtime plumbing, golden kept |
| **B: machine content and tuning** | `src/game/machines/{bridge,tower,gemrush,items,daily}.ts`, `tools/dev/machine-sweep.ts`, `tests/unit/game/machines/*.test.ts`, the PHYSICS.md section "Machines" | `src/game/machines/index.ts` (registry entries) | fills, stuck detection, staffReset, demoAim, session reward pick, measured outcome tables |
| **C: app glue, points, persistence** | `src/app/MachineFlow.ts`, `src/game/scoring.ts` (additions only; `scoreRound` untouched), `src/persistence/machines.ts`, `tests/unit/{app/machineFlow,game/scoring.items,persistence/machines}.test.ts`, the debug API additions | `src/app/Game.ts` (≈ 25 hook lines: init options, `roundParams` tweaks, `fieldOptions` count, `bindCore` award guard and new listeners, `onResult` guard, `afterRoundBoundary`, `updateFlow` auto-advance, `idleReset`, `facts`, debug API), `src/app/bootstrap.ts`, `src/app/launch.ts` | switching, session flow, settlement, rewards and collection rules, ranking, daily pick |
| **D: rendering** | `src/scene/{ItemVisuals,machineFixtures}.ts`, `tests/unit/scene/{itemVisuals,machineFixtures}.test.ts`, the PERFORMANCE.md rows | `src/scene/Cabinet.ts` (constructor argument, the chute-guard condition, 1 call), `src/scene/Stage.ts` (warm-up list) | fixture looks, items, printed atlas, window plush, budgets |
| **E: UI, guide, i18n, e2e** | `src/ui/{MachineLobby,SessionCard,MachineChip}.tsx`, `src/ui/machines.css`, `src/ui/settings/tabGameplay.tsx` (Machines section), `src/i18n/strings/machine.ts`, `src/ai/lines/{en,zh,ja}.ts` (new keys), `src/ai/lines/index.ts` (situations), `src/ai/prompt.ts` (tasks), `tests/e2e/28-machines.spec.ts` | `src/ui/Hud.tsx` (≈ 8 lines: chip, strip, card switch, menu button), `src/ui/App.tsx` (modal case), `src/ui/ScoreHud.tsx` (strip slot) | lobby, session card, initials, settings UI, guide lines, e2e |

**Shared contracts committed in the scaffold** (nobody edits them without the lead):
- `src/core/machines.ts`, and the RoundResult and GuideFacts additions;
- `src/physics/fixtures.ts`, `src/game/machines/{types,runtime}.ts`;
- the MachineDef numbers of §2 (B may retune values, but never shapes or field names);
- `GameUiState.machine` (`MachineUiState` below), ModalId `'machines'`;
- the `Game` public API: `selectMachine(id): boolean`, `openLobby(): void`, `staffReset(): boolean`,
  `submitInitials(initials: string): boolean`, `machineInfo(): MachineInfo[]` (for the lobby: id, unlocked, pick, best,
  top3);
- the `machines` settings group and the i18n key list;
- the debug API names: `__plush.machine()`, `__plush.selectMachine(id)`, `__plush.machineDebug.setSeconds(s)`,
  `__plush.machineDebug.itemPoses()`.

```ts
// src/app/gameStore.ts: the slice WS-C writes and WS-E reads
export interface MachineUiState {
  id: MachineId;
  kind: MachineKind;
  session: MachineSessionSnapshot;
  axisLock: 'x' | 'z' | null;     // twoStep stage (round 4A's joystick may show it)
  stuck: boolean;                 // enables "Call staff"
  dailyPick: MachineId | null;
  bonus: number;                  // points multiplier active here (1 = none)
  ranking: { qualifies: boolean; place: number | null; entered: boolean };
  switching: boolean;
}
```

**Integration risks:**
1. **Game.ts and Hud.tsx are shared with round 4A** (joystick: `setDirection` / `pushInput`, Game.ts:452–475; deck: the
   Hud panel). Mitigation: WS-C's logic lives in `MachineFlow.ts` with hook lines only; WS-E's UI lives in new
   components with ≤ 10 lines in Hud.tsx. Merge 4A first, then 4B.
2. **Cabinet.ts is shared with 4A** (neighbour cabinets, visible gantry). WS-D only adds an argument, a condition and
   one call.
3. **Golden drift.** Any change to Rapier creation order in the classic path breaks bit-identity. WS-A must run the
   golden test on every commit, and the CI gate is the golden test.
4. **Tuning uncertainty** (bridge especially): the box may lift out too often, or never fall. B owns the sweep and may
   retune numbers but not the contract. If the bridge cannot be made fair with friction-only lifting, the fallback is a
   partial-lift rule (`liftTo` rope length), which is a contract change and must go through the lead.
5. **Round-id continuity on switches** (`startRoundId`). Without it, claim codes repeat. The e2e checks two wins on two
   machines → two different codes.
6. **Guide line volume:** about 12 keys × 5 themes × 3 languages × ≥ 2 lines. Line lengths are enforced by
   lines.test.ts:133–160.
7. **Software-GL e2e time:** a machine switch plus settle costs seconds per frame here. The e2e drives the core with
   `fastForward`, never wall-clock waits.
8. **ToyField count = 0 trick:** relies on `missing()` being the only gate of the classic restocks. C's unit test
   asserts that no plush is ever added on item machines across 50 rounds, attract and an idle reset.

---

## 7. Test plan and estimate

### 7.1 Unit (Vitest, headless Node; real Rapier)

- `classicGolden.test.ts`: pose hashes and results equal the pre-round-4 fixture (3 seeds × 2 themes × 4 rounds).
- `physics/fixtures.test.ts`:
  - classic options create the same collider handle sequence as no options;
  - a bridge world has 12 fixture colliders in one extra body;
  - the gutter has `frictionCombine: Min`;
  - with `chuteGuard: false` there are no guard colliders.
- `RoundMachine.items.test.ts`:
  - `awardItem` is idempotent per toy and refused in ATTRACT or for a stale round;
  - the prize id format;
  - `startRoundId` continuity;
  - `awardPrize` unchanged.
- `RoundController.items.test.ts`:
  - anyItem awards items in READY, DESCENDING and RESULT;
  - `chuteAlways` goes to the chute when nothing is held;
  - the `calm` settle waits for a rolling item;
  - classic rules behave as before (the existing rounds tests).
- `machines/session.test.ts`:
  - tries counted on DESCENDING only;
  - the timer runs on fixed steps only and starts at the first input;
  - time-up in AIMING forces one grab; time-up in a busy phase ends at RESULT;
  - demo rounds never count;
  - the config is latched at session start.
- `machines/bridge.test.ts`:
  - the box rests on both bars after fill, stays still ≥ 5 s and is deterministic;
  - an impulse sliding it 4 cm along z → exactly one award, via the gutter and the sensor;
  - a box carried by the claw → won;
  - a wedged box → `stuck`, and `staffReset` gives no award;
  - `resetForNewPlayer` restores the start pose;
  - 200 random-aim tries give no non-finite pose and no award outside the sensor.
- `machines/tower.test.ts`:
  - stacks stable (each item moves < 2 mm in 5 s);
  - knocking row A → n awards, each once;
  - multi-drop index;
  - the session reward picks the rarest printed character;
  - the refill restores 31 items.
- `machines/gemrush.test.ts`:
  - 70 items settle in < 3 s;
  - scripted grabs at the densest cell deliver ≥ 1 item in ≥ 60 % of grabs;
  - over 300 random grabs the guard keeps floor items out (no award without a carry);
  - a 75 s session ends with reason `time`;
  - the session-value band picks the character.
- `game/scoring.items.test.ts`:
  - `settleItem` is idempotent per prize id;
  - multi-drop and scoop multipliers; daily bonus;
  - demo track; scoring off → null;
  - `scoreRound` unchanged (the existing suite).
- `persistence/machines.test.ts`:
  - sanitise, top-10 insert and ordering;
  - initials filter and blocklist;
  - a newer version is left alone;
  - Reset scores clears the record.
- `machines/daily.test.ts`: the daily pick is stable for a date, changes across dates, excludes classic, respects
  hidden and unlock.
- `app/demoPilot.machines.test.ts`: 20 demo rounds per machine with no watchdog recovery; bridge demo wins ≥ 1;
  gem demo grabs deliver ≥ 1 item in ≥ 60 %.
- `app/machineFlow.test.ts` (Game-less, with a fake host):
  - a switch keeps round ids increasing;
  - no plush restock on item machines;
  - rewards are requested once per prize or session;
  - collection prize ids `-n` / `-S`.
- `scene/itemVisuals.test.ts`: instance counts per machine; triangle estimate ≤ 15 k; atlas cell layout; `setArt`
  without thumbnails.
- `scene/machineFixtures.test.ts`: every look maps to an existing material; triangles < 3 k; no geometry for the chute
  guard when `chuteGuard: false`.
- `core/machinesContract.test.ts`:
  - every `MachineId` has a def, i18n name, tag and rules in 3 languages;
  - the `machines.default` options equal `MACHINE_IDS`;
  - every def's fixtures are inside the cabinet and below 0.44 m (claw clearance);
  - every item start pose is reachable or intentionally decorative.
- `ai` and `server` tests extended for the new events and `facts.machine`.

### 7.2 Tuning and measurement (headless, `tools/dev/machine-sweep.ts`)

- **Bridge:** 400 sessions per difficulty with a pilot-like aim plus noise. Report tries-to-win (median, p90), win %
  within 10 tries, carried-out %, and stuck %.
  - Target Arcade: median 4–7 tries, ≥ 60 % won within 10, carried-out < 10 %, stuck < 3 %.
- **Tower:** 200 sessions. Items per session (mean, p10, p90) and % of sessions reaching the reward threshold.
  - Target Arcade: mean 3–5, 40–60 % reaching 3.
- **Gems:** 100 timed sessions. Score distribution, items per grab, step-time percentiles.
  - Targets: median raw value 450–700, ≤ 0.6 ms per step p95.
- Anomaly list as in grip-sweep: double award, award outside the sensor, non-finite pose, item outside the cabinet,
  watchdog. The results go into PHYSICS.md.

### 7.3 E2E (`tests/e2e/28-machines.spec.ts`, production build, software WebGL, `fastForward`)

1. **Lobby in all four layouts** (desktop, portrait32, portrait86, mobile): `menu-machines` opens `machine-lobby`; every
   card and button lies inside the safe zone, and on 86" inside y 0.25–0.75. Pick bridge: `__plush.machine().id ===
   'bridge'`, the state shows one `prizeBox` item, and the round is READY.
2. **Bridge win, settled once:** `?machine=bridge&seed=7`. Apply an impulse through `core()` (the test hook already
   exposed) and `fastForward(4)`. Exactly one `award`; collection +1 for the printed character; one score popup; with
   `rewards.mode=all` and the rewards test server (as in 26 and 27), one claim code. A second win after PLAY AGAIN gets
   a different code (round-id continuity).
3. **Tower session:** 5 tries via `placeClaw`, `grab` and `fastForward`. The session card appears. Items equal the
   awards. PLAY AGAIN refills to 31.
4. **Gem rush timed:** `machineDebug.setSeconds(6)`, play, then time up. Session card; enter initials; reload; the
   ranking persists in `machines/v1`. A demo round never ranks.
5. **Idle reset with machines:** on tower, `__plush.idleReset()` puts the game back on classic in attract. A demo plays,
   the collection and ranking are unchanged, and START gives a classic READY.
6. **`?machine=gemrush` boot:** attract shows the DEMO badge on gem rush. No console errors and no failed requests
   (the existing `watch()`).

Runtime estimate here: about 12–18 min for `28-machines` (6 tests, each booting the production build under
SwiftShader), plus about 4 extra screenshots in `20-screenshots`. The whole suite goes from about 1.1 h to about
1.4 h.

### 7.4 Effort (this 4-CPU machine, software-only WebGL; engineer hours)

| WS | Hours | Long pole |
| --- | --- | --- |
| 0 Scaffold (lead) | 6 | golden fixture, contract files, the three event types with placeholder situations |
| A Core framework | 20 | RoundController branches and session timer, golden kept on every commit |
| B Machines and tuning | 32 | bridge tuning (≈ 8 h of sweeps; one 400-session sweep ≈ 20–40 min headless on 4 shared cores) |
| C App glue, points, persistence | 22 | core rebuild on switch, session flow in Game, reward rules |
| D Rendering | 20 | instanced atlas boxes, window plush, warm-up, Medium measurements (each software-GL measurement run ≈ 10–20 min) |
| E UI, guide, i18n, e2e | 26 | ≈ 360 guide lines across 3 languages × 5 themes, lobby in 4 layouts, e2e |
| Integration, verification, docs (lead) | 14 | 2–3 full e2e runs at ≈ 1.4 h each, docs |
| **Total** | **≈ 140 h** | wall clock with 5 people: about 4–5 working days plus 1.5 days of integration |

---

## 8. What this angle cannot do well (honest)

1. **Everything drains to the front-left corner.** With one chute, the bridge and the ledge must feed it through a
   gutter.
   - The bridge is a 0.48 m bridge across the front strip, not the full-width, centred bridge of the reference.
   - The back half of the bridge cabinet is empty floor.
   - The layouts look asymmetric.
   - A second exit or a movable chute would fix this, and this angle rules it out.
2. **One three-finger claw for every genre.** Real bridge machines use two-prong arms. Pushers and scoops use paddles
   or shovels.
   - The trolley cannot move while the claw is lowered, so there is no sideways shove.
   - Bridge technique is limited to "press or lift an end".
   - Gem scooping with three fingers is less satisfying than a shovel and may give low item counts until tuned.
3. **The claw's travel height caps the scenery.** Everything must stay below about 0.44 m: no tall towers, no high
   bridges.
4. **Friction-only lifting is a tuning gamble.** If the 0.6 kg box lifts out too often or never moves enough, the next
   step is a partial-lift rule (`liftTo`), which touches the round sequence and the contract.
5. **No coin economy.** The kiosk is free play: START costs nothing, and the reference's coin plate becomes a
   tries / time display. Today's pick is a points bonus, not a free play.
6. **Machine switching rebuilds the whole core.** That is a brief hitch behind a curtain (worse under software GL), and
   the attract tour is off by default for this reason. It is the price of keeping classic bit-identical.
7. **Fixture-level difficulty knobs (bar gap, lip height) are constants.** Only contents and claw values change with
   difficulty. Making fixtures follow difficulty would need a core rebuild on every difficulty change.
8. **Items skip the contact-shadow pass** on Medium and up in this round: a small visual step down next to the plush
   toys.
9. **Session prizes are an invented mapping.** "Gem value band → a character" is a pure rule chosen for booth
   logistics (staff hand out a plush). It is fair and physics-derived, but it is not a real arcade convention, and the
   operator must brief staff.
10. **Neighbour cabinets are dressed dummies,** not live machines. They may show other machine kinds through
    `neighbourMachines()`, but there is no simulation behind the glass.
11. **More genres** (pushers, roulette, ticket wheels, the reference's 40+ machines) do not fit "one field, one chute,
    one claw" without a bigger framework. This design deliberately stops at three plus classic.
