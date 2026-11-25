/**
 * The arcade row: our machine stands between two neighbouring claw machines, separated from each
 * by a lacquered pillar. On landscape screens the neighbours fill the space beside the play field;
 * on the portrait 9:16 screens they stand just outside the window and are seen through our side
 * glass, more of them the further the eye moves sideways. Everything here is decoration: none of it
 * has a collider, and the physics never knows it exists.
 *
 * Cost (Medium): the static parts are added to the cabinet's per-material buckets (src/scene/builder.ts),
 * so most of them cost no draw call at all; new are the light tubes, the neighbours' haze, the corner
 * shading, the header signs and the claw caps (one draw each for both sides), plus the plush piles
 * (one draw per toy at the display LOD, see ToyVisuals.setDisplay). Lighting is baked: the haze darkens
 * the neighbours towards the floor and the ceiling and the corner strips fake ambient occlusion.
 *
 * Coordinates are world metres; `sx` (−1 left, +1 right) mirrors a side. "Local" x is measured from
 * the neighbour's inner glass outwards.
 */
import { BoxGeometry, CatmullRomCurve3, CylinderGeometry, PlaneGeometry, SphereGeometry, TorusGeometry, TubeGeometry, Vector3, type BufferGeometry } from 'three';
import type { WindowLayout } from '../perspective/windowGeometry';
import { FIELD } from '../physics/fieldSpec';
import { worldUV, type CabinetBuilder } from './builder';
import type { CabinetMaterials } from './materials';

/** Where a decorative (non-interactive) display toy sits: a neighbour's plush pile. */
export interface DisplaySlot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Uniform scale (default 1). */
  scale?: number;
  /** Lean forwards / sideways (radians, default 0): toys lying on the pile. */
  pitch?: number;
  roll?: number;
  /** Which of the theme's characters (index into its asset list, wraps). Default: the slot index. */
  pick?: number;
}

/** Geometry of the row (metres; x values are magnitudes, mirrored per side). */
export const ROW = {
  /** Pillar between our machine and a neighbour. */
  postInner: FIELD.halfWidth + 0.008,
  postOuter: FIELD.halfWidth + 0.132,
  /** Front face (just behind the screen plane) and back face of the pillar. */
  postFront: -0.003,
  postBack: -0.07,
  /** Neighbour: inner side glass, first x of its play field, field width. */
  glassX: FIELD.halfWidth + 0.141,
  fieldInner: FIELD.halfWidth + 0.145,
  fieldWidth: 1.0,
  /** Neighbour's front glass and back wall planes (it stands a little deeper than the screen). */
  frontZ: -0.036,
  backZ: -0.84,
  /** The neighbour's claw: local x, z and the height of its hub. */
  claw: { x: 0.24, z: -0.56, hubY: 0.5 },
  /** Light tubes under every ceiling: height and the two z positions. */
  tubeY: FIELD.ceilingY - 0.026,
  tubeZ: [-0.12, -0.7],
} as const;

/** Absolute x of a neighbour's local x on side `sx`. */
export function rowX(sx: number, local: number): number {
  return sx * (ROW.fieldInner + local);
}

/**
 * Off-axis visibility: the x at which the line from the eye past an edge (edgeX, edgeZ) meets the
 * plane z = depthZ (all world units, z towards the viewer). Anything beyond it in that plane is
 * hidden by the edge. A sideways eye moves the line outwards on the opposite side.
 */
export function revealedX(eyeX: number, eyeZ: number, edgeX: number, edgeZ: number, depthZ: number): number {
  const dz = Math.max(1e-6, eyeZ - edgeZ);
  return edgeX + ((edgeX - eyeX) * (edgeZ - depthZ)) / dz;
}

/** Pile layout in local coordinates (x from the inner glass, z, y), nearest the pillar first. */
const PILE: readonly { l: number; z: number; y: number; yaw: number; pitch?: number; roll?: number; scale: number }[] = [
  { l: 0.15, z: -0.62, y: 0, yaw: 0.35, scale: 0.92 },
  { l: 0.25, z: -0.38, y: 0, yaw: 0.15, pitch: 0.12, scale: 0.88 },
  { l: 0.37, z: -0.68, y: 0, yaw: -0.2, scale: 0.95 },
  { l: 0.31, z: -0.53, y: 0.09, yaw: 0.5, roll: 0.22, scale: 0.84 },
  { l: 0.49, z: -0.4, y: 0, yaw: -0.35, scale: 0.9 },
  { l: 0.6, z: -0.62, y: 0, yaw: 0.1, pitch: -0.1, scale: 0.92 },
];

