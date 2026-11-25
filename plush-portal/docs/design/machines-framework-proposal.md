# PLUSH PORTAL, round 4B: a machine framework (Tippy Bridge, Tumble Shelf, Sparkle Rush, lobby)

Design only. Nothing in the repository was edited. The figures in Appendix B come from a throwaway headless probe
in the scratchpad that imports the real `PhysicsWorld` and `ClawRig`.

Who this is for: five or six engineers building item 3 of the round in parallel, plus the lead who writes the scaffold.
It also has to stay compatible with workstream **4A**, which owns the joystick, the 3D control deck and the
negative-space scene.

Angle: a real **machine framework**. That means a registry of machine definitions, per-machine field geometry,
session rules, and seams that make the 40th machine cheap. **CLASSIC stays the default and behaves byte-for-byte as
it does today.**

---

## 0. Summary

| # | Decision |
| --- | --- |
| D1 | **One `GameCore` and one `RoundMachine` for the page's lifetime.** Changing machine swaps the field, the rules and the session *inside* the core (`GameCore.setMachine`). Two reasons: e2e binds `core().machine.events` once at boot (tests/e2e/helpers.ts:118-129), and `Game.bindCore` binds once (src/app/Game.ts:653). |
| D2 | A machine is **data + a genre**. `MachineDef = { id, genre, params }`. A *genre* (`classic`, `bridge`, `ledge`, `rush`) is code: a `GenreModule`. A *variant* (a narrower bridge, a 60-second rush) is a new data entry with no new code. The 40th machine is almost always a variant. |
| D3 | **Field geometry is data** (`FieldGeometry`, in the physics layer). It is an ordered list of static parts (boxes and capsules), the prize openings (sensor volumes, which may sit anywhere), the bin under them and the claw limits and home. `PhysicsWorld` builds whatever it is given. `CLASSIC_GEOMETRY` lists today's colliders **in today's creation order with today's numbers**. |
| D4 | **Round = one claw try** (unchanged). A new headless `PlaySession` sits above it, with three kinds: `open` (classic: tries until the player walks away), `persistent` (bridge and ledge: the field stays as it is between tries, with a per-prize try counter) and `timed` (rush: 45-120 s on the simulated clock). |
| D5 | `RoundController` gets **one seam**: a `TryRules` object. `ClassicRules` holds the existing classic code (`checkPrize`, `checkStrays`, the SETTLING finish, the transport targets), moved there verbatim and called from the exact same call sites. The new genres implement the same interface. |
| D6 | Machine items (bridge box, shelf snacks, gems, coins) are **`ToyBody`s with an `item: ItemSpec`**. As a result `GripMonitor` (it only sees toys, src/physics/GripMonitor.ts:201), impacts, sensors, interpolation, the debug API and `inspectWorld` all work on them unchanged. The renderer draws them with a new `ItemVisuals`; `ToyVisuals` skips them. |
| D7 | **The claw does not change shape.** Each genre varies only parameters: speed scales, `clawForce`, `gripAssist`, the lift rule (full or partial), the transport rule (chute, forward, in place) and the trolley home. A different claw (a two-prong arm or a scoop) is a documented seam (`ClawAttachment`), costed but not built. |
| D8 | **Every outcome is still physics.** A prize is a body whose centre of mass passes an opening's sensor during an allowed phase. Awards stay idempotent: `RoundMachine.awardPrize` is unchanged, and the new `awardItem` is idempotent per (round, body). Demo rounds never count or persist. Graphics never reach the simulation, and the independence test covers `src/game/machines/**` automatically because the files live under `src/game`. |
| D9 | **Lobby = a modal carousel (`ModalId 'lobby'`) that sets `machines.current`.** It works exactly like the theme picker (src/ui/Dialogs.tsx:97-114), so the switch goes through the existing queued-rebuild path. START from attract mode still plays the *current* machine at once; nobody is forced through the lobby. The idle reset returns to `machines.home` (default classic). Attract mode plays the current or home machine, and can optionally cycle. |
| D10 | Prizes. **Collection:** the bridge box and every shelf item count as their printed character; rush gems are points only. **Claim QR:** bridge 1 per box; shelf 1 per try that delivered at least one item; rush none by default, with an optional score threshold. |
| D11 | Machines are merged behind `available: false` in the registry until each one passes its gates. `main` therefore stays green and classic-only for players during the whole round. |
| D12 | Cost, honestly: about **238 engineer-hours**. The scaffold is about 26 h, six workstreams about 186 h, integration about 26 h. The framework overhead itself is about 10 %. The real costs are physics tuning, content (strings and guide lines in three languages), rendering, UI in four layouts and the slow software-GL e2e cycle (§7). |

Working names in the brief: "balance bridge", "tower/ledge", "gem rush". The original names proposed here avoid the
reference app's names (SNACK TOWER, BRIDGE, JEWEL RANKING):

| id | Genre | EN | ZH | JA |
| --- | --- | --- | --- | --- |
| `classic` | classic | Plush Classic | 经典娃娃机 | クラシック |
| `bridge` | bridge | **Tippy Bridge** | 摇摇桥 | ゆらゆらブリッジ |
| `ledge` | ledge | **Tumble Shelf** | 翻落货架 | ころころシェルフ |
| `rush` | rush | **Sparkle Rush** | 闪耀冲刺 | キラキララッシュ |

All art is original. Box prints use the project's own character thumbnails (src/plush/thumbnails.ts).

---

## 1. The machine abstraction

### 1.1 Vocabulary (and a naming clash to live with)

- **machine**: a playable cabinet setup (`MachineDef`, id `bridge`). The UI says "machine".
- **genre**: the code behind a family of machines (`GenreModule`).
- **try**: one claw cycle, READY to RESULT. In code it stays a *round* (`RoundMachine`, `roundId`, `RoundResult`),
  because renaming would break every test and the e2e event capture.
- **session**: from START, the attract takeover or a new timed run, until the idle reset or the end of a timed run
  (`PlaySession`).
- **Clash:** `core.machine` is and stays the **`RoundMachine`** (the e2e suite reads `core().machine.events`). The
  active machine definition is `core.def`, and its rules are `core.rules`.

### 1.2 Where things live

```
src/physics/fieldGeometry.ts   NEW  FieldGeometry types, CLASSIC_GEOMETRY, validateGeometry, helpers   (physics layer)
src/physics/items.ts           NEW  ItemSpec, itemAsset(), proxy helpers for boxes / gems / coins        (physics layer)
src/physics/PhysicsWorld.ts    MOD  builds from a FieldGeometry; openings map; addItem(); setGeometry()
src/physics/ClawRig.ts         MOD  trolley limits from the geometry (classic numbers by default)
src/game/machines/ids.ts       NEW  GENRE_IDS, MACHINE_IDS (pure consts, also used by spec.ts and server/schemas.ts)
src/game/machines/types.ts     NEW  MachineDef, GenreModule, TryRules, TryState, MachineField, SessionRule, scoring inputs
src/game/machines/registry.ts  NEW  MACHINES, GENRES, resolveMachine(), offeredMachines(), neighbours()
src/game/machines/classic.ts   NEW  classicModule + ClassicRules (code moved verbatim from RoundController)
src/game/machines/bridge.ts    NEW  bridgeModule: geometry, BridgeRules, BridgeField, scoreBridge
src/game/machines/ledge.ts     NEW  ledgeModule: geometry, LedgeRules, LedgeField, scoreLedge
src/game/machines/rush.ts      NEW  rushModule: (classic geometry), RushRules, RushField, scoreRush
src/game/machines/session.ts   NEW  PlaySession (open / persistent / timed)
src/game/machines/daily.ts     NEW  dailyPick(ymd, offered) (pure)
src/game/{GameCore,RoundController,RoundMachine,attract,scoring}.ts  MOD (seams, §1.4)
src/app/MachineDirector.ts     NEW  app-side glue: switching, per-genre fx/sfx/popups, scoring, rewards, guide facts, HUD slice
src/app/pilots/{index,bridge,ledge,rush}.ts  NEW  attract-mode pilots (classic keeps src/app/DemoPilot.ts untouched)
src/app/machineSfx.ts          NEW  machine moments → existing SFX names (+ optional new ones later)
src/scene/machines/*           NEW  field dressings (classic = the current code moved verbatim), print atlas, lower cabinet
src/scene/ItemVisuals.ts       NEW  instanced boxes / gems / coins following BodyPose
src/ui/machines/*              NEW  LobbyDialog, MachineCard, art (SVG per genre), SessionHud, SessionResultCard, InitialsEntry
src/persistence/rankings.ts    NEW  local top-10 per machine
src/i18n/strings/machines.ts   NEW  all machine / lobby / session strings (en, zh, ja)
```

The headless parts live under `src/game/machines` and `src/physics`, so `tests/unit/core/independence.test.ts`
(entries `src/game` and `src/physics`, allowed prefixes `game|physics|core|plush/manifest.ts|settings/spec.ts`,
lines 75-91) covers them **with no change to the test**.

### 1.3 Contracts (TypeScript, committed in the scaffold)

#### Physics layer: `src/physics/fieldGeometry.ts`

```ts
import type { Quat, Vec3 } from '../core/types';

/** Superset of today's StaticKind (PhysicsWorld.ts:15). Used for impact classification and diagnostics. */
export type StaticKind =
  | 'floor' | 'glass' | 'backWall' | 'ceiling' | 'chuteWall' | 'bin'
  | 'bar' | 'post' | 'shelf' | 'lip' | 'fence' | 'ramp';
/** Renderer hint for generic dressings (never read by physics). */
export type StaticLook = 'mat' | 'deck' | 'chrome' | 'acrylic' | 'dark' | 'enamel' | 'velvet' | 'cushion' | 'hidden';
/** 'solid' = STATIC_GROUPS, 'guard' = GUARD_GROUPS: floppy toy parts pass through (PhysicsWorld.ts:85-95). */
export type StaticFilter = 'solid' | 'guard';

interface PartBase { kind: StaticKind; friction: number; restitution: number; filter: StaticFilter; look: StaticLook }
export interface StaticBox extends PartBase { shape: 'box'; center: Vec3; half: Vec3; rot?: Quat }
/** A rounded bar or post (Rapier capsule) along one world axis. */
export interface StaticCapsule extends PartBase { shape: 'capsule'; center: Vec3; axis: 'x' | 'y' | 'z'; halfLength: number; radius: number }
export type StaticPart = StaticBox | StaticCapsule;

/** A hole in the floor with a sensor volume below it. Any number, anywhere in the field. */
export interface PrizeOpening {
  id: string;                                   // 'chute' | 'pit' | 'trough' | …
  xMin: number; xMax: number; zMin: number; zMax: number;   // footprint (world metres)
  sensorTop: number; sensorBottom: number;      // sensor volume below the floor (classic -0.1 / -0.3)
  awardComY: number;                            // COM must be below this (classic -0.06)
  overMargin: number;                           // "over the opening" tolerance (classic 0.02, RoundController.ts:427)
}

/** The prize bin / shaft under the openings. Its floor height comes from the display layout (unchanged). */
export interface BinSpec {
  xMin: number; xMax: number; zMin: number; zMax: number;
  /** Walls the bin adds below the floor (classic: right + back; the glass is the left and front wall). */
  walls: { left: boolean; right: boolean; back: boolean };
  /** Floor tilt about X towards the front glass, radians (classic 0: flat cushion). */
  slope: number;
}

export interface ClawLimits { minX: number; maxX: number; minZ: number; maxZ: number; homeX: number; homeZ: number }

export interface FieldGeometry {
  /** Created in exactly this order: Rapier handle allocation (and so the solver order) depends on it. */
  readonly statics: readonly StaticPart[];
  readonly openings: readonly PrizeOpening[];
  readonly bin: BinSpec;
  readonly claw: ClawLimits;
}

/** Today's cabinet, written out from FIELD / CHUTE / PRIZE_SENSOR / BIN / CLAW (fieldSpec.ts:10-94). */
export const CLASSIC_GEOMETRY: FieldGeometry;
/** Problems found ([] = ok): openings outside the field, bin not under the openings, home outside the limits, NaN… */
export function validateGeometry(g: FieldGeometry): string[];
/** Up to four floor strips around a rectangular hole (for non-classic genres; classic lists its two boxes by hand). */
export function floorWithHole(hole: { xMin: number; xMax: number; zMin: number; zMax: number }, friction: number, restitution: number): StaticBox[];
export function openingCenter(o: PrizeOpening): { x: number; y: number; z: number };   // replaces Game.ts:88 EXIT_POS
```

