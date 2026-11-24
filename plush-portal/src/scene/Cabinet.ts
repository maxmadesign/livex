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
import type { CabinetMaterials } from './materials';
import { makeBackdropTexture } from './textures';

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

/** Collects geometry per material and merges it, so the whole cabinet is a handful of draw calls. */
class Builder {
  private readonly buckets = new Map<Material, { geometries: BufferGeometry[]; receive: boolean; cast: boolean }>();

  add(material: Material, geometry: BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, opts: { receive?: boolean; cast?: boolean } = {}): void {
    _m.compose(new Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s);
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.applyMatrix4(_m);
    // Merging needs identical attribute sets.
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    let bucket = this.buckets.get(material);
    if (!bucket) this.buckets.set(material, (bucket = { geometries: [], receive: false, cast: false }));
    bucket.geometries.push(g);
    if (opts.receive) bucket.receive = true;
    if (opts.cast) bucket.cast = true;
    if (g !== geometry) geometry.dispose();
  }

  build(group: Group, renderOrder: Map<Material, number>): void {
    for (const [material, bucket] of this.buckets) {
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

const box = (w: number, h: number, d: number, r = 0): BufferGeometry =>
  r > 0 ? new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)) : new BoxGeometry(w, h, d);

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

function plaque(shape: Shape, depth = 0.014): BufferGeometry {
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 10 });
}

/**
 * The whole static cabinet for one window layout and theme: front frame, glass
 * box, back board, ceiling light, gantry rails, chute, lower cabinet with the
 * prize shaft and (in landscape) the display bays left and right.
 */
export class Cabinet {
  readonly group = new Group();
  readonly displaySlots: DisplaySlot[] = [];
  private backdrop: Mesh | null = null;

  constructor(
    readonly layout: WindowLayout,
    readonly theme: ThemeDef,
    private readonly mats: CabinetMaterials,
  ) {
    this.group.name = 'cabinet';
    this.build();
  }

