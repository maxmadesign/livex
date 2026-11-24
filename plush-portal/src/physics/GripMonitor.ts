import { Quaternion, Vector3 } from 'three';
import { clamp01, smoothstep } from '../core/math';
import type { ContactLevel, SlipReason } from '../core/types';
import type { ClawRig } from './ClawRig';
import { FIXED_DT } from './fieldSpec';
import type { PhysicsWorld, ToyBody } from './PhysicsWorld';

/** A real contact between a claw part and a toy during the last physics step. */
export interface ClawContact {
  toy: ToyBody;
  /** 0..2 = finger index, 3 = palm. */
  part: number;
  /** World-space contact point. */
  px: number;
  py: number;
  pz: number;
  /** World-space normal pointing from the claw part into the toy. */
  nx: number;
  ny: number;
  nz: number;
  /** Normal impulse applied by the solver this step (N·s). */
  impulse: number;
  role: 'core' | 'appendage';
}

interface ToyContactState {
  toy: ToyBody;
  /** Continuous contact time per finger (s). */
  fingerTime: [number, number, number];
  /** Steps since each finger last touched. */
  fingerGap: [number, number, number];
  palmTime: number;
  palmGap: number;
  /** Share of recent contacts that were on core body parts. */
  coreShare: number;
  everTouched: boolean;
}

export interface GripFacts {
  /** Number of fingers in sustained contact when the grip was evaluated. */
  fingers: number;
  palm: boolean;
  /** 1 = toy centred under the claw, 0 = far off centre. */
  centering: number;
  /** 1 = finger tips under the toy's centre of mass, 0 = only touching from above. */
  support: number;
  /** 1 = holding the body, 0 = holding only ears / tail / limbs. */
  core: number;
  /** Measured finger opening 0..1 when the grip was evaluated. */
  opening: number;
  quality: number;
}

interface Assist {
  toy: ToyBody;
  /** Attachment point in toy-local and hub-local space (identical world point at creation). */
  anchorToy: Vector3;
  anchorHub: Vector3;
  /** Force limit at full contact support, newtons. */
  maxForce: number;
  stiffness: number;
  damping: number;
  /** Seconds without any finger touching the toy. */
  noContactTime: number;
  overstretchTime: number;
  /** Smoothed 0..1 factor from how many fingers currently touch the toy. */
  contactFactor: number;
}

export interface GripSettings {
  /** Player setting 0..1.5; 0 disables the assist completely. */
  assist: number;
  clawForce: number;
}

const _toyPos = new Vector3();
const _hubPos = new Vector3();
const _toyQ = new Quaternion();
const _hubQ = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _tip = new Vector3();

const MIN_FINGER_TIME = 0.06;
/** Aim error (as a fraction of the toy's solid half-width) up to which a grab counts as fully centred… */
const CENTER_FULL = 0.3;
/** …and beyond which it counts as not centred at all. */
const CENTER_NONE = 0.95;
const LIFT_HEIGHT = 0.03;
const SLIP_DISTANCE = 0.055;

/**
 * Watches the real contacts between the claw and the toys and turns them into
 * grip facts. When at least two fingers hold a toy it may add a *limited*
 * spring between the hub and the point of the toy that sits in the grasp — an
 * arcade-style assist that can only exist after real multi-finger contact,
 * starts with zero offset (no snapping), is capped in force by the quality of
 * the real grip and breaks when the load exceeds it or the fingers let go.
 */
export class GripMonitor {
  /** Contacts found in the last step (valid until the next `scan`). */
  readonly contacts: ClawContact[] = [];
  private readonly pool: ClawContact[] = [];
  private readonly states = new Map<ToyBody, ToyContactState>();
  private assist: Assist | null = null;
  private readonly aimSnapshot = new Map<ToyBody, { x: number; z: number }>();
  settings: GripSettings = { assist: 1, clawForce: 1 };

  /* Facts for the round result. */
  target: ToyBody | null = null;
  facts: GripFacts | null = null;
  contactLevel: ContactLevel = 'none';
  slipReason: SlipReason | null = null;
  /** True once the target got away (assist broke / carried toy fell). */
  slipped = false;
  liftedMs = 0;
  private targetStartY = 0;
  /** Largest trolley acceleration seen while the toy was held (m/s²). */
  private peakAccel = 0;
  /** Load on the assist relative to its limit, 0..1+ (diagnostics / audio). */
  load = 0;

