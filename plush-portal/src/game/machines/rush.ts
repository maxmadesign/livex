/**
 * SPARKLE RUSH (docs/design/machines.md, section 3.3). A timed score attack: `seconds` (75) of quick
 * grabs in a pile of giant gems and coins, scored by value, with a local top-10 ranking.
 *
 *   - the classic cabinet as it is (CLASSIC_FIELD): the 20 cm chute guard means a piece on the
 *     floor can only arrive carried, never pushed in;
 *   - a try is a full lift, then the claw always goes to the chute (pieces caged between the
 *     fingers ride along) and opens there;
 *   - the session is timed on simulated time (PlaySession); a run whose raw value (Σ piece values,
 *     a physics fact) reaches `rewardValue` earns one prize, its tier set by value bands.
 *
 * Outcomes are physical: a piece counts when it really is in the chute (section 2.5).
 */
import type { RoundPhase } from '../../core/types';
import { fitScoop, type ScoopSpec } from '../../physics/ClawRig';
import { CLASSIC_FIELD } from '../../physics/fieldGeometry';
import { CLAW, FIELD, FIXED_DT } from '../../physics/fieldSpec';
import { coinItem, gemItem, type ItemLook, type ItemSpec } from '../../physics/items';
import type { PhysicsWorld, ToyBody } from '../../physics/PhysicsWorld';
import type { GameCore } from '../GameCore';
import { RARITY_TIERS, tierRank, type RarityTier } from '../rarity';
import type { ScoringDifficulty } from '../scoring';
import { isFreeSpot, type FieldOptions } from '../ToyField';
import { ItemField, ItemRules, mulQuat, scaleClaw, scaleMix, scoreItemsTry, yawQuat, type ItemsScoreRules } from './pieces';
import type { AimPlan, GenreModule, RushParams, ScoredItem, SessionSummary, TransportPlan, TryContext } from './types';

/* ------------------------------------------------------------ tuning */

/** Defaults of section 3.3. The settings group `machines.rush` maps onto seconds, pieces and rewardValue. */
export const RUSH_DEFAULTS: RushParams = {
  seconds: 75,
  pieces: 44,
  radiusScale: 1,
  // With the scoop a run collects more (median raw value 645 on Arcade): 700 lets 27 % of 48 pilot
  // runs earn the prize, 600 would let 69 % (tools/dev/sweeps/rush.ts; the settings default too).
  rewardValue: 700,
  // The design's quick claw plus a stiffer cable (less swing to wait for before a grab and at the
  // chute): 13 tries per 75 s run instead of 11-12 without the scoop; 12 with it (median of 48 Arcade
  // runs, range 11-13; tools/dev/sweeps/rush.ts).
  claw: { moveSpeed: 1.2, descendSpeed: 1.25, liftSpeed: 1.25, closeSpeed: 1.2, ropeSwing: 0.5 },
};

export interface RushPiece {
  look: Extract<ItemLook, 'gemEmerald' | 'gemSapphire' | 'gemRuby' | 'gemDiamond' | 'coin'>;
  /** Girdle radius of a gem (× radiusScale), radius of a coin. */
  radius: number;
  /** Coins only. */
  thickness?: number;
  mass: number;
  /** Points (raw, physics-free). */
  value: number;
  /** Pieces of this look in the nominal pile of 44. */
  count: number;
}

/** The value table (section 3.3). */
export const RUSH_PIECES: readonly RushPiece[] = [
  { look: 'gemEmerald', radius: 0.034, mass: 0.03, value: 10, count: 14 },
  { look: 'gemSapphire', radius: 0.036, mass: 0.032, value: 25, count: 10 },
  { look: 'gemRuby', radius: 0.038, mass: 0.034, value: 50, count: 6 },
  { look: 'gemDiamond', radius: 0.04, mass: 0.036, value: 150, count: 2 },
  { look: 'coin', radius: 0.026, thickness: 0.01, mass: 0.012, value: 5, count: 12 },
];
/** The range the `pieces` setting allows (the physics cost caps it at 48). */
export const RUSH_PIECE_RANGE = { min: 24, max: 48 } as const;

