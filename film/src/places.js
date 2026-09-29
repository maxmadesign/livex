// The seven kinds of place where life happens — each a small, real-feeling set:
// its own light (colour temperature, practicals, time of day), the right LiveX
// node installed the right way, and Lyra doing the one job that place needs.
import { el, css, rng, kf, E, clamp, inv, lerp, W, H } from './engine.js';
import { Space, StagedDevice } from './space.js';
import { PointLights, lightGrid, reflectLights, Passersby } from './env.js';
import { LyraScreen, Card, RouteMap, Caption, Voice } from './ui.js';
import { Slug } from './titles.js';

const plan = {
  hospital: `<path d="M40 60 H900 M40 200 H560 M640 200 H900 M40 340 H900 M560 200 V60 M640 200 V340 M300 60 V200 M300 200 V340"/><rect x="820" y="90" width="60" height="80" rx="6"/><rect x="60" y="230" width="120" height="80" rx="6"/>`,
  campus: `<path d="M40 330 C220 330 260 150 470 150 S760 90 900 90"/><path d="M40 90 C300 120 520 300 900 300" opacity=".6"/><rect x="760" y="40" width="120" height="90" rx="10"/><rect x="80" y="250" width="150" height="100" rx="10"/><circle cx="480" cy="250" r="44"/>`,
};

