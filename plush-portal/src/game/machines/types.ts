/**
 * Contracts of the machine framework (docs/design/machines.md, section 2.2). A machine is data
 * (MachineDef) plus a genre (GenreModule). Classic is the null rules object: RoundController runs
 * today's code whenever `TryRules` is absent.
 *
 * Only the lead edits these shapes; workstreams retune values, never shapes or field names.
 */
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

export interface TransportPlan {
  x: number;
  z: number;
  speed: number;
  /** wait for the swing to calm before releasing */
  toOpening: boolean;
}

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
  id: number;
  machineId: MachineId;
  kind: SessionKind;
  state: SessionState;
  tries: number;
  triesTotal: number | null;
  secondsLeft: number | null;
  timerStarted: boolean;
  /** Items scored this session and the sum of their raw values (physics facts). */
  items: number;
  value: number;
  reason: SessionEndReason | null;
  reward: SessionReward | null;
  lastRoundId: number;
}
export interface SessionSummary {
  machineId: MachineId;
  sessionId: number;
  tries: number;
  items: readonly ScoredItem[];
  value: number;
  lastRoundId: number;
  reason: SessionEndReason;
}
export interface SessionReward {
  typeId: string;
  tier: RarityTier;
  prizeId: string;
  roundId: number;
}
export interface PlaySessionEvents extends Record<string, unknown> {
  started: SessionSnapshot;
  second: { secondsLeft: number }; // timed: on whole seconds
  timeLow: { secondsLeft: number }; // timed: once, at 10 s
  over: SessionSnapshot; // never for demo rounds
}

/* ------------------------------------------------------------ scoring */

export type ScoredItem = { toyId: string; kind: ItemKind; look: ItemLook; print: string | null; value: number; index: number };
export interface TryScoreInput {
  roundId: number;
  demo: boolean;
  difficulty: ScoringDifficulty;
  items: readonly ScoredItem[];
  /** 1 = none; machines.dailyBonus on today's pick (presentation only). */
  dailyBonus: number;
}

/* ------------------------------------------------------------ genre + machine */

/** Multipliers applied to the RoundParams the difficulty preset produced (absent = ×1). gripAssist 0 = pure friction. */
export interface ClawScale {
  moveSpeed?: number;
  moveAccel?: number;
  descendSpeed?: number;
  liftSpeed?: number;
  clawForce?: number;
  closeSpeed?: number;
  ropeSwing?: number;
  gripAssist?: number;
}
export interface BridgeParams {
  centerX: number;
  centerZ: number;
  gap: number;
  barRadius: number;
  barY: number;
  barFriction: number;
  box: [number, number, number];
  boxMass: number;
  boxFriction: number;
  startJitter: number;
  startYawDeg: number;
  liftDelta: number;
  triesPerBox: number;
  controls: MachineControls;
  claw: ClawScale;
}
export interface ShelfParams {
  shelfY: number;
  shelfFront: number;
  lipHeight: number;
  shelfFriction: number;
  rowsZ: readonly number[];
  columnsX: readonly number[];
  stackHeight: number;
  tries: number;
  rewardItems: number;
  dropZ: number;
  claw: ClawScale;
}
export interface RushParams {
  seconds: number;
  pieces: number;
  radiusScale: number;
  rewardValue: number;
  claw: ClawScale;
}
export interface GenreParams {
  classic: Record<string, never>;
  bridge: BridgeParams;
  shelf: ShelfParams;
  rush: RushParams;
}

export interface AimPlan {
  x: number;
  z: number;
  /** s to wait for the swing to calm */
  patience: number;
  targetToyId: string | null;
}

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
  id: MachineId;
  genre: G;
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
  def: MachineDef<G>;
  module: GenreModule<G>;
  params: GenreParams[G];
  geometry: FieldGeometry;
  session: SessionRule;
  controls: MachineControls;
}
