// 42–52  CITY — 07 Harbour Depot (Paragon Outdoor by the 1978 clock tower, rain),
// the brand on the back of the node, the split-flap rewind 07 -> 01, the four upstream
// stops (centre-locked), Gate C.
import { el, css, kf, E, clamp, inv, lerp, rng, W, H } from './engine.js';
import { Space, StagedDevice, frameScreen } from './space.js';
import { PointLights, reflectLights, lightGrid } from './env.js';
import { LyraScreen } from './ui.js';
import { StopCard, Subtitle, Chen, Rain, ClockTower, SplitFlap } from './route7.js';

const PLAZA_BG = 'linear-gradient(180deg, #0e1a33 0%, #1d2a48 34%, #3b4460 50%, #141820 52%, #0b0d12 100%)';

function plazaLights(R) {
  const city = Array.from({ length: 90 }, () => ({ x: -3200 + R() * 6400, y: -40 - R() * 520, z: 2600 + R() * 2600, c: R() < 0.7 ? '#ffc98a' : '#e5ecff', i: 0.5 + R() * 0.5 }));
  // the stadium beyond the plaza: a low cool glow on the horizon, not a shape
  const stadium = Array.from({ length: 18 }, () => ({ x: 600 + R() * 2600, y: -300 - R() * 300, z: 6500, c: '#eef3ff', i: 0.35 }));
  const lamps = Array.from({ length: 10 }, (_, i) => ({ x: -1500 + i * 330, y: -420, z: 700 + (i % 3) * 300, c: '#ffd29a', i: 0.9 }));
  return [...city, ...stadium, ...lamps];
}

// ------------------------------------------------------------ 42.0–46.5  07 · Harbour Depot
export const plaza = {
  id: 'plaza', t0: 42.0, t1: 46.5,
  build(root) {
    css(root, { background: PLAZA_BG });
    const sp = this.sp = new Space(root, { F: 1150 });
    const R = rng(81);
    const pts = plazaLights(R);
    this.pl = PointLights(root, sp, [...pts, ...reflectLights(pts, 0.55)], { base: 2 });
    root.insertBefore(this.pl.el, sp.root);
    this.tower = ClockTower(root, { hCm: 820 });
    sp.add(this.tower.el, { x: -380, y: 0, z: 520, pxPerCm: 1, ox: 180, oy: 820 });
    // wet granite: a mirrored tower glow
    this.dev = StagedDevice(sp, 'paragon', { x: 110, z: 0, reflect: 0.42, glow: 0.5, spill: 0.4 });
    this.ui = LyraScreen(this.dev.screen, { place: 'Harbour Depot · Plaza', clock: '18:52', mode: 'dark', photo: 'black', cut: true });
    this.ui.os.classList.add('dark');
    this.card = el('div', 'card', this.ui.content);
    css(this.card, { left: '64px', right: '64px', top: '1280px', padding: '38px 44px' });
    this.card.innerHTML = `<div class="eyebrow">Tonight · Harbour FC Women</div><h3>Kick-off 19:30</h3><div class="hair"></div>
      <div class="row"><span style="font:500 32px var(--sans)">Gate C → 120 m</span><span class="chip" style="background:rgba(255,255,255,0.1);color:#fff">short queue</span></div>`;
    this.chen = Chen(root, { rim: 0.55, stripes: 0.7, warmRim: true });
    this.chenL = sp.add(this.chen.el, { x: -280, y: 0, z: 470, pxPerCm: 1788 / 158, ox: 260, oy: 1788 });
    this.crowd = [];
    for (let i = 0; i < 12; i++) {
      const p = Chen(root, { rim: 0.3, scarf: false, stripes: R() < 0.7 ? 0.5 : 0, warmRim: true });
      this.crowd.push({ L: sp.add(p.el, { x: 0, y: 0, z: -40 + R() * 900, pxPerCm: 10.5, ox: 260, oy: 1788 }), off: R() * 3000, sp: 120 + R() * 100 });
    }
    this.rain = Rain(root, { seed: 3 });
    this.stop = StopCard(root, { no: '07', name: 'Harbour Depot' });
    this.s1 = Subtitle(root, 'I drove this route for thirty years.', 'human');
    this.s2 = Subtitle(root, 'Then you know the way.', 'lyra');
    this.fs = frameScreen(sp, this.dev, { cx: 1040, cy: 470, hPx: 640 });
  },
  update(lt, t) {
    const k = E.cine(inv(0, 2.8, lt)), k2 = E.cine(inv(2.8, 4.5, lt));
    const cam = { x: lerp(-90, -10, k), y: lerp(-230, -200, k), z: lerp(-720, -600, k), aperture: 10 };
    const c2 = { x: this.fs.x, y: this.fs.y, z: this.fs.z };
    const C = { x: lerp(cam.x, c2.x, k2), y: lerp(cam.y, c2.y, k2), z: lerp(cam.z, c2.z, k2) };
    this.sp.pose({ ...C, focus: -C.z, aperture: 12 });
    for (const c of this.crowd) c.L.x = ((c.off + lt * c.sp) % 3000) - 1500;
    this.sp.pose({});
    this.pl.draw(t);
    this.rain.draw(t);
    this.ui.idle(t); this.ui.statusIn(1);
    const s = 1 - E.glide(inv(0.15, 0.55, lt));
    this.ui.slide(s * 1300, s > 0.05 ? 1 : 0);
    const pc = inv(0.6, 1.4, lt);
    this.card.style.opacity = E.glide(pc); this.card.style.filter = pc < 1 ? `blur(${(1 - pc) * 10}px)` : 'none'; this.card.style.transform = `translateY(${(1 - E.glide(pc)) * 24}px)`;
    this.stop.update(lt, { hold: 1.5 });
    this.s1.update(lt - 1.0, 1.5, 0.35);
    this.s2.update(lt - 3.05, 1.1, 0.3);
  },
};

