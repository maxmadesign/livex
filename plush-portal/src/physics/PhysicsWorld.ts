import RAPIER from '@dimforge/rapier3d-compat';
import type { Quat, Vec3 } from '../core/types';
import type { PlushAsset, ProxyShape } from '../plush/manifest';
import type { FixtureKind } from './fieldGeometry';
import type { ItemSpec } from './items';
import { BIN, CHUTE, FIELD, FIXED_DT, GROUP, PRIZE_SENSOR, clampBinFloor, groups } from './fieldSpec';

export { RAPIER };

let rapierReady: Promise<void> | null = null;
/** Loads the Rapier WASM module once. */
export function initRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export type StaticKind = 'floor' | 'glass' | 'backWall' | 'ceiling' | 'chuteWall' | 'bin' | FixtureKind;

/** Interpolated transform of one dynamic body (previous + current fixed step). */
export class BodyPose {
  readonly prevPos = new Float32Array(3);
  readonly prevRot = new Float32Array([0, 0, 0, 1]);
  readonly pos = new Float32Array(3);
  readonly rot = new Float32Array([0, 0, 0, 1]);

  capture(body: RAPIER.RigidBody, scratchV: RAPIER.Vector, scratchQ: RAPIER.Rotation): void {
    this.prevPos.set(this.pos);
    this.prevRot.set(this.rot);
    const t = body.translation(scratchV);
    this.pos[0] = t.x;
    this.pos[1] = t.y;
    this.pos[2] = t.z;
    const r = body.rotation(scratchQ);
    this.rot[0] = r.x;
    this.rot[1] = r.y;
    this.rot[2] = r.z;
    this.rot[3] = r.w;
  }

  /** Makes prev == current (after teleports, so nothing streaks across the screen). */
  snap(body: RAPIER.RigidBody, scratchV: RAPIER.Vector, scratchQ: RAPIER.Rotation): void {
    this.capture(body, scratchV, scratchQ);
    this.prevPos.set(this.pos);
    this.prevRot.set(this.rot);
  }
}

export interface ToyCollider {
  collider: RAPIER.Collider;
  part: string;
  role: 'core' | 'appendage';
}

export interface ToyBody {
  /** Unique instance id, stable for the lifetime of the toy. */
  id: string;
  asset: PlushAsset;
  scale: number;
  body: RAPIER.RigidBody;
  colliders: ToyCollider[];
  pose: BodyPose;
  mass: number;
  /** Set when the toy is in the prize bin and no longer part of the play field. */
  inBin: boolean;
  /** Linear velocity at the end of the previous step (impact detection). */
  lastVel: Float32Array;
  /** Set for machine items (boxes, snacks, gems, coins); absent on plush toys. */
  item?: ItemSpec;
}

export interface ImpactEvent {
  toy: ToyBody;
  /** Speed change in m/s caused by the impact. */
  strength: number;
  /** Direction the toy was pushed in (world space, unit length). */
  dirX: number;
  dirY: number;
  dirZ: number;
  /** What it hit, when known. */
  against: StaticKind | 'toy' | 'claw' | 'unknown';
}

export interface PhysicsOptions {
  /** Y of the prize bin floor (depends on the display layout, clamped to the allowed range). */
  binFloorY: number;
  toyFriction: number;
}

const TOY_GROUPS = groups(GROUP.TOY, GROUP.STATIC | GROUP.TOY | GROUP.CLAW | GROUP.SENSOR);
const TOY_SOFT_GROUPS = groups(GROUP.TOY_SOFT, GROUP.STATIC | GROUP.CLAW | GROUP.SENSOR);
const STATIC_GROUPS = groups(GROUP.STATIC, GROUP.TOY | GROUP.TOY_SOFT | GROUP.CLAW);
/**
 * The clear guard around the exit only stops the solid body of a toy. Floppy
 * ears and tails drape over it: otherwise a released prize could hang on the
 * guard by an ear instead of dropping into the exit.
 */
const GUARD_GROUPS = groups(GROUP.STATIC, GROUP.TOY | GROUP.CLAW);
const SENSOR_GROUPS = groups(GROUP.SENSOR, GROUP.TOY | GROUP.TOY_SOFT);
const NO_GROUPS = groups(GROUP.NONE, GROUP.NONE);