/**
 * Where the pile lies: a hexagonal grid over the claw's reach (plus `margin`), clear of the chute
 * guard and the glass. Plain numbers so the sweep (tools/dev/sweeps/rush.ts --tune) can try others.
 */
export const RUSH_TUNING = {
  /**
   * Distance between neighbouring cells of the layer (m): a gem's width plus room for a finger tip.
   * 9 cm (66 cells for 44 pieces) rather than 10 (56): with the scoop a centred grab then brings
   * 1.34 pieces instead of 1.22 (32 seeds), neighbours lying within the closing petals' sweep.
   */
  pitch: 0.09,
  /** How far the pile reaches beyond the claw's axis limits (the open tips reach about 0.10 m). */
  margin: 0.04,
  /** Clearance of a piece from the glass and the chute guard (isFreeSpot radius). */
  clearance: 0.05,
  /**
   * Share of the pieces dropped on top of the first layer. 0: pieces on top rolled off for seconds
   * (no settle within 3 s) and did not make a grab cage more than one piece anyway.
   */
  topShare: 0,
  /** Placement jitter around a cell (m). */
  jitter: 0.004,
};

/**
 * The scoop on the rush claw (ClawRig.fitScoop, design section 2.7): three curved petals on the
 * finger tips that close into a shallow cup of about 4 cm radius under the hub. Without it a
 * centred grab delivered 0.82-0.91 pieces: the bare tips converge under one gem and a neighbour
 * between two fingers stays behind; with it 1.3 (docs/machines/rush.md, *Caging*). Plain numbers,
 * like RUSH_TUNING, so the sweep can try others (`--tune scoop.closedAngle=0.12`).
 */
export const RUSH_SCOOP: ScoopSpec = {
  closedAngle: 0.1,
  halfAngle: 1.0,
  segments: 2,
  floorSegments: 2,
  wallHeight: 0.03,
  floorInner: 0.005,
  floorTilt: 0.2,
  thickness: 0.0015,
  mass: 0.12,
  friction: 0.9,
  floorFriction: 0.9,
};

/** "Handful": this many pieces in one try earn the bonus. */
export const HANDFUL = { pieces: 3, factor: 1.25 } as const;

export const RUSH_SCORE: ItemsScoreRules = {
  itemPoints: (item) => item.value,
  groupFactor: (n) => ({ factor: n >= HANDFUL.pieces ? HANDFUL.factor : 1, key: 'handful' }),
};

/** Prize tier by the run's raw value as a multiple of `rewardValue` (section 3.3). */
export const REWARD_BANDS: readonly { at: number; tier: RarityTier }[] = [
  { at: 3, tier: 'legendary' },
  { at: 2, tier: 'epic' },
  { at: 1.5, tier: 'rare' },
  { at: 1, tier: 'common' },
];

/** The prize tier a run's raw value earns; null below `rewardValue` (or when it is 0 = never). */
export function rewardTier(value: number, rewardValue: number): RarityTier | null {
  if (!(rewardValue > 0) || !(value >= rewardValue)) return null;
  const ratio = value / rewardValue;
  for (const band of REWARD_BANDS) if (ratio >= band.at) return band.tier;
  return null;
}

/**
 * The run's prize: the first character of the earned tier in `prints` (the app orders it
 * least-collected first, ties in manifest order); a missing tier falls back to the next lower one.
 */
export function rushReward(s: Pick<SessionSummary, 'value'>, p: Pick<RushParams, 'rewardValue'>, prints: readonly { id: string; tier: RarityTier }[]): { typeId: string } | null {
  const tier = rewardTier(s.value, p.rewardValue);
  if (!tier) return null;
  for (let rank = tierRank(tier); rank >= 0; rank--) {
    const hit = prints.find((c) => c.tier === RARITY_TIERS[rank]);
    if (hit) return { typeId: hit.id };
  }
  return prints[0] ? { typeId: prints[0].id } : null;
}

/* ------------------------------------------------------------ ranking (data shape) */

