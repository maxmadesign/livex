import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  Quaternion,
  ShapeUtils,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ClawRig, FittedScoop } from '../physics/ClawRig';
import { CLAW, FIELD } from '../physics/fieldSpec';
import type { BodyPose } from '../physics/PhysicsWorld';
import { axisUV, boxUV, TESSELLATION } from './decor';
import { UV_DENSITY, type CabinetMaterials, type DetailLevel } from './materials';

const UP = new Vector3(0, 1, 0);
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();

/** Length of cable covered by one repeat of the braid normal map (m). */
const BRAID_PITCH = 0.007;

function applyPose(target: Group | Mesh, pose: BodyPose, alpha: number): void {
  const p = pose.prevPos, c = pose.pos;
  target.position.set(p[0]! + (c[0]! - p[0]!) * alpha, p[1]! + (c[1]! - p[1]!) * alpha, p[2]! + (c[2]! - p[2]!) * alpha);
  _q.set(pose.prevRot[0]!, pose.prevRot[1]!, pose.prevRot[2]!, pose.prevRot[3]!);
  _q2.set(pose.rot[0]!, pose.rot[1]!, pose.rot[2]!, pose.rot[3]!);
  target.quaternion.copy(_q).slerp(_q2, alpha);
}

/**
 * One petal of the scoop (ClawRig.fitScoop) in the hub frame of the closed cup: a thin shell
 * revolved about the claw's axis over the petal's arc, a shallow cone of floor rising to a round
 * wall with a rolled rim, and closed at both ends. Matches the physical plates (floor strips, wall
 * plates) within a millimetre or two.
 */
function scoopPetalGeometry(scoop: FittedScoop, azimuth: number, arcSegments: number): BufferGeometry {
  const s = scoop.spec;
  const R = scoop.radius;
  const t = 2 * s.thickness;
  const slope = Math.tan(s.floorTilt);
  const y0 = scoop.floorY;
  const wallBase = y0 + (R - s.floorInner) * slope;
  const top = wallBase + s.wallHeight;
  // Closed profile (radius, height): floor underside out to the wall, up the outside, over the
  // rolled rim, down the inside and back along the floor's top.
  const profile: Vector2[] = [new Vector2(s.floorInner, y0), new Vector2(R + t, y0 + (R + t - s.floorInner) * slope), new Vector2(R + t, top)];
  for (let i = 1; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    profile.push(new Vector2(R + t / 2 + (Math.cos(a) * t) / 2, top + (Math.sin(a) * t) / 2));
  }
  profile.push(new Vector2(R, top), new Vector2(R, wallBase + t), new Vector2(s.floorInner, y0 + t));
  // LatheGeometry measures its angle from +Z towards +X; the claw's azimuth from +X towards +Z.
  const phiStart = Math.PI / 2 - azimuth - s.halfAngle;
  const shell = new LatheGeometry([...profile, profile[0]!.clone()], arcSegments, phiStart, 2 * s.halfAngle);
  const parts: BufferGeometry[] = [shell.toNonIndexed()];
  shell.dispose();
  // End caps: the profile, flat, at both ends of the arc, facing away from the petal.
  const tris = ShapeUtils.triangulateShape(profile, []);
  for (const [end, sign] of [[azimuth - s.halfAngle, -1], [azimuth + s.halfAngle, 1]] as const) {
    const radial = new Vector3(Math.cos(end), 0, Math.sin(end));
    const out = new Vector3(-Math.sin(end), 0, Math.cos(end)).multiplyScalar(sign);
    const pos: number[] = [];
    const nrm: number[] = [];
    const uvs: number[] = [];
    const at = (p: Vector2) => [radial.x * p.x, p.y, radial.z * p.x] as const;
    for (const [a, b, c] of tris) {
      let pa = at(profile[a]!);
      let pb = at(profile[b]!);
      const pc = at(profile[c]!);
      // Wind each triangle so that its front faces `out`.
      _a.set(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      _b.set(pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]);
      if (_c.crossVectors(_a, _b).dot(out) < 0) [pa, pb] = [pb, pa];
      for (const p of [pa, pb, pc]) {
        pos.push(p[0], p[1], p[2]);
        nrm.push(out.x, out.y, out.z);
        uvs.push(p[0] + p[2], p[1]);
      }
    }
    const cap = new BufferGeometry();
    cap.setAttribute('position', new Float32BufferAttribute(pos, 3));
    cap.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    cap.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    parts.push(cap);
  }
  const merged = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  return merged;
}

/** Helix of `turns` turns (radius r, height h) along +y, as a curve for a tube. */
class Helix extends CatmullRomCurve3 {
  constructor(r: number, h: number, turns: number) {
    const pts: Vector3[] = [];
    const n = Math.round(turns * 16);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = t * turns * Math.PI * 2;
      pts.push(new Vector3(Math.cos(a) * r, t * h, Math.sin(a) * r));
    }
    super(pts);
  }
}

