/**
 * TIPPY BRIDGE (docs/design/machines.md, section 3.1; tuning in docs/machines/bridge.md).
 *
 * A printed box lies across two chrome bars over a pit. The claw cannot carry it away: it lifts one
 * end a few centimetres (a partial lift, pure friction, no grip assist) and lets go where it is.
 * Between tries the box stays exactly where physics left it. The box is won when physics drops it
 * through the pit into the prize bin: the same opening test as classic (centre of mass below the
 * floor, over the opening, a collider in the sensor). Nothing else decides a win.
 *
 * The pit lies inside the classic prize bin's footprint, so the bin, the lower cabinet and the
 * prize window stay as they are.
 *
 * Parts:
 *   bridgeGeometry   the bars, the four acrylic fences, the hole and its sensor (from BridgeParams)
 *   BridgeField      the box: seeded start pose, at-rest refills, staff reset, takeover reset
 *   BridgeRules      one try: partial lift, in-place release, wind-up before going home, settle to
 *                    calm, the award, progress, stuck detection and the optional two-step input
 *   bridgeAim        the attract pilot's strategy (pure; MachinePilot steers with it)
 *   bridgeModule     the GenreModule the registry holds
 */
import { clamp, hashString, makeRng } from '../../core/math';
import type { Quat, RoundPhase, RoundResult, Vec3 } from '../../core/types';
import { overOpening, type FieldGeometry, type Fixture, type PrizeOpening, type Rect } from '../../physics/fieldGeometry';
import { CLAW, FIXED_DT } from '../../physics/fieldSpec';
import { boxItem, type ItemSpec } from '../../physics/items';
import type { PhysicsWorld, ToyBody } from '../../physics/PhysicsWorld';
import type { PlushAsset } from '../../plush/manifest';
import type { GameCore } from '../GameCore';
import type { RoundParams } from '../RoundController';
import type { FieldOptions } from '../ToyField';
import type { AimPlan, BridgeParams, ClawScale, GenreModule, MachineField, TransportPlan, TryContext, TryRules } from './types';

/* ------------------------------------------------------------ parameters */

/**
 * Defaults of section 3.1 as tuned by the sweeps (docs/machines/bridge.md). The four values that
 * are also settings (gap, boxMass, triesPerBox, controls) keep the settings defaults. Changed from
 * the design's numbers, each for a measured reason (docs/machines/bridge.md, "Tuning"):
 *  - box depth 0.13 → 0.10 m: the open claw spreads 0.15 m front to back between its finger tips,
 *    so a 0.13 m box always had a finger landing on its top and no try could ever lift an end;
 *  - bar friction 0.35 → 0.15 with the bar's friction winning (slick chrome, BRIDGE_LAYOUT.barCombine):
 *    a lifted end lets the box slide on the other bar, so tries add up instead of cancelling out;
 *  - claw force ×0.8 → ×1.0 (the difficulty preset's own): ×0.8 lifts nothing, ×1.1-1.2 let a
 *    lucky squeeze hang the whole box from the claw more often (one-try wins from random aims).
 */
export const BRIDGE_DEFAULTS: BridgeParams = {
  centerX: -0.2,
  centerZ: -0.22,
  gap: 0.15,
  barRadius: 0.012,
  barY: 0.1,
  barFriction: 0.15,
  box: [0.24, 0.1, 0.1],
  boxMass: 0.4,
  boxFriction: 0.6,
  startJitter: 0.01,
  startYawDeg: 4,
  liftDelta: 0.08,
  triesPerBox: 0,
  controls: 'joystick',
  claw: { moveSpeed: 0.9, descendSpeed: 0.8, liftSpeed: 0.6, clawForce: 1, gripAssist: 0 },
};

export interface BridgeLayout {
  pitHalfX: number;
  pitHalfZ: number;
  barHalfLength: number;
  fenceHeight: number;
  fenceThickness: number;
  home: { x: number; z: number };
  twoStepHome: { x: number; z: number };
  startJitterZ: number;
  barCombine: 'average' | 'min';
}

/**
 * Layout numbers of section 3.1 that are not BridgeParams (whose shape is frozen). The game never
 * changes them; the sweeps may, to measure alternatives (tools/dev/sweeps/bridge.ts).
 */
export const BRIDGE_LAYOUT: BridgeLayout = {
  /** Half size of the pit (and of its hole in the floor) around (centerX, centerZ). */
  pitHalfX: 0.22,
  pitHalfZ: 0.16,
  /** Half length of the straight part of each bar (along z). */
  barHalfLength: 0.15,
  /** Acrylic fences around the pit (design 0.16 m; 0.22 m keeps a box that slides fast on the slick bars inside). */
  fenceHeight: 0.22,
  fenceThickness: 0.01,
  /** Joystick home: right of the pit, towards the back, clear of the box. */
  home: { x: 0.2, z: -0.5 },
  /** Two-step home: front-left corner; button 1 moves +x, button 2 moves −z (back). */
  twoStepHome: { x: CLAW.minX, z: CLAW.maxZ },
  /** The start pose's jitter along z is this many times `startJitter` (section 3.1: ±0.02 m). */
  startJitterZ: 2,
  /** How the bars' friction combines with the box's: 'min' = the slick chrome wins. */
  barCombine: 'min',
};

