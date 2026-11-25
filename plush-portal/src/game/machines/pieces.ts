/**
 * What the two items genres share (docs/design/machines.md, sections 3.0, 3.2 and 3.3): TUMBLE SHELF
 * and SPARKLE RUSH score loose items (printed snacks, gems, coins) that fall into the machine's
 * opening, several per try, and grant at most one session prize at the end of a session.
 *
 *   - itemInOpening / scoreItems: the one physical win test of section 2.5, applied to every item;
 *   - ItemRules: a try with a full lift, the genre's transport, item awards and a calm settle;
 *   - ItemField: a field of items placed at rest, restored on takeover, refilled in attract mode;
 *   - the pure points helpers (per-item points, multi-drop, handful, the daily bonus) and the print
 *     pools (a seeded shuffle of the theme's characters, like ToyField.nextAsset).
 *
 * Nothing here decides an outcome: an item counts when physics put it into the opening.
 */
import { makeRng } from '../../core/math';
import type { RoundPhase, RoundResult, ThemeId } from '../../core/types';
import { overOpening, type PrizeOpening } from '../../physics/fieldGeometry';
import { CLAW, FIXED_DT } from '../../physics/fieldSpec';
import type { ItemSpec } from '../../physics/items';
import type { PhysicsWorld, ToyBody } from '../../physics/PhysicsWorld';
import type { PlushAsset } from '../../plush/manifest';
import { rarityOf, tierRank, type RarityTier } from '../rarity';
import { DIFFICULTY_MULTIPLIER, type RoundScore } from '../scoring';
import type { RoundParams } from '../RoundController';
import type { FieldOptions } from '../ToyField';
import type { GenreId } from './ids';
import type { ClawScale, MachineField, ScoredItem, TransportPlan, TryContext, TryRules, TryScoreInput } from './types';

/* ------------------------------------------------------------ the win test */

/**
 * True when an item is really in the opening (section 2.5): its centre of mass is below the award
 * height, it lies over the opening (or already under the floor slab, which it can only have reached
 * through the opening) and one of its colliders touched the sensor volume.
 */
export function itemInOpening(phys: PhysicsWorld, o: PrizeOpening, toy: ToyBody): boolean {
  const com = toy.body.worldCom(phys.scratchV);
  if (!(com.y < o.awardComY)) return false;
  if (!overOpening(o, com.x, com.z) && !(com.y < o.sensorTop)) return false;
  return phys.sensorHits.has(toy) || phys.isInPrizeSensor(toy);
}

/**
 * Scores every item that reached the opening (once per body, through RoundMachine.scoreItem, which
 * refuses ATTRACT, RESULT and stale rounds). Scored items are marked `inBin` and announced with the
 * controller's `itemScored` event. Returns the bodies scored in this call.
 */
export function scoreItems(ctx: TryContext): ToyBody[] {
  const out: ToyBody[] = [];
  const m = ctx.machine;
  for (const toy of ctx.phys.toys.values()) {
    if (toy.inBin || !toy.item) continue;
    if (!itemInOpening(ctx.phys, ctx.opening, toy)) continue;
    if (!m.scoreItem(m.roundId, toy.id, toy.item)) continue;
    toy.inBin = true;
    out.push(toy);
    ctx.events.emit('itemScored', { roundId: m.roundId, toy, item: toy.item });
  }
  return out;
}

/** Fastest awake item still in play (scored items are on their way to the bin and do not count). */
export function maxItemSpeed(phys: PhysicsWorld): number {
  let max = 0;
  for (const toy of phys.toys.values()) {
    if (toy.inBin || !toy.item || toy.body.isSleeping()) continue;
    const v = toy.body.linvel(phys.scratchV);
    const s = Math.hypot(v.x, v.y, v.z);
    if (s > max) max = s;
  }
  return max;
}

/* ------------------------------------------------------------ one try */

