/**
 * Fit diagnostics for designing collision proxies against a generated model (read-only: writes
 * nothing to the repository). Bakes the current design in memory, fits the raw generated model to
 * it exactly as `npm run assets:import` does, and reports where the generated surface and the
 * collision proxies disagree: the verdict, per proxy part (surface more than 1 cm outside, proxy
 * points with nothing visible around them) and optionally per 2 cm height slice and as a picture.
 *
 *   npx tsx tools/plush/fit-diagnose.ts --raw <dir> sakura.tanuki [more ids…] [--slices] [--png <dir>]
 *
 * The PNG shows three orthographic silhouettes (side with the front to the right, front, top with
 * the front at the bottom), 9 px per cm: dark grey = mesh and proxies overlap, light grey = visible
 * mesh without a collider, red = collider where nothing is drawn. Edit the design, run this again
 * (a few seconds per character), then `npm run assets:plush -- <slug>` and `npm run assets:import`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { Vector3 } from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { buildAsset } from './build';
import { ALL_DESIGNS } from './designs/index';
import { bounds, cleanMesh, fitToReference, measureOutside, PointIndex, proxyDistance, proxyGaps, readRawModel, readReference, samplePoints, transformMesh, windingNumber } from './generated';
import { writeGlb } from './glb';
import { verdictFor } from './import-generated';

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const rawDir = option('--raw') ?? process.env.PLUSH_RAW_DIR;
const pngDir = option('--png');
const slices = args.includes('--slices');
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--raw' && args[i - 1] !== '--png');
if (!rawDir || ids.length === 0) {
  console.error('Usage: npx tsx tools/plush/fit-diagnose.ts --raw <dir> <id> [id …] [--slices] [--png <dir>]');
  process.exit(2);
}
const cm = (v: number) => (v * 100).toFixed(1);

for (const id of ids) {
  const design = ALL_DESIGNS.find((d) => `${d.theme}.${d.slug}` === id);
  if (!design) throw new Error(`no design ${id}`);
  const t0 = performance.now();
  const built = await buildAsset(design);
  // Through the same quantised GLB the bake writes, so the fit is exactly the import's.
  const reference = await readReference(await writeGlb(built.lods, { name: id, extras: {}, compress: true }));
  const raw = await readRawModel(new Uint8Array(readFileSync(join(rawDir, `${id}.glb`))));
  const { mesh: clean } = cleanMesh(raw.mesh);
  const fit = fitToReference(clean, reference, {});
  const fitted = transformMesh(clean, fit);
  const proxies = built.proxies;
  const gen = measureOutside(fitted.position, fitted.indices, proxies);
  const base = measureOutside(reference.position, reference.indices, proxies);
  const gaps = proxyGaps(fitted.position, fitted.indices, proxies);
  const verdict = verdictFor(gen, base, gaps.p95);
  const gb = bounds(fitted.position), rb = bounds(reference.position);
  console.log(`\n=== ${id}  verdict ${verdict.toUpperCase()}  (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(`  design size ${built.size.map(cm).join(' x ')} cm; generated ${[0, 1, 2].map((i) => cm(gb.max[i]! - gb.min[i]!)).join(' x ')} (ratio ${[0, 1, 2].map((i) => ((gb.max[i]! - gb.min[i]!) / (rb.max[i]! - rb.min[i]!)).toFixed(2)).join(' x ')})`);
  console.log(`  generated bounds x ${cm(gb.min[0])}..${cm(gb.max[0])} y ${cm(gb.min[1])}..${cm(gb.max[1])} z ${cm(gb.min[2])}..${cm(gb.max[2])}; proc x ${cm(rb.min[0])}..${cm(rb.max[0])} z ${cm(rb.min[2])}..${cm(rb.max[2])}`);
  console.log(`  fit scale ${fit.scale.toFixed(4)} yaw ${fit.yawDeg} shape mean ${cm(fit.shapeMean)} p95 ${cm(fit.shapeP95)} cm`);
  // The flat-base ring (hull points at y = 0, added for a stable seat) spans the gaps between feet
  // under the toy; the same statistic without it shows how much of the gap is that ring.
  const noRing = proxies.map((p) => (p.geometry.type === 'hull' ? { ...p, geometry: { ...p.geometry, points: p.geometry.points.filter((_, i, a) => a[i - (i % 3) + 1]! > 1e-4) } } : p));
  const gapsNoRing = proxyGaps(fitted.position, fitted.indices, noRing);
  console.log(`  outside: gen ${(gen.share * 100).toFixed(1)} % p95 ${cm(gen.p95)} max ${cm(gen.max)}  | proc ${(base.share * 100).toFixed(1)} % p95 ${cm(base.p95)}  | gap p95 ${cm(gaps.p95)} max ${cm(gaps.max)} (without the floor ring: p95 ${cm(gapsNoRing.p95)} max ${cm(gapsNoRing.max)})`);

  // Per-proxy breakdown of outside samples (nearest proxy) and gaps.
  const fns = proxies.map((p) => proxyDistance([p]));
  const all = proxyDistance(proxies);
  const pts = samplePoints(fitted.position, fitted.indices, 6000, 3);
  const per = proxies.map(() => ({ n: 0, sx: 0, sy: 0, sz: 0, max: 0 }));
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i]!, y = pts[i + 1]!, z = pts[i + 2]!;
    const d = all(x, y, z);
    if (d <= 0.01) continue;
    let best = 0, bd = Infinity;
    fns.forEach((f, k) => {
      const v = f(x, y, z);
      if (v < bd) { bd = v; best = k; }
    });
    const p = per[best]!;
    p.n++; p.sx += x; p.sy += y; p.sz += z; p.max = Math.max(p.max, d);
  }
  const surface = new PointIndex(samplePoints(fitted.position, fitted.indices, 20000, 5), 1);
  const id1 = [0], d2 = [0];
  proxies.forEach((p, k) => {
    const o = per[k]!;
    const hb = bounds(new Float32Array(p.geometry.type === 'hull' ? p.geometry.points : []));
    // Gap points of this proxy (hull points with no visible surface within 5 mm, outside the mesh).
    let gn = 0, gmax = 0, gx = 0, gy = 0, gz = 0, total = 0;
    if (p.geometry.type === 'hull') {
      const hp = p.geometry.points;
      for (let i = 0; i < hp.length; i += 3) {
        total++;
        surface.nearest(hp[i]!, hp[i + 1]!, hp[i + 2]!, 1, id1, d2);
        const d = Math.sqrt(d2[0]!);
        if (d < 0.005) continue;
        if (windingNumber(fitted.position, fitted.indices, hp[i]!, hp[i + 1]!, hp[i + 2]!) > 0.5) continue;
        gn++; gmax = Math.max(gmax, d); gx += hp[i]!; gy += hp[i + 1]!; gz += hp[i + 2]!;
      }
    }
    console.log(
      `  proxy ${p.part.padEnd(10)} ${p.role.padEnd(9)} mass ${p.massFraction.toFixed(2)} hull x ${cm(hb.min[0])}..${cm(hb.max[0])} y ${cm(hb.min[1])}..${cm(hb.max[1])} z ${cm(hb.min[2])}..${cm(hb.max[2])}` +
        `  | outside>1cm ${((o.n / 6000) * 100).toFixed(1)} %${o.n ? ` at (${cm(o.sx / o.n)}, ${cm(o.sy / o.n)}, ${cm(o.sz / o.n)}) max ${cm(o.max)}` : ''}` +
        `  | gaps>0.5cm ${gn}/${total}${gn ? ` at (${cm(gx / gn)}, ${cm(gy / gn)}, ${cm(gz / gn)}) max ${cm(gmax)}` : ''}`,
    );
  });
  if (pngDir) {
    // Three orthographic views (side: z to the right; front: x to the right; top: x right, z down).
    // Dark grey = mesh and proxies overlap; light grey = visible mesh without collider; red = collider
    // where nothing is visible. 9 px per cm. Silhouettes, so this is a projection of the 3D mismatch.
    const S = 9, W = 36 * S, H = 27 * S, views = 3;
    const gen = new Uint8Array(W * views * H), prox = new Uint8Array(W * views * H);
    const proj = (v: number, x: number, y: number, z: number): [number, number] => {
      const [u, w] = v === 0 ? [z, y] : v === 1 ? [x, y] : [x, -z + 0.11];
      return [v * W + (u * 100 + 18) * S, H - 1 - (w * 100 + 2) * S];
    };
    const tri = (m: Uint8Array, v: number, a: number[], b: number[], c: number[]) => {
      const [ax, ay] = proj(v, a[0]!, a[1]!, a[2]!), [bx, by] = proj(v, b[0]!, b[1]!, b[2]!), [cx, cy] = proj(v, c[0]!, c[1]!, c[2]!);
      const x0 = Math.max(v * W, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min((v + 1) * W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(det) < 1e-9) return;
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const l1 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / det;
        const l2 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 >= -0.02 && l2 >= -0.02 && l3 >= -0.02) m[py * W * views + px] = 1;
      }
    };
    const P = fitted.position, I = fitted.indices;
    const at = (i: number) => [P[i * 3]!, P[i * 3 + 1]!, P[i * 3 + 2]!];
    for (let t = 0; t < I.length; t += 3) for (let v = 0; v < views; v++) tri(gen, v, at(I[t]!), at(I[t + 1]!), at(I[t + 2]!));
    for (const proxy of proxies) {
      if (proxy.geometry.type !== 'hull') continue;
      const pts: Vector3[] = [];
      const hp = proxy.geometry.points;
      for (let i = 0; i < hp.length; i += 3) pts.push(new Vector3(hp[i], hp[i + 1], hp[i + 2]));
      const hull = new ConvexHull().setFromPoints(pts);
      for (const face of hull.faces) {
        const e0 = face.edge, verts: number[][] = [];
        let e = e0;
        do { const p = e.head().point; verts.push([p.x, p.y, p.z]); e = e.next; } while (e !== e0);
        for (let k = 1; k + 1 < verts.length; k++) for (let v = 0; v < views; v++) tri(prox, v, verts[0]!, verts[k]!, verts[k + 1]!);
      }
    }
    const img = new Uint8Array(W * views * H * 3).fill(255);
    for (let i = 0; i < gen.length; i++) {
      const c = gen[i] && prox[i] ? [110, 110, 110] : gen[i] ? [200, 200, 200] : prox[i] ? [235, 60, 60] : null;
      if (c) img.set(c, i * 3);
    }
    for (let x = 0; x < W * views; x++) img.set([0, 0, 220], ((H - 1 - 2 * S) * W * views + x) * 3);
    for (let v = 1; v < views; v++) for (let y = 0; y < H; y++) img.set([0, 0, 0], (y * W * views + v * W) * 3);
    await sharp(Buffer.from(img), { raw: { width: W * views, height: H, channels: 3 } }).png().toFile(join(pngDir!, `fit_${id}.png`));
  }
  if (slices) {
    // Extents per 2 cm height slice: generated surface vs proxy union (sampled on a grid).
    const top = gb.max[1];
    const grid = 0.004;
    for (let y0 = 0; y0 < top; y0 += 0.02) {
      let gx0 = Infinity, gx1 = -Infinity, gz0 = Infinity, gz1 = -Infinity;
      for (let i = 0; i < pts.length; i += 3) {
        const y = pts[i + 1]!;
        if (y < y0 || y >= y0 + 0.02) continue;
        gx0 = Math.min(gx0, pts[i]!); gx1 = Math.max(gx1, pts[i]!); gz0 = Math.min(gz0, pts[i + 2]!); gz1 = Math.max(gz1, pts[i + 2]!);
      }
      let px0 = Infinity, px1 = -Infinity, pz0 = Infinity, pz1 = -Infinity;
      const y = y0 + 0.01;
      for (let x = -0.16; x <= 0.16; x += grid) for (let z = -0.16; z <= 0.16; z += grid) {
        if (all(x, y, z) > 0) continue;
        px0 = Math.min(px0, x); px1 = Math.max(px1, x); pz0 = Math.min(pz0, z); pz1 = Math.max(pz1, z);
      }
      const f = (a: number, b: number) => (Number.isFinite(a) ? `${cm(a).padStart(5)}..${cm(b).padStart(5)}` : '      --      ');
      console.log(`    y ${cm(y0).padStart(4)}-${cm(y0 + 0.02).padStart(4)}  gen x ${f(gx0, gx1)} z ${f(gz0, gz1)}   proxy x ${f(px0, px1)} z ${f(pz0, pz1)}`);
    }
  }
}