/** Calm = the box moves slower than this (m/s, rad/s) for CALM_SECONDS (section 3.0). */
const CALM_SPEED = 0.02;
const CALM_SPIN = 0.2;
const CALM_SECONDS = 0.3;
/** SETTLING gives up waiting for a calm box after this long, once the claw is up (the watchdog at 7 s stays behind it). */
const SETTLE_CAP = 5;
/** The trolley must have left the release spot by this much before the try may end. */
const SETTLE_MOVED = 0.05;
/** Wind-up: the fingers get this long to come free of the box before the cable winds up (s)… */
const FREE_MAX = 0.5;
/** …and count as free after this long without touching it (s). */
const FREE_CLEAR = 0.1;
/** While the claw still touches the box the cable winds up this slowly (m/s)… */
const SLOW_WIND = 0.06;
/**
 * …and, once the box rises with the claw (a finger hooked into it: its centre of mass this far above
 * where it was when the wind-up began), it stops whenever the cable pulls harder than the claw's
 * own weight plus CLUTCH_EXTRA (N): a slip clutch that can tip one end but never lift the box.
 */
const HOOK_RISE = 0.008;
const CLUTCH_EXTRA = 2;
/**
 * Contact that is only rubbing (the box does not rise) winds slowly for at most this long (s). A
 * finger caught under a bar is pulled free by the winch as in classic: only the claw jolts then.
 */
const SLOW_MAX = 1.5;

const CLAW_WEIGHT = (CLAW.hubMass + 3 * CLAW.fingerMass) * 9.81;
/** A clutch hold longer than this (s) pays the cable out by BOB_DROP for BOB_TIME, so a hooked finger can come free. */
const BOB_AFTER = 0.4;
const BOB_DROP = 0.03;
const BOB_TIME = 0.3;
/** The field places a box only once every claw part is above this height over the pit (m above the box top). */
const PLACE_CLEARANCE = 0.06;
/** Tilt at which `progress` reads 1 (deg). */
const TILT_FULL_DEG = 25;
/**
 * Stuck: consecutive "stale" tries off the bars, a stale try being one that moved the box less than
 * STALE_MOVE and turned it less than STALE_TURN_DEG. (Progress saturates at 1 for a tilted box, so
 * the pose itself is compared.) A wedged box is stuck after one stale try, any other box after three.
 */
const STALE_MOVE = 0.005;
const STALE_TURN_DEG = 3;
const STALE_TRIES = 3;
/** Stuck: wedged this far below the resting height (m): section 3.1's "COM y < 0.12" for the defaults. */
const WEDGE_DROP = 0.0425;

const BRIDGE_AWARD_PHASES: ReadonlySet<RoundPhase> = new Set(['DESCENDING', 'CLOSING', 'LIFTING', 'TRANSPORTING', 'RELEASING', 'SETTLING']);

/* ------------------------------------------------------------ geometry */

/** x of the two bar centres. */
export function barCentres(p: BridgeParams): [number, number] {
  const off = p.gap / 2 + p.barRadius;
  return [p.centerX - off, p.centerX + off];
}

/** Height of the box's centre of mass when it lies flat on both bars. */
export function restComY(p: BridgeParams): number {
  return p.barY + p.barRadius + p.box[1] / 2;
}

export function bridgePit(p: BridgeParams): Rect {
  return { xMin: p.centerX - BRIDGE_LAYOUT.pitHalfX, xMax: p.centerX + BRIDGE_LAYOUT.pitHalfX, zMin: p.centerZ - BRIDGE_LAYOUT.pitHalfZ, zMax: p.centerZ + BRIDGE_LAYOUT.pitHalfZ };
}

/** The static layout: a hole under the bars, two capsule bars along z and four acrylic fences around the pit. */
export function bridgeGeometry(p: BridgeParams): FieldGeometry {
  const pit = bridgePit(p);
  const opening: PrizeOpening = { ...pit, sensorTop: -0.1, sensorBottom: -0.3, awardComY: -0.06, overMargin: 0.02 };
  const [left, right] = barCentres(p);
  const h = BRIDGE_LAYOUT.fenceHeight / 2;
  const t = BRIDGE_LAYOUT.fenceThickness / 2;
  const sideHalfZ = BRIDGE_LAYOUT.pitHalfZ + t;
  const endHalfX = BRIDGE_LAYOUT.pitHalfX + 2 * t;
  const bar = (id: string, x: number): Fixture => ({
    id,
    kind: 'bar',
    look: 'chrome',
    shape: { type: 'capsule', axis: 'z', halfLength: BRIDGE_LAYOUT.barHalfLength, radius: p.barRadius },
    center: [x, p.barY, p.centerZ],
    friction: p.barFriction,
    restitution: 0.05,
    ...(BRIDGE_LAYOUT.barCombine === 'min' ? { frictionCombine: 'min' as const } : {}),
  });
  const fence = (id: string, center: Vec3, half: Vec3, friction: number, restitution: number): Fixture => ({ id, kind: 'fence', look: 'acrylic', shape: { type: 'box', half }, center, friction, restitution });
  return {
    floor: { kind: 'hole', hole: pit },
    chuteGuard: false,
    opening,
    fixtures: [
      bar('barL', left),
      bar('barR', right),
      fence('sideL', [pit.xMin - t, h, p.centerZ], [t, h, sideHalfZ], 0.3, 0.1),
      fence('sideR', [pit.xMax + t, h, p.centerZ], [t, h, sideHalfZ], 0.3, 0.1),
      fence('endBack', [p.centerX, h, pit.zMin - t], [endHalfX, h, t], 0.4, 0.05),
      fence('endFront', [p.centerX, h, pit.zMax + t], [endHalfX, h, t], 0.4, 0.05),
    ],
    home: p.controls === 'twoStep' ? { ...BRIDGE_LAYOUT.twoStepHome } : { ...BRIDGE_LAYOUT.home },
  };
}