// ------------------------------------------------------------ 46.5–47.0  the back of the node; rewind 07 -> 01
export const back = {
  id: 'back', t0: 46.5, t1: 47.0,
  build(root) {
    css(root, { background: PLAZA_BG });
    const sp = this.sp = new Space(root, { F: 1150 });
    const R = rng(82);
    const pts = plazaLights(R);
    this.pl = PointLights(root, sp, [...pts, ...reflectLights(pts, 0.55)], { base: 2 });
    root.insertBefore(this.pl.el, sp.root);
    this.dev = StagedDevice(sp, 'paragonBack', { x: 0, z: 0, reflect: 0.45, glow: 0 });
    // the backlit X breathes brighter than the render (it is a light, not print)
    const g = el('div', 'abs', this.dev.wrap);
    css(g, { left: '120px', top: '360px', width: '200px', height: '260px', background: 'radial-gradient(50% 50% at 50% 45%, rgba(255,255,255,0.55), rgba(255,255,255,0) 70%)', mixBlendMode: 'screen', filter: 'blur(14px)' });
    this.glow = g;
    this.rain = Rain(root, { seed: 4 });
    this.flap = SplitFlap(root, { digits: 2, size: 190 });
    css(this.flap.el, { left: '1330px', top: '430px' });
    this.lab = el('div', 'slug', root, 'ROUTE 7'); css(this.lab, { left: '1336px', top: '640px' });
  },
  update(lt, t) {
    this.sp.pose({ x: lerp(60, -20, lt / 0.5), y: -150, z: -560, focus: 560, aperture: 12 });
    this.pl.draw(t); this.rain.draw(t);
    this.glow.style.opacity = 0.7 + 0.3 * Math.sin(t * 6);
    // rrrrt: 07 06 05 04 03 02 01, one flap every 70 ms
    const seq = ['07', '06', '05', '04', '03', '02', '01'];
    const f = clamp((lt - 0.08) / 0.06, 0, 6);
    const i = Math.min(5, Math.floor(f)), k = f - i;
    this.flap.set(seq[i], seq[Math.min(6, i + 1)], f >= 6 ? 1 : k);
  },
};