/** Settle-to-calm (section 3.0): every item that moved is slower than this… */
export const CALM_SPEED = 0.02;
/** …for this long, before the try may end. */
export const CALM_SECONDS = 0.3;
/** An off-screen settle (a fresh layout) ends once every awake item is slower than this. */
export const SETTLE_SPEED = 0.004;
/** The try ends after this long in SETTLING whatever still moves (the 7 s watchdog is behind it). */
export const SETTLE_CAP = 5;

/**
 * One try of an items machine. The claw lifts all the way (like classic), the genre picks the
 * transport target, every item that reaches the opening in READY … SETTLING is scored, and the try
 * ends once every item in play has been calm for a moment (or after SETTLE_CAP).
 */
export abstract class ItemRules implements TryRules {
  readonly home: { x: number; z: number };
  /** Items scored in this try, in order (the round machine keeps the authoritative list). */
  protected scored: ToyBody[] = [];
  /** Seconds the items in play have been calm in this SETTLING. */
  protected calmTime = 0;
  protected tries = 0;
  /** Items scored over the life of these rules (attract included). */
  protected scoredTotal = 0;

  constructor(
    readonly genre: Extract<GenreId, 'shelf' | 'rush'>,
    home: { x: number; z: number },
  ) {
    this.home = { x: home.x, z: home.z };
  }

  beginTry(_ctx: TryContext): void {
    this.tries++;
    this.scored = [];
    this.calmTime = 0;
  }

  /** A full lift: the classic rope length (RoundController.ts LIFTING). */
  liftTarget(_ctx: TryContext): number {
    return CLAW.ropeMin;
  }

  abstract transportTarget(ctx: TryContext, holding: boolean): TransportPlan;

  /** The claw heads home at once (it travels above everything at rest). */
  beginSettling(ctx: TryContext): void {
    this.calmTime = 0;
    ctx.claw.setTrolleyTarget(this.home.x, this.home.z, ctx.params.moveSpeed);
  }

  postStep(ctx: TryContext, phase: RoundPhase, _phaseTime: number, dt: number): void {
    const now = scoreItems(ctx);
    if (now.length > 0) {
      this.scored.push(...now);
      this.scoredTotal += now.length;
    }
    if (phase === 'SETTLING') this.calmTime = maxItemSpeed(ctx.phys) < CALM_SPEED ? this.calmTime + dt : 0;
  }

  /** Shortest SETTLING after a release with / without a held item (a carried item needs a moment to fall in). */
  protected readonly settleWait = { holding: 0.5, empty: 0.3 };

  canFinish(ctx: TryContext, phaseTime: number): boolean {
    const minWait = ctx.releasedHolding ? this.settleWait.holding : this.settleWait.empty;
    return (phaseTime >= minWait && this.calmTime >= CALM_SECONDS) || phaseTime > SETTLE_CAP;
  }

  /** `won` when at least one item scored this try (there is no `slipped`: items are not prizes). */
  resultExtras(ctx: TryContext, base: RoundResult): Partial<RoundResult> {
    const items = ctx.machine.roundItems.map((i) => ({ ...i }));
    const first = items[0];
    return {
      outcome: items.length > 0 ? 'won' : 'empty',
      slipReason: null,
      slipPhase: null,
      targetToyId: first ? first.toyId : base.targetToyId,
      targetTypeId: first ? (first.print ?? `item.${first.look}`) : base.targetTypeId,
      machine: { id: this.genre, genre: this.genre, items, progress: null, progressGain: null, stuck: false },
    };
  }

  debugState(): Record<string, unknown> {
    return { genre: this.genre, tries: this.tries, scoredThisTry: this.scored.length, scoredTotal: this.scoredTotal, calmTime: Number(this.calmTime.toFixed(3)) };
  }
}

/* ------------------------------------------------------------ the field */