`CLASSIC_GEOMETRY.statics` is, in this order, exactly what `buildCabinet` creates today (PhysicsWorld.ts:184-212):
two `floor` boxes (friction 0.95, restitution 0.02); three `glass` boxes (0.3 / 0.12); `backWall` (0.5 / 0.08);
`ceiling` (0.4 / **0.05**, today's default argument); two `chuteWall` boxes with `filter: 'guard'` (0.35 / 0.1). Its
single opening is `chute` (`PRIZE_SENSOR`, awardComY -0.06, overMargin 0.02). Its bin is `BIN` with walls
`{ left: false, right: true, back: true }` and slope 0, which yields the same three bin colliders in the same order
(PhysicsWorld.ts:245-250). Its claw limits are `CLAW.minX … maxZ` with home `CLAW.homeX/homeZ`.

#### Physics layer: `src/physics/items.ts`

```ts
import type { Vec3 } from '../core/types';
import type { PlushAsset, ProxyShape } from '../plush/manifest';

export type ItemKind = 'box' | 'gem' | 'coin';
export interface ItemSpec {
  kind: ItemKind;
  /** Visual recipe for src/scene (never read by physics): 'bridgeBox' | 'snackS' | 'snackM' | 'snackL' | 'gemEmerald' | … */
  look: string;
  size: Vec3; mass: number; comHeight: number; footprint: number;
  /** Same proxy type as the plush manifest, so PhysicsWorld.colliderDesc (PhysicsWorld.ts:281-303) builds it unchanged. */
  proxies: readonly ProxyShape[];
  friction: number; restitution: number; linearDamping: number; angularDamping: number;
  /** Character printed on a box: the collection prize. null for gems and coins. */
  printTypeId: string | null;
  /** Points of a gem or coin; 0 for boxes (they score by their print's rarity). */
  value: number;
}
/**
 * The PlushAsset a ToyBody needs (GripMonitor reads footprint/size, Game reads id for rarity / voice).
 * Boxes take the printed character's id, names and kind, so rarity, voice, aura and collection "just work".
 * Gems use the id `item.<look>` (rarity: common, unknown voice → generic squeak, which the director mutes).
 */
export function itemAsset(spec: ItemSpec, print: PlushAsset | null): PlushAsset;
export function boxItem(o: { look: string; size: Vec3; mass: number; round: number; friction: number; print: string | null }): ItemSpec;
export function gemItem(o: { look: string; radius: number; mass: number; value: number }): ItemSpec;   // 17-point brilliant hull
export function coinItem(o: { radius: number; thickness: number; mass: number; value: number }): ItemSpec;
```

`ToyBody` (PhysicsWorld.ts:52-65) gains **one optional field**, `item?: ItemSpec`. It is absent for plush, so classic
objects are unchanged. A helper `bodyKind(toy) = toy.item?.kind ?? 'plush'` reads it.

#### Game layer: `src/game/machines/ids.ts` and `types.ts`

```ts
export const GENRE_IDS = ['classic', 'bridge', 'ledge', 'rush'] as const;
export type GenreId = (typeof GENRE_IDS)[number];
/** Every registered machine. A data-only variant adds one id here and one entry in registry.ts. */
export const MACHINE_IDS = ['classic', 'bridge', 'ledge', 'rush'] as const;
export type MachineId = (typeof MACHINE_IDS)[number];
export const DEFAULT_MACHINE: MachineId = 'classic';
```

```ts
import type { RoundPhase, RoundResult, Vec3 } from '../../core/types';
import type { Emitter } from '../../core/events';
import type { ClawRig } from '../../physics/ClawRig';
import type { FieldGeometry } from '../../physics/fieldGeometry';
import type { GripMonitor } from '../../physics/GripMonitor';
import type { ItemKind } from '../../physics/items';
import type { PhysicsWorld, ToyBody } from '../../physics/PhysicsWorld';
import type { PlushAsset } from '../../plush/manifest';
import type { RoundControllerEvents, RoundParams } from '../RoundController';
import type { RoundMachine } from '../RoundMachine';
import type { FieldOptions } from '../ToyField';
import type { RoundScore, ScoringDifficulty, GripSummary } from '../scoring';

/* ---------------------------------------------------------------- rules of one try */

/** What a rule may read and do. RoundController implements it (the classic code reads the same fields today). */
export interface TryState {
  readonly phys: PhysicsWorld;
  readonly claw: ClawRig;
  readonly grip: GripMonitor;
  readonly machine: RoundMachine;
  readonly events: Emitter<RoundControllerEvents>;
  readonly params: Readonly<RoundParams>;
  /** The fingers opened on a held target this try (today RoundController.releasedHolding). */
  readonly releasedHolding: boolean;
}

export interface TransportPlan { x: number; z: number; speed: number; toChute: boolean }

export interface TryRules {
  /** Where the trolley rests between tries (READY / ATTRACT / SETTLING targets). */
  readonly home: { x: number; z: number };
  /** Genres that may award while the claw is still descending or closing (classic: false). */
  readonly awardsDuringDescent: boolean;
  /** SETTLING also winds the cable up (in-place genres, whose LIFTING stopped half-way). Classic: false. */
  readonly retractOnSettle: boolean;
  beginTry(s: TryState): void;
  /** Rope length for LIFTING (classic: CLAW.ropeMin). */
  liftTarget(s: TryState): number;
  /** TRANSPORTING destination; `holding` = GripMonitor still holds the target. */
  transportTarget(s: TryState, holding: boolean): TransportPlan;
  /** Called at the classic checkPrize() call sites (LIFTING, TRANSPORTING, RELEASING, SETTLING),
   *  plus DESCENDING and CLOSING when awardsDuringDescent. */
  checkAwards(s: TryState, phase: RoundPhase): void;
  /** Called where checkStrays() is today (end of every postStep). */
  checkStrays(s: TryState): void;
  forgetStrays(): void;
  /** SETTLING: may the try end now? (classic: the award-landed / target-stopped logic, RoundController.ts:374-389) */
  canFinish(s: TryState, phaseTime: number): boolean;
  /** Extra fields merged into the RoundResult. Classic: absent (the object is built exactly as today). */
  resultExtras?(s: TryState, base: RoundResult): Partial<RoundResult>;
  /** twoStep controls: maps raw input to the allowed axis and decides the automatic drop. Classic: absent. */
  filterInput?(s: TryState, x: number, z: number): { x: number; z: number; grab: boolean };
  /** Shown by window.__plush.machine() (tests / tuning). */
  debugState?(): Record<string, unknown>;
}

/* ---------------------------------------------------------------- field contents */

/** ToyField's public API (src/game/ToyField.ts) as an interface; ToyField implements it unchanged. */
export interface MachineField {
  setOptions(options: FieldOptions): void;
  fill(assets: PlushAsset[], seed?: number): ToyBody[];
  onField(): ToyBody[];
  inBin(): ToyBody[];
  /** How many bodies the next round boundary should add (each genre encodes its own refill policy). */
  missing(): number;
  restockOne(): ToyBody | null;
  clearBin(): ToyBody[];
  clearFallen(): ToyBody[];
  settle(maxSeconds?: number, preStep?: () => void, postStep?: () => void): number;
  /** A player takes over from the demo / a new session starts: back to the start state. Classic: absent. */
  resetForTakeover?(): number;
  /** "Call staff": put the prize back in its start pose. Bridge only. */
  staffReset?(): boolean;
}

/* ---------------------------------------------------------------- sessions */

export type SessionRule =
  | { kind: 'open' }                                     // classic
  | { kind: 'persistent'; maxTriesPerPrize: number }     // bridge, ledge (0 = unlimited)
  | { kind: 'timed'; seconds: number };                  // rush

/* ---------------------------------------------------------------- scoring */

export interface ScoredItem { toyId: string; typeId: string | null; kind: ItemKind | 'plush'; value: number; firstCatch: boolean }
export interface MachineScoreInput {
  roundId: number; demo: boolean; difficulty: ScoringDifficulty;
  outcome: RoundResult['outcome'];
  items: readonly ScoredItem[];          // prizes / gems delivered this try
  triesOnPrize: number;                  // bridge: tries spent on this box including this one
  progressGain: number;                  // bridge: progress after − before (0..1)
  touched: boolean;
  grip: GripSummary | null;
  /** 1 = no bonus; machines.dailyBonus when this machine is today's pick (presentation only). */
  dailyBonus: number;
}

export type RewardRule = 'perWin' | 'perTry' | { sessionScore: true } | 'none';

/* ---------------------------------------------------------------- genre + machine */

export interface GenreParams {
  classic: Record<string, never>;
  bridge: BridgeParams;
  ledge: LedgeParams;
  rush: RushParams;
}
export interface BridgeParams {
  gap: number; barRadius: number; barY: number; barFriction: number;
  box: Vec3; boxMass: number; boxFriction: number;
  startJitter: number; startYawDeg: number;
  liftDelta: number; clawForceScale: number; maxTriesPerPrize: number;
}
export interface LedgeParams {
  shelfY: number; shelfFront: number; lipHeight: number; shelfFriction: number;
  stacks: number; stackHeight: number; refillBelow: number; dropZ: number;
}
export interface RushParams {
  seconds: number; pieces: number; radiusScale: number; speedScale: number; rewardScore: number;
}

export interface GenreModule<G extends GenreId = GenreId> {
  readonly genre: G;
  readonly defaults: Readonly<GenreParams[G]>;
  readonly controls: 'joystick' | 'twoStep';
  readonly reward: RewardRule;
  /** Phases in which RoundMachine may award (classic: AWARD_PHASES, RoundMachine.ts:38). */
  readonly awardPhases: ReadonlySet<RoundPhase>;
  /** Several prizes per try (RoundMachine.awardItem). */
  readonly multiAward: boolean;
  geometry(p: GenreParams[G]): FieldGeometry;
  session(p: GenreParams[G]): SessionRule;
  /** Applied after the difficulty preset (classic: identity). */
  roundParams(base: RoundParams, p: GenreParams[G]): RoundParams;
  createRules(p: GenreParams[G], geometry: FieldGeometry): TryRules;
  createField(phys: PhysicsWorld, options: FieldOptions, p: GenreParams[G], geometry: FieldGeometry): MachineField;
  /** Pure points for one finished try (classic adapts scoreRound unchanged). */
  score(input: MachineScoreInput, streakBefore: number, p: GenreParams[G]): RoundScore;
}

export interface MachineDef<G extends GenreId = GenreId> {
  id: MachineId;
  genre: G;
  /** Lobby order. */
  order: number;
  /** Overrides on top of the genre defaults (a variant is just different numbers here). */
  params: Partial<GenreParams[G]>;
  /** Shown and playable. false while a workstream is still on it (lobby hides it, resolve falls back to classic). */
  available: boolean;
  /** With machines.unlock = 'progress': total collection wins needed. */
  unlockAfterWins: number;
}

/** A machine with settings overrides applied: what GameCore runs. */
export interface ResolvedMachine<G extends GenreId = GenreId> {
  def: MachineDef<G>;
  module: GenreModule<G>;
  params: GenreParams[G];
  geometry: FieldGeometry;
  session: SessionRule;
}
```

#### Registry: `src/game/machines/registry.ts`

```ts
export const GENRES: { [G in GenreId]: GenreModule<G> } = { classic: classicModule, bridge: bridgeModule, ledge: ledgeModule, rush: rushModule };
export const MACHINES: readonly MachineDef[] = [
  { id: 'classic', genre: 'classic', order: 0, params: {}, available: true, unlockAfterWins: 0 },
  { id: 'bridge',  genre: 'bridge',  order: 1, params: {}, available: false, unlockAfterWins: 1 },
  { id: 'ledge',   genre: 'ledge',   order: 2, params: {}, available: false, unlockAfterWins: 3 },
  { id: 'rush',    genre: 'rush',    order: 3, params: {}, available: false, unlockAfterWins: 5 },
];
/** `overrides` = Settings['machines'] (type-only import of settings/spec.ts, which the independence test allows). */
export function resolveMachine(id: string, overrides?: Settings['machines']): ResolvedMachine;  // unknown / unavailable → classic + warning
export function offeredMachines(s: Settings['machines'], wins: number): { id: MachineId; locked: boolean }[];
/** Lobby / 4A neighbouring cabinets: the machines before and after `id` in lobby order. */
export function neighbours(id: MachineId, offered: readonly MachineId[]): [MachineId | null, MachineId | null];
```

`Record<GenreId, …>` / mapped types appear in every layer: `GENRES`, `PILOTS` in `src/app/pilots/index.ts`,
`DRESSINGS` in `src/scene/machines/index.ts`, `GENRE_HUD` in `src/ui/machines/index.ts` and the guide's genre lines.
TypeScript therefore lists every place a new genre must fill.

### 1.4 How the existing classes change

| File | Change | Classic effect |
| --- | --- | --- |
| `src/physics/fieldSpec.ts` | **None.** FIELD / CHUTE / PRIZE_SENSOR / BIN / CLAW remain the classic constants that Cabinet, DemoPilot, the harness and the tests import. | none |
| `src/physics/PhysicsWorld.ts` | `PhysicsOptions.geometry?` (default `CLASSIC_GEOMETRY`). `buildCabinet()` becomes `buildField(geometry)`, which loops over `statics` (`addPart` = today's `addStatic` for boxes plus a capsule branch) and then creates one sensor per opening. `buildBin()` reads `geometry.bin` (walls, slope). The single `prizeSensor` becomes `sensors: Map<handle, PrizeOpening>`; `drainCollisionEvents` (390-396) tests membership in the map. New: `setGeometry(g)` (only with no toys: removes the field body and the bin body, clears `staticKinds`, rebuilds), `openingOf(toy)`, `addItem(spec, asset, pos, rot)` (the `addToy` body with the spec's damping / friction / restitution, sets `toy.item`). `isInPrizeSensor(toy)` keeps its name and means "any opening". `setToyFriction` (262-265) skips bodies with `item`. | identical Rapier call sequence |
| `src/physics/ClawRig.ts` | `limits: ClawLimits` (default classic) and `setLimits(l)`. `setTrolleyTarget` (237-242), `integrateTrolley` (341-348) and `reset` (531-534) clamp to `this.limits` instead of `CLAW.*`. | same numbers, same arithmetic |
| `src/physics/GripMonitor.ts` | **None.** Items are `ToyBody`s; `evaluate` reads `asset.footprint/size` (line 302), which `itemAsset()` fills from the `ItemSpec`. | none |
| `src/game/RoundMachine.ts` | `configure({ phases, multi })` replaces the module constant `AWARD_PHASES` (38) with an instance field (default the same set). New `awardItem(roundId, toyId, typeId)`: multi only; idempotent per (round, toyId); prize ids `${sid}-${rid}` then `${sid}-${rid}-2`, … `award` stays the *first* award; new `awards` getter. `awardPrize` (185-200) **unchanged**. | none |
| `src/game/RoundController.ts` | Constructor takes `rules: TryRules = new ClassicRules()`; `setRules()` works at a round boundary only. Call-site map below. New `inputLocked` flag (timed session over); classic never sets it. New event `itemScored { roundId, toy, value, opening }`. | code moved, same order |
| `src/game/ToyField.ts` | `implements MachineField` (type only). | none |
| `src/game/GameCore.ts` | `def: ResolvedMachine` (default classic), `rules`, `session: PlaySession`. `field` becomes `MachineField` (mutable). The constructor passes `def.geometry` to PhysicsWorld and `def.module.createField` (classic → `new ToyField`). New `setMachine(def, assets, seed)` (§3.2). `fixedStep` (48-56) gets **one first line**, `this.session.preStep(FIXED_DT, this.machine, this.controller)`, which returns at once for `open`. | none |
| `src/game/attract.ts` | `resetField()` (121-135): `const n = field.resetForTakeover?.(); if (n !== undefined) return n;` comes first, then today's loop. | method absent → today's loop |
| `src/game/scoring.ts` | `ScoreKeeper.settleScored(roundId, demo, round: RoundScore)` (same bookkeeping as `settle`, 184-204, without `scoreRound`). `useRecord(record, onPersist)` for a machine switch. `RoundScore` gains optional `items?`, `bonus?: { kind: 'dailyPick'; multiplier: number; points: number }` and `extra?: { label: string; points: number }[]`. Classic `settle` is unchanged and never sets them. | none |
| `src/core/types.ts` | `RoundResult` (47-73 of the file) gains optional `machineId?`, `items?: { toyId; typeId; kind; value; prizeId }[]`, `progress?`, `triesOnPrize?`. Classic results do not include them. | none |
| `src/core/contracts.ts` | `GuideFacts.machine?` (§3.9). `GUIDE_EVENT_TYPES` gains `'machine_selected' \| 'progress_made' \| 'time_low' \| 'session_over'`. | classic facts carry no `machine` key |

**RoundController call-site map.** These are mechanical edits; "→" means "replaced by".

| Today (src/game/RoundController.ts) | After |
| --- | --- |
| READY / ATTRACT: `claw.setTrolleyTarget(CLAW.homeX, CLAW.homeZ, …)` (161, 167) | `rules.home.x / .z` (classic: CLAW values); READY also calls `rules.beginTry(this)` after `grip.beginRound()` |
| LIFTING: `claw.setWinch(CLAW.ropeMin, liftSpeed)` (187) | `claw.setWinch(rules.liftTarget(this), liftSpeed)` |
| TRANSPORTING target (191-197) | `const t = rules.transportTarget(this, this.wasHolding); this.destinationIsChute = t.toChute; claw.setTrolleyTarget(t.x, t.z, t.speed)`. Classic: holding → `{ CLAW.dropX, CLAW.dropZ, moveSpeed × 0.92, true }`, else `{ home, moveSpeed × 1.15, false }` |
| Lost toy on the way home (357-361) | `rules.home` |
| SETTLING target (208) | `rules.home`; plus `if (rules.retractOnSettle) claw.setWinch(CLAW.ropeMin, liftSpeed)` |
| `this.checkPrize()` in LIFTING / TRANSPORTING / RELEASING / SETTLING (349, 356, 369, 375) | `this.rules.checkAwards(this, phase)` at the same four sites; DESCENDING / CLOSING sites only `if (rules.awardsDuringDescent)` |
| SETTLING finish block (376-388) | `if (this.rules.canFinish(this, m.phaseTime)) m.finish(this.buildResult())` (ClassicRules keeps `awardTime` and the exact code) |
| `this.checkStrays()` (394) | `this.rules.checkStrays(this)` |
| `forgetStrays()` (454) | delegates to `rules.forgetStrays()` |
| `buildResult()` end (491-505) | `const r = {…today…}; const x = rules.resultExtras?.(this, r); return x ? { ...r, ...x } : r;` |
| READY / AIMING input (250-278) | `if (this.inputLocked) { claw.setTrolleyVelocity(0, 0); this.grabQueued = false; break; }` at the top; `rules.filterInput` (if present) maps x / z and may set `grabQueued` |

`ClassicRules` (src/game/machines/classic.ts) holds the bodies of `checkPrize` (421-433) and `checkStrays`
(436-451), the strays `Set`, `awardTime` and the SETTLING logic, copied character for character. `RoundController`
keeps `findNearest`, `checkSlip`, the descent / landing logic and `buildResult`'s classic fields, because they are
genre-independent.

### 1.5 Keeping CLASSIC byte-identical

1. **Golden trace, recorded before any refactor.** The first commit adds `tests/unit/machines/classicGolden.test.ts`
   and generates a fixture `classicGolden.fixture.json` on today's `main`. The fixture holds:
   - `makeCore({ theme: 'sakura', seed: 7 })` and `{ theme: 'gpu', seed: 3 }`;
   - three `playRound`s at fixed aims (harness, tests/unit/game/harness.ts), including a centred win, an off-centre
     slip and an empty spot;
   - two attract demo rounds through `AttractDirector` + `DemoPilot`, and a takeover (`leave()`);
   - for each round, the full `RoundResult` JSON, the phase timeline, and a pose hash of every body every 30 steps
     (translations / rotations rounded to 1e-9 and folded with FNV-1a);
   - the `ToyField.fill` layout hash and the collider / body counts.

   Every scaffold step must reproduce the fixture **exactly**. Identity holds because the Rapier API calls happen in
   the same order with the same arguments and the same JS arithmetic runs. The step that touches the most (the
   RoundController seam) is a pure code move.
2. **Default everywhere is classic.** `GameCoreOptions.machine` is optional, `machines.current` defaults to
   `classic`, and the stubs for the other genres sit behind `available: false`.
3. **Classic code paths in the app stay as they are.** `Game.onPrizeExit`, `onResult` scoring, `requestReward`,
   `DemoPilot` and `ToyVisuals` run unchanged when `core.def.genre === 'classic'`. The new genres go through
   `MachineDirector`. Each branch is a one-line `if` added in the scaffold.
4. **Rendering:** the classic floor / chute / lower-cabinet blocks of `Cabinet.build` (src/scene/Cabinet.ts:274-280,
   306-377) move verbatim into `src/scene/machines/classicDressing.ts`. They are called at the same points in
   `build()`, so the merged geometry buckets fill in the same order. `tests/e2e/20-screenshots` (`PLUSH_SHOTS=1`) is
   the visual check.
5. **The whole existing e2e suite runs unchanged on the default.** No `?machine` means classic. This is the
   strongest compatibility guarantee.
6. **Known, documented non-identity.** Classic *after a visit to another machine in the same page load* is
   deterministic but not bit-identical with a fresh boot, because Rapier slots are reused after `setGeometry`.
   Rules, geometry and fairness are identical. A fresh page load, the idle-reset return and every test start from a
   fresh world. If bit-identity after switching is ever required, `setMachine` can rebuild the `PhysicsWorld` and
   the `ClawRig`, at the price of re-binding the claw visual. Not recommended now.

### 1.6 Session vs try (round)

| | Classic (`open`) | Bridge / Shelf (`persistent`) | Rush (`timed`) |
| --- | --- | --- | --- |
| Starts | START / takeover | START / takeover (field reset to the start pose) | START / takeover / PLAY AGAIN after the end; field reset (full pile); timer starts in the first READY |
| A try | READY → … → RESULT (unchanged) | same; the field stays exactly as physics left it | same, with faster claw parameters |
| Between tries | PLAY AGAIN; a miss auto-advances after 1.15 s (Game.ts:1429) | same; `triesOnPrize++` (reset when a prize drops) | auto-advance after 0.35 s, win or miss, while time remains |
| Field refill | `gameplay.restock` (Game.ts:933-953) | genre policy encoded in `field.missing()`: bridge, a new box after a drop; shelf, new stacks once ≤ `refillBelow` | none during a run; full reset on the next run |
| Timer | none (optional aim timer as today) | none | `seconds` on the **simulated** clock (pauses with dialogs and hidden tabs, identical in tests) |
| Ends | idle reset | idle reset; optionally `maxTriesPerPrize` triggers a staff reset of the box (never a free win) | time up (below) |
| Scored | per try (ScoreKeeper, unchanged) | per try (`settleScored`) | per try (`settleScored`); run total → ranking |

**Time up** (rush): `PlaySession.preStep` runs before `controller.preStep`.
- If the time runs out in **AIMING**, the grab is forced where the claw is (same rule as today's aim timer,
  RoundController.ts:265-273).
- If it runs out in **READY** (no move yet), the run ends and the controller is input-locked, so there is no wasted try.
- If it runs out while the claw is **busy**, the try completes and everything delivered before its RESULT counts
  ("last grab counts"). The run then ends at that RESULT.
- After `over`: the session result card, then initials if the score made the top 10, then PLAY AGAIN or START
  begins a new run.

The idle reset (Game.ts:615) and the attract takeover end any session. Demo rounds have **no session timer**: each
demo round is one try played by the pilot (`AttractDirector` is unchanged).

```ts
// src/game/machines/session.ts
export interface SessionSnapshot {
  id: number; machineId: string; rule: SessionRule; demo: boolean; active: boolean;
  tries: number; triesOnPrize: number; prizes: number; rawPoints: number;
  secondsLeft: number | null; timeUp: boolean; over: boolean;
}
export interface SessionSummary { machineId: string; sessionId: number; tries: number; prizes: number; rawPoints: number; seconds: number; lastRoundId: number }
export interface PlaySessionEvents extends Record<string, unknown> {
  started: SessionSnapshot;
  second: { secondsLeft: number };          // whole seconds, timed only
  timeUp: { phase: RoundPhase };
  over: SessionSummary;                      // never for demo
}
export class PlaySession {
  readonly events = new Emitter<PlaySessionEvents>();
  configure(rule: SessionRule, machineId: string): void;   // GameCore.setMachine
  begin(demo: boolean): void;                               // director: START / takeover / new run
  preStep(dt: number, m: RoundMachine, c: RoundController): void;   // 'open' → return
  onTryResult(r: RoundResult, rawPoints: number, prizeDropped: boolean): void;
  end(): void;                                              // idle reset / machine switch
  snapshot(): SessionSnapshot;
}
```

### 1.7 How the claw varies

There is one physical claw (`ClawRig`, three fingers, CLAW constants) for every machine. Each genre changes only the
numbers in the table below. Speed and force values multiply the difficulty preset's values, so Easy / Arcade / Skill
still matter.

| | move | descend | lift | clawForce | gripAssist | Lift rule | Transport rule | Home (x, z) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| classic | ×1 | ×1 | ×1 | ×1 | preset | full (ropeMin) | chute when holding, else home | 0.06, −0.40 |
| bridge | ×0.9 | ×0.8 | ×0.6 | ×`clawForceScale` 0.8 | **0** (pure friction) | partial: rope at close − `liftDelta` (0.08 m) | **in place** (the fingers open where the claw is) | 0.30, −0.18 (out of the way). With `twoStep`: −0.37, −0.13 |
| ledge | ×1 | ×1 | ×1 | ×1 | preset | full | **forward**: same x, z = `dropZ` (−0.29), always (caged items too) | 0.06, −0.20 |
| rush | ×`speedScale` 1.2 | ×1.25 | ×1.25 | ×1 | preset | full | **chute, always** (caged pieces travel too) | 0.06, −0.40 |

**A real claw variant is out of scope.** A two-prong arm, or more or fewer fingers, would mean generalising
`ClawRig`'s three-finger build (ClawRig.ts:147-190), `GripMonitor`'s `[number, number, number]` per-finger state
and part ids 0-2/3, and `ClawVisual`. That is about 4-6 engineer-days plus re-measuring every PHYSICS.md table.

The seam that *is* designed is `ClawAttachment`: an extra collider on the hub, e.g. a shallow scoop disc for gems.
It is added and removed by `ClawRig.setAttachments()` at `setMachine`. It is **only built if the rush sweep (§7.3)
misses its gate.** Cost: about 1 day.

### 1.8 Adding the 40th machine

- **A variant (the usual case): about 0.5-1 day including tuning and QA.**
  1. Add one id to `MACHINE_IDS`.
  2. Add one `MachineDef` with new `params`.
  3. Add three strings × three languages (`machine.<id>.name/tagline/howto`).
  4. Optionally override the lobby art colour.

  The contract test (§7.1) iterates `MACHINES`, so the new machine gets geometry validation, deterministic-fill,
  pilot-plays-10-tries and leak checks for free. Settings knobs are per genre, so they apply to the genre's
  variants as overrides of overrides; a variant that needs its own knob uses `params` only.
- **A new genre: about 8-12 engineer-days.** It needs a `GenreModule` (geometry, rules, field, score) and a pilot.
  The generic dressing (§4) draws its statics automatically from their `look`; a bespoke dressing is optional. It
  also needs item looks for `ItemVisuals`, a genre HUD widget (optional), guide lines and a `docs/machines/<genre>.md`.
  The `Record<GenreId, …>` tables make the compiler list every gap.

---

## 2. The new machines

Coordinates: +X right, +Y up, +Z towards the player. The floor top is y = 0, the inside of the front glass is
z = 0, the back is z = −0.8 and the walls are x = ±0.5 (fieldSpec.ts:10-19).

The claw reach is x ∈ [−0.37, 0.37] and z ∈ [−0.67, −0.13]. The open fingers reach r ≈ 0.10 m at the tips and
0.133 m at the elbows (computed from `CLAW.elbow/tip/openAngle`, fieldSpec.ts:82-87). Rope: 0.10-0.64 m from
`anchorY` 0.80.

### 2.0 Rules common to the new genres

- **Award window.** Bridge and shelf award in DESCENDING … SETTLING (`awardsDuringDescent: true`): a push during the
  descent is physics too. Rush also awards in DESCENDING … SETTLING. ATTRACT never awards (there is no round). Demo
  rounds award with `demo: true`, which is never persisted (RoundMachine already marks it, RoundMachine.ts:195).
- **Settle to calm.** `canFinish` waits until every item that moved this try is calm: speed < 0.02 m/s for 0.3 s,
  capped at 5 s, with the 7 s watchdog behind it. A box at rest is put to sleep by Rapier and does not fall by
  itself later.
- **Late falls.** In the rare case that an item reaches a sensor after the cap (still sliding), `checkAwards` runs
  again at the next try's DESCENDING and credits that try. Nothing is lost and nothing is double-counted (idempotent
  per body).
