import type { GameCore } from '../game/GameCore';
import { CHUTE, CLAW, FIELD } from '../physics/fieldSpec';
import type { ToyBody } from '../physics/PhysicsWorld';

/**
 * Plays attract-mode rounds through exactly the same input path as a player:
 * it only sets the direction input and requests the grab. The round is
 * flagged as a demo, so nothing it wins is added to the collection.
 */
export class DemoPilot {
  private target: ToyBody | null = null;
  private wait = 0;
  private aimX = 0;
  private aimZ = 0;
  private aimTime = 0;

  reset(): void {
    this.target = null;
    this.wait = 0;
    this.aimTime = 0;
  }

  private pick(core: GameCore): void {
    let best: ToyBody | null = null;
    let bestScore = -Infinity;
    for (const toy of core.field.onField()) {
      const p = toy.pose.pos;
      const x = p[0]!, y = p[1]!, z = p[2]!;
      if (x < CLAW.minX || x > CLAW.maxX || z < CLAW.minZ || z > CLAW.maxZ) continue;
      if (x < CHUTE.xMax + 0.14 && z > CHUTE.zMin - 0.14) continue;
      // Prefer upright toys resting on the floor near the middle.
      const r = toy.pose.rot;
      const upY = 1 - 2 * (r[0]! * r[0]! + r[2]! * r[2]!);
      const score = upY * 2 - Math.abs(y) * 6 - Math.hypot(x - 0.08, z + FIELD.depth / 2) * 0.8 + ((toy.id.length * 7 + core.machine.roundId * 13) % 5) * 0.12;
      if (score > bestScore) {
        bestScore = score;
        best = toy;
      }
    }
    this.target = best;
    if (best) {
      // Aim at the centre of mass, but never at a point the trolley cannot reach
      // (the pilot used to wait forever for a target a few millimetres outside the rails).
      const com = best.body.worldCom();
      this.aimX = Math.min(CLAW.maxX, Math.max(CLAW.minX, com.x));
      this.aimZ = Math.min(CLAW.maxZ, Math.max(CLAW.minZ, com.z));
    }
    this.wait = 0.9;
  }

  /** Call once per fixed step while a demo round is in READY / AIMING. */
  update(core: GameCore, dt: number): void {
    const phase = core.machine.phase;
    const c = core.controller;
    if (phase !== 'READY' && phase !== 'AIMING') {
      c.clearInput();
      return;
    }
    if (!this.target || !core.phys.toys.has(this.target.id)) this.pick(core);
    if (!this.target) {
      c.clearInput();
      if ((this.wait -= dt) < -1.5) c.requestGrab();
      return;
    }
    if (this.wait > 0) {
      this.wait -= dt;
      c.clearInput();
      return;
    }
    const dx = this.aimX - core.claw.trolleyX;
    const dz = this.aimZ - core.claw.trolleyZ;
    const d = Math.hypot(dx, dz);
    this.aimTime += dt;
    if (this.aimTime > 8) {
      // Safety net: a demo round always ends, wherever the claw got to.
      c.clearInput();
      c.requestGrab();
      return;
    }
    if (d > 0.005) {
      // Ease in towards the target like a careful player.
      const k = Math.min(1, d / 0.06 + 0.12) / d;
      c.inputX = dx * k;
      c.inputZ = dz * k;
    } else {
      c.clearInput();
      if (Math.hypot(core.claw.trolleyVX, core.claw.trolleyVZ) < 0.01) c.requestGrab();
    }
  }
}