export const PLACES = {
  retail: {
    slug: 'RETAIL', venue: 'Maison Nord · Flagship', clock: '18:42', device: 'gateway', lift: 0,
    bg: 'linear-gradient(180deg, #1f1a16 0%, #2c241d 50%, #120e0b 100%)',
    lights: R => [...lightGrid({ x0: -800, x1: 800, z0: 200, z1: 1600, nx: 5, nz: 5, y: -330, c: '#fff0dc', i: 0.7, seed: 3 }),
      ...[-110, -60, -10].flatMap((y, j) => [...linearLight(-900, -300, y - 40, 700 + j * 30, 26, '#fff3e2', 0.18), ...linearLight(300, 900, y - 40, 760 + j * 30, 26, '#fff3e2', 0.18)])],
    reflect: 0.5, cam: { z: -330, y: -128, x: 40 },
    ui(os) {
      return Card(os, { top: 1250, rows: [
        `<div class="eyebrow">Picked for you · 3 left</div>`,
        `<h3>Cashmere scarf, oat</h3>`,
        `<p>Soft enough for a first winter.</p>`,
        `<div class="row" style="margin-top:22px"><div class="row" style="gap:14px"><span style="width:44px;height:44px;border-radius:50%;background:#d9c7ab;box-shadow:inset 0 0 0 3px #fff, 0 0 0 2px #0d1117"></span><span style="width:44px;height:44px;border-radius:50%;background:#3a3f47"></span><span style="width:44px;height:44px;border-radius:50%;background:#2f5bea"></span></div><span class="chip accent">Aisle 2 →</span></div>`] });
    },
  },
  hotel: {
    slug: 'HOTEL', venue: 'Aurelia · Lobby', clock: '18:44', device: 'gateway', lift: 0,
    bg: 'linear-gradient(180deg, #140e0a 0%, #22170f 55%, #0b0806 100%)',
    lights: R => [...Array.from({ length: 9 }, () => ({ x: -700 + R() * 500, y: -230 - R() * 120, z: 700 + R() * 500, c: '#ffc27a', i: 0.9 })),
      ...lightGrid({ x0: -900, x1: 900, z0: 300, z1: 2400, nx: 4, nz: 7, y: -380, c: '#ffd9a8', i: 0.6, seed: 5 }),
      ...Array.from({ length: 60 }, () => ({ x: -2400 + R() * 4800, y: -80 - R() * 600, z: 3000 + R() * 1200, c: R() < 0.7 ? '#ffcf9a' : '#dfe8ff', i: 0.5 }))],
    reflect: 0.45, cam: { z: -320, y: -132, x: -30 },
    ui(os) {
      return Card(os, { top: 1270, rows: [`<div class="eyebrow">Welcome back</div>`, `<h3>Room 1204 is ready.</h3>`, `<p>Your key is on your phone. The rooftop is quiet until eight.</p>`] });
    },
  },
  hospital: {
    slug: 'HOSPITAL', venue: 'St. Aurelia · Level 1', clock: '18:43', device: 'portal55', lift: 92, halo: 1,
    bg: 'linear-gradient(180deg, #0c1214 0%, #16201f 50%, #0a0e0f 100%)', wall: 'linear-gradient(180deg, #273030, #1a2121)',
    dress: { scallops: 9, spacing: 120, color: 'rgba(225,240,255,0.28)' }, wallEnd: 125,
    lights: R => [...lightGrid({ x0: 230, x1: 470, z0: 60, z1: 2600, nx: 2, nz: 12, y: -290, c: '#e8f4ff', i: 0.9, seed: 7 }),
      { x: 350, y: -140, z: 2800, c: '#dff0ff', i: 1.4 }, { x: 300, y: -150, z: 2820, c: '#dff0ff', i: 1.2 }],
    reflect: 0.3, cam: { z: -230, y: -150, x: 90 },
    ui(os) {
      const m = RouteMap(os, { top: 1180, height: 380, plan: plan.hospital, route: 'M120 270 H470 V130 H850', dest: `<div style="position:absolute;left:40px;bottom:30px;font:600 40px var(--sans);letter-spacing:-.02em">Maternity · Level 6<div style="font:400 26px var(--sans);color:var(--ui-ink-2);margin-top:6px">Elevator B · 2 min</div></div>` });
      return { update: (p, out) => m.update(p, clamp((p - 0.25) * 1.4), out) };
    },
  },
  campus: {
    slug: 'CAMPUS', venue: 'North Campus · Hall C', clock: '18:45', device: 'portal43', lift: 105, halo: 0.8,
    bg: 'linear-gradient(180deg, #121813 0%, #1c241d 50%, #0b0f0c 100%)', wall: 'linear-gradient(180deg, #2e312a, #1d201b)',
    dress: { scallops: 7, spacing: 130, color: 'rgba(255,244,222,0.26)' }, wallEnd: 110,
    lights: R => [...Array.from({ length: 40 }, () => ({ x: 200 + R() * 1200, y: -60 - R() * 420, z: 1400 + R() * 1400, c: R() < 0.6 ? '#e9f3d8' : '#fff4de', i: 0.55 + R() * 0.4 })),
      ...lightGrid({ x0: 200, x1: 420, z0: 80, z1: 1400, nx: 2, nz: 6, y: -300, c: '#fff1dc', i: 0.7, seed: 8 })],
    reflect: 0.3, cam: { z: -210, y: -150, x: 80 },
    ui(os) {
      const m = RouteMap(os, { top: 1180, height: 380, plan: plan.campus, route: 'M150 300 C300 300 330 170 480 170 S700 120 820 110', dest: `<div style="position:absolute;left:40px;bottom:30px;font:600 40px var(--sans);letter-spacing:-.02em">Hall C · Room 204<div style="font:400 26px var(--sans);color:var(--ui-ink-2);margin-top:6px">Starts 18:50 · 4 min walk</div></div>` });
      return { update: (p, out) => m.update(p, clamp((p - 0.25) * 1.4), out) };
    },
  },
  stadium: {
    slug: 'STADIUM', venue: 'Riverside Arena · Gate 14', clock: '18:46', device: 'paragon', lift: 0,
    bg: 'linear-gradient(180deg, #05070b 0%, #0b0f16 55%, #050608 100%)',
    lights: R => [...[-1900, -600, 700, 2000].flatMap((bx, b) => Array.from({ length: 12 }, (_, k) => ({ x: bx + (k % 4) * 40, y: -1150 - Math.floor(k / 4) * 40 - (b % 2) * 90, z: 4400, c: '#f4f8ff', i: 0.45 }))),
      ...Array.from({ length: 90 }, () => ({ x: -1500 + R() * 3000, y: -40 - R() * 260, z: 900 + R() * 1400, c: R() < 0.5 ? '#ffffff' : '#ffd8a0', i: 0.35 + R() * 0.4 }))],
    reflect: 0.2, cam: { z: -380, y: -140, x: 30 }, crowd: true, photo: 'black', mode: 'dark',
    ui(os) {
      return Card(os, { top: 1250, rows: [`<div class="eyebrow">Gate 14 · Kick-off 19:45</div>`, `<div class="row" style="align-items:flex-end;margin-top:14px"><div class="metric">212<small>Section</small></div><div class="metric" style="font-size:64px">F·9<small>Row·Seat</small></div></div>`, `<p>Stairs to your left. Enjoy the match.</p>`] });
    },
  },
  corporate: {
    slug: 'CORPORATE', venue: 'Halden Tower · Lobby', clock: '18:47', device: 'gateway', lift: 0,
    bg: 'linear-gradient(180deg, #0a0e13 0%, #121a22 55%, #07090c 100%)',
    lights: R => [...lightGrid({ x0: -900, x1: 900, z0: 200, z1: 2000, nx: 6, nz: 5, y: -420, c: '#eef4ff', i: 0.6, seed: 9 }),
      ...Array.from({ length: 120 }, () => ({ x: -2600 + R() * 5200, y: -100 - R() * 900, z: 3500 + R() * 1500, c: R() < 0.5 ? '#dfe8ff' : '#ffd9a8', i: 0.45 }))],
    reflect: 0.5, cam: { z: -330, y: -130, x: -40 },
    ui(os) {
      return Card(os, { top: 1270, rows: [`<div class="eyebrow">Visitor · Atlas Room · Floor 18</div>`, `<h3>Your host is on the way down.</h3>`, `<div class="row" style="margin-top:22px"><span class="chip">Pass ready</span><span class="chip accent">Lift 3 →</span></div>`] });
    },
  },
  plaza: {
    slug: 'OUTDOOR PLAZA', venue: 'Riverfront Plaza', clock: '18:48', device: 'paragon', lift: 0,
    bg: 'linear-gradient(180deg, #0d1a33 0%, #2a3350 38%, #6b5a5a 58%, #1a1414 60%, #0c0a0a 100%)',
    lights: R => [...Array.from({ length: 70 }, () => ({ x: -2600 + R() * 5200, y: -30 - R() * 260, z: 1800 + R() * 2400, c: R() < 0.75 ? '#ffc98a' : '#e5ecff', i: 0.5 + R() * 0.5 })),
      ...Array.from({ length: 12 }, (_, i) => ({ x: -1400 + i * 260, y: -420, z: 900 + (i % 3) * 200, c: '#ffd29a', i: 0.8 }))],
    reflect: 0.35, cam: { z: -390, y: -140, x: 60 }, crowd: true, photo: 'black', mode: 'dark',
    ui(os) {
      return Card(os, { top: 1240, rows: [`<div class="eyebrow">Tonight on the river</div>`, `<h3>Riverfront Lights, 20:00</h3>`, `<div class="hair"></div>`, `<div class="row"><span style="font:500 30px var(--sans)">18° clear</span><span style="font:500 30px var(--sans)">Line 2 · 3 min</span></div>`] });
    },
  },
};

