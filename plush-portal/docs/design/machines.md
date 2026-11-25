# PLUSH PORTAL, round 4B: final machine design (judged synthesis)

Item 3 of the round: more game types besides the classic claw machine. Items 1 and 2 (negative-space scene, the
8-way joystick and the 3D control deck) belong to workstream **4A**. This design stays compatible with it: the
joystick keeps feeding `RoundController.inputX / inputZ` in [-1, 1] (src/game/RoundController.ts:62-63, 250-263), and
the deck buttons call the `Game` methods and read the store slices defined here (section 4.11).

This is a design only. Nothing in the repository was edited, built or run. Every claim about the code below was
checked against the tree at `ac8f03e`, and the citations give file:line.

`[PC]` marks a product choice the user may want to change (names, timer length, prize rules and similar). Section
10 collects all of them.

---

## 0. Verdict

### 0.1 Scores

| Criterion (weight) | Minimal | Framework | Why |
| --- | --- | --- | --- |
| Correctness against the constraints (30 %) | 6 | 7 | Both keep outcomes physical and demos out of the records. Minimal has two geometry bugs and a core rebuild that breaks e2e capture. Framework breaks classic bit-identity after a switch and needs a new prize bin. |
| Implementation risk (20 %; higher = safer) | 7 | 5 | Framework restates the classic statics as data and generalises the bin and the lower cabinet in four layouts. Minimal rebuilds `GameCore` under `Game`. |
| Parallelisability (15 %) | 6 | 8 | Framework uses a registry, one file per genre and `Record<GenreId, …>` tables. |
| Extensibility toward 40 machines (15 %) | 4 | 9 | Minimal adds `rules.x === …` branches. Framework has a rules seam and data variants. |
| Player experience (20 %) | 5 | 8 | Minimal puts the bridge on the front strip (one overhang out of reach, back half empty) and uses tiny gems. Framework has a centred bridge, a full-width trough and big gems. |
| **Weighted** | **5.7** | **7.25** | |

**Verdict.** The **framework design is the base**: registry, genre modules, a `TryRules` seam, `MachineField`, a
headless `PlaySession`, per-genre pilots and `available: false` gating. It takes these grafts from the minimal
design:
- classic code paths stay where they are (no rules object means classic);
- fixtures are added after the bin, so the Rapier creation order is unchanged;
- today's pick never selects classic;
- the shelf and the rush give one session prize, not a QR per try;
- the player's machine is runtime state, not a persisted setting.

On top of both it adds four fixes of its own:
1. **Rebuild the physics stack inside `GameCore`** and keep the `RoundMachine` and the controller event emitter.
   Classic is then bit-identical even after a round trip, the e2e capture survives, and round ids stay unique.
2. **Every prize opening lies inside the existing bin footprint.** The bin colliders, the lower cabinet, the prize
   window and the four layouts stay byte-identical.
3. **Guide lines are budgeted correctly**: the existing generic pool plus the GTC brand pool that a test requires.
4. **The e2e bridge win uses a debug impulse**, not a recorded input sequence.

### 0.2 Claims checked against the code (corrections both designs need)

| # | Finding | Evidence | Consequence |
| --- | --- | --- | --- |
| V1 | The line bank already has a theme-neutral `all` pool. | src/ai/lines/index.ts:157-163 pushes `pool.all`. tests/unit/ai/lines.test.ts:79-81 needs ≥ 2 `all` lines per key per language. | Minimal's "≥ 2 lines × 5 themes × 3 languages" and framework's new neutral bank are both unnecessary. |
| V2 | Every line key also needs a **GTC brand pool**. | tests/unit/ai/brandLines.test.ts:146-160 requires a `brand`-flavoured candidate for every event type × variant on the gpu theme with GTC facts. All 29 existing keys have a `gtc` pool (src/ai/lines/en.ts). | Neither design budgeted it: add ≥ 1 `gtc` line per new key per language. |
| V3 | Local lines may only use `{toy}`, `{dir}` and `{near}`. | lines.test.ts:90 and brandLines.test.ts:137 (`{event}` and `{host}` in brand pools only). | Minimal's "{n} points, number {rank}" lines fail. Numbers reach only the model prompt, through `facts.machine`. |
| V4 | The feature namespaces are pinned and keys must be prefixed. | tests/unit/i18n/featureStrings.test.ts:12 lists the names. :24 requires keys `<ns>.` or `set.<ns>.`. | One namespace `machines` with the settings section `machines`. The test's list gains `'machines'`. Framework's `lobby.*`, `hud.*` and `rank.*` keys would fail. |
| V5 | The e2e suite binds event capture once, to `core().machine.events`. | tests/e2e/helpers.ts:118-129. `Game.bindCore` also binds once (src/app/Game.ts:653-728). | Minimal's `new GameCore` per switch would silently stop `__results` / `__awards` and every Game listener. Keep the `RoundMachine` and the controller emitter alive. |
| V6 | Only `ClawVisual` keeps a reference to a core subsystem. | `new ClawVisual(this.core.claw, …)` (Game.ts:349). `AttractDirector` (src/game/attract.ts:81-135), `DemoPilot` (src/app/DemoPilot.ts:40-130) and the frame loop read `core.phys / claw / field / controller` lazily. | Swapping phys, claw, grip, controller and field behind getters is cheap. Only the claw visual is recreated. |
| V7 | The prize bin is BIN-only, and the glass forms two of its walls. | PhysicsWorld.ts:199-202 (the left and front glass go below the floor), :231-251 (the bin's right and back walls come from `BIN`). Cabinet.ts:319-377 (shaft, cushion, fascia, badge and decals laid out from `BIN` per layout). | Framework's centred pit (x ±0.20) and full-width trough need a new bin plus a new lower cabinet in four layouts. Openings inside `BIN` (x −0.50…0.02, z −0.42…0) need neither. |
| V8 | In-place geometry swaps reuse Rapier slots. | Framework §1.5.6 says so itself. | A fresh `PhysicsWorld` per switch has no such drift: every Rapier world has its own arenas. |
| V9 | Minimal's ledge drains only to x = 0.34. | Minimal §2.0 end block at x 0.32-0.34. | A box falling over the lip at x ∈ (0.34, 0.5) lands on plain floor: it is not scored and the claw axis can barely reach it (CLAW.maxX 0.37). |
| V10 | Minimal's bridge front overhang is out of reach. | Box front end at z −0.08, bar at z −0.11, `CLAW.maxZ = −0.13` (src/physics/fieldSpec.ts:69). | Only one end can be worked. |
| V11 | `ToyVisuals` skips a toy only when the library has no model for `asset.id`. | src/scene/ToyVisuals.ts:248-250. | Item assets get synthetic ids (`item.<look>`), and `ToyVisuals.sync` also skips `toy.item` explicitly (belt and braces). |
| V12 | The claw's reach is clamped to `CLAW` inside `ClawRig`. | ClawRig.ts:237-242 and 531-533. | Every layout here stays inside the classic reach, so `ClawRig` needs no change (framework's `setLimits` is dropped). |
| V13 | The demo pilot's variety term reads `toy.id.length` and `roundId`. | DemoPilot.ts:59. | After a switch, demo *choices* differ from a fresh boot, as they already do across one session. The physics state is identical; the golden test compares physics, not demo choices across sessions. |
| V14 | `?theme=` persists through `state.set` (src/app/bootstrap.ts:38). | — | `?machine=` must not reuse that pattern, or every e2e boot would pollute storage. It is an in-memory home override. |

---

## 1. Decisions

