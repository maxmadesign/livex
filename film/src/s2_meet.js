// 10–27  AI + REVEAL — one continuous world (Harbour Interchange, 18:31).
// Close-ups are the camera standing inside the screen's area, so Lyra reads as a
// person; the reveal is the same camera pulling back through bezel, device, Chen, hall.
import { el, css, kf, E, clamp, inv, lerp, rng, spline, reveal, W, H } from './engine.js';
import { Space, StagedDevice, screenWorld } from './space.js';
import { PointLights, reflectLights } from './env.js';
import { LyraScreen } from './ui.js';
import { Subtitle, StopCard, Chen, NOTE_LINES } from './route7.js';

function RouteCard(ui) {
  const card = el('div', 'card', ui.content);
  css(card, { left: '64px', right: '64px', top: '1470px', padding: '34px 40px' });
  card.innerHTML = `<div class="eyebrow" style="display:flex;justify-content:space-between"><span>Gate C · 114 · Row 12 · Seat 7</span><span>19:30</span></div>
    <div class="rt" style="display:flex;align-items:center;gap:18px;margin-top:18px;font:600 44px var(--sans);letter-spacing:-.02em;white-space:nowrap">
      <span>Exit B</span><span class="ar" style="color:#2f5bea">→</span><span>Market Hall</span><span class="ar" style="color:#2f5bea">→</span><span>Gate C</span></div>
    <div class="hair" style="margin:22px 0"></div>
    <div class="row"><span style="font:500 30px var(--sans)">9 min</span>
      <span class="sf" style="display:flex;align-items:center;gap:16px;font:500 28px var(--sans)">Step-free route
        <span class="tg" style="width:86px;height:50px;border-radius:25px;background:#d6dae1;position:relative;display:inline-block"><i style="position:absolute;top:5px;left:5px;width:40px;height:40px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.2)"></i></span></span></div>`;
  const tg = card.querySelector('.tg'), knob = tg.querySelector('i'), rows = [...card.children], ars = card.querySelectorAll('.ar');
  return {
    update(t) {
      const pc = inv(17.6, 18.6, t);
      reveal(card, E.glide(pc), { y: 30, blur: 14, scale: 0.97 });
      rows.forEach((r, i) => reveal(r, E.settle(clamp(pc * 2 - 0.2 - i * 0.2)), { y: 12, blur: 6, scale: 1 }));
      const on = E.snap(inv(18.5, 18.74, t));
      tg.style.background = on > 0.5 ? '#2f5bea' : '#d6dae1';
      knob.style.transform = `translateX(${on * 36}px)`;
      ars.forEach((a, i) => { a.style.transform = `translateX(${Math.sin(clamp((t - 19.0 - i * 0.15) / 0.5) * Math.PI) * 10}px)`; });
    },
  };
}