/**
 * The plush piles of both neighbours. Landscape screens show a good part of each neighbour (six toys
 * a side, three on the Safe tier); portrait screens only glimpse their inner corner (two a side).
 * The right-hand pile starts further along the theme's character list, so the piles differ.
 */
export function pileSlots(landscape: boolean, detail: number): DisplaySlot[] {
  const perSide = landscape ? (detail === 0 ? 3 : 6) : 2;
  const slots: DisplaySlot[] = [];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < perSide; i++) {
      const p = PILE[i]!;
      slots.push({
        x: rowX(sx, p.l),
        y: p.y,
        z: p.z,
        // Turned a little towards the middle of the arcade, mirrored per side.
        yaw: -sx * p.yaw,
        scale: p.scale,
        pitch: p.pitch ?? 0,
        roll: -sx * (p.roll ?? 0),
        pick: sx < 0 ? i : i + 3,
      });
    }
  }
  return slots;
}

export interface RowContext {
  layout: WindowLayout;
  detail: number;
  radial: number;
  /** Rounded box with the tier's bevel tessellation (Cabinet.box). */
  box: (w: number, h: number, d: number, r?: number) => BufferGeometry;
}

/**
 * Adds the pillars and both neighbours to the cabinet builder. Parts sit in the shared buckets of
 * their material; nothing here casts a shadow (the key light's map covers our play field).
 */
