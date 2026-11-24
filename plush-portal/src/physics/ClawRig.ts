import { Quaternion, Vector3 } from 'three';
import { approach, clamp } from '../core/math';
import { BodyPose, RAPIER, type PhysicsWorld } from './PhysicsWorld';
import { CLAW, FIXED_DT, GROUP, groups } from './fieldSpec';

/** Gameplay-tunable claw parameters (latched at round boundaries). */
export interface ClawParams {
  /** Trolley top speed, m/s. */
  moveSpeed: number;
  moveAccel: number;
  descendSpeed: number;
  liftSpeed: number;
  /** Finger motor torque multiplier. */
  clawForce: number;
  /** Finger closing speed multiplier. */
  closeSpeed: number;
  /** 0 = stiff, 1 = freely swinging cable. */
  ropeSwing: number;
}

export const DEFAULT_CLAW_PARAMS: ClawParams = {
  moveSpeed: 0.42,
  moveAccel: 2.4,
  descendSpeed: 0.55,
  liftSpeed: 0.42,
  clawForce: 1,
  closeSpeed: 1,
  ropeSwing: 0.55,
};

export interface Finger {
  index: number;
  azimuth: number;
  body: RAPIER.RigidBody;
  joint: RAPIER.RevoluteImpulseJoint;
  colliders: RAPIER.Collider[];
  pose: BodyPose;
  /** Hinge axis in hub-local space. */
  axis: Vector3;
  /** Radial direction in hub-local space. */
  radial: Vector3;
  /** Current hinge angle (0 closed .. openAngle). */
  angle: number;
  angularSpeed: number;
}

const CLAW_GROUPS = groups(GROUP.CLAW, GROUP.STATIC | GROUP.TOY | GROUP.TOY_SOFT);
const ROPE_STIFFNESS = 2600; // N/m
const ROPE_DAMPING = 46; // N·s/m
const FINGER_STIFFNESS = 4.2; // N·m/rad
const FINGER_DAMPING = 0.09; // N·m·s/rad
const FINGER_TORQUE = 0.42; // N·m at clawForce = 1
const FINGER_BASE_SPEED = 1.9; // rad/s at closeSpeed = 1
const ROPE_ACCEL = 3.2; // m/s²

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const UP = new Vector3(0, 1, 0);

/**
 * The physical claw: a kinematic trolley on the gantry, a cable of variable
 * length and a dynamic hub with three hinged fingers driven by force-limited
 * motors. The hub hangs from the trolley through a one-sided spring (a rope:
 * it can pull but never push), so it swings, goes slack when the claw lands on
 * something and carries the real weight of whatever the fingers hold.
 */
export class ClawRig {
  readonly hub: RAPIER.RigidBody;
  readonly hubCollider: RAPIER.Collider;
  readonly hubPose = new BodyPose();
  readonly fingers: Finger[] = [];
  params: ClawParams = { ...DEFAULT_CLAW_PARAMS };

  /* Trolley (kinematic, integrated here). */
  trolleyX: number = CLAW.homeX;
  trolleyZ: number = CLAW.homeZ;
  trolleyVX = 0;
  trolleyVZ = 0;
  trolleyAX = 0;
  trolleyAZ = 0;
  prevTrolleyX: number = CLAW.homeX;
  prevTrolleyZ: number = CLAW.homeZ;
  private mode: 'velocity' | 'goto' = 'velocity';
  private wantVX = 0;
  private wantVZ = 0;
  private gotoX = 0;
  private gotoZ = 0;
  private gotoSpeed = 0;

  /* Winch. */
  ropeLength: number = CLAW.ropeMin;
  prevRopeLength: number = CLAW.ropeMin;
  ropeSpeed = 0;
  private ropeTarget: number = CLAW.ropeMin;
  private ropeMaxSpeed = 0;
  /** Rope tension in newtons after the last step (0 when slack). */
  tension = 0;
  /** Seconds the rope has been continuously slack. */
  slackTime = 0;

  /* Fingers. */
  /** Commanded hinge angle (moves towards `fingerGoal` at the closing speed). */
  private fingerCommand: number = CLAW.openAngle;
  private fingerGoal: number = CLAW.openAngle;
  private fingerRate = FINGER_BASE_SPEED;
  /** Seconds the fingers have been (nearly) motionless. */
  fingerStillTime = 0;

