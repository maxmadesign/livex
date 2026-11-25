/**
 * TUMBLE SHELF (docs/design/machines.md, section 3.2). Stacks of small printed snack boxes stand on
 * a raised shelf with a lip. The claw knocks, drags or carries them over the edge, and every box
 * that reaches the trough in front of the shelf counts (several per try are possible).
 *
 *   - the trough is the front-left half (inside the prize bin's footprint, so the bin and the lower
 *     cabinet stay as they are); a slick gutter drains the front-right half into it;
 *   - a try is a full lift, then the claw always carries forward to `dropZ` and opens there;
 *   - a session is `tries` tries (5); at least `rewardItems` boxes (5; sweep: 41 % of Arcade sessions) earn one prize: the rarest
 *     printed character among the dropped boxes (the earliest drop wins a tie).
 *
 * Outcomes are physical: a box counts when it really is in the trough (section 2.5).
 */
import type { RoundPhase } from '../../core/types';
import type { Fixture, FieldGeometry, PrizeOpening } from '../../physics/fieldGeometry';
import { CLAW } from '../../physics/fieldSpec';
import { boxItem, type ItemLook } from '../../physics/items';
import type { PhysicsWorld, ToyBody } from '../../physics/PhysicsWorld';
import type { GameCore } from '../GameCore';
import { rarityOf, type RarityTier } from '../rarity';
import type { FieldOptions } from '../ToyField';
import { ItemField, ItemRules, PrintPool, rarestPrint, scaleClaw, scaleMix, scoreItemsTry, yawQuat, type ItemsScoreRules } from './pieces';
import type { AimPlan, GenreModule, ShelfParams, TransportPlan, TryContext } from './types';

/* ------------------------------------------------------------ tuning */

/** Defaults of section 3.2. The settings group `machines.shelf` maps onto tries, rewardItems and lipHeight. */
export const SHELF_DEFAULTS: ShelfParams = {
  shelfY: 0.16,
  shelfFront: -0.3,
  lipHeight: 0.014,
  shelfFriction: 0.55,
  rowsZ: [-0.39, -0.53],
  columnsX: [-0.3, -0.1, 0.1, 0.3],
  stackHeight: 3,
  tries: 5,
  rewardItems: 5,
  dropZ: -0.18,
  // A weak claw with no grip assist (tools/dev/sweeps/shelf.ts): it can lift one box, a whole stack
  // only now and then. The design's ×0.6 assist let it carry a full stack on almost every try.
  claw: { gripAssist: 0, clawForce: 0.4 },
};

/** The slick strip in front of the right half of the shelf: it slopes down to the trough. */
export const GUTTER = { lowY: 0.02, highY: 0.1, thickness: 0.02, friction: 0.05, restitution: 0.02 } as const;
/** The chrome lip along the shelf's front edge (its height is `lipHeight`). */
export const LIP = { depth: 0.012, friction: 0.4, restitution: 0.05 } as const;

export interface SnackKind {
  look: Extract<ItemLook, 'snackS' | 'snackM' | 'snackL'>;
  /** Width (x) × height (y) × depth (z); the wide face looks at the player. */
  size: [number, number, number];
  mass: number;
  round: number;
  /** The characters that may be printed on it. */
  tiers: readonly RarityTier[];
  /** Points factor of the size. */
  factor: number;
  /** Stacks of this size in the nominal layout of 8 stacks (60 / 30 / 10 % of the items). */
  stacks: number;
}

/** Sizes and prints of section 3.2; masses 1.5× the design's 40 / 60 / 90 g (the sweep's fairness band). */
export const SNACKS: readonly SnackKind[] = [
  { look: 'snackS', size: [0.055, 0.055, 0.055], mass: 0.06, round: 0.003, tiers: ['common', 'rare'], factor: 1, stacks: 5 },
  { look: 'snackM', size: [0.075, 0.06, 0.05], mass: 0.09, round: 0.003, tiers: ['common', 'rare', 'epic', 'legendary'], factor: 1.25, stacks: 2 },
  { look: 'snackL', size: [0.09, 0.075, 0.06], mass: 0.135, round: 0.003, tiers: ['rare', 'epic', 'legendary'], factor: 1.5, stacks: 1 },
];
/**
 * Snack material and placement. Plain numbers so the sweep (tools/dev/sweeps/shelf.ts --tune) can
 * try others; the game never changes them.
 */
export const SHELF_TUNING = {
  /** Item friction (snacks keep their own material; the plush friction setting does not apply). */
  snackFriction: 0.6,
  /** Multiplies every snack's mass. */
  massScale: 1,
  /** Placement jitter: ±4 mm and ±6°. */
  jitterXZ: 0.004,
  jitterYawDeg: 6,
};
/** A hair of air between stacked boxes so they never start interpenetrating. */
const STACK_GAP = 0.0005;

/** Points of a print by tier (section 3.2). */
export const SHELF_TIER_POINTS: Readonly<Record<RarityTier, number>> = { common: 40, rare: 100, epic: 200, legendary: 400 };