/**
 * A field of machine items. The genre lays it out (`layout`), always at rest: items are teleported
 * to resting spots and settled off-screen by GameCore, never dropped in during a try. The layout is
 * deterministic per seed and reset count. Classic restock paths are no-ops here (`missing()` is 0).
 */
export abstract class ItemField implements MachineField {
  protected assets: PlushAsset[] = [];
  protected options: FieldOptions;
  protected seed: number;
  /** Layouts built since the last fill (takeovers and attract refills). */
  protected resets = 0;
  /** Items the current layout started with. */
  protected laidOut = 0;

  constructor(
    protected readonly phys: PhysicsWorld,
    options: FieldOptions,
  ) {
    this.options = { ...options };
    this.seed = options.seed;
  }

  /** Places the genre's start layout (the world holds no items when it is called). Returns the bodies. */
  protected abstract layout(rng: () => number): ToyBody[];

  /** Attract mode refills when fewer than this share of the start layout is left in play. */
  protected abstract readonly refillShare: number;
  /** An off-screen settle ends once every awake item is slower than this (m/s). */
  protected readonly settleSpeed: number = SETTLE_SPEED;

  protected get themeId(): ThemeId {
    return this.assets[0]?.theme ?? 'sakura';
  }

  setOptions(options: FieldOptions): void {
    this.options = { ...options };
  }

  fill(assets: PlushAsset[], seed = this.options.seed): ToyBody[] {
    this.assets = [...assets];
    this.seed = seed;
    this.resets = 0;
    return this.rebuild();
  }

  /** Removes every body and lays the field out afresh (seeded by the fill seed and the reset count). */
  protected rebuild(): ToyBody[] {
    this.phys.removeAllToys();
    const rng = makeRng((this.seed + 7919 * this.resets) >>> 0);
    const placed = this.layout(rng);
    this.laidOut = placed.length;
    this.phys.snapPoses();
    return placed;
  }

  onField(): ToyBody[] {
    const out: ToyBody[] = [];
    for (const toy of this.phys.toys.values()) if (!toy.inBin) out.push(toy);
    return out;
  }

  inBin(): ToyBody[] {
    const out: ToyBody[] = [];
    for (const toy of this.phys.toys.values()) if (toy.inBin) out.push(toy);
    return out;
  }

  missing(): number {
    return 0;
  }

  restockOne(): ToyBody | null {
    return null;
  }

  clearBin(): ToyBody[] {
    const out = this.inBin();
    for (const toy of out) this.phys.removeToy(toy);
    return out;
  }

  clearFallen(): ToyBody[] {
    const y = this.phys.opening.awardComY;
    const out: ToyBody[] = [];
    for (const toy of this.phys.toys.values()) if (toy.inBin || toy.body.worldCom(this.phys.scratchV).y < y) out.push(toy);
    for (const toy of out) this.phys.removeToy(toy);
    return out;
  }

  /**
   * Steps (without rendering) until every item has really come to rest. Stacked boxes lean into
   * place slowly, a few mm/s, so "calm" here is stricter than during play (`settleSpeed`).
   */
  settle(maxSeconds = 2.5, preStep?: () => void, postStep?: () => void): number {
    const maxSteps = Math.ceil(maxSeconds / FIXED_DT);
    let calm = 0;
    let ran = 0;
    while (ran < maxSteps) {
      preStep?.();
      this.phys.step();
      postStep?.();
      this.calmWobble();
      ran++;
      calm = this.phys.maxToySpeed() < this.settleSpeed ? calm + 1 : 0;
      if (ran > 40 && calm > 30) break;
    }
    this.phys.snapPoses();
    return ran * FIXED_DT;
  }