  private readonly castShape = new RAPIER.Ball(0.04);

  constructor(private readonly phys: PhysicsWorld) {
    const world = phys.world;
    const startY = CLAW.anchorY - CLAW.ropeMin - CLAW.hubTop;
    this.hub = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.trolleyX, startY, this.trolleyZ)
        .setLinearDamping(0.15)
        .setAngularDamping(1.2)
        .setCanSleep(false),
    );
    this.hubCollider = world.createCollider(
      RAPIER.ColliderDesc.cylinder(CLAW.hubHalfHeight, CLAW.hubRadius)
        .setMass(CLAW.hubMass)
        .setFriction(0.8)
        .setRestitution(0)
        .setCollisionGroups(CLAW_GROUPS),
      this.hub,
    );
    phys.clawColliders.add(this.hubCollider.handle);

    for (let i = 0; i < 3; i++) {
      const azimuth = CLAW.fingerAzimuth[i]!;
      const radial = new Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
      // radial × up: a positive rotation about this axis swings the finger tip outwards (opens the claw).
      const axis = new Vector3().crossVectors(radial, UP).normalize();
      const knuckle = new Vector3(radial.x * CLAW.knuckleRadius, -CLAW.knuckleDrop, radial.z * CLAW.knuckleRadius);

      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(this.trolleyX + knuckle.x, startY + knuckle.y, this.trolleyZ + knuckle.z)
          .setLinearDamping(0.1)
          .setAngularDamping(0.6)
          .setCanSleep(false),
      );
      const colliders: RAPIER.Collider[] = [];
      const elbow = new Vector3(radial.x * CLAW.elbow[0], -CLAW.elbow[1], radial.z * CLAW.elbow[0]);
      const tip = new Vector3(radial.x * CLAW.tip[0], -CLAW.tip[1], radial.z * CLAW.tip[0]);
      colliders.push(this.segmentCollider(body, new Vector3(0, 0, 0), elbow, CLAW.fingerRadius, CLAW.fingerMass * 0.4));
      colliders.push(this.segmentCollider(body, elbow, tip, CLAW.fingerRadius, CLAW.fingerMass * 0.45));
      colliders.push(
        world.createCollider(
          RAPIER.ColliderDesc.ball(CLAW.tipRadius)
            .setTranslation(tip.x, tip.y, tip.z)
            .setMass(CLAW.fingerMass * 0.15)
            .setFriction(1.25)
            .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
            .setRestitution(0)
            .setCollisionGroups(CLAW_GROUPS),
          body,
        ),
      );
      for (const c of colliders) phys.clawColliders.add(c.handle);

      const jointData = RAPIER.JointData.revolute(
        { x: knuckle.x, y: knuckle.y, z: knuckle.z },
        { x: 0, y: 0, z: 0 },
        { x: axis.x, y: axis.y, z: axis.z },
      );
      const joint = world.createImpulseJoint(jointData, this.hub, body, true) as RAPIER.RevoluteImpulseJoint;
      joint.setContactsEnabled(false);
      joint.setLimits(-0.04, CLAW.openAngle + 0.03);
      joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
      this.fingers.push({ index: i, azimuth, body, joint, colliders, pose: new BodyPose(), axis, radial, angle: 0, angularSpeed: 0 });
    }
    this.applyMotorSettings();
    this.reset(CLAW.homeX, CLAW.homeZ);
  }

  private segmentCollider(body: RAPIER.RigidBody, a: Vector3, b: Vector3, radius: number, mass: number): RAPIER.Collider {
    const mid = _v.addVectors(a, b).multiplyScalar(0.5);
    const dir = _v2.subVectors(b, a);
    const length = dir.length();
    dir.normalize();
    _q.setFromUnitVectors(UP, dir);
    return this.phys.world.createCollider(
      RAPIER.ColliderDesc.capsule(length / 2, radius)
        .setTranslation(mid.x, mid.y, mid.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setMass(mass)
        .setFriction(1.25)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setRestitution(0)
        .setCollisionGroups(CLAW_GROUPS),
      body,
    );
  }

  setParams(params: ClawParams): void {
    this.params = { ...params };
    this.applyMotorSettings();
  }

  private applyMotorSettings(): void {
    const torque = FINGER_TORQUE * this.params.clawForce;
    for (const f of this.fingers) {
      f.joint.setMotorMaxForce(torque);
      f.joint.configureMotorPosition(this.fingerCommand, FINGER_STIFFNESS, FINGER_DAMPING);
    }
  }

  /* -------------------------------------------------------------- commands */

  /** Aim mode: follow a desired velocity (already normalised by the caller), m/s. */
  setTrolleyVelocity(vx: number, vz: number): void {
    this.mode = 'velocity';
    this.wantVX = vx;
    this.wantVZ = vz;
  }

  /** Transport mode: travel to (x, z) with a smooth accelerate / brake profile. */
  setTrolleyTarget(x: number, z: number, speed: number): void {
    this.mode = 'goto';
    this.gotoX = clamp(x, CLAW.minX, CLAW.maxX);
    this.gotoZ = clamp(z, CLAW.minZ, CLAW.maxZ);
    this.gotoSpeed = speed;
  }

  trolleyArrived(tolerance = 0.004): boolean {
    return (
      this.mode === 'goto' &&
      Math.hypot(this.gotoX - this.trolleyX, this.gotoZ - this.trolleyZ) < tolerance &&
      Math.hypot(this.trolleyVX, this.trolleyVZ) < 0.03
    );
  }

  stopTrolley(): void {
    this.setTrolleyVelocity(0, 0);
  }

  /** Winch: move the cable length towards `length` at up to `speed` m/s. */
  setWinch(length: number, speed: number): void {
    this.ropeTarget = clamp(length, CLAW.ropeMin, CLAW.ropeMax);
    this.ropeMaxSpeed = Math.max(0, speed);
  }

  holdWinch(): void {
    this.ropeTarget = this.ropeLength;
    this.ropeMaxSpeed = 0;
  }

  winchArrived(): boolean {
    return Math.abs(this.ropeTarget - this.ropeLength) < 0.002 && Math.abs(this.ropeSpeed) < 0.02;
  }

  /** open01: 1 = fully open, 0 = fully closed. `speedScale` multiplies the configured closing speed. */
  setFingers(open01: number, speedScale = 1): void {
    this.fingerGoal = clamp(open01, 0, 1) * CLAW.openAngle;
    this.fingerRate = FINGER_BASE_SPEED * this.params.closeSpeed * speedScale;
    this.fingerStillTime = 0;
  }

  /** Average finger opening, 0 closed .. 1 open (measured, not commanded). */
  fingerOpening(): number {
    let sum = 0;
    for (const f of this.fingers) sum += f.angle;
    return clamp(sum / this.fingers.length / CLAW.openAngle, 0, 1);
  }

  fingersSettled(): boolean {
    return this.fingerStillTime > 0.12 || Math.abs(this.fingerCommand - this.fingerGoal) < 1e-3;
  }

  fingersAtGoal(): boolean {
    return Math.abs(this.fingerCommand - this.fingerGoal) < 1e-3;
  }

  /* ------------------------------------------------------------- per step */

  /** Call once per fixed step, before `PhysicsWorld.step()`. */
  preStep(dt: number = FIXED_DT): void {
    this.prevTrolleyX = this.trolleyX;
    this.prevTrolleyZ = this.trolleyZ;
    this.prevRopeLength = this.ropeLength;
    this.integrateTrolley(dt);
    this.integrateWinch(dt);
    this.driveFingers(dt);
    this.applyRope(dt);
    this.applyStabilisers(dt);
  }

  private integrateTrolley(dt: number): void {
    const accel = this.params.moveAccel;
    let targetVX = this.wantVX;
    let targetVZ = this.wantVZ;
    if (this.mode === 'goto') {
      const dx = this.gotoX - this.trolleyX;
      const dz = this.gotoZ - this.trolleyZ;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-5) {
        targetVX = 0;
        targetVZ = 0;
      } else {
        // Brake so that we arrive with zero speed (v² = 2·a·d), a little softer than the acceleration.
        const speed = Math.min(this.gotoSpeed, Math.sqrt(2 * accel * 0.8 * dist));
        targetVX = (dx / dist) * speed;
        targetVZ = (dz / dist) * speed;
      }
    }
    const maxDv = accel * dt;
    const dvx = targetVX - this.trolleyVX;
    const dvz = targetVZ - this.trolleyVZ;
    const dv = Math.hypot(dvx, dvz);
    const oldVX = this.trolleyVX;
    const oldVZ = this.trolleyVZ;
    if (dv <= maxDv) {
      this.trolleyVX = targetVX;
      this.trolleyVZ = targetVZ;
    } else {
      this.trolleyVX += (dvx / dv) * maxDv;
      this.trolleyVZ += (dvz / dv) * maxDv;
    }
    let x = this.trolleyX + this.trolleyVX * dt;
    let z = this.trolleyZ + this.trolleyVZ * dt;
    if (x < CLAW.minX || x > CLAW.maxX) {
      x = clamp(x, CLAW.minX, CLAW.maxX);
      this.trolleyVX = 0;
    }
    if (z < CLAW.minZ || z > CLAW.maxZ) {
      z = clamp(z, CLAW.minZ, CLAW.maxZ);
      this.trolleyVZ = 0;
    }
    if (this.mode === 'goto' && Math.hypot(this.gotoX - x, this.gotoZ - z) < 0.0015 && Math.hypot(this.trolleyVX, this.trolleyVZ) < 0.05) {
      x = this.gotoX;
      z = this.gotoZ;
      this.trolleyVX = 0;
      this.trolleyVZ = 0;
    }
    this.trolleyAX = (this.trolleyVX - oldVX) / dt;
    this.trolleyAZ = (this.trolleyVZ - oldVZ) / dt;
    this.trolleyX = x;
    this.trolleyZ = z;
  }

  private integrateWinch(dt: number): void {
    const err = this.ropeTarget - this.ropeLength;
    let want = 0;
    if (Math.abs(err) > 1e-4 && this.ropeMaxSpeed > 0) {
      want = Math.sign(err) * Math.min(this.ropeMaxSpeed, Math.sqrt(2 * ROPE_ACCEL * 0.8 * Math.abs(err)));
    }
    this.ropeSpeed = approach(this.ropeSpeed, want, ROPE_ACCEL * dt);
    let next = this.ropeLength + this.ropeSpeed * dt;
    if ((err > 0 && next > this.ropeTarget) || (err < 0 && next < this.ropeTarget)) {
      next = this.ropeTarget;
      this.ropeSpeed = 0;
    }
    this.ropeLength = clamp(next, CLAW.ropeMin, CLAW.ropeMax);
  }

  private driveFingers(dt: number): void {
    const before = this.fingerCommand;
    this.fingerCommand = approach(this.fingerCommand, this.fingerGoal, this.fingerRate * dt);
    if (before !== this.fingerCommand) {
      for (const f of this.fingers) f.joint.configureMotorPosition(this.fingerCommand, FINGER_STIFFNESS, FINGER_DAMPING);
    }
  }

  private applyRope(dt: number): void {
    const hub = this.hub;
    const t = hub.translation(this.phys.scratchV);
    const r = hub.rotation(this.phys.scratchQ);
    _q.set(r.x, r.y, r.z, r.w);
    // Attachment point on top of the hub, in world space.
    _v.set(0, CLAW.hubTop, 0).applyQuaternion(_q);
    const px = t.x + _v.x;
    const py = t.y + _v.y;
    const pz = t.z + _v.z;
    const dx = px - this.trolleyX;
    const dy = py - CLAW.anchorY;
    const dz = pz - this.trolleyZ;
    const dist = Math.hypot(dx, dy, dz);
    const stretch = dist - this.ropeLength;
    if (stretch <= 0 || dist < 1e-5) {
      this.tension = 0;
      this.slackTime += dt;
      return;
    }
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;
    const vel = hub.velocityAtPoint({ x: px, y: py, z: pz }, this.phys.scratchV);
    // Speed at which the two rope ends separate, minus the rate at which the winch pays out.
    const separating = (vel.x - this.trolleyVX) * nx + vel.y * ny + (vel.z - this.trolleyVZ) * nz - this.ropeSpeed;
    let force = -ROPE_STIFFNESS * stretch - ROPE_DAMPING * separating;
    if (force > 0) force = 0; // a rope cannot push
    const tension = -force;
    this.tension = tension;
    if (tension > 0.4) this.slackTime = 0;
    else this.slackTime += dt;
    const j = force * dt;
    hub.applyImpulseAtPoint({ x: nx * j, y: ny * j, z: nz * j }, { x: px, y: py, z: pz }, true);
  }

  /** Keeps the claw roughly level and facing forward, and damps the pendulum according to `ropeSwing`. */
  private applyStabilisers(dt: number): void {
    const hub = this.hub;
    const r = hub.rotation(this.phys.scratchQ);
    _q.set(r.x, r.y, r.z, r.w);
    // Upright torque: rotate the hub's up axis towards world up.
    _v.set(0, 1, 0).applyQuaternion(_q);
    _v2.crossVectors(_v, UP);
    const w = hub.angvel(this.phys.scratchV);
    const kUp = 0.9;
    const cUp = 0.035;
    // Yaw spring: keep the hub's local +X aligned with world +X.
    const fwd = new Vector3(1, 0, 0).applyQuaternion(_q);
    const yawErr = Math.atan2(-fwd.z, fwd.x);
    const kYaw = 0.5;
    hub.applyTorqueImpulse(
      {
        x: (kUp * _v2.x - cUp * w.x) * dt,
        y: (kUp * _v2.y - kYaw * yawErr - cUp * w.y) * dt,
        z: (kUp * _v2.z - cUp * w.z) * dt,
      },
      true,
    );
    // Swing damping relative to the trolley (stiffer cable = more damping).
    const swing = clamp(this.params.ropeSwing, 0, 1.5);
    const cLat = swing <= 1 ? 6.5 * (1 - swing) ** 2 + 0.28 : 0.28 / (1 + (swing - 1) * 3);
    const v = hub.linvel(this.phys.scratchV);
    hub.applyImpulse({ x: -cLat * (v.x - this.trolleyVX) * dt, y: 0, z: -cLat * (v.z - this.trolleyVZ) * dt }, true);
  }

  /** Call once per fixed step, after `PhysicsWorld.step()`. */
  postStep(dt: number = FIXED_DT): void {
    this.hubPose.capture(this.hub, this.phys.scratchV, this.phys.scratchQ);
    _q.set(this.hubPose.rot[0]!, this.hubPose.rot[1]!, this.hubPose.rot[2]!, this.hubPose.rot[3]!).invert();
    let still = true;
    for (const f of this.fingers) {
      f.pose.capture(f.body, this.phys.scratchV, this.phys.scratchQ);
      // Hinge angle from the relative rotation about the hinge axis.
      _q2.set(f.pose.rot[0]!, f.pose.rot[1]!, f.pose.rot[2]!, f.pose.rot[3]!).premultiply(_q);
      const along = _q2.x * f.axis.x + _q2.y * f.axis.y + _q2.z * f.axis.z;
      const angle = 2 * Math.atan2(along, _q2.w);
      const wrapped = angle > Math.PI ? angle - 2 * Math.PI : angle < -Math.PI ? angle + 2 * Math.PI : angle;
      f.angularSpeed = (wrapped - f.angle) / dt;
      f.angle = wrapped;
      if (Math.abs(f.angularSpeed) > 0.18) still = false;
    }
    this.fingerStillTime = still ? this.fingerStillTime + dt : 0;
  }

  /* --------------------------------------------------------------- queries */

  /** Distance from the palm to the nearest obstacle straight below, capped at `maxDistance`. */
  clearanceBelow(maxDistance: number): number {
    const t = this.hub.translation(this.phys.scratchV);
    const origin = { x: t.x, y: t.y - CLAW.hubHalfHeight - 0.04, z: t.z };
    const hit = this.phys.world.castShape(
      origin,
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: -1, z: 0 },
      this.castShape,
      0,
      maxDistance,
      true,
      undefined,
      groups(GROUP.CLAW, GROUP.STATIC | GROUP.TOY | GROUP.TOY_SOFT),
      undefined,
      this.hub,
    );
    return hit ? hit.time_of_impact : maxDistance;
  }

  /** World position of the centre of the grasp volume (below the palm). */
  gripCenter(out: Vector3): Vector3 {
    _q.set(this.hubPose.rot[0]!, this.hubPose.rot[1]!, this.hubPose.rot[2]!, this.hubPose.rot[3]!);
    return out
      .set(0, -CLAW.gripDrop, 0)
      .applyQuaternion(_q)
      .add(_v.set(this.hubPose.pos[0]!, this.hubPose.pos[1]!, this.hubPose.pos[2]!));
  }

  /** World position of a finger tip. */
  fingerTip(index: number, out: Vector3): Vector3 {
    const f = this.fingers[index]!;
    _q.set(f.pose.rot[0]!, f.pose.rot[1]!, f.pose.rot[2]!, f.pose.rot[3]!);
    return out
      .set(f.radial.x * CLAW.tip[0], -CLAW.tip[1], f.radial.z * CLAW.tip[0])
      .applyQuaternion(_q)
      .add(_v.set(f.pose.pos[0]!, f.pose.pos[1]!, f.pose.pos[2]!));
  }

  /** Horizontal speed of the hub relative to the trolley (how hard the claw is swinging). */
  swingSpeed(): number {
    const v = this.hub.linvel(this.phys.scratchV);
    return Math.hypot(v.x - this.trolleyVX, v.z - this.trolleyVZ);
  }

  /** Teleports the whole claw to rest under the trolley at (x, z) with the cable fully retracted. */
  reset(x: number, z: number): void {
    this.trolleyX = this.prevTrolleyX = clamp(x, CLAW.minX, CLAW.maxX);
    this.trolleyZ = this.prevTrolleyZ = clamp(z, CLAW.minZ, CLAW.maxZ);
    this.trolleyVX = this.trolleyVZ = this.trolleyAX = this.trolleyAZ = 0;
    this.mode = 'velocity';
    this.wantVX = this.wantVZ = 0;
    this.ropeLength = this.prevRopeLength = this.ropeTarget = CLAW.ropeMin;
    this.ropeSpeed = 0;
    this.ropeMaxSpeed = 0;
    this.tension = 0;
    this.slackTime = 0;
    this.fingerCommand = this.fingerGoal = CLAW.openAngle;
    this.fingerStillTime = 0;
    const y = CLAW.anchorY - CLAW.ropeMin - CLAW.hubTop;
    const zero = { x: 0, y: 0, z: 0 };
    const identity = { x: 0, y: 0, z: 0, w: 1 };
    this.hub.setTranslation({ x: this.trolleyX, y, z: this.trolleyZ }, true);
    this.hub.setRotation(identity, true);
    this.hub.setLinvel(zero, true);
    this.hub.setAngvel(zero, true);
    for (const f of this.fingers) {
      _q.setFromAxisAngle(f.axis, CLAW.openAngle);
      f.body.setTranslation(
        {
          x: this.trolleyX + f.radial.x * CLAW.knuckleRadius,
          y: y - CLAW.knuckleDrop,
          z: this.trolleyZ + f.radial.z * CLAW.knuckleRadius,
        },
        true,
      );
      f.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
      f.body.setLinvel(zero, true);
      f.body.setAngvel(zero, true);
      f.joint.configureMotorPosition(this.fingerCommand, FINGER_STIFFNESS, FINGER_DAMPING);
      f.angle = CLAW.openAngle;
      f.angularSpeed = 0;
    }
    this.hubPose.snap(this.hub, this.phys.scratchV, this.phys.scratchQ);
    for (const f of this.fingers) f.pose.snap(f.body, this.phys.scratchV, this.phys.scratchQ);
  }

  dispose(): void {
    for (const f of this.fingers) {
      for (const c of f.colliders) this.phys.clawColliders.delete(c.handle);
      this.phys.world.removeRigidBody(f.body);
    }
    this.phys.clawColliders.delete(this.hubCollider.handle);
    this.phys.world.removeRigidBody(this.hub);
  }
}