/**
 * Everything that moves on the gantry: bridge beam, trolley with its winch,
 * the steel cable and the three-finger claw. Purely visual — it follows the
 * interpolated state of the physical ClawRig. Tessellation and small details
 * (bolts, hinge pins, strain-relief spring, braided cable) follow the detail level.
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
  private readonly braid: Texture | null;

  constructor(
    private readonly rig: ClawRig,
    mats: CabinetMaterials,
  ) {
    this.group.name = 'claw';
    const d: DetailLevel = mats.detail ?? 1;
    const fine = d >= 2;
    const radial = TESSELLATION.radial[d];
    const bevel = TESSELLATION.bevel[d];
    this.braid = mats.cableNormal;
    const own = <T extends BufferGeometry>(g: T): T => {
      this.geometries.push(g);
      return g;
    };
    /** Material-aware UV projection in the part's local frame (brushed grooves along `along`). */
    const uv = (g: BufferGeometry, m: Material, along: 'x' | 'y' | 'z' = 'y'): BufferGeometry => {
      if (m !== mats.brushed && m !== mats.anodised && m !== mats.chrome && m !== mats.clawCap && m !== mats.plastic) return g;
      const flat = g.index ? g.toNonIndexed() : g;
      if (flat !== g) g.dispose();
      if (m === mats.brushed || m === mats.anodised) axisUV(flat, along, UV_DENSITY.metal * 4);
      else boxUV(flat, m === mats.chrome ? UV_DENSITY.scratch * 4 : UV_DENSITY.lacquer * 2);
      return flat;
    };
    const mesh = (g: BufferGeometry, m: Material, cast = true, along: 'x' | 'y' | 'z' = 'y'): Mesh => {
      const out = new Mesh(own(uv(g, m, along)), m);
      out.castShadow = cast;
      out.receiveShadow = true;
      return out;
    };
    const railY = FIELD.gantryY;

    /* Bridge beam across the two rails. */
    const beam = mesh(new RoundedBoxGeometry(0.94, 0.03, 0.044, bevel, 0.005), mats.brushed, false, 'x');
    beam.position.set(0, railY + 0.034, 0);
    const slot = mesh(new BoxGeometry(0.9, 0.004, 0.014), mats.dark, false);
    slot.position.set(0, railY + 0.017, 0);
    this.bridge.add(beam, slot);
    for (const sx of [-1, 1]) {
      const carriage = mesh(new RoundedBoxGeometry(0.06, 0.05, 0.085, bevel, 0.008), mats.anodised, false, 'z');
      carriage.position.set(sx * 0.455, railY + 0.03, 0);
      const wheel = mesh(new CylinderGeometry(0.012, 0.012, 0.012, radial), mats.rubber, false);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * 0.455, railY + 0.02, 0.028);
      const wheel2 = wheel.clone();
      wheel2.position.z = -0.028;
      this.bridge.add(carriage, wheel, wheel2);
      if (fine) {
        // Axle caps and the cap screws holding the carriage to the beam.
        for (const z of [0.028, -0.028]) {
          const cap = mesh(new CylinderGeometry(0.005, 0.005, 0.014, 16), mats.chrome, false);
          cap.rotation.z = Math.PI / 2;
          cap.position.set(sx * 0.455, railY + 0.02, z);
          this.bridge.add(cap);
        }
        for (const z of [0.025, -0.025]) {
          const screw = mesh(new CylinderGeometry(0.0042, 0.0042, 0.003, 16), mats.chrome, false);
          screw.position.set(sx * 0.455 - sx * 0.012, railY + 0.056, z);
          this.bridge.add(screw);
        }
      }
    }
    this.group.add(this.bridge);

    /* Trolley with winch drum. */
    const housing = mesh(new RoundedBoxGeometry(0.11, 0.058, 0.09, bevel + 1, 0.012), mats.plastic, false);
    housing.position.y = 0.012;
    const lid = mesh(new RoundedBoxGeometry(0.09, 0.014, 0.07, bevel, 0.006), mats.clawCap, false);
    lid.position.y = 0.046;
    this.drum = mesh(new CylinderGeometry(0.022, 0.022, 0.05, radial), mats.brushed, false, 'y');
    this.drum.rotation.z = Math.PI / 2;
    this.drum.position.set(0, -0.028, 0);
    const flangeL = mesh(new CylinderGeometry(0.029, 0.029, 0.004, radial), mats.anodised, false);
    flangeL.rotation.z = Math.PI / 2;
    flangeL.position.set(-0.027, -0.028, 0);
    const flangeR = flangeL.clone();
    flangeR.position.x = 0.027;
    const lamp = mesh(new SphereGeometry(0.007, 16, 12), mats.leds[0]!, false);
    lamp.position.set(0.035, 0.022, 0.046);
    this.trolley.add(housing, lid, this.drum, flangeL, flangeR, lamp);
    if (fine) {
      // Wound cable on the drum: a few turns of a thin torus.
      for (let i = 0; i < 6; i++) {
        const turn = mesh(new TorusGeometry(0.0232, 0.0016, 8, radial), mats.chrome, false);
        turn.rotation.y = Math.PI / 2;
        turn.position.set(-0.018 + i * 0.0072, -0.028, 0);
        this.trolley.add(turn);
      }
      for (const [x, z] of [
        [-0.04, 0.03],
        [0.04, 0.03],
        [-0.04, -0.03],
        [0.04, -0.03],
      ] as const) {
        const screw = mesh(new CylinderGeometry(0.0035, 0.0035, 0.003, 16), mats.chrome, false);
        screw.position.set(x, 0.0415, z);
        this.trolley.add(screw);
      }
    }
    this.trolley.position.y = railY - 0.012;
    this.group.add(this.trolley);

    /* Cable: unit cylinder scaled to the current length (braided normal map on High and Ultra). */
    this.cable = mesh(new CylinderGeometry(0.0022, 0.0022, 1, d >= 2 ? 16 : d === 1 ? 12 : 8, 1, true), mats.cable, false);
    this.group.add(this.cable);

    /* Hub: lathe-turned housing with chamfered edges, a lacquered cap and a rubber palm. */
    const profile = [
      [0.0, 0.052],
      [0.011, 0.052],
      [0.0125, 0.0512],
      [0.016, 0.045],
      [0.028, 0.0405],
      [0.038, 0.034],
      [0.0425, 0.026],
      [0.044, 0.014],
      [0.044, -0.011],
      [0.0452, -0.0128],
      [0.0492, -0.0152],
      [0.05, -0.017],
      [0.05, -0.023],
      [0.0488, -0.0248],
      [0.04, -0.03],
      [0.0, -0.03],
    ].map(([x, y]) => new Vector2(x, y));
    const body = mesh(new LatheGeometry(profile, radial + 8), mats.chrome);
    const cap = mesh(
      new LatheGeometry(
        [new Vector2(0.0, 0.0465), new Vector2(0.018, 0.0448), new Vector2(0.029, 0.0415), new Vector2(0.037, 0.0365), new Vector2(0.0415, 0.031), new Vector2(0.0445, 0.014), new Vector2(0.0448, 0.004), new Vector2(0.0, 0.004)],
        radial + 8,
      ),
      mats.clawCap,
    );
    const eyelet = mesh(new TorusGeometry(0.008, 0.0028, 12, radial), mats.chrome, false);
    eyelet.position.y = CLAW.hubTop + 0.012;
    const palm = mesh(new CylinderGeometry(0.038, 0.034, 0.008, radial), mats.rubber);
    palm.position.y = -0.033;
    const band = mesh(new TorusGeometry(0.0455, 0.0025, 8, radial + 8), mats.leds[1 % mats.leds.length]!, false);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.002;
    this.hub.add(body, cap, eyelet, palm, band);
    if (fine) {
      // Strain-relief spring where the cable enters the hub, and a ring of cap screws.
      const spring = mesh(new TubeGeometry(new Helix(0.0042, 0.016, 5), 80, 0.0007, 6, false), mats.chrome, false);
      spring.position.y = CLAW.hubTop + 0.016;
      this.hub.add(spring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const screw = mesh(new CylinderGeometry(0.0026, 0.0026, 0.003, 12), mats.chrome, false);
        screw.position.set(Math.cos(a) * 0.0465, -0.0195, Math.sin(a) * 0.0465);
        screw.quaternion.setFromUnitVectors(UP, _a.set(Math.cos(a), 0, Math.sin(a)));
        this.hub.add(screw);
      }
    }
    this.group.add(this.hub);

    /* Fingers: bent steel rod with an anodised knuckle, a hinge pin and a soft rubber tip. */
    const tubular = [16, 28, 40, 56][d]!;
    const tubeRadial = [8, 10, 14, 18][d]!;
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
      const rod = mesh(new TubeGeometry(curve, tubular, CLAW.fingerRadius * 0.82, tubeRadial, false), mats.chrome);
      const knuckle = mesh(new CapsuleGeometry(0.0098, 0.008, d >= 2 ? 6 : 4, radial), mats.anodised);
      knuckle.quaternion.setFromUnitVectors(UP, finger.axis);
      const pad = mesh(new SphereGeometry(CLAW.tipRadius * 1.05, [12, 16, 28, 36][d]!, [8, 12, 20, 26][d]!), mats.clawTip);
      pad.position.copy(tip);
      pad.scale.set(1, 1.25, 1);
      g.add(rod, knuckle, pad);
      if (fine) {
        // Hinge pin through the knuckle and a ferrule where the rubber tip meets the rod.
        const pin = mesh(new CylinderGeometry(0.0032, 0.0032, 0.03, 16), mats.chrome, false);
        pin.quaternion.setFromUnitVectors(UP, finger.axis);
        const ferrule = mesh(new CylinderGeometry(CLAW.fingerRadius * 1.05, CLAW.fingerRadius * 0.95, 0.008, 20), mats.chrome, false);
        const along = curve.getTangent(0.94);
        ferrule.quaternion.setFromUnitVectors(UP, along);
        ferrule.position.copy(curve.getPoint(0.9));
        g.add(pin, ferrule);
      }
      const petal = rig.scoop?.petals.find((p) => p.finger === finger.index);
      if (rig.scoop && petal) {
        // The scoop's petal rides on this finger: built in the closed cup's frame, moved into the
        // finger's own frame (origin at the knuckle) exactly as the physics plates are.
        const shell = scoopPetalGeometry(rig.scoop, finger.azimuth, [8, 12, 18, 24][d]!);
        shell.translate(-petal.knuckle.x, -petal.knuckle.y, -petal.knuckle.z).applyQuaternion(petal.toFinger);
        g.add(mesh(shell, mats.clawCap));
        if (fine) {
          // A polished bead along the rim.
          const sp = rig.scoop.spec;
          const rimY = rig.scoop.floorY + (rig.scoop.radius - sp.floorInner) * Math.tan(sp.floorTilt) + sp.wallHeight + sp.thickness * 2;
          const rim = new TorusGeometry(rig.scoop.radius + sp.thickness, sp.thickness * 0.9, 6, 24, 2 * sp.halfAngle);
          rim.rotateX(Math.PI / 2).rotateY(-(finger.azimuth - sp.halfAngle)).translate(0, rimY, 0);
          rim.translate(-petal.knuckle.x, -petal.knuckle.y, -petal.knuckle.z).applyQuaternion(petal.toFinger);
          g.add(mesh(rim, mats.chrome, false));
        }
      }
      this.fingers.push(g);
      this.group.add(g);
      // Linkage from the central plunger to the finger (purely cosmetic).
      const link = mesh(new CylinderGeometry(0.0028, 0.0028, 1, d >= 2 ? 12 : 6), mats.brushed, false);
      this.links.push(link);
      this.group.add(link);
    }

    // Static parts of each moving group become one mesh per material (bolts, caps and pins cost
    // no extra draw calls); only the turning drum stays separate.
    const keep = new Set<Mesh>([this.drum]);
    for (const part of [this.bridge, this.trolley, this.hub, ...this.fingers]) this.mergeStatic(part, keep);
  }

  /** Merges the direct mesh children of `parent` by material, baking their local transforms. */
  private mergeStatic(parent: Group, keep: Set<Mesh>): void {
    const buckets = new Map<Material, { geometries: BufferGeometry[]; cast: boolean }>();
    const sources = new Set<BufferGeometry>();
    for (const child of [...parent.children]) {
      const mesh = child as Mesh;
      if (!mesh.isMesh || keep.has(mesh) || Array.isArray(mesh.material)) continue;
      mesh.updateMatrix();
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      g.applyMatrix4(mesh.matrix);
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      const material = mesh.material as Material;
      let bucket = buckets.get(material);
      if (!bucket) buckets.set(material, (bucket = { geometries: [], cast: false }));
      bucket.geometries.push(g);
      bucket.cast ||= mesh.castShadow;
      sources.add(mesh.geometry);
      parent.remove(mesh);
    }
    for (const [material, bucket] of buckets) {
      const merged = mergeGeometries(bucket.geometries, false);
      for (const g of bucket.geometries) g.dispose();
      if (!merged) continue;
      this.geometries.push(merged);
      const out = new Mesh(merged, material);
      out.castShadow = bucket.cast;
      out.receiveShadow = true;
      parent.add(out);
    }
    for (const g of sources) {
      g.dispose();
      const i = this.geometries.indexOf(g);
      if (i >= 0) this.geometries.splice(i, 1);
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
    const length = this.stretch(this.cable, _a, _b);
    // Keep the braid at a constant physical pitch however long the cable is.
    if (this.braid) this.braid.repeat.set(2, Math.max(1, length / BRAID_PITCH));

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

  private stretch(mesh: Mesh, from: Vector3, to: Vector3): number {
    const length = from.distanceTo(to);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.scale.set(1, Math.max(length, 1e-4), 1);
    _c.copy(to).sub(from).normalize();
    mesh.quaternion.setFromUnitVectors(UP, _c);
    return length;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.group.removeFromParent();
  }
}
