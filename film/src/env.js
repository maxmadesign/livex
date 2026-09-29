// Environments are photographed "out of focus": real cinematography language
// (shallow depth of field) lets procedural light read as a real place.
// Everything is seeded, so every render is identical.
import { el, css, rng, lerp, clamp, noise1, W, H } from './engine.js';

// ---------------------------------------------------------------- bokeh sprites
const spriteCache = new Map();
function bokehSprite(size, { rim = 0.35, soft = 0.18 } = {}) {
  const key = `${size}|${rim}|${soft}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1 - soft - 0.12, `rgba(255,255,255,${0.62 + rim * 0.2})`);
  grad.addColorStop(1 - soft, `rgba(255,255,255,${0.7 + rim * 0.3})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  spriteCache.set(key, c); return c;
}
function tinted(sprite, color) {
  const key = sprite.width + color;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = sprite.width;
  const g = c.getContext('2d'); g.drawImage(sprite, 0, 0);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  spriteCache.set(key, c); return c;
}

// A field of defocused practical lights. opts.palette: array of css colours.
// Each light has depth z (0 = far, 1 = near): near lights are bigger, softer, move more.
export function Bokeh(parent, { seed = 1, count = 70, palette = ['#ffd2a0'], size = [30, 180], area = [-200, -200, W + 200, H + 200], alpha = [0.08, 0.35], band = null, twinkle = 0.15 } = {}) {
  const cv = el('canvas', 'fill', parent); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const r = rng(seed);
  const base = bokehSprite(256);
  const lights = Array.from({ length: count }, () => {
    const z = r();
    let y = lerp(area[1], area[3], r());
    if (band) y = lerp(band[0], band[1], r() ** 1.2); // clustered horizon band
    return { x: lerp(area[0], area[2], r()), y, z, s: lerp(size[0], size[1], z ** 1.6), a: lerp(alpha[0], alpha[1], r()), c: palette[Math.floor(r() * palette.length)], ph: r() * 10, sp: 0.2 + r() };
  });
  lights.sort((a, b) => a.z - b.z);
  return {
    el: cv,
    // cam: {x, y, zoom} parallax camera; drift: px/sec horizontal drift of the world
    draw(t, { camX = 0, camY = 0, zoom = 1, gain = 1, drift = 0 } = {}) {
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (const L of lights) {
        const par = 0.3 + L.z * 0.9;
        const x = (L.x - camX * par + drift * t * par - W / 2) * zoom + W / 2;
        const y = (L.y - camY * par - H / 2) * zoom + H / 2;
        const s = L.s * (0.8 + zoom * 0.2);
        if (x < -s || x > W + s || y < -s || y > H + s) continue;
        const tw = 1 - twinkle + twinkle * noise1(t * L.sp + L.ph, 7);
        g.globalAlpha = clamp(L.a * tw * gain);
        g.drawImage(tinted(base, L.c), x - s / 2, y - s / 2, s, s);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    },
  };
}

// Soft passers-by in the foreground: huge, black, heavily defocused shapes that
// cross frame. They sell "real public space" more than any detail could.
export function Passersby(parent, { seed = 3, count = 3, blur = 38, opacity = 0.9 } = {}) {
  const r = rng(seed);
  const people = Array.from({ length: count }, (_, i) => {
    const d = el('div', 'abs', parent);
    const h = lerp(900, 1500, r());
    css(d, { width: h * 0.34 + 'px', height: h + 'px', filter: `blur(${blur}px)`, opacity });
    d.innerHTML = `<svg viewBox="0 0 34 100" width="100%" height="100%" preserveAspectRatio="none"><g fill="#040506">
      <ellipse cx="17" cy="9" rx="6.2" ry="7.5"/><path d="M5 22 Q17 15 29 22 L31 58 Q31 62 28 62 L27 100 L7 100 L6 62 Q3 62 3 58 Z"/></g></svg>`;
    return { d, h, dir: r() > 0.5 ? 1 : -1, speed: lerp(260, 520, r()), off: r() * 1.5, y: lerp(0.1, 0.35, r()) };
  });
  return {
    // p0..p1 windows are set per scene; `t` local seconds
    draw(t, { active = true, start = 0 } = {}) {
      people.forEach((P, i) => {
        const tt = t - start - P.off - i * 0.9;
        const x = P.dir > 0 ? -P.h * 0.4 + tt * P.speed : W + P.h * 0.05 - tt * P.speed;
        P.d.style.display = active ? 'block' : 'none';
        P.d.style.transform = `translate(${x}px, ${H * P.y}px)`;
      });
    },
  };
}

// Volumetric light: a few angled soft shafts (window light / skylight).
export function Shafts(parent, { angle = -18, color = 'rgba(255,236,210,0.10)', count = 4, seed = 5, x0 = 200, spread = 1400 } = {}) {
  const r = rng(seed);
  const wrap = el('div', 'layer', parent);
  css(wrap, { mixBlendMode: 'screen' });
  const bars = Array.from({ length: count }, () => {
    const b = el('div', 'abs', wrap);
    const w = lerp(90, 320, r());
    css(b, { width: w + 'px', height: '2200px', left: x0 + r() * spread + 'px', top: '-500px', background: `linear-gradient(180deg, ${color}, rgba(0,0,0,0) 80%)`, transform: `rotate(${angle}deg)`, filter: 'blur(40px)', opacity: lerp(0.5, 1, r()) });
    return b;
  });
  return { el: wrap, bars };
}

// ---------------------------------------------------------------- the city
// A night city seen from altitude, built the way a city is actually seen at night:
// not as lines, but as millions of lights. Streetlight dots trace the grids of
// rotated districts, lit windows fill the blocks, arterials and a ring road glow,
// a river and parks stay dark. A bloom pass gives the sodium haze.
// Pre-rendered once; scenes fly over it with a CSS 3D camera (true perspective).
export function CityLights({ seed = 42, size = 4096 } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = '#020305'; g.fillRect(0, 0, size, size);
  const C = size / 2;

  const districts = Array.from({ length: 34 }, () => ({ x: r() * size, y: r() * size, a: (r() - 0.5) * 1.1, pu: lerp(34, 60, r()), pv: lerp(40, 80, r()), led: r() < 0.35 }));
  const nearest = (x, y) => { let b = districts[0], bd = 1e18; for (const d of districts) { const dd = (d.x - x) ** 2 + (d.y - y) ** 2; if (dd < bd) { bd = dd; b = d; } } return b; };
  const riverY = x => size * 0.6 + Math.sin(x / size * 4.6 + 1.3) * size * 0.06 + Math.sin(x / size * 11 + 0.4) * size * 0.012;
  const inRiver = (x, y) => Math.abs(y - riverY(x)) < size * 0.022;
  const parks = Array.from({ length: 9 }, () => ({ x: lerp(0.15, 0.85, r()) * size, y: lerp(0.15, 0.85, r()) * size, rx: lerp(40, 120, r()), ry: lerp(30, 90, r()), a: r() * 3 }));
  const inPark = (x, y) => parks.some(p => { const dx = x - p.x, dy = y - p.y, ca = Math.cos(p.a), sa = Math.sin(p.a); const u = (dx * ca + dy * sa) / p.rx, v = (-dx * sa + dy * ca) / p.ry; return u * u + v * v < 1; });
  const dens = (x, y) => { const d = Math.hypot(x - C * 0.96, y - C * 0.9) / C; return clamp(1.15 - d * 0.95) * (0.75 + 0.25 * noise1(x / 300 + y / 470, 5)); };
  const core = (x, y) => clamp(1 - Math.hypot(x - C * 0.96, y - C * 0.9) / (size * 0.13));

  g.globalCompositeOperation = 'lighter';
  const dot = (x, y, s, col) => { g.fillStyle = col; g.fillRect(x - s / 2, y - s / 2, s, s); };

  // 1) blocks of lit windows + streetlight chains, district by district (sampled on a lattice)
  const step = 3.2;
  for (let y = 0; y < size; y += step) for (let x = 0; x < size; x += step) {
    const jx = x + (r() - 0.5) * step, jy = y + (r() - 0.5) * step;
    if (inRiver(jx, jy) || inPark(jx, jy)) continue;
    const f = dens(jx, jy); if (f <= 0.02) continue;
    const d = nearest(jx, jy), ca = Math.cos(d.a), sa = Math.sin(d.a);
    const u = jx * ca + jy * sa, v = -jx * sa + jy * ca;
    const fu = ((u % d.pu) + d.pu) % d.pu, fv = ((v % d.pv) + d.pv) % d.pv;
    const onStreetU = fu < 3.2, onStreetV = fv < 3.2;
    if (onStreetU || onStreetV) {
      if (r() < 0.55 * f + 0.05) {
        const col = d.led ? `rgba(225,235,255,${(0.3 + r() * 0.45) * (0.4 + f)})` : `rgba(255,${150 + r() * 45 | 0},${60 + r() * 40 | 0},${(0.4 + r() * 0.45) * (0.4 + f)})`;
        dot(jx, jy, lerp(1.3, 2.3, r()), col);
      }
    } else if (r() < f * (0.22 + core(jx, jy) * 0.45)) {
      const w = r() < 0.3 + core(jx, jy) * 0.5;
      dot(jx, jy, lerp(0.8, 1.6, r()), w ? `rgba(240,244,255,${0.1 + r() * 0.35})` : `rgba(255,200,140,${0.08 + r() * 0.3})`);
    }
  }
  // 2) arterials, ring road, bridges — continuous ribbons with car-light streaks
  const road = (pts, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); };
  const arts = [];
  for (let k = 0; k < 9; k++) {
    // enter from one edge, wander across, leave from another
    const side = k % 4; let x, y, a;
    if (side === 0) { x = -50; y = r() * size; a = (r() - 0.5) * 0.7; }
    else if (side === 1) { x = size + 50; y = r() * size; a = Math.PI + (r() - 0.5) * 0.7; }
    else if (side === 2) { x = r() * size; y = -50; a = Math.PI / 2 + (r() - 0.5) * 0.7; }
    else { x = r() * size; y = size + 50; a = -Math.PI / 2 + (r() - 0.5) * 0.7; }
    const pts = [];
    for (let s = 0; s < 240; s++) { a += (r() - 0.5) * 0.05; x += Math.cos(a) * 22; y += Math.sin(a) * 22; pts.push([x, y]); }
    arts.push(pts);
    road(pts, 7, 'rgba(255,160,70,0.035)');
    for (let i = 1; i < pts.length; i++) for (let q = 0; q < 1; q += 0.25) { const x = lerp(pts[i - 1][0], pts[i][0], q), y = lerp(pts[i - 1][1], pts[i][1], q); if (!inRiver(x, y)) dot(x + (r() - 0.5) * 2, y + (r() - 0.5) * 2, 2.2, `rgba(255,${185 + r() * 30 | 0},110,${0.35 + r() * 0.35})`); }
  }
  for (const pts of arts) for (let i = 0; i < 260; i++) { const p = pts[Math.floor(r() * pts.length)]; dot(p[0] + (r() - 0.5) * 3, p[1] + (r() - 0.5) * 3, 1.6, r() < 0.5 ? 'rgba(255,245,235,0.9)' : 'rgba(255,70,50,0.8)'); }
  // 3) river: faint reflections
  for (let i = 0; i < 2600; i++) { const x = r() * size, y = riverY(x) + (r() - 0.5) * size * 0.04; g.fillStyle = `rgba(255,200,150,${r() * 0.06})`; g.fillRect(x, y, lerp(6, 30, r()), 1.2); }

  // 4) bloom: blurred copy added on top (the sodium haze of a real night city)
  const b = document.createElement('canvas'); b.width = b.height = size / 4;
  const bg = b.getContext('2d'); bg.filter = 'blur(3px)'; bg.drawImage(c, 0, 0, size / 4, size / 4);
  g.globalAlpha = 1.0; g.drawImage(b, 0, 0, size, size);
  const b2 = document.createElement('canvas'); b2.width = b2.height = size / 16;
  const bg2 = b2.getContext('2d'); bg2.filter = 'blur(2px)'; bg2.drawImage(c, 0, 0, size / 16, size / 16);
  g.globalAlpha = 0.8; g.drawImage(b2, 0, 0, size, size);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  return { canvas: c, size, riverY, inRiver, inPark, dens, centre: [C * 0.96, C * 0.9] };
}