  constructor(
    private readonly phys: PhysicsWorld,
    private readonly claw: ClawRig,
  ) {}

  /** Resets everything for a new round. */
  beginRound(): void {
    this.states.clear();
    this.aimSnapshot.clear();
    this.assist = null;
    this.target = null;
    this.facts = null;
    this.contactLevel = 'none';
    this.slipReason = null;
    this.slipped = false;
    this.liftedMs = 0;
    this.peakAccel = 0;
    this.load = 0;
    for (const c of this.contacts) this.pool.push(c);
    this.contacts.length = 0;
  }

  /**
   * Remembers where every toy was when the grab started (before the claw
   * disturbs anything). Call once when the descent begins.
   */
  markAim(): void {
    this.aimSnapshot.clear();
    for (const toy of this.phys.toys.values()) {
      if (toy.inBin) continue;
      const com = toy.body.worldCom(this.phys.scratchV);
      this.aimSnapshot.set(toy, { x: com.x, z: com.z });
    }
  }

  get assistActive(): boolean {
    return this.assist !== null;
  }

  /** How many fingers currently touch the given toy. */
  fingersOn(toy: ToyBody): number {
    const s = this.states.get(toy);
    if (!s) return 0;
    let n = 0;
    for (let i = 0; i < 3; i++) if (s.fingerGap[i]! <= 2 && s.fingerTime[i]! > 0) n++;
    return n;
  }

  private raise(level: ContactLevel): void {
    const order: ContactLevel[] = ['none', 'touched', 'gripped', 'lifted'];
    if (order.indexOf(level) > order.indexOf(this.contactLevel)) this.contactLevel = level;
  }

  /* ----------------------------------------------------------------- scan */

  /** Call after every physics step while the claw is in its automatic sequence. */
  scan(dt: number = FIXED_DT): void {
    for (const c of this.contacts) this.pool.push(c);
    this.contacts.length = 0;
    const world = this.phys.world;

    const visit = (collider: import('@dimforge/rapier3d-compat').Collider, part: number) => {
      world.contactPairsWith(collider, (other) => {
        const toy = this.phys.toyOfCollider(other.handle);
        if (!toy) return;
        const meta = this.phys.toyColliderMeta(other.handle);
        world.contactPair(collider, other, (manifold, flipped) => {
          const n = manifold.numSolverContacts();
          if (n === 0) return;
          let impulse = 0;
          for (let i = 0; i < manifold.numContacts(); i++) impulse += manifold.contactImpulse(i);
          let closest = Infinity;
          let px = 0;
          let py = 0;
          let pz = 0;
          for (let i = 0; i < n; i++) {
            const d = manifold.solverContactDist(i);
            if (d < closest) {
              const p = manifold.solverContactPoint(i);
              if (!p) continue;
              closest = d;
              px = p.x;
              py = p.y;
              pz = p.z;
            }
          }
          // Only count real touches: penetrating / resting contacts or contacts that carried an impulse.
          if (!(closest < 0.0035 || impulse > 0)) return;
          const normal = manifold.normal();
          const sign = flipped ? -1 : 1;
          const c = this.pool.pop() ?? ({} as ClawContact);
          c.toy = toy;
          c.part = part;
          c.px = px;
          c.py = py;
          c.pz = pz;
          c.nx = normal.x * sign;
          c.ny = normal.y * sign;
          c.nz = normal.z * sign;
          c.impulse = impulse;
          c.role = meta?.role ?? 'core';
          this.contacts.push(c);
        });
      });
    };

    visit(this.claw.hubCollider, 3);
    for (const f of this.claw.fingers) for (const collider of f.colliders) visit(collider, f.index);

    // Update per-toy timers.
    for (const s of this.states.values()) {
      for (let i = 0; i < 3; i++) s.fingerGap[i]!++;
      s.palmGap++;
    }
    for (const c of this.contacts) {
      let s = this.states.get(c.toy);
      if (!s) {
        s = { toy: c.toy, fingerTime: [0, 0, 0], fingerGap: [99, 99, 99], palmTime: 0, palmGap: 99, coreShare: 1, everTouched: true };
        this.states.set(c.toy, s);
      }
      if (c.part === 3) s.palmGap = 0;
      else s.fingerGap[c.part] = 0;
      s.coreShare += ((c.role === 'core' ? 1 : 0) - s.coreShare) * 0.08;
    }
    for (const s of this.states.values()) {
      for (let i = 0; i < 3; i++) {
        if (s.fingerGap[i] === 0) s.fingerTime[i]! += dt;
        else if (s.fingerGap[i]! > 3) s.fingerTime[i] = 0;
      }
      if (s.palmGap === 0) s.palmTime += dt;
      else if (s.palmGap > 3) s.palmTime = 0;
    }
    if (this.contacts.length > 0) this.raise('touched');
  }

