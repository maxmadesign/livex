import type { GameCore } from '../game/GameCore';
import { rarityOf, tierRank } from '../game/rarity';
import { CHUTE, CLAW, FIELD } from '../physics/fieldSpec';
import type { ToyBody } from '../physics/PhysicsWorld';

/** Longest the pilot waits for the cable to stop swinging before it grabs anyway (s). */
const PATIENCE = 2.5;

/**
 * Plays attract-mode rounds through exactly the same input path as a player:
 * it only sets the direction input and requests the grab. The round is
 * flagged as a demo, so nothing it wins is counted anywhere.
 *
 * It plays like a careful player so that the attract screen shows wins (and
 * their effects) often: it picks a toy that is easy to catch — upright, resting
 * on the floor, with room around it, not far from the exit — aims at its centre
 * of mass and waits for the claw to stop swinging before it grabs. Every third
 * round it prefers a rarer character so the bigger celebrations show up too.
 * It never changes the claw, the grip or the physics: a demo win is a real win.
 */
export class DemoPilot {
  private target: ToyBody | null = null;
  private wait = 0;
  private aimX = 0;
  private aimZ = 0;
  private aimTime = 0;
  private steady = 0;
  private rounds = 0;

  reset(): void {
    this.target = null;
    this.wait = 0;
    this.aimTime = 0;
    this.steady = 0;
    this.rounds++;
  }

  /** Score of a candidate target: higher is easier to win (and more fun to show). */
  private rate(core: GameCore, toy: ToyBody, others: readonly ToyBody[], preferRare: boolean): number {
    const com = toy.body.worldCom(core.phys.scratchV);
    const x = com.x, y = com.y, z = com.z;
    // Prefer upright toys resting on the floor near the middle.
    const r = toy.pose.rot;
    const upY = 1 - 2 * (r[0]! * r[0]! + r[2]! * r[2]!);
    const restY = toy.asset.comHeight * toy.scale;
    let score = upY * 2 - Math.max(0, y - restY - 0.02) * 8 - Math.hypot(x - 0.08, z + FIELD.depth / 2) * 0.5;
    // Room around it: a neighbour leaning on the toy (or under a finger) spoils many grabs.
    let nearest = Infinity;
    for (const other of others) {
      if (other === toy) continue;
      const p = other.pose.pos;
      nearest = Math.min(nearest, Math.hypot(p[0]! - x, p[2]! - z));
    }
    score += Math.min(nearest, 0.2) * 6;
    // A short trip to the exit swings less.
    score -= Math.hypot(x - CLAW.dropX, z - CLAW.dropZ) * 0.6;
    if (preferRare) score += tierRank(rarityOf(toy.asset.id)) * 0.45;
    // A little variety between rounds.
    score += ((toy.id.length * 7 + core.machine.roundId * 13) % 5) * 0.06;
    return score;
  }

  private pick(core: GameCore): void {
    let best: ToyBody | null = null;
    let bestScore = -Infinity;
    const toys = core.field.onField();
    const preferRare = this.rounds % 3 === 0;
    for (const toy of toys) {
      const p = toy.pose.pos;
      const x = p[0]!, z = p[2]!;
      if (x < CLAW.minX || x > CLAW.maxX || z < CLAW.minZ || z > CLAW.maxZ) continue;
      if (x < CHUTE.xMax + 0.14 && z > CHUTE.zMin - 0.14) continue;
      const score = this.rate(core, toy, toys, preferRare);
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
    if (this.aimTime > 8 + PATIENCE) {
      // Safety net: a demo round always ends, wherever the claw got to.
      c.clearInput();
      c.requestGrab();
      return;
    }
    if (d > 0.004) {
      // Ease in towards the target like a careful player.
      const k = Math.min(1, d / 0.05 + 0.06) / d;
      c.inputX = dx * k;
      c.inputZ = dz * k;
      this.steady = 0;
    } else {
      c.clearInput();
      if (Math.hypot(core.claw.trolleyVX, core.claw.trolleyVZ) >= 0.01) return;
      // A patient player lets the claw stop swinging first.
      this.steady += dt;
      if (core.claw.swingSpeed() < 0.02 || this.steady > PATIENCE) c.requestGrab();
    }
  }
}