// Architectural light on a wall: downlight scallops + an opening with light beyond.
function dressWall(wall, { scallops = 7, color = 'rgba(255,240,220,0.22)', door = null, spacing = 300 } = {}) {
  for (let i = 0; i < scallops; i++) {
    const x = 2000 + (i - (scallops - 1) / 2) * spacing;
    const sc = el('div', 'abs', wall);
    css(sc, { left: x - 45 + 'px', top: 1400 - 330 + 'px', width: '90px', height: '230px', background: `radial-gradient(50% 75% at 50% 0%, ${color}, rgba(0,0,0,0) 100%)`, filter: 'blur(3px)' });
  }
  if (door) {
    const d = el('div', 'abs', wall);
    css(d, { left: 2000 + door.x - door.w / 2 + 'px', top: 1400 - door.h + 'px', width: door.w + 'px', height: door.h + 'px', background: door.fill, boxShadow: 'inset 0 0 0 10px rgba(0,0,0,0.35)' });
  }
}
function linearLight(x0, x1, y, z, n, c, i) { return Array.from({ length: n }, (_, k) => ({ x: lerp(x0, x1, k / (n - 1)), y, z, c, i })); }

// A place vignette. opts: { t0: when the UI starts arriving (s), dur, push, caption }
export function PlaceShot(root, kind, { slugAt = 0.1, uiAt = 0.15, push = 0.08, drift = 30, caption = null, slug = true, aperture = 16, centre = false, tight = 1 } = {}) {
  const P = PLACES[kind];
  const R = rng(kind.length * 97 + 13);
  css(root, { background: P.bg });
  const sp = new Space(root, { F: 1150 });
  if (P.wall) {
    const end = P.wallEnd ?? 2000;          // the wall stops here: beyond it, a corridor recedes
    const wall = el('div', 'abs'); css(wall, { width: 2000 + end + 'px', height: '1400px', background: P.wall, overflow: 'hidden', boxShadow: 'inset -14px 0 18px -8px rgba(255,255,255,0.12)' });
    dressWall(wall, P.dress || {});
    sp.add(wall, { x: 0, y: 0, z: 4, pxPerCm: 1, ox: 2000, oy: 1400, dof: false });
    const fl = el('div', 'abs'); css(fl, { width: '4000px', height: '900px', background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(0,0,0,0.0) 30%), linear-gradient(180deg, #0d1111, #050707)' });
    sp.add(fl, { x: 0, y: 0, z: 3.5, pxPerCm: 1, ox: 2000, oy: 0, dof: false });
  }
  const pts = P.lights(R);
  const pl = PointLights(root, sp, [...pts, ...(P.reflect ? reflectLights(pts, P.reflect * 0.5) : [])], { base: 2.2 });
  root.insertBefore(pl.el, sp.root);
  const dev = StagedDevice(sp, P.device, { x: 0, z: 0, lift: P.lift || 0, halo: P.halo || 0, reflect: P.reflect ? 0.14 : 0 });
  const ui = LyraScreen(dev.screen, { place: P.venue, clock: P.clock, mode: P.mode || 'light', photo: P.photo || 'white' });
  if (P.mode === 'dark') ui.os.classList.add('dark');
  const card = P.ui(ui.content);
  const cap = caption ? Caption(ui.content, caption, { top: 1060 }) : null;
  const pass = P.crowd ? Passersby(root, { seed: kind.length, count: 2, blur: 40 }) : null;
  const sl = slug ? Slug(root, { text: P.slug, sub: P.venue.toUpperCase(), x: 96, y: 960 }) : null;
  return {
    P, sp, dev, ui, card,
    update(t, dur = 2) {
      const k = clamp(t / dur);
      const c = P.cam, cz = c.z * tight, cx = centre ? (P.lift ? 0 : 0) : c.x;
      sp.pose({ x: cx + drift * (k - 0.5), y: c.y, z: cz * (1 - push * E.cine(k)), focus: -cz * (1 - push * E.cine(k)), aperture });
      pl.draw(t);
      ui.idle(t); ui.statusIn(1);
      card.update(clamp((t - uiAt) / 0.9), 0);
      if (cap) cap.update(clamp((t - uiAt) / 1.2));
      if (pass) pass.draw(t, { start: -0.4 });
      if (sl) sl.update(clamp((t - slugAt) / 0.7));
    },
  };
}
