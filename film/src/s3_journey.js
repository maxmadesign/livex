// 27–42  JOURNEY — the Handoff, Exit B (Portal), 06 Market Hall (Gateway, retail),
// the lost fan, the corridor of scarves, the doors open onto the plaza.
import { el, css, kf, E, clamp, inv, lerp, rng, W, H } from './engine.js';
import { Space, StagedDevice, frameScreen, screenWorld } from './space.js';
import { PointLights, reflectLights, lightGrid } from './env.js';
import { LyraScreen, Card } from './ui.js';
import { StopCard, Subtitle, Chen, knitCSS, stripeCSS } from './route7.js';

const HALL_BG = 'linear-gradient(180deg, #1a1e21 0%, #2a2e30 47%, #3b3d3b 51%, #151616 100%)';

// ------------------------------------------------------------ 27.0–28.0  Lyra leaves the Gateway
export const leave = {
  id: 'leave', t0: 27.0, t1: 28.0,
  build(root) {
    css(root, { background: HALL_BG });
    this.sp = new Space(root, { F: 1150 });
    this.dev = StagedDevice(this.sp, 'gateway', { x: 0, z: 0, reflect: 0.2 });
    this.ui = LyraScreen(this.dev.screen, { place: 'Harbour Interchange', clock: '18:31', cut: true });
    this.ui.statusIn(1);
    this.cam = frameScreen(this.sp, this.dev, { cx: 960, cy: 560, hPx: 1000 });
  },
  update(lt, t) {
    this.sp.pose({ ...this.cam, z: this.cam.z * (1 - 0.03 * lt), aperture: 6 });
    this.ui.idle(t);
    // she turns to go: a beat of stillness, then out through the left edge
    const k = E.push(inv(0.45, 0.85, lt));
    this.ui.slide(-k * 1300, k);
  },
};

