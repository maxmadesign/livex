import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../core/math';
import type { WindowLayout } from '../perspective/windowGeometry';
import { BIN, CHUTE, FIELD } from '../physics/fieldSpec';
import type { ThemeDef } from '../themes/themes';
import { addCeiling, buildArcadeRow, pileSlots, ROW, shadeStrip, type DisplaySlot } from './arcadeRow';
import { LED_BEZEL, LED_WALL } from './brandScene';
import { CabinetBuilder as Builder, worldUV, type UvRule } from './builder';
import { boxUV, fanBladeShape, fanFrameShape, TESSELLATION } from './decor';
import type { BrandWall } from './ledWall';
import { UV_DENSITY, type CabinetMaterials, type DetailLevel } from './materials';
import { decalUv, makeBackdropTexture, type DecalId } from './textures';

export type { DisplaySlot } from './arcadeRow';

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
 * box, back board, ceiling lights, gantry rails, chute, lower cabinet with the
 * prize shaft, and the arcade row around it (pillars and two neighbouring machines,
 * src/scene/arcadeRow.ts). Tessellation and the amount of small detail follow the
 * materials' detail level (texture tier).
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
  private box(w: number, h: number, d: number, r = 0, segments: number = TESSELLATION.bevel[this.detail]): BufferGeometry {
    if (r <= 0) return new BoxGeometry(w, h, d);
    const radius = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
    return radius > 1e-4 ? new RoundedBoxGeometry(w, h, d, segments, radius) : new BoxGeometry(w, h, d);
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
    // Our machine's own back wall; the neighbours beyond the pillars have theirs (src/scene/arcadeRow.ts).
    b.add(M.backboard, worldUV(this.box(2 * HW + 0.12, T - B + 0.3, 0.04), 'xy', 1.6), 0, (T + B) / 2, -D - 0.02, 0, 0, 0, { receive: true });

    /* -------------------------------------------------------------- ceiling */
    // One lacquered ceiling over the whole row, so a low eye looking up past the window's top edge
    // finds a roof over the neighbours too.
    const ceilW = Math.max(W + 0.2, 2 * (ROW.glassX + ROW.fieldWidth + 0.2));
    b.add(M.enamel, this.box(ceilW, 0.04, ROW.frontZ - ROW.backZ + 0.1, 0.006), 0, CEIL + 0.02, (ROW.frontZ + ROW.backZ) / 2);
    // Diffuser, light tubes and the brackets that hang the gantry rails from the ceiling.
    // The row's parts (and the ceiling furniture, mostly above the window) are many small boxes seen
    // through haze or at a glance: one bevel segment keeps their rounded edges at a fraction of the
    // triangles (about 110 per box instead of 590 on Medium).
    const rowCtx = { layout: L, detail: this.detail, radial: Math.min(this.radial, 16), box: (w: number, h: number, d: number, r = 0) => this.box(w, h, d, r, 1) };
    addCeiling(b, M, rowCtx, 0, 0, -D);

    /* ---------------------------------------------------- play floor (mat) */
    b.add(M.mat, worldUV(this.box(HW - CHUTE.xMax, FT, D), 'xz', 2.6), (CHUTE.xMax + HW) / 2, -FT / 2, -D / 2, 0, 0, 0, { receive: true });
    b.add(M.mat, worldUV(this.box(CHUTE.xMax - CHUTE.xMin, FT, D + CHUTE.zMin), 'xz', 2.6), (CHUTE.xMin + CHUTE.xMax) / 2, -FT / 2, (-D + CHUTE.zMin) / 2, 0, 0, 0, { receive: true });
    // Front lip with a light strip underneath.
    b.add(M.chrome, this.box(HW - CHUTE.xMax + 0.004, 0.014, 0.012, 0.004), (CHUTE.xMax + HW) / 2, 0.004, -0.008);
    b.add(M.accent, this.box(2 * HW, FT - 0.012, 0.01, 0.003), 0, -FT / 2 - 0.004, -0.007);
    b.add(M.leds[0]!, this.box(HW - CHUTE.xMax - 0.04, 0.006, 0.004), (CHUTE.xMax + HW) / 2, -0.012, -0.0015);

    /* ---------------------------------------- baked depth cues in the corners */
    // Medium has no ambient occlusion: darken the inside corners a little so the box reads deep.
    shadeStrip(b, M, 0, 0.0012, -D + 0.001, 2 * HW, 0.14, 'floor');
    shadeStrip(b, M, 0, 0, -D + 0.0015, 2 * HW, 0.18, 'wallUp');
    shadeStrip(b, M, 0, CEIL, -D + 0.0015, 2 * HW, 0.14, 'wallDown');
    shadeStrip(b, M, -HW, CEIL / 2, -D + 0.002, CEIL, 0.12, 'wallLeft');
    shadeStrip(b, M, HW, CEIL / 2, -D + 0.002, CEIL, 0.12, 'wallRight');

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
    // A light lip just inside the prize hole, seen when the eye is high enough to look down into it.
    b.add(M.leds[0]!, this.box(0.003, 0.009, CHUTE.zMax - CHUTE.zMin - 0.01), CHUTE.xMax - 0.0055, -0.011, (CHUTE.zMin + CHUTE.zMax) / 2);
    b.add(M.leds[0]!, this.box(CHUTE.xMax - CHUTE.xMin - 0.01, 0.009, 0.003), (CHUTE.xMin + CHUTE.xMax) / 2, -0.011, CHUTE.zMin + 0.0055);
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
    // The shaft darkens just under the floor slab (baked occlusion).
    shadeStrip(b, M, (BIN.xMin + BIN.xMax) / 2, -FT, BIN.zMin + 0.0015, BIN.xMax - BIN.xMin, 0.16, 'wallDown');
    // "PRIZE" arrow printed high on the back of the shaft.
    if (lowH > 0.22) this.decal(b, 'arrow', 0.075, (BIN.xMin + BIN.xMax) / 2, -FT - 0.07, BIN.zMin + 0.0015);
    // Body panel to the right of the shaft, up to the pillar (the neighbours have their own).
    const panelL = BIN.xMax + 0.02, panelR = Math.min(half - F + 0.01, ROW.postInner + 0.004);
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
    if (panelW > 0.2) {
      // The label's printed strip is 0.92 w wide and 0.4 w tall (see makeDecalAtlas). On short cabinets the
      // badge reaches up to the label's height: then the label goes between the badge's chrome ring and the
      // panel edge (smaller if needed) instead of being drawn half under the badge.
      const right = Math.min(panelR, HW);
      const cy = -FT - 0.075;
      let cw = Math.min(0.16, panelW * 0.4);
      let cx = right - cw * 0.55;
      const ring = badgeR + 0.008;
      if (Math.abs(cy - badgeY) < ring + cw * 0.2 && cx - cw * 0.46 < pcx + ring) {
        const left = pcx + ring + 0.012;
        cw = Math.min(cw, (right - 0.01 - left) / 0.92);
        cx = left + cw * 0.46;
      }
      if (cw >= 0.07) this.decal(b, 'caution', cw, cx, cy, -0.0443);
    }
    if (panelW > 0.3 && lowH > 0.4) this.decal(b, 'win', 0.11, panelL + 0.08, -FT - 0.09, -0.0443);

    /* ------------------------------------- the arcade row beside our machine */
    // Pillars and the two neighbouring machines (landscape: where the display bays used to be;
    // portrait: just outside the window, seen through the side glass). Their plush piles are the
    // display slots that ToyVisuals fills.
    buildArcadeRow(b, M, rowCtx);
    this.displaySlots.push(...pileSlots(landscape, this.detail));

    /* ------------------------------------------------------- wall ornaments */
    // Wall decor stays on our own back wall (the neighbours carry their own print).
    const reach = HW - 0.06;
    if (this.theme.cabinet.pattern === 'circuit') this.buildCircuitDecor(b, rng, reach);
    else this.buildOrnaments(b, rng, reach);

    const order = new Map<Material, number>([
      [M.shade, 1],
      [M.veil, 9],
      [M.glass, 10],
      [M.acrylic, 11],
      [M.sign, 12],
      [M.badge, 2],
      [M.decal, 3],
    ]);
    b.build(this.group, order);
    // Unlit overlays (haze, corner shading) must not occlude in the ambient-occlusion pass.
    this.group.traverse((o) => {
      const material = (o as Mesh).material;
      if (material === M.veil || material === M.shade) o.userData.skipAO = true;
    });

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
      // Shadow from the viewer light only: a soft offset shadow on the wall that shifts as the eye
      // moves (the steep key light would draw long streaks under every plaque).
      b.add(material, geometry, x, y, z, 0, 0, rot, { cast: 'viewer' });
      if (kind === 'cosmos' && pick >= 0.7) b.add(M.leds[placed.length % M.leds.length]!, new TorusGeometry(r * 1.05, 0.004, 8, this.radial * 2), x, y, z + 0.012, 0.9, 0.3, 0);
    }
  }

  /**
   * GPU wall kit. When a brand kit dresses the theme (src/brand), the play field's own back wall
   * carries the LED wall with the event logo (and the host logo once its official file exists)
   * under a slim lighting truss, and the rest of the kit moves to the side bays (landscape): black
   * anodised case fans with green rings, chips on stand-offs and circuit traces with a few lit
   * runs. Without a kit the kit spreads over the whole wall. Original designs only; logos come from
   * the kit's slots and are never drawn in code.
   */
  private buildCircuitDecor(b: Builder, rng: () => number, reach: number): void {
    const M = this.mats;
    const wall = -FIELD.depth + 0.001;
    const green = M.leds[0]!;
    const brand = M.brand;
    // With the LED wall in place, decor keeps to the side bays.
    const keepOut = brand ? FIELD.halfWidth + 0.03 : 0;
    const placed: { x: number; y: number; r: number }[] = [];
    const free = (x: number, y: number, r: number) => Math.abs(x) - r >= keepOut && Math.abs(x) + r <= reach + 0.02 && !placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + 0.02);
    if (brand) {
      this.buildLedWall(b, brand, wall);
      this.buildTruss(b, wall);
    }

    // Case fans with spinning rotors (separate meshes so they can turn).
    const inner = Math.min(reach, FIELD.halfWidth - 0.06);
    const bay = reach - keepOut;
    const fanSize = brand ? Math.min(0.13, bay * 0.62) : Math.min(0.13, inner * 0.3);
    const fans = brand
      ? bay > 0.12
        ? [
            { x: -(keepOut + bay / 2), y: 0.62 },
            { x: keepOut + bay / 2, y: 0.58 },
          ]
        : []
      : reach > inner + 0.15
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
      b.add(green, new TorusGeometry(fanSize * 0.455, 0.0025, 8, this.radial * 2), f.x, f.y, wall + 0.024);
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
    const randX = () => (brand ? (rng() < 0.5 ? -1 : 1) * (keepOut + rng() * bay) : (rng() * 2 - 1) * reach);
    const chips = brand ? (bay > 0.1 ? 4 : 0) : Math.round(4 + reach * 4);
    let heroes = 0;
    for (let i = 0, n = 0; i < chips * 10 && n < chips; i++) {
      const s = 0.05 + rng() * 0.04;
      const x = randX();
      const y = 0.42 + rng() * 0.42;
      if (!free(x, y, s * 0.8)) continue;
      placed.push({ x, y, r: s * 0.8 });
      n++;
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

    // Raised circuit traces between the parts: 45°-routed metal runs ending in vias, a few of
    // them lit in the brand green.
    if (brand && bay < 0.08) return;
    const traceW = 0.004;
    const lo = keepOut, hi = reach;
    for (let t = 0; t < Math.round(5 + reach * 3); t++) {
      const side = rng() < 0.5 ? -1 : 1;
      let x = brand ? side * (lo + rng() * (hi - lo)) : (rng() * 2 - 1) * reach;
      let y = 0.4 + rng() * 0.46;
      let dir = Math.floor(rng() * 4) * 2;
      for (let s = 0; s < 3; s++) {
        const len = 0.04 + rng() * 0.09;
        const a = (dir * Math.PI) / 4;
        let nx = Math.max(-hi, Math.min(hi, x + Math.cos(a) * len));
        // Runs never cross onto the LED wall.
        if (brand) nx = side * Math.max(lo, Math.min(hi, Math.abs(nx)));
        const ny = Math.max(0.38, Math.min(0.88, y + Math.sin(a) * len));
        const segLen = Math.hypot(nx - x, ny - y);
        // Every other run carries one lit segment; the rest is bare metal.
        const lit = s === 1 && (!brand || t % 2 === 0);
        if (segLen > 0.01) b.add(lit ? green : M.brushed, this.box(segLen + traceW, traceW, 0.003), (x + nx) / 2, (y + ny) / 2, wall + 0.0025, 0, 0, Math.atan2(ny - y, nx - x));
        x = nx;
        y = ny;
        dir = (dir + (rng() < 0.5 ? 1 : 7)) % 8;
      }
      b.add(M.chrome, new TorusGeometry(0.006, 0.0022, 8, this.radial), x, y, wall + 0.003);
    }
  }

  /**
   * The LED wall on the play field's back wall: a lacquered bezel with a green light line along its
   * foot, the animated LED screen (one draw, src/scene/ledWall.ts) and the logos on their black
   * pads. Logos are unlit planes sized from the artwork's own aspect ratio once it has loaded.
   */
  private buildLedWall(b: Builder, brand: BrandWall, wall: number): void {
    const M = this.mats;
    const { xMin, xMax, yMin, yMax } = LED_WALL;
    const w = xMax - xMin, h = yMax - yMin;
    const cx = (xMin + xMax) / 2, cy = (yMin + yMax) / 2;
    const k = LED_BEZEL;
    // Bezel: four lacquered bars standing 12 mm off the wall, the screen sits 6 mm behind their face.
    b.add(M.enamel, this.box(w + 2 * k, k, 0.012, 0.003), cx, yMax + k / 2, wall + 0.006);
    b.add(M.enamel, this.box(w + 2 * k, k, 0.012, 0.003), cx, yMin - k / 2, wall + 0.006);
    b.add(M.enamel, this.box(k, h, 0.012, 0.003), xMin - k / 2, cy, wall + 0.006);
    b.add(M.enamel, this.box(k, h, 0.012, 0.003), xMax + k / 2, cy, wall + 0.006);
    // Green light line along the top of the bezel (the foot is hidden behind the toys).
    b.add(M.leds[0]!, this.box(w - 0.04, 0.003, 0.003), cx, yMax + k + 0.0015, wall + 0.006);

    const screen = new Mesh(new PlaneGeometry(w, h), brand.ledWall);
    screen.name = 'led-wall';
    screen.position.set(cx, cy, wall + 0.006);
    screen.castShadow = false;
    screen.receiveShadow = false;
    screen.updateMatrix();
    screen.matrixAutoUpdate = false;
    this.group.add(screen);

    const logo = this.logoMesh(brand, brand.logo, 'brand-logo');
    const host = brand.hostLogo ? this.logoMesh(brand, brand.hostLogo, 'brand-host-logo') : null;
    const place = () => {
      const a = brand.logoPlacement();
      const status = brand.logoStatus();
      logo.visible = status.logo.loaded;
      logo.position.set(a.cx, a.cy, wall + 0.0075);
      logo.scale.set(a.w, a.h, 1);
      logo.updateMatrix();
      if (host) {
        const hp = brand.hostPlacement();
        host.visible = !!hp;
        if (hp) {
          host.position.set(hp.cx, hp.cy, wall + 0.0075);
          host.scale.set(hp.w, hp.h, 1);
          host.updateMatrix();
        }
      }
    };
    place();
    this.removeAnimators.push(brand.onChange(place));
  }

  private logoMesh(brand: BrandWall, material: Material, name: string): Mesh {
    const mesh = new Mesh(this.unitPlane(), material);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    // Hidden until the artwork has loaded: no empty or stretched frame in the meantime.
    mesh.visible = false;
    brand.bindLogoMesh(mesh);
    this.group.add(mesh);
    return mesh;
  }

  private unitPlaneGeometry: PlaneGeometry | null = null;
  private unitPlane(): PlaneGeometry {
    return (this.unitPlaneGeometry ??= new PlaneGeometry(1, 1));
  }

  /**
   * A slim keynote-stage truss above the LED wall: two chrome chords with zig-zag lacing and a row
   * of black spot fixtures with white lenses aimed at the play field.
   */
  private buildTruss(b: Builder, wall: number): void {
    const M = this.mats;
    const half = 0.41, z = wall + 0.05;
    const yLow = LED_WALL.yMax + 0.03, yHigh = yLow + 0.03;
    const radial = Math.max(8, this.radial >> 1);
    for (const y of [yLow, yHigh]) b.add(M.chrome, new CylinderGeometry(0.005, 0.005, 2 * half, radial), 0, y, z, 0, 0, Math.PI / 2);
    const bays = 14;
    const step = (2 * half) / bays;
    const lace = Math.hypot(step, yHigh - yLow);
    const tilt = Math.atan2(step, yHigh - yLow);
    for (let i = 0; i < bays; i++) {
      const x = -half + (i + 0.5) * step;
      b.add(M.chrome, new CylinderGeometry(0.0022, 0.0022, lace, 6), x, (yLow + yHigh) / 2, z, 0, 0, i % 2 === 0 ? tilt : -tilt);
    }
    // Spot fixtures hanging under the lower chord, tilted down and forwards towards the field: the
    // housing's axis leans 0.75 rad off vertical, the white lens closes its lower end.
    const lean = 0.75;
    for (const x of [-0.33, -0.165, 0, 0.165, 0.33]) {
      const y = yLow - 0.024;
      b.add(M.dark, this.box(0.004, 0.02, 0.004), x, yLow - 0.01, z);
      b.add(M.chip, new CylinderGeometry(0.013, 0.016, 0.032, radial), x, y, z + 0.004, -lean, 0, 0);
      b.add(M.diffuser, new CircleGeometry(0.0145, radial), x, y - 0.0165 * Math.cos(lean), z + 0.004 + 0.0165 * Math.sin(lean), Math.PI / 2 - lean, 0, 0);
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