  /* --------------------------------------------------------- grip decision */

  private evaluate(toy: ToyBody): GripFacts {
    const s = this.states.get(toy)!;
    let fingers = 0;
    let support = 0;
    const com = toy.body.worldCom(this.phys.scratchV);
    const comX = com.x;
    const comY = com.y;
    const comZ = com.z;
    for (let i = 0; i < 3; i++) {
      if (s.fingerTime[i]! < MIN_FINGER_TIME || s.fingerGap[i]! > 2) continue;
      fingers++;
      this.claw.fingerTip(i, _tip);
      // A tip that reached below the centre of mass really carries the toy.
      support += smoothstep(0.03, -0.02, _tip.y - comY);
    }
    support = fingers > 0 ? support / fingers : 0;
    // Aim error: how far the claw's axis (the trolley, where the player stopped it) was from the
    // toy's centre of mass before the claw touched anything. A closing claw drags a toy towards its
    // middle, so measuring after the fact would hide a sloppy aim.
    const aimed = this.aimSnapshot.get(toy);
    let offset: number;
    if (aimed) offset = Math.hypot(aimed.x - this.claw.trolleyX, aimed.z - this.claw.trolleyZ);
    else {
      this.claw.gripCenter(_a);
      offset = Math.hypot(comX - _a.x, comZ - _a.z);
    }
    // "Centred" is judged against the solid width of the toy (not just the part that touches the floor).
    const reach = Math.max(0.06, Math.max(toy.asset.footprint, 0.4 * Math.min(toy.asset.size[0], toy.asset.size[2])) * toy.scale);
    const centering = 1 - smoothstep(CENTER_FULL * reach, CENTER_NONE * reach, offset);
    const opening = this.claw.fingerOpening();
    const core = clamp01(s.coreShare);
    const palm = s.palmTime > 0.04 && s.palmGap <= 2;

    const fingerTerm = fingers >= 3 ? 1 : fingers === 2 ? 0.62 : fingers === 1 ? 0.22 : 0;
    // Fingers that closed almost completely are pinching something thin, not holding a body.
    const thin = opening < 0.07 ? 0.5 : 1;
    const quality = clamp01(
      fingerTerm * (0.35 + 0.65 * centering) * (0.5 + 0.5 * support) * (0.45 + 0.55 * core) * thin + (palm && fingers >= 2 ? 0.05 : 0),
    );
    return { fingers, palm, centering, support, core, opening, quality };
  }

  /**
   * Evaluates the real contacts once the fingers have closed, picks the single
   * valid target of this round and (when at least two fingers hold it and the
   * assist setting allows) creates the limited assist spring.
   */
  establish(): GripFacts | null {
    if (this.target) return this.facts;
    let best: ToyBody | null = null;
    let bestFacts: GripFacts | null = null;
    for (const s of this.states.values()) {
      const facts = this.evaluate(s.toy);
      if (facts.fingers === 0) continue;
      if (!bestFacts || facts.quality > bestFacts.quality) {
        best = s.toy;
        bestFacts = facts;
      }
    }
    if (!best || !bestFacts) return null;
    this.target = best;
    this.facts = bestFacts;
    this.targetStartY = best.body.translation(this.phys.scratchV).y;
    if (bestFacts.fingers >= 2) {
      this.raise('gripped');
      if (this.settings.assist > 0) this.createAssist(best, bestFacts);
    }
    return bestFacts;
  }