/**
 * Owns the Rapier world: the cabinet's static colliders, the toys and the
 * fixed-step bookkeeping. Everything here is authoritative and independent of
 * rendering quality.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly events: RAPIER.EventQueue;
  readonly toys = new Map<string, ToyBody>();
  private readonly toyByCollider = new Map<number, ToyBody>();
  private readonly toyColliderInfo = new Map<number, ToyCollider>();
  private readonly staticKinds = new Map<number, StaticKind>();
  /** Colliders owned by the claw rig register themselves here so impacts can be classified. */
  readonly clawColliders = new Set<number>();
  private fixedBody!: RAPIER.RigidBody;
  private binBody: RAPIER.RigidBody | null = null;
  private prizeSensor!: RAPIER.Collider;
  private options: PhysicsOptions;
  /** Toys whose colliders touched the prize sensor during the last step. */
  readonly sensorHits = new Set<ToyBody>();
  /** Impacts detected during the last step (reused array). */
  readonly impacts: ImpactEvent[] = [];
  private readonly impactPool: ImpactEvent[] = [];
  readonly scratchV = new RAPIER.Vector3(0, 0, 0);
  readonly scratchQ = new RAPIER.Quaternion(0, 0, 0, 1);
  private toyCounter = 0;
  stepCount = 0;
  /** Wall-clock cost of the last `step()` in ms. */
  lastStepMs = 0;

  constructor(options: PhysicsOptions) {
    this.options = { ...options, binFloorY: clampBinFloor(options.binFloorY) };
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    this.world.numSolverIterations = 8;
    this.events = new RAPIER.EventQueue(true);
    this.buildCabinet();
    this.buildBin();
  }

  get binFloorY(): number {
    return this.options.binFloorY;
  }

  dispose(): void {
    this.events.free();
    this.world.free();
    this.toys.clear();
    this.toyByCollider.clear();
    this.toyColliderInfo.clear();
  }

  /* ------------------------------------------------------------- statics */

  private addStatic(
    body: RAPIER.RigidBody,
    kind: StaticKind,
    cx: number,
    cy: number,
    cz: number,
    hx: number,
    hy: number,
    hz: number,
    friction: number,
    restitution = 0.05,
  ): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setFriction(friction)
      .setRestitution(restitution)
      .setCollisionGroups(kind === 'chuteWall' ? GUARD_GROUPS : STATIC_GROUPS);
    const collider = this.world.createCollider(desc, body);
    this.staticKinds.set(collider.handle, kind);
    return collider;
  }

  private buildCabinet(): void {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.fixedBody = body;
    const W = FIELD.halfWidth;
    const D = FIELD.depth;
    const T = FIELD.floorThickness;
    const wallT = 0.06;
    const top = FIELD.ceilingY;

    // Floor slab with the chute hole in the front-left corner (two boxes).
    const matFriction = 0.95;
    this.addStatic(body, 'floor', (CHUTE.xMax + W) / 2, -T / 2, -D / 2, (W - CHUTE.xMax) / 2, T / 2, D / 2, matFriction, 0.02);
    this.addStatic(
      body,
      'floor',
      (CHUTE.xMin + CHUTE.xMax) / 2,
      -T / 2,
      (-D + CHUTE.zMin) / 2,
      (CHUTE.xMax - CHUTE.xMin) / 2,
      T / 2,
      (D + CHUTE.zMin) / 2,
      matFriction,
      0.02,
    );

    // Glass box. Left wall and front glass continue below the floor (they are also walls of the bin).
    const low = BIN.minFloorY - 0.1;
    const wallMid = (top + low) / 2;
    const wallHalf = (top - low) / 2;
    this.addStatic(body, 'glass', -W - wallT / 2, wallMid, -D / 2, wallT / 2, wallHalf, D / 2 + wallT, 0.3, 0.12);
    this.addStatic(body, 'glass', W + wallT / 2, (top - T) / 2, -D / 2, wallT / 2, (top + T) / 2, D / 2 + wallT, 0.3, 0.12);
    this.addStatic(body, 'glass', 0, wallMid, wallT / 2, W + wallT, wallHalf, wallT / 2, 0.3, 0.12);
    this.addStatic(body, 'backWall', 0, (top - T) / 2, -D - wallT / 2, W + wallT, (top + T) / 2, wallT / 2, 0.5, 0.08);
    this.addStatic(body, 'ceiling', 0, top + wallT / 2, -D / 2, W + wallT, wallT / 2, D / 2 + wallT, 0.4);

    // Clear guard walls around the chute.
    const h = CHUTE.wallHeight;
    const t = CHUTE.wallThickness;
    this.addStatic(body, 'chuteWall', CHUTE.xMax + t / 2, h / 2, (CHUTE.zMin + CHUTE.zMax) / 2 - t / 2, t / 2, h / 2, (CHUTE.zMax - CHUTE.zMin) / 2 + t / 2, 0.35, 0.1);
    this.addStatic(body, 'chuteWall', (CHUTE.xMin + CHUTE.xMax) / 2, h / 2, CHUTE.zMin - t / 2, (CHUTE.xMax - CHUTE.xMin) / 2, h / 2, t / 2, 0.35, 0.1);

    // Prize sensor inside the chute, below floor level.
    const sensor = RAPIER.ColliderDesc.cuboid(
      (PRIZE_SENSOR.xMax - PRIZE_SENSOR.xMin) / 2,
      (PRIZE_SENSOR.yTop - PRIZE_SENSOR.yBottom) / 2,
      (PRIZE_SENSOR.zMax - PRIZE_SENSOR.zMin) / 2,
    )
      .setTranslation(
        (PRIZE_SENSOR.xMin + PRIZE_SENSOR.xMax) / 2,
        (PRIZE_SENSOR.yTop + PRIZE_SENSOR.yBottom) / 2,
        (PRIZE_SENSOR.zMin + PRIZE_SENSOR.zMax) / 2,
      )
      .setSensor(true)
      .setCollisionGroups(SENSOR_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.prizeSensor = this.world.createCollider(sensor, body);
  }

  private buildBin(): void {
    if (this.binBody) {
      for (let i = this.binBody.numColliders() - 1; i >= 0; i--) this.staticKinds.delete(this.binBody.collider(i).handle);
      this.world.removeRigidBody(this.binBody);
    }
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.binBody = body;
    const floorY = this.options.binFloorY;
    const T = FIELD.floorThickness;
    const cx = (BIN.xMin + BIN.xMax) / 2;
    const cz = (BIN.zMin + BIN.zMax) / 2;
    const hx = (BIN.xMax - BIN.xMin) / 2;
    const hz = (BIN.zMax - BIN.zMin) / 2;
    // Cushioned floor.
    this.addStatic(body, 'bin', cx, floorY - 0.03, cz, hx + 0.03, 0.03, hz + 0.03, 1.0, 0.0);
    // Right and back walls from the bin floor up to the underside of the play floor.
    const mid = (floorY - T) / 2;
    const half = (-T - floorY) / 2;
    this.addStatic(body, 'bin', BIN.xMax + 0.02, mid, cz, 0.02, half, hz + 0.02, 0.5, 0.05);
    this.addStatic(body, 'bin', cx, mid, BIN.zMin - 0.02, hx + 0.02, half, 0.02, 0.5, 0.05);
  }

  /** Changes the depth of the prize bin. Only call between rounds. */
  setBinFloor(y: number): void {
    const clamped = clampBinFloor(y);
    if (Math.abs(clamped - this.options.binFloorY) < 1e-4) return;
    this.options.binFloorY = clamped;
    this.buildBin();
    for (const toy of this.toys.values()) if (toy.inBin) toy.body.wakeUp();
  }

  setToyFriction(friction: number): void {
    this.options.toyFriction = friction;
    for (const toy of this.toys.values()) for (const c of toy.colliders) c.collider.setFriction(0.9 * friction);
  }

  staticKind(handle: number): StaticKind | undefined {
    return this.staticKinds.get(handle);
  }

  toyOfCollider(handle: number): ToyBody | undefined {
    return this.toyByCollider.get(handle);
  }

  toyColliderMeta(handle: number): ToyCollider | undefined {
    return this.toyColliderInfo.get(handle);
  }

  /* ---------------------------------------------------------------- toys */

  private colliderDesc(proxy: ProxyShape, scale: number): RAPIER.ColliderDesc | null {
    const g = proxy.geometry;
    switch (g.type) {
      case 'ball':
        return RAPIER.ColliderDesc.ball(g.r * scale);
      case 'capsule':
        return RAPIER.ColliderDesc.capsule(g.halfHeight * scale, g.r * scale);
      case 'cuboid':
        return g.round > 0
          ? RAPIER.ColliderDesc.roundCuboid(
              Math.max(1e-3, (g.hx - g.round) * scale),
              Math.max(1e-3, (g.hy - g.round) * scale),
              Math.max(1e-3, (g.hz - g.round) * scale),
              g.round * scale,
            )
          : RAPIER.ColliderDesc.cuboid(g.hx * scale, g.hy * scale, g.hz * scale);
      case 'hull': {
        const pts = new Float32Array(g.points.length);
        for (let i = 0; i < pts.length; i++) pts[i] = g.points[i]! * scale;
        return RAPIER.ColliderDesc.convexHull(pts);
      }
    }
  }

  addToy(asset: PlushAsset, position: Vec3, rotation: Quat, scale: number, massScale: number): ToyBody {
    const id = `toy-${++this.toyCounter}`;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position[0], position[1], position[2])
      .setRotation({ x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] })
      .setLinearDamping(0.35)
      .setAngularDamping(2.2)
      .setCanSleep(true);
    const body = this.world.createRigidBody(bodyDesc);
    const totalMass = asset.mass * massScale * scale ** 3;
    const colliders: ToyCollider[] = [];
    for (const proxy of asset.proxies) {
      let desc = this.colliderDesc(proxy, scale);
      if (!desc) {
        // Degenerate hull: fall back to a ball of similar size so the toy still exists physically.
        desc = RAPIER.ColliderDesc.ball(0.04 * scale);
      }
      desc
        .setTranslation(proxy.pos[0] * scale, proxy.pos[1] * scale, proxy.pos[2] * scale)
        .setRotation({ x: proxy.rot[0], y: proxy.rot[1], z: proxy.rot[2], w: proxy.rot[3] })
        .setMass(Math.max(1e-4, totalMass * proxy.massFraction))
        .setFriction(0.9 * this.options.toyFriction)
        .setRestitution(0.04)
        .setCollisionGroups(proxy.role === 'appendage' ? TOY_SOFT_GROUPS : TOY_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const collider = this.world.createCollider(desc, body);
      const entry: ToyCollider = { collider, part: proxy.part, role: proxy.role };
      colliders.push(entry);
    }
    const toy: ToyBody = {
      id,
      asset,
      scale,
      body,
      colliders,
      pose: new BodyPose(),
      mass: body.mass(),
      inBin: false,
      lastVel: new Float32Array(3),
    };
    for (const c of colliders) {
      this.toyByCollider.set(c.collider.handle, toy);
      this.toyColliderInfo.set(c.collider.handle, c);
    }
    toy.pose.snap(body, this.scratchV, this.scratchQ);
    this.toys.set(id, toy);
    return toy;
  }

  removeToy(toy: ToyBody): void {
    if (!this.toys.delete(toy.id)) return;
    for (const c of toy.colliders) {
      this.toyByCollider.delete(c.collider.handle);
      this.toyColliderInfo.delete(c.collider.handle);
    }
    this.sensorHits.delete(toy);
    this.world.removeRigidBody(toy.body);
  }

  removeAllToys(): void {
    for (const toy of [...this.toys.values()]) this.removeToy(toy);
  }

  /** True while any collider of the toy overlaps the prize sensor volume. */
  isInPrizeSensor(toy: ToyBody): boolean {
    for (const c of toy.colliders) {
      if (this.world.intersectionPair(this.prizeSensor, c.collider)) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- step */

  /** Advances the simulation by exactly one fixed step and refreshes poses, sensor hits and impacts. */
  step(): void {
    const t0 = performance.now();
    for (const toy of this.toys.values()) {
      const v = toy.body.linvel(this.scratchV);
      toy.lastVel[0] = v.x;
      toy.lastVel[1] = v.y;
      toy.lastVel[2] = v.z;
    }
    this.world.step(this.events);
    this.stepCount++;

    this.events.drainCollisionEvents((h1, h2, started) => {
      const sensorHandle = this.prizeSensor.handle;
      if (h1 !== sensorHandle && h2 !== sensorHandle) return;
      const toy = this.toyByCollider.get(h1 === sensorHandle ? h2 : h1);
      if (!toy) return;
      if (started) this.sensorHits.add(toy);
    });

    // Impacts: a sudden change of velocity within one step.
    for (const e of this.impacts) this.impactPool.push(e);
    this.impacts.length = 0;
    for (const toy of this.toys.values()) {
      toy.pose.capture(toy.body, this.scratchV, this.scratchQ);
      if (toy.body.isSleeping()) continue;
      const v = toy.body.linvel(this.scratchV);
      const dx = v.x - toy.lastVel[0]!;
      // Remove the part of the change that is just gravity.
      const dy = v.y - toy.lastVel[1]! + 9.81 * FIXED_DT;
      const dz = v.z - toy.lastVel[2]!;
      const strength = Math.hypot(dx, dy, dz);
      if (strength > 0.45) {
        const e = this.impactPool.pop() ?? ({ toy, strength: 0, dirX: 0, dirY: 1, dirZ: 0, against: 'unknown' } as ImpactEvent);
        e.toy = toy;
        e.strength = strength;
        e.dirX = dx / strength;
        e.dirY = dy / strength;
        e.dirZ = dz / strength;
        e.against = this.classifyImpact(toy);
        this.impacts.push(e);
      }
    }
    this.lastStepMs = performance.now() - t0;
  }

  private classifyImpact(toy: ToyBody): ImpactEvent['against'] {
    let result: ImpactEvent['against'] = 'unknown';
    let best = 0;
    for (const c of toy.colliders) {
      this.world.contactPairsWith(c.collider, (other) => {
        this.world.contactPair(c.collider, other, (manifold) => {
          let impulse = 0;
          for (let i = 0; i < manifold.numContacts(); i++) impulse += manifold.contactImpulse(i);
          if (impulse <= best) return;
          best = impulse;
          const kind = this.staticKinds.get(other.handle);
          if (kind) result = kind;
          else if (this.clawColliders.has(other.handle)) result = 'claw';
          else if (this.toyByCollider.has(other.handle)) result = 'toy';
        });
      });
    }
    return result;
  }

  /** Re-synchronises interpolation state after bodies were teleported. */
  snapPoses(): void {
    for (const toy of this.toys.values()) toy.pose.snap(toy.body, this.scratchV, this.scratchQ);
  }

  /** Kinetic energy proxy used to decide whether the pile has settled. */
  maxToySpeed(): number {
    let max = 0;
    for (const toy of this.toys.values()) {
      if (toy.body.isSleeping()) continue;
      const v = toy.body.linvel(this.scratchV);
      const s = Math.hypot(v.x, v.y, v.z);
      if (s > max) max = s;
    }
    return max;
  }
}

/**
 * Fixed time step driver with render interpolation. After a pause or a long
 * frame the backlog is dropped instead of being simulated in one burst.
 */
export class FixedStepper {
  private accumulator = 0;
  /** Interpolation factor between the previous and the current physics state. */
  alpha = 1;
  /** Number of fixed steps that were dropped because a frame took too long. */
  droppedSteps = 0;

  constructor(
    readonly dt = FIXED_DT,
    /** Maximum number of catch-up steps per rendered frame. */
    readonly maxSteps = 5,
  ) {}

  /** Returns how many fixed steps to run for a frame that took `frameDt` seconds. */
  advance(frameDt: number): number {
    if (!(frameDt > 0)) return 0;
    this.accumulator += frameDt;
    let steps = Math.floor(this.accumulator / this.dt + 1e-9);
    if (steps > this.maxSteps) {
      this.droppedSteps += steps - this.maxSteps;
      steps = this.maxSteps;
      // Drop the backlog: slow motion instead of a burst of steps.
      this.accumulator = 0;
      this.alpha = 1;
      return steps;
    }
    this.accumulator -= steps * this.dt;
    this.alpha = this.accumulator / this.dt;
    return steps;
  }

  /** Forget accumulated time (pause, tab switch, modal). */
  reset(): void {
    this.accumulator = 0;
    this.alpha = 1;
  }
}