  /**
   * A gem on its pavilion is a cone: it rolls in circles for many seconds. Settling runs off-screen,
   * so the rocking and rolling of items that are already slow is damped hard here (and only here,
   * never during play), as ToyField does for round-bottomed plush.
   */
  private calmWobble(): void {
    const keepSpin = Math.max(0, 1 - 14 * FIXED_DT);
    const keepSlide = Math.max(0, 1 - 4 * FIXED_DT);
    for (const toy of this.phys.toys.values()) {
      const body = toy.body;
      if (body.isSleeping()) continue;
      const v = body.linvel();
      if (Math.hypot(v.x, v.y, v.z) > 0.35) continue; // still falling or tumbling: leave it alone
      const w = body.angvel();
      body.setAngvel({ x: w.x * keepSpin, y: w.y * keepSpin, z: w.z * keepSpin }, false);
      body.setLinvel({ x: v.x * keepSlide, y: v.y, z: v.z * keepSlide }, false);
    }
  }

  /** Attract mode only: a fresh layout once too little is left for the demo to show. */
  atBoundary(phase: 'READY' | 'ATTRACT', _demo: boolean): number {
    if (phase !== 'ATTRACT' || this.assets.length === 0) return 0;
    if (this.onField().length >= Math.ceil(this.laidOut * this.refillShare)) return 0;
    return this.resetForTakeover();
  }

  /** A player takes over (or PLAY AGAIN): the start layout again. */
  resetForTakeover(): number {
    this.resets++;
    return this.rebuild().length;
  }
}

/* ------------------------------------------------------------ prints */

/**
 * Cycles through the theme's characters of the allowed tiers in a seeded shuffled order (like
 * ToyField.nextAsset), so the mix of printed characters stays even. An empty tier pool falls back
 * to every character.
 */
export class PrintPool {
  private readonly ids: string[];
  private cursor = 0;
  constructor(
    assets: readonly PlushAsset[],
    tiers: readonly RarityTier[],
    private readonly rng: () => number,
  ) {
    const wanted = assets.filter((a) => tiers.includes(rarityOf(a.id))).map((a) => a.id);
    this.ids = wanted.length > 0 ? wanted : assets.map((a) => a.id);
  }
  next(): string | null {
    if (this.ids.length === 0) return null;
    if (this.cursor % this.ids.length === 0) {
      for (let i = this.ids.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.ids[i], this.ids[j]] = [this.ids[j]!, this.ids[i]!];
      }
    }
    return this.ids[this.cursor++ % this.ids.length]!;
  }
}

/* ------------------------------------------------------------ points (pure) */

export interface PointsExtra {
  /** i18n-friendly key: 'multiDrop', 'handful', 'daily'. */
  key: string;
  points: number;
}

/**
 * The points of one items try. It is a RoundScore (what ScoreKeeper settles) plus the breakdown the
 * try toast shows. The multi-drop / handful factor is reported through `comboMultiplier` /
 * `comboBonus` (there is no combo across tries on items machines).
 */
export type ItemsTryScore = RoundScore & {
  items: number;
  extras: PointsExtra[];
  dailyBonus: number;
};

export interface ItemsScoreRules {
  /** Raw points of one item before the difficulty multiplier. */
  itemPoints(item: ScoredItem): number;
  /** The try's factor for scoring n items at once (1 = none) and its breakdown key. */
  groupFactor(n: number): { factor: number; key: string };
}

/**
 * Points for one finished try: Σ item points × difficulty, × the group factor (multi-drop or
 * handful), × the daily bonus. Each factor is applied exactly once and rounded once.
 */