  private createAssist(toy: ToyBody, facts: GripFacts): void {
    // The attachment point is the point of the toy's body closest to the centre of the grasp:
    // it is where the fingers actually hold it, so there is no offset to snap away.
    this.claw.gripCenter(_a);
    let bestDist = Infinity;
    let inside = false;
    _b.copy(_a);
    for (const c of toy.colliders) {
      if (c.role !== 'core') continue;
      const proj = c.collider.projectPoint({ x: _a.x, y: _a.y, z: _a.z }, true);
      if (!proj) continue;
      const d = Math.hypot(proj.point.x - _a.x, proj.point.y - _a.y, proj.point.z - _a.z);
      if (proj.isInside) {
        inside = true;
        _b.copy(_a);
        bestDist = 0;
        break;
      }
      if (d < bestDist) {
        bestDist = d;
        _b.set(proj.point.x, proj.point.y, proj.point.z);
      }
    }
    if (!inside && bestDist === Infinity) return; // no core part near the grasp: nothing to hold on to
    const com = toy.body.worldCom(this.phys.scratchV);
    if (!inside) {
      // Move the anchor a little into the body so it is not a point on the bare surface.
      _c.set(com.x - _b.x, com.y - _b.y, com.z - _b.z);
      const len = _c.length();
      if (len > 1e-4) _b.addScaledVector(_c, Math.min(0.015, len * 0.5) / len);
    }

    const t = toy.body.translation(this.phys.scratchV);
    _toyPos.set(t.x, t.y, t.z);
    const r = toy.body.rotation(this.phys.scratchQ);
    _toyQ.set(r.x, r.y, r.z, r.w);
    const ht = this.claw.hub.translation(this.phys.scratchV);
    _hubPos.set(ht.x, ht.y, ht.z);
    const hr = this.claw.hub.rotation(this.phys.scratchQ);
    _hubQ.set(hr.x, hr.y, hr.z, hr.w);

    const weight = toy.mass * 9.81;
    const maxForce = weight * this.settings.assist * Math.sqrt(Math.max(0.1, this.settings.clawForce)) * (0.25 + 1.75 * facts.quality);
    const stiffness = Math.max(60, maxForce / 0.012);
    this.assist = {
      toy,
      anchorToy: _b.clone().sub(_toyPos).applyQuaternion(_toyQ.clone().invert()),
      anchorHub: _b.clone().sub(_hubPos).applyQuaternion(_hubQ.clone().invert()),
      maxForce,
      stiffness,
      damping: 2 * 0.8 * Math.sqrt(stiffness * toy.mass),
      noContactTime: 0,
      overstretchTime: 0,
      contactFactor: 1,
    };
  }

  /* ---------------------------------------------------------------- forces */

  /** Call before every physics step: applies the assist spring (if any). */
  preStep(dt: number = FIXED_DT): void {
    const assist = this.assist;
    if (!assist) {
      this.load = 0;
      return;
    }
    const toy = assist.toy;
    const t = toy.body.translation(this.phys.scratchV);
    _toyPos.set(t.x, t.y, t.z);
    const r = toy.body.rotation(this.phys.scratchQ);
    _toyQ.set(r.x, r.y, r.z, r.w);
    const ht = this.claw.hub.translation(this.phys.scratchV);
    _hubPos.set(ht.x, ht.y, ht.z);
    const hr = this.claw.hub.rotation(this.phys.scratchQ);
    _hubQ.set(hr.x, hr.y, hr.z, hr.w);

    _a.copy(assist.anchorToy).applyQuaternion(_toyQ).add(_toyPos); // point on the toy
    _b.copy(assist.anchorHub).applyQuaternion(_hubQ).add(_hubPos); // where the claw holds it
    const dx = _b.x - _a.x;
    const dy = _b.y - _a.y;
    const dz = _b.z - _a.z;
    const stretch = Math.hypot(dx, dy, dz);

    const vt = toy.body.velocityAtPoint({ x: _a.x, y: _a.y, z: _a.z }, this.phys.scratchV);
    const vtx = vt.x;
    const vty = vt.y;
    const vtz = vt.z;
    const vh = this.claw.hub.velocityAtPoint({ x: _b.x, y: _b.y, z: _b.z }, this.phys.scratchV);

    // Real finger contact is required to keep the assist alive.
    const touching = this.fingersOn(toy);
    const wanted = touching >= 2 ? 1 : touching === 1 ? 0.7 : 0;
    assist.contactFactor += (wanted - assist.contactFactor) * Math.min(1, dt / 0.09);
    assist.noContactTime = touching === 0 ? assist.noContactTime + dt : 0;

    let fx = assist.stiffness * dx + assist.damping * (vh.x - vtx);
    let fy = assist.stiffness * dy + assist.damping * (vh.y - vty);
    let fz = assist.stiffness * dz + assist.damping * (vh.z - vtz);
    const limit = assist.maxForce * assist.contactFactor;
    const magnitude = Math.hypot(fx, fy, fz);
    this.load = limit > 1e-6 ? magnitude / limit : 2;
    if (magnitude > limit) {
      const k = limit / magnitude;
      fx *= k;
      fy *= k;
      fz *= k;
    }
    // Equal and opposite: the claw (and therefore the cable) carries the toy's weight.
    toy.body.applyImpulseAtPoint({ x: fx * dt, y: fy * dt, z: fz * dt }, { x: _a.x, y: _a.y, z: _a.z }, true);
    this.claw.hub.applyImpulseAtPoint({ x: -fx * dt, y: -fy * dt, z: -fz * dt }, { x: _b.x, y: _b.y, z: _b.z }, true);

    this.peakAccel = Math.max(this.peakAccel, Math.hypot(this.claw.trolleyAX, this.claw.trolleyAZ));
    assist.overstretchTime = stretch > SLIP_DISTANCE ? assist.overstretchTime + dt : 0;
    if (assist.noContactTime > 0.22) this.breakAssist('contact_lost');
    else if (assist.overstretchTime > 0.04) this.breakAssist(this.classifyOverload());
  }