- **Refills never drop through.** Bridge and shelf refills are *placed at rest* (teleported onto bars / the shelf and
  settled, with the `restock` burst and a 0.22 s scale-in on the visual), never rained in like classic toys. Refills
  only happen at round boundaries, outside the award window, so a refill can never be a free prize.
- **No strays.** In these genres everything that falls into an opening counts (that is the genre), so `checkStrays`
  is a no-op. Classic keeps its stray rule.
- **What a body counts as**:

| Machine | Collection (`addPrize`) | Claim QR (src/rewards) | Points |
| --- | --- | --- | --- |
| classic | the plush, 1 per win (unchanged) | 1 per win (unchanged) | `scoreRound` (unchanged) |
| bridge | the printed character, 1 per box | **1 per box** (`perWin`), prizeId = printed character id | §2.1 |
| ledge | each item's printed character (N per try) | **1 per try with at least one item** (`perTry`). prizeId = the rarest item's character; prizeName = "Bunny +2" when more fell | §2.2 |
| rush | nothing (gems are points) | **none by default.** If `machines.rush.rewardScore` > 0: one per run at or above that score. prizeId `rush.score`, tier from score bands (≥1×: common, 2×: rare, 3×: epic, 5×: legendary) | §2.3 |

`rewards.mode` still gates by theme (src/rewards/policy.ts:21-35). The server dedups per (session, roundId), and
every rule above issues at most one code per round id, so the server needs no change. `prizeId` passes
`token(80)` in server/rewards/validate.ts:43. `collection.addPrize(typeId, prizeId, machineId)` additionally counts
`machineWins[machineId]` (new optional field; older stored data simply lacks it).

### 2.1 TIPPY BRIDGE (`bridge`)