export function scoreItemsTry(input: TryScoreInput, rules: ItemsScoreRules): ItemsTryScore {
  const difficultyMultiplier = DIFFICULTY_MULTIPLIER[input.difficulty] ?? 1;
  const n = input.items.length;
  const raw = input.items.reduce((sum, item) => sum + rules.itemPoints(item), 0);
  const basePoints = Math.round(raw * difficultyMultiplier);
  const group = n > 0 ? rules.groupFactor(n) : { factor: 1, key: '' };
  const grouped = Math.round(basePoints * group.factor);
  const daily = Number.isFinite(input.dailyBonus) && input.dailyBonus > 0 ? input.dailyBonus : 1;
  const total = Math.round(grouped * daily);
  const extras: PointsExtra[] = [];
  if (grouped !== basePoints) extras.push({ key: group.key, points: grouped - basePoints });
  if (total !== grouped) extras.push({ key: 'daily', points: total - grouped });
  // The headline character of the try: the rarest print (earliest on ties), if any.
  const top = rarestPrint(input.items);
  return {
    roundId: input.roundId,
    outcome: n > 0 ? 'won' : 'empty',
    demo: input.demo,
    typeId: top,
    difficultyMultiplier,
    tier: n > 0 ? (top ? rarityOf(top) : 'common') : null,
    base: raw,
    basePoints,
    firstCatch: 0,
    cleanGrab: 0,
    consolation: 0,
    streak: 0,
    comboMultiplier: group.factor,
    comboBonus: grouped - basePoints,
    total,
    items: n,
    extras,
    dailyBonus: daily,
  };
}

/** The rarest printed character among `items`; the earliest one wins a tie. null when none is printed. */
export function rarestPrint(items: readonly Pick<ScoredItem, 'print' | 'index'>[]): string | null {
  let best: { print: string; rank: number; index: number } | null = null;
  for (const item of items) {
    if (!item.print) continue;
    const rank = tierRank(rarityOf(item.print));
    if (!best || rank > best.rank || (rank === best.rank && item.index < best.index)) best = { print: item.print, rank, index: item.index };
  }
  return best ? best.print : null;
}

/** The share of a nominal mix for `total` pieces (largest remainder; every kind keeps at least `min`). */
export function scaleMix(counts: readonly number[], total: number, min: readonly number[] = []): number[] {
  const sum = counts.reduce((a, b) => a + b, 0);
  const exact = counts.map((c) => (c * total) / sum);
  const out = exact.map((v, i) => Math.max(min[i] ?? 0, Math.floor(v)));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) out[order[k]!.i]!++;
  // A minimum can push the sum over: take the surplus from the largest kinds.
  for (let guard = 0; left < 0 && guard < 1000; guard++) {
    let j = 0;
    for (let i = 1; i < out.length; i++) if (out[i]! - (min[i] ?? 0) > out[j]! - (min[j] ?? 0)) j = i;
    if (out[j]! <= (min[j] ?? 0)) break;
    out[j]!--;
    left++;
  }
  return out;
}

/**
 * The difficulty preset's claw parameters scaled by a genre's multipliers (absent = ×1). The same
 * arithmetic as registry.scaleRoundParams; kept here so the genre files never import the registry
 * (which imports them).
 */
export function scaleClaw(base: RoundParams, scale: ClawScale): RoundParams {
  const k = (key: keyof ClawScale) => scale[key] ?? 1;
  return {
    ...base,
    moveSpeed: base.moveSpeed * k('moveSpeed'),
    moveAccel: base.moveAccel * k('moveAccel'),
    descendSpeed: base.descendSpeed * k('descendSpeed'),
    liftSpeed: base.liftSpeed * k('liftSpeed'),
    clawForce: base.clawForce * k('clawForce'),
    closeSpeed: base.closeSpeed * k('closeSpeed'),
    ropeSwing: base.ropeSwing * k('ropeSwing'),
    gripAssist: base.gripAssist * k('gripAssist'),
  };
}

/** A yaw rotation (radians) as a quaternion. */
export function yawQuat(yaw: number): [number, number, number, number] {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

/** Hamilton product a · b (apply b first, then a). */
export function mulQuat(a: readonly number[], b: readonly number[]): [number, number, number, number] {
  const [ax, ay, az, aw] = a as [number, number, number, number];
  const [bx, by, bz, bw] = b as [number, number, number, number];
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

/** Type guard: an item body (a box, snack, gem or coin) rather than a plush toy. */
export function isItem(toy: ToyBody): toy is ToyBody & { item: ItemSpec } {
  return toy.item !== undefined;
}
