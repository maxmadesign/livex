import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ClawRig } from '../physics/ClawRig';
import { CLAW, FIELD } from '../physics/fieldSpec';
import type { BodyPose } from '../physics/PhysicsWorld';
import type { CabinetMaterials } from './materials';

const UP = new Vector3(0, 1, 0);
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();

function applyPose(target: Group | Mesh, pose: BodyPose, alpha: number): void {
  const p = pose.prevPos, c = pose.pos;
  target.position.set(p[0]! + (c[0]! - p[0]!) * alpha, p[1]! + (c[1]! - p[1]!) * alpha, p[2]! + (c[2]! - p[2]!) * alpha);
  _q.set(pose.prevRot[0]!, pose.prevRot[1]!, pose.prevRot[2]!, pose.prevRot[3]!);
  _q2.set(pose.rot[0]!, pose.rot[1]!, pose.rot[2]!, pose.rot[3]!);
  target.quaternion.copy(_q).slerp(_q2, alpha);
}

/**
 * Everything that moves on the gantry: bridge beam, trolley with its winch,
 * the steel cable and the three-finger claw. Purely visual — it follows the
 * interpolated state of the physical ClawRig.
 */
export class ClawVisual {
  readonly group = new Group();
  private readonly bridge = new Group();
  private readonly trolley = new Group();
  private readonly drum: Mesh;
  private readonly cable: Mesh;
  private readonly hub = new Group();
  private readonly fingers: Group[] = [];
  private readonly links: Mesh[] = [];
  private readonly geometries: BufferGeometry[] = [];

  constructor(
    private readonly rig: ClawRig,
    mats: CabinetMaterials,
  ) {
    this.group.name = 'claw';
    const own = <T extends BufferGeometry>(g: T): T => {
      this.geometries.push(g);
      return g;
    };
    const mesh = (g: BufferGeometry, m: Material, cast = true): Mesh => {
      const out = new Mesh(own(g), m);
      out.castShadow = cast;
      out.receiveShadow = true;
      return out;
    };
    const railY = FIELD.gantryY;

    /* Bridge beam across the two rails. */
    const beam = mesh(new RoundedBoxGeometry(0.94, 0.03, 0.044, 2, 0.005), mats.brushed, false);
    beam.position.set(0, railY + 0.034, 0);
    const slot = mesh(new BoxGeometry(0.9, 0.004, 0.014), mats.dark, false);
    slot.position.set(0, railY + 0.017, 0);
    this.bridge.add(beam, slot);
    for (const sx of [-1, 1]) {
      const carriage = mesh(new RoundedBoxGeometry(0.06, 0.05, 0.085, 2, 0.008), mats.plastic, false);
      carriage.position.set(sx * 0.455, railY + 0.03, 0);
      const wheel = mesh(new CylinderGeometry(0.012, 0.012, 0.012, 16), mats.rubber, false);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * 0.455, railY + 0.02, 0.028);
      const wheel2 = wheel.clone();
      wheel2.position.z = -0.028;
      this.bridge.add(carriage, wheel, wheel2);
    }
    this.group.add(this.bridge);

    /* Trolley with winch drum. */
    const housing = mesh(new RoundedBoxGeometry(0.11, 0.058, 0.09, 3, 0.012), mats.plastic, false);
    housing.position.y = 0.012;
    const lid = mesh(new RoundedBoxGeometry(0.09, 0.014, 0.07, 2, 0.006), mats.clawCap, false);
    lid.position.y = 0.046;
    this.drum = mesh(new CylinderGeometry(0.022, 0.022, 0.05, 20), mats.chrome, false);
    this.drum.rotation.z = Math.PI / 2;
    this.drum.position.set(0, -0.028, 0);
    const flangeL = mesh(new CylinderGeometry(0.029, 0.029, 0.004, 20), mats.brushed, false);
    flangeL.rotation.z = Math.PI / 2;
    flangeL.position.set(-0.027, -0.028, 0);
    const flangeR = flangeL.clone();
    flangeR.position.x = 0.027;
    const lamp = mesh(new SphereGeometry(0.007, 12, 8), mats.leds[0]!, false);
    lamp.position.set(0.035, 0.022, 0.046);
    this.trolley.add(housing, lid, this.drum, flangeL, flangeR, lamp);
    this.trolley.position.y = railY - 0.012;
    this.group.add(this.trolley);

    /* Cable: unit cylinder scaled to the current length. */
    this.cable = mesh(new CylinderGeometry(0.0022, 0.0022, 1, 8), mats.brushed, false);
    this.group.add(this.cable);

