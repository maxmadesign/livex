/**
 * Signed-distance modelling kit for the plush characters. Shapes are authored
 * in centimetres (y up, +z = the character's front, origin at the centre of the
 * base) and blended with smooth unions so the result reads as one stuffed,
 * sewn body instead of intersecting primitives.
 */

export type V3 = [number, number, number];
export type DistFn = (x: number, y: number, z: number) => number;

const DEG = Math.PI / 180;

/** Row-major 3×3 rotation from intrinsic XYZ Euler angles in degrees. */
export function eulerMatrix(rx: number, ry: number, rz: number): number[] {
  const cx = Math.cos(rx * DEG), sx = Math.sin(rx * DEG);
  const cy = Math.cos(ry * DEG), sy = Math.sin(ry * DEG);
  const cz = Math.cos(rz * DEG), sz = Math.sin(rz * DEG);
  // R = Rz · Ry · Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

export function applyMatrix(m: number[], v: V3): V3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

/** Wraps a distance function given in a local frame (centre + rotation). */
function inFrame(center: V3, rot: V3 | undefined, local: DistFn): DistFn {
  const [cx, cy, cz] = center;
  if (!rot || (rot[0] === 0 && rot[1] === 0 && rot[2] === 0)) {
    return (x, y, z) => local(x - cx, y - cy, z - cz);
  }
  const m = eulerMatrix(rot[0], rot[1], rot[2]);
  // Inverse rotation = transpose.
  return (x, y, z) => {
    const px = x - cx, py = y - cy, pz = z - cz;
    return local(m[0]! * px + m[3]! * py + m[6]! * pz, m[1]! * px + m[4]! * py + m[7]! * pz, m[2]! * px + m[5]! * py + m[8]! * pz);
  };
}

export function sphere(center: V3, r: number): DistFn {
  const [cx, cy, cz] = center;
  return (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;
}

/** Ellipsoid with radii (rx, ry, rz); a good first-order distance bound. */
export function ellipsoid(center: V3, radii: V3, rot?: V3): DistFn {
  const [rx, ry, rz] = radii;
  const minR = Math.min(rx, ry, rz);
  return inFrame(center, rot, (x, y, z) => {
    const ax = x / rx, ay = y / ry, az = z / rz;
    const k0 = Math.hypot(ax, ay, az);
    if (k0 < 1e-6) return -minR;
    const k1 = Math.hypot(ax / rx, ay / ry, az / rz);
    return (k0 * (k0 - 1)) / k1;
  });
}

/** Capsule / tapered capsule between two points with radii r1 (at a) and r2 (at b). */
export function roundCone(a: V3, b: V3, r1: number, r2: number = r1): DistFn {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  if (l2 < 1e-9) return sphere(a, Math.max(r1, r2));
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yy = pax * bax + pay * bay + paz * baz;
    const zz = yy - l2;
    const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
}

/** Box with half extents `half` and rounded edges of radius `round`. */
export function roundBox(center: V3, half: V3, round: number, rot?: V3): DistFn {
  const hx = Math.max(half[0] - round, 1e-4), hy = Math.max(half[1] - round, 1e-4), hz = Math.max(half[2] - round, 1e-4);
  return inFrame(center, rot, (x, y, z) => {
    const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - hz;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - round;
  });
}

/** Torus around the local Y axis: ring radius R, tube radius r. */
export function torus(center: V3, ringRadius: number, tubeRadius: number, rot?: V3): DistFn {
  return inFrame(center, rot, (x, y, z) => Math.hypot(Math.hypot(x, z) - ringRadius, y) - tubeRadius);
}

/** Cylinder along the local Y axis with rounded rims. */
export function roundCylinder(center: V3, radius: number, halfHeight: number, round: number, rot?: V3): DistFn {
  const r = Math.max(radius - round, 1e-4), h = Math.max(halfHeight - round, 1e-4);
  return inFrame(center, rot, (x, y, z) => {
    const dx = Math.hypot(x, z) - r, dy = Math.abs(y) - h;
    return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - round;
  });
}

/** Chain of tapered capsules through `points` (tails, tentacles, antennae, straps). */
export function tube(points: V3[], radii: number[] | number): DistFn {
  const segs: DistFn[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const r1 = typeof radii === 'number' ? radii : radii[Math.min(i, radii.length - 1)]!;
    const r2 = typeof radii === 'number' ? radii : radii[Math.min(i + 1, radii.length - 1)]!;
    segs.push(roundCone(points[i]!, points[i + 1]!, r1, r2));
  }
  return (x, y, z) => {
    let d = Infinity;
    for (const s of segs) {
      const v = s(x, y, z);
      if (v < d) d = v;
    }
    return d;
  };
}

/** Axis-aligned non-uniform scale of a shape about `center` (flattened ears, fins, petals). */
export function scaled(fn: DistFn, center: V3, scale: V3): DistFn {
  const minS = Math.min(scale[0], scale[1], scale[2]);
  const [cx, cy, cz] = center;
  return (x, y, z) => fn((x - cx) / scale[0] + cx, (y - cy) / scale[1] + cy, (z - cz) / scale[2] + cz) * minS;
}

/** Rotates a shape about `center` by intrinsic XYZ Euler angles in degrees. */
export function rotated(fn: DistFn, center: V3, rot: V3): DistFn {
  const m = eulerMatrix(rot[0], rot[1], rot[2]);
  const [cx, cy, cz] = center;
  return (x, y, z) => {
    const px = x - cx, py = y - cy, pz = z - cz;
    return fn(
      cx + m[0]! * px + m[3]! * py + m[6]! * pz,
      cy + m[1]! * px + m[4]! * py + m[7]! * pz,
      cz + m[2]! * px + m[5]! * py + m[8]! * pz,
    );
  };
}

export function mirrorX(fn: DistFn): DistFn {
  return (x, y, z) => fn(-x, y, z);
}

/** Polynomial smooth minimum: blends over a band of width k. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

/** Central-difference gradient (not normalised). */
export function gradient(fn: DistFn, x: number, y: number, z: number, eps: number, out: V3): V3 {
  out[0] = fn(x + eps, y, z) - fn(x - eps, y, z);
  out[1] = fn(x, y + eps, z) - fn(x, y - eps, z);
  out[2] = fn(x, y, z + eps) - fn(x, y, z - eps);
  return out;
}

/** Moves a point onto the zero set of `fn` along the gradient (a few Newton steps). */
export function projectToSurface(fn: DistFn, p: V3, eps: number, iterations = 6): V3 {
  const g: V3 = [0, 0, 0];
  let [x, y, z] = p;
  for (let i = 0; i < iterations; i++) {
    const d = fn(x, y, z);
    if (Math.abs(d) < 1e-5) break;
    gradient(fn, x, y, z, eps, g);
    const gl2 = (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) / (4 * eps * eps);
    if (gl2 < 1e-10) break;
    const s = d / gl2 / (2 * eps);
    x -= g[0] * s;
    y -= g[1] * s;
    z -= g[2] * s;
  }
  return [x, y, z];
}

export function unitNormal(fn: DistFn, x: number, y: number, z: number, eps: number): V3 {
  const g: V3 = [0, 0, 0];
  gradient(fn, x, y, z, eps, g);
  const l = Math.hypot(g[0], g[1], g[2]) || 1;
  return [g[0] / l, g[1] / l, g[2] / l];
}