A boxed prize (a box printed with one of the theme's characters) lies across two parallel steel bars over a pit. The
player nudges, lifts and turns it with the claw over several tries until it drops: between the bars, off a bar's
side, or after it tilts. Between tries the box stays exactly where physics left it.

#### Geometry (default `BridgeParams`)

| Part | Rapier | Where / size (m) | Friction / restitution | Look |
| --- | --- | --- | --- | --- |
| Floor around the pit | 4 fixed cuboids (`floorWithHole`) | full floor y ∈ [−0.06, 0] minus the pit x ∈ [−0.20, 0.20], z ∈ [−0.62, −0.18] | 0.95 / 0.02 | mat |
| Glass, back wall, ceiling | as classic (same 5 boxes) | — | as classic | (shell) |
| Bars | 2 capsules, `kind 'bar'`, axis z | centres (±0.087, `barY` 0.10, −0.40), radius 0.012, halfLength 0.255 (z −0.655 … −0.145). Inner gap between bar surfaces = `gap` 0.150 | `barFriction` 0.35 / 0.05 | chrome |
| Posts | 4 capsules, `kind 'post'`, axis y | (±0.087, 0.05, −0.655 / −0.145), r 0.010, halfLength 0.05, standing on the floor strips | 0.5 / 0.05 | chrome |
| End stops | 2 cuboids, `kind 'fence'` | x ∈ [−0.13, 0.13], y ∈ [0.06, 0.20], 10 mm thick at z = −0.645 and −0.155: the box cannot slide off the bar ends | 0.4 / 0.05 | acrylic |
| Side fences | 2 cuboids, `kind 'fence'` | x = ±0.205 (10 mm), y ∈ [0, 0.24], z ∈ [−0.64, −0.16]: anything leaving the bars sideways stays over the pit | 0.3 / 0.1 | acrylic |
| Opening `pit` | sensor | x ∈ [−0.20, 0.20], z ∈ [−0.62, −0.18], y ∈ [−0.30, −0.10]; awardComY −0.06; overMargin 0.02 | — | — |
| Bin / shaft | `BinSpec` x ∈ [−0.21, 0.21], z ∈ [−0.63, 0], walls left / right / back, slope 0.21 rad (12° down towards the glass) | Shaft walls from the layout's bin floor up to −0.06; the ramp brings the box to the front glass, visible below the floor line | wall 0.5 / 0.05, ramp 1.0 / 0 | velvet, cushion |
| Box | 1 dynamic body, roundCuboid | L × H × W = **0.24 × 0.10 × 0.13**, round 4 mm, mass `boxMass` **0.40 kg**, damping 0.35 / 2.2 (like toys) | `boxFriction` 0.6 / 0.03 | `bridgeBox` |
| Start pose | seeded | COM (0 ± `startJitter` 0.01, 0.1625, −0.40 ± 0.02), yaw ± `startYawDeg` 4° | — | — |

The box always straddles both bars at the start: its half-length 0.12 is greater than the bar offset 0.087 + 0.012.
The open claw is wider than the box is deep (W 0.13) but narrower than it is long. It cannot cage the whole box, but
a finger can hook under the 3.3 cm overhang at either end.

**Probe (Appendix B).** At rest the box is stable. Shifted 5-8 cm towards one bar, it tilts into a **wedged** pose
(COM height drops 0.5-1.7 cm and stays there). Shifted 10 cm, it tips over the bar. With the pit underneath, that is
a drop and therefore a win. These are exactly the intermediate states the genre is about.

#### Flow of a try

1. READY / AIMING (joystick; `twoStep` optional, see below).
2. DESCENDING, with classic landing detection.
3. CLOSING.
4. LIFTING to `rope at CLOSING − liftDelta`. The lift is partial: it raises one end and never carries the box away.
5. TRANSPORTING in place, which arrives at once.
6. RELEASING: the fingers open and the box drops back about 8 cm.
7. SETTLING: the cable winds up (`retractOnSettle`), the claw goes home, and the try waits for calm.
8. RESULT.

`gripAssist` is 0, so no spring ever holds the box (PHYSICS.md: "at gripAssist = 0 the game is pure rigid-body
physics").

#### Win rule (read from physics)

The box's COM is below −0.06, inside the pit footprint (±0.02), and any of its colliders is in the pit sensor
(`sensorHits` or `intersectionPair`, as in RoundController.ts:425-428), during DESCENDING … SETTLING. Then
`RoundMachine.awardPrize(roundId, box.id, printTypeId)` (single award per try), `box.inBin = true` and
`prizeDetected` is emitted. `resultExtras` sets:
- `outcome` to `won`, or to `empty` when the box did not drop. Every lift ends in an intended release, so `slipped`
  would be misleading here.
- `progress` (0..1), `triesOnPrize` and `items`.

**Progress (presentation and guide only)** = `max(shift, tilt, turn)`:
- **shift**: |COM.x| / bar offset;
- **tilt**: the box's pitch / 25°;
- **turn**: (L − span) / (L − gap), where span = L·|cos yaw| + W·|sin yaw|.

Each term is clamped to 0..1. It is read from the pose after SETTLING. It never decides anything.

#### Failure modes and anti-exploit

- **Wedged against a fence or between the bars.** If 3 consecutive tries move it less than 0.01 progress while the
  box is not resting on both bars, the HUD lights the **STAFF** button and the guide suggests it.
  `BridgeField.staffReset()` places the box back in its seeded start pose (counter `staffResets` feeds the seed).
  It is only available at a round boundary. It costs nothing and gives no advantage.
- **Lifting the whole box and dropping it from height.** Prevented by the partial lift, `gripAssist` 0 and the box
  mass. The sweep gate (§7.3) checks that a single lift almost never wins from the start pose (< 3 %).
- **Hammering the same spot.** Allowed; it is physics. **Re-rolling the start pose with idle / lobby / staff:** the
  start pose is deterministic per seed and reset count, and resetting only loses progress.
- **`maxTriesPerPrize`** (0 = unlimited, default). When set, the box is staff-reset after N tries. There is **never
  a pity win.**
- **Restock** places the new box on the bars at rest, outside the award window (§2.0).

#### Scoring (`scoreBridge`, pure)

| Case | Points |
| --- | --- |
| Box drops | base = `TIER_POINTS[tier(print)]` × 2 (a big prize) × difficulty; + tries bonus on base: 1-3 tries +50 %, 4-6 +25 %, 7-10 +10 %; + first catch +50 % base (as classic); no combo; × daily bonus |
| Try with progress gain ≥ 0.05 | 15 ("nudge") |
| Contact only | 5 |
| No contact | 0 |

#### Other per-machine hooks

- **Guide:**
  - `machine_selected` (goal: "tip the box into the pit");
  - `progress_made` (gain ≥ 0.05: "it's teetering, lift the high end");
  - `empty_grab` (no gain, with `facts.machine.progress`);
  - `prize_won` (`facts.machine.tries`);
  - `retry_prompt` and `idle_hint` as today.
- **Sounds and effects** (§3.10):
  - box on bars: `glass_tap` pitched 0.62 (metallic, through the new `against: 'bar'` impact kind);
  - drop: `chute_drop` + `playWin(theme, max(tier, 'rare'))` + `celebrate(max(tier, 'rare'))` at the pit centre;
  - the printed character's voice plays on the win only (slip voices are muted for boxes).
- **Pilot (`src/app/pilots/bridge.ts`)**:
  1. Read the box pose.
  2. Choose the end that is already further from the axis (it keeps walking the same way); on the first try, choose
     by seed.
  3. Aim at that end's overhang along the long axis: COM + axis·(L/2 − 0.015).
  4. Wait for calm (patience 2.5 s, like DemoPilot.ts:113-131) and grab.

  In `twoStep` mode, press button 1 until x is reached, then button 2.

  Demo drops celebrate as demo. The next player gets a fresh box (`resetForTakeover`).
- **Difficulty knobs:**
  - `gap` (0.13-0.18);
  - `barFriction`;
  - `boxMass`;
  - box size;
  - `startYawDeg`;
  - `liftDelta`;
  - `clawForceScale`;
  - `maxTriesPerPrize`;
  - plus the difficulty preset.

  Target band, measured by the sweep: median 4-8 tries per box with the pilot on Arcade, under 3 % one-try wins.
- **`twoStep` controls (optional, `machines.bridge.controls`)** are the classic UFO-catcher scheme:
  - button **1** held → trolley moves +x only;
  - on release, stage 2;
  - button **2** held → −z only;
  - on release, the claw drops automatically.

  `BridgeRules.filterInput` implements this headless. The deck shows two buttons instead of the joystick, through
  the 4A contract (§3.11). Default: `joystick`.

### 2.2 TUMBLE SHELF (`ledge`)

Stacks of small snack boxes stand on a raised shelf with a lip. The claw knocks, drags or carries them over the
edge into a trough. **Every item that falls into the trough counts**, and several per try are possible.

#### Geometry (default `LedgeParams`)

| Part | Rapier | Where / size (m) | Friction / rest. | Look |
| --- | --- | --- | --- | --- |
| Shelf block | fixed cuboid, `shelf` | x ∈ [−0.5, 0.5], z ∈ [−0.80, `shelfFront` −0.40], y ∈ [−0.06, `shelfY` 0.16] | `shelfFriction` 0.55 / 0.02 | deck |
| Lip | fixed cuboid, `lip` | x ∈ [−0.5, 0.5], z ∈ [−0.412, −0.400], y ∈ [0.16, 0.16 + `lipHeight` 0.014] | 0.4 / 0.05 | chrome |
| Front strip | fixed cuboid, `floor` | x ∈ [−0.5, 0.5], z ∈ [−0.16, 0], y ∈ [−0.06, 0] | 0.95 / 0.02 | mat |
| Trough guard | fixed cuboid, `fence` | z ∈ [−0.172, −0.160], y ∈ [0, 0.12], full width: items flying forward drop into the trough | 0.3 / 0.1 | acrylic |
| Glass, back wall, ceiling | as classic | — | — | — |
| Opening `trough` | sensor | x ∈ [−0.5, 0.5], z ∈ [−0.40, −0.172], y ∈ [−0.30, −0.10]; awardComY −0.06; overMargin 0.02 | — | — |
| Bin | x ∈ [−0.5, 0.5], z ∈ [−0.40, 0]; walls right + back (the left glass already goes below the floor); slope 0.17 rad | a full-width prize window below the floor line | — | velvet, cushion |
| Claw | classic limits, home (0.06, −0.20), drop z −0.29 | — | — | — |

#### Items

| Look | Size (m) | Mass | Print | Base points | Share |
| --- | --- | --- | --- | --- | --- |
| `snackS` | 0.055 cube, round 3 mm | 40 g | common / rare characters | 40 / 100 | 60 % |
| `snackM` | 0.075 × 0.06 × 0.05 | 60 g | any | × 1.25 | 30 % |
| `snackL` | 0.09 × 0.075 × 0.06 | 90 g | rare / epic / legendary | × 1.5 | 10 % |

All items use friction 0.6, restitution 0.05 and damping 0.3 / 1.5. Default layout: `stacks` 8 (a 4 × 2 grid at
x ∈ {−0.30, −0.10, 0.10, 0.30}, z ∈ {−0.47, −0.60}) × `stackHeight` 3, giving **24 items**, with seeded jitter of
±4 mm and ±6°. Rarity of prints follows `rarityOf` (src/game/rarity.ts) and is presentation only. The print mix
cycles through a seeded shuffle like `ToyField.nextAsset`. **Refill:** when the shelf holds ≤ `refillBelow` (10),
`missing()` asks for new stacks at the back row z −0.66, placed at rest, between tries only.

#### Win rule

Any item whose COM is below −0.06 over the trough and inside its sensor during DESCENDING … SETTLING is awarded:
- `RoundMachine.awardItem(roundId, item.id, printTypeId)` (multi; distinct prize ids);
- `item.inBin = true`;
- `prizeDetected` per item.

`resultExtras` sets `outcome: won` when at least one item was awarded and `items: […]`.

#### Failure modes and anti-exploit

- **Ploughing the whole front row in one go** is the genre. It is limited by the lip, the shelf friction and the
  stack layout. The multi-drop bonus is capped at ×2, and the QR is one per try.
- **Items lodged on the lip or against the trough guard top.** These are still on the field and reachable. The
  guard is lower (0.12) than the claw path.
- **Items behind the claw's reach** (z < −0.67, the back strip of the shelf): refill places stacks within reach.
  Items pushed back can be dragged forward.
- **An item that falls after the calm cap** is credited at the next try's DESCENDING (§2.0).

#### Scoring (`scoreLedge`)

- Per item: tier base (common 40, rare 100, epic 200, legendary 400) × size factor × difficulty, plus first catch
  +50 % of that item's base.
- Try subtotal × multi-drop bonus: 2 items ×1.2, 3 ×1.5, 4+ ×2.
- No combo across tries. × daily bonus.
- A try with no item: 0. The HUD shows "items on the edge" as feedback.

#### Other per-machine hooks

- **Guide:**
  - `machine_selected` ("push snacks over the lip, every one counts");
  - `progress_made` (an item now rests within 3 cm of the lip, `facts.machine.items` = items on the edge);
  - `prize_won` with `items` = n (lines differ for 1 and 2 or more);
  - `empty_grab` as today.
- **Sounds and effects:**
  - per item in the trough: `chute_drop` (volume 0.7) + `burst('drop', tier)` at the item; one `playWin` per try
    with the rarest tier, at RESULT;
  - a per-item "+N" popup at the opening, with the bonus popup at the end;
  - impacts on the shelf: `plush_land` pitched 1.2;
  - on the guard: `glass_tap`.
- **Pilot:**
  1. Choose the stack whose front item is closest to the lip.
  2. Aim at x = item.x, z = item.z + 0.04 (in front of it: the closing back finger drags it towards the lip).
  3. Wait for calm and grab.
  4. Every third round, aim at the stack top (to knock it over) instead.
- **Difficulty knobs:**
  - `lipHeight` (0-0.03);
  - `shelfFriction`;
  - stack count and height;
  - item mass and size mix;
  - `refillBelow`.

  Target band: 0.8-1.6 items per try on average for the pilot on Arcade, with at least 35 % of tries delivering 1 or
  more.

### 2.3 SPARKLE RUSH (`rush`)

A timed score attack: 75 s (45-120) of quick grabs in a pile of big gems and coins. Each piece through the classic
chute scores its value. A local top-10 ranking keeps initials.

#### Geometry

**`CLASSIC_GEOMETRY`, unchanged:** the same floor, chute, bin and claw limits. That makes rush the cheapest machine
and lets it reuse the classic dressing.

#### Pieces (default 44, from `pieces`; the mix scales proportionally)

| Look | Collider | Radius (m) | Mass | Value | Count |
| --- | --- | --- | --- | --- | --- |
| `gemEmerald` | 17-point brilliant hull (flat table, culet) | 0.034 × `radiusScale` | 30 g | 10 | 14 |
| `gemSapphire` | same | 0.036 | 32 g | 25 | 10 |
| `gemRuby` | same | 0.038 | 34 g | 50 | 6 |
| `gemDiamond` | same | 0.040 | 36 g | 150 | 2 |
| `coin` | cylinder, r 0.026, h 0.010 | — | 12 g | 5 | 12 |

The pieces are "giant gems": ping-pong-ball size, so a centred grab cages 1-3 of them. Friction 0.7, restitution
0.1. Placement: one layer on `isFreeSpot` cells (ToyField.ts:32), plus a few on top, settled off-screen.
**`gripAssist` stays as the difficulty preset**: the best-gripped piece may get the classic limited assist, and the
others ride along on friction.

#### Award rule

Every piece whose COM passes the chute sensor (COM below −0.06 over the chute, sensor hit) during DESCENDING …
SETTLING:
- emits `itemScored { roundId, toy, value }` (no collection prize, no `awardPrize` call);
- sets `inBin = true`;
- is removed at the round boundary (`clearBin`).

`resultExtras`: `outcome` is `won` if at least one piece scored (so hints and auto-advance read naturally), and
`items` lists the pieces.

#### Session

`timed`, `seconds` from settings. Timer start, time-up handling and the end are as in §1.6. After each RESULT the
next try starts after 0.35 s (no PLAY AGAIN). The run total is the sum of per-try raw points: value × difficulty,
before the daily bonus.

#### Ranking (`src/persistence/rankings.ts`)

- Storage: `rankings.<machineId>` = `{ version: 1, entries: { initials: string; score: number; at: number; difficulty: ScoringDifficulty }[] }`,
  at most 10 entries, sorted by score descending, then by earlier `at`.
- Sanitising: initials `/^[A-Z0-9]{1,3}$/`, else `???`; score an integer 0-9,999,999.
- Local only. Never written for demo runs. Cleared by *Reset scores*.
- Initials entry: three slots, ▲▼ per slot plus OK (touch) and the keyboard. A 30 s timeout saves `???`.
- A tiny blocklist of offensive 3-letter combinations is replaced by `???` (public booth).

#### Failure modes and anti-exploit

- **Mashing grab:** the cycle length is physical and the auto-advance is fixed, so nothing can be skipped.
- **Opening a dialog to "think":** physics and the timer pause together, which gains nothing beyond planning.
  `system.lockSettings` stops it on kiosks.
- **Pieces pushed into the chute by the descending claw count.** That is physics and belongs to the genre.
- **Demo runs** are never ranked.
- **Late falls** count for the next try, or are lost after the run ends. This is documented; it happens rarely
  because the last try still waits for calm.

#### Scoring (`scoreRush`)

- Per try: Σ value × difficulty; + 25 % "handful" bonus when 3 or more pieces score in one try; × daily bonus.
- The ranking uses the raw run total without the daily bonus, so different days stay comparable.

#### Other per-machine hooks

- **Guide.** Per-try chatter is suppressed. The guide speaks on:
  - `machine_selected`;
  - `time_low` (10 s left, once);
  - `session_over` (`score`, `rank`);
  - `prize_won` only for a handful of 3 or more;
  - `idle_hint` before the first move.
- **Sounds and effects:**
  - a piece into the chute: `sparkle` pitched by value + `score_count`, coins `score_count` pitched 1.25;
  - `burst('score', { color: gem colour })` at the chute;
  - the last 10 s: `countdown_tick` each second and LED pulses (`celebrate` energy);
  - time up: `start_game` pitched 0.8;
  - new #1: `jackpot` + `lightShow('jackpot')`; top 3: `celebrate('epic')`; top 10: `celebrate('rare')`.
- **Pilot:** maximise value / (1 + distance) with room around the piece, aim at its COM, patience 1.0 s.
- **Difficulty knobs:**
  - `seconds`;
  - `pieces`;
  - `radiusScale` (0.85-1.2);
  - `speedScale`;
  - the difficulty preset.

  Targets for the pilot on Arcade: at least 1.2 pieces per centred grab on average, at least 70 % of tries scoring
  1 or more, about 12-16 tries per 75 s run. If the sweep misses these, tune in this order: `radiusScale`, then
  `closeSpeed`, then the `ClawAttachment` scoop (§1.7).
- **Physics cost:** see Appendix B. A fully awake pile of 48 costs about 0.8-1.3 ms per step, and about 0.1 ms once
  asleep. Recommended: no more than 48 pieces (the `pieces` maximum is 60, with a warning above 48).

---

## 3. Lobby and flow

### 3.1 Screens and states

```
           ┌──────────── START / CTA (current machine, no lobby gate) ────────────┐
ATTRACT ───┤                                                                       ▼
 (current  └─ MACHINES chip ─► LOBBY ─pick X─► SWITCHING ─► pressStart() ─► READY on X
  or home)                       │ pick current / back ─► ATTRACT
READY / RESULT ─ deck MACHINES ─► LOBBY ─pick X─► SWITCHING ─► READY on X
                                     └ back ─► where it was (game paused while open: it is a modal)
busy try ─ MACHINES disabled (a pick from a stale UI is queued: "switches after this try")
RUSH run over ─► SESSION RESULT ─(top 10)─► INITIALS ─► SESSION RESULT ─ PLAY AGAIN ─► new run
```

- **LOBBY** (`ModalId 'lobby'`, `src/ui/machines/LobbyDialog.tsx`, built on `Modal`, which already lays out per
  `HudLayout`). It is a horizontal carousel of `MachineCard`s. Each card shows:
  - the name and tagline;
  - a genre SVG illustration in the theme palette (`src/ui/machines/art.tsx`, no new image assets);
  - "Best 12 400" (per-machine record) and "Prizes won here: 7" (`collection.machineWins`);
  - a **TODAY'S PICK ×1.5** ribbon;
  - a lock with "Win 3 more prizes" in progress mode;
  - "Playing now" on the current machine.

  Controls: joystick or arrows left / right to move the focus; DROP / Enter / tap to pick; Esc / back to close.
- **Layouts:**
  - desktop: 3 cards visible;
  - portrait 32": 1.3 cards, swipe;
  - **portrait 86": the cards and every button sit inside the 0.25-0.75 reach band**, measured on the box height in
    the simulated 9:16 frame (use `layout.safeTop/safeBottom`, DISPLAYS.md:36);
  - phone: a horizontal strip of 2.2 cards, targets at least 44 px.
- **SWITCHING:** the game pauses with reason `'theme'` (the existing curtain pause, Game.ts:960) and a
  `MachineCurtain` shows the machine name. It ends when the new machine is settled and its shaders are warm.
- **SESSION HUD** (`src/ui/machines/SessionHud.tsx`), by genre:
  - bridge: "Try 3" plus a 5-segment progress meter and the STAFF hint;
  - shelf: "Items 5" this session plus "+2" this try;
  - rush: a large mm:ss timer in the top bar (display only, so it may sit above the reach band) plus the run score.
- **SESSION RESULT** (`SessionResultCard.tsx`): total, best, rank, PLAY AGAIN. **INITIALS** (`InitialsEntry.tsx`) as
  in §2.3.

### 3.2 Switching machine: the sequence

1. The UI calls `settings.set('machines.current', id)`, exactly as the theme picker does (Dialogs.tsx:107).
2. `Game.onSettingsChanged` sees a committed `machines.current` diff → `pendingRebuild` (Game.ts:1225-1270) →
   `applyQueuedRebuild` at a round boundary → `MachineDirector.switchTo(id)`.
3. `switchTo(id)`:
   1. Pause.
   2. `def = resolveMachine(id, committed.machines)`.
   3. `core.setMachine(def, enabledAssets, seed)`:
      1. assert the round boundary (`atRoundBoundary`, RoundMachine.ts:110);
      2. `phys.removeAllToys()`;
      3. `phys.setGeometry(def.geometry)`;
      4. `claw.setLimits(def.geometry.claw)`, then `claw.reset(home)`;
      5. `machine.configure({ phases: module.awardPhases, multi: module.multiAward })`;
      6. `field = module.createField(…)`;
      7. `rules = module.createRules(…)`, then `controller.setRules(rules)` and
         `controller.setParams(module.roundParams(base, params))`;
      8. `session.configure(def.session, id)`;
      9. `field.fill(assets, seed)` and `settle(3)`.
   4. `rebuildScene` (Cabinet with the new dressing; ItemVisuals sync; ToyVisuals sync).
   5. Scores: `scores.useRecord(loadMachineScores(id), saveMachineScores(id, …))` (this also resets the session
      score).
   6. Pilot: `pilot = pilotFor(def.module.genre)`.
   7. `rewards.reset()`.
   8. `audio.playSfx('theme_sting')`.
   9. `await stage.warmUp()`.
   10. Guide: `machine_selected`.
   11. Unpause.
   12. If the switch was asked from attract, call `pressStart()`.

   The theme stays orthogonal: if both changed, the theme loads first, then the machine, behind one curtain.

### 3.3 Today's pick and unlocks

- `dailyPick(ymd, offered)`: FNV-1a over `plush:<YYYY-MM-DD>` (local date, computed in the app layer and passed in;
  the headless code never reads `Date`) modulo the number of offered, available machines. It is pure, deterministic
  and unit-tested.
- The bonus `machines.dailyBonus` (×1.5) multiplies the points of tries on that machine. It is presentation only;
  physics never sees it. It shows as a "TODAY'S PICK ×1.5" line in the breakdown (`RoundScore.bonus`). It is
  re-evaluated at each settlement, so it rolls over at midnight.
- `machines.unlock = 'open'` (default; kiosks should not lock content) or `'progress'`: a machine is playable when
  `collection.wins ≥ unlockAfterWins`. Classic and the home machine are always open.

### 3.4 Attract mode, demo and idle reset with several machines

- **Attract mode plays the current machine.** After an idle reset that is `machines.home` (default classic), because
  `machines.idleReturn = 'home'`. With `'stay'`, the machine the last player used is kept.
- **Idle reset** (Game.ts:615-636): everything it does today, then `director.onIdleReset()`. If the current machine
  is not home, it sets `machines.current = home`, and the switch runs during attract behind the curtain. Any session
  ends; the rush initials entry is abandoned (saved as `???` only if it was already confirmed).
- **Demo rounds:** `AttractDirector` is unchanged and starts demo rounds. `Game.update` calls `this.pilot` (now a
  `MachinePilot`: `{ reset(); update(core, dt) }`, which `DemoPilot` already satisfies structurally). Demo rounds
  award with `demo: true`: never collected, scored only on the demo track, no QR, not ranked.
- **Takeover** (`pressStart`, Game.ts:482-514): `attract.leave()` → `field.resetForTakeover()`. Bridge gets a fresh
  box in its start pose; shelf gets the full initial stacks; rush gets the full pile. Then `director.onStart()`
  begins the session.
- **Attract cycling** (`machines.attractCycle`, default **off**): after every `attractCycleRounds` (3) demo rounds,
  the attract mode switches to the next offered machine, but only while it is still in ATTRACT with no modal. It
  costs a curtain and a shader warm-up per switch, which is why it is off by default.

### 3.5 Persistence

| What | Key (`plush-portal/` prefix) | Shape | Notes |
| --- | --- | --- | --- |
| Current, home and options | `settings` (`machines.*`) | settings v1 | exported with the configuration; `sanitizeSettings` fills defaults for older files |
| Classic best / lifetime | `scores` | unchanged v1 | **untouched** (tests/unit/persistence/scores.test.ts stays valid) |
| Other machines' best / lifetime | `scores.<id>` | same v1 shape | `loadMachineScores(id)` maps `classic` to `scores` |
| Rankings | `rankings.<id>` | §2.3 | rush (any timed genre) |
| Collection | `collection/v1` | + optional `machineWins: Record<id, number>` | sanitised; older data has none |
| Field state | — | — | **not persisted** (a reload starts the start pose, like classic) |

### 3.6 Settings: exact `src/settings/spec.ts` additions

A new top-level section, placed after `rewards`. **No new tab:** the UI is a "Machines" section of the Gameplay
tab, so `tests/e2e/04-settings-dialog.spec.ts`'s tab list stays valid.

```ts
machines: {
  /** The machine on the floor. Like the theme it changes at the next round boundary. */
  current: en('classic', MACHINE_IDS, 'rebuild'),
  /** Where the idle reset returns to (and what the attract demo shows after it). */
  home: en('classic', MACHINE_IDS),
  /** 'home' = the idle reset switches back to `home`; 'stay' = keep the last machine. */
  idleReturn: en('home', ['home', 'stay'] as const),
  /** Machine ids hidden from the lobby; the home machine is always offered. */
  disabled: strList(16, 32),
  /** MACHINES button on the deck and in attract mode. Off = a single-machine kiosk. */
  lobby: bool(true),
  /** One offered machine per local calendar day earns a points bonus (presentation only). */
  dailyPick: bool(true),
  dailyBonus: num(1.5, 1, 3, 0.1, 'live', '×'),
  /** Attract mode walks through the offered machines. */
  attractCycle: bool(false),
  attractCycleRounds: num(3, 1, 10, 1),
  /** 'open' = every offered machine is playable; 'progress' = later machines unlock with collected prizes. */
  unlock: en('open', ['open', 'progress'] as const),
  bridge: {
    gap: num(0.15, 0.13, 0.18, 0.005, 'rebuild', 'm'),
    barFriction: num(0.35, 0.1, 0.9, 0.05, 'rebuild'),
    boxMass: num(0.4, 0.2, 0.8, 0.05, 'rebuild', 'kg'),
    liftDelta: num(0.08, 0.03, 0.2, 0.01, 'round', 'm'),
    /** 0 = unlimited; otherwise the box is reset (never awarded) after this many tries. */
    maxTriesPerPrize: num(0, 0, 50, 1, 'round'),
    controls: en('joystick', ['joystick', 'twoStep'] as const, 'round'),
  },
  ledge: {
    lipHeight: num(0.014, 0, 0.03, 0.002, 'rebuild', 'm'),
    stacks: num(8, 4, 10, 1, 'rebuild'),
    stackHeight: num(3, 2, 4, 1, 'rebuild'),
    refillBelow: num(10, 0, 30, 1, 'round'),
  },
  rush: {
    seconds: num(75, 45, 120, 5, 'round', 's'),
    pieces: num(44, 24, 60, 2, 'rebuild'),
    radiusScale: num(1, 0.85, 1.2, 0.05, 'rebuild'),
    /** Run score that earns a claim QR; 0 = never (default). Presentation / rewards only. */
    rewardScore: num(0, 0, 20000, 100, 'live'),
  },
},
```

`MACHINE_IDS` is imported from `src/game/machines/ids.ts`, a pure constant. Physics knobs are `round` or `rebuild`,
never `live`. Extend the regex in `tests/unit/settings/spec.test.ts:197-200` to `^machines\.(current|bridge\..*|ledge\..*|rush\.(seconds|pieces|radiusScale))$`.

### 3.7 Launch parameter and debug API

- `?machine=<id>`: `readLaunchParams` (src/app/launch.ts) gains `machine: MachineId | null`. `createApp` calls
  `state.set('machines.current', id)` next to `?theme` (src/app/bootstrap.ts:38). It is persisted like `?theme`. An
  unknown or unavailable id is ignored with a log line.
- `window.__plush` additions (Game.ts:1659-1740). Like every other entry they are wrapped with `idle.touch()`:

```ts
machine: () => ({ id, genre, available, controls, session: core.session.snapshot(), state: core.rules.debugState?.() ?? null }),
selectMachine: (id: string) => Promise<boolean>,     // resolves when the switch finished (false if refused)
machineAction: (a: 'staff') => boolean,
setSessionSeconds: (s: number) => void,              // timed runs: set the remaining simulated time (tests)
rankings: (id?: string) => RankEntry[],
dailyPick: () => string | null,
clawLimits: () => ClawLimits,                         // `claw: CLAW` stays (classic constants) for old specs
```

### 3.8 i18n keys (`src/i18n/strings/machines.ts`, en / zh / ja)

```
machine.<id>.name  machine.<id>.tagline  machine.<id>.howto            (classic, bridge, ledge, rush)
lobby.title  lobby.open  lobby.play  lobby.back  lobby.current  lobby.todaysPick  lobby.bonus ({n})
lobby.best ({points})  lobby.prizes ({n})  lobby.locked ({n})  lobby.switching ({name})  lobby.afterTry
hud.machines  hud.staff  hud.staff.hint  hud.tries ({n})  hud.items ({n})  hud.itemsTry ({n})  hud.progress
hud.timeLeft ({s})  session.start  session.timeUp  session.over  session.total ({points})  session.best ({points})
session.again  rank.title  rank.enter  rank.new  rank.position ({n})  rank.none  rank.ok  rank.skip
result.bridge.won  result.bridge.moved ({cm})  result.bridge.still  result.ledge.items ({n})  result.rush.pieces ({n})
score.dailyPick  score.handful  score.multiDrop ({x})  score.triesBonus
toast.machineFailed  toast.staffReset  toast.machineQueued
set.section.machines  set.machines.<field>  set.machines.<field>.hint  set.machines.<field>.o.<value>
set.machines.bridge.<field> …  set.machines.ledge.<field> …  set.machines.rush.<field> …
status.<genre>.<phase>      (deck status line overrides; falls back to today's keys)
```

The key conventions follow the existing `set.<section>.<field>` / `.o.<option>` pattern
(tests/unit/core/round2Ids.test.ts:38-40). Add an analogous `machineIds.test.ts` that checks every machine id has
`machine.<id>.name/tagline/howto` in all three languages, and run the completeness test
(`tests/unit/i18n/completeness.test.ts`).

### 3.9 Guide contract (src/ai)

```ts
// GuideFacts (src/core/contracts.ts) – only present when the genre is not classic
machine?: {
  id: string;                         // 'bridge'
  genre: 'bridge' | 'ledge' | 'rush';
  name: string;                       // localised machine name (the guide's language)
  tries?: number;                     // tries on this prize (bridge) / this session (ledge)
  progress?: number;                  // 0..1, bridge
  items?: number;                     // delivered this try (ledge, rush) or "on the edge" (progress_made, ledge)
  score?: number;                     // run score (rush)
  secondsLeft?: number;               // rush
  rank?: number | null;               // rush, 1..10
} | null;
```

- **New event types.** `machine_selected` (priority 2, cooldown 1.2 s), `progress_made` (2, 8 s), `time_low`
  (3, 0 s, once per run), `session_over` (3, 0 s). They go into `GUIDE_PRIORITY` and `GUIDE_COOLDOWN_MS`
  (src/ai/GuideDirector.ts:44-72) and `EVENT_TASKS` (src/ai/prompt.ts:107), plus one "machine context" sentence in
  the prompt when `facts.machine` is set.
- **Server.** `server/schemas.ts` `FactsSchema` gains
  `machine: z.strictObject({ id: text(32), genre: z.enum(['bridge','ledge','rush']), name: text(AI_LIMITS.maxToyNameChars), tries: int 0..100000 opt, progress: 0..1 opt, items: int 0..500 opt, score: int 0..1e8 opt, secondsLeft: 0..600 opt, rank: int 1..10 nullable opt }).nullable().optional()`.
  The top level is non-strict (unknown keys are stripped, schemas.ts:1-5), so an older server simply drops the field.
- **Local lines.** New keys `machine.intro.<genre>`, `progress.bridge`, `progress.ledge`, `time.low`,
  `session.over`, `session.record`, `win.bridge`, `win.ledge.many`, `win.rush.handful`, `empty.bridge`.
  `src/ai/lines/index.ts` gains a theme-neutral bank `lines[key]['*']` as a fallback in the lookup (line 157). Without
  it, `tests/unit/ai/lines.test.ts:117-131` (≥2 candidates per event × theme × language) would demand 5 × 3 × 2
  lines per key. With the neutral bank: about 10 keys × 3 languages × 3 lines ≈ 90 lines.
- **Emission policy** lives in the director, per genre (rush suppresses per-try lines, §2.3). Classic emits exactly
  as today.

### 3.10 Sound and effects mapping (`src/app/machineSfx.ts`, no new audio assets this round)

| Moment | SFX (existing names, src/core/contracts.ts SFX_NAMES) | FxApi |
| --- | --- | --- |
| Box / item hits a `bar` / `post` | `glass_tap` pitch 0.62 | — |
| Item hits `shelf` / `lip` / `fence` | `plush_land` pitch 1.2 / `glass_tap` | — |
| Bridge box drops | `chute_drop`, `playWin(theme, ≥rare)`, character `win` voice | `celebrate(≥rare, pit)` |
| Shelf item into trough | `chute_drop` (0.7) per item; `playWin(rarest)` once at RESULT | `burst('drop', tier)` per item |
| Gem / coin into chute | `sparkle` (pitch by value) + `score_count`; coin `score_count` 1.25 | `burst('score', { color })` |
| Rush last 10 s / time up | `countdown_tick` / `start_game` pitch 0.8 | LED pulse via `celebrate` energy |
| New record #1 / top 3 / top 10 | `jackpot` / `firework` / `sparkle` | `lightShow('jackpot')` / `celebrate('epic')` / `celebrate('rare')` |
| Staff reset | `restock_drop` | `burst('restock')` |

`Game.updateAudio`'s impact mapping (Game.ts:1531-1535) consults `machineSfx.impact(against, toy.item)`. Optional
later work: dedicated `box_thud`, `gem_clink` and `timer_buzzer` SFX. Each needs a synthesised fallback in
`tools/audio/bake.ts` and a manifest entry, about 0.5 day.

### 3.11 Contract with workstream 4A (joystick, deck, negative space)

- **Input:** the joystick sets `RoundController.inputX/inputZ` ∈ [−1, 1]. This is unchanged and valid for every
  genre. The diagonal normalisation stays in RoundController.ts:255-262.
- **Deck row:** 4A renders the row (leave machine / call staff / inventory / settings). It reads a hook,
  `useMachineDeck()` from `src/ui/machines/deck.ts` (owned by W4), which returns:
  `{ lobby: { visible, enabled, onPress }, staff: { visible, highlighted, onPress }, controls: 'joystick' | 'twoStep', onStep(1|2, pressed) }`.
  Test ids: `menu-machines`, `menu-staff`, `step-1`, `step-2`. 4A owns `Hud.tsx`; W4 never edits it. If 4A cannot
  render `twoStep`, bridge keeps `joystick` (the default).
- **Status line:** Hud's status text uses `statusKey(genre, phase)` from `src/ui/machines/deck.ts`. This is a
  one-line change in Hud, done by 4A.
- **Neighbouring cabinets (optional synergy):** `neighbours(id, offered)` from the registry and
  `buildDiorama(def, tier)` from `src/scene/machines/dioramas.ts` (W5) give 4A low-poly static dioramas of the
  previous and next machines to show beyond the side glass.
- **Cabinet.ts and Stage.ts:** the scaffold moves the classic field blocks out of `Cabinet.build` into
  `src/scene/machines/classicDressing.ts` **in one early commit that 4A rebases on**. From then on, 4A edits the
  shell (frame, ceiling, gantry, neighbours, glass) and W5 edits only `src/scene/machines/*` and `ItemVisuals.ts`.

---

## 4. Rendering

### 4.1 Cabinet split

`Cabinet` (src/scene/Cabinet.ts:182) gains a constructor argument `dressing: FieldDressing` (from
`src/scene/machines/index.ts`, keyed by genre):

```ts
export interface FieldDressing {
  /** The play floor with its openings (classic: the two mat boxes, lip, LED strip, Cabinet.ts:274-280). */
  floor(b: Builder, ctx: DressingContext): void;
  /** Furniture above the floor: chute guard and sign (classic, 306-317) / bars, posts, fences / shelf, lip, guard. */
  furniture(b: Builder, ctx: DressingContext): void;
  /** Below the floor: shaft, bin floor, fascia panels, badge, decals (classic, 319-377), driven by geometry.bin. */
  lower(b: Builder, ctx: DressingContext): void;
}
export interface DressingContext { geometry: FieldGeometry; layout: WindowLayout; mats: CabinetMaterials; theme: ThemeDef; detail: DetailLevel; box(...): BufferGeometry; radial: number; decal(...): void; rng: () => number }
```

- Classic uses `classicDressing`: the existing statements, moved verbatim, called from the same three places in
  `build()`.
- Rush uses `classicDressing` (same geometry).
- Bridge and shelf use `genericDressing` (draws every `StaticPart` from its `look`: mat → `M.mat`, chrome →
  `M.chrome` cylinders / boxes, acrylic → `M.acrylic` with the classic acrylic render order, dark collar around each
  opening) plus a small bespoke extra each (bar end caps, a shelf LED strip, the "PRIZE" arrow over the opening).
- `Builder` is exported from `Cabinet.ts`, which is the one structural edit the scaffold makes.
- **`lowerCabinet(bin)`** generalises the classic lower block to any `BinSpec`: a fascia panel left of the shaft
  whenever there is room (classic: only in landscape, unchanged condition), a body panel with badge to the right,
  and a sloped cushion when `slope > 0`. A full-width shelf shaft gets a full-width prize window with centred decals.

### 4.2 Per machine

| Machine | Static meshes (merged by material, like today) | Dynamic (ItemVisuals) |
| --- | --- | --- |
| classic | unchanged | — (plush via ToyVisuals) |
| bridge | mat floor with pit (4 boxes), dark collar, 2 chrome bars (CylinderGeometry, radial segments by tier, as `this.radial`), 4 posts, 2 end stops and 2 side fences (acrylic), velvet shaft, sloped cushion, centred lower window | `bridgeBox`: a RoundedBoxGeometry (bevel by tier). Character portrait on ±Z faces, name plate on ±X, theme pattern on top (print atlas). **Window box option (Medium and up):** a clear front panel and the character's LOD2 mesh inside, parented to the box pose (about 1.7 k triangles; Safe shows the print only) |
| ledge | shelf block (enamel front, mat top, LED strip), chrome lip, acrylic trough guard, dark trough collar, full-width shaft and lower window | `snackS/M/L`: **one InstancedMesh per look** (3 meshes, 24-40 instances) with a per-instance `aCell` attribute that offsets UVs into the print atlas (`onBeforeCompile` patch of the cabinet's standard material) |
| rush | classic dressing | `gem*`: one InstancedMesh per look (4), faceted 48-triangle brilliant, MeshStandardMaterial with clearcoat and env map, emissive sparkle tied to `fxIntensity`; **no `transmission`** (it costs an extra render pass in three.js). `coin`: one InstancedMesh (gold, 64 triangles) |

### 4.3 ItemVisuals and the print atlas

- `src/scene/ItemVisuals.ts` follows the `ToyVisuals` interpolation pattern (ToyVisuals.ts:415-430: prev/current
  pose, slerp by `alpha`), with this API:
  - `sync(bodies)` and `update(alpha, dt)`;
  - `positionOf(toy, out)`;
  - `contactObjects()` and `changed` (so the contact-shadow pass, src/scene/contactShadows.ts, re-renders when items
    move; boxes on bars must not look like they float);
  - `warmUpObjects()`;
  - `setPrintAtlas(atlas)`, `setQuality(q)` and `dispose()`.
- `ToyVisuals.sync` (ToyVisuals.ts:234) adds `if (toy.item) continue;`. Items never get plush visuals, deformers or
  fur shells.
- `src/scene/machines/printAtlas.ts` builds one CanvasTexture per theme from `ui.thumbnails` (data URLs, already
  rendered at boot by Game.queueThumbnails, Game.ts:1624-1640). The layout is a grid of cells, one per character, each
  with the portrait, the name in `deps.font` and a theme border from `texgen`. Until the thumbnails arrive it falls
  back to palette colour plus initial, and redraws when they do. Size: 512² on Safe, 1024² on Medium / High, 2048² on
  Ultra.
- Graphics never reach the simulation. Items' physics comes from `ItemSpec`; LOD, window boxes and atlas size are
  presentation only.

### 4.4 Budgets (Medium, 1280 × 720, all passes; current classic: 228-457 k triangles, 118-152 calls, PERFORMANCE.md:322-330)

| Machine | Triangles (estimate) | Draw calls vs classic | Notes |
| --- | --- | --- | --- |
| bridge | 150-200 k (no 18-plush field; window box +1.7 k + 3 passes) | −10 … −15 | far under the 470 k budget |
| ledge | 160-210 k (24-40 boxes × ~44 triangles × 3 passes ≈ 5 k) | −10 | atlas 1024² ≈ 5.6 MB GPU with mipmaps |
| rush | 170-220 k (48 pieces × 48-64 triangles × 3 passes ≈ 9 k) | −10 | the env-map reflections are the visual cost, not triangles |

**Gate:** the integration measures each machine with the round-3 method (PERFORMANCE.md:313-320: wrap the shadow /
contact passes, read `renderer.info`) in the attract, ready and held states. Each must stay under 470 k on Medium.
Physics: the per-step median stays below 0.5 ms headless at rest and below 1.5 ms with an awake pile (Appendix B).

---

## 5. Migration plan

### 5.1 Ordered steps (green after each)

| # | Step | Green check |
| --- | --- | --- |
| 0 | **Golden fixture** on today's code: `tests/unit/machines/classicGolden.test.ts` + fixture (§1.5). Tests only. | unit |
| 1 | `src/physics/fieldGeometry.ts` with `CLASSIC_GEOMETRY` + `validateGeometry`; unit test: CLASSIC_GEOMETRY equals the numbers derived from fieldSpec. `PhysicsWorld` builds from it (buildField / buildBin from data; openings map). | golden, unit |
| 2 | `src/physics/items.ts`, `ToyBody.item?`, `PhysicsWorld.addItem`, extended `StaticKind`, `setToyFriction` skips items, `ToyVisuals.sync` skips items. | golden, unit, typecheck |
| 3 | `ClawRig.limits` + `setLimits`. | golden |
| 4 | `RoundMachine.configure` + `awardItem` + `awards`; new RoundMachine tests. | golden, RoundMachine.test unchanged and passing |
| 5 | `src/game/machines/{ids,types,classic,registry,session}.ts`; RoundController rule seam (verbatim move into `ClassicRules`); `GameCore.def/rules/session/setMachine`; `MachineField`; `attract.ts` hook; ScoreKeeper `settleScored/useRecord`; `RoundResult` optional fields; genre stubs (`available: false`, classic-clone modules) so the registry is complete. | golden, **full unit** (953+ tests), typecheck |
| 6 | App, UI and contracts: the settings section, `?machine`, the gameStore `machine` slice + `sessionResult` + `rankEntry` + `ModalId 'lobby'`, `MachineDirector` (classic pass-through), `src/app/pilots/index.ts`, `Game.ts` hooks (§6.1), Cabinet dressing extraction (verbatim), `ItemVisuals` (minimal: plain boxes / spheres from `ItemSpec.size`), guide types + tables + neutral-bank fallback + placeholder lines, server facts schema, `machines.ts` strings (EN + provisional zh / ja), debug API additions. | unit, typecheck, `npm run build`, **e2e smoke**: 01, 02, 06, 07, 19, 21, 22, 25-gtc-dialogue, 26 (≈ 35-45 min on this machine) |
| 7 | Workstreams in parallel (§6.2). Each genre stays `available: false` on `main` until its gates pass. | each workstream: unit + its own spec |
| 8 | Integration: flip `available: true` per machine once the contract test, genre tests, sweep gates, its e2e spec and the perf gate pass; full e2e twice; `PLUSH_SHOTS=1` screenshots. | full suite |
| 9 | Docs: `docs/MACHINES.md` (new), plus updates to ARCHITECTURE (modules, round/session), PHYSICS (genres, sweeps), SETTINGS (`machines`), REWARDS (table §2.0), AI (events / facts), PERFORMANCE (budgets per machine), DISPLAYS (lobby layout), E2E_RESULTS. | — |

### 5.2 Existing tests that must change (everything else is unchanged by design)

| Test | Change | Why |
| --- | --- | --- |
| `tests/unit/game/harness.ts` | additive `machine?: MachineId` in `CoreOptions` | genre tests reuse `playRound` / `inspectWorld` |
| `tests/unit/settings/spec.test.ts:197-200` | extend the "never live" regex to `machines.*` physics knobs | keep the authoritative rule enforced |
| `tests/unit/ai/lines.test.ts`, `tests/unit/ai/brandLines.test.ts` | the `variants(type, lang)` helper returns facts with `machine` for the 4 new event types | they iterate `GUIDE_EVENT_TYPES` (lines.test.ts:121, brandLines.test.ts:85) |
| `tests/unit/server/schemas.test.ts` | cases for `facts.machine` (accepted / strict / stripped) | new field |
| `tests/e2e/03-safe-zone.spec.ts:4` | `HUD` id list adds `menu-machines` | already changing in 4A (joystick replaces `dpad`/`dir-*`) |
| `tests/e2e/helpers.ts` | `BootOptions.machine?` → `?machine=` in `url()` | new specs |
| `tests/unit/scene/toyVisuals.test.ts` | one added case: items are skipped | new branch |

Explicitly **unchanged**:
- `independence.test.ts` (it covers `src/game/machines` automatically);
- `RoundMachine.test.ts` (`awardPrize` unchanged);
- `rounds.test.ts`, `ToyField.test.ts`, `attract.test.ts`, `demoPilot.test.ts`;
- `scores.test.ts` (classic key unchanged);
- `04-settings-dialog.spec.ts` (no new tab);
- `19-stability.spec.ts` (classic; a per-machine variant is a new spec);
- `tools/dev/grip-sweep.ts`.

---

## 6. Parallel implementation split

### 6.1 The scaffold (lead, committed first, steps 0-6)

The shared contracts, frozen at the end of the scaffold:
- `src/physics/fieldGeometry.ts` and `src/physics/items.ts`;
- `src/game/machines/{ids,types}.ts`;
- `src/game/machines/session.ts` (complete for all three kinds, with tests);
- `src/game/machines/registry.ts` (all four ids; stubs for bridge / ledge / rush);
- `RoundControllerEvents.itemScored`, `RoundResult` extras, `GuideFacts.machine` and the event types;
- the settings `machines` section (exact as in §3.6);
- the gameStore slices:

```ts
machine: {
  id: MachineId; genre: GenreId; controls: 'joystick' | 'twoStep'; switching: boolean;
  offered: { id: MachineId; locked: boolean }[]; dailyPick: MachineId | null; dailyBonus: number;
  tries: number; triesOnPrize: number; progress: number | null; itemsThisTry: number; itemsSession: number;
  session: { kind: 'open' | 'persistent' | 'timed'; secondsLeft: number | null; over: boolean; points: number };
  staff: { available: boolean; highlighted: boolean }; lobbyButton: boolean;
};
sessionResult: { machineId: MachineId; points: number; rawPoints: number; best: number; rank: number | null; tries: number } | null;
rankEntry: { machineId: MachineId; score: number; position: number; deadline: number } | null;
```

- the `MachineDirector` public surface (bodies classic pass-through):

```ts
export interface MachineHost {          // implemented by Game (narrow, so W4 can unit-test the director)
  core(): GameCore; ui: GameStore; settings: SettingsStore; collection: CollectionStore; audio: AudioPort;
  scores: ScoreKeeper; rewards: RewardFlow; library: PlushLibrary;
  emitGuide(type: GuideEventType, result?: RoundResult): void; burstAt(...): void; celebrate(tier, pos): void;
  toScreen(pos): { x: number; y: number } | null; addPopup(at, award: ScoreAward): void; toast(key, params?): void;
  rebuildScene(): void; warmUp(): Promise<void>; setPaused(reason: 'theme', on: boolean): void; pressStart(): void;
}
export class MachineDirector {
  constructor(host: MachineHost);
  get def(): ResolvedMachine; isClassic(): boolean; pilot(): MachinePilot;
  switchTo(id: MachineId): Promise<void>;
  onPrize(e: { roundId: number; toy: ToyBody }): void;      // non-classic prizeDetected
  onItemScored(e: { roundId: number; toy: ToyBody; value: number }): void;
  onSlipped(e: RoundControllerEvents['slipped']): boolean;   // true = handled (classic: false)
  onResult(r: RoundResult): void;                            // non-classic scoring / reward / guide
  autoAdvance(r: RoundResult): number | null;               // seconds; null = wait (classic: 1.15 after a miss)
  onStart(): void; canContinue(): boolean; onIdleReset(): void; onDemoEnded(): void;
  action(a: 'staff' | 'lobby'): boolean; stepInput(step: 1 | 2, pressed: boolean): void;
  facts(): GuideFacts['machine']; publish(): void;
}
```

- `src/ui/machines/deck.ts` (the 4A hook, §3.11) and `src/scene/machines/index.ts` (the `FieldDressing` interface
  plus `classicDressing`).

**`Game.ts` hooks in the scaffold.** These are the only Game.ts edits outside W4:
1. `GameCore` options get `machine` (Game.ts:235).
2. `bindCore`: `prizeDetected` → `isClassic ? onPrizeExit : director.onPrize`; `itemScored` → director; `slipped` →
   `director.onSlipped(e) || classic`; `result` → classic `onResult`, else `director.onResult` (Game.ts:653-774).
3. `afterRoundBoundary`: non-classic → `restockQueue = field.missing()` (Game.ts:943-947).
4. `applyQueuedRebuild`: machine diff → `director.switchTo` (Game.ts:955).
5. `updateFlow`: `director.autoAdvance(result)` in RESULT (Game.ts:1423-1433).
6. `pilot` becomes `director.pilot()` (Game.ts:114, 1333, 1684).
7. `facts()`: `facts.machine = director.facts()` when non-classic (Game.ts:1038).
8. `idleReset` → `director.onIdleReset()` (Game.ts:615).
9. `pressStart` → `director.onStart()` (Game.ts:482).
10. `EXIT_POS` → `openingCenter(core.def.geometry.openings[0])` (Game.ts:88).
11. Impact sound through `machineSfx` (Game.ts:1531).
12. `itemVisuals` sync / update next to `toyVisuals` (Game.ts:1360, 359-364).
13. The debug API additions.

The scaffold also brings the classic contract test, the golden test, `session.test.ts` and a minimal
`machineDirector.test.ts`.

### 6.2 Workstreams and exact file ownership (after the scaffold)

| WS | Scope | Owns (only this WS edits these files) | Depends on |
| --- | --- | --- | --- |
| **W1 Bridge** | geometry, BridgeRules (partial lift, in-place, progress, stuck, `filterInput` for twoStep), BridgeField (start pose, staff reset, at-rest restock), scoreBridge, pilot, sweep | `src/game/machines/bridge.ts`, `src/app/pilots/bridge.ts`, `tests/unit/machines/bridge.test.ts`, `tools/dev/machine-sweep.ts` (shared runner, created by W1), `tools/dev/sweeps/bridge.ts`, `docs/machines/bridge.md` | scaffold |
| **W2 Shelf** | geometry, LedgeRules (forward drop, multi-award), LedgeField (stacks, refill), scoreLedge, pilot, sweep | `src/game/machines/ledge.ts`, `src/app/pilots/ledge.ts`, `tests/unit/machines/ledge.test.ts`, `tools/dev/sweeps/ledge.ts`, `docs/machines/ledge.md` | scaffold; W1's sweep runner (a plain CLI; until it lands, use harness `playRound`) |
| **W3 Rush + timed + rankings** | RushRules (itemScored, chute always), RushField (pile, takeover reset), scoreRush, `PlaySession` timed details, rankings store, pilot, sweep, `ClawAttachment` only if the gate fails | `src/game/machines/rush.ts`, `src/game/machines/session.ts` (after the scaffold), `src/persistence/rankings.ts`, `src/app/pilots/rush.ts`, `tests/unit/machines/{rush,session}.test.ts`, `tests/unit/persistence/rankings.test.ts`, `tools/dev/sweeps/rush.ts`, `docs/machines/rush.md`, (contingency) `src/physics/ClawRig.ts` `setAttachments` | scaffold |
| **W4 Lobby, flow, HUD, settings UI, strings, e2e** | MachineDirector (switching, per-genre fx/sfx/popups via `machineSfx`, `settleScored`, rewards rules, guide emission policy, daily pick, unlocks, idle return, attract cycle, rank entry flow), lobby / session UI in 4 layouts, Gameplay-tab Machines section, the deck hook, translations, e2e specs | `src/app/MachineDirector.ts`, `src/app/Game.ts` (after the scaffold), `src/app/gameStore.ts`, `src/app/launch.ts`, `src/app/bootstrap.ts`, `src/game/machines/{daily,registry}.ts`, `src/settings/spec.ts`, `src/persistence/{scores,collection}.ts`, `src/ui/machines/*`, `src/ui/modals.ts`, `src/ui/App.tsx` (one mount line; coordinate with 4A), `src/ui/AttractOverlay.tsx`, `src/ui/settings/tabGameplay.tsx`, `src/i18n/strings/machines.ts`, `tests/unit/app/machineDirector.test.ts`, `tests/unit/machines/{daily,contract}.test.ts`, `tests/e2e/28-32*.spec.ts`, `tests/e2e/helpers.ts` | scaffold; consumes W1-W3 modules through the registry |
| **W5 Rendering** | dressings (generic + bridge / ledge extras), lower cabinet for any bin, ItemVisuals (instancing, print cells, gems, coins, window box), print atlas, contact-shadow / shadow inclusion, dioramas for 4A (optional), perf measurement per machine | `src/scene/machines/*` (except `classicDressing.ts`, frozen), `src/scene/ItemVisuals.ts`, `src/scene/contactShadows.ts` (item inclusion only), `tests/unit/scene/{itemVisuals,printAtlas,dressing}.test.ts`, the PERFORMANCE.md section | scaffold; geometry is data, so W5 renders stubs and early W1/W2 numbers as they change |
| **W6 Guide and audio content** | event lines (neutral bank, en / zh / ja), prompt tasks + machine context, director priorities / cooldowns tuning, server schema refinement, `machineSfx` table, optional new SFX | `src/ai/lines/{index,en,zh,ja,types}.ts`, `src/ai/prompt.ts`, `src/ai/GuideDirector.ts`, `server/schemas.ts`, `src/app/machineSfx.ts`, `tests/unit/ai/*` (the machine variants), `tests/unit/server/schemas.test.ts` | scaffold |

**Single-owner files.** `Game.ts`, `spec.ts`, `gameStore.ts` and `machines.ts` strings belong to W4. W1-W3 request
knobs or strings from W4 by message. Each genre file exports a `SETTINGS_MAP` (settings path → param) that W4 wires
in; that keeps genre authors out of `spec.ts`.

### 6.3 Integration risks

1. **Classic regression from the RoundController / PhysicsWorld move.** Mitigation: the golden fixture before the
   move, the e2e smoke after step 6 and a reviewer diff of `ClassicRules` against the removed code.
2. **Conflicts with 4A** in `Game.ts` (input path), `App.tsx` (keyboard), `Hud.tsx` (deck, status), `Cabinet.ts`
   and `Stage.ts` (shell).
   - Mitigation: the Cabinet extraction lands first and 4A rebases on it;
   - W4 never edits `Hud.tsx`, it talks through the `useMachineDeck()` hook;
   - one shared, short "touchpoint list" in the PR descriptions;
   - merge order: 4A's deck first, then W4's UI.
3. **Physics tuning lands late and moves numbers.** Rendering is data-driven from `FieldGeometry`, so dressings
   follow. Settings defaults change in one place (`defaults` in the genre module plus `spec.ts` defaults; a unit test
   asserts they agree).
4. **Machine switch leaks** (bodies, colliders, GPU geometries, textures). Mitigation: the contract test round trips
   classic → X → classic and compares `bodies()` / `memory()`; a per-machine stability e2e.
5. **Guide content volume and the lines test's strictness.** The neutral bank cuts the volume about 5×. W6 starts
   at once on the frozen event list.
6. **Rewards semantics at the booth** (shelf: one code for several items; rush: off). Agree on them with the
   operator; documented in REWARDS.md.
7. **The e2e machine time is the bottleneck.** The full suite takes about 64 min (docs/E2E_RESULTS.md:256-257); the
   new specs add about 45 min. Only one e2e run at a time on this 4-core box. Each workstream runs only its spec plus
   the smoke subset; the integrator runs the full suite.
8. **Collection inflation from the shelf** (N characters per try). Accepted and visible in the lobby
   ("prizes won here"). The QR stays one per try.

---

## 7. Test plan and estimates

### 7.1 Unit (Vitest, headless)

- **classicGolden:** the bit-identical trace (§1.5).
- **contract (per registered machine)**, by iterating `MACHINES`, available or not:
  - `validateGeometry` returns [];
  - fill determinism (same seed → same pose hash; another seed → a different one);
  - 10 pilot tries headless with no anomalies (`inspectWorld` generalised to the active geometry: NaN, escaped,
    resting on a fence top);
  - awards only for bodies whose COM is inside an opening sensor, idempotent per (round, body), `demo` flag honoured;
  - the collider count is constant after `resetForTakeover`;
  - `setMachine` refused while busy;
  - the round trip classic → X → classic restores the body / collider counts.
- **RoundMachine:** `awardItem` idempotency and id format; `configure` only at boundaries; `awardPrize` unchanged.
- **bridge:**
  - the start pose is stable for 5 s;
  - a shift past a bar tips into the pit and awards exactly once;
  - the wedge pose is detected;
  - `staffReset` restores the seeded pose;
  - the partial lift height stops at `liftDelta`;
  - in-place transport goes straight to RELEASING;
  - outcome `empty` / `won`, never `slipped`;
  - the progress metric is monotonic for synthetic shifts and turns;
  - scoring table;
  - `filterInput` stage order.
- **ledge:**
  - the lip holds items at rest;
  - one push delivers N items → N awards with distinct prize ids, one `outcome: won`;
  - a late fall is credited at the next DESCENDING;
  - refill only at the boundary, placed at rest, outside the award window;
  - scoring with the multi-drop cap.
- **rush:**
  - the timer advances only in fixed steps and pauses with the step;
  - time up in AIMING forces the grab; in READY it ends without a try; when busy, the last try counts;
  - `itemScored` per piece, no collection;
  - session summary;
  - demo never ranked.
- **session:** the open / persistent / timed state machines and events.
- **scoring:** genre scorers (pure); `settleScored` idempotency; `useRecord` swap; the daily bonus applied once.
- **persistence:** rankings (sanitise, ties, cap 10, version guard like `saveScores`), per-machine score keys, the
  `collection.machineWins` migration.
- **daily:** deterministic per date, disabled and unavailable machines excluded, spread over 365 dates (each machine
  within ±30 % of the mean).
- **director (W4):** with a fake `MachineHost`, the switch sequence order, the reward rules per genre, guide emission
  per genre, the idle return to home and the attract cycle.
- **i18n completeness, `machineIds.test.ts`, lines coverage** for the new events, **schemas** for `facts.machine`,
  **settings** for the section defaults and the "never live" regex.
- **scene:** ItemVisuals (instance counts, interpolation, dispose frees geometries), printAtlas (cell mapping and
  fallback before the thumbnails), the generic dressing builds every look and its triangle count is within budget
  per tier.

### 7.2 E2E (Playwright, production build, software GL)

| Spec | What | Layouts |
| --- | --- | --- |
| `28-lobby` | MACHINES from the deck and from attract; cards; today's-pick badge; pick bridge → curtain → `machine().id === 'bridge'`; back to classic; reach band (cards and buttons inside 0.25-0.75) on portrait86; targets ≥ 44 px on the phone; no console errors | desktop, portrait86, mobile |
| `29-bridge` | `?machine=bridge&seed=7`: scripted tries via `placeClaw` + `grab` + `fastForward` along a winning sequence recorded by the W1 sweep as a fixture → win card + QR (with the rewards server, as in 26 / 27) + collection +1; staff reset | desktop |
| `30-ledge` | one push try delivering at least 2 items → collection +N, one QR, the breakdown shows the multi-drop | desktop, portrait32 |
| `31-rush` | start a run, `setSessionSeconds(4)`, `fastForward` → session over → initials → ranking persisted across a reload; demo runs never ranked | desktop, mobile |
| `32-machines-idle` | idle reset returns to home; the attract demo on each machine changes neither collection nor scores; attract cycle on / off; `?machine=` persists | desktop |
| `33-machines-stability` | 19-stability's leak checks per machine and across switches | desktop |
| existing 01-27 | unchanged, classic default | as today |

### 7.3 Sweeps (tools, not CI): the tuning gates before `available: true`

`tools/dev/machine-sweep.ts --machine bridge|ledge|rush [--difficulty all] [--seeds 8] [--tries 40]`, built on the
harness like `grip-sweep.ts`.

| Machine | Gate (pilot, Arcade, 8 seeds) |
| --- | --- |
| bridge | median 4-8 tries per box; one-try wins < 3 %; stuck (staff hint) < 10 % of boxes; 0 anomalies; step ≤ 0.5 ms median |
| ledge | 0.8-1.6 items per try; ≥ 35 % of tries deliver 1 or more; 0 anomalies |
| rush | ≥ 1.2 pieces per centred grab; ≥ 70 % of tries score; 12-16 tries per 75 s; step ≤ 1.5 ms with the pile awake |

Results go into `docs/machines/<genre>.md` in the style of PHYSICS.md's measured tables.

### 7.4 Effort estimate (engineer-hours, on this 4-CPU machine with software-only WebGL)

| Item | Hours | Of which machine time | Main risk |
| --- | --- | --- | --- |
| Scaffold (steps 0-6) | 26 | ~2 h (unit runs 38 s each; e2e smoke 35-45 min, twice) | verbatim moves; Cabinet extraction timing with 4A |
| W1 Bridge | 30 | ~3 h of sweeps | tuning band (box mass / gap / lift) |
| W2 Shelf | 24 | ~2 h | lip / friction band, multi-award edge cases |
| W3 Rush + timed + rankings | 30 | ~3 h | gem caging; +8 h if the scoop attachment is needed |
| W4 Lobby / flow / HUD / settings UI / strings / e2e | 42 | ~6 h e2e (new specs 5-15 min each × layouts × iterations) | 4-layout UI, the 86" reach band, coordination with 4A |
| W5 Rendering | 38 | ~3 h (screenshots, perf passes on SwiftShader) | instanced print shader, contact shadows for items, perf gate |
| W6 Guide and audio content | 22 | <1 h | line volume in 3 languages, lines-test strictness |
| Integration, full e2e ×2, perf table, docs | 26 | ~5 h (64 min full suite + 45 min new, twice) | late cross-stream bugs |
| **Total** | **238** | ~25 h of serial machine time | |

Calendar: scaffold about 3.5 days, then the workstreams in parallel (the longest, W4, about 5.5 days), then
integration about 3.5 days. That is **about 12-13 working days**. Unit runs (about 40 s) can be parallel; e2e runs
must be serialised on this box.

### 7.5 Honest cost, and the alternative

- The framework (registry, geometry as data, rule seam, sessions) is about 25-30 h of the 238. The other roughly
  200 h would be spent with or without a framework: three new physics games, their tuning, rendering, UI in four
  layouts, three languages and e2e.
- **The cheaper alternative**: hard-code three modes with `if (mode === …)` in RoundController / PhysicsWorld /
  Cabinet / Game. It saves perhaps 20-30 h now. It puts classic at real regression risk (no seam, no golden test),
  turns every later machine into another branch in four god-objects (Game.ts already has 1,757 lines) and makes
  "the 40th machine" a rewrite.
- The framework pays back with the second variant or the next genre.
- What this design does **not** buy: a different claw shape, physical prize pushers or moving platforms (a
  kinematic body type in `FieldGeometry` would be the next seam, about 2 days), networked rankings, or real-hardware
  validation. As with every round so far, nothing here is checked on a real GPU, panel, phone or booth network.

---

## Appendix A: code this design relies on

- `src/physics/fieldSpec.ts:10-19` FIELD; `:22-30` CHUTE; `:38-47` PRIZE_SENSOR; `:50-58` BIN; `:60-94` CLAW
  (home 63-64, limits 66-69, drop 71-72, finger profile 82-87); `:97-110` GROUP / groups; `:115-117` isOverChute.
- `src/physics/PhysicsWorld.ts:15` StaticKind; `:52-65` ToyBody; `:85-95` collision groups; `:127-135`
  constructor (buildCabinet, then buildBin); `:151-171` addStatic; `:173-229` buildCabinet (collider order);
  `:231-251` buildBin; `:262-265` setToyFriction; `:281-303` colliderDesc; `:305-352` addToy; `:369-374`
  isInPrizeSensor; `:379-422` step (sensor drain 390-396, impacts 398-420).
- `src/physics/ClawRig.ts:237-242` setTrolleyTarget clamp; `:307-357` integrateTrolley (clamp 341-348); `:531-570`
  reset; `:147-190` three-finger build.
- `src/physics/GripMonitor.ts:194-268` scan (toys only via toyOfCollider, line 201; hub visit 244); `:302` reach from
  `asset.footprint/size`.
- `src/game/RoundMachine.ts:14-25` TRANSITIONS; `:38` AWARD_PHASES; `:41-48` watchdogs; `:110` atRoundBoundary;
  `:185-200` awardPrize (prize id `${sessionId}-${roundId}`).
- `src/game/RoundController.ts:42-51` ROUND_TUNING; `:144-213` onPhase (home 161 / 167, lift 187, transport
  191-197, settling 208); `:244-296` preStep (input 250-278, aim timer 265-273); `:299-395` postStep (checkPrize
  sites 349 / 356 / 369 / 375, SETTLING finish 374-389, checkStrays 394); `:421-433` checkPrize; `:436-451`
  checkStrays; `:471-506` buildResult.
- `src/game/GameCore.ts:37-45` constructor; `:48-56` fixedStep order; `:59-70` populate; `:77-83` settle.
- `src/game/ToyField.ts:32-37` isFreeSpot; `:114-165` fill; `:201-210` restockOne; `:213-217` clearBin; `:224-231`
  clearFallen; `:238-252` settle.
- `src/game/attract.ts:93-102` enter; `:109-114` leave; `:121-135` resetField; `:141-163` update (demo scheduling).
- `src/game/scoring.ts:103-144` scoreRound; `:166-240` ScoreKeeper (settle 184-204).
- `src/app/DemoPilot.ts:63-88` pick (classic CHUTE / CLAW constants); `:91-132` update.
- `src/app/Game.ts:88` EXIT_POS; `:114` pilot; `:146` scores; `:235` GameCore creation; `:327-357` rebuildScene;
  `:469-476` pushInput; `:482-514` pressStart; `:615-636` idleReset; `:653-774` bindCore; `:780-809` onPrizeExit;
  `:881-930` onResult; `:933-953` afterRoundBoundary; `:955-1007` applyQueuedRebuild; `:1038-1083` facts;
  `:1225-1270` onSettingsChanged; `:1405-1438` updateFlow; `:1502-1536` updateAudio; `:1659-1740` debug API.
- `src/scene/Cabinet.ts:182-215` constructor / build; `:274-280` floor; `:306-317` chute; `:319-377` lower cabinet
  (BIN-driven); `:378-400` side bays.
- `src/scene/ToyVisuals.ts:234-246` sync; `:415-430` interpolation.
- `src/settings/spec.ts:361-566` sections; `tests/unit/settings/spec.test.ts:197-200` never-live rule.
- `src/ai/GuideDirector.ts:44-72` priorities / cooldowns; `src/ai/prompt.ts:107` EVENT_TASKS;
  `src/ai/lines/index.ts:60-104, 157` lookup; `server/schemas.ts:27-65` FactsSchema.
- `tests/e2e/helpers.ts:118-129` event capture bound once to `core().machine.events`;
  `tests/unit/core/independence.test.ts:75-91` allowed module set.
- `docs/PERFORMANCE.md:298-330` triangle budget; `docs/DISPLAYS.md:36` reach band; `docs/E2E_RESULTS.md:256-257`
  suite time.

## Appendix B: probe results (scratchpad only, real `PhysicsWorld` + `ClawRig`, machine under load)

Probe: `/tmp/claude-0/-home-user-livex/0f932014-0125-5b6f-8973-e02b175382f8/scratchpad/round4/probe/probe.mts`
(not in the repository).

**Gem pile.** 17-point hulls, r 0.032-0.042, 30 g, dropped onto the classic floor in 4 layers. Mean cost of one
`PhysicsWorld.step()`:

| Pieces | First 2 s (everything awake) | 4-6 s | Awake at the end |
| --- | --- | --- | --- |
| 24 | 1.27 ms | 0.10 ms | 0 |
| 48 | 0.84 ms | 0.10 ms | 0 |
| 72 | 1.51 ms | 1.04 ms (the last movers until about 5 s) | 0 |

Today's 18-toy classic is 0.22-0.30 ms per step (PHYSICS.md). The step budget at 120 Hz with at most 5 steps per
frame leads to the recommended cap of 48 pieces.

**Bridge box on two capsule bars.** Box 0.24 × 0.10 × 0.13 m, 0.40 kg; bars r 0.012 at x = ±0.087, y = 0.10
(inner gap 0.150 m); friction 0.35; classic floor below (no pit in the probe). COM after 4 s:

| Start shift (x) | COM after 4 s | Reading |
| --- | --- | --- |
| 0 | (0.000, 0.162, −0.400), asleep | stable straddle |
| 0.05 | (0.044, 0.157), asleep | slight tilt, still on both bars |
| 0.08 | (0.045, 0.145), asleep | **wedged** into the gap at an angle (an intermediate state the claw must work on) |
| 0.10 | (0.214, 0.120), asleep | **tipped over the bar.** With the pit below this is a drop, i.e. a win |

These two probes show the intended states exist with the default numbers. They do not replace the sweeps of §7.3,
which must include the real claw.