/** The local top 10 per machine (stored by src/persistence, never for demo runs). */
export const RANK_SIZE = 10;
/** Three letters A-Z, entered slot by slot. */
export const INITIALS_PATTERN = /^[A-Z]{3}$/;

export interface RankEntry {
  initials: string;
  /** The run's points without the daily bonus, so days stay comparable. */
  score: number;
  /** Epoch ms, supplied by the app (headless code never reads the clock). */
  at: number;
  difficulty: ScoringDifficulty;
}

/** Where a score would land (1-based), or null when it does not make the top 10. Ties keep the older entry first. */
export function rankPosition(entries: readonly RankEntry[], score: number): number | null {
  if (!(score > 0)) return null;
  const sorted = [...entries].sort(compareRank);
  let pos = sorted.findIndex((e) => score > e.score);
  if (pos < 0) pos = sorted.length;
  return pos < RANK_SIZE ? pos + 1 : null;
}

/** The ranking with `entry` inserted (sorted, at most RANK_SIZE entries) and its position (null = not ranked). */
export function insertRank(entries: readonly RankEntry[], entry: RankEntry): { entries: RankEntry[]; position: number | null } {
  const position = rankPosition(entries, entry.score);
  const sorted = [...entries].sort(compareRank);
  if (position === null) return { entries: sorted.slice(0, RANK_SIZE), position: null };
  sorted.splice(position - 1, 0, { ...entry });
  return { entries: sorted.slice(0, RANK_SIZE), position };
}

function compareRank(a: RankEntry, b: RankEntry): number {
  return b.score - a.score || a.at - b.at;
}

/** A run's ranking score: the points of its tries without the daily bonus. */
export function runPoints(tries: readonly (readonly ScoredItem[])[], difficulty: ScoringDifficulty): number {
  let sum = 0;
  tries.forEach((items, i) => {
    sum += scoreItemsTry({ roundId: i + 1, demo: false, difficulty, items, dailyBonus: 1 }, RUSH_SCORE).total;
  });
  return sum;
}

/* ------------------------------------------------------------ field */

/** How many of each piece a pile of `pieces` holds (the nominal mix scaled; at least one diamond). */
export function pieceCounts(pieces: number): number[] {
  const n = Math.round(Math.min(RUSH_PIECE_RANGE.max, Math.max(RUSH_PIECE_RANGE.min, pieces)));
  return scaleMix(
    RUSH_PIECES.map((k) => k.count),
    n,
    RUSH_PIECES.map((k) => (k.look === 'gemDiamond' ? 1 : 0)),
  );
}

export function pieceSpec(k: RushPiece, radiusScale: number): ItemSpec {
  if (k.look === 'coin') return coinItem({ radius: k.radius, thickness: k.thickness ?? 0.01, mass: k.mass, value: k.value });
  return gemItem({ look: k.look, radius: k.radius * radiusScale, mass: k.mass, value: k.value });
}

/** The free resting spots of the pile's first layer (hexagonal grid, back row first). */
export function pileCells(): { x: number; z: number }[] {
  const t = RUSH_TUNING;
  const cells: { x: number; z: number }[] = [];
  const row = t.pitch * 0.866;
  const x0 = CLAW.minX - t.margin;
  const x1 = CLAW.maxX + t.margin;
  const z0 = CLAW.minZ - t.margin;
  const z1 = CLAW.maxZ + t.margin;
  for (let r = 0, z = z0; z <= z1 + 1e-9; r++, z = z0 + r * row) {
    for (let x = x0 + (r % 2 === 0 ? 0 : t.pitch / 2); x <= x1 + 1e-9; x += t.pitch) {
      if (isFreeSpot(x, z, t.clearance) && x > -FIELD.halfWidth + t.clearance) cells.push({ x, z });
    }
  }
  return cells;
}

/** The slope of a gem's pavilion (culet depth / girdle radius, src/physics/items.ts gemItem). */
const PAVILION_SLOPE = 0.86;
/** A gem lying on a pavilion facet rests with its table tilted by this much (the facet lies flat). */
const SIDE_TILT = Math.atan(PAVILION_SLOPE);