/** The printed box (its origin is the middle of its bottom face). */
export function bridgeBoxSpec(p: BridgeParams, print: string | null): ItemSpec {
  return boxItem({ look: 'bridgeBox', size: [...p.box], mass: p.boxMass, round: 0.004, friction: p.boxFriction, print });
}

/* ------------------------------------------------------------ pose helpers (pure) */

/** Rotates v by the unit quaternion q (x, y, z, w). */
function rotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

export interface BoxPose {
  /** Centre of mass (world). */
  com: Vec3;
  rot: Quat;
}

export interface BridgeProgress {
  shift: number;
  tilt: number;
  turn: number;
  /** max(shift, tilt, turn), 0..1 (presentation and guide only). */
  progress: number;
  /** Tilt of the box's up axis from vertical (deg). */
  tiltDeg: number;
  /** Yaw of the box's long axis from the bars' normal (deg, 0 = across both bars). */
  yawDeg: number;
  /** Length of the box measured across the bars (along x) in the xz plane. */
  span: number;
}

/**
 * Progress of section 3.1, each part clamped to 0..1:
 *   shift = |COM.x − centerX| / (gap / 2 + barRadius)
 *   tilt  = |tilt| / 25°
 *   turn  = (L − span) / (L − gap), span = L·|cos yaw| + W·|sin yaw|
 */
export function bridgeProgress(p: BridgeParams, pose: BoxPose): BridgeProgress {
  const [L, , W] = p.box;
  const ax = rotate(pose.rot, [1, 0, 0]);
  const ay = rotate(pose.rot, [0, 1, 0]);
  const flat = Math.hypot(ax[0], ax[2]);
  const cos = flat > 1e-6 ? Math.abs(ax[0]) / flat : 1;
  const sin = flat > 1e-6 ? Math.abs(ax[2]) / flat : 0;
  const span = L * cos + W * sin;
  const tiltDeg = (Math.acos(clamp(Math.abs(ay[1]), 0, 1)) * 180) / Math.PI;
  const shift = clamp(Math.abs(pose.com[0] - p.centerX) / (p.gap / 2 + p.barRadius), 0, 1);
  const tilt = clamp(tiltDeg / TILT_FULL_DEG, 0, 1);
  const turn = clamp((L - span) / Math.max(1e-6, L - p.gap), 0, 1);
  return { shift, tilt, turn, progress: Math.max(shift, tilt, turn), tiltDeg, yawDeg: (Math.atan2(sin, cos) * 180) / Math.PI, span };
}

/** True while the box lies flat across both bars (it may still be shifted or turned). */
export function restsOnBars(p: BridgeParams, pose: BoxPose): boolean {
  const g = bridgeProgress(p, pose);
  return pose.com[1] > restComY(p) - 0.012 && g.tiltDeg < 8;
}

export function boxPose(box: ToyBody): BoxPose {
  const c = box.body.worldCom();
  const r = box.body.rotation();
  return { com: [c.x, c.y, c.z], rot: [r.x, r.y, r.z, r.w] };
}