export function buildArcadeRow(b: CabinetBuilder, M: CabinetMaterials, ctx: RowContext): void {
  const { layout: L, box } = ctx;
  const CEIL = FIELD.ceilingY, FT = FIELD.floorThickness;
  const fine = ctx.detail >= 2;
  // The pillars run past both window edges, so their ends are never seen.
  const yBot = L.bottom - 0.25;
  const yTop = Math.max(L.top, CEIL) + 0.35;
  const postW = ROW.postOuter - ROW.postInner;
  const postD = ROW.postFront - ROW.postBack;
  const postZ = (ROW.postFront + ROW.postBack) / 2;
  const nW = ROW.fieldWidth;
  const nDepth = ROW.frontZ - ROW.backZ;
  const nZ = (ROW.frontZ + ROW.backZ) / 2;
  const led = (i: number) => M.leds[i % M.leds.length]!;

  for (const sx of [-1, 1]) {
    const px = sx * (ROW.postInner + ROW.postOuter) / 2;

    /* ---------------------------------------------------------- the pillar */
    b.add(M.enamel, box(postW, yTop - yBot, postD, 0.01), px, (yTop + yBot) / 2, postZ);
    // Accent inlay down the middle, chrome beads on both front edges, a light pin line on the
    // neighbour's half.
    b.add(M.accent, box(0.022, yTop - yBot, 0.004, 0.0019), px, (yTop + yBot) / 2, ROW.postFront - 0.0005);
    for (const e of [ROW.postInner + 0.004, ROW.postOuter - 0.004]) b.add(M.chrome, new CylinderGeometry(0.0042, 0.0042, yTop - yBot, ctx.radial), sx * e, (yTop + yBot) / 2, ROW.postFront - 0.004);
    b.add(led(1), box(0.005, yTop - yBot, 0.003), sx * (ROW.postOuter - 0.022), (yTop + yBot) / 2, ROW.postFront - 0.0005);
    if (fine) {
      // Rivets along the inlay.
      for (let y = Math.ceil(yBot / 0.22) * 0.22; y < yTop; y += 0.22) b.add(M.chrome, new SphereGeometry(0.0045, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), px, y, -0.0045, Math.PI / 2, 0, 0);
    }

    /* ------------------------------------- the dark gap between the machines */
    const gapW = ROW.glassX - FIELD.halfWidth;
    const gapX = sx * (FIELD.halfWidth + ROW.glassX) / 2;
    b.add(M.dark, new BoxGeometry(gapW + 0.04, CEIL + 0.3 - yBot, 0.02), gapX, (CEIL + 0.3 + yBot) / 2, ROW.backZ - 0.01);
    b.add(M.dark, new BoxGeometry(gapW, 0.006, ROW.postBack - ROW.backZ), gapX, -0.003, (ROW.postBack + ROW.backZ) / 2);

    /* ------------------------------------------------------- the neighbour */
    const nx = rowX(sx, nW / 2);
    const inner = sx * ROW.glassX;
    const outer = sx * (ROW.glassX + nW + 0.008);
    // Side glass (inner and outer) and the front glass, set a little behind the screen plane.
    for (const gx of [inner, outer]) b.add(M.glass, new BoxGeometry(0.006, CEIL, ROW.postBack - ROW.backZ), gx, CEIL / 2, (ROW.postBack + ROW.backZ) / 2);
    b.add(M.glass, new BoxGeometry(nW + 0.012, CEIL, 0.006), nx, CEIL / 2, ROW.frontZ);
    // Haze just behind it (unlit, see CabinetMaterials.veil): v runs from the floor to the ceiling.
    b.add(M.veil, new PlaneGeometry(nW + 0.012, CEIL), nx, CEIL / 2, ROW.frontZ - 0.006, 0, 0, 0, { keepUv: true });
    // Play floor, its front lip and the light strip under it.
    b.add(M.bayMat, worldUV(box(nW + 0.012, FT, nDepth), 'xz', 2.6), nx, -FT / 2, nZ, 0, 0, 0, { receive: true });
    b.add(M.chrome, box(nW, 0.012, 0.012, 0.004), nx, 0.004, ROW.frontZ - 0.012);
    b.add(M.accent, box(nW + 0.012, FT - 0.012, 0.01, 0.003), nx, -FT / 2 - 0.004, ROW.frontZ + 0.002);
    b.add(led(0), box(nW - 0.06, 0.006, 0.004), nx, -0.012, ROW.frontZ + 0.008);
    // Back wall in the theme's second print, so the neighbour reads as another machine of the series.
    b.add(M.fascia, worldUV(box(nW + 0.06, CEIL + 0.12, 0.03), 'xy', 1.6), nx, CEIL / 2 + 0.02, ROW.backZ - 0.015, 0, 0, 0, { receive: true });
    // Rear corner posts with light strips, like ours.
    for (const l of [0.006, nW - 0.006]) {
      b.add(M.chrome, new CylinderGeometry(0.011, 0.011, CEIL, ctx.radial), rowX(sx, l), CEIL / 2, ROW.backZ + 0.012);
      b.add(led(1), box(0.006, CEIL - 0.08, 0.006), rowX(sx, l < 0.5 ? l + 0.02 : l - 0.02), CEIL / 2, ROW.backZ + 0.006);
    }
    b.add(led(2), box(nW - 0.08, 0.006, 0.006), nx, CEIL - 0.03, ROW.backZ + 0.006);

    /* Ceiling: diffuser in a chrome frame, two light tubes, rails with hangers. */
    addCeiling(b, M, ctx, nx, ROW.frontZ, ROW.backZ);

    /* Gantry, trolley and a claw waiting with open fingers. */
    const cx = rowX(sx, ROW.claw.x), cz = ROW.claw.z, hubY = ROW.claw.hubY;
    const railY = FIELD.gantryY;
    for (const l of [0.045, nW - 0.045]) {
      b.add(M.brushed, box(0.03, 0.034, nDepth - 0.03, 0.004), rowX(sx, l), railY, nZ);
      b.add(M.dark, new BoxGeometry(0.012, 0.004, nDepth - 0.06), rowX(sx, l), railY + 0.019, nZ);
    }
    b.add(M.brushed, box(nW - 0.06, 0.03, 0.044, 0.005), nx, railY + 0.034, cz);
    for (const l of [0.045, nW - 0.045]) b.add(M.anodised, box(0.06, 0.05, 0.085, 0.008), rowX(sx, l), railY + 0.03, cz);
    b.add(M.plastic, box(0.11, 0.058, 0.09, 0.012), cx, railY, cz);
    b.add(M.clawCap, box(0.09, 0.014, 0.07, 0.006), cx, railY + 0.034, cz);
    b.add(M.chrome, new CylinderGeometry(0.0024, 0.0024, railY - 0.03 - (hubY + 0.05), 8, 1, true), cx, (railY - 0.03 + hubY + 0.05) / 2, cz);
    addClaw(b, M, ctx, cx, hubY, cz, sx);

    /* Lit header sign high on the neighbour's back wall, on the half nearest our machine (the part a
       landscape screen shows; the rest of the top edge is under the HUD's title row). */
    const signW = 0.46, signH = signW / 4, signY = 0.68;
    const sign = new PlaneGeometry(signW, signH);
    const uv = sign.getAttribute('uv');
    // Cell 0 (top half of the texture) = left neighbour.
    const v0 = sx < 0 ? 0.5 : 0;
    for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * 0.5);
    const signX = rowX(sx, 0.06 + signW / 2);
    b.add(M.rowSign, sign, signX, signY, ROW.backZ + 0.014, 0, 0, 0, { keepUv: true });
    b.add(M.enamel, box(signW + 0.024, signH + 0.024, 0.02, 0.006), signX, signY, ROW.backZ + 0.002);
    b.add(led(0), box(signW, 0.005, 0.004), signX, signY - signH / 2 - 0.02, ROW.backZ + 0.006);

    /* Baked corner shading: along the back wall's foot and top, and up the inner back corner. */
    shadeStrip(b, M, nx, 0.0012, ROW.backZ + 0.001, nW, 0.16, 'floor');
    shadeStrip(b, M, nx, 0, ROW.backZ + 0.0015, nW, 0.2, 'wallUp');
    shadeStrip(b, M, nx, CEIL, ROW.backZ + 0.0015, nW, 0.16, 'wallDown');
    shadeStrip(b, M, rowX(sx, 0), CEIL / 2, ROW.backZ + 0.002, CEIL, 0.18, sx < 0 ? 'wallRight' : 'wallLeft');

    /* Lower body: lacquer with an accent stripe, a light line and a coin plate. */
    const bodyL = ROW.postOuter, bodyR = Math.max(L.width / 2 + 0.1, ROW.glassX + nW + 0.14);
    const bodyH = -FT - yBot;
    const bodyX = sx * (bodyL + bodyR) / 2;
    b.add(M.enamel, box(bodyR - bodyL, bodyH, 0.02, 0.004), bodyX, (-FT + yBot) / 2, ROW.frontZ - 0.02);
    b.add(M.accent, box(bodyR - bodyL, 0.022, 0.006, 0.002), bodyX, -FT - 0.05, ROW.frontZ - 0.008);
    b.add(led(0), box(Math.min(nW, bodyR - bodyL) - 0.08, 0.006, 0.004), rowX(sx, nW / 2), -FT - 0.022, ROW.frontZ - 0.009);
    const plateX = rowX(sx, 0.32), plateY = Math.max(yBot + 0.2, -FT - 0.2);
    b.add(M.dark, box(0.12, 0.17, 0.008, 0.012), plateX, plateY, ROW.frontZ - 0.008);
    b.add(M.chrome, box(0.012, 0.05, 0.004, 0.002), plateX, plateY + 0.03, ROW.frontZ - 0.003);
    b.add(led(1), box(0.05, 0.012, 0.003, 0.002), plateX, plateY - 0.045, ROW.frontZ - 0.0035);

    /* The far pillar of the neighbour (only very wide screens or a big peek reach it). */
    const farX = sx * (ROW.glassX + nW + 0.008 + postW / 2 + 0.004);
    b.add(M.enamel, box(postW, yTop - yBot, postD, 0.01), farX, (yTop + yBot) / 2, postZ);
    b.add(M.accent, box(0.022, yTop - yBot, 0.004, 0.0019), farX, (yTop + yBot) / 2, ROW.postFront - 0.0005);
  }
}

