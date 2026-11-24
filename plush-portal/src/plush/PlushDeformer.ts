import { Vector3 } from 'three';
import { Spring, clamp, damp } from '../core/math';
import type { PlushAsset } from './manifest';
import { MAX_DENTS, type PlushUniforms } from './PlushMaterial';

interface DentSlot {
  /** Which claw part owns this slot (-1 = free). */
  key: number;
  depth: Spring;
  /** Frames since the contact was last reported. */
  age: number;
}

export interface DeformFrame {
  /** Unit gravity direction in the toy's local space. */
  gravity: Vector3;
  /** Linear acceleration of the toy in local space, m/s². */
  accel: Vector3;
  /** 1 while the toy hangs from the claw, 0 otherwise. */
  held: number;
  /** Where it is held, local space (only used while held > 0). */
  grip: Vector3;
}

const _target = new Vector3();

/**
 * Drives the soft-body look of one plush toy. The rigid collision proxy stays
 * authoritative; this only animates what the vertex shader shows:
 *   1. local dents under the claw fingers (with a soft bulge around them)
 *   2. sag: the body stretches below the grip while hanging
 *   3. drag: floppy parts lag behind acceleration and wobble to rest
 *   4. squash and rebound on impact, quickly damped
 *   5. recovery: dents spring back when the fingers let go
 */
export class PlushDeformer {
  private readonly dents: DentSlot[] = [];
  private readonly squash = new Spring(5.4, 0.36);
  private readonly swayX = new Spring(2.5, 0.27);
  private readonly swayY = new Spring(2.5, 0.27);
  private readonly swayZ = new Spring(2.5, 0.27);
  private sag = 0;
  private droop = 0.003;
  private readonly size: number;
  /** Fewer slots are used on the basic quality level. */
  maxDents = MAX_DENTS;
  /** Multiplier for the whole effect (reduced motion lowers it). */
  intensity = 1;

  constructor(
    private readonly uniforms: PlushUniforms,
    private readonly asset: PlushAsset,
  ) {
    for (let i = 0; i < MAX_DENTS; i++) this.dents.push({ key: -1, depth: new Spring(8.5, 0.5), age: 999 });
    this.size = Math.max(0.08, asset.size[1]);
    this.uniforms.uGrip.value.set(0, this.size * 0.8, 0, this.size);
    this.uniforms.uDroop.value = this.droop;
  }

  /**
   * Reports a contact from a claw part this frame. Position and direction are
   * in the toy's local (unscaled) space; `pressure` is 0..1.
   */
  contact(key: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, pressure: number): void {
    let slot = this.dents.find((d) => d.key === key);
    if (!slot) {
      // Reuse a free slot, or the one that has been idle the longest.
      let best = -1;
      for (let i = 0; i < this.maxDents; i++) {
        const d = this.dents[i]!;
        if (d.key === -1) {
          best = i;
          break;
        }
        if (best === -1 || d.age > this.dents[best]!.age) best = i;
      }
      if (best === -1) return;
      slot = this.dents[best]!;
      slot.key = key;
      slot.depth.snap(0);
      const i = best;
      this.uniforms.uDent.value[i]!.set(x, y, z, this.asset.deform.dentRadius);
      this.uniforms.uDentDir.value[i]!.set(dx, dy, dz, 0);
    }
    const i = this.dents.indexOf(slot);
    const centre = this.uniforms.uDent.value[i]!;
    const dir = this.uniforms.uDentDir.value[i]!;
    // Follow the contact smoothly so the dent slides instead of popping.
    const k = slot.age > 3 ? 1 : 0.35;
    centre.x += (x - centre.x) * k;
    centre.y += (y - centre.y) * k;
    centre.z += (z - centre.z) * k;
    const nx = dir.x + (dx - dir.x) * k, ny = dir.y + (dy - dir.y) * k, nz = dir.z + (dz - dir.z) * k;
    const len = Math.hypot(nx, ny, nz) || 1;
    dir.x = nx / len;
    dir.y = ny / len;
    dir.z = nz / len;
    // The proxy sits a little inside the fur, so a touching finger always sinks in; pressure adds to that.
    slot.depth.target = (0.0085 + 0.012 * clamp(pressure, 0, 1)) * this.intensity;
    slot.age = 0;
  }