/** Angle between two orientations (deg). */
function turnDeg(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

function boxSpeed(box: ToyBody): { lin: number; ang: number } {
  const v = box.body.linvel();
  const w = box.body.angvel();
  return { lin: Math.hypot(v.x, v.y, v.z), ang: Math.hypot(w.x, w.y, w.z) };
}

/** True while any claw collider (hub or finger) is in contact with the box. */
export function clawTouches(phys: PhysicsWorld, box: ToyBody): boolean {
  let touching = false;
  for (const c of box.colliders) {
    phys.world.contactPairsWith(c.collider, (other) => {
      if (touching || !phys.clawColliders.has(other.handle)) return;
      phys.world.contactPair(c.collider, other, (manifold) => {
        if (manifold.numContacts() > 0) touching = true;
      });
    });
    if (touching) return true;
  }
  return false;
}

/* ------------------------------------------------------------ shared state */

/** What the field and the rules of one physics stack share (both are built per stack). */
export interface BridgeState {
  /** The box in play (null while none is placed; inBin once won). */
  box: ToyBody | null;
  /** Tries on the current box since it was placed (staff resets included). */
  tries: number;
  /** Tries since the box was last put on its start pose (triesPerBox counts these). */
  triesSinceReset: number;
  /** Consecutive tries that left the box off the bars and unmoved. */
  staleTries: number;
  stuck: boolean;
  /** Why the box counts as stuck ('wedged' below its resting height, 'stale' unmoved for tries). */
  stuckReason: 'wedged' | 'stale' | null;
  /** Progress after the last try (null before the first). */
  progress: number | null;
  /** The box passed the opening test outside an award phase; awarded at the next DESCENDING … SETTLING. */
  dropped: boolean;
  /** Start-pose resets so far (each gives the next seeded pose). */
  resets: number;
  /** Boxes placed so far (the print sequence). */
  boxes: number;
  /** Staff resets so far (stats, sweeps). */
  staffResets: number;
}

const states = new WeakMap<PhysicsWorld, BridgeState>();

/** The bridge state of a physics world (created on first use). */
export function bridgeState(phys: PhysicsWorld): BridgeState {
  let s = states.get(phys);
  if (!s) {
    s = { box: null, tries: 0, triesSinceReset: 0, staleTries: 0, stuck: false, stuckReason: null, progress: null, dropped: false, resets: 0, boxes: 0, staffResets: 0 };
    states.set(phys, s);
  }
  return s;
}

/** The opening test of section 2.5 (centre of mass below awardComY, over the opening, a collider in the sensor). */
export function inOpening(phys: PhysicsWorld, toy: ToyBody, o: PrizeOpening = phys.opening): boolean {
  const com = toy.body.worldCom(phys.scratchV);
  if (com.y > o.awardComY || !overOpening(o, com.x, com.z)) return false;
  return phys.sensorHits.has(toy) || phys.isInPrizeSensor(toy);
}

/* ------------------------------------------------------------ field */

/**
 * The box on the bars. A box is placed at rest on its seeded start pose (only at round boundaries;
 * GameCore settles it off-screen), stays wherever physics leaves it between tries, and is replaced
 * by the next printed box at the boundary after it was won.
 */
export class BridgeField implements MachineField {
  private assets: PlushAsset[] = [];
  private seed: number;
  private printOrder: string[] = [];
  private readonly state: BridgeState;
  /** A placement waiting for the claw to clear the pit (done inside the next off-screen settle). */
  private pending: 'new' | 'reset' | null = null;

  constructor(
    private readonly phys: PhysicsWorld,
    private options: FieldOptions,
    private readonly p: BridgeParams,
  ) {
    this.seed = options.seed;
    this.state = bridgeState(phys);
  }

  setOptions(options: FieldOptions): void {
    this.options = { ...options };
  }

  fill(assets: PlushAsset[], seed = this.options.seed): ToyBody[] {
    this.phys.removeAllToys();
    this.assets = [...assets];
    this.seed = seed;
    // The prints come in a seeded shuffle of the theme's characters, like ToyField's types.
    const rng = makeRng(hashString(`bridge-prints:${seed}`));
    this.printOrder = this.assets.map((a) => a.id);
    for (let i = this.printOrder.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [this.printOrder[i], this.printOrder[j]] = [this.printOrder[j]!, this.printOrder[i]!];
    }
    const s = this.state;
    s.box = null;
    s.resets = 0;
    s.boxes = 0;
    s.staffResets = 0;
    this.pending = null;
    this.placeNewBox();
    return s.box ? [s.box] : [];
  }

  /** The print of the next box (null when the field has no characters). */
  private nextPrint(): string | null {
    if (this.printOrder.length === 0) return null;
    return this.printOrder[this.state.boxes % this.printOrder.length]!;
  }

  /** The seeded start pose for the current reset count: COM jitter in x and z, a small yaw. */
  startPose(resets = this.state.resets): { pos: Vec3; rot: Quat } {
    const p = this.p;
    const rng = makeRng(hashString(`bridge-pose:${this.seed}:${resets}`));
    const j = () => rng() * 2 - 1;
    const x = p.centerX + j() * p.startJitter;
    const z = p.centerZ + j() * p.startJitter * BRIDGE_LAYOUT.startJitterZ;
    const yaw = (j() * p.startYawDeg * Math.PI) / 180;
    // Half a millimetre above the bars: it settles onto them without a bounce.
    return { pos: [x, p.barY + p.barRadius + 0.0005, z], rot: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] };
  }

  private placeNewBox(): ToyBody | null {
    const s = this.state;
    const print = this.nextPrint();
    if (print === null && this.assets.length === 0) return null;
    const pose = this.startPose();
    const box = this.phys.addItem(bridgeBoxSpec(this.p, print), this.assets[0]?.theme ?? 'sakura', pose.pos, pose.rot);
    s.box = box;
    s.boxes++;
    this.clearTryState();
    this.phys.snapPoses();
    return box;
  }

  /** Puts the current box back on its next seeded start pose (same body, same print). */
  private resetBox(): boolean {
    const s = this.state;
    const box = s.box;
    if (!box || box.inBin || !this.phys.toys.has(box.id)) return false;
    s.resets++;
    const pose = this.startPose();
    box.body.setTranslation({ x: pose.pos[0], y: pose.pos[1], z: pose.pos[2] }, true);
    box.body.setRotation({ x: pose.rot[0], y: pose.rot[1], z: pose.rot[2], w: pose.rot[3] }, true);
    box.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    box.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.phys.sensorHits.delete(box);
    s.triesSinceReset = 0;
    s.staleTries = 0;
    s.stuck = false;
    s.stuckReason = null;
    s.progress = null;
    s.dropped = false;
    this.phys.snapPoses();
    return true;
  }

  private clearTryState(): void {
    const s = this.state;
    s.tries = 0;
    s.triesSinceReset = 0;
    s.staleTries = 0;
    s.stuck = false;
    s.stuckReason = null;
    s.progress = null;
    s.dropped = false;
  }

  private removeBox(): void {
    const s = this.state;
    if (s.box) this.phys.removeToy(s.box);
    s.box = null;
  }

  onField(): ToyBody[] {
    return [...this.phys.toys.values()].filter((t) => !t.inBin);
  }

  inBin(): ToyBody[] {
    return [...this.phys.toys.values()].filter((t) => t.inBin);
  }

  missing(): number {
    return 0;
  }

  restockOne(): ToyBody | null {
    return null;
  }

  clearBin(): ToyBody[] {
    const out = this.inBin();
    for (const t of out) this.phys.removeToy(t);
    if (this.state.box && !this.phys.toys.has(this.state.box.id)) this.state.box = null;
    return out;
  }

  clearFallen(): ToyBody[] {
    const out = [...this.phys.toys.values()].filter((t) => t.inBin || t.body.worldCom(this.phys.scratchV).y < this.phys.opening.awardComY);
    for (const t of out) this.phys.removeToy(t);
    if (this.state.box && !this.phys.toys.has(this.state.box.id)) this.state.box = null;
    return out;
  }

  /** True while any part of the claw hangs low over the pit (a box placed now could land in its fingers). */
  private clawOverPit(): boolean {
    const pit = bridgePit(this.p);
    const clear = restComY(this.p) + this.p.box[1] / 2 + PLACE_CLEARANCE;
    const m = 0.12;
    for (const h of this.phys.clawColliders) {
      const c = this.phys.world.getCollider(h);
      if (!c) continue;
      const t = c.translation();
      if (t.y < clear && t.x > pit.xMin - m && t.x < pit.xMax + m && t.z > pit.zMin - m && t.z < pit.zMax + m) return true;
    }
    return false;
  }

  /** Places a new box / puts the box back, now or (claw low over the pit) during the next settle. */
  private place(kind: 'new' | 'reset'): number {
    if (kind === 'new') this.removeBox();
    if (this.clawOverPit()) {
      this.pending = kind;
      return 1;
    }
    return (kind === 'new' ? this.placeNewBox() !== null : this.resetBox()) ? 1 : 0;
  }

  settle(maxSeconds = 2.5, preStep?: () => void, postStep?: () => void): number {
    let calm = 0;
    let steps = 0;
    let max = Math.ceil(maxSeconds / FIXED_DT);
    if (this.pending) {
      // The claw winds up first (its own commands); the box is placed once it is clear of the pit.
      for (let i = 0; i < Math.ceil(1.5 / FIXED_DT) && this.clawOverPit(); i++, steps++) {
        preStep?.();
        this.phys.step();
        postStep?.();
      }
      const kind = this.pending;
      this.pending = null;
      if (kind === 'new') this.placeNewBox();
      else this.resetBox();
      max += steps;
    }
    for (; steps < max; steps++) {
      preStep?.();
      this.phys.step();
      postStep?.();
      calm = this.phys.maxToySpeed() < CALM_SPEED ? calm + 1 : 0;
      if (steps > 40 && calm > 24) break;
    }
    this.phys.snapPoses();
    return steps * FIXED_DT;
  }

  /**
   * Round boundaries (READY, ATTRACT), placed at rest and settled by GameCore:
   *  - a won box (or none at all): the next printed box on its start pose;
   *  - a box that fell without an award: a player's box that passed the opening test waits for the
   *    award at the next DESCENDING; anything else (a demo's late fall) is replaced;
   *  - in attract mode a stuck box is put back by itself (as staff would);
   *  - `triesPerBox` used up: the box goes back to its start pose. Never a pity win.
   */
  atBoundary(phase: 'READY' | 'ATTRACT', demo: boolean): number {
    const s = this.state;
    const box = s.box;
    if (this.pending) return 1;
    if (!box || box.inBin || !this.phys.toys.has(box.id)) return this.place('new');
    const fell = box.body.worldCom(this.phys.scratchV).y < this.phys.opening.awardComY;
    if (fell) {
      if (s.dropped && phase === 'READY' && !demo) return 0;
      return this.place('new');
    }
    if (phase === 'ATTRACT' && s.stuck) {
      s.staffResets++;
      return this.place('reset');
    }
    if (phase === 'READY' && !demo && this.p.triesPerBox > 0 && s.triesSinceReset >= this.p.triesPerBox) return this.place('reset');
    return 0;
  }

  /** A new player (takeover, PLAY AGAIN after a session): a fresh box on its start pose. */
  resetForTakeover(): number {
    const s = this.state;
    const box = s.box;
    if (!box || box.inBin || !this.phys.toys.has(box.id) || box.body.worldCom(this.phys.scratchV).y < 0) {
      this.removeBox();
      for (const t of this.inBin()) this.phys.removeToy(t);
      return this.placeNewBox() ? 1 : 0;
    }
    for (const t of this.inBin()) this.phys.removeToy(t);
    this.resetBox();
    s.tries = 0;
    return 1;
  }

  /** "Call staff": the box back on its start pose, at a round boundary. Never awards anything. */
  staffReset(): boolean {
    const box = this.state.box;
    // Not while the claw hangs low over the pit (the box would be put back into its fingers).
    if (!box || box.inBin || this.state.dropped || this.pending || this.clawOverPit()) return false;
    if (!this.resetBox()) return false;
    this.state.staffResets++;
    return true;
  }

  stuck(): boolean {
    return this.state.stuck;
  }
}