// ------------------------------------------------------------ 47.0–51.0  01–04, centre-locked
const UP = [
  { no: '01', name: "St. Mary's", device: 'portal55', lift: 88, halo: 1.1, mode: 'dark', photo: 'black',
    bg: 'linear-gradient(180deg, #0c1214, #121a1c 55%, #07090a)', wall: 'linear-gradient(180deg, #1b2426, #111719)',
    lights: R => lightGrid({ x0: 230, x1: 430, z0: 60, z1: 2600, nx: 2, nz: 12, y: -290, c: '#cfe3f0', i: 0.5, seed: 7 }),
    ui: `<div class="eyebrow">Ward 3 · Night</div><h3>Match on · Lounge 2F</h3><div class="row" style="margin-top:18px"><span class="chip" style="background:rgba(255,255,255,0.1);color:#fff">🔈 Quiet volume</span></div>` },
  { no: '02', name: 'Western Univ', device: 'paragon', lift: 0, mode: 'dark', photo: 'black',
    bg: 'linear-gradient(180deg, #0b1320, #16263a 45%, #102016 52%, #070b08 100%)',
    lights: R => [...Array.from({ length: 60 }, () => ({ x: -2400 + R() * 4800, y: -60 - R() * 500, z: 1800 + R() * 2400, c: R() < 0.6 ? '#f4f8ff' : '#ffd9a0', i: 0.55 }))],
    ui: `<div class="eyebrow">The Quad</div><h3>Fan Zone · 19:30</h3>` },
  { no: '03', name: 'Harbour Hotel', device: 'gateway', lift: 0, mode: 'light', photo: 'white',
    bg: 'linear-gradient(180deg, #140e0a, #22170f 55%, #0b0806)',
    lights: R => [...Array.from({ length: 9 }, () => ({ x: -700 + R() * 500, y: -230 - R() * 120, z: 700 + R() * 500, c: '#ffc27a', i: 0.9 })), ...lightGrid({ x0: -900, x1: 900, z0: 300, z1: 2400, nx: 4, nz: 7, y: -380, c: '#ffd9a8', i: 0.5, seed: 5 })],
    ui: `<div class="eyebrow">Welcome</div><h3>Late checkout tonight.</h3>` },
  { no: '04', name: 'Pier Tower', device: 'portal43', lift: 104, halo: 1.0, mode: 'light', photo: 'white',
    bg: 'linear-gradient(180deg, #1a120c, #24180f 55%, #0c0806)', wall: 'repeating-linear-gradient(90deg, #3b271a 0 140px, #33220f 140px 144px), #3b271a',
    lights: R => [...lightGrid({ x0: 200, x1: 420, z0: 80, z1: 1600, nx: 2, nz: 7, y: -300, c: '#ffe7c8', i: 0.6, seed: 9 }), { x: 320, y: -120, z: 1700, c: '#fff0dc', i: 1.2 }],
    ui: `<div class="eyebrow">Your ride</div><h3>Door B · 3 min</h3>` },
];
export const upstream = {
  id: 'upstream', t0: 47.0, t1: 51.0,
  build(root) {
    css(root, { background: '#000' });
    this.shots = UP.map((S, i) => {
      const r = el('div', 'layer', root);
      css(r, { background: S.bg });
      const sp = new Space(r, { F: 1150 });
      if (S.wall) {
        const wall = el('div', 'abs'); css(wall, { width: 2000 + 125 + 'px', height: '1400px', background: S.wall });
        sp.add(wall, { x: 0, y: 0, z: 4, pxPerCm: 1, ox: 2000, oy: 1400, dof: false });
      }
      const R = rng(90 + i);
      const pts = S.lights(R);
      const pl = PointLights(r, sp, [...pts, ...reflectLights(pts, 0.3)], { base: 2 });
      r.insertBefore(pl.el, sp.root);
      const dev = StagedDevice(sp, S.device, { x: 0, z: 0, lift: S.lift, halo: S.halo || 0, reflect: S.lift ? 0 : 0.35 });
      const ui = LyraScreen(dev.screen, { place: S.name, clock: '18:5' + (3 + i), mode: S.mode, photo: S.photo, cut: true });
      if (S.mode === 'dark') ui.os.classList.add('dark');
      const card = el('div', 'card', ui.content, S.ui);
      css(card, { left: '64px', right: '64px', top: '1330px' });
      const stop = StopCard(r, { no: S.no, name: S.name });
      // centre-lock: every screen occupies the same rectangle, so Lyra's eyes never move
      const cam = frameScreen(sp, dev, { cx: 960, cy: 500, hPx: 760 });
      return { r, sp, pl, ui, stop, cam };
    });
  },
  update(lt, t) {
    const i = Math.min(3, Math.floor(lt / 1.0)), l = lt - i * 1.0;
    this.shots.forEach((S, j) => { S.r.style.display = j === i ? 'block' : 'none'; });
    const S = this.shots[i];
    S.sp.pose({ ...S.cam, z: S.cam.z * (1.04 - 0.05 * l), focus: -S.cam.z, aperture: 14 });
    S.pl.draw(t);
    S.ui.idle(t); S.ui.statusIn(1);
    S.stop.update(l, { hold: 0.7 });
  },
};