  private build(): void {
    const { layout: L, mats: M } = this;
    const b = new Builder();
    const W = L.width, T = L.top, B = L.bottom, F = L.frame;
    const HW = FIELD.halfWidth, D = FIELD.depth, CEIL = FIELD.ceilingY, FT = FIELD.floorThickness;
    const half = W / 2;
    const landscape = L.sideBay > 0.08;
    const rng = makeRng(17 + this.theme.id.length * 31);

    /* ---------------------------------------------------------- front frame */
    const fd = 0.045; // depth of the frame behind the glass plane
    const over = 0.08; // how far the bars continue beyond the visible window
    b.add(M.enamel, box(F + over, T - B + 2 * over, fd, 0.012), -half + (F - over) / 2, (T + B) / 2, -fd / 2);
    b.add(M.enamel, box(F + over, T - B + 2 * over, fd, 0.012), half - (F - over) / 2, (T + B) / 2, -fd / 2);
    b.add(M.enamel, box(W, F + over, fd, 0.012), 0, T - (F - over) / 2, -fd / 2);
    b.add(M.enamel, box(W, F + over, fd, 0.012), 0, B + (F - over) / 2, -fd / 2);
    // Chrome bead and coloured pin-stripe along the inner edge.
    const iw = W - 2 * F, ih = T - B - 2 * F;
    for (const sx of [-1, 1]) {
      b.add(M.chrome, box(0.006, ih, 0.012), sx * (half - F - 0.003), (T + B) / 2, -fd + 0.004);
      b.add(M.accent, box(F * 0.22, ih + F * 0.6, 0.004), sx * (half - F * 0.5), (T + B) / 2, -0.001);
    }
    for (const y of [T - F - 0.003, B + F + 0.003]) b.add(M.chrome, box(iw, 0.006, 0.012), 0, y, -fd + 0.004);
    for (const y of [T - F * 0.5, B + F * 0.5]) b.add(M.accent, box(iw + F * 0.6, F * 0.22, 0.004), 0, y, -0.001);
    // Corner bolts.
    for (const sx of [-1, 1])
      for (const y of [T - F * 0.5, B + F * 0.5]) b.add(M.chrome, new CylinderGeometry(F * 0.2, F * 0.2, 0.006, 20), sx * (half - F * 0.5), y, 0.0005 - 0.003, Math.PI / 2, 0, 0);

    /* ------------------------------------------------------------ back wall */
    b.add(M.backboard, worldUV(box(W + 0.2, T - B + 0.3, 0.04), 'xy', 1.6), 0, (T + B) / 2, -D - 0.02, 0, 0, 0, { receive: true });

    /* -------------------------------------------------------------- ceiling */
    const ceilW = W + 0.2;
    b.add(M.enamel, box(ceilW, 0.04, D + 0.06), 0, CEIL + 0.02, -D / 2);
    b.add(M.diffuser, box(0.74, 0.008, 0.5), 0, CEIL - 0.004, -D * 0.5);
    b.add(M.chrome, box(0.78, 0.012, 0.014), 0, CEIL - 0.006, -D * 0.5 + 0.257);
    b.add(M.chrome, box(0.78, 0.012, 0.014), 0, CEIL - 0.006, -D * 0.5 - 0.257);
    b.add(M.chrome, box(0.014, 0.012, 0.52), -0.383, CEIL - 0.006, -D * 0.5);
    b.add(M.chrome, box(0.014, 0.012, 0.52), 0.383, CEIL - 0.006, -D * 0.5);

    /* ---------------------------------------------------- play floor (mat) */
    b.add(M.mat, worldUV(box(HW - CHUTE.xMax, FT, D), 'xz', 2.6), (CHUTE.xMax + HW) / 2, -FT / 2, -D / 2, 0, 0, 0, { receive: true });
    b.add(M.mat, worldUV(box(CHUTE.xMax - CHUTE.xMin, FT, D + CHUTE.zMin), 'xz', 2.6), (CHUTE.xMin + CHUTE.xMax) / 2, -FT / 2, (-D + CHUTE.zMin) / 2, 0, 0, 0, { receive: true });
    // Front lip with a light strip underneath.
    b.add(M.chrome, box(HW - CHUTE.xMax + 0.004, 0.014, 0.012, 0.004), (CHUTE.xMax + HW) / 2, 0.004, -0.008);
    b.add(M.accent, box(2 * HW, FT - 0.012, 0.01), 0, -FT / 2 - 0.004, -0.007);
    b.add(M.leds[0]!, box(HW - CHUTE.xMax - 0.04, 0.006, 0.004), (CHUTE.xMax + HW) / 2, -0.012, -0.0015);

    /* ------------------------------------------------------------ glass box */
    const glassH = CEIL;
    for (const sx of [-1, 1]) {
      b.add(M.glass, box(0.006, glassH, D - fd), sx * (HW + 0.003), glassH / 2, (-D - fd) / 2);
      // Rear corner post with a light strip.
      b.add(M.chrome, new CylinderGeometry(0.011, 0.011, glassH, 16), sx * (HW - 0.004), glassH / 2, -D + 0.012);
      b.add(M.leds[1 % M.leds.length]!, box(0.006, glassH - 0.08, 0.006), sx * (HW - 0.024), glassH / 2, -D + 0.006);
      // Glass channel on the floor.
      b.add(M.chrome, box(0.012, 0.01, D - fd), sx * (HW + 0.003), 0.005, (-D - fd) / 2);
    }
    b.add(M.leds[2 % M.leds.length]!, box(2 * HW - 0.08, 0.006, 0.006), 0, CEIL - 0.03, -D + 0.006);

    /* ------------------------------------------------------- gantry rails */
    const railY = FIELD.gantryY;
    for (const sx of [-1, 1]) {
      b.add(M.brushed, box(0.03, 0.034, D - 0.03, 0.004), sx * 0.455, railY, -D / 2);
      b.add(M.dark, box(0.012, 0.004, D - 0.06), sx * 0.455, railY + 0.019, -D / 2);
      for (const z of [-0.05, -D + 0.02]) b.add(M.plastic, box(0.05, 0.14, 0.03, 0.006), sx * 0.455, railY + 0.07, z);
    }

    /* ---------------------------------------------------------------- chute */
    const ch = CHUTE.wallHeight, ct = CHUTE.wallThickness;
    b.add(M.acrylic, box(ct, ch, CHUTE.zMax - CHUTE.zMin - fd), CHUTE.xMax + ct / 2, ch / 2, (CHUTE.zMin - fd) / 2);
    b.add(M.acrylic, box(CHUTE.xMax - CHUTE.xMin, ch, ct), (CHUTE.xMin + CHUTE.xMax) / 2, ch / 2, CHUTE.zMin - ct / 2);
    b.add(M.acrylicEdge, box(ct + 0.006, 0.008, CHUTE.zMax - CHUTE.zMin - fd, 0.003), CHUTE.xMax + ct / 2, ch + 0.002, (CHUTE.zMin - fd) / 2);
    b.add(M.acrylicEdge, box(CHUTE.xMax - CHUTE.xMin + ct, 0.008, ct + 0.006, 0.003), (CHUTE.xMin + CHUTE.xMax + ct) / 2, ch + 0.002, CHUTE.zMin - ct / 2);
    b.add(M.chrome, new CylinderGeometry(0.009, 0.009, ch + 0.012, 14), CHUTE.xMax + ct / 2, ch / 2, CHUTE.zMin - ct / 2);
    // Dark collar through the floor slab.
    b.add(M.dark, box(0.004, FT, CHUTE.zMax - CHUTE.zMin), CHUTE.xMax - 0.002, -FT / 2, (CHUTE.zMin + CHUTE.zMax) / 2);
    b.add(M.dark, box(CHUTE.xMax - CHUTE.xMin, FT, 0.004), (CHUTE.xMin + CHUTE.xMax) / 2, -FT / 2, CHUTE.zMin + 0.002);
    // "PRIZE" sign on the guard wall.
    b.add(M.sign, new PlaneGeometry(0.16, 0.05), (CHUTE.xMin + CHUTE.xMax) / 2, ch * 0.56, CHUTE.zMin + 0.001);

    /* -------------------------------------------------------- lower cabinet */
    const binFloor = L.binFloorY;
    const lowH = -FT - B;
    const lowMid = (-FT + B) / 2;
    // Prize shaft / bin: velvet back and right wall, cushioned floor, light bars.
    b.add(M.velvet, box(BIN.xMax - BIN.xMin + 0.04, lowH, 0.02), (BIN.xMin + BIN.xMax) / 2, lowMid, BIN.zMin - 0.01, 0, 0, 0, { receive: true });
    b.add(M.velvet, box(0.02, lowH, BIN.zMax - BIN.zMin), BIN.xMax + 0.01, lowMid, (BIN.zMin + BIN.zMax) / 2, 0, 0, 0, { receive: true });
    b.add(M.enamel, box(0.02, lowH, BIN.zMax - BIN.zMin), BIN.xMin - 0.01, lowMid, (BIN.zMin + BIN.zMax) / 2);
    b.add(M.cushion, worldUV(box(BIN.xMax - BIN.xMin, 0.03, BIN.zMax - BIN.zMin, 0.01), 'xz', 4), (BIN.xMin + BIN.xMax) / 2, binFloor - 0.015, (BIN.zMin + BIN.zMax) / 2, 0, 0, 0, { receive: true });
    b.add(M.enamel, box(BIN.xMax - BIN.xMin + 0.04, Math.max(0.01, binFloor - B + 0.02), 0.05), (BIN.xMin + BIN.xMax) / 2, (binFloor - 0.03 + B) / 2, -0.03);
    b.add(M.chrome, box(BIN.xMax - BIN.xMin, 0.012, 0.014, 0.004), (BIN.xMin + BIN.xMax) / 2, binFloor + 0.004, -0.01);
    const bars = Math.max(1, Math.floor((-FT - binFloor - 0.12) / 0.17));
    for (let i = 0; i < bars; i++) {
      const y = binFloor + 0.2 + i * 0.17;
      if (y > -FT - 0.05) break;
      b.add(M.leds[i % M.leds.length]!, box(BIN.xMax - BIN.xMin - 0.1, 0.008, 0.004), (BIN.xMin + BIN.xMax) / 2, y, BIN.zMin + 0.002);
    }
    // Body panel to the right of the shaft (and under the side bays in landscape).
    const panelL = BIN.xMax + 0.02, panelR = half - F + 0.01;
    b.add(M.fascia, worldUV(box(panelR - panelL, lowH, 0.02), 'xy', 2.2), (panelL + panelR) / 2, lowMid, -0.055, 0, 0, 0, { receive: true });
    const pcx = (panelL + Math.min(panelR, HW)) / 2;
    const badgeR = Math.min(0.11, lowH * 0.3, (Math.min(panelR, HW) - panelL) * 0.36);
    b.add(M.badge, new CircleGeometry(badgeR, 48), pcx, lowMid + lowH * 0.12, -0.0445);
    b.add(M.chrome, new TorusGeometry(badgeR + 0.004, 0.004, 10, 48), pcx, lowMid + lowH * 0.12, -0.0445);
    if (lowH > 0.6) {
      // Speaker grille on tall cabinets.
      b.add(M.dark, new CircleGeometry(0.075, 40), pcx, B + F + 0.16, -0.0445);
      b.add(M.chrome, new TorusGeometry(0.078, 0.005, 10, 40), pcx, B + F + 0.16, -0.0445);
    }
    b.add(M.leds[0]!, box(Math.min(panelR, HW) - panelL - 0.06, 0.006, 0.004), pcx, -FT - 0.03, -0.044);
    if (landscape) {
      const leftR = BIN.xMin - 0.02, leftL = -half + F - 0.01;
      b.add(M.fascia, worldUV(box(leftR - leftL, lowH, 0.02), 'xy', 2.2), (leftL + leftR) / 2, lowMid, -0.055, 0, 0, 0, { receive: true });
    }

    /* ------------------------------------------------------------ side bays */
    if (landscape) {
      for (const sx of [-1, 1]) {
        const x0 = HW + 0.012, x1 = half - F;
        const cx = (sx * (x0 + x1)) / 2, bw = x1 - x0;
        b.add(M.bayMat, worldUV(box(bw, FT, D), 'xz', 2.6), cx, -FT / 2, -D / 2, 0, 0, 0, { receive: true });
        b.add(M.enamel, box(0.02, T - B, D), sx * (x1 + 0.01), (T + B) / 2, -D / 2);
        b.add(M.accent, box(bw, FT - 0.012, 0.01), cx, -FT / 2 - 0.004, -0.007);
        // Two-step riser for display toys.
        b.add(M.enamel, box(bw - 0.03, 0.13, 0.3, 0.012), cx, 0.065, -D + 0.16, 0, 0, 0, { receive: true });
        b.add(M.enamel, box(bw - 0.03, 0.27, 0.15, 0.012), cx, 0.135, -D + 0.085, 0, 0, 0, { receive: true });
        b.add(M.leds[1 % M.leds.length]!, box(bw - 0.07, 0.006, 0.004), cx, 0.122, -D + 0.312);
        b.add(M.leds[2 % M.leds.length]!, box(bw - 0.07, 0.006, 0.004), cx, 0.262, -D + 0.162);
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
    this.buildOrnaments(b, rng, landscape ? half - F - 0.05 : HW - 0.06);

    const order = new Map<Material, number>([
      [M.glass, 10],
      [M.acrylic, 11],
      [M.sign, 12],
      [M.badge, 2],
    ]);
    b.build(this.group, order);

    // Out-of-focus arcade backdrop seen through the side glass (portrait) and in reflections.
    const sphere = new SphereGeometry(7, 32, 16);
    const backdrop = new Mesh(sphere, new MeshBasicMaterial({ map: makeBackdropTexture(this.theme, 512), side: BackSide, depthWrite: false }));
    backdrop.position.set(0, 0.4, -0.4);
    backdrop.renderOrder = -10;
    backdrop.matrixAutoUpdate = false;
    backdrop.updateMatrix();
    this.backdrop = backdrop;
    this.group.add(backdrop);
  }

  /** Sculpted plaques on the upper back wall: real depth, so they shift against the pattern with the viewpoint. */
  private buildOrnaments(b: Builder, rng: () => number, reach: number): void {
    const M = this.mats;
    const z = -FIELD.depth + 0.001;
    const mats = [M.plaqueA, M.plaqueB, M.plaqueC, M.enamel];
    const kind = this.theme.cabinet.pattern;
    const count = Math.round(8 + reach * 8);
    const placed: { x: number; y: number; r: number }[] = [];
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
      if (kind === 'sakura') geometry = plaque(pick < 0.75 ? flowerShape(r, 5) : starShape(r * 0.8, 6, 0.72));
      else if (kind === 'storybook') geometry = plaque(pick < 0.4 ? starShape(r) : pick < 0.7 ? cloudShape(r * 1.2) : moonShape(r));
      else if (kind === 'waves') geometry = pick < 0.45 ? plaque(shellShape(r)) : pick < 0.75 ? plaque(starShape(r, 5, 0.58)) : new SphereGeometry(r * 0.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
      else geometry = pick < 0.4 ? plaque(starShape(r, 4, 0.36)) : pick < 0.7 ? plaque(moonShape(r)) : new SphereGeometry(r * 0.7, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);
      b.add(material, geometry, x, y, z, 0, 0, rot, { cast: false });
      if (kind === 'cosmos' && pick >= 0.7) b.add(M.leds[placed.length % M.leds.length]!, new TorusGeometry(r * 1.05, 0.004, 8, 40), x, y, z + 0.012, 0.9, 0.3, 0);
    }
  }

  dispose(): void {
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