/* ------------------------------------------------------------ rules of one try */

export class BridgeRules implements TryRules {
  readonly home: { x: number; z: number };
  private box: ToyBody | null = null;
  private progressBefore: number | null = null;
  private poseBefore: BoxPose | null = null;
  /**
   * After the release: 'free' (fingers open, cable held, until the claw no longer touches the box),
   * 'wind' (cable up, slowly and with the clutch while touching), 'home' (trolley home), null (no wind-up running).
   */
  private settle: 'free' | 'wind' | 'home' | null = null;
  private freeTime = 0;
  private clutchTime = 0;
  private bobTime = 0;
  private slowTime = 0;
  /** The box's centre of mass height when the wind-up began (hook detection). */
  private windFromY = 0;
  private settleFrom = { x: 0, z: 0 };
  private calmTime = 0;
  private awardAt = -1;
  private lastProgress: BridgeProgress | null = null;
  /** Two-step controls: 'x' (button 1), 'z' (button 2) or null (done / joystick). */
  private stage: 'x' | 'z' | null = null;
  private stageMoved = false;
  /** Rope length when the lift started (tests, sweeps). */
  ropeAtLift = 0;
  readonly filterInput?: TryRules['filterInput'];

  constructor(
    private readonly p: BridgeParams,
    g: FieldGeometry,
  ) {
    this.home = { ...g.home };
    if (p.controls === 'twoStep') this.filterInput = (ctx, x, z) => this.twoStep(ctx, x, z);
  }

