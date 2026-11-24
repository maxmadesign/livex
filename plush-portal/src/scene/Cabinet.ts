import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  Euler,
  Quaternion,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../core/math';
import type { WindowLayout } from '../perspective/windowGeometry';
import { BIN, CHUTE, FIELD } from '../physics/fieldSpec';
import type { ThemeDef } from '../themes/themes';
import { axisUV, boltShape, boxUV, fanBladeShape, fanFrameShape, letterShape, TESSELLATION } from './decor';
import { UV_DENSITY, type CabinetMaterials, type DetailLevel } from './materials';
import { decalUv, makeBackdropTexture, type DecalId } from './textures';

/** Where a decorative (non-interactive) display toy sits in a side bay. */
export interface DisplaySlot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3(1, 1, 1);
const _v = new Vector3();

type UvRule = { mode: 'box' | 'axis'; density: number };
interface AddOptions {
  receive?: boolean;
  cast?: boolean;
  /** Keep the geometry's own UVs even if the material has a projection rule. */
  keepUv?: boolean;
}

/**
 * Collects geometry per material and merges it, so the whole cabinet is a handful of draw calls.
 * Parts are bucketed by material *and* shadow flags: under variance shadow maps (High / Ultra)
 * three.js draws every shadow *receiver* into the shadow map, so a receiving riser must not turn
 * the ceiling and the frame (same lacquer) into receivers that shade the whole play field.
 */
class Builder {
  private readonly buckets = new Map<string, { material: Material; geometries: BufferGeometry[]; receive: boolean; cast: boolean }>();

  constructor(private readonly uvRules: Map<Material, UvRule>) {}

  /** Places a geometry in world space and applies the material's UV projection. */
  prepare(material: Material, geometry: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, keepUv = false): BufferGeometry {
    _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s);
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(_m);
    // Merging needs identical attribute sets.
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    const rule = keepUv ? undefined : this.uvRules.get(material);
    if (rule?.mode === 'box') boxUV(g, rule.density);
    else if (rule?.mode === 'axis') {
      // Brush along the part's longest extent.
      g.computeBoundingBox();
      const size = g.boundingBox!.getSize(_v);
      axisUV(g, size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z', rule.density);
    }
    if (g !== geometry) geometry.dispose();
    return g;
  }

  add(material: Material, geometry: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, opts: AddOptions = {}): void {
    const g = this.prepare(material, geometry, x, y, z, rx, ry, rz, opts.keepUv);
    const receive = !!opts.receive, cast = !!opts.cast;
    const key = `${material.uuid}|${receive ? 'r' : ''}${cast ? 'c' : ''}`;
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = { material, geometries: [], receive, cast }));
    bucket.geometries.push(g);
  }

  build(group: Group, renderOrder: Map<Material, number>): void {
    for (const { material, ...bucket } of this.buckets.values()) {
      const merged = mergeGeometries(bucket.geometries, false);
      for (const g of bucket.geometries) g.dispose();
      if (!merged) continue;
      const mesh = new Mesh(merged, material);
      mesh.receiveShadow = bucket.receive;
      mesh.castShadow = bucket.cast;
      mesh.renderOrder = renderOrder.get(material) ?? 0;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
}

/** Planar UVs from world-space positions so patterns keep a constant physical size. */
function worldUV(g: BufferGeometry, plane: 'xy' | 'xz' | 'zy', tilesPerMetre: number): BufferGeometry {
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (plane === 'xy') uv.setXY(i, x * tilesPerMetre, y * tilesPerMetre);
    else if (plane === 'xz') uv.setXY(i, x * tilesPerMetre, -z * tilesPerMetre);
    else uv.setXY(i, -z * tilesPerMetre, y * tilesPerMetre);
  }
  return g;
}

function flowerShape(r: number, petals = 5): Shape {
  const s = new Shape();
  const steps = petals * 10;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const lobe = Math.abs(Math.cos((a * petals) / 2));
    const rr = r * (0.42 + 0.58 * Math.pow(1 - lobe, 0.5));
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return s;
}

function starShape(r: number, points = 5, inner = 0.5): Shape {
  const s = new Shape();
  for (let i = 0; i <= points * 2; i++) {
    const rr = i % 2 === 0 ? r : r * inner;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return s;
}

function cloudShape(r: number): Shape {
  const s = new Shape();
  s.moveTo(-r, -r * 0.3);
  s.absarc(-r * 0.55, 0, r * 0.42, Math.PI, Math.PI * 0.5, true);
  s.absarc(-r * 0.05, r * 0.25, r * 0.5, Math.PI, 0, true);
  s.absarc(r * 0.55, 0, r * 0.42, Math.PI * 0.5, 0, true);
  s.lineTo(r * 0.97, -r * 0.3);
  s.lineTo(-r, -r * 0.3);
  return s;
}

function shellShape(r: number): Shape {
  const s = new Shape();
  s.moveTo(0, -r * 0.75);
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI * 1.12 - (i / 24) * Math.PI * 1.24;
    const rr = r * (0.92 + 0.08 * Math.cos(i * Math.PI));
    s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.92 + r * 0.05);
  }
  s.lineTo(0, -r * 0.75);
  return s;
}