// ------------------------------------------------------------ 51.0–52.0  → Gate C
export const gateC = {
  id: 'gateC', t0: 51.0, t1: 52.0,
  build(root) {
    css(root, { background: 'linear-gradient(180deg, #0d1016, #151a22 50%, #08090c)' });
    const sp = this.sp = new Space(root, { F: 1150 });
    const R = rng(93);
    // the bowl beyond the tunnel: a wall of floodlight
    const fl = Array.from({ length: 40 }, (_, i) => ({ x: -1200 + (i % 10) * 260, y: -500 - Math.floor(i / 10) * 90, z: 3200, c: '#f4f8ff', i: 0.9 }));
    // retail, echoed: deep in the concourse a scarf stall's bulbs, and beside it a Gateway's two light strips
    const stall = Array.from({ length: 7 }, (_, i) => ({ x: 250 + i * 30, y: -200 + 8 * Math.sin(Math.PI * i / 6), z: 1300, c: '#ffcf9a', i: 0.7 }));
    const strips = Array.from({ length: 56 }, (_, i) => ({ x: i < 28 ? 520 : 620, y: -12 - (i % 28) * 7, z: 1300, c: '#eef3ff', i: 0.16 }));
    const shop = [...stall, ...strips];
    this.pl = PointLights(root, sp, [...fl, ...shop, ...reflectLights([...fl, ...shop], 0.3)], { base: 2.4 });
    root.insertBefore(this.pl.el, sp.root);
    // pillar with the Portal 32, turnstiles in front
    const pillar = el('div', 'abs'); css(pillar, { width: '120px', height: '1000px', background: 'linear-gradient(90deg, #22262d, #3a3f48 50%, #1a1d22)' });
    sp.add(pillar, { x: -150, y: 0, z: 6, pxPerCm: 1, ox: 60, oy: 1000 });
    this.dev = StagedDevice(sp, 'portal32', { x: -150, z: 0, lift: 113, halo: 1.2 });
    this.ui = LyraScreen(this.dev.screen, { place: 'Gate C', clock: '19:01', cut: true });
    const card = el('div', 'card', this.ui.content, `<div class="eyebrow">Gate C</div><h3>Section 114 · Lift 3</h3><div class="row" style="margin-top:18px"><span class="chip accent">Step-free</span></div>`);
    css(card, { left: '64px', right: '64px', top: '1300px' });
    for (let i = 0; i < 4; i++) {
      const g = el('div', 'abs');
      css(g, { width: '28px', height: '100px', background: 'linear-gradient(90deg, #6d737c, #c9ced6 45%, #7c828b)', borderRadius: '4px 4px 0 0' });
      g.innerHTML = `<i style="position:absolute;left:4px;top:6px;width:20px;height:5px;border-radius:3px;background:#5dffa0;box-shadow:0 0 12px #5dffa0"></i>
        <b style="position:absolute;left:28px;top:34px;width:70px;height:46px;background:linear-gradient(90deg, rgba(200,220,255,0.35), rgba(200,220,255,0.1));border-radius:0 12px 12px 0"></b>`;
      sp.add(g, { x: 40 + i * 110, y: 0, z: -40, pxPerCm: 1, ox: 14, oy: 100 });
    }
    this.arrow = StopCard(root, { name: '→  Gate C', sub: 'Route 7' });
    this.white = el('div', 'layer', root); css(this.white, { background: 'radial-gradient(60% 60% at 50% 45%, #ffffff, #dfe7f5)', opacity: 0 });
  },
  update(lt, t) {
    const z = kf(lt, [[0, -210], [0.5, -195], [1.0, 1800, E.push]]);
    const x = kf(lt, [[0, -90], [0.5, -85], [1.0, 0]]);
    this.sp.pose({ x, y: -150, z, focus: lt < 0.5 ? 205 : 1500, aperture: 10 });
    this.pl.draw(t);
    this.ui.idle(t); this.ui.statusIn(1);
    this.arrow.update(lt, { hold: 0.6 });
    this.white.style.opacity = (E.push(inv(0.6, 1.0, lt))).toFixed(3);
  },
};

export const SCENES_CITY = [plaza, back, upstream, gateC];