  beginTry(ctx: TryContext): void {
    // At READY the rules run before the field's boundary refill: a won box is replaced right after,
    // so the try picks up its box at its first step (trackBox).
    this.box = null;
    this.progressBefore = null;
    this.poseBefore = null;
    const box = this.trackBox(ctx);
    this.settle = null;
    this.calmTime = 0;
    // A try that ended with the claw still low (the settle cap) finishes its wind-up before the claw moves.
    this.clutchTime = 0;
    this.bobTime = 0;
    this.slowTime = 0;
    if (ctx.claw.ropeLength > CLAW.ropeMin + 0.005) {
      ctx.claw.stopTrolley();
      this.settle = 'wind';
      this.windFromY = box ? box.body.worldCom(ctx.phys.scratchV).y : 0;
    }
    this.awardAt = -1;
    this.stage = this.filterInput && !ctx.machine.demo ? 'x' : null;
    this.stageMoved = false;
  }

  /** The box this try works on, with its progress when the try first saw it. */
  private trackBox(ctx: TryContext): ToyBody | null {
    if (this.box) return this.box;
    const s = bridgeState(ctx.phys);
    if (!s.box || s.box.inBin || !ctx.phys.toys.has(s.box.id)) return null;
    this.box = s.box;
    this.poseBefore = boxPose(s.box);
    this.progressBefore = bridgeProgress(this.p, this.poseBefore).progress;
    return this.box;
  }

  liftTarget(ctx: TryContext): number {
    // The cable winds up by liftDelta from where the claw closed: one end comes up, nothing is carried.
    this.ropeAtLift = ctx.claw.ropeLength;
    return Math.max(CLAW.ropeMin, ctx.claw.ropeLength - this.p.liftDelta);
  }

  transportTarget(ctx: TryContext): TransportPlan {
    // In place: the fingers open right where they lifted.
    return { x: ctx.claw.trolleyX, z: ctx.claw.trolleyZ, speed: ctx.params.moveSpeed, toOpening: false };
  }

  beginSettling(ctx: TryContext): void {
    // The claw never sweeps across the box low: the fingers come free, the cable winds up, then the
    // trolley heads home.
    this.settle = 'free';
    this.freeTime = 0;
    this.clutchTime = 0;
    this.bobTime = 0;
    this.slowTime = 0;
    this.settleFrom = { x: ctx.claw.trolleyX, z: ctx.claw.trolleyZ };
    this.calmTime = 0;
    ctx.claw.stopTrolley();
    ctx.claw.setFingers(1);
    ctx.claw.holdWinch();
  }

  /**
   * The wind-up after a try. The cable is a stiff spring: winding it up against a claw that a finger
   * still hooks into the box would store energy and fling both when the finger slips. So the cable
   * winds slowly while the claw touches the box and pauses whenever it pulls harder than the claw's
   * weight plus a little (a slip clutch): a hooked box is tipped off the finger, never yanked out.
   */
  private windUp(ctx: TryContext, phase: RoundPhase, phaseTime: number, dt: number): void {
    const claw = ctx.claw;
    const box = this.box && !this.box.inBin && ctx.phys.toys.has(this.box.id) ? this.box : null;
    const touching = box ? clawTouches(ctx.phys, box) : false;
    if (this.settle === 'free') {
      this.freeTime = touching ? 0 : this.freeTime + dt;
      if (this.freeTime < FREE_CLEAR && phaseTime < FREE_MAX) return;
      this.settle = 'wind';
      this.windFromY = box ? box.body.worldCom(ctx.phys.scratchV).y : 0;
    }
    if (this.settle !== 'wind') return;
    if (this.bobTime > 0) {
      // Paying out a little: the box settles back and the finger can slip out of it.
      this.bobTime -= dt;
      return;
    }
    const hooked = touching && box !== null && box.body.worldCom(ctx.phys.scratchV).y > this.windFromY + HOOK_RISE;
    if (hooked && claw.tension > CLAW_WEIGHT + CLUTCH_EXTRA) {
      claw.holdWinch();
      this.clutchTime += dt;
      if (this.clutchTime > BOB_AFTER) {
        this.clutchTime = 0;
        this.bobTime = BOB_TIME;
        claw.setWinch(claw.ropeLength + BOB_DROP, 2 * SLOW_WIND);
      }
    } else {
      this.clutchTime = 0;
      if (touching) this.slowTime += dt;
      claw.setWinch(CLAW.ropeMin, touching && (hooked || this.slowTime < SLOW_MAX) ? SLOW_WIND : ctx.params.liftSpeed);
    }
    if (claw.ropeLength <= CLAW.ropeMin + 0.002 && claw.winchArrived()) {
      this.settle = 'home';
      // In SETTLING the try then ends on its way home; at READY (a capped try) the claw just goes home.
      claw.setTrolleyTarget(this.home.x, this.home.z, ctx.params.moveSpeed);
      if (phase !== 'SETTLING') this.settle = null;
    }
  }