/**
 * A machine's ceiling furniture: the diffuser in its chrome frame, two fluorescent tubes with end
 * caps, and the gantry rails hung from the ceiling on brackets. Centred on `cx`, between the front
 * and back planes. Used for our machine and both neighbours.
 */
export function addCeiling(b: CabinetBuilder, M: CabinetMaterials, ctx: RowContext, cx: number, front: number, back: number): void {
  const { box } = ctx;
  const CEIL = FIELD.ceilingY;
  const zMid = (front + back) / 2;
  const depth = front - back;
  b.add(M.diffuser, box(0.74, 0.008, 0.5), cx, CEIL - 0.004, zMid);
  for (const dz of [0.257, -0.257]) b.add(M.chrome, box(0.78, 0.012, 0.014, 0.004), cx, CEIL - 0.006, zMid + dz);
  for (const dx of [-0.383, 0.383]) b.add(M.chrome, box(0.014, 0.012, 0.52, 0.004), cx + dx, CEIL - 0.006, zMid);
  // Fluorescent tubes in front of and behind the diffuser, with chrome end caps and clips.
  const tubeLen = 0.82;
  for (const z of ROW.tubeZ) {
    const tz = Math.max(back + 0.06, Math.min(front - 0.06, z));
    b.add(M.tube, new CylinderGeometry(0.011, 0.011, tubeLen, Math.max(10, ctx.radial >> 1)), cx, ROW.tubeY, tz, 0, 0, Math.PI / 2);
    for (const e of [-1, 1]) {
      b.add(M.chrome, new CylinderGeometry(0.014, 0.014, 0.03, Math.max(10, ctx.radial >> 1)), cx + e * (tubeLen / 2 + 0.012), ROW.tubeY, tz, 0, 0, Math.PI / 2);
      b.add(M.brushed, box(0.012, CEIL - ROW.tubeY, 0.01), cx + e * (tubeLen / 2 + 0.012), (CEIL + ROW.tubeY) / 2, tz);
    }
  }
  // Rail hangers: brackets from the ceiling down to the gantry rails (front, middle, back).
  const railY = FIELD.gantryY;
  for (const dx of [-0.455, 0.455])
    for (const t of [0.22, 0.5, 0.78]) b.add(M.brushed, box(0.016, CEIL - railY - 0.02, 0.022, 0.003), cx + dx, (CEIL + railY + 0.02) / 2, front - depth * t);
}

