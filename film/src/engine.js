// LiveX AI City — deterministic motion engine.
// Every pixel on screen is a pure function of time t (seconds). No CSS transitions,
// no requestAnimationFrame clocks: the renderer asks for frame t, we pose the world.

export const W = 1920, H = 1080;

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, x) => (b === a ? (x >= b ? 1 : 0) : clamp((x - a) / (b - a)));
export const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

// Cubic-bezier easing (same maths as CSS timing functions).
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t;
  const sy = t => ((ay * t + by) * t + cy) * t;
  const dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = sx(t) - x, d = dx(t); if (Math.abs(e) < 1e-6 || !d) break; t -= e / d; }
    let lo = 0, hi = 1;
    for (let i = 0; i < 30 && Math.abs(sx(t) - x) > 1e-6; i++) { if (sx(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return sy(t);
  };
}

// The film's easing vocabulary. Named by intent, not by curve.
export const E = {
  linear: x => x,
  glide: bezier(0.16, 1, 0.3, 1),      // UI arrivals: fast in, long settle
  settle: bezier(0.22, 1, 0.36, 1),    // cards, text
  cine: bezier(0.65, 0, 0.35, 1),      // camera moves, symmetric
  crane: bezier(0.45, 0, 0.1, 1),      // big pull-backs: slow start, long float
  push: bezier(0.7, 0, 0.84, 0),       // accelerate into a cut
  exit: bezier(0.5, 0, 0.75, 0),       // leaves
  snap: bezier(0.2, 0.9, 0.1, 1),      // micro-interactions
  breathe: x => 0.5 - 0.5 * Math.cos(Math.PI * 2 * x),
};

export function tw(t, t0, t1, a, b, ease = E.cine) { return lerp(a, b, ease(inv(t0, t1, t))); }

// Keyframes: [[time, value, easeIntoThisKey?], ...]
export function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const k = (e || E.cine)(inv(t0, t1, t));
      return Array.isArray(v0) ? v0.map((v, j) => lerp(v, v1[j], k)) : lerp(v0, v1, k);
    }
  }
  return keys[keys.length - 1][1];
}

// Seeded PRNG (mulberry32) — identical grain, bokeh and cities on every render.
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function noise1(x, seed = 1) { // smooth value noise, 1D
  const i = Math.floor(x), f = x - i, h = n => { const r = rng((n * 374761393 + seed * 668265263) >>> 0); return r(); };
  const u = f * f * (3 - 2 * f); return lerp(h(i), h(i + 1), u);
}

// DOM helpers
export function el(tag, cls, parent, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  if (parent) parent.appendChild(n);
  return n;
}
export function css(n, o) { for (const k in o) { if (k.startsWith('--')) n.style.setProperty(k, o[k]); else n.style[k] = o[k]; } return n; }
export const px = v => `${v}px`;

// Reveal helper used everywhere in the UI system: blur + rise + fade, driven by p in [0,1].
export function reveal(n, p, { y = 14, blur = 10, scale = 0.985 } = {}) {
  const q = clamp(p);
  n.style.opacity = q;
  n.style.transform = `translate3d(0, ${(1 - q) * y}px, 0) scale(${lerp(scale, 1, q)})`;
  n.style.filter = q >= 0.999 ? 'none' : `blur(${(1 - q) * blur}px)`;
}

// Planar homography: rect (0,0,w,h) -> quad [tl,tr,br,bl]. Returns CSS matrix3d().
export function quadMatrix(w, h, q) {
  const [p0, p1, p2, p3] = q; // tl tr br bl
  const src = [[0, 0], [w, 0], [w, h], [0, h]], dst = [p0, p1, p2, p3];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const [a, bb, c, d, e, f, g, hh] = b.map((v, i) => v / A[i][i]);
  return `matrix3d(${a},${d},0,${g},${bb},${e},0,${hh},0,0,1,0,${c},${f},0,1)`;
}

// ---------------------------------------------------------------- Film / scenes
export class Film {
  constructor(stage, { fps = 30, duration = 60 } = {}) {
    this.stage = stage; this.fps = fps; this.duration = duration; this.scenes = []; this.post = [];
  }
  add(scene) { this.scenes.push(scene); return scene; }
  addPost(fn) { this.post.push(fn); }
  build() {
    for (const s of this.scenes) {
      s.root = el('div', 'scene', this.stage);
      s.root.dataset.id = s.id;
      css(s.root, { zIndex: s.z ?? 1 });
      s.build(s.root);
    }
  }
  render(t) {
    for (const s of this.scenes) {
      const on = t >= s.t0 && t < s.t1;
      s.root.style.display = on ? 'block' : 'none';
      if (on) s.update(t - s.t0, t);
    }
    for (const p of this.post) p(t);
  }
}

// Wait until every <img> in the stage is decoded (render determinism).
export async function imagesReady(root = document) {
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(imgs.map(i => (i.complete && i.naturalWidth) ? i.decode().catch(() => {}) : new Promise(r => { i.onload = () => i.decode().then(r, r); i.onerror = r; })));
}
export function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