| # | Decision |
| --- | --- |
| D1 | **One `GameCore`, one `RoundMachine` and one controller emitter for the page's lifetime.** `GameCore.setMachine()` builds a fresh `PhysicsWorld`, `ClawRig`, `GripMonitor`, `RoundController` and field behind getters. Round ids keep counting (claim dedup: src/rewards/protocol.ts:7), and listeners survive (V5). |
| D2 | **Classic is the null rules object.** `RoundController` keeps today's code. Every new branch is `if (this.rules) { … } else { <today's statements> }`. The classic Rapier call sequence is unchanged: no fixture body is created, the floor and guard boxes are today's, and the sensor uses the same numbers. |
| D3 | **A machine is data plus a genre.** `MachineDef = { id, genre, params, available, … }`. A genre (`classic`, `bridge`, `shelf`, `rush`) is a `GenreModule` in one file under `src/game/machines/`. A variant (narrower bars, a 60 s rush) is one registry entry. |
| D4 | **Field geometry is data, constrained this round.** `FieldGeometry = { floor: classic \| hole, chuteGuard, opening, fixtures, home }`. `validateGeometry` enforces one opening per machine, inside the `BIN` footprint (V7), and everything at rest below y 0.44 (the claw's travel clearance, section 3.0). |
| D5 | **Items are `ToyBody`s with `item: ItemSpec`** (one optional field). `GripMonitor` (it only scans toys, GripMonitor.ts:194-268), impacts, the sensor, interpolation and the debug API then work on them unchanged. `ItemVisuals` draws them; `ToyVisuals` skips them. |
| D6 | **The claw never changes shape.** A genre scales the round parameters and chooses the lift rule (full or partial), the transport rule (chute, forward, in place, always to the chute) and the home position. |
| D7 | **Round = one try** (unchanged). A headless **`PlaySession`** sits above it: `open` (classic, bridge), `tries` (shelf, 5) or `timed` (rush, 75 s of simulated time). |
| D8 | **Two presentations.** `'prize'` genres (classic, bridge) award one prize per try through `RoundMachine.awardPrize`, so Game's existing win path (collection, score, QR, win card) runs. `'items'` genres (shelf, rush) score items per try and grant at most one **session prize** at the session end (collection + QR). |
| D9 | **The player's machine is runtime state** (`Game.selectMachine`), switched at a round boundary behind the theme curtain. `machines.home` (a setting) is what attract mode shows and where the idle reset returns. `?machine=` overrides `home` for one page load, without persisting it. |
| D10 | **Gated merges.** Each non-classic machine stays `available: false` until its contract test, its genre tests, its sweep gates, its e2e spec and the perf gate pass. `main` stays classic-only for players all round. |

---

## 2. The machine abstraction

### 2.1 Files

```
src/game/machines/ids.ts        NEW  ids and small unions (no imports; used by settings, UI, AI, server)          [scaffold]
src/game/machines/types.ts      NEW  TryRules, TryContext, MachineField, SessionRule, GenreModule, MachineDef...  [scaffold]
src/physics/fieldGeometry.ts    NEW  FieldGeometry, Fixture, PrizeOpening, CLASSIC_FIELD, validate, floorWithHole [scaffold types; WS-A bodies]
src/physics/items.ts            NEW  ItemSpec, itemAsset(), boxItem(), gemItem(), coinItem()                       [scaffold types; WS-A bodies]
src/game/machines/registry.ts   NEW  GENRES, MACHINES, resolveMachine(), offeredMachines(), neighbours()          [WS-A]
src/game/machines/classic.ts    NEW  classicModule (rules null, ToyField, today's defaults)                       [WS-A]
src/game/machines/session.ts    NEW  PlaySession                                                                  [WS-A]
src/game/machines/bridge.ts     NEW  bridgeModule: geometry, BridgeRules, BridgeField, aim, settings mapping      [WS-B]
src/game/machines/shelf.ts      NEW  shelfModule                                                                  [WS-C]
src/game/machines/rush.ts       NEW  rushModule                                                                   [WS-C]
src/game/machines/pieces.ts     NEW  item placement, the shared item award check, the item scorer helpers         [WS-C]
src/game/machines/daily.ts      NEW  dailyPick(ymd, candidates) (pure)                                            [WS-D]
src/app/MachineDirector.ts      NEW  app glue: switching, item scoring, session prizes, guide policy, HUD slice   [WS-D]
src/app/MachinePilot.ts         NEW  generic attract steering driven by GenreModule.aim (DemoPilot unchanged)      [WS-D]
src/app/machineSfx.ts           NEW  machine moments → existing SFX names                                         [WS-D]
src/persistence/machines.ts     NEW  machines/v1: per-machine best and lifetime, top-10 rankings, plays          [WS-D]
src/scene/ItemVisuals.ts        NEW  instanced boxes, snacks, gems and coins following BodyPose                   [WS-E]
src/scene/machines/*.ts         NEW  floor with a hole, fixture looks, print atlas, optional previews for 4A      [WS-E]
src/ui/machines/*.tsx           NEW  lobby, cards, art, SessionHud, TryToast, SessionResultCard, InitialsEntry    [WS-F]
src/i18n/strings/machines.ts    NEW  the `machines` namespace (en / zh / ja)                                      [WS-F]
tools/dev/golden-classic.ts     NEW  records the classic golden trace                                             [WS-A]
tools/dev/machine-sweep.ts      NEW  headless tuning runner (+ tools/dev/sweeps/<genre>.ts)                       [WS-B, WS-C]
```

Everything under `src/game` and `src/physics` falls inside the closure of `tests/unit/core/independence.test.ts`
(entries at :75, allowed modules at :91: game, physics, core, plush/manifest.ts and settings/spec.ts). The new files
are therefore checked with no change to the test. `src/game/machines/*` must never import `src/app/*`: the pilot
steering lives in `src/app/MachinePilot.ts`, and the genres only export pure `aim()` strategies.

### 2.2 The scaffold (the first commit, under an hour, contracts only, no behaviour)

It contains the files and edits listed in section 6.1. The exact code follows; the lead pastes it.

```ts
// src/game/machines/ids.ts  (no imports)
export const GENRE_IDS = ['classic', 'bridge', 'shelf', 'rush'] as const;
export type GenreId = (typeof GENRE_IDS)[number];
/** Every registered machine. A data-only variant adds an id here and an entry in registry.ts. */
export const MACHINE_IDS = ['classic', 'bridge', 'shelf', 'rush'] as const;
export type MachineId = (typeof MACHINE_IDS)[number];
export const DEFAULT_MACHINE: MachineId = 'classic';
export type MachineControls = 'joystick' | 'twoStep';
export type SessionKind = 'open' | 'tries' | 'timed';
export type SessionState = 'idle' | 'running' | 'over';
export type SessionEndReason = 'tries' | 'time' | 'abandoned';
```

```ts
// src/physics/fieldGeometry.ts  (physics layer: imports core and fieldSpec only)
import type { Quat, Vec3 } from '../core/types';
import { BIN, CLAW, PRIZE_SENSOR } from './fieldSpec';

export type FixtureKind = 'bar' | 'fence' | 'shelf' | 'lip' | 'gutter';
/** Renderer hint (src/scene/machines); physics never reads it. */
export type FixtureLook = 'chrome' | 'acrylic' | 'deck' | 'ramp' | 'hidden';
export type FixtureShape =
  | { type: 'box'; half: Vec3 }
  /** Rapier capsule along one world axis; `halfLength` is half of the straight part. */
  | { type: 'capsule'; axis: 'x' | 'y' | 'z'; halfLength: number; radius: number };

export interface Fixture {
  id: string;
  kind: FixtureKind;
  look: FixtureLook;
  shape: FixtureShape;
  /** World metres, fieldSpec frame (+Y up, floor top y = 0, front glass z = 0). */
  center: Vec3;
  rot?: Quat;
  friction: number;
  restitution: number;
  /** 'min' = this surface's (low) friction wins: the slick gutter. Default: Rapier's average. */
  frictionCombine?: 'average' | 'min';
}

export interface Rect { xMin: number; xMax: number; zMin: number; zMax: number }

/** The floor hole that pays out, with the sensor volume below it. */
export interface PrizeOpening extends Rect {
  sensorTop: number;    // classic -0.1
  sensorBottom: number; // classic -0.3
  /** The centre of mass must be below this (classic -0.06). */
  awardComY: number;
  /** "Over the opening" tolerance (classic 0.02, RoundController.ts:427). */
  overMargin: number;
}

export interface FieldGeometry {
  /** 'classic' = today's two floor boxes around CHUTE (PhysicsWorld.ts:184-195); 'hole' = floorWithHole(hole). */
  floor: { kind: 'classic' } | { kind: 'hole'; hole: Rect };
  /** Today's clear guard walls around CHUTE (PhysicsWorld.ts:209-212); only valid with the classic floor. */
  chuteGuard: boolean;
  opening: PrizeOpening;
  /** Extra static parts, created on their own fixed body AFTER the bin (classic: none, no body). */
  fixtures: readonly Fixture[];
  /** Trolley rest position, inside CLAW.minX..maxX / minZ..maxZ. */
  home: { x: number; z: number };
}

export const CLASSIC_OPENING: PrizeOpening = {
  xMin: PRIZE_SENSOR.xMin, xMax: PRIZE_SENSOR.xMax, zMin: PRIZE_SENSOR.zMin, zMax: PRIZE_SENSOR.zMax,
  sensorTop: PRIZE_SENSOR.yTop, sensorBottom: PRIZE_SENSOR.yBottom, awardComY: PRIZE_SENSOR.awardComY, overMargin: 0.02,
};
export const CLASSIC_FIELD: FieldGeometry = {
  floor: { kind: 'classic' }, chuteGuard: true, opening: CLASSIC_OPENING, fixtures: [], home: { x: CLAW.homeX, z: CLAW.homeZ },
};
/** Round 4B rule: every opening lies inside the prize bin's footprint (the bin and lower cabinet stay as they are). */
export const BIN_FOOTPRINT: Rect = { xMin: BIN.xMin, xMax: BIN.xMax, zMin: BIN.zMin, zMax: BIN.zMax };
/** Problems found ([] = ok): opening outside BIN_FOOTPRINT, a hole that does not contain the opening, a fixture
 *  above y 0.44 or outside the glass, home outside the claw reach, guard with a non-classic floor, NaN. */
export function validateGeometry(g: FieldGeometry): string[] { void g; throw new Error('WS-A: validateGeometry'); }
/** Up to four floor boxes (y -0.06..0) around a rectangular hole. */
export function floorWithHole(hole: Rect): { center: Vec3; half: Vec3 }[] { void hole; throw new Error('WS-A: floorWithHole'); }
export function overOpening(o: PrizeOpening, x: number, z: number, margin = o.overMargin): boolean {
  return x > o.xMin - margin && x < o.xMax + margin && z > o.zMin - margin && z < o.zMax + margin;
}
/** Where effects and popups anchor (replaces Game.ts:88 EXIT_POS for non-classic machines). */
export function openingCenter(o: PrizeOpening): { x: number; y: number; z: number } {
  return { x: (o.xMin + o.xMax) / 2, y: o.sensorTop + 0.04, z: (o.zMin + o.zMax) / 2 };
}
```

```ts
// src/physics/items.ts
import type { ThemeId, Vec3 } from '../core/types';
import type { PlushAsset, ProxyShape } from '../plush/manifest';

export type ItemKind = 'box' | 'snack' | 'gem' | 'coin';
export type ItemLook =
  | 'bridgeBox' | 'snackS' | 'snackM' | 'snackL'
  | 'gemEmerald' | 'gemSapphire' | 'gemRuby' | 'gemDiamond' | 'coin';

export interface ItemSpec {
  kind: ItemKind;
  /** Visual recipe for src/scene/ItemVisuals (physics never reads it). */
  look: ItemLook;
  size: Vec3; mass: number; comHeight: number; footprint: number;
  /** Same proxy type as the plush manifest, so PhysicsWorld.colliderDesc (PhysicsWorld.ts:279-303) builds it. */
  proxies: readonly ProxyShape[];
  friction: number; restitution: number; linearDamping: number; angularDamping: number;
  /** Manifest id of the character printed on a box or snack: what the collection / claim code names. null for gems and coins. */
  print: string | null;
  /** Points of a gem or coin (raw, physics-free); 0 for printed items (they score by the print's rarity). */
  value: number;
}
/** The PlushAsset a ToyBody needs. Its id is `item.<look>` (never a manifest id: ToyVisuals, voices and rarity ignore it). */
export function itemAsset(spec: ItemSpec, themeId: ThemeId): PlushAsset { void spec; void themeId; throw new Error('WS-A: itemAsset'); }
export function boxItem(o: { look: ItemLook; size: Vec3; mass: number; round: number; friction: number; print: string | null }): ItemSpec { void o; throw new Error('WS-A'); }
/** 17-point brilliant hull (flat table, culet). */
export function gemItem(o: { look: ItemLook; radius: number; mass: number; value: number }): ItemSpec { void o; throw new Error('WS-A'); }
/** 12-gon prism hull. */
export function coinItem(o: { radius: number; thickness: number; mass: number; value: number }): ItemSpec { void o; throw new Error('WS-A'); }
```

```ts
// src/physics/PhysicsWorld.ts  (scaffold: type-only edits)
import type { FixtureKind } from './fieldGeometry';
import type { ItemSpec } from './items';
export type StaticKind = 'floor' | 'glass' | 'backWall' | 'ceiling' | 'chuteWall' | 'bin' | FixtureKind;   // line 15
export interface ToyBody {   // lines 52-65, one optional field added
  /* …unchanged… */
  /** Set for machine items (boxes, snacks, gems, coins); absent on plush toys. */
  item?: ItemSpec;
}
```

```ts
// src/core/types.ts  (scaffold) — RoundResult gains ONE optional field; classic results never carry it.
export interface MachineItem {
  toyId: string;
  kind: 'box' | 'snack' | 'gem' | 'coin';
  look: string;
  print: string | null;
  value: number;
  /** 1-based order within the try. */
  index: number;
}
export interface MachineRoundInfo {
  id: string;            // MachineId
  genre: string;         // GenreId
  items: MachineItem[];  // shelf / rush: items scored in this try
  progress: number | null;      // bridge: 0..1 after the try (presentation / guide only)
  progressGain: number | null;
  stuck: boolean;        // bridge: "Call staff" is lit
}
// in RoundResult (types.ts:47-71):
  /** Only on non-classic machines. */
  machine?: MachineRoundInfo;
```

```ts
// src/game/machines/types.ts
import type { RoundPhase, RoundResult } from '../../core/types';
import type { Emitter } from '../../core/events';
import type { ClawRig } from '../../physics/ClawRig';
import type { FieldGeometry, PrizeOpening } from '../../physics/fieldGeometry';
import type { GripMonitor } from '../../physics/GripMonitor';
import type { ItemKind, ItemLook } from '../../physics/items';
import type { PhysicsWorld, ToyBody } from '../../physics/PhysicsWorld';
import type { PlushAsset } from '../../plush/manifest';
import type { Settings } from '../../settings/spec';
import type { GameCore } from '../GameCore';
import type { RarityTier } from '../rarity';
import type { RoundControllerEvents, RoundParams } from '../RoundController';
import type { RoundMachine } from '../RoundMachine';
import type { RoundScore, ScoringDifficulty } from '../scoring';
import type { FieldOptions } from '../ToyField';
import type { GenreId, MachineControls, MachineId, SessionEndReason, SessionKind, SessionState } from './ids';

/* ------------------------------------------------------------ one try (round) */

/** What a rule may read. RoundController implements it (these are its own fields). */
export interface TryContext {
  readonly phys: PhysicsWorld;
  readonly claw: ClawRig;
  readonly grip: GripMonitor;
  readonly machine: RoundMachine;
  readonly events: Emitter<RoundControllerEvents>;
  readonly params: Readonly<RoundParams>;
  readonly opening: PrizeOpening;
  /** The fingers opened on a held target this try. */
  readonly releasedHolding: boolean;
}

export interface TransportPlan { x: number; z: number; speed: number; /** wait for the swing to calm before releasing */ toOpening: boolean }

/** Present only on non-classic machines (classic = null: RoundController runs today's code). */
export interface TryRules {
  readonly home: { x: number; z: number };
  /** READY, after the controller's own resets (RoundController.ts:147-162). */
  beginTry(ctx: TryContext): void;
  /** LIFTING: the rope length to wind to (classic CLAW.ropeMin, RoundController.ts:187). */
  liftTarget(ctx: TryContext): number;
  /** TRANSPORTING target (classic RoundController.ts:191-197). */
  transportTarget(ctx: TryContext, holding: boolean): TransportPlan;
  /** SETTLING entered (classic: go home, :208). The bridge winds the cable up first. */
  beginSettling(ctx: TryContext): void;
  /** End of every postStep in every phase but ATTRACT (replaces checkPrize at :349/356/369/375 and checkStrays at :394). */
  postStep(ctx: TryContext, phase: RoundPhase, phaseTime: number, dt: number): void;
  /** SETTLING: may the try end now (classic :376-388)? */
  canFinish(ctx: TryContext, phaseTime: number): boolean;
  /** Merged into the result built at :491-505; must not change roundId / demo / themeId / prizeId. */
  resultExtras(ctx: TryContext, base: RoundResult): Partial<RoundResult>;
  /** READY / AIMING input (twoStep controls). Absent = the free joystick. */
  filterInput?(ctx: TryContext, x: number, z: number): { x: number; z: number; grab: boolean; stage: 'x' | 'z' | null };
  /** window.__plush.machine() and the sweeps. */
  debugState?(): Record<string, unknown>;
}

/* ------------------------------------------------------------ field contents */

/** ToyField's public API (src/game/ToyField.ts) as an interface; ToyField implements it unchanged. */
export interface MachineField {
  setOptions(options: FieldOptions): void;
  fill(assets: PlushAsset[], seed?: number): ToyBody[];
  onField(): ToyBody[];
  inBin(): ToyBody[];
  /** Classic restock rain (Game.ts:943-947, 1009-1034); genre fields return 0. */
  missing(): number;
  restockOne(): ToyBody | null;
  clearBin(): ToyBody[];
  clearFallen(): ToyBody[];
  settle(maxSeconds?: number, preStep?: () => void, postStep?: () => void): number;
  /** Genre fields: refills placed AT REST, at READY and ATTRACT only (never inside fixedStep). Returns bodies added;
   *  GameCore settles off-screen when > 0. */
  atBoundary?(phase: 'READY' | 'ATTRACT', demo: boolean): number;
  /** A player takes over from attract / PLAY AGAIN after a session: back to the start layout. */
  resetForTakeover?(): number;
  /** "Call staff" (bridge): the prize back to its start pose. Never awards anything. Boundary only. */
  staffReset?(): boolean;
  stuck?(): boolean;
}

/* ------------------------------------------------------------ sessions */

export type SessionRule = { kind: 'open' } | { kind: 'tries'; tries: number } | { kind: 'timed'; seconds: number };

export interface SessionSnapshot {
  id: number; machineId: MachineId; kind: SessionKind; state: SessionState;
  tries: number; triesTotal: number | null;
  secondsLeft: number | null; timerStarted: boolean;
  /** Items scored this session and the sum of their raw values (physics facts). */
  items: number; value: number;
  reason: SessionEndReason | null;
  reward: SessionReward | null;
  lastRoundId: number;
}
export interface SessionSummary {
  machineId: MachineId; sessionId: number; tries: number;
  items: readonly ScoredItem[]; value: number; lastRoundId: number; reason: SessionEndReason;
}
export interface SessionReward { typeId: string; tier: RarityTier; prizeId: string; roundId: number }
export interface PlaySessionEvents extends Record<string, unknown> {
  started: SessionSnapshot;
  second: { secondsLeft: number };     // timed: on whole seconds
  timeLow: { secondsLeft: number };    // timed: once, at 10 s
  over: SessionSnapshot;               // never for demo rounds
}

/* ------------------------------------------------------------ scoring */

export type ScoredItem = { toyId: string; kind: ItemKind; look: ItemLook; print: string | null; value: number; index: number };
export interface TryScoreInput {
  roundId: number; demo: boolean; difficulty: ScoringDifficulty;
  items: readonly ScoredItem[];
  /** 1 = none; machines.dailyBonus on today's pick (presentation only). */
  dailyBonus: number;
}

/* ------------------------------------------------------------ genre + machine */

/** Multipliers applied to the RoundParams the difficulty preset produced (absent = ×1). gripAssist 0 = pure friction. */
export interface ClawScale {
  moveSpeed?: number; moveAccel?: number; descendSpeed?: number; liftSpeed?: number;
  clawForce?: number; closeSpeed?: number; ropeSwing?: number; gripAssist?: number;
}
export interface BridgeParams {
  centerX: number; centerZ: number; gap: number; barRadius: number; barY: number; barFriction: number;
  box: [number, number, number]; boxMass: number; boxFriction: number; startJitter: number; startYawDeg: number;
  liftDelta: number; triesPerBox: number; controls: MachineControls; claw: ClawScale;
}
export interface ShelfParams {
  shelfY: number; shelfFront: number; lipHeight: number; shelfFriction: number;
  rowsZ: readonly number[]; columnsX: readonly number[]; stackHeight: number;
  tries: number; rewardItems: number; dropZ: number; claw: ClawScale;
}
export interface RushParams { seconds: number; pieces: number; radiusScale: number; rewardValue: number; claw: ClawScale }
export interface GenreParams { classic: Record<string, never>; bridge: BridgeParams; shelf: ShelfParams; rush: RushParams }

export interface AimPlan { x: number; z: number; /** s to wait for the swing to calm */ patience: number; targetToyId: string | null }

export type MachineSettings = Settings['machines'];

export interface GenreModule<G extends GenreId = GenreId> {
  readonly genre: G;
  readonly defaults: Readonly<GenreParams[G]>;
  /** 'prize': one collection prize per try via RoundMachine.awardPrize (classic, bridge).
   *  'items': points items per try + at most one session prize (shelf, rush). */
  readonly presentation: 'prize' | 'items';
  /** Phases in which awardPrize may succeed (classic: AWARD_PHASES, RoundMachine.ts:38). */
  readonly awardPhases: ReadonlySet<RoundPhase>;
  fromSettings(s: MachineSettings): Partial<GenreParams[G]>;
  geometry(p: GenreParams[G]): FieldGeometry;
  session(p: GenreParams[G]): SessionRule;
  controls(p: GenreParams[G]): MachineControls;
  roundParams(base: RoundParams, p: GenreParams[G]): RoundParams;
  /** null for classic: RoundController runs today's code. */
  createRules(p: GenreParams[G], g: FieldGeometry): TryRules | null;
  createField(phys: PhysicsWorld, options: FieldOptions, p: GenreParams[G], g: FieldGeometry): MachineField;
  /** 'items' genres: pure points for one finished try. */
  scoreTry?(input: TryScoreInput, p: GenreParams[G]): RoundScore;
  /** 'items' genres: the session prize from physics facts only; null = none. */
  sessionReward?(s: SessionSummary, p: GenreParams[G], prints: readonly { id: string; tier: RarityTier }[]): { typeId: string } | null;
  /** Attract pilot strategy (classic: absent, DemoPilot is used). */
  aim?(core: GameCore, demoRound: number, p: GenreParams[G]): AimPlan | null;
}

export interface MachineDef<G extends GenreId = GenreId> {
  id: MachineId; genre: G;
  /** Lobby order. */
  order: number;
  /** A variant is just different numbers here. */
  params: Partial<GenreParams[G]>;
  /** false: hidden from the lobby, resolveMachine falls back to classic. */
  available: boolean;
  /** machines.unlock = 'progress': collection wins needed. */
  unlockAfterWins: number;
}
export interface ResolvedMachine<G extends GenreId = GenreId> {
  def: MachineDef<G>; module: GenreModule<G>; params: GenreParams[G];
  geometry: FieldGeometry; session: SessionRule; controls: MachineControls;
}
```

```ts
// src/core/contracts.ts  (scaffold)
export const GUIDE_EVENT_TYPES = [ /* …the 11 existing… */
  'machine_selected', 'machine_progress', 'items_scored', 'time_low', 'session_over'] as const;
// GuideFacts gains (numbers and enums only; the name is the localised machine name):
  machine?: {
    id: string; genre: 'bridge' | 'shelf' | 'rush'; name: string;
    tries?: number; triesLeft?: number | null; progress?: number; progressGain?: number; stuck?: boolean;
    items?: number; sessionItems?: number; score?: number; secondsLeft?: number;
    rank?: number | null; reason?: 'tries' | 'time' | null;
  } | null;
```

```ts
// src/ai/GuideDirector.ts:44-72 (scaffold): GUIDE_PRIORITY  machine_selected 2, machine_progress 2, items_scored 2, time_low 3, session_over 3
//                                        GUIDE_COOLDOWN_MS machine_selected 1_200, machine_progress 8_000, items_scored 6_000, time_low 0, session_over 0
// src/ai/prompt.ts:107 EVENT_TASKS (scaffold, one sentence each; WS-F refines the wording)
// src/ai/lines/index.ts resolveSituation (scaffold, TEMPORARY mapping onto existing keys that already have gtc pools):
//   machine_selected → ['theme'], machine_progress → ['tip'], items_scored → ['win'], time_low → ['tip'], session_over → ['retry']
// server/schemas.ts FactsSchema (scaffold):
  machine: z.strictObject({
    id: text(32), genre: z.enum(['bridge', 'shelf', 'rush']), name: text(AI_LIMITS.maxToyNameChars),
    tries: z.number().int().min(0).max(100_000).optional(), triesLeft: z.number().int().min(0).max(1000).nullable().optional(),
    progress: z.number().min(0).max(1).optional(), progressGain: z.number().min(-1).max(1).optional(), stuck: z.boolean().optional(),
    items: z.number().int().min(0).max(500).optional(), sessionItems: z.number().int().min(0).max(5000).optional(),
    score: z.number().int().min(0).max(100_000_000).optional(), secondsLeft: z.number().min(0).max(600).optional(),
    rank: z.number().int().min(1).max(10).nullable().optional(), reason: z.enum(['tries', 'time']).nullable().optional(),
  }).nullable().optional(),
```

```ts
// src/app/gameStore.ts  (scaffold)
export type ModalId = 'settings' | 'collection' | 'tutorial' | 'device' | 'themes' | 'lobby' | null;   // line 36
export interface MachineCardInfo {
  id: MachineId; genre: GenreId; locked: boolean; winsToUnlock: number; current: boolean;
  dailyPick: boolean; best: number; prizesHere: number; top: { initials: string; score: number }[];
}
export interface MachineUiState {
  id: MachineId; genre: GenreId; controls: MachineControls; presentation: 'prize' | 'items';
  switching: boolean;
  /** The MACHINES / leave-machine button may be pressed now (machines.lobby on, at a round boundary). */
  lobby: boolean;
  session: { kind: SessionKind; state: SessionState; tries: number; triesTotal: number | null; secondsLeft: number | null; items: number; points: number };
  progress: number | null;
  staff: { available: boolean; highlighted: boolean };
  dailyPick: MachineId | null;
  /** Points multiplier active on this machine (1 = none). */
  bonus: number;
  /** 'items' genres: the last try, for the try toast. */
  lastTry: { roundId: number; items: number; points: number } | null;
  /** twoStep: which button is live. */
  axisStage: 'x' | 'z' | null;
  /** 4A's coin plate: an i18n key and its parameters. */
  plate: { key: string; params?: Record<string, string | number> };
}
export interface SessionResultUi {
  machineId: MachineId; roundId: number; reason: SessionEndReason; items: number; points: number; best: number;
  rank: number | null; rewardTypeId: string | null;
}
export interface RankEntryUi { machineId: MachineId; score: number; position: number; deadline: number }
export const INITIAL_MACHINE: MachineUiState = {
  id: 'classic', genre: 'classic', controls: 'joystick', presentation: 'prize', switching: false, lobby: true,
  session: { kind: 'open', state: 'idle', tries: 0, triesTotal: null, secondsLeft: null, items: 0, points: 0 },
  progress: null, staff: { available: false, highlighted: false }, dailyPick: null, bonus: 1, lastTry: null,
  axisStage: null, plate: { key: 'machines.plate.free' },
};
// GameUiState gains: machine: MachineUiState; sessionResult: SessionResultUi | null; rankEntry: RankEntryUi | null;
```

```ts
// src/app/Game.ts  (scaffold): LaunchParams (:50-61) gains   machine?: MachineId | null;
// public stubs, bodies by WS-D:
selectMachine(id: MachineId): boolean { void id; return false; }
openLobby(): void {}
machineAction(action: 'staff'): boolean { void action; return false; }
stepInput(step: 1 | 2, pressed: boolean): void { void step; void pressed; }
newSession(): void {}
submitInitials(initials: string): boolean { void initials; return false; }
machineCards(): MachineCardInfo[] { return []; }
// src/app/launch.ts (:15-29): machine: pick<MachineId>(q.get('machine'), MACHINE_IDS)
```

The `machines` settings group (section 4.6) is also part of the scaffold.

### 2.3 How the existing classes change (all of it in WS-A unless stated)

| File | Change | Classic effect |
| --- | --- | --- |
| `src/physics/fieldSpec.ts` | **None.** | — |
| `src/physics/PhysicsWorld.ts` | `PhysicsOptions` (:79-83) gains `field?: FieldGeometry` (default `CLASSIC_FIELD`) and `idPrefix?: string` (default `''`).<br>`buildCabinet` (:173-229): floor = today's two `addStatic` calls when `floor.kind === 'classic'`, else `floorWithHole(hole)` boxes. The glass, back wall and ceiling are unchanged. The guard walls only run when `chuteGuard`. The sensor reads `field.opening` (same numbers for classic).<br>The constructor (:127-135) runs `buildFixtures()` **after** `buildBin()`, only when `fixtures.length > 0`, on its own fixed body. Fixture handles go into `staticKinds` with their `kind`; a capsule becomes `ColliderDesc.capsule` rotated to its axis; `frictionCombine: 'min'` sets `CoefficientCombineRule.Min`.<br>New `addItem(spec, themeId, pos, rot)`: the `addToy` (:305-352) body with the spec's damping, friction, restitution and mass; sets `toy.item`.<br>`setToyFriction` (:262-265) skips toys with `item`.<br>New getter `opening`. | Identical Rapier call sequence and numbers; no extra body. |
| `src/physics/ClawRig.ts`, `GripMonitor.ts`, `ToyField.ts` | **None.** `ToyField` gains `implements MachineField` (type only). | — |
| `src/game/RoundMachine.ts` | `AWARD_PHASES` (:38) becomes the default of an instance field; new `configure({ awardPhases })`, boundary only.<br>New `scoreItem(roundId, toyId, item): MachineItem \| null`: refused in ATTRACT and RESULT, for a stale round, or for a toy already scored since the last `configure`. Emits a new `item` event `{ …MachineItem, roundId, demo }`. New getter `roundItems`, cleared by `beginRound`.<br>New `awardSessionPrize(roundId, typeId): PrizeAward \| null`: not for demo rounds, once per round id, prize id `${sessionId}-${roundId}-S`; emits the existing `award` event with `session: true`. `PrizeAward` (:57-63) gains `session?: true`.<br>`awardPrize` (:185-200) is **unchanged**. | none |
| `src/game/RoundController.ts` | The constructor (:83-95) gains `opts: { events?: Emitter<RoundControllerEvents>; rules?: TryRules \| null; opening?: PrizeOpening; subscribe?: boolean }`. When `subscribe` is false, GameCore forwards `phase` / `watchdog` to the new public `handlePhase` / `handleWatchdog` (they call today's private `onPhase` / `onWatchdog`, :144 and :215).<br>Every call site below gets `if (this.rules) … else <today>`. New `inputLocked` flag (classic never sets it). New event `itemScored { roundId, toy, item }`. `phys`, `claw`, `grip` and `machine` become `readonly` public (they implement `TryContext`). | Code unchanged inside the `else`. |
| `src/game/GameCore.ts` | See section 2.4: the physics stack sits behind getters, plus `session`, `controllerEvents`, `def`, `setMachine`, `setParams`. `fixedStep` (:48-56) gains one first line, `this.session.preStep(FIXED_DT)` (returns at once for `open`). | Same construction order for the Rapier objects. |
| `src/game/attract.ts` | `resetField` (:121-135) starts with `const n = this.core.field.resetForTakeover?.(); if (n !== undefined) { this.core.settle(1.5); return n; }`. | Method absent → today's loop. |
| `src/game/scoring.ts` (WS-D) | Additive: `ScoreKeeper.settleScored(roundId, demo, round: RoundScore)` does the bookkeeping of `settle` (:184-204) without `scoreRound`. `ScoreKeeper.useRecord(record, onPersist)` swaps records on a machine switch. `RoundScore` gains optional `items?: number`, `extras?: { key: string; points: number }[]` and `dailyBonus?: number`. `scoreRound` (:103-144) is **untouched**. | none |
| `src/app/DemoPilot.ts` | **None** (classic still uses it). | — |

**RoundController call-site map** (→ means "when `this.rules` is set").

| Site (src/game/RoundController.ts) | Non-classic branch |
| --- | --- |
| READY / ATTRACT home (:161, :167), `resetRound` (:136) | `rules.home`. READY then calls `rules.beginTry(this)` after `grip.beginRound()`. |
| READY / AIMING input (:250-278) | Top: `if (this.inputLocked) { claw.setTrolleyVelocity(0, 0); this.grabQueued = false; break; }`. Then `rules.filterInput?.(this, x, z)` maps x / z, may queue the grab, and emits `axisStage`. |
| LIFTING winch (:187) | `claw.setWinch(rules.liftTarget(this), liftSpeed)` |
| TRANSPORTING target (:191-197) | `const t = rules.transportTarget(this, this.grip.holding()); this.destinationIsChute = t.toOpening; claw.setTrolleyTarget(t.x, t.z, t.speed)` |
| Lost toy on the way (:357-361) | Skipped (the rules decide the destination). |
| SETTLING entry (:208) | `rules.beginSettling(this)` |
| `checkPrize()` at :349 / :356 / :369 / :375 | Skipped (`rules.postStep` awards). |
| SETTLING finish (:376-388) | `if (rules.canFinish(this, m.phaseTime)) m.finish(this.buildResult())` |
| `checkStrays()` (:394) | `rules.postStep(this, phase, m.phaseTime, dt)` (not in ATTRACT) |
| `buildResult()` end (:491-505) | `const r = {…today…}; return this.rules ? { ...r, ...this.rules.resultExtras(this, r) } : r;` |
| `requestGrab` (:120-125) | Returns false when `inputLocked`. |

### 2.4 GameCore: one simulation identity, a rebuildable physics stack

```ts
export interface GameCoreOptions { /* …today's fields… */ machine?: ResolvedMachine }

export class GameCore {
  readonly machine: RoundMachine;                                   // kept for the page's lifetime
  readonly controllerEvents = new Emitter<RoundControllerEvents>(); // kept: Game.bindCore / e2e bind once
  readonly session: PlaySession;
  themeId: ThemeId;
  time = 0;
  get phys(): PhysicsWorld; get claw(): ClawRig; get grip(): GripMonitor;
  get controller(): RoundController; get field(): MachineField; get def(): ResolvedMachine;

  constructor(o: GameCoreOptions) {
    this.themeId = o.themeId;
    this.machine = new RoundMachine(o.sessionId);
    // Registered first, exactly where the classic controller registered its own listeners (GameCore.ts:43).
    this.machine.events.on('phase', (e) => this.stack.controller.handlePhase(e.phase, e.prev));
    this.machine.events.on('watchdog', (e) => this.stack.controller.handleWatchdog(e.phase));
    this.session = new PlaySession(this);                    // its own phase / result listeners (a no-op for 'open')
    this.machine.events.on('phase', (e) => this.onBoundary(e)); // field.atBoundary + settle (genres only)
    this.stack = this.build(o.machine ?? resolveMachine('classic'), o);   // phys → claw → grip → controller → field
  }

  /** Boundary only (ATTRACT / READY / RESULT). Builds a fresh world; classic after a round trip equals a fresh boot. */
  setMachine(def: ResolvedMachine, ctx: { assets: PlushAsset[]; seed?: number; params: RoundParams; field: FieldOptions }): void;
  /** Game's settings path (Game.ts:1250): applies def.module.roundParams(base) and latches at the next boundary. */
  setParams(base: RoundParams): void;
}
```

`setMachine` runs in this order:
1. Assert `machine.atRoundBoundary`.
2. `session.end('abandoned')`.
3. Dispose the controller (its unsubscribes), then the claw, then the world.
4. Build a fresh stack, with `idPrefix` `e<epoch>-` so toy ids never repeat across stacks.
5. `machine.configure({ awardPhases })`.
6. `session.configure(def.session, def.def.id)`.
7. `claw.reset(home)`.
8. `populate(assets, seed)`.
9. `controller.resetRound('machine_switch', phase === 'ATTRACT' ? 'ATTRACT' : 'READY')`.

The abort in step 9 emits a phase event, so every listener sees a clean READY on the new machine with a new round id.

**Listener order is preserved.** Today the controller's `phase` listener runs before Game's (it is registered in the
GameCore constructor). The forwarders keep that position, and the extra listeners registered between them and Game
are no-ops for classic.

### 2.5 Per-machine geometry, contents and win detection

- **Geometry.** `module.geometry(params)` returns a `FieldGeometry`. The same object drives physics
  (`PhysicsWorld`), rendering (`Cabinet` + `src/scene/machines`, section 5), the effects' opening rect and the pilot.
  Tuning a bar height therefore moves physics and visuals together.
- **Contents.** `module.createField()` returns a `MachineField`:
  - classic: `ToyField` itself;
  - genres: a small class that calls `phys.addItem(spec, …)`, places refills **at rest** (teleported onto bars or
    shelf, then settled off-screen), and implements `resetForTakeover`, `atBoundary` and, for the bridge,
    `staffReset` / `stuck`.

  `missing()` returns 0 on genres, so every classic restock path (Game.ts:668-669, 933-953, 615-636;
  attract.ts:121-135) is a no-op there by construction.
- **Win detection (physics only).** One test for every genre, the one `checkPrize` uses today (RoundController.ts:425-428):
  1. the body's centre of mass is below `opening.awardComY`;
  2. it lies inside `overOpening(…, overMargin)`;
  3. any of its colliders is in the sensor (`sensorHits` or `isInPrizeSensor`).

  Idempotency comes from `RoundMachine.awardPrize` (once per round) or `scoreItem` (once per body). No timer, roll
  or script decides an outcome. Points, daily bonus and prize tier are computed afterwards from these facts.

### 2.6 Session versus round

A **round** is unchanged: one grab, the phase machine of RoundMachine.ts:14-25, one `result`.

A **session** is what a player gets for one START (or PLAY AGAIN on a session card).

| | Classic (`open`) | Bridge (`open`, persistent field) | Shelf (`tries`, persistent field) | Rush (`timed`) |
| --- | --- | --- | --- | --- |
| Starts | first player READY after attract | same; START gives a fresh box | same; START restacks | same; START refills the pile; the timer starts at the first input |
| Between tries | field persists; classic restock; PLAY AGAIN after a win; a miss auto-advances after 1.15 s (Game.ts:1427) | **the box stays exactly where physics left it**; tries on this box counted; a new box after a drop (placed at rest at READY) | **fallen stacks stay fallen**; auto-advance 1.15 s, or 2.0 s after items | auto-advance 0.35 s while time remains |
| Ends | idle reset | idle reset (optional `triesPerBox` resets the box, **never a pity win** [PC]) | after try `tries` (5 [PC]) | at the RESULT after time-up |
| Prize | per win | per box | session: ≥ `rewardItems` boxes | session: raw value ≥ `rewardValue` |

**PlaySession** (headless, in `GameCore`, simulated time only):
- It listens to `machine.events` and ignores demo rounds.
- READY (non-demo) while `idle` → `running`; the session config is latched now.
- DESCENDING → `tries++`.
- `result` → accumulate the try's items and value. If over (`tries` reached, or time up), it computes the reward
  with `module.sessionReward(summary)`, calls `machine.awardSessionPrize(roundId, typeId)`, sets `state = 'over'`,
  emits `over` and sets `controller.inputLocked = true`.
- `newSession()`: `field.resetForTakeover()`, settle, `inputLocked = false`, `state = 'idle'`, then the app calls
  `m.next(false)`.
- ATTRACT → `end('abandoned')`: no reward, no ranking.
- `preStep(dt)`, timed only: while `running` and `timerStarted` (set on the first AIMING), `secondsLeft -= dt`. It
  emits `second` and `timeLow` (10 s, once). At 0:
  - in **AIMING**, `controller.requestGrab()` (the claw drops where it is, like the aim timer, RoundController.ts:265-273);
  - in **READY** (no move since the last RESULT), the session ends now without a try;
  - in a **busy phase**, the try completes and the session ends at its RESULT ("last grab counts").

  Pausing (dialogs, hidden tab) pauses physics and the timer together, so nothing is gained.

### 2.7 How the claw varies

There is one three-finger claw everywhere. The multipliers below apply on top of the difficulty preset
(`module.roundParams`, latched at READY: RoundController.ts:97-113).

| | move | descend | lift | clawForce | closeSpeed | gripAssist | Lift rule | Transport | Home (x, z) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| classic | ×1 | ×1 | ×1 | ×1 | ×1 | preset | full (`ropeMin`) | chute when holding, else home | (0.06, −0.40) |
| bridge | ×0.9 | ×0.8 | ×0.6 | ×0.8 | ×1 | **0** (GripMonitor.ts:340 never creates the spring) | **partial**: rope at CLOSING − `liftDelta` (0.08 m) | **in place** | (0.20, −0.50); twoStep (−0.37, −0.13) |
| shelf | ×1 | ×1 | ×1 | ×1 | ×1 | ×0.6 | full | **forward**: (same x, `dropZ` −0.18), always | (0.06, −0.40) |
| rush | ×1.2 | ×1.25 | ×1.25 | ×1 | ×1.2 | preset | full | **chute, always** (caged pieces ride along) | (0.06, −0.40) |

A real claw variant (two prongs, a scoop) is out of scope. It would mean generalising ClawRig.ts:147-190, the
three-finger arrays in GripMonitor and ClawVisual: about 4-6 engineer-days plus re-measuring PHYSICS.md. The
documented seam is a hub attachment collider (a scoop disc), built only if the rush caging gate fails (about 1 day,
in WS-A's `PhysicsWorld` / `ClawRig` files).

### 2.8 Keeping classic byte-for-byte identical

1. **Golden trace first** (migration step 0, on the untouched tree). `tools/dev/golden-classic.ts` drives the harness
   (tests/unit/game/harness.ts):
   - themes `sakura` seed 7 and `gpu` seed 3;
   - three player rounds at fixed aims (a centred win, an off-centre slip, an empty spot);
   - two attract demo rounds through `AttractDirector` + `DemoPilot`, then a takeover (`leave()`).

   It records every `RoundResult`, every `award`, the phase timeline, a pose hash of every body every 30 steps
   (rounded to 1e-9, folded with FNV-1a), the fill-layout hash and the body and collider counts. The output is
   committed as `tests/unit/machines/__golden__/classic.json`, and `classicGolden.test.ts` asserts equality. The
   existing bit-for-bit test (tests/unit/game/rounds.test.ts:186) only compares two runs of the *same* build.
2. **The round trip is bit-identical too.** `stack.test.ts` runs `setMachine(rush)` → `setMachine(classic)` and
   then the golden script. Pose hashes and results must equal the fixture, ignoring `roundId` / `prizeId`, which keep
   counting by design.
3. **Classic takes no new code path.** `rules` is null, `CLASSIC_FIELD` sends no fixtures, the classic floor and
   guard calls are byte-equal, `presentation: 'prize'` uses Game's existing path, the daily pick never selects
   classic, and `scoreRound` is not edited.
4. **The whole existing e2e suite runs unchanged on the default** (no `?machine` means classic).

### 2.9 Adding machine #40

- **A variant (the usual case): about 0.5-1 day including tuning.** Add one id to `MACHINE_IDS`, one `MachineDef`
  with `params`, and `machines.<id>.name/.tagline/.howto` in three languages. The contract test (section 8.1)
  iterates `MACHINES`, so the new entry gets geometry validation, fill determinism, a 10-try pilot run and leak
  checks for free.
- **A new genre: about 6-10 engineer-days.** It needs a `GenreModule` file, item looks in `ItemVisuals` (if new),
  fixture looks (the generic looks usually suffice), a lobby art SVG, guide line keys and a sweep script. Because
  `GENRES`, the lobby art table, the guide genre keys and `machineSfx` are typed `Record<GenreId, …>`, the compiler
  lists every gap.
- **Next seams, documented and not built:**
  1. `BinSpec`: openings outside the bin footprint, which needs a new bin collider set and a generalised lower
     cabinet in four layouts (about 3-4 days);
  2. kinematic movers for pusher machines (about 2 days);
  3. claw attachments (about 1 day).

---

## 3. The machines

### 3.0 The shared frame

The fieldSpec frame: +X right, +Y up, +Z towards the player, floor top y = 0, inside of the front glass z = 0,
back z = −0.8, walls x = ±0.5 (fieldSpec.ts:10-19).

| Limit | Value | Source |
| --- | --- | --- |
| Claw axis reach | x ∈ [−0.37, 0.37], z ∈ [−0.67, −0.13] | fieldSpec.ts:66-69 |
| Open finger tips | about 0.10 m from the axis | CLAW.elbow / tip / openAngle, fieldSpec.ts:82-87 |
| Finger tips at travel height | y ≈ 0.476 (hub at 0.66, CLAW.anchorY − ropeMin − hubTop) | — |
| Ceiling for anything at rest | 0.44 m | `validateGeometry` |
| Bin footprint | x ∈ [−0.50, 0.02], z ∈ [−0.42, 0] | `BIN`, fieldSpec.ts:50-58 |

**Rules common to the new genres:**
- **Award window.** The bridge awards in DESCENDING … SETTLING (a push during the descent is physics too). Items
  score in READY … SETTLING. A body that falls during RESULT is picked up at the next READY and counts for the next
  try. ATTRACT never awards (`attract.resetField` removes fallen bodies at takeover).
- **Settle to calm.** `canFinish` waits until every body that moved this try is calm (speed < 0.02 m/s for 0.3 s;
  cap 5 s), with the 7 s watchdog (RoundMachine.ts:47) behind it.
- **Refills never pay out.** They are placed at rest, only at READY / ATTRACT, never inside the award window of a
  running try.
- **No strays.** Everything that falls into a genre's opening is a legitimate drop (that is the genre); classic
  keeps its stray rule.

### 3.1 TIPPY BRIDGE (`bridge`) [PC name: Tippy Bridge / 摇摇桥 / ゆらゆらブリッジ]

A boxed prize (a box printed with one of the theme's own characters) lies across two steel bars over a pit. The
player nudges, lifts and turns it over several tries until it drops. Between tries the box stays exactly where
physics left it.

**Top view** (the pit sits inside the bin footprint, left of centre, in easy reach):

```
z=-0.80 ┌───────────────────────────────── back wall ─────────────────────────────────┐
        │                                                    claw home (0.20,-0.50)   │
z=-0.385│ ┌─ end fence ──────────────────────┐                                        │
        │ │  ║bar x=-0.287       bar x=-0.113║ │      (render-only display riser       │
        │ │  ║   ┌──────box 0.24×0.13────┐   ║ │       with 2-3 theme plush, §5)       │
        │ │  ║   └───────────────────────┘   ║ │                                        │
        │ │  ║            PIT                ║ │                                        │
z=-0.055│ └─ end fence ──────────────────────┘                                        │
z=0     └──────────────────────────── front glass ───────────────────────────────────┘
       x=-0.5 -0.43                       0.03                                     0.5
```

**Fixtures** (`chuteGuard: false`, `floor: hole`):

| Part | Rapier | Centre / extents (m) | Friction / restitution | Look |
| --- | --- | --- | --- | --- |
| Floor | 4 cuboids from `floorWithHole` | slab y [−0.06, 0] minus the hole x ∈ [−0.42, 0.02], z ∈ [−0.38, −0.06] | 0.95 / 0.02 | mat |
| Glass, back wall, ceiling | today's 5 boxes, same calls | — | as today | shell |
| Bars ×2 | capsule along z, r 0.012, halfLength 0.15 | (−0.287, 0.10, −0.22), (−0.113, 0.10, −0.22): inner gap between the bar surfaces 0.150 | `barFriction` 0.35 / 0.05 | chrome |
| Side fences ×2 | cuboid half (0.005, 0.08, 0.165) | (−0.425, 0.08, −0.22), (0.025, 0.08, −0.22) | 0.3 / 0.1 | acrylic |
| End fences ×2 | cuboid half (0.23, 0.08, 0.005) | (−0.20, 0.08, −0.385), (−0.20, 0.08, −0.055) | 0.4 / 0.05 | acrylic |
| Opening `pit` | sensor | x ∈ [−0.42, 0.02], z ∈ [−0.38, −0.06], y ∈ [−0.30, −0.10]; awardComY −0.06; overMargin 0.02 | — | — |
| Bin | **classic `BIN`, unchanged** | the prize window shows the won box | — | — |
| Box | 1 dynamic body, `roundCuboid` | L × H × W = 0.24 (x) × 0.10 × 0.13 (z), round 4 mm; mass `boxMass` 0.40 kg; damping 0.35 / 2.2 | `boxFriction` 0.6 / 0.03 | `bridgeBox` |
| Start pose | seeded (seed + reset count) | centre of mass (−0.20 ± 0.01, 0.1625, −0.22 ± 0.02), yaw ±4° | — | — |

**Why these numbers.**
- The bar spacing, radius and height and the box size and mass are the cross-section the framework design probed
  with the real `PhysicsWorld` (its Appendix B). A box shifted by 0 sits stably; shifted 0.05 it tilts but stays on
  both bars; shifted 0.08 it wedges into the gap at an angle; shifted 0.10 it tips over a bar. With a pit below, a
  tip-over is a drop.
- Both overhangs are reachable: the axis can go to x −0.305 and −0.095 (CLAW.minX −0.37) at z −0.22.
- The strips between each bar and its side fence are 12 cm wide, so a box tipping on its side (0.10 tall) falls
  through instead of wedging.
- Box top 0.2125 and fences 0.16: well below the travel clearance.
- The ±Z faces (0.24 × 0.10) face the player, so the printed portrait is broadside.

**Flow of a try** (`BridgeRules`):
1. READY / AIMING (the joystick; `twoStep` optional).
2. DESCENDING with classic landing detection.
3. CLOSING.
4. LIFTING to `ropeAtClosing − liftDelta`. The lift raises one end and never carries the box away.
5. TRANSPORTING in place (arrives at once).
6. RELEASING: the box drops back a few cm.
7. SETTLING: `beginSettling` winds the cable to `ropeMin` first; once `winchArrived()`, the trolley heads home. The
   claw never sweeps across the box at a low height.
8. `canFinish` = the winch has arrived, the box is calm, and the trolley is past 5 cm from where it started.

**Win rule (physics).** The box satisfies the opening test of section 2.5 in DESCENDING … SETTLING (or at the next
DESCENDING after a late fall). Then:
- `machine.awardPrize(roundId, box.id, box.item.print)`, `box.inBin = true`, and `prizeDetected` is emitted;
- `resultExtras` sets `targetToyId` = box, `targetTypeId` = print, `outcome` = `won`, otherwise `empty` (every lift
  ends in an intended release, so `slipped` would mislead), plus `machine.progress` / `progressGain` / `stuck`.

Game's existing win path then runs: collection, score, QR and win card with the printed character's name and thumb.
WS-D only replaces the `toy.asset.id` reads with `prizeTypeOf(toy) = toy.item?.print ?? toy.asset.id` (Game.ts:780-809).

**Progress** (presentation and guide only) = max(shift, tilt, turn), each clamped to 0..1:
- shift = |COM.x − centerX| / 0.087;
- tilt = |pitch or roll| / 25°;
- turn = (L − span) / (L − gap), where span = L·|cos yaw| + W·|sin yaw|.

**Failure modes and anti-exploit.**

| Case | Detected (at RESULT, headless) | Handling |
| --- | --- | --- |
| Wedged between the bars or against a fence | COM y < 0.12, asleep, not in the sensor; or 3 tries with progress gain < 0.01 while not resting on both bars | `stuck()` → `ui.machine.staff.highlighted`, guide `bridge.stuck`. **Call staff** (4A's deck button) → `staffReset()` at the boundary: the seeded start pose, no award, free [PC]. Attract does it by itself. |
| Lifting the whole box out | the partial lift, gripAssist 0, 0.4 kg | Sweep gate: one-try wins from the start pose < 3 %. |
| Re-rolling the start pose (idle, lobby, staff) | — | The start pose is deterministic per seed and reset count; a reset only loses progress. |
| Inheriting a demo's "almost falling" box | — | `resetForTakeover` gives every new player a fresh box [PC]. |
| `triesPerBox` > 0 | try counter | The box goes back to the start; **never a pity win**. Default 0 = unlimited [PC]. |

**Scoring.** A drop is scored by today's `scoreRound` (scoring.ts:103-144) with the print's tier: base, first catch,
combo. A try without a drop is `empty`: 0 points. [PC: optional "nudge" points or a ×2 big-prize factor would go in
a bridge-specific scorer.] On today's pick, ×`dailyBonus` is applied through `settleScored`.

**Prize.** The collection gets +1 printed character. One claim code per box (`prizeId` = print id, src/rewards
flow.ts:107-140, server token(80)).

**Guide.**
- `machine_selected` (`machine.bridge`);
- `machine_progress` after every try without a drop: `bridge.progress` when gain ≥ 0.05, `bridge.stuck` when stuck,
  else `bridge.same`;
- `prize_won`, `retry_prompt` and `idle_hint` as today.

**Sounds and effects** (existing names only):
- box against a bar: `glass_tap` at pitch 0.62; against a fence: `glass_tap` at 0.9;
- the drop: today's `chute_drop` + `playWin(tier)` + the printed character's `win` voice; slip and lift voices are
  muted for items;
- `celebrate(tier, openingCenter(pit))`, the contact burst as today, and the aura on the lifted box at the print's
  tier;
- staff reset: `restock_drop` + `burst('restock')`.

**Pilot** (`bridgeModule.aim`, used by `MachinePilot`):
1. Read the box pose.
2. Pick the end already further from `centerX` (keep walking it); on the first try pick by seed.
3. Aim at COM + axis·(L/2 − 0.015), clamped to the reach.
4. Patience 2.5 s.

In attract the box persists across demo tries, so demo drops happen. A demo drop places a new box at the ATTRACT
boundary. Demo rounds always use the joystick.

**twoStep controls** (`machines.bridge.controls = 'twoStep'`, default `joystick` [PC]):
- button **1** held → +x only; releasing it moves to stage z;
- button **2** held → −z only; releasing it drops the claw.

`BridgeRules.filterInput` implements this headless and emits `axisStage` for 4A's deck.

**Difficulty knobs:** `gap` (0.13-0.18), `barFriction`, `boxMass`, box size, `startYawDeg`, `liftDelta`, the claw
scale, `triesPerBox`, plus the difficulty preset.

**Sweep gates** (Arcade, pilot + aim noise, 8 seeds):
- median 4-8 tries per box;
- one-try wins < 3 %;
- stuck < 10 % of boxes;
- 0 anomalies;
- median step ≤ 0.5 ms.

### 3.2 TUMBLE SHELF (`shelf`) [PC name: Tumble Shelf / 翻落货架 / ころころシェルフ]

Stacks of small printed snack boxes stand on a raised shelf with a lip. The claw knocks, drags or carries them over
the edge. **Every box that reaches the trough counts**, and several per try are possible.

**Side section at x = −0.2:**

```
 y 0.476 ─ ─ ─ ─ ─ ─ ─ claw tips at travel height ─ ─ ─ ─ ─ ─ ─ ─ ─
 y ≤0.34                ▇ row A (z -0.39)      ▇ row B (z -0.53)
 y 0.174          lip ▐
 y 0.160  ════════════╧═══════════════ shelf top ═══════════════  (z -0.30 … -0.80)
 y 0      trough (hole) │ shelf block, solid to the floor
          z = 0 … -0.30 │
```

**Fixtures** (`chuteGuard: false`, `floor: hole`):

| Part | Rapier | Centre / extents (m) | Friction / restitution | Look |
| --- | --- | --- | --- | --- |
| Floor | 2 cuboids from `floorWithHole` | hole = trough x ∈ [−0.50, 0.00], z ∈ [−0.30, 0.00] (inside `BIN`) | 0.95 / 0.02 | mat |
| Shelf block | cuboid | centre (0, 0.08, −0.55), half (0.5, 0.08, 0.25): x −0.5…0.5, z −0.80…−0.30, y 0…0.16 | `shelfFriction` 0.55 / 0.02 | deck |
| Lip | cuboid | centre (0, 0.16 + lipHeight/2, −0.306), half (0.5, lipHeight/2, 0.006); lipHeight 0.014 | 0.4 / 0.05 | chrome |
| Gutter (right front strip) | cuboid, rotated +9.09° about +z (quat (0, 0, 0.0792, 0.9969)) | centre (0.25, 0.0499, −0.15), half (0.2532, 0.01, 0.15): top surface from y 0.02 at x 0 to y 0.10 at x 0.5 | 0.05, combine **min** / 0.02 | ramp |
| Opening `trough` | sensor | x ∈ [−0.50, 0.00], z ∈ [−0.30, 0.00], y ∈ [−0.30, −0.10] | — | — |
| Bin | **classic `BIN`, unchanged** | — | — | — |

Where a falling item goes:
- over the lip at x < 0: straight into the trough;
- at x > 0: onto the gutter, then it slides left into the trough (the friction angle with the min combine is 2.9°,
  less than the 9.1° slope);
- the shelf front face is the gutter's back wall, and the right glass is its end wall.

Nothing that leaves the shelf can come to rest outside the opening (this fixes V9).

**Items** (printed with theme characters by a seeded shuffle, like `ToyField.nextAsset`, ToyField.ts:98-108):

| Look | Size (m) | Mass | Prints | Base factor | Share |
| --- | --- | --- | --- | --- | --- |
| `snackS` | 0.055 cube, round 3 mm | 40 g | common / rare | ×1 | 60 % |
| `snackM` | 0.075 × 0.06 × 0.05 | 60 g | any | ×1.25 | 30 % |
| `snackL` | 0.09 × 0.075 × 0.06 | 90 g | rare / epic / legendary | ×1.5 | 10 % |

- Material: friction 0.6, restitution 0.05, damping 0.3 / 1.5.
- Layout: 8 stacks, rows z ∈ {−0.39, −0.53}, columns x ∈ {−0.30, −0.10, 0.10, 0.30}. S and M stacks are 3 high and
  L stacks 2 high, about 22-24 items. Jitter ±4 mm and ±6°.
- The tallest stack top is ≤ 0.34, at least 13 cm under the travelling tips.
- Fills must pass a stability test: no item moves more than 2 mm in 5 s idle.

**Win rule (physics).** Any snack meets the opening test in READY … SETTLING:
- `machine.scoreItem(roundId, toy.id, item)`, `inBin = true` and `itemScored` are emitted;
- `resultExtras` sets `outcome: won` when ≥ 1 item scored this try (else `empty`) and lists `machine.items`;
- a snack carried by the claw and dropped by the forward transport counts the same way.

**Session:** `tries` = `machines.shelf.tries` (5 [PC]).

**Failure modes and anti-exploit.**
- Ploughing a whole row is the genre. It is limited by the lip, the shelf friction and the stack spacing, and the
  multi-drop bonus is capped at ×2.
- Items balanced on the lip stay in play and reachable.
- Items pushed behind the reach (z < −0.67) can still be dragged forward by the open fingers (about 0.10 m reach).
- A late fall after the last try of a session is not credited (documented; settle-to-calm makes it rare).

**Scoring** (`shelfModule.scoreTry`, pure):
- per item: tier base of the print (common 40, rare 100, epic 200, legendary 400) × size factor × difficulty;
- the try subtotal × multi-drop (2 items ×1.2, 3 ×1.5, 4 or more ×2);
- × the daily bonus;
- no combo across tries [PC table].

**Prize** [PC]:
- When the session's items ≥ `rewardItems` (3), the session earns **one** prize: the rarest printed character among
  the dropped boxes (ties go to the earliest drop).
- It goes into the collection (`${sid}-${lastRoundId}-S`) with **one** claim code (roundId = the last try).
- Individual snacks are points only.
- *Alternative:* every snack into the collection, with a QR per try that scores. It inflates physical prizes about
  1.5× per try at a booth.

**Guide:**
- `machine_selected` (`machine.shelf`);
- `items_scored` (`items.one` / `items.many`);
- `machine_progress` `shelf.edge`, when a try scored nothing but an item rests within 3 cm of the lip;
- `session_over` (`session.reward` / `session.over`, and the existing `win.reward*` keys while a QR is on screen).

**Sounds and effects:**
- per item `chute_drop` (0.7) + `score_count`; two or more in a try add `combo` + `burst('combo')`;
- shelf and lip impacts: `plush_land` at pitch 1.2;
- the session prize: `playWin(tier)`, plus `collect_unlock` if it is new;
- `burst('score', item position, tier)` and a "+N" popup per item at the opening; `celebrate(tier)` on the prize.

**Pilot:**
1. Pick the stack whose front item is closest to the lip.
2. Aim at (x, z + 0.04): the closing back finger (azimuth 3π/2, fieldSpec.ts:89) drags it towards the lip.
3. Every third demo round, aim at a row-B stack top instead.
4. Patience 1.5 s.

In attract, `atBoundary('ATTRACT')` restacks when fewer than 60 % of the items remain.

**Knobs:** `lipHeight` (0-0.03), `shelfFriction`, the stack layout and height, the size mix and masses, `tries`,
`rewardItems`.

**Sweep gates** (Arcade, 8 seeds):
- 0.8-1.6 items per try;
- ≥ 35 % of tries score;
- 30-60 % of sessions reach 3;
- stacks stable;
- 0 anomalies.

### 3.3 SPARKLE RUSH (`rush`) [PC name: Sparkle Rush / 闪耀冲刺 / キラキララッシュ]

A timed score attack: **75 s** [PC; 30-120 in settings] of quick grabs in a pile of big gems and coins, with a local
top-10 ranking.

**Geometry:** `CLASSIC_FIELD`. The same floor, chute, guard walls, sensor and bin as classic, so the classic
dressing draws it. The 20 cm guard means floor pieces can only arrive carried, never pushed in.

**Pieces** (`pieces` 44 by default, 24-48; the mix scales with it):

| Look | Collider | Radius (m) | Mass | Value | Count |
| --- | --- | --- | --- | --- | --- |
| `gemEmerald` | 17-point brilliant hull | 0.034 × `radiusScale` | 30 g | 10 | 14 |
| `gemSapphire` | same | 0.036 | 32 g | 25 | 10 |
| `gemRuby` | same | 0.038 | 34 g | 50 | 6 |
| `gemDiamond` | same | 0.040 | 36 g | 150 | 2 |
| `coin` | 12-gon prism hull, h 0.010 | 0.026 | 12 g | 5 | 12 |

- Friction 0.7, restitution 0.1, damping 0.3 / 1.5.
- Placement: one layer on `isFreeSpot` cells (ToyField.ts:32-37), a few on top, settled off-screen.
- These are "giant" gems: a centred grab cages 1-3 of them. Minimal's 16-26 mm gems against 0.20 m open tips would
  rarely be caged.
- Physics cost (framework probe, real `PhysicsWorld`): about 1 ms per step with the pile awake, 0.1 ms asleep. Hence
  the cap of 48 pieces (classic is 0.22-0.30 ms, PHYSICS.md).

**Win rule (physics).** A piece meets the chute opening test in READY … SETTLING: `scoreItem` and `inBin`. There is
no collection entry per piece. `resultExtras`: `outcome: won` if ≥ 1 piece, plus `machine.items`.

**Session (timed).** The timer starts at the first input of the run; time-up behaves as in section 2.6. Each RESULT
auto-advances after 0.35 s while time remains. With the claw scale, a cycle takes about 4-5 s, so a run has about
12-16 tries.

**Scoring** (`rushModule.scoreTry`):
- Σ value × difficulty;
- +25 % "handful" bonus for 3 or more pieces in one try;
- × the daily bonus.

The ranking score is the run's points **without** the daily bonus, so days stay comparable [PC].

**Ranking** (`src/persistence/machines.ts`, WS-D):
- top-10 per machine, entries `{ initials, score, at, difficulty }`;
- initials `/^[A-Z]{3}$/`, entered with ▲▼ per slot plus OK (touch and keyboard); a 30 s timeout saves `???`;
- a tiny blocklist of offensive combinations becomes `???`;
- local only, never for demo runs, cleared by *Reset scores*.

**Prize** [PC]:
- When the run's **raw value** (Σ piece values: a physics fact, no multipliers) ≥ `rewardValue` (default 450; the
  sweep sets it so that 25-35 % of pilot runs qualify), the run earns one prize.
- Its tier comes from bands: ≥ 1× common, ≥ 1.5× rare, ≥ 2× epic, ≥ 3× legendary.
- The prize is the **least-collected** enabled character of that tier on this device (ties in manifest order); a
  missing tier falls back to the next lower one.
- It gives one collection entry and one claim code. `rewardValue` 0 = never.

**Failure modes and anti-exploit:**
- Mashing grab: the cycle is physical and the auto-advance fixed, so nothing can be skipped.
- Pausing with a dialog: the timer and physics pause together; `system.lockSettings` locks kiosks.
- Pieces pushed into the chute by the descending claw count: they had to get over the guard, so it is physics.
- Ranking spam: one entry per run, initials only, demo runs never rank.

**Guide.** Per-try `empty_grab` / slip lines are suppressed while a run is active. The guide speaks on:
- `machine_selected`;
- `items_scored` only for a handful (3 or more);
- `time_low` (10 s);
- `session_over` (`session.rank` / `session.reward` / `session.over`);
- `idle_hint` before the first move.

**Sounds and effects:**
- a piece: `sparkle` pitched by value + `score_count`; a coin: `score_count` at pitch 1.25;
- the last 10 s: `countdown_tick` each second + an LED pulse through `celebrate` energy;
- time up: `start_game` at pitch 0.8;
- a new #1: `jackpot` + `lightShow('jackpot')`; top 3: `firework`; top 10: `sparkle`;
- `burst('score', EXIT_POS, tier by value)` per piece.

**Pilot:** maximise value / (1 + distance) with room around the piece, aim at its centre of mass, patience 1.0 s.
Demo rounds are single tries: no timer, no ranking. In attract, refill when fewer than 50 % of the pieces remain.

**Knobs:** `seconds`, `pieces`, `radiusScale` (code parameter, 0.85-1.2), the claw scale, the difficulty preset.

**Sweep gates** (Arcade, 8 seeds):
- ≥ 1.2 pieces per centred grab;
- ≥ 70 % of tries score;
- 12-16 tries per 75 s run;
- step p95 ≤ 1.5 ms during play;
- the median raw value is recorded and sets `rewardValue`.

If caging misses the gate after tuning `radiusScale` and then `closeSpeed`, build the scoop attachment (section 2.7).

### 3.4 PLUSH CLASSIC (`classic`)

Unchanged: `CLASSIC_FIELD`, `rules = null`, `ToyField`, `presentation: 'prize'`, an `open` session, `DemoPilot`,
`scoreRound`, today's restock setting.

### 3.5 What counts as a prize

| Machine | Collection | Claim QR (src/rewards) | Points |
| --- | --- | --- | --- |
| classic | each won plush (today) | one per win (today) | `scoreRound` (today) |
| bridge | the printed character, one per box | one per box | `scoreRound` with the print's tier; misses 0 |
| shelf | one session prize (≥ 3 boxes): the rarest printed character | one per qualifying session | per item × size × multi-drop |
| rush | one session prize (raw value ≥ 450): by tier band, least-collected | one per qualifying run | value × difficulty, +25 % for a handful |

Every rule issues at most one code per round id. The server's per-(session, round) dedup (src/rewards/protocol.ts:7)
needs no change, and round ids stay unique across switches (D1). Demo rounds never count: `RewardFlow.onWin` refuses
demos (src/rewards/flow.ts:107-110), the collection listener skips `award.demo` (Game.ts:687-691), `PlaySession`
ignores demos and rankings never take them. `collection.addPrize` gains an optional `machineId` that counts
`machineWins[id]` for the lobby (older stored data simply has none).

---

## 4. Lobby and flow

### 4.1 Screens and states

```
ATTRACT (current machine; after an idle reset = home) ──START / CTA──► READY on the current machine (no lobby gate)
   │  MACHINES (4A deck button `menu-machines`)                        │ MACHINES (only at a round boundary)
   ▼                                                                   ▼
 LOBBY (ModalId 'lobby') ──pick X──► SWITCHING curtain (themeBusy) ──► from attract: pressStart() → READY on X
   │ back                                                          └─► from a round: READY on X
 items genres: try RESULT ─► TRY TOAST (+2 boxes · +150) ─auto─► READY … session over ─► SESSION CARD
 SESSION CARD: summary · rank/initials (rush top 10) · prize + QR (WinCard) · PLAY AGAIN (newSession) · MACHINES
 idle (system.idleSeconds; held while a QR is up) ─► idle reset ─► ATTRACT on `home` (switch in attract if needed)
```

- **Lobby** (`src/ui/machines/LobbyDialog.tsx`, built on `Modal`). The modal rect already respects every layout:
  the 86" band, the 32" zone, the simulated 9:16 frame and the phone's safe area.
  - Cards: a genre SVG in the theme palette, name, tagline, one-line how-to, *Best* here, *Prizes won here*, a
    **TODAY'S PICK ×1.5** ribbon, a lock with "Win {n} more prizes" in `progress` mode, *Playing now*, and PLAY.
  - Layouts: a horizontal scroll-snap row on desktop (3 cards) and on the phone (2.2 cards, targets ≥ 44 px), a
    vertical list on portrait 32" and 86" (every button inside y 0.25-0.75 on the box height).
  - Controls: ◀ ▶ buttons ≥ `layout.touch`, the joystick or arrows left / right, DROP / Enter to pick, Esc to close.
- **SessionHud** (`src/ui/machines/SessionHud.tsx`, mounted in App.tsx after `ScoreHud`, placed under
  `scoreHudRect`, ScoreHud.tsx:36-62):
  - bridge: "Try 3" + a 5-segment progress meter + the "Call staff" hint;
  - shelf: "Try 2/5 · Boxes 3 · Prize at 3";
  - rush: a large mm:ss timer + the run score.
- **TryToast** (items genres): a short card at the miss-toast position. The director keeps `ui.result = null` for
  items tries, so Hud's result card (Hud.tsx:479-555) stays hidden with no Hud edit.
- **SessionResultCard**: reuses `WinCard` and `winCardGeometry` (src/ui/RewardCard.tsx:84-114, :346) for the session's
  last round id, so the QR, phone compaction and band placement are the tested code paths. `InitialsEntry` sits
  inside the card.

### 4.2 Switching: `Game.selectMachine(id)` → `MachineDirector.switchTo` (WS-D)

1. Refuse when `machines.lobby` is off (except in debug), the id is not offered or is locked, or the claw is busy (the
   button is disabled then; a stale call queues `pendingMachine` with a "switches after this try" toast).
2. Set `themeBusy` and `machine.switching`, then `setPaused('theme', true)`.
3. `rewards.reset()`; clear result, prize, sessionResult and popups; `pilot.reset()`; `fx.aura(null)`.
4. `toyVisuals.clear()`, `itemVisuals.clear()`, dispose `clawVisual` and set it to null.
5. `core.setMachine(resolveMachine(id, committed.machines), { assets: enabledAssets(), seed, params: roundParams(committed), field: fieldOptions(committed) })`.
6. `rebuildScene(false)`: the Cabinet gets `core.def.geometry`, the ClawVisual is recreated (Game.ts:348-351). Then
   sync the toy and item visuals, set the contact-shadow hole and the effects' opening, and set `restockQueue = 0`.
7. `scores.useRecord(loadMachineRecord(id), save)` (the session score starts over) and `publishScore(null)`.
8. Write the `ui.machine` snapshot, play `theme_sting` and `await stage.warmUp()` (item materials are already in the
   warm-up list).
9. Emit the guide event `machine_selected`, unpause and clear the busy flags. If the switch was asked from attract,
   call `pressStart()`.

Cost: a fresh Rapier world, an off-screen settle (≤ 3 s simulated, well under 1 s wall) and a Cabinet rebuild, all
behind the curtain. A theme change while on a non-classic machine goes through `applyQueuedRebuild` (Game.ts:955-1007)
unchanged: `populate` fills the genre field with the new prints, and `rebuildScene` uses the current geometry.

### 4.3 Persistence

| What | Key (`plush-portal/` prefix) | Notes |
| --- | --- | --- |
| Settings `machines.*` | `settings` v1 | defaults filled by `sanitizeSettings` (spec.ts:702-704); `SETTINGS_VERSION` stays 1 |
| Classic best / lifetime | `scores` | **untouched** (tests/unit/persistence/scores.test.ts stays valid) |
| Other machines' best / lifetime, rankings, plays | `machines` v1: `{ version: 1, best: Partial<Record<MachineId, ScoreRecord>>, rankings: Partial<Record<MachineId, RankEntry[]>>, plays: Partial<Record<MachineId, number>> }` | sanitised like scores.ts; a newer version is left alone; *Reset scores* clears it |
| Collection | `collection/v1` + optional `machineWins` | older data has none |
| Current machine, field state | — | **not persisted**: a reload or an idle reset returns to `home` [PC] |

### 4.4 Today's pick and unlocks

- `dailyPick(ymd, candidates)`: FNV-1a of `plush:<YYYY-MM-DD>` (the local date, computed in the app and passed in;
  headless code never reads `Date`) modulo the candidates.
- The candidates are offered, unlocked and available machines, **never classic**, so classic scoring stays
  identical. It returns null when no candidate is left.
- The bonus `machines.dailyBonus` (×1.5 [PC]) multiplies points only. It shows as the lobby ribbon, as "×1.5" on the
  SessionHud and as a breakdown row. It is re-evaluated at each settlement, so it rolls over at midnight.
- `machines.unlock`: `'open'` (default; kiosks should not lock content [PC]) or `'progress'`, where a machine opens
  once `collection.wins ≥ unlockAfterWins` (bridge 1, shelf 3, rush 5 [PC]). Classic and `home` are always open.

### 4.5 Attract, demo and the idle reset with several machines

- **Attract plays the current machine.** After an idle reset that is `home`.
- **The idle reset** (Game.ts:615-636) does everything it does today, then calls `director.onIdleReset()`: any
  session ends abandoned (no reward, no ranking; an unconfirmed initials entry is dropped) and, if the current
  machine is not `home`, a switch to `home` runs in attract behind the curtain. The QR hold
  (`rewards.holdsIdle`, Game.ts:1354) is unchanged; the session card's QR uses the same `RewardFlow`.
- **Demo rounds:** `AttractDirector` is unchanged. `Game.update` calls `director.pilot()` (`DemoPilot` for classic,
  `MachinePilot(module.aim)` otherwise). Demo awards carry `demo: true` and are never collected, ranked or given a
  QR; demo points go on the demo track (scoring.ts:150-164).
- **Takeover:** `pressStart` → `attract.leave()` → `field.resetForTakeover()`: a fresh box, full stacks or a full
  pile. The session starts at that READY.
- **Attract cycle** (`machines.attractCycle`, default off [PC]): every 3 demo rounds, while in ATTRACT with no modal,
  switch to the next offered machine. Off by default because each switch costs a curtain and a warm-up.
- The CTA (src/ui/AttractOverlay.tsx) may show `machines.cta {name}` as a subtitle. This is optional and one line.

### 4.6 Settings (exact `src/settings/spec.ts` additions, a new group after `rewards`; part of the scaffold)

```ts
import { MACHINE_IDS } from '../game/machines/ids';
// …
  machines: {
    /** Machine of the attract mode and of the idle reset. ?machine= overrides it for one page load (not saved). */
    home: en('classic', MACHINE_IDS, 'round'),
    /** Players may open the machine lobby. Off = a single-machine kiosk on `home`. */
    lobby: bool(true),
    /** Machine ids not offered in the lobby; `home` is always offered. */
    hidden: strList(16, 32, 'round'),
    /** 'open' = every offered machine is playable; 'progress' = later machines unlock with collected prizes. */
    unlock: en('open', ['open', 'progress'] as const, 'round'),
    /** One offered machine (never classic) per local day earns a points bonus. Presentation only. */
    dailyPick: bool(true),
    dailyBonus: num(1.5, 1, 3, 0.1, 'live', '×'),
    /** Attract mode visits the offered machines in turn (each visit rebuilds the machine off-screen). */
    attractCycle: bool(false),
    bridge: {
      controls: en('joystick', ['joystick', 'twoStep'] as const, 'round'),
      /** 0 = unlimited; otherwise the box is put back (never awarded) after this many tries on it. */
      triesPerBox: num(0, 0, 50, 1, 'round'),
      gap: num(0.15, 0.13, 0.18, 0.005, 'rebuild', 'm'),
      boxMass: num(0.4, 0.2, 0.8, 0.05, 'rebuild', 'kg'),
    },
    shelf: {
      tries: num(5, 1, 20, 1, 'round'),
      /** Boxes per session that earn a prize (collection + claim code). */
      rewardItems: num(3, 1, 30, 1, 'round'),
      lipHeight: num(0.014, 0, 0.03, 0.002, 'rebuild', 'm'),
    },
    rush: {
      seconds: num(75, 30, 120, 5, 'round', 's'),
      pieces: num(44, 24, 48, 2, 'rebuild'),
      /** Raw gem value per run that earns a prize; 0 = never. */
      rewardValue: num(450, 0, 5000, 50, 'round'),
    },
  },
```

Apply modes:
- `round` values latch at the next **session start** (`PlaySession` reads them at `running`) or round boundary.
- A `rebuild` change to the *current* genre's fields re-runs `setMachine` for the same id at the next boundary
  (WS-D extends Game.ts:1251-1260).
- Physics knobs are never `live`. WS-F extends the rule at tests/unit/settings/spec.test.ts:197-200 with
  `^machines\.(bridge|shelf|rush)\.` → not live.
- UI: a "Machines" section in the Gameplay tab (src/ui/settings/tabGameplay.tsx). There is no new tab, so
  `04-settings-dialog`'s tab list stays valid.

### 4.7 Launch parameter and debug API

- `?machine=<id>` is parsed in launch.ts. `Game.init` creates the core with `resolveMachine(launch.machine ?? committed.machines.home)` and
  treats it as `home` for this page load. **Nothing is persisted** (V14). Unknown or unavailable ids are ignored with
  a log line. `tests/e2e/helpers.ts` `BootOptions` gains `machine?`.
- `window.__plush` (Game.ts:1659-1740) additions, each wrapped with `idle.touch()` like the others:

```ts
machine: () => ({ id, genre, controls, presentation, session: core.session.snapshot(), rules: core.controller.rules?.debugState?.() ?? null }),
selectMachine: (id: string) => Promise<boolean>,          // resolves when the switch has finished
machineDebug: {
  nudge(dx: number, dz: number, dy?: number): boolean,     // impulse on the bridge box / first item (tests only)
  setSessionSeconds(s: number): void,
  staffReset(): boolean,
  itemPoses(): { id: string; look: string; pos: number[] }[],
},
rankings: (id?: string) => RankEntry[],
dailyPick: () => string | null,
```

### 4.8 i18n (namespace `machines`, `src/i18n/strings/machines.ts`, en / zh / ja)

It is registered in `src/i18n/all.ts` and `FEATURE_STRING_TABLES`. Every key starts with `machines.` or
`set.machines.` (V4), and the placeholders are identical in every language (featureStrings.test.ts:26).

```
machines.<id>.name  machines.<id>.tagline  machines.<id>.howto                    (classic, bridge, shelf, rush)
machines.lobby.title  .play  .current  .locked{n}  .pick  .bonus{mult}  .best{points}  .prizes{n}  .top  .prev  .next  .close
machines.switching{name}  machines.cta{name}
machines.deck.machines  machines.deck.staff  machines.deck.step1  machines.deck.step2
machines.plate.free  machines.plate.try{n}  machines.plate.tries{left}{total}  machines.plate.time{s}
machines.hud.try{n}  machines.hud.progress  machines.hud.tries{left}{total}  machines.hud.items{n}  machines.hud.prizeAt{n}
machines.hud.time{s}  machines.hud.points{points}  machines.hud.stuck
machines.try.items{n}  machines.try.none  machines.try.points{points}  machines.try.handful  machines.try.multi{mult}
machines.session.timeUp  .outOfTries  .items{n}  .points{points}  .best{points}  .reward{name}  .noReward{n}  .again  .lobby
machines.rank.title  .enter  .ok  .place{n}  .none  .skip
machines.staff.done  machines.toast.after  machines.toast.locked  machines.toast.failed
machines.score.daily{mult}  machines.score.multiDrop{mult}  machines.score.handful
set.machines.section  set.machines.{home,lobby,hidden,unlock,dailyPick,dailyBonus,attractCycle}(+.hint)
set.machines.home.o.<id>  set.machines.unlock.o.{open,progress}
set.machines.bridge.{controls,triesPerBox,gap,boxMass}(+.hint)  set.machines.bridge.controls.o.{joystick,twoStep}
set.machines.shelf.{tries,rewardItems,lipHeight}(+.hint)  set.machines.rush.{seconds,pieces,rewardValue}(+.hint)
```

### 4.9 Guide contract (src/ai, src/core/contracts.ts, server/schemas.ts)

- **Event types** (scaffold): `machine_selected`, `machine_progress`, `items_scored`, `time_low`, `session_over`. Their
  priorities and cooldowns are in section 2.2.
- **Facts:** `GuideFacts.machine` (section 2.2). `Game.facts()` (Game.ts:1038-1083) adds
  `facts.machine = director.facts()` on non-classic machines only, so classic facts carry no `machine` key.
- **New `LINE_KEYS`** (WS-F):
  - `machine.classic`, `machine.bridge`, `machine.shelf`, `machine.rush`
  - `bridge.progress`, `bridge.same`, `bridge.stuck`, `shelf.edge`
  - `items.one`, `items.many`, `time.low`
  - `session.over`, `session.reward`, `session.rank`

  Each needs, **per language**:
  1. ≥ 2 `all` lines (lines.test.ts:79-81);
  2. ≥ 1 `gtc` line (brandLines.test.ts:146-160, V2);
  3. only the `{toy}` placeholder in theme / generic pools, plus `{event}` / `{host}` in the gtc pool (V3).

  Theme flavour is optional but must appear in the same places in every language (lines.test.ts:94-101). That is
  about 14 keys × 3 languages × 3-4 lines ≈ 150 lines.
- **`resolveSituation` mapping** (replacing the scaffold's temporary one):

| Event | Keys |
| --- | --- |
| `machine_selected` | `machine.<genre>` |
| `machine_progress` | bridge: `stuck` ? `bridge.stuck` : gain ≥ 0.05 ? `bridge.progress` : `bridge.same`; shelf: `shelf.edge` |
| `items_scored` | items ≥ 2 ? `items.many` : `items.one` |
| `time_low` | `time.low` |
| `session_over` | a QR on screen → the existing `win.reward*` keys (via `rewardFor`); else rank ? `session.rank` : facts.toy ? `session.reward` : `session.over` |

  With `facts.machine` absent (the tests' default `[{}]` variant), each event falls back to a safe key.
- **Prompt:** `EVENT_TASKS` (src/ai/prompt.ts:107) gets one sentence each, plus a "machine context" sentence when
  `facts.machine` is set. Numbers reach the model only through facts.
- **Emission policy** (in the director):
  - classic emits exactly as today;
  - bridge replaces `empty_grab` with `machine_progress`;
  - shelf emits `items_scored` / `machine_progress` per try;
  - rush suppresses per-try lines during a run.

### 4.10 Sound mapping (`src/app/machineSfx.ts`; existing `SFX_NAMES` only, src/core/contracts.ts:12-50)

`Game.updateAudio` (Game.ts:1531-1535) first asks `machineSfx.impact(best.against, best.toy.item)`:

| Impact | Sound |
| --- | --- |
| `bar` | `glass_tap` at pitch 0.62 |
| `fence` | `glass_tap` at 0.9 |
| `shelf` / `lip` | `plush_land` at 1.2 |
| `gutter` | `plush_land` at 1.35, volume 0.5 |
| a gem or coin against anything | `score_count` at pitch 1.4, volume 0.35 (rate-limited as today) |
| anything else | the classic mapping |

Optional later work, not budgeted: dedicated `box_thud`, `gem_clink` and `timer_buzzer` SFX (each needs a manifest
entry and a synthesised fallback, about 0.5 day).

### 4.11 Contract with 4A (joystick, deck, negative space)

- **Input:** the joystick sets `inputX / inputZ`, valid for every genre. With `ui.machine.controls === 'twoStep'`
  the deck shows two big buttons instead, wired to `game.stepInput(1|2, pressed)` with test ids `step-1` and
  `step-2`. If 4A cannot render it in time, the bridge keeps the joystick (the default).
- **Deck row:** leave machine / call staff / inventory / settings. 4A renders it from
  `useMachineDeck()` (`src/ui/machines/useMachineDeck.ts`, owned by WS-F):
  - `lobby: { visible, enabled, onPress }` → `game.openLobby()`, test id `menu-machines`;
  - `staff: { visible, highlighted, onPress }` → `game.machineAction('staff')`, test id `menu-staff`;
  - `controls`, `onStep`;
  - `plate: { key, params }` for the coin counter plate: "FREE PLAY" / "TRY 3" / "TRIES 2/5" / "0:42".
- **4A owns `Hud.tsx`; 4B never edits it.** The try toast and the session card are mounted in `App.tsx`, and the
  director's `ui.result = null` for items tries hides Hud's own card.
- **Neighbouring cabinets** (optional): `neighbours(id, offered)` (registry) and `buildMachinePreview(genre, tier)`
  (WS-E, `src/scene/machines/preview.ts`, < 3 k triangles each) let 4A show the previous and next machine beyond
  the side glass. They are static and render-only.
- **Cabinet.ts and Stage.ts:** 4A edits the shell (frame, gantry, ceiling, neighbours, glass). WS-E edits only the
  floor, chute and fixture blocks (section 5.1). **Merge 4A first.**

---

## 5. Rendering (WS-E)

### 5.1 Cabinet

`Cabinet` (src/scene/Cabinet.ts:182-197) gains a fourth constructor argument, `field: FieldGeometry` (default
`CLASSIC_FIELD`), passed by `Game.rebuildScene`:
- **Floor** (:274-280): when `field.floor.kind === 'classic'`, today's statements run unchanged. Otherwise
  `buildHoleFloor(b, M, hole, detail)` from `src/scene/machines/floor.ts` draws mat boxes from `floorWithHole`, a
  dark collar through the slab around the hole, and the chrome front lip with its LED strip on the front strip.
- **Chute** (:306-317): drawn only when `field.chuteGuard`. Without it, the "PRIZE" sign goes onto a fixture: the
  bridge's front fence, or the shelf's gutter end.
- **Fixtures:** `buildFixtures(b, M, field.fixtures, detail)` from `src/scene/machines/fixtures.ts`, merged into the
  existing material buckets (no extra draw calls beyond the buckets):

| look | Drawn as | Material (existing CabinetMaterials) |
| --- | --- | --- |
| `chrome` | capsule → CylinderGeometry with `TESSELLATION.radial[detail]` plus end caps; box → rounded box | chrome |
| `acrylic` | rounded box with an `acrylicEdge` top edge | acrylic (render order 11, AO skipped like today, Game.ts:336-339) |
| `deck` | shelf: enamel front, mat top, accent strip, LED strip under the lip | enamel / mat / accent / leds |
| `ramp` | gutter slab with an arrow decal pointing at the trough | plastic / decal |
| `hidden` | nothing | — |

- **The lower cabinet** (:319-377) is **unchanged** (V7).
- **Bridge display riser** (optional, render-only): `displaySlots` on a small riser at the right-back floor, drawn by
  today's `ToyVisuals.setDisplay` (Game.ts:354), so the empty floor shows 2-3 theme plush.

### 5.2 ItemVisuals (`src/scene/ItemVisuals.ts`)

- API: `sync(toys)`, `update(alpha, dt)`, `positionOf(toy, out)`, `setPrintAtlas(atlas)`, `setQuality(q)`,
  `warmUpObjects()`, `clear()`, `dispose()`, `viewStats()`.
- Interpolation is the ToyVisuals slerp (ToyVisuals.ts:415-430).
- `ToyVisuals.sync` (:234) gains `if (toy.item) continue;`.

| Item | Mesh | Instances | Triangles (main pass) |
| --- | --- | --- | --- |
| `bridgeBox` | RoundedBoxGeometry (bevel by tier); portrait on ±Z, name plate on ±X, theme pattern on top. Medium+ *window box*: a clear front panel with the print's plush LOD2 inside (render-only child); Safe shows the print only | 1 | about 0.6 k + about 1.7-5 k |
| `snackS/M/L` | BoxGeometry; one InstancedMesh per look; a per-instance `aCell` attribute offsets UVs into the atlas (`onBeforeCompile`) | ≤ 40 | ≤ 0.5 k |
| `gem*` | 48-triangle brilliant; one InstancedMesh per look (4); MeshStandardMaterial with clearcoat, env map and a small emissive tied to `fxIntensity`; **no transmission** (it would cost an extra pass) | ≤ 48 | ≤ 2.3 k |
| `coin` | 12-segment cylinder, gold, InstancedMesh | ≤ 14 | ≤ 0.7 k |

- **Print atlas** (`src/scene/machines/printAtlas.ts`): one CanvasTexture per theme, 512² on Safe, 1024² on Medium /
  High, 2048² on Ultra (following `graphics.textures`), 256² cells.
  - Each cell holds the portrait from `ui.thumbnails[id]` (the data URLs from `Game.queueThumbnails`, Game.ts:1624),
    the name in the display font, a rarity stripe and the theme border.
  - Until the thumbnails arrive, a cell shows the palette colour plus the initial, and redraws when they do.
- **Shadows:** boxes cast on every tier with shadows on; gems and coins on High / Ultra only.
- **Contact shadows:** the bridge box joins the contact pass (a single mesh). Instanced items do not, this round: it
  would need an instanced contact material (a known, small visual step down).
- **Openings:** `ContactShadows` gets `setHole(rect)`, so the hole now passed at construction (Stage.ts:274-277)
  follows `field.opening`. `Effects` / `ParticlePool` replace the chute constants (Effects.ts:73-77,
  ParticlePool.ts:88-89, 361) with `setOpening(rect, mouthY)`.
- **Graphics never reach the simulation:** atlas size, the window box and item LOD are presentation only; physics
  comes from `ItemSpec`.

### 5.3 Budgets (Medium 1280 × 720, all passes)

Today's classic peak is 385-458 k triangles in the held state, of which the toys' main pass is about 229 k
(docs/PERFORMANCE.md:328). Item machines have no plush pile.

| Machine | Estimate (whole frame) | Draw calls vs classic | Gate |
| --- | --- | --- | --- |
| bridge | 170-230 k (box, window plush, display riser) | −10 … −15 | < 470 k, with 4A's neighbours and gantry |
| shelf | 160-210 k | −10 | < 470 k |
| rush | 170-220 k | −8 | < 470 k |

The atlas costs about 5.6 MB of GPU memory at 1024² with mips. WS-E measures with the round-3 method
(PERFORMANCE.md:313-320: wrap the shadow and contact passes, read `renderer.info`) in the attract, ready and held
states, and records the rows in PERFORMANCE.md.

---

## 6. Migration (ordered; the game and every test stay green after each step)

### 6.1 Steps

| # | Owner | Step | Green check |
| --- | --- | --- | --- |
| 0 | WS-A | **Golden trace** on the untouched tree: `tools/dev/golden-classic.ts`, `tests/unit/machines/__golden__/classic.json`, `classicGolden.test.ts`. Tests only. | unit |
| 1 | lead | **Scaffold** (one commit, under an hour; section 2.2): `ids.ts`, `types.ts`, `fieldGeometry.ts` (types, `CLASSIC_*`, stub bodies), `items.ts` (types, stubs), `ToyBody.item?` and the `StaticKind` union, `RoundResult.machine?`, the guide event types + facts + priorities / cooldowns / tasks + temporary `resolveSituation` mapping, `FactsSchema.machine`, the gameStore slices + `ModalId 'lobby'` + initial state, the `machines` settings group, `LaunchParams.machine?` + `?machine=` parsing, the Game public stubs. | `tsc` (both configs), `vitest run` (golden passes), e2e smoke `01-load`, `02-rounds` |
| 2 | WS-A | A1: `fieldGeometry` and `items` bodies; PhysicsWorld floor / guard / sensor from `field`, `buildFixtures` after `buildBin`, `addItem`, the `setToyFriction` skip, `idPrefix`. | golden + new physics unit tests |
| 3 | WS-A | A2: GameCore stack behind getters, forwarders, `setMachine`, `setParams`; the RoundController `opts` and the `rules` seam (null = classic); `classic.ts`; `registry.ts` with stub genre entries (`available: false`); harness `machine?`. Game.ts:1250 → `core.setParams` (the one Game.ts line WS-A owns). | golden + round-trip identity test + full unit |
| 4 | WS-A | A3: `RoundMachine.configure / scoreItem / awardSessionPrize`, `PlaySession`, the attract hook, the contract test over `MACHINES`. | golden, RoundMachine.test unchanged and passing, full unit |
| 5 | WS-B, WS-C | Genres behind `available: false`; sweeps; docs. They start on the pure parts (geometry data, scorers, aim, session rewards) during steps 2-4 and pick up A1 (about 6 h in) for physics. | genre unit tests; the sweep anomaly list is empty |
| 6 | WS-D | Director with classic pass-through first, then the Game hooks (section 6.3), pilots, persistence, the daily pick, rewards. | classic e2e smoke unchanged; director unit tests |
| 7 | WS-E | Floor / fixture dressing, ItemVisuals, the atlas, the opening setters, warm-up. | scene unit tests; `PLUSH_SHOTS=1` classic screenshots unchanged |
| 8 | WS-F | Lobby, HUD pieces, the session card, the settings section, strings, guide lines (replacing the temporary mapping), e2e specs. | i18n / lines / brandLines tests; new specs |
| 9 | lead | Integration in the merge order 4A → A → B, C → D → E → F. Flip `available: true` per machine once its gates pass. Full e2e twice, perf rows, docs: new `docs/MACHINES.md`, updates to ARCHITECTURE, PHYSICS, SETTINGS, REWARDS, AI, PERFORMANCE, DISPLAYS, E2E_RESULTS. | full suite |

### 6.2 Existing tests that must change

| Test | Change | Owner |
| --- | --- | --- |
| tests/unit/i18n/featureStrings.test.ts:12 | add `'machines'` to the namespace list | WS-F |
| tests/unit/settings/spec.test.ts:197-200 | extend the never-live rule to `machines.(bridge\|shelf\|rush).*` | WS-F |
| tests/unit/ai/lines.test.ts, brandLines.test.ts | `variants(type, lang)` returns `facts.machine` variants for the 5 new types (progress, stuck, items 1 / 3, rank, reward, reason) | WS-F |
| tests/unit/server/schemas.test.ts | accept / strict-reject / strip cases for `facts.machine` | WS-F |
| tests/unit/scene/toyVisuals.test.ts | one case: items are skipped | WS-E |
| tests/unit/game/harness.ts | additive `machine?: MachineId` in `CoreOptions` | WS-A |
| tests/e2e/helpers.ts | `BootOptions.machine` → `?machine=` in `url()` | WS-F |
| tests/e2e/03-safe-zone.spec.ts:4 | add `menu-machines` (4A replaces the `dir-*` ids) + a lobby-in-band check | WS-F |
| tests/e2e/20-screenshots.spec.ts | one attract shot per machine (desktop sakura, portrait86) | WS-F |
| tests/e2e/22-idle-attract.spec.ts | an added case: the idle reset returns to `home` | WS-F |

Explicitly **unchanged**: independence.test.ts, rounds.test.ts, ToyField.test.ts, attract.test.ts, demoPilot.test.ts,
RoundMachine.test.ts, scoring.test.ts, scores.test.ts, 04-settings-dialog, 07-settlement, 19-stability (classic
collider counts), 21-points, 26 / 27 rewards, `tools/dev/grip-sweep.ts`.

### 6.3 Game.ts hook lines (WS-D after the scaffold; everything else stays in `MachineDirector.ts`)

1. `init`: create the core with `machine: resolveMachine(launch.machine ?? home)` (:235-241) and create the director.
2. `prizeTypeOf(toy)` in `onPrizeExit`, the `liftStarted` voice, the `slipped` voice and the aura tier
   (:704-719, :780-809, `updateShow`). Items mute character voices.
3. `bindCore` (:653-728): `controller.events` `itemScored` → director; `machine.events` `item` → director;
   `core.session.events` → director.
4. `onResult` (:881-930): `if (director.handlesResult(result)) return director.onResult(result);` for items genres;
   prize genres keep the classic body, and the director picks the guide event.
5. `updateFlow` RESULT (:1423-1433): `const adv = director.autoAdvance(result); if (adv !== undefined) { … }`.
6. `idleReset` (:615-636) → `director.onIdleReset()`; `pressStart` (:482-514) → `director.onStart()`.
7. The pilot (:114, :1333, :1412, :1684) → `director.pilot()`.
8. `EXIT_POS` (:88) → `director.exitPos()`: `openingCenter(core.def.geometry.opening)`, identical numbers for classic.
9. `updateAudio` impact mapping (:1531-1535) → `machineSfx.impact` first.
10. `itemVisuals` created next to `toyVisuals` (:230-231); synced in `afterRoundBoundary`, `populate` and
    `pressStart`; updated in `update` (:1360).
11. `onSettingsChanged`: a `machines.*` rebuild diff on the current genre queues `director.rebuild()` (:1251-1260).
12. `facts()`: `facts.machine` (:1038).
13. The debug API additions (:1659-1740) and the public methods behind the scaffold stubs.

---

## 7. Parallel implementation split

The lead writes the scaffold (1 h) and then owns WS-A. **Five engineers** take B-F. Each workstream owns its files
exclusively. "Touches" lists hook lines in files someone else owns, so merges stay predictable.

| WS | Owns (exclusive) | Touches (hook lines only) | Delivers | Hours |
| --- | --- | --- | --- | --- |
| **A Core** (lead) | src/game/{GameCore,RoundController,RoundMachine,attract,ToyField}.ts, src/physics/{PhysicsWorld,fieldGeometry,items}.ts, src/game/machines/{session,registry,classic}.ts, tests/unit/game/harness.ts, tests/unit/machines/{classicGolden,stack,contract,session,fieldGeometry,items,roundMachine.items,controller.rules}.test.ts, `__golden__/`, tools/dev/golden-classic.ts | Game.ts:1250 (`core.setParams`) | golden; geometry and items in physics; the stack rebuild; the rules seam; item and session awards; PlaySession; the contract test | 26 |
| **B Bridge** | src/game/machines/bridge.ts, tests/unit/machines/bridge.test.ts, tools/dev/machine-sweep.ts (the shared runner), tools/dev/sweeps/bridge.ts, docs/machines/bridge.md | registry.ts (its entry's params only) | geometry, BridgeRules (partial lift, in place, retract, progress, stuck, twoStep), BridgeField (start pose, staff reset, at-rest refill), aim, the settings mapping, sweeps and tuning | 28 |
| **C Shelf + Rush** | src/game/machines/{shelf,rush,pieces}.ts, tests/unit/machines/{shelf,rush,pieces}.test.ts, tools/dev/sweeps/{shelf,rush}.ts, docs/machines/{shelf,rush}.md | registry.ts (its entries' params only) | both items genres: geometry, rules (forward / always-to-chute transport, item awards, calm settle), fields (stacks, pile, refills, takeover), scorers, session rewards, aim, sweeps, `rewardValue` measurement | 34 |
| **D App glue** | src/app/{MachineDirector,MachinePilot,machineSfx}.ts, src/app/Game.ts (after the scaffold; section 6.3), src/app/{launch,bootstrap}.ts, src/game/scoring.ts (additive), src/game/machines/daily.ts, src/persistence/{machines,collection}.ts, tests/unit/app/{machineDirector,machinePilot}.test.ts, tests/unit/persistence/machines.test.ts, tests/unit/machines/daily.test.ts, tests/unit/game/scoring.machines.test.ts | — | switching, item and session settlement, rewards and collection rules, rankings, the daily pick and unlocks, idle / attract with machines, the guide emission policy, the HUD slice, the debug API | 32 |
| **E Rendering** | src/scene/machines/{index,floor,fixtures,printAtlas,preview}.ts, src/scene/ItemVisuals.ts, tests/unit/scene/{itemVisuals,printAtlas,machineDressing}.test.ts, the PERFORMANCE.md section | src/scene/Cabinet.ts (the constructor argument, 2 conditions, 2 calls), src/scene/Stage.ts (warm-up list, `setHole` call), src/scene/contactShadows.ts (`setHole`), src/scene/Effects.ts + fx/ParticlePool.ts (`setOpening`), src/scene/ToyVisuals.ts (1 line) | the floor with a hole, fixture looks, the item visuals and atlas, the openings for effects / contact shadows, previews for 4A, budgets | 32 |
| **F UI, i18n, guide, e2e** | src/ui/machines/* (LobbyDialog, MachineCard, art.tsx, SessionHud, TryToast, SessionResultCard, InitialsEntry, useMachineDeck.ts, machines.css), src/ui/settings/tabGameplay.tsx (the Machines section), src/i18n/strings/machines.ts, src/ai/lines/{types,index,en,zh,ja}.ts, src/ai/prompt.ts (task text), the tests in section 6.2 marked WS-F, tests/e2e/{28,29,30,31}-machines-*.spec.ts | src/ui/App.tsx (3 mount lines + the modal case), src/i18n/all.ts (registration), src/ui/AttractOverlay.tsx (optional CTA subtitle) | lobby in 4 layouts, the session HUD, try toast, session card + initials, settings UI, about 150 guide lines in 3 languages with the gtc pools, all strings, e2e | 40 |

**Contracts frozen by the scaffold** (only the lead edits them):
- `src/game/machines/{ids,types}.ts`, `src/physics/{fieldGeometry,items}.ts` (types);
- `RoundResult.machine`, `GuideFacts.machine` and the 5 event types, `FactsSchema.machine`;
- the gameStore slices, `ModalId 'lobby'` and the `machines` settings group;
- the `Game` public methods, the debug API names in section 4.7 and the numbers in section 3. B and C may retune
  values, never shapes or field names.

**Integration risks.**
1. **Classic regression.** Any change to the Rapier creation order breaks bit-identity. The golden and round-trip
   tests run on every A commit and as the CI gate. A reviewer diffs every `else` branch against the removed lines.
2. **4A overlap** in Game.ts (the input path), Cabinet.ts and Stage.ts (the shell) and Hud.tsx (the deck).
   - Mitigation: 4A merges first; WS-D's logic lives in `MachineDirector.ts` with section 6.3's hook lines only;
     WS-F never edits `Hud.tsx` (`useMachineDeck()` plus App.tsx mounts); WS-E's Cabinet edits are confined to the
     floor, chute and fixture blocks.
   - A shared touch-point list goes in each PR description.
3. **Tuning lands late** (the bridge especially). Rendering is data-driven from `FieldGeometry`, so dressings follow.
   The genre `defaults` and the spec defaults must agree (a unit test asserts it). If the bridge cannot be made fair
   with the partial lift, fall back to an adjustable `liftDelta` by difficulty; that is a contract-preserving change.
4. **B / C wait on A1 for real physics** (about 6 h). They start on the pure parts, or prototype with a scratch probe
   that creates the colliders directly on `phys.world`, as the framework probe did.
5. **Switch leaks** (bodies, colliders, geometries, textures, listeners). The contract test round-trips classic → X
   → classic and compares `phys.toys.size`, the world's collider and body counts, and the listener counts on
   `machine.events`. `31-machines-stability` checks `renderer.info.memory` across switches.
6. **Toy-id reuse** across stacks would confuse id-keyed visuals: `idPrefix` per epoch, and visuals cleared before
   `setMachine`.
7. **Guide line volume and strictness** (V2, V3). WS-F starts on the frozen key list on day 1.
8. **Booth prize semantics** (section 3.5) must be agreed with the operator and documented in REWARDS.md.
9. **e2e machine time is the bottleneck**: one e2e run at a time on this 4-core box. Each workstream runs its own spec
   plus the smoke subset; the lead runs the full suite.

---

## 8. Test plan

### 8.1 Unit (Vitest, headless Node, real Rapier)

**WS-A**
- `classicGolden`: the fixture equals the run, bit for bit.
- `stack`: after classic → rush → classic, pose hashes equal the fixture; toy ids never repeat across epochs;
  listener counts are restored; `setMachine` outside a boundary throws.
- `fieldGeometry`:
  - `CLASSIC_FIELD` equals the fieldSpec numbers;
  - `floorWithHole` covers the slab minus the hole with no overlap;
  - `validateGeometry` rejects an opening outside `BIN`, a fixture above 0.44, a home outside the reach, and a guard
    with a hole floor.
- `physics` (in `items.test.ts`):
  - the classic world's collider handle sequence equals a world built without options;
  - a bridge world has 6 fixture colliders on one extra body;
  - the gutter uses the Min combine rule;
  - no guard colliders without `chuteGuard`;
  - `addItem` sets the material;
  - `setToyFriction` skips items.
- `roundMachine.items`:
  - `scoreItem` is idempotent per toy, refused in ATTRACT, RESULT and stale rounds, and its ids increase;
  - `awardSessionPrize` happens once per round, never for demos, with the `-S` id;
  - `configure` only at boundaries;
  - `awardPrize` is unchanged (RoundMachine.test.ts still passes).
- `controller.rules`:
  - with `rules = null`, every existing rounds test passes;
  - a fake TryRules sees `postStep` in every phase except ATTRACT;
  - `inputLocked` blocks the grab;
  - `filterInput` stages x then z;
  - partial lift and in-place transport go straight to RELEASING.
- `session`:
  - `tries` counts only player DESCENDINGs;
  - the timer advances only in fixed steps, starts at the first AIMING and pauses with the step;
  - time-up in AIMING forces one grab, in READY ends without a try, when busy ends at RESULT;
  - demo rounds are ignored; the config is latched at start; `newSession` resets.
- `contract`: for every entry in `MACHINES`, available or not:
  - `validateGeometry` returns [];
  - fill determinism (same seed, same hash; another seed, a different one);
  - 10 pilot tries with no anomaly (NaN, escaped body, an award outside the sensor, a double award);
  - the collider count is constant after `resetForTakeover`;
  - the genre `defaults` agree with the spec defaults.

**WS-B** `bridge`:
- the start pose stays still for 5 s;
- a 0.10 shift tips the box into the pit with exactly one award (via the sensor);
- the 0.08 wedge is detected as `stuck` after 3 tries;
- `staffReset` restores the seeded pose and awards nothing;
- the partial lift stops at `liftDelta`;
- the claw retracts before it moves home;
- outcomes are `won` or `empty`, never `slipped`;
- progress grows with synthetic shifts and turns;
- `filterInput` stage order;
- 200 random-aim tries produce no non-finite pose and no award outside the sensor.

**WS-C**
- `shelf`:
  - stacks are stable (< 2 mm in 5 s);
  - one push delivers N items as N `scoreItem` with distinct ids and one `won`;
  - a gutter drop reaches the sensor;
  - a fall during RESULT counts for the next try;
  - 5 tries end the session;
  - the reward is the rarest print (ties by order);
  - `resetForTakeover` restores the stacks.
- `rush`:
  - 44 pieces settle in < 3 s;
  - over 300 random grabs, the guard keeps floor pieces out (no score without a carry);
  - a scripted centred grab delivers ≥ 1 piece in ≥ 60 % of grabs;
  - a 75 s session ends with reason `time`;
  - the reward band picks the least-collected character;
  - demo runs are never ranked.
- `pieces`: the scorers (multi-drop cap, handful, daily bonus applied once).

**WS-D**
- `machineDirector` with a fake host:
  - the switch sequence order;
  - the visuals are cleared before `setMachine`;
  - round ids keep increasing across a switch;
  - no plush restock on genres over 50 rounds, attract and an idle reset;
  - prize rules per genre (one QR per box / per qualifying session);
  - the guide emission policy;
  - the idle reset returns home;
  - the attract cycle on / off.
- `machinePilot`: steering converges; the patience timeout always grabs.
- `scoring.machines`: `settleScored` is idempotent; `useRecord` swaps; the daily bonus never reaches classic.
- `persistence/machines`: sanitising, top-10 ordering and ties, the initials filter and blocklist, the version guard,
  *Reset scores*.
- `daily`: stable per date, changes across dates, never classic, respects hidden / locked / unavailable, and each
  machine lands within ±30 % of the mean over 365 dates.

**WS-E**
- `itemVisuals`: instance counts per machine, interpolation, `dispose` frees geometries.
- `printAtlas`: the cell mapping, the fallback before the thumbnails, a redraw on arrival.
- `machineDressing`: every look maps to an existing material; triangles per tier stay within budget; no chute
  geometry without `chuteGuard`; the classic Cabinet's geometry buckets are byte-equal to today's (a hash of the
  merged attributes).

**WS-F**
- i18n completeness and featureStrings for `machines`;
- the lines and brandLines suites with the machine variants;
- server schema cases;
- the settings never-live rule.

### 8.2 Sweeps (headless tools, not CI; the gates before `available: true`)

```
tools/dev/machine-sweep.ts --machine bridge|shelf|rush [--difficulty all] [--seeds 8] [--tries 40] [--perf]
```

It is built on the harness like `tools/dev/grip-sweep.ts`, and the gates are those of sections 3.1-3.3. One sweep of
8 seeds × 40 tries is about 10-25 min headless on this shared 4-core machine. The results go into
`docs/machines/<genre>.md` in the style of PHYSICS.md.

### 8.3 E2E (Playwright, production build, SwiftShader, `fastForward` only, never wall-clock waits)

| Spec | What | Layouts | Run time here |
| --- | --- | --- | --- |
| `28-machines-lobby` | `menu-machines` opens `lobby`; cards, ribbon and lock visible; pick bridge → curtain → `machine().id === 'bridge'`, READY; back to classic; every card and button inside the safe zone and, on 86", inside y 0.25-0.75; phone targets ≥ 44 px; no console errors | desktop, portrait32, portrait86, mobile | about 12 min |
| `29-machines-play` | **bridge** `?machine=bridge&seed=7`: `machineDebug.nudge` + `fastForward(4)` → exactly one `award` in `__awards`, collection +1 for the print, win card, one claim code with the rewards server (as in 26 / 27); a second box won after PLAY AGAIN gets a different code. **shelf**: 5 tries via `placeClaw` + `grab` + `fastForward` → session card; items equal the scored events; with ≥ 3 items, prize + QR; PLAY AGAIN restacks. **rush**: `setSessionSeconds(5)` → session card → initials → ranking persists across a reload; a demo run never ranks | desktop (rush also on mobile) | about 15 min |
| `30-machines-idle` | on shelf, `__plush.idleReset()` → attract on `home` (classic); a demo plays on each machine with collection, scores and rankings unchanged; START gives a classic READY; `?machine=rush` boots into rush and is not persisted after a reload | desktop | about 8 min |
| `31-machines-stability` | 19-stability's checks across 3 round trips classic → each machine → classic: body and collider counts, `renderer.info.memory` geometries and textures back to baseline, heap growth below the 19-stability bound | desktop | about 8 min |
| `20-screenshots` (`PLUSH_SHOTS=1`) | + one attract shot per machine | desktop, portrait86 | about +6 min |

The new specs add about 45 min to the full suite (63.6 min today, docs/E2E_RESULTS.md:256-257), so a full run takes
about 1.8 h on this box.

---

## 9. Effort (engineer-hours on this 4-CPU machine with software-only WebGL)

| Item | Hours | Of which machine time | Long pole / risk |
| --- | --- | --- | --- |
| Scaffold (lead) | 1 | 10 min (`tsc` + unit + 2 smoke specs) | pasting section 2.2 exactly |
| A Core | 26 | about 2 h (golden recording, unit runs of about 40 s, one smoke e2e) | the verbatim `else` branches; listener order |
| B Bridge | 28 | about 3-4 h of sweeps | the fairness band (box mass / gap / lift) |
| C Shelf + Rush | 34 | about 4 h of sweeps | the lip / gutter band; gem caging (+8 h if the scoop is needed) |
| D App glue | 32 | about 2 h (smoke e2e) | the session and reward flow inside Game; 4A merge |
| E Rendering | 32 | about 4 h (SwiftShader perf passes, screenshots) | instanced atlas shader, the window box, warm-up |
| F UI / i18n / guide / e2e | 40 | about 6 h (new specs × layouts × iterations) | 4 layouts, the 86" band, about 150 guide lines, gtc pools |
| Integration, 2 full e2e runs, perf table, docs (lead) | 20 | about 5 h (2 × 1.8 h + reruns) | late cross-stream bugs |
| **Total** | **≈ 213 h** (±25 %) | about 27 h of serial machine time | |

**Calendar:** the scaffold on day 1, morning. A1 by the end of day 1; A2 and A3 by day 3. B-F run in parallel on days
1-6 (the longest is F, about 5 working days). Integration takes about 2.5 days. That is **about 9-10 working days**
for the lead + five engineers. Unit runs can be parallel; e2e runs must be serialised on this box.

---

## 10. Product choices `[PC]`

| # | Choice | Default here | Alternatives |
| --- | --- | --- | --- |
| 1 | Machine names | Plush Classic / **Tippy Bridge** / **Tumble Shelf** / **Sparkle Rush** (zh 经典娃娃机 / 摇摇桥 / 翻落货架 / 闪耀冲刺; ja クラシック / ゆらゆらブリッジ / ころころシェルフ / キラキララッシュ) | Teeter Bridge, Tumble Ledge, Sparkle Scoop |
| 2 | Bridge tries | unlimited (`triesPerBox` 0); a new player gets a fresh box | N tries, then the box resets (never a pity win) |
| 3 | Bridge controls | joystick | two-step buttons 1 → 2 (`twoStep`) |
| 4 | Bridge points | classic `scoreRound` by print tier; misses 0 | ×2 big-prize factor; nudge points for progress |
| 5 | Staff reset | free, unlimited, at a boundary | limited per session |
| 6 | Shelf session | 5 tries | 3-20 |
| 7 | Shelf prize | ≥ 3 boxes in a session → one prize (rarest print) + one QR; snacks are points only | each snack into the collection, a QR per scoring try |
| 8 | Rush length | 75 s | 60 / 90 (range 30-120) |
| 9 | Rush prize | raw value ≥ 450 (to tune so 25-35 % of runs qualify) → one prize by tier band, least-collected character | off (`rewardValue` 0); a fixed character |
| 10 | Ranking | local top 10, 3 letters A-Z, no daily bonus in the score | per day; networked (not built) |
| 11 | Today's pick | ×1.5 points, never classic | a free extra try; another multiplier |
| 12 | Unlocks | all open | `progress`: bridge 1, shelf 3, rush 5 wins |
| 13 | Lobby | START plays the current machine; MACHINES opens the lobby; the idle reset returns home | force the lobby at START; stay on the last machine (`idleReturn: 'stay'`) |
| 14 | Attract cycle | off | every 3 demo rounds |
| 15 | Coins | free play; the plate shows tries / time | a coin economy (not designed) |
| 16 | `?machine=` | the page's home, not persisted | persist like `?theme=` |
| 17 | Late falls after a session | not credited | credited to the next session |

---

## 11. What this design deliberately does not do (honest)

1. **Openings outside the bin footprint.** The bridge sits left of centre (x −0.20) and the shelf's trough is the
   front-left half, with a gutter for the right half. This keeps the bin, the lower cabinet and four layouts
   untouched. `BinSpec` is the documented next seam (about 3-4 days).
2. **One three-finger claw for every genre.** There is no two-prong bridge arm and no shovel. The bridge technique is
   "press, lift or turn an end".
3. **The travel clearance caps the scenery at about 0.44 m**: no tall towers.
4. **Friction-only bridge lifting is a tuning gamble.** The sweep gate decides; the fallback is a per-difficulty
   `liftDelta`.
5. **Instanced items skip the contact-shadow pass** this round.
6. **Neighbour cabinets are static previews**, not live machines.
7. **Pushers, roulettes and ticket wheels** need kinematic movers, a later seam.
8. **No real-hardware validation** (GPU, 86" panel, phone, booth network), as in every round so far.

## Appendix: code relied on

- **fieldSpec.ts**: FIELD :10-19, CHUTE :22-30, PRIZE_SENSOR :38-47, BIN :50-58, CLAW :60-94 (home :63-64, reach :66-69,
  drop :71-72, finger profile :82-89), FIXED_DT :112, isOverChute :115-117.
- **PhysicsWorld.ts**: StaticKind :15, ToyBody :52-65, PhysicsOptions :79-83, groups :85-95, constructor :127-135,
  addStatic :151-171, buildCabinet :173-229, buildBin :231-251, setToyFriction :262-265, colliderDesc :279-303,
  addToy :305-352, isInPrizeSensor :369-374, step / sensor drain / impacts :379-422.
- **ClawRig.ts**: setTrolleyTarget clamp :237-242, setWinch :257-260, winchArrived :267-269, reset :531-570.
- **GripMonitor.ts**: beginRound :144-160, scan :194, assist gate :340.
- **RoundMachine.ts**: TRANSITIONS :14-25, AWARD_PHASES :38, watchdogs :41-48, constructor :88, atRoundBoundary
  :110-112, beginRound :128-134, awardPrize :185-200, finish :203-210, abort :224-234.
- **RoundController.ts**: constructor :83-95, setParams :98-101, requestGrab :120-125, resetRound :133-140, onPhase
  :144-213, onWatchdog :215-239, preStep :244-296, postStep :299-395, checkPrize :421-433, checkStrays :436-451,
  buildResult :471-506.
- **GameCore.ts**: :37-45, fixedStep :48-56, populate :59-70, settle :77-83.
- **ToyField.ts**: isFreeSpot :32-37, nextAsset :98-108, fill :114-165, missing :193-195, restockOne :201-210,
  clearBin :213-217, clearFallen :224-231, settle :238-252.
- **attract.ts**: enter :93-102, leave :109-114, resetField :121-135, update :141-163.
- **scoring.ts**: scoreRound :103-144, ScoreKeeper :166-240.
- **DemoPilot.ts**: rate :38-61, pick :63-88, update :91-132.
- **Game.ts**: EXIT_POS :88, pilot :114, init :209-284, roundParams :286-299, fieldOptions :301-309, rebuildScene
  :327-357, populate :359-365, pushInput :469-476, pressStart :482-514, playAgain :522-532, idleReset :615-636,
  bindCore :653-728, onPrizeExit :780-809, settleRound :811-826, requestReward :828-838, onResult :881-930,
  afterRoundBoundary :933-953, applyQueuedRebuild :955-1007, stepRestock :1009-1034, facts :1038-1083,
  onSettingsChanged :1225-1262, update :1323-1365, updateFlow :1405-1438, updateAudio :1502-1536, debug API
  :1659-1740.
- **Scene**: Cabinet.ts constructor :182-197, floor :274-280, chute :306-317, lower cabinet :319-377. Stage.ts
  contact shadows :274-277. Effects.ts :73-77. fx/ParticlePool.ts :88-89, :361. ToyVisuals.ts sync :234-246, create
  :248-250.
- **UI**: Hud.tsx ActionButton :119-158, ResultCard :479-555. RewardCard.tsx useWinCard :84-114, WinCard :346.
  ScoreHud.tsx scoreHudRect :36-62. Dialogs.tsx ThemePicker :97-114.
- **Rewards**: flow.ts onWin :107-140. protocol.ts dedup note :7.
- **Guide**: contracts.ts SFX_NAMES :12-50, GUIDE_EVENT_TYPES :159-171, GuideFacts :177-208. GuideDirector.ts :44-72.
  prompt.ts EVENT_TASKS :107-119. lines/index.ts resolveSituation :60-104, buildCandidates :140-170.
  lines/types.ts LINE_KEYS :9-40. server/schemas.ts FactsSchema :27-66.
- **Tests**: lines.test.ts :79-81, :90, :94-101, :117-131. brandLines.test.ts :137, :146-160.
  featureStrings.test.ts :12, :24-26. spec.test.ts :197-200. independence.test.ts :75-91. e2e helpers.ts :118-129.
  rounds.test.ts :186.
- **Docs**: PERFORMANCE.md :313-330, DISPLAYS.md :36 and :224, E2E_RESULTS.md :256-257.