function moonShape(r: number): Shape {
  const s = new Shape();
  s.absarc(0, 0, r, Math.PI * 0.35, Math.PI * 1.65, false);
  s.absarc(r * 0.42, 0, r * 0.82, Math.PI * 1.52, Math.PI * 0.48, true);
  return s;
}

/**
 * The whole static cabinet for one window layout and theme: front frame, glass
 * box, back board, ceiling light, gantry rails, chute, lower cabinet with the
 * prize shaft and (in landscape) the display bays left and right. Tessellation and
 * the amount of small detail follow the materials' detail level (texture tier).
 */
export class Cabinet {
  readonly group = new Group();
  readonly displaySlots: DisplaySlot[] = [];
  private backdrop: Mesh | null = null;
  private readonly detail: DetailLevel;
  private readonly removeAnimators: (() => void)[] = [];

  constructor(
    readonly layout: WindowLayout,
    readonly theme: ThemeDef,
    private readonly mats: CabinetMaterials,
  ) {
    this.group.name = 'cabinet';
    this.detail = mats.detail ?? 1;
    this.build();
  }

  /** Rounded box with the tier's bevel tessellation. */
  private box(w: number, h: number, d: number, r = 0): BufferGeometry {
    if (r <= 0) return new BoxGeometry(w, h, d);
    const radius = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    return radius > 1e-4 ? new RoundedBoxGeometry(w, h, d, TESSELLATION.bevel[this.detail], radius) : new BoxGeometry(w, h, d);
  }

  private get radial(): number {
    return TESSELLATION.radial[this.detail];
  }