/**
 * A quarter of the gems lie table-down, the rest on a pavilion facet; coins lie flat. Random yaw.
 * Every piece is placed in its resting pose at its resting height, so a fresh pile barely moves
 * while it settles (a gem tipped further rolled back about a centimetre into its neighbours).
 */
function restingPose(k: RushPiece, spec: ItemSpec, rng: () => number): { rot: [number, number, number, number]; y: number } {
  const yaw = yawQuat(rng() * Math.PI * 2);
  const clear = 0.001;
  if (k.look === 'coin') return { rot: yaw, y: spec.size[1] / 2 + clear };
  const r = spec.footprint;
  // Table down: half a turn about x; the girdle sits one crown height up.
  if (rng() < 0.25) return { rot: mulQuat(yaw, [1, 0, 0, 0]), y: spec.comHeight + clear };
  // On a pavilion facet: the girdle centre is the facet line's distance from it above the floor.
  const y = (r * PAVILION_SLOPE) / Math.hypot(1, PAVILION_SLOPE) + clear;
  return { rot: mulQuat(yaw, [Math.sin(SIDE_TILT / 2), 0, 0, Math.cos(SIDE_TILT / 2)]), y };
}

/** The last part of an off-screen settle (s) runs without ItemField's extra damping (RushField.settle). */
const UNDAMPED_TAIL = 0.75;

export class RushField extends ItemField {
  protected readonly refillShare = 0.5;
  /** Loose gems rock on their facets for a while; a slow rock is at rest for the eye (no stacks to lean). */
  protected override readonly settleSpeed = 0.012;

  /**
   * ItemField's off-screen settle, then, if the pile is not at rest by the last `UNDAMPED_TAIL`
   * seconds, plain physics steps for those. Damping every step keeps a piece that is wedged (a coin
   * pressed 6 mm into the floor under the edge of a ruby, about one fresh pile in thirty at the 9 cm
   * pitch) from rocking free, so it shivers on until the cap; without it the solver frees it at once.
   */
  override settle(maxSeconds = 2.5, preStep?: () => void, postStep?: () => void): number {
    const damped = super.settle(Math.max(FIXED_DT, maxSeconds - UNDAMPED_TAIL), preStep, postStep);
    if (this.phys.maxToySpeed() < this.settleSpeed) return damped;
    const maxSteps = Math.round((maxSeconds - damped) / FIXED_DT);
    let calm = 0;
    let ran = 0;
    while (ran < maxSteps) {
      preStep?.();
      this.phys.step();
      postStep?.();
      ran++;
      calm = this.phys.maxToySpeed() < this.settleSpeed ? calm + 1 : 0;
      if (calm > 30) break;
    }
    this.phys.snapPoses();
    return damped + ran * FIXED_DT;
  }
  constructor(
    phys: PhysicsWorld,
    options: FieldOptions,
    private readonly p: RushParams,
  ) {
    super(phys, options);
  }

  protected layout(rng: () => number): ToyBody[] {
    const counts = pieceCounts(this.p.pieces);
    const kinds: RushPiece[] = [];
    RUSH_PIECES.forEach((k, i) => {
      for (let c = 0; c < counts[i]!; c++) kinds.push(k);
    });
    // Shuffle the pieces, then shuffle the cells: a seeded, even spread of values over the floor.
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
    }
    const cells = pileCells();
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [cells[i], cells[j]] = [cells[j]!, cells[i]!];
    }
    const onTop = Math.min(kinds.length, Math.round(kinds.length * RUSH_TUNING.topShare));
    const layer = Math.min(cells.length, kinds.length - onTop);
    const placed: ToyBody[] = [];
    for (let i = 0; i < kinds.length; i++) {
      const k = kinds[i]!;
      const spec = pieceSpec(k, this.p.radiusScale);
      // First layer on its own cell; the rest a little above a random first-layer cell.
      const base = i < layer ? cells[i]! : cells[Math.floor(rng() * Math.max(1, layer))]!;
      const top = i >= layer;
      const jx = (rng() * 2 - 1) * RUSH_TUNING.jitter;
      const jz = (rng() * 2 - 1) * RUSH_TUNING.jitter;
      const pose = restingPose(k, spec, rng);
      const y = top ? 0.09 + rng() * 0.02 : pose.y;
      placed.push(this.phys.addItem(spec, this.themeId, [base.x + jx, y, base.z + jz], pose.rot));
    }
    return placed;
  }
}