/** A static claw with open fingers (hub, three bent fingers with soft tips) at (x, hubY, z). */
function addClaw(b: CabinetBuilder, M: CabinetMaterials, ctx: RowContext, x: number, hubY: number, z: number, sx: number): void {
  const radial = ctx.radial;
  b.add(M.clawCap, new CylinderGeometry(0.04, 0.045, 0.05, radial), x, hubY + 0.02, z);
  b.add(M.chrome, new CylinderGeometry(0.046, 0.04, 0.02, radial), x, hubY - 0.015, z);
  b.add(M.leds[1 % M.leds.length]!, new TorusGeometry(0.0455, 0.0025, 6, radial), x, hubY + 0.0, z, Math.PI / 2, 0, 0);
  const tubular = ctx.detail >= 2 ? 20 : 12;
  const tubeRadial = ctx.detail >= 2 ? 8 : 6;
  for (let i = 0; i < 3; i++) {
    // Fingers spread open, the first one pointing towards the viewer and slightly towards the pillar.
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2 - sx * 0.35;
    const r = new Vector3(Math.cos(a), 0, Math.sin(a));
    const elbow = r.clone().multiplyScalar(0.085).add(new Vector3(0, -0.06, 0));
    const tip = r.clone().multiplyScalar(0.06).add(new Vector3(0, -0.15, 0));
    const curve = new CatmullRomCurve3([new Vector3(0, -0.02, 0).addScaledVector(r, 0.03), elbow.clone().lerp(new Vector3(0, -0.02, 0), 0.4), elbow, elbow.clone().lerp(tip, 0.55).addScaledVector(r, 0.006), tip], false, 'catmullrom', 0.35);
    b.add(M.chrome, new TubeGeometry(curve, tubular, 0.0055, tubeRadial, false), x, hubY, z);
    b.add(M.clawCap, new SphereGeometry(0.011, 10, 8), x + tip.x, hubY + tip.y, z + tip.z);
  }
}

type StripKind = 'floor' | 'wallUp' | 'wallDown' | 'wallLeft' | 'wallRight';

/**
 * One baked occlusion strip (CabinetMaterials.shade): dark at the corner it starts from, fading out
 * over `reach`. `len` runs along the corner; (x, y, z) is the middle of the corner line.
 */
export function shadeStrip(b: CabinetBuilder, M: CabinetMaterials, x: number, y: number, z: number, len: number, reach: number, kind: StripKind): void {
  const vertical = kind === 'wallLeft' || kind === 'wallRight';
  const g = new PlaneGeometry(vertical ? reach : len, vertical ? len : reach);
  const uv = g.getAttribute('uv');
  const pos = g.getAttribute('position');
  for (let i = 0; i < uv.count; i++) {
    // u = 0 at the corner edge of the strip, 1 at its open edge; v is unused (the texture is 1D).
    const px = pos.getX(i), py = pos.getY(i);
    let u: number;
    if (kind === 'wallLeft') u = px < 0 ? 0 : 1;
    else if (kind === 'wallRight') u = px > 0 ? 0 : 1;
    // The floor strip is turned to lie flat: its local +y ends up at the back (the corner).
    else if (kind === 'wallUp') u = py < 0 ? 0 : 1;
    else u = py > 0 ? 0 : 1;
    uv.setXY(i, u, 0.5);
  }
  if (kind === 'floor') b.add(M.shade, g, x, y, z + reach / 2, -Math.PI / 2, 0, 0, { keepUv: true });
  else if (kind === 'wallUp') b.add(M.shade, g, x, y + reach / 2, z, 0, 0, 0, { keepUv: true });
  else if (kind === 'wallDown') b.add(M.shade, g, x, y - reach / 2, z, 0, 0, 0, { keepUv: true });
  else if (kind === 'wallLeft') b.add(M.shade, g, x + reach / 2, y, z, 0, 0, 0, { keepUv: true });
  else b.add(M.shade, g, x - reach / 2, y, z, 0, 0, 0, { keepUv: true });
}