// ------------------------------------------------------------ 28.0–30.0  → Exit B (Portal 55)
export const exitB = {
  id: 'exitB', t0: 28.0, t1: 30.0,
  build(root) {
    css(root, { background: 'linear-gradient(180deg, #d9dad6 0%, #c9cac5 60%, #8e8f8b 100%)' });
    const sp = this.sp = new Space(root, { F: 1150 });
    // white board-formed concrete corridor wall
    const wall = el('div', 'abs');
    css(wall, { width: '3000px', height: '1400px', background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.035) 0 2px, rgba(0,0,0,0) 2px 60px), linear-gradient(180deg, #e8e8e4, #cfd0cb)' });
    sp.add(wall, { x: 0, y: 0, z: 4, pxPerCm: 1, ox: 1500, oy: 1400, dof: false });
    const floor = el('div', 'abs'); css(floor, { width: '3000px', height: '700px', background: 'linear-gradient(180deg, #9d9e9a, #6e6f6b)' });
    sp.add(floor, { x: 0, y: 0, z: 3.5, pxPerCm: 1, ox: 1500, oy: 0, dof: false });
    this.dev = StagedDevice(sp, 'portal55', { x: -40, z: 0, lift: 88, halo: 1.7 });
    this.ui = LyraScreen(this.dev.screen, { place: 'Exit B', clock: '18:33', cut: true });
    this.card = el('div', 'card', this.ui.content);
    css(this.card, { left: '64px', right: '64px', top: '1360px', padding: '40px 44px' });
    this.card.innerHTML = `<div class="eyebrow">Harbour Line · Exit B</div>
      <div style="display:flex;align-items:center;gap:26px;margin-top:14px"><span style="font:500 120px/1 var(--sans);color:#2f5bea">↑</span>
      <div><div style="font:600 54px/1.05 var(--sans);letter-spacing:-.025em">Exit B</div><div style="font:400 32px var(--sans);color:#4a5260;margin-top:8px">Market Hall · 120 m</div></div></div>`;
    // the moving walkway going up to warm light, right (no steps)
    const esc = el('div', 'abs');
    css(esc, { width: '1200px', height: '140px', background: 'linear-gradient(90deg, rgba(120,110,100,0.8), rgba(255,210,160,0.9))', transform: 'rotate(-30deg)', transformOrigin: '0 50%', filter: 'blur(6px)' });
    sp.add(esc, { x: 260, y: -10, z: 380, pxPerCm: 1, ox: 0, oy: 70 });
    this.chen = Chen(root, { rim: 0.2 });
    this.chenL = sp.add(this.chen.el, { x: 330, y: 0, z: 150, pxPerCm: 1788 / 158, ox: 260, oy: 1788 });
    this.arrow = StopCard(root, { name: '→  Exit B', sub: 'Route 7' });
    this.frameA = frameScreen(sp, this.dev, { cx: 960, cy: 520, hPx: 860 });
  },
  update(lt, t) {
    // opens on the Portal's blue wall-wash (teach the light), pulls out to the wall
    const k = E.crane(inv(0, 1.6, lt));
    const halo = { x: this.dev.layer.x - 60, y: -150 };
    const cam = { x: lerp(halo.x, this.frameA.x + 60, k), y: lerp(halo.y, this.frameA.y, k), z: lerp(-100, this.frameA.z * 1.25, k) };
    this.sp.pose({ ...cam, focus: -cam.z, aperture: 5 });
    this.ui.idle(t); this.ui.statusIn(1);
    // Lyra arrives through the right edge
    const s = 1 - E.glide(inv(0.35, 0.8, lt));
    this.ui.slide(s * 1300, s > 0.05 ? 1 : 0);
    const pc = inv(0.7, 1.5, lt);
    this.card.style.opacity = E.glide(pc); this.card.style.transform = `translateY(${(1 - E.glide(pc)) * 24}px)`; this.card.style.filter = pc < 1 ? `blur(${(1 - pc) * 10}px)` : 'none';
    this.chenL.x = lerp(260, 520, lt / 2); this.chenL.z = 150;
    this.arrow.update(lt, { hold: 1.3 });
  },
};

// ------------------------------------------------------------ 30.0–33.0  06 · Market Hall
function MarketHall(sp, root, R, { scarves = true } = {}) {
  // cast-iron arches receding under a glass roof, warm stalls, pendant bulbs
  for (let i = 0; i < 7; i++) {
    const a = el('div', 'abs');
    a.innerHTML = `<svg width="1800" height="900" viewBox="0 0 1800 900"><path d="M40 900 V420 A860 420 0 0 1 1760 420 V900" fill="none" stroke="#1a1410" stroke-width="26"/><path d="M40 420 A860 420 0 0 1 1760 420" fill="none" stroke="#2c211a" stroke-width="10" transform="translate(0 40)"/></svg>`;
    sp.add(a, { x: 0, y: 0, z: 200 + i * 520, pxPerCm: 1, ox: 900, oy: 900 });
  }
  const bulbs = [];
  for (let i = 0; i < 40; i++) bulbs.push({ x: -700 + R() * 1400, y: -250 - R() * 120, z: 300 + R() * 3000, c: '#ffc27a', i: 0.8 });
  const stalls = [];
  for (let i = 0; i < 60; i++) stalls.push({ x: (R() < 0.5 ? -1 : 1) * (380 + R() * 400), y: -60 - R() * 180, z: 250 + R() * 2600, c: R() < 0.5 ? '#ffe0b0' : '#fff1dc', i: 0.35 });
  const pl = PointLights(root, sp, [...bulbs, ...stalls, ...reflectLights(bulbs, 0.3)], { base: 1.8 });
  root.insertBefore(pl.el, sp.root);
  // hanging striped scarves at the stall (defocused)
  if (scarves) for (let i = 0; i < 9; i++) {
    const s = el('div', 'abs'); css(s, { width: '22px', height: '150px', background: 'repeating-linear-gradient(0deg, #14213d 0 24px, #f4f1ea 24px 32px)', borderRadius: '3px' });
    sp.add(s, { x: 230 + i * 30, y: -210, z: 420 + (i % 3) * 20, pxPerCm: 1, ox: 11, oy: 0 });
  }
  return pl;
}
export const market = {
  id: 'market', t0: 30.0, t1: 33.0,
  build(root) {
    css(root, { background: 'linear-gradient(180deg, #3a2a1c 0%, #251a12 40%, #1b140e 60%, #0d0907 100%)' });
    const sp = this.sp = new Space(root, { F: 1150 });
    this.R = rng(61);
    this.pl = MarketHall(sp, root, this.R);
    this.dev = StagedDevice(sp, 'gateway', { x: -20, z: 0, reflect: 0.35 });
    this.ui = LyraScreen(this.dev.screen, { place: 'Market Hall · Stall 4', clock: '18:36', cut: true });
    this.card = el('div', 'card', this.ui.content);
    css(this.card, { left: '64px', right: '64px', top: '1250px', padding: '0', overflow: 'hidden' });
    this.card.innerHTML = `<div style="height:210px;background:${stripeCSS()};position:relative"><div style="position:absolute;right:28px;bottom:22px;font:600 26px var(--mono);letter-spacing:.14em;color:#fff;background:#14213d;padding:8px 14px;border-radius:6px">No. 7</div></div>
      <div style="padding:30px 40px 34px"><div class="eyebrow">Harbour FC Women · Home</div><div style="font:600 50px/1.1 var(--sans);letter-spacing:-.025em;margin-top:12px">No. 7 Home scarf</div>
      <div class="row" style="margin-top:22px"><span class="chip">Last 3</span><span class="chip accent">Stall 4 →</span></div></div>`;
    this.stop = StopCard(root, { no: '06', name: 'Market Hall' });
    this.chen = Chen(root, { rim: 0.7 });
    this.chenL = sp.add(this.chen.el, { x: -170, y: 0, z: -110, pxPerCm: 1788 / 158, ox: 260, oy: 1788 });
    this.cam = frameScreen(sp, this.dev, { cx: 1010, cy: 500, hPx: 700 });
    // insert: the stripes land on the red knit
    this.fab = el('div', 'layer', root);
    css(this.fab, { display: 'none', background: '#0e0b09' });
    this.knit = el('div', 'abs', this.fab); css(this.knit, { inset: '-40px', background: knitCSS(), filter: 'contrast(1.1)', transform: 'rotate(-6deg) scale(1.2)' });
    const kl = el('div', 'abs', this.fab); css(kl, { inset: 0, background: 'radial-gradient(80% 90% at 40% 30%, rgba(255,220,180,0.25), rgba(0,0,0,0.55) 90%)', mixBlendMode: 'multiply' });
    this.stripe = el('div', 'abs', this.fab); css(this.stripe, { left: '-200px', width: '2400px', height: '520px', top: '0', background: stripeCSS(), boxShadow: '0 40px 60px rgba(0,0,0,0.55)', transformOrigin: '50% 0' });
    const sk = el('div', 'abs', this.stripe); css(sk, { inset: 0, background: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.16) 0 3px, rgba(0,0,0,0) 3px 18px), repeating-linear-gradient(0deg, rgba(0,0,0,0.12) 0 4px, rgba(255,255,255,0.05) 4px 10px), linear-gradient(180deg, rgba(255,255,255,0.12), rgba(0,0,0,0.35))', mixBlendMode: 'multiply' });
    const fr = el('div', 'abs', this.stripe); css(fr, { left: 0, right: 0, bottom: '-34px', height: '36px', background: 'repeating-linear-gradient(90deg, #14213d 0 6px, transparent 6px 12px)' });
    const light = el('div', 'abs', this.fab); css(light, { inset: 0, background: 'linear-gradient(160deg, rgba(255,210,160,0.18), rgba(0,0,0,0) 40%, rgba(0,0,0,0.4))' });
  },
  update(lt, t) {
    const insert = lt >= 1.9;
    this.fab.style.display = insert ? 'block' : 'none';
    const k = E.cine(clamp(lt / 1.9));
    this.sp.pose({ x: this.cam.x - 30 + 60 * k, y: this.cam.y, z: this.cam.z * (1.12 - 0.08 * k), focus: -this.cam.z * (1.12 - 0.08 * k), aperture: 12 });
    this.pl.draw(t);
    this.ui.idle(t); this.ui.statusIn(1);
    const s = 1 - E.glide(inv(0.15, 0.55, lt));
    this.ui.slide(s * 1300, s > 0.05 ? 1 : 0);
    const pc = inv(0.5, 1.2, lt);
    this.card.style.opacity = E.glide(pc); this.card.style.transform = `translateY(${(1 - E.glide(pc)) * 28}px) scale(${lerp(0.97, 1, E.glide(pc))})`; this.card.style.filter = pc < 1 ? `blur(${(1 - pc) * 12}px)` : 'none';
    this.stop.update(lt, { hold: 1.4 });
    if (insert) {
      const q = E.settle(inv(1.95, 2.9, lt));
      css(this.stripe, { transform: `translateY(${lerp(-620, 250, q)}px) rotate(${lerp(-14, -8, q)}deg)` });
      this.knit.style.transform = `rotate(-6deg) scale(${1.2 + 0.03 * (lt - 1.9)})`;
    }
  },
};

// ------------------------------------------------------------ 33.0–42.0  the corridor: "Gate C?"; scarves; the doors
export const corridor = {
  id: 'corridor', t0: 33.0, t1: 42.0,
  build(root) {
    css(root, { background: 'linear-gradient(180deg, #2e2419 0%, #1f1811 45%, #1a140f 55%, #0b0806 100%)' });
    const sp = this.sp = new Space(root, { F: 1150 });
    this.R = rng(71);
    this.pl = MarketHall(sp, root, this.R, { scarves: false });
    // the stadium roof through the glass, far ahead: a crown of cool white light
    const crown = Array.from({ length: 22 }, (_, i) => ({ x: -1600 + i * 150, y: -760 - Math.sin(i / 21 * Math.PI) * 220, z: 5200, c: '#eef3ff', i: 0.45, on: 39.0 + Math.abs(i - 10.5) * 0.035 }));
    this.pl2 = PointLights(root, sp, crown, { base: 2.4 });
    root.insertBefore(this.pl2.el, sp.root);
    // the automatic doors at the end of the hall
    const doors = this.doors = el('div', 'abs');
    css(doors, { width: '600px', height: '420px' });
    this.light = el('div', 'abs', doors); css(this.light, { inset: 0, background: 'linear-gradient(180deg, #54607a, #9aa6bf 55%, #2a2f3a)', boxShadow: '0 0 120px 40px rgba(170,190,230,0.3)' });
    this.dl = el('div', 'abs', doors); this.dr = el('div', 'abs', doors);
    for (const d of [this.dl, this.dr]) css(d, { top: 0, width: '300px', height: '420px', background: 'linear-gradient(90deg, rgba(40,44,52,0.85), rgba(80,86,96,0.7))', boxShadow: 'inset 0 0 0 6px #111' });
    this.doorsL = sp.add(doors, { x: 0, y: 0, z: 2600, pxPerCm: 1, ox: 300, oy: 420 });
    // people: the lost fan (backpack) and scarves everywhere
    this.fan = Chen(root, { rim: 0.6, scarf: false, stripes: 0.6, backpack: true, flip: true, warmRim: true });
    this.fanL = sp.add(this.fan.el, { x: 70, y: 0, z: 125, pxPerCm: 1788 / 176, ox: 260, oy: 1788 });
    this.chen = Chen(root, { rim: 0.6, stripes: 0.7, warmRim: true });
    this.chenL = sp.add(this.chen.el, { x: -60, y: 0, z: 90, pxPerCm: 1788 / 158, ox: 260, oy: 1788 });
    this.crowd = [];
    for (let i = 0; i < 26; i++) {
      const p = Chen(root, { rim: 0.4, scarf: false, stripes: this.R() < 0.75 ? 0.5 : 0, tone: 1, warmRim: true });
      this.crowd.push({ p, L: sp.add(p.el, { x: 0, y: 0, z: 300 + this.R() * 2200, pxPerCm: 10.5, ox: 260, oy: 1788 }), off: this.R() * 2000, sp: 90 + this.R() * 60, side: this.R() < 0.5 ? -1 : 1 });
    }
    const back = el('div', 'abs'); css(back, { width: '1400px', height: '900px', background: 'radial-gradient(50% 50% at 50% 55%, rgba(255,214,170,0.32), rgba(0,0,0,0) 70%)' });
    sp.add(back, { x: 0, y: -60, z: 900, pxPerCm: 1, ox: 700, oy: 450, dof: false });
    this.q1 = Subtitle(root, 'Gate C?', 'human');
    this.q2 = Subtitle(root, 'Past the clock tower. Follow the scarves.', 'human');
    this.flash = el('div', 'layer', root); css(this.flash, { background: 'radial-gradient(60% 60% at 50% 55%, #eef3ff, #9fb0d0)', opacity: 0 });
  },
  update(lt, t) {
    // 33.0–36.0 two-shot (question, answer) · 36.0–37.5 the fan runs past camera
    // 37.5–39.5 lateral track: scarves stream through foreground, the stadium roof lights up
    // 39.5–42.0 behind her, toward the doors; they open; light floods in
    let cam;
    if (lt < 4.5) {
      cam = { x: kf(lt, [[0, 0], [4.5, -20]]), y: -140, z: kf(lt, [[0, -170], [4.5, -140]]), focus: 700, aperture: 7 };
    } else if (lt < 6.5) {
      const k = inv(4.5, 6.5, lt);
      cam = { x: lerp(-420, 380, k), y: -120, z: 300, focus: 650, aperture: 10 };
    } else {
      cam = { x: 0, y: -140, z: kf(lt, [[6.5, 200], [9.0, 1500, E.push]]), focus: 900, aperture: 12 };
    }
    this.sp.pose(cam);
    // the fan: faces her, then runs off right past the camera
    const run = E.push(inv(3.0, 4.4, lt));
    this.fanL.x = lerp(70, 560, run); this.fanL.z = lerp(125, -80, run);
    this.fanL.node.style.display = lt < 4.5 ? '' : 'none';
    this.chenL.z = kf(lt, [[0, 90], [4.5, 110], [6.5, 700], [9.0, 1300, E.cine]]);
    this.chenL.x = kf(lt, [[0, -60], [4.5, -50], [6.5, 20], [9.0, -10]]);
    // scarves stream: after the fan leaves the corridor fills; in the lateral shot they pass close
    this.crowd.forEach((c, i) => {
      const on = lt > 4.2 + (i % 8) * 0.1 || i < 8;
      c.L.node.style.display = on ? '' : 'none';
      if (lt >= 4.5 && lt < 6.5 && i < 10) { c.L.x = cam.x + (((c.off + lt * 520) % 1800) - 900); c.L.z = 520 + (i % 4) * 60; }
      else { c.L.x = c.side * (150 + (i * 37) % 380); c.L.z = 200 + ((c.off + lt * c.sp * 3) % 2400); }
    });
    this.sp.pose({});
    this.pl.draw(t);
    // the stadium roof ignites, ring by ring (39.0 s)
    this.pl2.draw(t);
    const o = E.cine(inv(7.9, 8.5, lt));
    css(this.dl, { left: `${-o * 280}px` }); css(this.dr, { left: `${300 + o * 280}px` });
    this.flash.style.opacity = (E.push(inv(8.5, 9.0, lt)) * 0.95).toFixed(3);
    this.q1.update(lt - 0.3, 0.4, 0.3);
    this.q2.update(lt - 1.45, 1.3, 0.55);
  },
};

export const SCENES_JOURNEY = [leave, exitB, market, corridor];