export const meet = {
  id: 'meet', t0: 10.0, t1: 27.0,
  build(root) {
    css(root, { background: 'linear-gradient(180deg, #1a1e21 0%, #2a2e30 47%, #3b3d3b 51%, #151616 100%)' });
    const sp = this.sp = new Space(root, { F: 1150 });
    const R = rng(52);
    // colonnade
    for (let i = 0; i < 9; i++) for (const side of [-1, 1]) {
      const c = el('div', 'abs'); css(c, { width: '80px', height: '900px', background: 'linear-gradient(90deg, #6d6f6c, #a4a49e 45%, #83847f 70%, #4e504e)' });
      sp.add(c, { x: side * 560 + (side < 0 ? -40 : 40), y: 0, z: -300 + i * 600, pxPerCm: 1, ox: 40, oy: 900 });
    }
    // the Exit B escalator: a warm diagonal of light far right (Lyra's arrow points here)
    const esc = el('div', 'abs');
    css(esc, { width: '900px', height: '80px', background: 'linear-gradient(90deg, rgba(255,190,120,0), rgba(255,205,150,0.95) 30%, rgba(255,214,160,1) 70%, rgba(255,190,120,0.2))', transform: 'rotate(-28deg)', transformOrigin: '0 50%', filter: 'blur(3px)', boxShadow: '0 0 60px 20px rgba(255,180,110,0.35)' });
    this.esc = sp.add(esc, { x: 760, y: -40, z: 2400, pxPerCm: 1, ox: 0, oy: 40 });
    const ceil = [];
    for (let i = 0; i < 80; i++) ceil.push({ x: -320, y: -440, z: 700 + i * 45, c: '#eef4ff', i: 0.1 }, { x: 320, y: -440, z: 700 + i * 45, c: '#eef4ff', i: 0.1 });
    const warm = Array.from({ length: 14 }, () => ({ x: 800 + R() * 500, y: -80 - R() * 360, z: 2300 + R() * 700, c: '#ffc98e', i: 0.9 }));
    this.pl = PointLights(root, sp, [...warm, ...reflectLights(warm, 0.25)], { base: 1.4, bloom: 0.08 });
    root.insertBefore(this.pl.el, sp.root);
    // crowd: long-exposure streams on both sides of the two still figures
    this.crowd = [];
    for (let i = 0; i < 30; i++) {
      const p = el('div', 'abs');
      p.innerHTML = `<img src="assets/cut/human_sil.png" style="width:495px;height:1700px;opacity:.55;filter:url(#mblur2) brightness(3.2)">`;
      const z = i < 18 ? 120 + R() * 900 : 900 + R() * 2200;
      this.crowd.push({ L: sp.add(p, { x: 0, y: 0, z, pxPerCm: 10.3, ox: 250, oy: 1700 }), dir: R() > 0.5 ? 1 : -1, sp: 150 + R() * 140, off: R() * 3000 });
    }
    // Gateway V2 — life-size Lyra
    this.dev = StagedDevice(sp, 'gateway', { x: 0, z: 0, reflect: 0.3, glow: 0.4, spill: 0.35 });
    this.ui = LyraScreen(this.dev.screen, { place: 'Harbour Interchange', clock: '18:31' });
    this.card = RouteCard(this.ui);
    // close-ups (10–20): the same screen content as a frontal plate — Lyra reads as a person
    this.plate = el('div', 'layer', root);
    css(this.plate, { background: '#f2f2f0', overflow: 'hidden' });
    const pin = this.plateInner = el('div', 'abs', this.plate);
    css(pin, { width: '1080px', height: '1920px', transformOrigin: '0 0' });
    this.pui = LyraScreen(pin, { place: 'Harbour Interchange', clock: '18:31' });
    this.pcard = RouteCard(this.pui);
    this.pui.status.style.display = 'none';
    // Chen's shoulder + scarf, huge and out of focus, for the over-the-shoulder
    this.osh = el('div', 'abs', this.plate);
    css(this.osh, { left: '-260px', top: '360px', width: '900px', height: '1100px', filter: 'blur(38px)' });
    this.osh.innerHTML = `<div style="position:absolute;left:210px;top:0;width:430px;height:520px;border-radius:50%;background:#1a1512"></div>
      <div style="position:absolute;left:0;top:380px;width:900px;height:900px;border-radius:46% 46% 0 0;background:#141110"></div>
      <div style="position:absolute;left:300px;top:430px;width:360px;height:220px;border-radius:50%;background:#b8322a"></div>`;
    // Chen: 3/4 back, left foreground, holding the note up toward the camera
    this.chen = Chen(root, { rim: 0.6 });
    this.chenL = sp.add(this.chen.el, { x: -78, y: 0, z: -105, pxPerCm: 1788 / 158, ox: 260, oy: 1788 });
    const mini = el('div', 'abs');
    css(mini, { width: '140px', height: '90px', background: 'linear-gradient(135deg, #f4efe4, #d9d2c3)', borderRadius: '3px', transform: 'rotate(-8deg)', boxShadow: '0 0 30px rgba(240,245,255,0.35)' });
    this.mini = sp.add(mini, { x: -50, y: -152, z: -118, pxPerCm: 10, ox: 70, oy: 45 });
    // film-level: subtitles, the note transform, stop card
    this.s1 = Subtitle(root, 'They built a stadium on my bus depot.', 'human', { tone: 'dark', y: 968 });
    this.s2 = Subtitle(root, "Route 7's last stop. I know it.", 'lyra', { tone: 'dark', y: 972 });
    this.lens = el('div', 'layer', root);
    this.buildLens();
    this.stop = StopCard(root, { no: '05', name: 'Harbour Interchange' });
    // screen-space anchors on Lyra
    this.face = screenWorld(this.dev, 545, 330);
    this.body = screenWorld(this.dev, 540, 980);
    this.cardW = screenWorld(this.dev, 540, 1640);
  },
  // 15.0–17.5: the pencil words rise into the lens reflection and become type
  buildLens() {
    const L = this.lens;
    css(L, { display: 'none', background: 'radial-gradient(60% 70% at 50% 50%, #1f2427, #0c0e10)' });
    const lens = this.lensEl = el('div', 'abs', L);
    css(lens, { left: '360px', top: '140px', width: '1200px', height: '800px', borderRadius: '50%', overflow: 'hidden', background: 'radial-gradient(70% 70% at 40% 35%, rgba(220,232,255,0.22), rgba(40,48,58,0.35) 70%)', boxShadow: 'inset 0 0 0 10px rgba(30,24,20,0.9), inset 0 0 80px rgba(0,0,0,0.6)' });
    const lines = [['Gate C · 114', 170], ['Row 12 · Seat 7', 330], ['19:30', 490]];
    this.pairs = lines.map(([txt, y]) => {
      const row = el('div', 'abs', lens); css(row, { left: '0', right: '0', top: y + 'px', height: '140px' });
      const pen = el('div', 'abs', row, txt); css(pen, { left: 0, right: 0, textAlign: 'center', font: '124px/1.1 var(--hand)', color: 'rgba(235,240,250,0.9)', whiteSpace: 'nowrap' });
      const typ = el('div', 'abs', row, txt); css(typ, { left: 0, right: 0, textAlign: 'center', font: '600 96px/1.35 var(--sans)', letterSpacing: '-0.02em', color: '#fff', whiteSpace: 'nowrap' });
      return { pen, typ };
    });
    const sheen = el('div', 'abs', lens);
    css(sheen, { inset: '0', background: 'linear-gradient(120deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.12) 45%, rgba(255,255,255,0) 60%)' });
    this.sheen = sheen;
  },
  update(lt, t) {
    const sp = this.sp, F = sp.F;
    const aim = (p, hPx, dy = 0) => ({ x: p.x, y: p.y + dy, z: p.z - F / (hPx), focus: F / hPx });
    let cam;
    this.lens.style.display = 'none';
    const plateOn = t < 20.0;
    this.plate.style.display = plateOn ? 'block' : 'none';
    // plate framing: canvas point (u, v) at screen (X, Y) with scale S
    const frame = (u, v, X, Y, S) => { this.plateInner.style.transform = `translate(${X - u * S}px, ${Y - v * S}px) scale(${S})`; };
    this.osh.style.display = 'none';
    if (t < 12.5) {
      const k = E.cine(inv(10, 12.5, t));
      frame(545, 420, lerp(1210, 1190, k), 470, lerp(1.9, 1.96, k));
      this.osh.style.display = 'block';
    } else if (t < 15.0) {
      const k = E.cine(inv(12.5, 15, t));
      frame(545, 330, 960, 450, lerp(2.2, 2.42, k));
    } else if (t < 17.5) {
      this.lens.style.display = 'block';
      frame(545, 330, 960, 450, 2.42);
    } else if (t < 20.0) {
      const k = E.cine(inv(17.5, 20, t));
      frame(540, 1640, 960, 560, lerp(1.72, 1.8, k));
    }
    if (plateOn) cam = { x: this.face.x, y: this.face.y + 9, z: -44, focus: 44, aperture: 4 };
    else {
      // THE REVEAL: log-distance spline through the milestones
      const logd = spline(t, [[20.0, Math.log(44)], [21.3, Math.log(235)], [22.3, Math.log(300)], [23.5, Math.log(380)], [24.6, Math.log(520)], [25.5, Math.log(680)], [26.4, Math.log(840)], [27.0, Math.log(860)]]);
      const d = Math.exp(logd);
      const u = clamp((d - 44) / (860 - 44));
      const tx = lerp(this.face.x, -45, E.cine(clamp(u * 1.6)));
      const ty = lerp(this.face.y + 9, -135, E.cine(clamp(u * 1.4))) - 90 * E.cine(inv(24.6, 27, t));
      cam = { x: tx, y: ty, z: -d, focus: d, aperture: lerp(4, 20, clamp(u * 2)) };
    }
    this.chenL.x = -78; this.chenL.z = -105;
    for (const c of this.crowd) c.L.x = ((c.off + c.dir * t * c.sp) % 3000 + 3000) % 3000 - 1500;
    sp.pose(cam);
    this.pl.draw(t);
    // --- screen state ---
    const ui = this.ui;
    ui.idle(t); this.pui.idle(t);
    ui.statusIn(clamp((t - 20.8) / 0.6));        // the status bar only exists once we know it's a screen
    this.card.update(t); this.pcard.update(t);
    // --- Chen ---
    this.chen.update({ rimK: 0.55 });
    this.mini.node.style.opacity = t >= 20 ? 1 : 0;
    // --- lens: pencil -> type (15.0–17.5) ---
    if (t >= 15 && t < 17.5) {
      const k = t - 15;
      this.pairs.forEach((p, i) => {
        const q = E.settle(clamp((k - 0.35 - i * 0.22) / 0.8));
        p.pen.style.opacity = 1 - q; p.pen.style.filter = `blur(${q * 8}px)`; p.pen.style.transform = `translateY(${-q * 10}px)`;
        reveal(p.typ, q, { y: 10, blur: 8, scale: 1.02 });
      });
      this.lensEl.style.transform = `scale(${lerp(1.04, 1, E.cine(clamp(k / 2.5)))})`;
      this.sheen.style.transform = `translateX(${lerp(-300, 300, k / 2.5)}px)`;
    }
    // --- subtitles ---
    this.s1.update(t - 10.3, 1.6, 0.4);
    this.s2.update(t - 12.8, 1.4, 0.5);
    // --- first ding: stop 05 ---
    this.stop.update(t - 25.5, { hold: 1.25 });
  },
};

export const SCENES_MEET = [meet];