  private classifyOverload(): SlipReason {
    const f = this.facts;
    if (!f) return 'overload';
    const moving = Math.hypot(this.claw.trolleyVX, this.claw.trolleyVZ) > 0.08 || this.claw.swingSpeed() > 0.25;
    if (f.centering < 0.45) return 'eccentric';
    if (f.fingers < 3 || f.support < 0.4 || f.core < 0.5) return 'weak_support';
    if (moving) return 'transport_swing';
    return 'overload';
  }

  private breakAssist(reason: SlipReason): void {
    if (!this.assist) return;
    this.assist = null;
    this.load = 0;
    if (!this.slipReason) this.slipReason = reason;
  }

  /** Lets go on purpose (claw opens over the chute). Not a slip. */
  release(): void {
    this.assist = null;
    this.load = 0;
  }

  /* ----------------------------------------------------------- bookkeeping */

  /**
   * Call after every physics step during LIFTING / TRANSPORTING: tracks how
   * long the target is really carried and detects when it gets away.
   */
  track(dt: number = FIXED_DT, lifting = true): void {
    // A toy that is physically carried without ever qualifying at closing time can still become
    // the (single) target while the claw has only just started to rise.
    if (!this.target && lifting) {
      for (const s of this.states.values()) {
        if (this.fingersOn(s.toy) === 0) continue;
        const v = s.toy.body.linvel(this.phys.scratchV);
        if (v.y > 0.08) {
          this.target = s.toy;
          this.facts = this.evaluate(s.toy);
          this.targetStartY = s.toy.body.translation(this.phys.scratchV).y;
          break;
        }
      }
    }
    const toy = this.target;
    if (!toy || this.slipped) return;
    const y = toy.body.translation(this.phys.scratchV).y;
    const rise = y - this.targetStartY;
    const held = this.assist !== null || this.fingersOn(toy) > 0;
    if (held && rise > LIFT_HEIGHT) {
      this.raise('lifted');
      this.liftedMs += dt * 1000;
    }
    if (!held && (this.contactLevel === 'lifted' || this.contactLevel === 'gripped')) {
      // The toy is no longer attached to the claw in any way: it got away.
      this.slipped = true;
      if (!this.slipReason) {
        const f = this.facts;
        this.slipReason = f && f.centering < 0.45 ? 'eccentric' : f && (f.fingers < 3 || f.support < 0.4) ? 'weak_support' : 'contact_lost';
      }
    }
  }

  /** True while the target is attached to the claw (assist or real finger contact). */
  holding(): boolean {
    const toy = this.target;
    if (!toy || this.slipped) return false;
    return this.assist !== null || this.fingersOn(toy) > 0;
  }
}