  private plaque(shape: Shape, depth = 0.014): BufferGeometry {
    const d = this.detail;
    return new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: TESSELLATION.bevelSegments[d], curveSegments: TESSELLATION.curve[d] });
  }

  private build(): void {
    const { layout: L, mats: M } = this;
    const uvRules = new Map<Material, UvRule>([
      [M.enamel, { mode: 'box', density: UV_DENSITY.lacquer }],
      [M.accent, { mode: 'box', density: UV_DENSITY.lacquer }],
      [M.plastic, { mode: 'box', density: UV_DENSITY.lacquer }],
      [M.chrome, { mode: 'box', density: UV_DENSITY.scratch }],
      [M.glass, { mode: 'box', density: UV_DENSITY.scratch }],
      [M.acrylic, { mode: 'box', density: UV_DENSITY.scratch }],
      [M.brushed, { mode: 'axis', density: UV_DENSITY.metal }],
      [M.anodised, { mode: 'axis', density: UV_DENSITY.metal }],
      [M.chip, { mode: 'box', density: UV_DENSITY.lacquer }],
      [M.rubber, { mode: 'box', density: UV_DENSITY.lacquer }],
    ]);
    const b = new Builder(uvRules);
    const W = L.width, T = L.top, B = L.bottom, F = L.frame;
    const HW = FIELD.halfWidth, D = FIELD.depth, CEIL = FIELD.ceilingY, FT = FIELD.floorThickness;
    const half = W / 2;
    const landscape = L.sideBay > 0.08;
    const rng = makeRng(17 + this.theme.id.length * 31);
    const fine = this.detail >= 2;

    /* ---------------------------------------------------------- front frame */
    const fd = 0.045; // depth of the frame behind the glass plane
    const over = 0.08; // how far the bars continue beyond the visible window
    b.add(M.enamel, this.box(F + over, T - B + 2 * over, fd, 0.012), -half + (F - over) / 2, (T + B) / 2, -fd / 2);
    b.add(M.enamel, this.box(F + over, T - B + 2 * over, fd, 0.012), half - (F - over) / 2, (T + B) / 2, -fd / 2);
    b.add(M.enamel, this.box(W, F + over, fd, 0.012), 0, T - (F - over) / 2, -fd / 2);
    b.add(M.enamel, this.box(W, F + over, fd, 0.012), 0, B + (F - over) / 2, -fd / 2);
    // Chrome bead and coloured pin-stripe along the inner edge.
    const iw = W - 2 * F, ih = T - B - 2 * F;
    for (const sx of [-1, 1]) {
      b.add(M.chrome, this.box(0.006, ih, 0.012, 0.0029), sx * (half - F - 0.003), (T + B) / 2, -fd + 0.004);
      b.add(M.accent, this.box(F * 0.22, ih + F * 0.6, 0.004, 0.0019), sx * (half - F * 0.5), (T + B) / 2, -0.001);
    }
    for (const y of [T - F - 0.003, B + F + 0.003]) b.add(M.chrome, this.box(iw, 0.006, 0.012, 0.0029), 0, y, -fd + 0.004);
    for (const y of [T - F * 0.5, B + F * 0.5]) b.add(M.accent, this.box(iw + F * 0.6, F * 0.22, 0.004, 0.0019), 0, y, -0.001);
    // Corner bolts: domed heads with a hex socket on High and Ultra.
    for (const sx of [-1, 1])
      for (const y of [T - F * 0.5, B + F * 0.5]) {
        b.add(M.chrome, new CylinderGeometry(F * 0.2, F * 0.2, 0.006, this.radial), sx * (half - F * 0.5), y, 0.0005 - 0.003, Math.PI / 2, 0, 0);
        if (fine) {
          b.add(M.chrome, new SphereGeometry(F * 0.17, this.radial, 8, 0, Math.PI * 2, 0, Math.PI * 0.3), sx * (half - F * 0.5), y, -0.0015, Math.PI / 2, 0, 0);
          b.add(M.dark, new CylinderGeometry(F * 0.06, F * 0.06, 0.002, 6), sx * (half - F * 0.5), y, 0.0012, Math.PI / 2, 0, 0);
        }
      }

    /* ------------------------------------------------------------ back wall */
    b.add(M.backboard, worldUV(this.box(W + 0.2, T - B + 0.3, 0.04), 'xy', 1.6), 0, (T + B) / 2, -D - 0.02, 0, 0, 0, { receive: true });

    /* -------------------------------------------------------------- ceiling */
    const ceilW = W + 0.2;
    b.add(M.enamel, this.box(ceilW, 0.04, D + 0.06, 0.006), 0, CEIL + 0.02, -D / 2);
    b.add(M.diffuser, this.box(0.74, 0.008, 0.5), 0, CEIL - 0.004, -D * 0.5);
    b.add(M.chrome, this.box(0.78, 0.012, 0.014, 0.004), 0, CEIL - 0.006, -D * 0.5 + 0.257);
    b.add(M.chrome, this.box(0.78, 0.012, 0.014, 0.004), 0, CEIL - 0.006, -D * 0.5 - 0.257);
    b.add(M.chrome, this.box(0.014, 0.012, 0.52, 0.004), -0.383, CEIL - 0.006, -D * 0.5);
    b.add(M.chrome, this.box(0.014, 0.012, 0.52, 0.004), 0.383, CEIL - 0.006, -D * 0.5);

    /* ---------------------------------------------------- play floor (mat) */
    b.add(M.mat, worldUV(this.box(HW - CHUTE.xMax, FT, D), 'xz', 2.6), (CHUTE.xMax + HW) / 2, -FT / 2, -D / 2, 0, 0, 0, { receive: true });
    b.add(M.mat, worldUV(this.box(CHUTE.xMax - CHUTE.xMin, FT, D + CHUTE.zMin), 'xz', 2.6), (CHUTE.xMin + CHUTE.xMax) / 2, -FT / 2, (-D + CHUTE.zMin) / 2, 0, 0, 0, { receive: true });
    // Front lip with a light strip underneath.
    b.add(M.chrome, this.box(HW - CHUTE.xMax + 0.004, 0.014, 0.012, 0.004), (CHUTE.xMax + HW) / 2, 0.004, -0.008);
    b.add(M.accent, this.box(2 * HW, FT - 0.012, 0.01, 0.003), 0, -FT / 2 - 0.004, -0.007);
    b.add(M.leds[0]!, this.box(HW - CHUTE.xMax - 0.04, 0.006, 0.004), (CHUTE.xMax + HW) / 2, -0.012, -0.0015);

    /* ------------------------------------------------------------ glass box */
    const glassH = CEIL;
    for (const sx of [-1, 1]) {
      b.add(M.glass, this.box(0.006, glassH, D - fd), sx * (HW + 0.003), glassH / 2, (-D - fd) / 2);
      // Rear corner post with a light strip.
      b.add(M.chrome, new CylinderGeometry(0.011, 0.011, glassH, this.radial), sx * (HW - 0.004), glassH / 2, -D + 0.012);
      b.add(M.leds[1 % M.leds.length]!, this.box(0.006, glassH - 0.08, 0.006), sx * (HW - 0.024), glassH / 2, -D + 0.006);
      // Glass channel on the floor.
      b.add(M.brushed, this.box(0.012, 0.01, D - fd, 0.002), sx * (HW + 0.003), 0.005, (-D - fd) / 2);
    }
    b.add(M.leds[2 % M.leds.length]!, this.box(2 * HW - 0.08, 0.006, 0.006), 0, CEIL - 0.03, -D + 0.006);

    /* ------------------------------------------------------- gantry rails */
    const railY = FIELD.gantryY;
    for (const sx of [-1, 1]) {
      b.add(M.brushed, this.box(0.03, 0.034, D - 0.03, 0.004), sx * 0.455, railY, -D / 2);
      b.add(M.dark, this.box(0.012, 0.004, D - 0.06), sx * 0.455, railY + 0.019, -D / 2);
      for (const z of [-0.05, -D + 0.02]) {
        b.add(M.anodised, this.box(0.05, 0.14, 0.03, 0.006), sx * 0.455, railY + 0.07, z);
        if (fine)
          for (const dy of [0.035, 0.105]) b.add(M.chrome, new CylinderGeometry(0.0045, 0.0045, 0.003, 12), sx * 0.455, railY + dy, z + 0.016, Math.PI / 2, 0, 0);
      }
    }

    /* ---------------------------------------------------------------- chute */
    const ch = CHUTE.wallHeight, ct = CHUTE.wallThickness;
    b.add(M.acrylic, this.box(ct, ch, CHUTE.zMax - CHUTE.zMin - fd, 0.002), CHUTE.xMax + ct / 2, ch / 2, (CHUTE.zMin - fd) / 2);
    b.add(M.acrylic, this.box(CHUTE.xMax - CHUTE.xMin, ch, ct, 0.002), (CHUTE.xMin + CHUTE.xMax) / 2, ch / 2, CHUTE.zMin - ct / 2);
    b.add(M.acrylicEdge, this.box(ct + 0.006, 0.008, CHUTE.zMax - CHUTE.zMin - fd, 0.003), CHUTE.xMax + ct / 2, ch + 0.002, (CHUTE.zMin - fd) / 2);
    b.add(M.acrylicEdge, this.box(CHUTE.xMax - CHUTE.xMin + ct, 0.008, ct + 0.006, 0.003), (CHUTE.xMin + CHUTE.xMax + ct) / 2, ch + 0.002, CHUTE.zMin - ct / 2);
    b.add(M.chrome, new CylinderGeometry(0.009, 0.009, ch + 0.012, this.radial), CHUTE.xMax + ct / 2, ch / 2, CHUTE.zMin - ct / 2);
    // Dark collar through the floor slab.
    b.add(M.dark, this.box(0.004, FT, CHUTE.zMax - CHUTE.zMin), CHUTE.xMax - 0.002, -FT / 2, (CHUTE.zMin + CHUTE.zMax) / 2);
    b.add(M.dark, this.box(CHUTE.xMax - CHUTE.xMin, FT, 0.004), (CHUTE.xMin + CHUTE.xMax) / 2, -FT / 2, CHUTE.zMin + 0.002);
    // "PRIZE" sign on the guard wall.
    b.add(M.sign, new PlaneGeometry(0.16, 0.05), (CHUTE.xMin + CHUTE.xMax) / 2, ch * 0.56, CHUTE.zMin + 0.001);

    /* -------------------------------------------------------- lower cabinet */
    const binFloor = L.binFloorY;
    const lowH = -FT - B;
    const lowMid = (-FT + B) / 2;
    // Prize shaft / bin: velvet back and right wall, cushioned floor, light bars.
    b.add(M.velvet, this.box(BIN.xMax - BIN.xMin + 0.04, lowH, 0.02), (BIN.xMin + BIN.xMax) / 2, lowMid, BIN.zMin - 0.01, 0, 0, 0, { receive: true });
    b.add(M.velvet, this.box(0.02, lowH, BIN.zMax - BIN.zMin), BIN.xMax + 0.01, lowMid, (BIN.zMin + BIN.zMax) / 2, 0, 0, 0, { receive: true });
    b.add(M.enamel, this.box(0.02, lowH, BIN.zMax - BIN.zMin, 0.004), BIN.xMin - 0.01, lowMid, (BIN.zMin + BIN.zMax) / 2);
    b.add(M.cushion, worldUV(this.box(BIN.xMax - BIN.xMin, 0.03, BIN.zMax - BIN.zMin, 0.01), 'xz', 4), (BIN.xMin + BIN.xMax) / 2, binFloor - 0.015, (BIN.zMin + BIN.zMax) / 2, 0, 0, 0, { receive: true });
    b.add(M.enamel, this.box(BIN.xMax - BIN.xMin + 0.04, Math.max(0.01, binFloor - B + 0.02), 0.05, 0.006), (BIN.xMin + BIN.xMax) / 2, (binFloor - 0.03 + B) / 2, -0.03);
    b.add(M.chrome, this.box(BIN.xMax - BIN.xMin, 0.012, 0.014, 0.004), (BIN.xMin + BIN.xMax) / 2, binFloor + 0.004, -0.01);
    const bars = Math.max(1, Math.floor((-FT - binFloor - 0.12) / 0.17));
    for (let i = 0; i < bars; i++) {
      const y = binFloor + 0.2 + i * 0.17;
      if (y > -FT - 0.05) break;
      b.add(M.leds[i % M.leds.length]!, this.box(BIN.xMax - BIN.xMin - 0.1, 0.008, 0.004), (BIN.xMin + BIN.xMax) / 2, y, BIN.zMin + 0.002);
    }
    // "PRIZE" arrow printed high on the back of the shaft.
    if (lowH > 0.22) this.decal(b, 'arrow', 0.075, (BIN.xMin + BIN.xMax) / 2, -FT - 0.07, BIN.zMin + 0.0015);
    // Body panel to the right of the shaft (and under the side bays in landscape).
    const panelL = BIN.xMax + 0.02, panelR = half - F + 0.01;
    b.add(M.fascia, worldUV(this.box(panelR - panelL, lowH, 0.02), 'xy', 2.2), (panelL + panelR) / 2, lowMid, -0.055, 0, 0, 0, { receive: true });
    const pcx = (panelL + Math.min(panelR, HW)) / 2;
    const badgeR = Math.min(0.11, lowH * 0.3, (Math.min(panelR, HW) - panelL) * 0.36);
    const badgeY = lowMid + lowH * 0.12;
    b.add(M.badge, new CircleGeometry(badgeR, this.radial * 2), pcx, badgeY, -0.0445);
    b.add(M.chrome, new TorusGeometry(badgeR + 0.004, 0.004, 10, this.radial * 2), pcx, badgeY, -0.0445);
    if (lowH > 0.6) {
      // Speaker grille on tall cabinets.
      b.add(M.dark, new CircleGeometry(0.075, this.radial * 2), pcx, B + F + 0.16, -0.0445);
      b.add(M.chrome, new TorusGeometry(0.078, 0.005, 10, this.radial * 2), pcx, B + F + 0.16, -0.0445);
      if (fine) for (let r = 0.015; r < 0.07; r += 0.015) b.add(M.chrome, new TorusGeometry(r, 0.0012, 6, this.radial * 2), pcx, B + F + 0.16, -0.0442);
    }
    b.add(M.leds[0]!, this.box(Math.min(panelR, HW) - panelL - 0.06, 0.006, 0.004), pcx, -FT - 0.03, -0.044);
    // Stickers on the body panel: a price card under the badge, a caution label in the corner.
    const panelW = Math.min(panelR, HW) - panelL;
    if (lowH > 0.32 && panelW > 0.18) this.decal(b, 'free', Math.min(0.2, panelW * 0.62), pcx, badgeY - badgeR - 0.06, -0.0443);
    if (panelW > 0.2) this.decal(b, 'caution', Math.min(0.16, panelW * 0.4), Math.min(panelR, HW) - Math.min(0.16, panelW * 0.4) * 0.55, -FT - 0.075, -0.0443);
    if (landscape) {
      const leftR = BIN.xMin - 0.02, leftL = -half + F - 0.01;
      b.add(M.fascia, worldUV(this.box(leftR - leftL, lowH, 0.02), 'xy', 2.2), (leftL + leftR) / 2, lowMid, -0.055, 0, 0, 0, { receive: true });
      if (leftR - leftL > 0.14 && lowH > 0.2) this.decal(b, 'win', Math.min(0.15, (leftR - leftL) * 0.7), (leftL + leftR) / 2, lowMid + lowH * 0.12, -0.0443);
    } else if (panelW > 0.3 && lowH > 0.4) this.decal(b, 'win', 0.11, panelL + 0.08, -FT - 0.09, -0.0443);

    /* ------------------------------------------------------------ side bays */
    if (landscape) {
      for (const sx of [-1, 1]) {
        const x0 = HW + 0.012, x1 = half - F;
        const cx = (sx * (x0 + x1)) / 2, bw = x1 - x0;
        b.add(M.bayMat, worldUV(this.box(bw, FT, D), 'xz', 2.6), cx, -FT / 2, -D / 2, 0, 0, 0, { receive: true });
        b.add(M.enamel, this.box(0.02, T - B, D, 0.004), sx * (x1 + 0.01), (T + B) / 2, -D / 2);
        b.add(M.accent, this.box(bw, FT - 0.012, 0.01, 0.003), cx, -FT / 2 - 0.004, -0.007);
        // Two-step riser for display toys.
        b.add(M.enamel, this.box(bw - 0.03, 0.13, 0.3, 0.012), cx, 0.065, -D + 0.16, 0, 0, 0, { receive: true });
        b.add(M.enamel, this.box(bw - 0.03, 0.27, 0.15, 0.012), cx, 0.135, -D + 0.085, 0, 0, 0, { receive: true });
        b.add(M.leds[1 % M.leds.length]!, this.box(bw - 0.07, 0.006, 0.004), cx, 0.122, -D + 0.312);
        b.add(M.leds[2 % M.leds.length]!, this.box(bw - 0.07, 0.006, 0.004), cx, 0.262, -D + 0.162);
        const cols = Math.max(1, Math.floor((bw - 0.06) / 0.24));
        for (let c = 0; c < cols; c++) {
          const px = sx * (x0 + ((c + 0.5) / cols) * bw);
          const lean = -sx * 0.18;
          this.displaySlots.push({ x: px, y: 0, z: -0.25 - (c % 2) * 0.06, yaw: lean + (rng() - 0.5) * 0.3 });
          this.displaySlots.push({ x: px, y: 0.13, z: -D + 0.2, yaw: lean + (rng() - 0.5) * 0.3 });
        }
      }
    }

    /* ------------------------------------------------------- wall ornaments */
    const reach = landscape ? half - F - 0.05 : HW - 0.06;
    if (this.theme.cabinet.pattern === 'circuit') this.buildCircuitDecor(b, rng, reach);
    else this.buildOrnaments(b, rng, reach);

    const order = new Map<Material, number>([
      [M.glass, 10],
      [M.acrylic, 11],
      [M.sign, 12],
      [M.badge, 2],
      [M.decal, 3],
    ]);
    if (M.emblem) order.set(M.emblem, 3);
    b.build(this.group, order);

    // Out-of-focus arcade backdrop seen through the side glass (portrait) and in reflections.
    const d = this.detail;
    const backdropSize = d === 0 ? 512 : d === 3 ? 2048 : 1024;
    const sphere = new SphereGeometry(7, d >= 2 ? 64 : 32, d >= 2 ? 32 : 16);
    const backdrop = new Mesh(sphere, new MeshBasicMaterial({ map: makeBackdropTexture(this.theme, backdropSize), side: BackSide, depthWrite: false }));
    backdrop.position.set(0, 0.4, -0.4);
    backdrop.renderOrder = -10;
    backdrop.matrixAutoUpdate = false;
    backdrop.updateMatrix();
    this.backdrop = backdrop;
    this.group.add(backdrop);
  }

  /** A printed sticker from the decal atlas, `w` wide, on a wall facing +z. */
  private decal(b: Builder, id: DecalId, w: number, x: number, y: number, z: number): void {
    const g = new PlaneGeometry(w, w);
    const [u0, v0, u1, v1] = decalUv(id);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    b.add(this.mats.decal, g, x, y, z, 0, 0, 0, { keepUv: true });
  }

  /** Sculpted plaques on the upper back wall: real depth, so they shift against the pattern with the viewpoint. */
  private buildOrnaments(b: Builder, rng: () => number, reach: number): void {
    const M = this.mats;
    const z = -FIELD.depth + 0.001;
    const mats = [M.plaqueA, M.plaqueB, M.plaqueC, M.enamel];
    const kind = this.theme.cabinet.pattern;
    const count = Math.round(8 + reach * 8);
    const placed: { x: number; y: number; r: number }[] = [];
    const dome = (r: number) => new SphereGeometry(r, this.radial, Math.max(8, this.radial / 2), 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
    for (let i = 0; i < count * 6 && placed.length < count; i++) {
      const r = 0.035 + rng() * 0.05;
      const x = (rng() * 2 - 1) * reach;
      const y = 0.4 + rng() * 0.46;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + 0.03)) continue;
      placed.push({ x, y, r });
      const rot = (rng() - 0.5) * 0.9;
      const material = mats[placed.length % mats.length]!;
      let geometry: BufferGeometry;
      const pick = rng();
      if (kind === 'sakura') geometry = this.plaque(pick < 0.75 ? flowerShape(r, 5) : starShape(r * 0.8, 6, 0.72));
      else if (kind === 'storybook') geometry = this.plaque(pick < 0.4 ? starShape(r) : pick < 0.7 ? cloudShape(r * 1.2) : moonShape(r));
      else if (kind === 'waves') geometry = pick < 0.45 ? this.plaque(shellShape(r)) : pick < 0.75 ? this.plaque(starShape(r, 5, 0.58)) : dome(r * 0.6);
      else geometry = pick < 0.4 ? this.plaque(starShape(r, 4, 0.36)) : pick < 0.7 ? this.plaque(moonShape(r)) : dome(r * 0.7);
      b.add(material, geometry, x, y, z, 0, 0, rot, { cast: false });
      if (kind === 'cosmos' && pick >= 0.7) b.add(M.leds[placed.length % M.leds.length]!, new TorusGeometry(r * 1.05, 0.004, 8, this.radial * 2), x, y, z + 0.012, 0.9, 0.3, 0);
    }
  }

  /**
   * GPU Party wall kit (original designs, no real-world logos): the replaceable emblem on a chip
   * carrier, "GPU" block letters, two spinning case fans with lit rings, floating chips on
   * stand-offs, lightning bolts and raised glowing circuit traces with vias.
   */
  private buildCircuitDecor(b: Builder, rng: () => number, reach: number): void {
    const M = this.mats;
    const wall = -FIELD.depth + 0.001;
    const lime = M.leds[0]!;
    const glow = M.leds[1 % M.leds.length]!;
    const placed: { x: number; y: number; r: number }[] = [];
    const free = (x: number, y: number, r: number) => !placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + 0.02);

    // Hero items sit on the play field's own back wall (always in view, also in portrait).
    const inner = Math.min(reach, FIELD.halfWidth - 0.06);
    // Emblem (logo slot) on a chip carrier: upper left, clear of the claw's home position.
    const ex = -inner * 0.58, ey = 0.6, es = Math.min(0.19, inner * 0.46);
    placed.push({ x: ex, y: ey, r: es * 0.75 });
    b.add(M.chip, this.box(es, es, 0.016, 0.004), ex, ey, wall + 0.03);
    b.add(M.dark, new CylinderGeometry(0.008, 0.008, 0.024, 10), ex, ey, wall + 0.011, Math.PI / 2, 0, 0);
    const pins = this.detail >= 2 ? 9 : 6;
    for (let i = 0; i < pins; i++) {
      const o = -es * 0.38 + (i / (pins - 1)) * es * 0.76;
      b.add(M.chrome, this.box(0.005, 0.02, 0.004), ex + o, ey + es / 2 + 0.006, wall + 0.03);
      b.add(M.chrome, this.box(0.005, 0.02, 0.004), ex + o, ey - es / 2 - 0.006, wall + 0.03);
      b.add(M.chrome, this.box(0.02, 0.005, 0.004), ex + es / 2 + 0.006, ey + o, wall + 0.03);
      b.add(M.chrome, this.box(0.02, 0.005, 0.004), ex - es / 2 - 0.006, ey + o, wall + 0.03);
    }
    if (M.emblem) b.add(M.emblem, new PlaneGeometry(es * 0.92, es * 0.92), ex, ey, wall + 0.0393, 0, 0, 0, { keepUv: true });

    // "GPU" block letters, upper right.
    const lh = Math.min(0.08, inner * 0.2);
    const gap = lh * 0.16;
    const lw = lh * 0.6;
    const lcx = inner * 0.56;
    const lx = lcx - (3 * lw + 2 * gap) / 2, ly = 0.6;
    placed.push({ x: lcx, y: ly + lh / 2, r: (3 * lw + 2 * gap) * 0.6 });
    (['G', 'P', 'U'] as const).forEach((ch, i) => {
      const geo = new ExtrudeGeometry(letterShape(ch, lh), {
        depth: 0.014,
        bevelEnabled: true,
        bevelThickness: 0.003,
        bevelSize: 0.0025,
        bevelSegments: TESSELLATION.bevelSegments[this.detail],
        curveSegments: 4,
      });
      b.add(M.plaqueA, geo, lx + i * (lw + gap), ly, wall + 0.02, 0, 0, 0, { cast: false });
    });
    // Backing bar with a lit underline.
    b.add(M.chip, this.box(3 * lw + 2 * gap + 0.03, lh + 0.03, 0.008, 0.003), lcx, ly + lh / 2, wall + 0.006);
    b.add(lime, this.box(3 * lw + 2 * gap, 0.004, 0.004), lcx, ly - 0.008, wall + 0.012);

    // Two case fans with spinning rotors (separate meshes so they can turn).
    const fanSize = Math.min(0.13, inner * 0.3);
    const fans =
      reach > inner + 0.15
        ? [
            { x: -(inner + reach) / 2, y: 0.56 },
            { x: (inner + reach) / 2, y: 0.6 },
          ]
        : [
            { x: inner * 0.08, y: 0.5 },
            { x: inner * 0.76, y: 0.43 },
          ];
    for (const [i, f] of fans.entries()) {
      if (!free(f.x, f.y, fanSize * 0.7)) continue;
      placed.push({ x: f.x, y: f.y, r: fanSize * 0.7 });
      const frame = new ExtrudeGeometry(fanFrameShape(fanSize, fanSize * 0.45, this.radial * 2), { depth: 0.018, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 6 });
      b.add(M.anodised, frame, f.x, f.y, wall + 0.004);
      b.add(glow, new TorusGeometry(fanSize * 0.455, 0.0025, 8, this.radial * 2), f.x, f.y, wall + 0.024);
      for (const [cx, cy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const)
        b.add(M.chrome, new CylinderGeometry(0.004, 0.004, 0.003, 10), f.x + cx * fanSize * 0.4, f.y + cy * fanSize * 0.4, wall + 0.0245, Math.PI / 2, 0, 0);
      this.addFanRotor(fanSize * 0.43, f.x, f.y, wall + 0.012, i % 2 === 0 ? 1 : -1.3);
    }

    // Floating chips on stand-offs (a few hero chips bob gently).
    const chips = Math.round(4 + reach * 4);
    let heroes = 0;
    for (let i = 0; i < chips * 8 && placed.length < chips + 4; i++) {
      const s = 0.05 + rng() * 0.04;
      const x = (rng() * 2 - 1) * reach;
      const y = 0.42 + rng() * 0.42;
      if (!free(x, y, s * 0.8)) continue;
      placed.push({ x, y, r: s * 0.8 });
      const lift = 0.025 + rng() * 0.035;
      const rot = (rng() - 0.5) * 0.5;
      if (heroes < 3 && rng() < 0.6) {
        heroes++;
        this.addFloatingChip(s, x, y, wall, lift, rot, heroes);
      } else {
        b.add(M.dark, new CylinderGeometry(0.004, 0.004, lift, 8), x, y, wall + lift / 2, Math.PI / 2, 0, 0);
        this.chipGeometry(s, rot).forEach(([material, geometry]) => b.add(material, geometry, x, y, wall + lift, 0, 0, 0));
      }
    }

    // Lightning bolts.
    for (let i = 0, n = 0; i < 40 && n < 3; i++) {
      const r = 0.035 + rng() * 0.02;
      const x = (rng() * 2 - 1) * reach, y = 0.42 + rng() * 0.4;
      if (!free(x, y, r)) continue;
      placed.push({ x, y, r });
      n++;
      b.add(n % 2 ? M.plaqueC : M.plaqueA, this.plaque(boltShape(r), 0.01), x, y, wall + 0.006, 0, 0, (rng() - 0.5) * 0.6, { cast: false });
    }

    // Raised circuit traces between the parts: 45°-routed lit strips ending in vias.
    const traceW = 0.004;
    for (let t = 0; t < Math.round(5 + reach * 3); t++) {
      let x = (rng() * 2 - 1) * reach, y = 0.4 + rng() * 0.46;
      let dir = Math.floor(rng() * 4) * 2;
      for (let s = 0; s < 3; s++) {
        const len = 0.04 + rng() * 0.09;
        const a = (dir * Math.PI) / 4;
        const nx = Math.max(-reach, Math.min(reach, x + Math.cos(a) * len)), ny = Math.max(0.38, Math.min(0.88, y + Math.sin(a) * len));
        const segLen = Math.hypot(nx - x, ny - y);
        if (segLen > 0.01) b.add(s === 1 ? glow : lime, this.box(segLen + traceW, traceW, 0.003), (x + nx) / 2, (y + ny) / 2, wall + 0.0025, 0, 0, Math.atan2(ny - y, nx - x));
        x = nx;
        y = ny;
        dir = (dir + (rng() < 0.5 ? 1 : 7)) % 8;
      }
      b.add(M.chrome, new TorusGeometry(0.006, 0.0022, 8, this.radial), x, y, wall + 0.003);
    }
  }

  /** Geometry of one chip package (epoxy body, metal lid, glowing die mark, pins), centred at 0. */
  private chipGeometry(s: number, rot: number): [Material, BufferGeometry][] {
    const M = this.mats;
    const out: [Material, BufferGeometry][] = [];
    const place = (g: BufferGeometry, x: number, y: number, z: number) => {
      g.translate(x, y, z);
      g.rotateZ(rot);
      return g;
    };
    out.push([M.chip, place(this.box(s, s, 0.008, 0.002), 0, 0, 0)]);
    out.push([M.dark, place(this.box(s * 0.62, s * 0.62, 0.003, 0.001), 0, 0, 0.005)]);
    out.push([M.leds[1 % M.leds.length]!, place(this.box(s * 0.5, 0.0025, 0.0015), 0, -s * 0.2, 0.0068)]);
    out.push([M.leds[0]!, place(this.box(s * 0.12, s * 0.12, 0.002), -s * 0.36, s * 0.36, 0.0045)]);
    const n = this.detail >= 2 ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const o = -s * 0.38 + (i / (n - 1)) * s * 0.76;
      out.push([M.chrome, place(new BoxGeometry(0.0035, 0.012, 0.0025), o, s / 2 + 0.004, -0.002)]);
      out.push([M.chrome, place(new BoxGeometry(0.0035, 0.012, 0.0025), o, -s / 2 - 0.004, -0.002)]);
      out.push([M.chrome, place(new BoxGeometry(0.012, 0.0035, 0.0025), s / 2 + 0.004, o, -0.002)]);
      out.push([M.chrome, place(new BoxGeometry(0.012, 0.0035, 0.0025), -s / 2 - 0.004, o, -0.002)]);
    }
    return out;
  }

  /** A chip floating off the wall that bobs slowly (separate small meshes, merged per material). */
  private addFloatingChip(s: number, x: number, y: number, wall: number, lift: number, rot: number, index: number): void {
    const holder = new Group();
    holder.position.set(x, y, wall + lift);
    const byMaterial = new Map<Material, BufferGeometry[]>();
    for (const [material, geometry] of this.chipGeometry(s, rot)) {
      const list = byMaterial.get(material) ?? [];
      list.push(geometry.index ? geometry.toNonIndexed() : geometry);
      byMaterial.set(material, list);
    }
    for (const [material, list] of byMaterial) {
      for (const g of list) for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      if (material === this.mats.chip) boxUV(merged, UV_DENSITY.lacquer);
      const mesh = new Mesh(merged, material);
      mesh.castShadow = false;
      holder.add(mesh);
    }
    this.group.add(holder);
    const phase = index * 2.1;
    this.removeAnimators.push(
      this.mats.addAnimator((time, reduced) => {
        holder.position.z = wall + lift + (reduced ? 0 : Math.sin(time * 0.9 + phase) * 0.006);
        holder.rotation.z = reduced ? 0 : Math.sin(time * 0.6 + phase) * 0.05;
      }),
    );
  }

  /** Fan rotor: hub plus seven swept blades, spinning about its own axis. */
  private addFanRotor(r: number, x: number, y: number, z: number, speed: number): void {
    const M = this.mats;
    const blades: BufferGeometry[] = [];
    const count = 7;
    for (let i = 0; i < count; i++) {
      const g = new ExtrudeGeometry(fanBladeShape(r, r * 0.32), { depth: 0.003, bevelEnabled: false, curveSegments: 4 });
      g.rotateX(0.18); // blade pitch
      g.rotateZ((i / count) * Math.PI * 2);
      blades.push(g.index ? g.toNonIndexed() : g);
      if (g.index) g.dispose();
    }
    const hub = new CylinderGeometry(r * 0.32, r * 0.32, 0.01, this.radial).rotateX(Math.PI / 2).translate(0, 0, 0.004).toNonIndexed();
    blades.push(hub);
    for (const g of blades) for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    const merged = mergeGeometries(blades, false)!;
    blades.forEach((g) => g.dispose());
    const rotor = new Mesh(merged, M.plastic);
    rotor.position.set(x, y, z);
    rotor.castShadow = false;
    this.group.add(rotor);
    const cap = new Mesh(new CircleGeometry(r * 0.2, this.radial), M.leds[0]!);
    cap.position.set(x, y, z + 0.0095);
    this.group.add(cap);
    this.removeAnimators.push(
      this.mats.addAnimator((time, reduced) => {
        rotor.rotation.z = reduced ? 0 : time * speed * 2.4;
      }),
    );
  }

  dispose(): void {
    for (const remove of this.removeAnimators) remove();
    this.removeAnimators.length = 0;
    this.group.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    if (this.backdrop) {
      const material = this.backdrop.material as MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
    }
    this.group.removeFromParent();
  }
}