// Project a point on a CSS-3D-transformed plane to screen space (matches the browser).
export function projector(transform, originX, originY) {
  const m = new DOMMatrix(transform);
  return (x, y) => {
    const p = m.transformPoint(new DOMPoint(x - originX, y - originY, 0, 1));
    return [p.x / p.w + originX, p.y / p.w + originY, p.w];
  };
}

// ---------------------------------------------------------------- point lights in 3D
// Physically-flavoured bokeh: each light has a world position (cm). Its disc size is
// the circle of confusion for the current camera focus; intensity is conserved, so
// defocused lights get bigger and dimmer, exactly like glass. Drawn to one canvas.
export function PointLights(parent, space, points, { base = 3, gain = 1, maxCoc = 140, bloom = 0.35 } = {}) {
  const cv = el('canvas', 'fill', parent); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const sprite = bokehSprite(256, { rim: 0.4, soft: 0.14 });
  const core = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return c; })();
  return {
    el: cv, points,
    draw(t = 0, { fade = 1 } = {}) {
      const c = space.cam;
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (const p of points) {
        const d = p.z - c.z; if (d <= 5) continue;
        const [sx, sy, k] = space.project(p.x, p.y, p.z);
        const coc = Math.min(maxCoc, (c.aperture || 0) * Math.abs(1 / (c.focus || d) - 1 / d) * space.F);
        const r = Math.max(base * Math.sqrt(k), 0.8) + coc;
        if (sx < -r || sx > W + r || sy < -r || sy > H + r) continue;
        const I = (p.i ?? 1) * gain * fade * (p.flicker ? 1 - p.flicker * noise1(t * 3 + p.x, 9) : 1) * (p.on != null ? clamp((t - p.on) / 0.1) : 1);
        if (I <= 0.001) continue;
        const a = clamp(I * Math.min(1, (14 / r) ** 1.05));
        g.globalAlpha = a;
        g.drawImage(tinted(sprite, p.c || '#ffe2c0'), sx - r, sy - r, r * 2, r * 2);
        if (bloom && coc < 6) { g.globalAlpha = clamp(I * bloom); const br = r * 5; g.drawImage(tinted(core, p.c || '#ffe2c0'), sx - br, sy - br, br * 2, br * 2); }
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    },
  };
}

// Helpers to lay out practical lights in architecture (all in cm, y up is negative).
export function lightGrid({ x0, x1, z0, z1, nx, nz, y = -320, c = '#ffe0b8', i = 1, jitter = 0, seed = 1 }) {
  const r = rng(seed), pts = [];
  for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
    pts.push({ x: lerp(x0, x1, nx > 1 ? a / (nx - 1) : 0.5) + (r() - 0.5) * jitter, y, z: lerp(z0, z1, nz > 1 ? b / (nz - 1) : 0.5) + (r() - 0.5) * jitter, c, i });
  }
  return pts;
}
// Mirror lights in a polished floor (y = 0): reflected below, dimmer.
export function reflectLights(pts, k = 0.35) { return pts.map(p => ({ ...p, y: -p.y, i: (p.i ?? 1) * k })); }
