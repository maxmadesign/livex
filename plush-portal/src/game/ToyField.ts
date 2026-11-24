import { makeRng } from '../core/math';
import type { Quat, Vec3 } from '../core/types';
import type { PlushAsset } from '../plush/manifest';
import { CHUTE, FIELD, FIXED_DT } from '../physics/fieldSpec';
import type { PhysicsWorld, ToyBody } from '../physics/PhysicsWorld';

export interface FieldOptions {
  /** How many toys should be on the play field. */
  count: number;
  /** Uniform size multiplier for all toys. */
  scale: number;
  /** 0 = one tidy layer, 1 = tall pile. */
  density: number;
  massScale: number;
  seed: number;
}

interface Slot {
  x: number;
  z: number;
  layer: number;
}

const WALL_MARGIN = 0.092;
const CHUTE_MARGIN = 0.115;

function yawQuat(yaw: number): Quat {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

/** True when a toy centred on (x, z) with the given radius stays clear of walls and the chute guard. */
export function isFreeSpot(x: number, z: number, radius: number): boolean {
  if (x < -FIELD.halfWidth + radius || x > FIELD.halfWidth - radius) return false;
  if (z < -FIELD.depth + radius || z > -radius) return false;
  if (x < CHUTE.xMax + radius + 0.02 && z > CHUTE.zMin - radius - 0.02) return false;
  return true;
}

/** Hexagonal grid of resting places, back row first. */
function hexSlots(pitch: number): Slot[] {
  const slots: Slot[] = [];
  const rowStep = pitch * 0.866;
  const zStart = -FIELD.depth + WALL_MARGIN;
  const zEnd = -WALL_MARGIN;
  const rows = Math.max(1, Math.floor((zEnd - zStart) / rowStep) + 1);
  const zPad = (zEnd - zStart - (rows - 1) * rowStep) / 2;
  for (let r = 0; r < rows; r++) {
    const z = zStart + zPad + r * rowStep;
    const offset = r % 2 === 0 ? 0 : pitch / 2;
    const span = 2 * (FIELD.halfWidth - WALL_MARGIN) - offset;
    const cols = Math.max(1, Math.floor(span / pitch) + 1);
    const xPad = (span - (cols - 1) * pitch) / 2;
    for (let c = 0; c < cols; c++) {
      const x = -FIELD.halfWidth + WALL_MARGIN + offset + xPad + c * pitch;
      if (x < CHUTE.xMax + CHUTE_MARGIN && z > CHUTE.zMin - CHUTE_MARGIN) continue;
      slots.push({ x, z, layer: 0 });
    }
  }
  return slots;
}

/**
 * Creates and maintains the toys on the play field: the initial tidy layout,
 * restocking between rounds and clearing toys that ended up in the prize bin.
 */
export class ToyField {
  private rng: () => number;
  private typeCursor = 0;
  private assets: PlushAsset[] = [];
  private options: FieldOptions;

  constructor(
    private readonly phys: PhysicsWorld,
    options: FieldOptions,
  ) {
    this.options = { ...options };
    this.rng = makeRng(options.seed);
  }

  setOptions(options: FieldOptions): void {
    this.options = { ...options };
  }

  /** Toys that are on the play field (not in the prize bin). */
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

  /** Next character type, cycling through a shuffled list so the mix stays even. */
  private nextAsset(): PlushAsset {
    if (this.assets.length === 0) throw new Error('ToyField: no enabled characters');
    if (this.typeCursor % this.assets.length === 0) {
      // Fisher–Yates with the deterministic RNG.
      for (let i = this.assets.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.assets[i], this.assets[j]] = [this.assets[j]!, this.assets[i]!];
      }
    }
    return this.assets[this.typeCursor++ % this.assets.length]!;
  }

  /**
   * Removes every toy and lays out a fresh field. Toys sit upright, facing the
   * glass, on a staggered grid; anything beyond one layer is dropped on top.
   */
  fill(assets: PlushAsset[], seed = this.options.seed): ToyBody[] {
    this.phys.removeAllToys();
    this.assets = [...assets];
    this.rng = makeRng(seed);
    this.typeCursor = 0;
    if (this.assets.length === 0) return [];

    const { count, scale, density } = this.options;
    // The grid is sized by the solid body of the toys; floppy ears and tails may overlap neighbours.
    const maxFootprint = Math.max(...this.assets.map((a) => a.footprint * scale));
    // Denser settings squeeze the grid a little; the rest of the density goes into a second layer.
    const loosePitch = Math.max(0.168, maxFootprint * 2.1);
    const tightPitch = Math.max(0.158, maxFootprint * 1.95);
    let pitch = loosePitch + (tightPitch - loosePitch) * density;
    let slots = hexSlots(pitch);
    // Prefer one layer: tighten the grid before stacking.
    const firstLayerShare = 1 - 0.45 * Math.max(0, density - 0.2) / 0.8;
    const wantFirst = Math.ceil(count * firstLayerShare);
    while (slots.length < wantFirst && pitch > tightPitch + 1e-4) {
      pitch = Math.max(tightPitch, pitch - 0.005);
      slots = hexSlots(pitch);
    }

    // Use the slots closest to the centre first so partially filled fields look intentional.
    const cx = 0.08;
    const cz = -FIELD.depth * 0.52;
    slots.sort((a, b) => Math.hypot(a.x - cx, (a.z - cz) * 1.15) - Math.hypot(b.x - cx, (b.z - cz) * 1.15));
    const first = slots.slice(0, Math.min(slots.length, wantFirst));
    const placed: ToyBody[] = [];
    for (const slot of first) {
      const asset = this.nextAsset();
      const jitter = pitch * 0.045;
      const x = slot.x + (this.rng() - 0.5) * 2 * jitter;
      const z = slot.z + (this.rng() - 0.5) * 2 * jitter;
      const yaw = (this.rng() - 0.5) * 0.7;
      placed.push(this.phys.addToy(asset, [x, 0.004, z], yawQuat(yaw), scale, this.options.massScale));
    }
    // Second layer: dropped from above between the first-layer toys. The drop
    // heights cycle through a few levels that all stay below the ceiling (a
    // large, dense field used to spawn toys above the cabinet roof, where they
    // stayed); toys on the same level get different spots from findDropSpot.
    const topLevel = Math.max(0, Math.min(3, Math.floor((FIELD.ceilingY - 0.22 - 0.3) / 0.16)));
    for (let k = 0; placed.length < count; k++) {
      const asset = this.nextAsset();
      const spot = this.findDropSpot(asset.footprint * scale, placed.length);
      const yaw = (this.rng() - 0.5) * 1.6;
      const y = 0.3 + (k % (topLevel + 1)) * 0.16;
      placed.push(this.phys.addToy(asset, [spot[0], y, spot[2]], yawQuat(yaw), scale, this.options.massScale));
    }
    this.phys.snapPoses();
    return placed;
  }

  /** Finds a spot with the most free space around it (deterministic sampling). */
  private findDropSpot(radius: number, salt = 0): Vec3 {
    let best: Vec3 = [0.1, 0, -0.4];
    let bestScore = -Infinity;
    const toys = this.onField();
    for (let i = 0; i < 48; i++) {
      const x = -FIELD.halfWidth + 0.11 + this.rng() * (2 * FIELD.halfWidth - 0.22);
      const z = -FIELD.depth + 0.11 + this.rng() * (FIELD.depth - 0.22);
      if (!isFreeSpot(x, z, radius + 0.015)) continue;
      let nearest = Infinity;
      for (const toy of toys) {
        const p = toy.pose.pos;
        // Only toys resting low matter; ones already piled up are ignored.
        nearest = Math.min(nearest, Math.hypot(p[0]! - x, p[2]! - z));
      }
      // Slight preference for the middle so restocks do not hug the glass.
      const score = Math.min(nearest, 0.4) - 0.12 * Math.hypot(x - 0.08, z + 0.42) + ((i + salt) % 3) * 1e-4;
      if (score > bestScore) {
        bestScore = score;
        best = [x, 0, z];
      }
    }
    return best;
  }

  /** How many toys are missing from the play field. */
  missing(): number {
    return Math.max(0, this.options.count - this.onField().length);
  }

  /**
   * Drops one new toy from the restock hatch near the ceiling. Returns the new
   * toy (or null when the field is already full or no character is enabled).
   */
  restockOne(): ToyBody | null {
    if (this.assets.length === 0 || this.missing() === 0) return null;
    const asset = this.nextAsset();
    const scale = this.options.scale;
    const spot = this.findDropSpot(asset.footprint * scale);
    const yaw = (this.rng() - 0.5) * 0.9;
    const toy = this.phys.addToy(asset, [spot[0], 0.62, spot[2]], yawQuat(yaw), scale, this.options.massScale);
    toy.body.setLinvel({ x: 0, y: -0.4, z: 0 }, true);
    return toy;
  }

  /** Removes toys that are in the prize bin. Returns the removed toys. */
  clearBin(): ToyBody[] {
    const removed = this.inBin();
    for (const toy of removed) this.phys.removeToy(toy);
    return removed;
  }

  /**
   * Runs the simulation (without rendering) until the pile is calm. Used while
   * loading and after rebuilding the layout so players never see the toys pop
   * into place.
   */
  settle(maxSeconds = 2.5, preStep?: () => void, postStep?: () => void): number {
    const maxSteps = Math.ceil(maxSeconds / FIXED_DT);
    let calm = 0;
    let steps = 0;
    for (; steps < maxSteps; steps++) {
      preStep?.();
      this.phys.step();
      postStep?.();
      this.calmWobble();
      calm = this.phys.maxToySpeed() < 0.02 ? calm + 1 : 0;
      if (steps > 40 && calm > 24) break;
    }
    this.phys.snapPoses();
    return steps * FIXED_DT;
  }

  /**
   * Freshly placed round-bottomed toys rock for many seconds before they come
   * to rest. Settling runs off-screen, so the rocking of toys that are already
   * slow is damped hard here (and only here, never during play): the field is
   * at rest when the player first sees it.
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
}