  /** A sudden impact: `strength` is the speed change in m/s, direction and pivot are local. */
  impact(dx: number, dy: number, dz: number, px: number, py: number, pz: number, strength: number): void {
    if (strength < 0.5 || this.intensity <= 0) return;
    const kick = clamp(strength * 2.4, 0, 11) * (0.5 + this.asset.deform.squash) * this.intensity;
    // A weaker hit while a stronger squash is still playing only adds a little energy.
    if (Math.abs(this.squash.value) > 0.04 && kick < Math.abs(this.squash.velocity)) {
      this.squash.kick(kick * 0.25);
      return;
    }
    this.uniforms.uSquashAxis.value.set(dx, dy, dz).normalize();
    this.uniforms.uSquashPivot.value.set(px, py, pz);
    this.squash.kick(kick);
  }

  /** Advances all springs. Returns false once everything has settled (the toy may then sleep). */
  update(dt: number, frame: DeformFrame): boolean {
    const u = this.uniforms;
    let active = false;
    u.uGravity.value.copy(frame.gravity);

    for (let i = 0; i < MAX_DENTS; i++) {
      const slot = this.dents[i]!;
      if (slot.key === -1) continue;
      slot.age++;
      if (slot.age > 2) slot.depth.target = 0; // contact ended: spring back (slight overshoot = recovery)
      const depth = slot.depth.step(dt);
      u.uDentDir.value[i]!.w = depth;
      if (slot.age > 2 && slot.depth.isResting(2e-5)) {
        slot.key = -1;
        u.uDentDir.value[i]!.w = 0;
      } else active = true;
    }

    const squash = clamp(this.squash.step(dt), -0.22, 0.34);
    u.uSquash.value = squash;
    if (!this.squash.isResting(5e-4)) active = true;
    else if (squash !== 0) {
      this.squash.snap(0);
      u.uSquash.value = 0;
    }

    // Hanging: stretch below the grip and let floppy parts hang.
    const sagTarget = frame.held * this.asset.deform.sag * 0.2 * this.intensity;
    this.sag = damp(this.sag, sagTarget, 0.14, dt);
    u.uSag.value = this.sag;
    if (frame.held > 0) u.uGrip.value.set(frame.grip.x, frame.grip.y, frame.grip.z, this.size);
    this.droop = damp(this.droop, (0.003 + frame.held * 0.011) * (0.4 + this.asset.deform.sway) * this.intensity, 0.18, dt);
    u.uDroop.value = this.droop;
    if (Math.abs(this.sag - sagTarget) > 1e-4) active = true;

    // Drag: soft parts are pushed opposite to the acceleration and overshoot when it stops.
    const gain = 0.0075 * (0.35 + this.asset.deform.sway) * this.intensity;
    _target.copy(frame.accel).multiplyScalar(-gain);
    const len = _target.length();
    if (len > 0.04) _target.multiplyScalar(0.04 / len);
    this.swayX.target = _target.x;
    this.swayY.target = _target.y;
    this.swayZ.target = _target.z;
    u.uSway.value.set(this.swayX.step(dt), this.swayY.step(dt), this.swayZ.step(dt));
    if (len > 2e-4 || !this.swayX.isResting(4e-5) || !this.swayY.isResting(4e-5) || !this.swayZ.isResting(4e-5)) active = true;
    return active || frame.held > 0;
  }

  /** True while any dent is visible. */
  hasDents(): boolean {
    return this.dents.some((d) => d.key !== -1);
  }
}