  postStep(ctx: TryContext, phase: RoundPhase, phaseTime: number, dt: number): void {
    this.trackBox(ctx);
    if (phase === 'SETTLING' || ((phase === 'READY' || phase === 'AIMING') && this.settle === 'wind')) this.windUp(ctx, phase, phaseTime, dt);
    const s = bridgeState(ctx.phys);
    const box = s.box;
    if (!box || box.inBin || !ctx.phys.toys.has(box.id)) return;
    const sp = boxSpeed(box);
    this.calmTime = sp.lin < CALM_SPEED && sp.ang < CALM_SPIN ? this.calmTime + dt : 0;
    // The opening test (physics only). Outside the award phases a drop is remembered and paid at
    // the next DESCENDING (a box that falls while the result is shown counts for the next try).
    if (!s.dropped && inOpening(ctx.phys, box, ctx.opening)) s.dropped = true;
    if (!s.dropped) return;
    const m = ctx.machine;
    if (!BRIDGE_AWARD_PHASES.has(phase)) return;
    const award = m.awardPrize(m.roundId, box.id, box.item?.print ?? box.asset.id);
    if (!award) return;
    box.inBin = true;
    s.dropped = false;
    // SETTLING time of the award (0 when it came earlier): the prize then gets time to land.
    this.awardAt = phase === 'SETTLING' ? m.phaseTime : 0;
    ctx.events.emit('prizeDetected', { roundId: m.roundId, toy: box });
  }

  canFinish(ctx: TryContext, phaseTime: number): boolean {
    // Never ends with the claw still low (the next box would be placed under it); the SETTLING
    // watchdog stays behind this, and the next READY finishes such a wind-up.
    if (this.settle !== 'home' || phaseTime < CALM_SECONDS) return false;
    if (phaseTime > SETTLE_CAP) return true;
    const claw = ctx.claw;
    const moved = Math.hypot(claw.trolleyX - this.settleFrom.x, claw.trolleyZ - this.settleFrom.z) > SETTLE_MOVED;
    if (!moved && !claw.trolleyArrived()) return false;
    const box = this.box;
    if (!box) return true;
    if (box.inBin) {
      // The prize gets a moment to land in the bin before the result is shown (like classic).
      const y = box.body.translation(ctx.phys.scratchV).y;
      const landed = y < ctx.phys.binFloorY + 0.3 && boxSpeed(box).lin < 0.6;
      const since = phaseTime - Math.max(0, this.awardAt);
      return (landed && since > 0.35) || since > 1.6;
    }
    return this.calmTime >= CALM_SECONDS;
  }

  resultExtras(ctx: TryContext, base: RoundResult): Partial<RoundResult> {
    const s = bridgeState(ctx.phys);
    const award = ctx.machine.award;
    const box = this.trackBox(ctx) ?? this.box;
    s.tries++;
    s.triesSinceReset++;
    let progress: number | null = null;
    let gain: number | null = null;
    if (award) {
      progress = 1;
      gain = this.progressBefore === null ? null : 1 - this.progressBefore;
      s.stuck = false;
      s.stuckReason = null;
      s.staleTries = 0;
    } else if (box && !box.inBin && ctx.phys.toys.has(box.id)) {
      const pose = boxPose(box);
      const g = bridgeProgress(this.p, pose);
      this.lastProgress = g;
      progress = Number(g.progress.toFixed(4));
      gain = this.progressBefore === null ? null : Number((g.progress - this.progressBefore).toFixed(4));
      const onBars = restsOnBars(this.p, pose);
      const before = this.poseBefore;
      const moved = !before || Math.hypot(pose.com[0] - before.com[0], pose.com[1] - before.com[1], pose.com[2] - before.com[2]) > STALE_MOVE || turnDeg(before.rot, pose.rot) > STALE_TURN_DEG;
      s.staleTries = !onBars && !moved ? s.staleTries + 1 : 0;
      const sp = boxSpeed(box);
      const calm = box.body.isSleeping() || (sp.lin < CALM_SPEED * 2 && sp.ang < CALM_SPIN * 2);
      const wedged = pose.com[1] < restComY(this.p) - WEDGE_DROP && calm && !s.dropped && !ctx.phys.isInPrizeSensor(box);
      s.stuckReason = wedged && s.staleTries >= 1 ? 'wedged' : s.staleTries >= STALE_TRIES ? 'stale' : null;
      s.stuck = s.stuckReason !== null;
    }
    s.progress = progress;
    return {
      // Every lift ends in an intended release: a try either drops the box or it does not.
      outcome: award ? 'won' : 'empty',
      slipReason: null,
      slipPhase: null,
      targetToyId: award ? award.toyId : (box?.id ?? base.targetToyId),
      targetTypeId: award ? award.typeId : (box?.item?.print ?? base.targetTypeId),
      machine: { id: 'bridge', genre: 'bridge', items: [], progress, progressGain: gain, stuck: s.stuck },
    };
  }