/* ------------------------------------------------------------ one try */

export class RushRules extends ItemRules {
  /** The release is over the chute itself and RELEASING already waited: a quick turnaround. */
  protected override readonly settleWait = { holding: 0.3, empty: 0.3 };
  constructor() {
    super('rush', { x: CLAW.homeX, z: CLAW.homeZ });
  }

  /** The chute, always: whatever the fingers caged rides along. */
  transportTarget(ctx: TryContext, holding: boolean): TransportPlan {
    return { x: CLAW.dropX, z: CLAW.dropZ, speed: ctx.params.moveSpeed * (holding ? 0.92 : 1), toOpening: true };
  }
}

/* ------------------------------------------------------------ the pilot */

/** Pieces whose neighbourhood counts as one grab (the open finger tips reach about 0.10 m). */
const CLUSTER_RADIUS = 0.07;

/**
 * Attract pilot (section 3.3): the best value / (1 + distance) target with room around it (not
 * against the glass or the chute guard), where the value is that of the pieces within reach of one
 * grab around it. Aimed at its centre of mass; patience 1.0 s.
 */
export function rushAim(core: GameCore, _demoRound: number, _p: RushParams): AimPlan | null {
  const pieces: { toy: ToyBody; x: number; z: number; value: number }[] = [];
  for (const toy of core.field.onField()) {
    if (!toy.item) continue;
    const c = toy.body.worldCom(core.phys.scratchV);
    if (c.y < 0 || c.y > 0.2) continue;
    pieces.push({ toy, x: c.x, z: c.z, value: toy.item.value });
  }
  const cx = core.claw.trolleyX;
  const cz = core.claw.trolleyZ;
  let best: (typeof pieces)[number] | null = null;
  let bestScore = -Infinity;
  for (const p of pieces) {
    if (p.x < CLAW.minX || p.x > CLAW.maxX || p.z < CLAW.minZ || p.z > CLAW.maxZ) continue;
    // Room for the fingers: clear of the chute guard and the glass.
    if (!isFreeSpot(p.x, p.z, 0.03)) continue;
    let value = 0;
    for (const q of pieces) if (Math.hypot(q.x - p.x, q.z - p.z) < CLUSTER_RADIUS) value += q.value;
    const score = value / (1 + Math.hypot(p.x - cx, p.z - cz));
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best) return null;
  return { x: best.x, z: best.z, patience: 1, targetToyId: best.toy.id };
}

/* ------------------------------------------------------------ the module */

/** Item awards in READY … SETTLING (section 3.0). */
const ITEM_PHASES: readonly RoundPhase[] = ['READY', 'AIMING', 'DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING'];

export const rushModule: GenreModule<'rush'> = {
  genre: 'rush',
  defaults: RUSH_DEFAULTS,
  presentation: 'items',
  awardPhases: new Set(ITEM_PHASES),
  fromSettings: (s) => ({ seconds: s.rush.seconds, pieces: s.rush.pieces, rewardValue: s.rush.rewardValue }),
  // The classic cabinet, unchanged (the same object: the classic dressing draws it).
  geometry: () => CLASSIC_FIELD,
  session: (p) => ({ kind: 'timed', seconds: p.seconds }),
  controls: () => 'joystick',
  roundParams: (base, p) => scaleClaw(base, p.claw),
  createRules: () => new RushRules(),
  createField: (phys, options, p) => {
    // The rush claw carries the scoop (fitted while the stack is built, before the first settle).
    fitScoop(phys, RUSH_SCOOP);
    return new RushField(phys, options, p);
  },
  scoreTry: (input) => scoreItemsTry(input, RUSH_SCORE),
  sessionReward: (s, p, prints) => rushReward(s, p, prints),
  aim: (core, demoRound, p) => rushAim(core, demoRound, p),
};