/** Multi-drop factor for n boxes in one try (capped at ×2). */
export function multiDropFactor(n: number): number {
  if (n >= 4) return 2;
  if (n === 3) return 1.5;
  if (n === 2) return 1.2;
  return 1;
}

const SNACK_BY_LOOK = new Map<string, SnackKind>(SNACKS.map((s) => [s.look, s]));

export const SHELF_SCORE: ItemsScoreRules = {
  itemPoints: (item) => SHELF_TIER_POINTS[rarityOf(item.print)] * (SNACK_BY_LOOK.get(item.look)?.factor ?? 1),
  groupFactor: (n) => ({ factor: multiDropFactor(n), key: 'multiDrop' }),
};

/* ------------------------------------------------------------ geometry */

/** The trough: the front-left half of the floor, from the shelf's front face to the front glass. */
export function troughOpening(p: ShelfParams): PrizeOpening {
  return { xMin: -0.5, xMax: 0, zMin: p.shelfFront, zMax: 0, sensorTop: -0.1, sensorBottom: -0.3, awardComY: -0.06, overMargin: 0.02 };
}

export function shelfGeometry(p: ShelfParams): FieldGeometry {
  const opening = troughOpening(p);
  const depth = p.shelfFront + 0.8;
  const fixtures: Fixture[] = [
    {
      id: 'shelf',
      kind: 'shelf',
      look: 'deck',
      shape: { type: 'box', half: [0.5, p.shelfY / 2, depth / 2] },
      center: [0, p.shelfY / 2, (-0.8 + p.shelfFront) / 2],
      friction: p.shelfFriction,
      restitution: 0.02,
    },
  ];
  if (p.lipHeight >= 0.001) {
    fixtures.push({
      id: 'lip',
      kind: 'lip',
      look: 'chrome',
      shape: { type: 'box', half: [0.5, p.lipHeight / 2, LIP.depth / 2] },
      center: [0, p.shelfY + p.lipHeight / 2, p.shelfFront - LIP.depth / 2],
      friction: LIP.friction,
      restitution: LIP.restitution,
    });
  }
  // The gutter: a slab whose top runs from (0, lowY) to (0.5, highY), turned about +z.
  const rise = GUTTER.highY - GUTTER.lowY;
  const angle = Math.atan2(rise, 0.5);
  const half = Math.hypot(0.5, rise) / 2;
  const t = GUTTER.thickness / 2;
  fixtures.push({
    id: 'gutter',
    kind: 'gutter',
    look: 'ramp',
    shape: { type: 'box', half: [half, t, -p.shelfFront / 2] },
    // The centre sits half a thickness below the middle of the top surface, along its normal.
    center: [0.25 + t * Math.sin(angle), (GUTTER.lowY + GUTTER.highY) / 2 - t * Math.cos(angle), p.shelfFront / 2],
    rot: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)],
    friction: GUTTER.friction,
    restitution: GUTTER.restitution,
    frictionCombine: 'min',
  });
  return {
    floor: { kind: 'hole', hole: { xMin: opening.xMin, xMax: opening.xMax, zMin: opening.zMin, zMax: opening.zMax } },
    chuteGuard: false,
    opening,
    fixtures,
    home: { x: CLAW.homeX, z: CLAW.homeZ },
  };
}

/* ------------------------------------------------------------ field */

export interface StackSpot {
  x: number;
  z: number;
  kind: SnackKind;
  height: number;
}

/** The stacks of one layout: every row × column spot gets a size (seeded), S and M `stackHeight` high, L one lower. */
export function stackPlan(p: ShelfParams, rng: () => number): StackSpot[] {
  const spots: { x: number; z: number }[] = [];
  for (const z of p.rowsZ) for (const x of p.columnsX) spots.push({ x, z });
  const counts = scaleMix(
    SNACKS.map((s) => s.stacks),
    spots.length,
    SNACKS.map((s) => (s.look === 'snackS' ? 1 : 0)),
  );
  const kinds: SnackKind[] = [];
  SNACKS.forEach((s, i) => {
    for (let k = 0; k < counts[i]!; k++) kinds.push(s);
  });
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
  }
  return spots.map((s, i) => {
    const kind = kinds[i]!;
    const height = Math.max(1, kind.look === 'snackL' ? p.stackHeight - 1 : p.stackHeight);
    return { ...s, kind, height };
  });
}

export class ShelfField extends ItemField {
  protected readonly refillShare = 0.6;
  constructor(
    phys: PhysicsWorld,
    options: FieldOptions,
    private readonly p: ShelfParams,
  ) {
    super(phys, options);
  }