  /**
   * Two-step controls (section 3.1): button 1 held moves +x only, releasing it moves on to stage z;
   * button 2 held moves −z only, releasing it drops the claw. The app maps button 1 to inputX > 0
   * and button 2 to inputZ < 0. Demo rounds keep the joystick.
   */
  private twoStep(ctx: TryContext, x: number, z: number): { x: number; z: number; grab: boolean; stage: 'x' | 'z' | null } {
    if (ctx.machine.demo || this.stage === null) return { x, z, grab: false, stage: null };
    if (this.stage === 'x') {
      const vx = clamp(x, 0, 1);
      if (vx > 1e-3) {
        this.stageMoved = true;
        return { x: vx, z: 0, grab: false, stage: 'x' };
      }
      if (this.stageMoved) {
        this.stage = 'z';
        this.stageMoved = false;
        return { x: 0, z: 0, grab: false, stage: 'z' };
      }
      return { x: 0, z: 0, grab: false, stage: 'x' };
    }
    const vz = clamp(z, -1, 0);
    if (vz < -1e-3) {
      this.stageMoved = true;
      return { x: 0, z: vz, grab: false, stage: 'z' };
    }
    if (this.stageMoved) {
      this.stage = null;
      this.stageMoved = false;
      return { x: 0, z: 0, grab: true, stage: null };
    }
    return { x: 0, z: 0, grab: false, stage: 'z' };
  }

  debugState(): Record<string, unknown> {
    const g = this.lastProgress;
    return {
      stage: this.stage,
      settle: this.settle,
      ropeAtLift: this.ropeAtLift,
      progress: g ? { shift: g.shift, tilt: g.tilt, turn: g.turn, progress: g.progress } : null,
      box: this.box ? { id: this.box.id, print: this.box.item?.print ?? null, ...boxPose(this.box) } : null,
    };
  }
}

/* ------------------------------------------------------------ attract pilot strategy */

/** How the attract pilot (and the sweeps' simulated player) aims at the box. */
export interface BridgeAimKnobs {
  /** How far in from the chosen end along the box's long axis (m). */
  inset: number;
  /** Offset towards the player (+z) from the box's centre line (m): the claw has one back finger and two front ones. */
  dz: number;
  /** Which end: 'far' = the end already further from the middle (keep walking it), 'near' = the other one. */
  end: 'far' | 'near';
  /** Seconds the pilot waits for the swing to calm before it drops the claw. */
  patience: number;
  /** A box tilted more than this (deg) is worked at its raised end instead (0 = never). */
  raisedTiltDeg: number;
}

/**
 * The pilot's aim. `dz` 2.5 cm: the claw's back finger sits 0.10 m behind its axis and the two front
 * ones 0.05 m in front, so an axis 2.5 cm in front of the box's centre line puts every finger beside
 * the box instead of on top of it.
 */
export const BRIDGE_AIM: BridgeAimKnobs = { inset: 0.015, dz: 0.025, end: 'far', patience: 2.5, raisedTiltDeg: 12 };

/**
 * Where the attract pilot aims (section 3.1): one end of the box (on a centred box the end is
 * picked by the round number), `inset` in from that end along the box's long axis, `dz` towards
 * the player, clamped to the claw's reach.
 */
export function bridgeAimAt(p: BridgeParams, pose: BoxPose, round: number, knobs: BridgeAimKnobs = BRIDGE_AIM): { x: number; z: number; end: -1 | 1 } {
  const ax = rotate(pose.rot, [1, 0, 0]);
  const flat = Math.hypot(ax[0], ax[2]) || 1;
  const ux = ax[0] / flat;
  const uz = ax[2] / flat;
  const reach = p.box[0] / 2 - knobs.inset;
  const ends = [-1, 1] as const;
  const far = ends.map((e) => Math.abs(pose.com[0] + e * ux * reach - p.centerX));
  let end: -1 | 1;
  if (Math.abs(far[0]! - far[1]!) < 0.004) end = round % 2 === 0 ? -1 : 1;
  else end = far[0]! > far[1]! ? -1 : 1;
  if (knobs.end === 'near') end = end === -1 ? 1 : -1;
  if (knobs.raisedTiltDeg > 0 && bridgeProgress(p, pose).tiltDeg > knobs.raisedTiltDeg) end = ax[1] >= 0 ? 1 : -1;
  const x = clamp(pose.com[0] + end * ux * reach, CLAW.minX, CLAW.maxX);
  const z = clamp(pose.com[2] + end * uz * reach + knobs.dz, CLAW.minZ, CLAW.maxZ);
  return { x, z, end };
}

export function bridgeAim(core: GameCore, demoRound: number, p: BridgeParams): AimPlan | null {
  const box = bridgeState(core.phys).box;
  if (!box || box.inBin || !core.phys.toys.has(box.id)) return null;
  const a = bridgeAimAt(p, boxPose(box), demoRound);
  return { x: a.x, z: a.z, patience: BRIDGE_AIM.patience, targetToyId: box.id };
}

/* ------------------------------------------------------------ the genre */

/** The difficulty preset's claw parameters scaled by the genre's multipliers (absent = ×1). */
function scaleClaw(base: RoundParams, scale: ClawScale): RoundParams {
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

export const bridgeModule: GenreModule<'bridge'> = {
  genre: 'bridge',
  defaults: BRIDGE_DEFAULTS,
  presentation: 'prize',
  // A push during the descent is physics too (section 3.0).
  awardPhases: BRIDGE_AWARD_PHASES,
  fromSettings: (s) => ({ controls: s.bridge.controls, triesPerBox: s.bridge.triesPerBox, gap: s.bridge.gap, boxMass: s.bridge.boxMass }),
  geometry: (p) => bridgeGeometry(p),
  session: () => ({ kind: 'open' }),
  controls: (p) => p.controls,
  roundParams: (base, p) => scaleClaw(base, p.claw),
  createRules: (p, g) => new BridgeRules(p, g),
  createField: (phys, options, p) => new BridgeField(phys, options, p),
  aim: (core, demoRound, p) => bridgeAim(core, demoRound, p),
};