    /* Hub: lathe-turned housing with an enamel cap and a rubber palm. */
    const profile = [
      [0.0, 0.052],
      [0.012, 0.052],
      [0.016, 0.044],
      [0.03, 0.04],
      [0.041, 0.03],
      [0.044, 0.012],
      [0.044, -0.012],
      [0.05, -0.016],
      [0.05, -0.024],
      [0.04, -0.03],
      [0.0, -0.03],
    ].map(([x, y]) => new Vector2(x, y));
    const body = mesh(new LatheGeometry(profile, 40), mats.chrome);
    const cap = mesh(new LatheGeometry([new Vector2(0.0, 0.0465), new Vector2(0.029, 0.0415), new Vector2(0.0415, 0.031), new Vector2(0.0445, 0.014), new Vector2(0.0448, 0.004), new Vector2(0.0, 0.004)], 40), mats.clawCap);
    const eyelet = mesh(new TorusGeometry(0.008, 0.0028, 8, 20), mats.chrome, false);
    eyelet.position.y = CLAW.hubTop + 0.012;
    const palm = mesh(new CylinderGeometry(0.038, 0.034, 0.008, 28), mats.rubber);
    palm.position.y = -0.033;
    const band = mesh(new TorusGeometry(0.0455, 0.0025, 8, 40), mats.leds[1 % mats.leds.length]!, false);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.002;
    this.hub.add(body, cap, eyelet, palm, band);
    this.group.add(this.hub);

    /* Fingers: bent steel rod with a knuckle and a soft pad. */
    for (const finger of rig.fingers) {
      const g = new Group();
      const r = finger.radial;
      const elbow = new Vector3(r.x * CLAW.elbow[0], -CLAW.elbow[1], r.z * CLAW.elbow[0]);
      const tip = new Vector3(r.x * CLAW.tip[0], -CLAW.tip[1], r.z * CLAW.tip[0]);
      const curve = new CatmullRomCurve3(
        [new Vector3(0, 0, 0), elbow.clone().multiplyScalar(0.55).add(new Vector3(0, 0.004, 0)), elbow, elbow.clone().lerp(tip, 0.5).addScaledVector(r, 0.004), tip],
        false,
        'catmullrom',
        0.35,
      );
      const rod = mesh(new TubeGeometry(curve, 28, CLAW.fingerRadius * 0.82, 10, false), mats.chrome);
      const knuckle = mesh(new CylinderGeometry(0.0105, 0.0105, 0.026, 14), mats.brushed);
      knuckle.quaternion.setFromUnitVectors(UP, finger.axis);
      const pad = mesh(new SphereGeometry(CLAW.tipRadius * 1.05, 16, 12), mats.clawCap);
      pad.position.copy(tip);
      pad.scale.set(1, 1.25, 1);
      g.add(rod, knuckle, pad);
      this.fingers.push(g);
      this.group.add(g);
      // Linkage from the central plunger to the finger (purely cosmetic).
      const link = mesh(new CylinderGeometry(0.0028, 0.0028, 1, 6), mats.brushed, false);
      this.links.push(link);
      this.group.add(link);
    }
  }

  /** Call every rendered frame with the physics interpolation factor. */
  update(alpha: number): void {
    const rig = this.rig;
    const tx = rig.prevTrolleyX + (rig.trolleyX - rig.prevTrolleyX) * alpha;
    const tz = rig.prevTrolleyZ + (rig.trolleyZ - rig.prevTrolleyZ) * alpha;
    const rope = rig.prevRopeLength + (rig.ropeLength - rig.prevRopeLength) * alpha;
    this.bridge.position.z = tz;
    this.trolley.position.x = tx;
    this.trolley.position.z = tz;
    this.drum.rotation.x = rope / 0.022;

    applyPose(this.hub, rig.hubPose, alpha);
    // Cable from the winch to the eyelet on the hub (straight: slack is taken up by the drum).
    _a.set(tx, CLAW.anchorY - 0.01, tz);
    _b.set(0, CLAW.hubTop + 0.01, 0).applyQuaternion(this.hub.quaternion).add(this.hub.position);
    this.stretch(this.cable, _a, _b);

    for (let i = 0; i < this.fingers.length; i++) {
      const finger = rig.fingers[i]!;
      const g = this.fingers[i]!;
      applyPose(g, finger.pose, alpha);
      // Link: from the plunger under the hub to a point one third down the finger.
      _a.set(0, -0.036, 0).applyQuaternion(this.hub.quaternion).add(this.hub.position);
      _b.set(finger.radial.x * CLAW.elbow[0] * 0.62, -CLAW.elbow[1] * 0.62, finger.radial.z * CLAW.elbow[0] * 0.62).applyQuaternion(g.quaternion).add(g.position);
      this.stretch(this.links[i]!, _a, _b);
    }
  }

  private stretch(mesh: Mesh, from: Vector3, to: Vector3): void {
    const length = from.distanceTo(to);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.scale.set(1, Math.max(length, 1e-4), 1);
    _c.copy(to).sub(from).normalize();
    mesh.quaternion.setFromUnitVectors(UP, _c);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.group.removeFromParent();
  }
}