  protected layout(rng: () => number): ToyBody[] {
    const pools = new Map(SNACKS.map((s) => [s.look, new PrintPool(this.assets, s.tiers, rng)]));
    const placed: ToyBody[] = [];
    for (const spot of stackPlan(this.p, rng)) {
      const k = spot.kind;
      for (let level = 0; level < spot.height; level++) {
        const t = SHELF_TUNING;
        const jx = (rng() * 2 - 1) * t.jitterXZ;
        const jz = (rng() * 2 - 1) * t.jitterXZ;
        const yaw = (((rng() * 2 - 1) * t.jitterYawDeg) / 180) * Math.PI;
        const spec = boxItem({ look: k.look, size: k.size, mass: k.mass * t.massScale, round: k.round, friction: t.snackFriction, print: pools.get(k.look)!.next() });
        const y = this.p.shelfY + level * (k.size[1] + STACK_GAP) + STACK_GAP;
        placed.push(this.phys.addItem(spec, this.themeId, [spot.x + jx, y, spot.z + jz], yawQuat(yaw)));
      }
    }
    return placed;
  }
}

/* ------------------------------------------------------------ one try */

export class ShelfRules extends ItemRules {
  constructor(private readonly p: ShelfParams) {
    super('shelf', { x: CLAW.homeX, z: CLAW.homeZ });
  }

  /** Forward, always: straight towards the player to `dropZ` (the trough, or the gutter that drains into it). */
  transportTarget(ctx: TryContext, holding: boolean): TransportPlan {
    return { x: ctx.claw.trolleyX, z: Math.min(CLAW.maxZ, this.p.dropZ), speed: ctx.params.moveSpeed * (holding ? 0.92 : 1.1), toOpening: true };
  }
}

/* ------------------------------------------------------------ the pilot */

/** Boxes resting on the shelf (not fallen, not on the gutter). */
function shelfItems(core: GameCore, p: ShelfParams): ToyBody[] {
  return core.field.onField().filter((t) => {
    if (!t.item) return false;
    const c = t.body.worldCom(core.phys.scratchV);
    return c.y > p.shelfY && c.z < p.shelfFront + 0.02;
  });
}

/**
 * Attract pilot (section 3.2): the stack whose front box is closest to the lip, aimed 4 cm in front
 * of it so the closing back finger drags it towards the edge; every third demo round the top of a
 * back-row stack instead. Patience 1.5 s.
 */
export function shelfAim(core: GameCore, demoRound: number, p: ShelfParams): AimPlan | null {
  const items = shelfItems(core, p);
  if (items.length === 0) return null;
  const com = (t: ToyBody) => {
    const c = t.body.worldCom(core.phys.scratchV);
    return { x: c.x, y: c.y, z: c.z };
  };
  const inReach = (x: number) => x >= CLAW.minX && x <= CLAW.maxX;
  const back = p.rowsZ.length > 1 ? Math.min(...p.rowsZ) : -Infinity;
  let pick: ToyBody | null = null;
  let aimZ = 0;
  if (demoRound % 3 === 2) {
    // The highest box of the back row.
    let best = -Infinity;
    for (const t of items) {
      const c = com(t);
      if (!inReach(c.x) || c.z > back + 0.07 || c.y <= best) continue;
      best = c.y;
      pick = t;
      aimZ = c.z;
    }
  }
  if (!pick) {
    let best = -Infinity;
    for (const t of items) {
      const c = com(t);
      if (!inReach(c.x) || c.z <= best) continue;
      best = c.z;
      pick = t;
      aimZ = c.z + 0.04;
    }
  }
  if (!pick) return null;
  const c = com(pick);
  return {
    x: Math.min(CLAW.maxX, Math.max(CLAW.minX, c.x)),
    z: Math.min(CLAW.maxZ, Math.max(CLAW.minZ, aimZ)),
    patience: 1.5,
    targetToyId: pick.id,
  };
}

/* ------------------------------------------------------------ the module */

/** Item awards in READY … SETTLING (section 3.0): a box that falls during RESULT counts for the next try. */
const ITEM_PHASES: readonly RoundPhase[] = ['READY', 'AIMING', 'DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING'];

export const shelfModule: GenreModule<'shelf'> = {
  genre: 'shelf',
  defaults: SHELF_DEFAULTS,
  presentation: 'items',
  awardPhases: new Set(ITEM_PHASES),
  fromSettings: (s) => ({ tries: s.shelf.tries, rewardItems: s.shelf.rewardItems, lipHeight: s.shelf.lipHeight }),
  geometry: (p) => shelfGeometry(p),
  session: (p) => ({ kind: 'tries', tries: p.tries }),
  controls: () => 'joystick',
  roundParams: (base, p) => scaleClaw(base, p.claw),
  createRules: (p) => new ShelfRules(p),
  createField: (phys, options, p) => new ShelfField(phys, options, p),
  scoreTry: (input) => scoreItemsTry(input, SHELF_SCORE),
  sessionReward: (s, p) => {
    if (!(p.rewardItems > 0) || s.items.length < p.rewardItems) return null;
    const print = rarestPrint(s.items);
    return print ? { typeId: print } : null;
  },
  aim: (core, demoRound, p) => shelfAim(core, demoRound, p),
};
