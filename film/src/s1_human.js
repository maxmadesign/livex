// 00–10  HUMAN — 1985 blind -> 2026 note -> the flip phone -> lost in the new interchange.
import { el, css, kf, E, clamp, inv, lerp, rng, W, H } from './engine.js';
import { Space } from './space.js';
import { PointLights, lightGrid, reflectLights, Bokeh } from './env.js';
import { Film16, RollSign, Note, FlipPhone, Subtitle, Chen } from './route7.js';

// ------------------------------------------------------------ 0.0–1.5  the 1985 blind
export const hook = {
  id: 'hook', t0: 0, t1: 1.5,
  build(root) {
    css(root, { background: '#000' });
    this.f = Film16(root);
    const scene = this.f.inner;
    css(scene, { background: 'radial-gradient(120% 90% at 50% 70%, #2a1d14 0%, #0e0a08 70%)' });
    this.bk = Bokeh(scene, { seed: 85, count: 40, palette: ['#ffb45e', '#ffd49a', '#ff9a4a'], size: [40, 200], area: [0, 600, 1440, 1100], alpha: [0.08, 0.3] });
    css(this.bk.el, { width: '1440px', height: '1080px' });
    this.sign = RollSign(scene);
    css(this.sign.box, { transformOrigin: '50% 50%' });
  },
  update(t) {
    this.bk.draw(t, { drift: 40 });
    // the drum rolls: two entries in 0.85 s, a mechanical settle with a small overshoot
    const k = kf(t, [[0.0, 0.0], [0.82, 2.06, E.cine], [0.98, 1.985, E.settle], [1.1, 2.0, E.settle]]);
    this.sign.update(k);
    // push toward the "7" for the match cut
    // measured: the 7 sits (-451, +1) px from the box centre; land it on frame centre
    const z = kf(t, [[0, 1.0], [1.05, 1.02], [1.5, 1.62, E.push]]);
    const k2 = E.push(inv(1.05, 1.5, t));
    const ox = lerp(0, 451 * 1.62, k2), oy = lerp(0, 28, k2);
    this.sign.box.style.transform = `translate(${ox}px, ${oy}px) scale(${z})`;
    this.f.update(t, { open: 0 });
  },
};

// ------------------------------------------------------------ 1.5–3.0  the note (2026)
export const note = {
  id: 'note', t0: 1.5, t1: 3.0,
  build(root) {
    css(root, { background: 'linear-gradient(180deg, #151a1e 0%, #0b0d10 100%)' });
    // the subway: fluorescent tubes and tunnel lights streaking past the window
    this.bk = Bokeh(root, { seed: 12, count: 60, palette: ['#e8f0ff', '#cfe0ff', '#ffe3c0'], size: [30, 170], alpha: [0.05, 0.2] });
    this.streaks = el('canvas', 'fill', root); this.streaks.width = W; this.streaks.height = H; this.sg = this.streaks.getContext('2d');
    css(this.streaks, { filter: 'blur(10px)', mixBlendMode: 'screen' });
    this.cam = el('div', 'layer', root);
    this.n = Note(this.cam);
    this.matte = el('div', 'layer', root);
    this.mL = el('div', 'abs', this.matte); this.mR = el('div', 'abs', this.matte);
    for (const m of [this.mL, this.mR]) css(m, { top: 0, height: H + 'px', background: '#000' });
    this.year = el('div', 'year', root, '2026'); css(this.year, { left: '296px', top: '48px' });
  },
  update(lt, t) {
    this.bk.draw(lt, { drift: -220 });
    const g = this.sg; g.clearRect(0, 0, W, H);
    const r = rng(33);
    for (let i = 0; i < 9; i++) { const y = 120 + r() * 300, sp = 2600 + r() * 1800, x = ((r() * 3000 - lt * sp) % 3400 + 3400) % 3400 - 700; g.fillStyle = `rgba(255,${190 + r() * 50 | 0},${120 + r() * 60 | 0},0.35)`; g.fillRect(x, y, 380 + r() * 400, 6 + r() * 6); }
    // camera: start on the pencil "7" where the blind's 7 was, ease out to the whole note
    const n = this.n;
    // match cut: the pencil 7 starts exactly where the blind's 7 ended (frame centre)
    const s = kf(lt, [[0, 3.4], [1.1, 1.0, E.crane]]);
    const cx = kf(lt, [[0, -159], [1.1, 0, E.crane]]);
    const cy = kf(lt, [[0, -76], [1.1, 0, E.crane]]);
    const sway = Math.sin(t * 2 * Math.PI * 0.8) * 0.5, bob = Math.sin(t * 2 * Math.PI * 1.6) * 3;
    css(n.el, { left: (W - n.w) / 2 + 'px', top: (H - n.h) / 2 + 20 + 'px', transform: `translate(${cx * s}px, ${cy * s + bob}px) scale(${s}) rotate(${-1.6 + sway}deg)` });
    // the 4:3 matte opens in 10 frames
    const open = E.cine(clamp(lt / 0.33));
    const bar = lerp(240, 0, open);
    css(this.mL, { left: 0, width: bar + 'px' }); css(this.mR, { right: 0, width: bar + 'px' });
    css(this.year, { left: bar + 56 + 'px', opacity: 1 - clamp((lt - 0.9) / 0.4) });
  },
};

// ------------------------------------------------------------ 3.0–4.5  "Mum, I'll come get you?"
export const phone = {
  id: 'phone', t0: 3.0, t1: 4.5,
  build(root) {
    css(root, { background: 'linear-gradient(180deg, #13171b, #090b0d)' });
    this.bk = Bokeh(root, { seed: 14, count: 60, palette: ['#e8f0ff', '#cfe0ff', '#ffe3c0'], size: [30, 170], alpha: [0.05, 0.2] });
    this.p = FlipPhone(root);
    css(this.p.el, { left: '750px', top: '150px' });
  },
  update(lt, t) {
    this.bk.draw(lt + 1.5, { drift: -220 });
    const close = E.push(inv(1.18, 1.3, lt));
    this.p.update(close);
    const s = kf(lt, [[0, 1.0], [1.18, 1.06, E.cine]]);
    this.p.el.style.transform = `scale(${s}) rotate(${-4 + Math.sin(t * 5) * 0.4}deg)`;
  },
};

// ------------------------------------------------------------ 4.5–10.0  the new interchange
export const interchange = {
  id: 'interchange', t0: 4.5, t1: 10.0,
  build(root) {
    css(root, { background: 'linear-gradient(180deg, #1b1f22 0%, #2a2e30 46%, #3a3c3a 52%, #1a1b1b 100%)' });
    const sp = this.sp = new Space(root, { F: 1150 });
    const R = rng(51);
    // colonnade: pale board-formed concrete columns every 6 m, both sides, 40 m deep
    this.cols = [];
    for (let i = 0; i < 8; i++) for (const side of [-1, 1]) {
      const c = el('div', 'abs'); css(c, { width: '80px', height: '900px', background: 'linear-gradient(90deg, #6d6f6c, #a4a49e 45%, #83847f 70%, #4e504e)' });
      this.cols.push(sp.add(c, { x: side * 520, y: 0, z: 200 + i * 600, pxPerCm: 1, ox: 40, oy: 900 }));
    }
    // wayfinding signs (in focus for a beat: the old name is gone)
    const sign = el('div', 'abs');
    sign.innerHTML = `<div style="width:560px;padding:26px 30px;background:#1d2126;color:#fff;font:500 30px/1.5 var(--sans);letter-spacing:-.01em;border-top:6px solid #e6e3da">
      <div style="font:500 16px var(--mono);letter-spacing:.2em;color:#9aa3ad;margin-bottom:10px">HARBOUR LINE · INTERCHANGE</div>
      <div>Exit A <span style="color:#9aa3ad">·</span> Harbour Plaza</div><div>Exit B <span style="color:#9aa3ad">·</span> Market Hall ↑</div><div>Stadium <span style="color:#9aa3ad">·</span> Gate C →</div></div>`;
    this.sign = sp.add(sign, { x: 150, y: -300, z: 900, pxPerCm: 2, ox: 0, oy: 0 });
    const sign2 = el('div', 'abs'); sign2.innerHTML = sign.innerHTML.replace('Exit A', 'Exit C').replace('Harbour Plaza', 'Pier Tower');
    sp.add(sign2, { x: -700, y: -310, z: 2100, pxPerCm: 2, ox: 0, oy: 0 });
    // cool linear ceiling light + floor reflections + the warm Exit B moving walkway far right (step-free)
    const ceil = [];
    for (let i = 0; i < 70; i++) ceil.push({ x: -300, y: -440, z: 1300 + i * 45, c: '#eef4ff', i: 0.1 }, { x: 300, y: -440, z: 1300 + i * 45, c: '#eef4ff', i: 0.1 });
    const warm = Array.from({ length: 10 }, () => ({ x: 900 + R() * 300, y: -60 - R() * 300, z: 2600 + R() * 600, c: '#ffc98e', i: 0.9 }));
    this.pl = PointLights(root, sp, [...warm, ...reflectLights(warm, 0.25)], { base: 1.6, bloom: 0.12 });
    root.insertBefore(this.pl.el, sp.root);
    // crowd: long-exposure streaks crossing at several depths
    this.crowd = [];
    for (let i = 0; i < 24; i++) {
      const p = el('div', 'abs'); const h = 1700;
      p.innerHTML = `<img src="assets/cut/human_sil.png" style="width:${h * 521 / 1788}px;height:${h}px;opacity:.6;filter:url(#mblur2) brightness(3)">`;
      this.crowd.push({ L: sp.add(p, { x: 0, y: 0, z: 350 + R() * 2600, pxPerCm: 10.3, ox: 250, oy: 1700 }), dir: R() > 0.5 ? 1 : -1, sp: 160 + R() * 140, off: R() * 2000 });
    }
    // Chen, riding up ahead of the camera, then stopping by a column
    this.chen = Chen(root);
    this.chenL = sp.add(this.chen.el, { x: -70, y: 0, z: 260, pxPerCm: 1788 / 158, ox: 260, oy: 1788 });
    // Gateway LED strip: a defocused cold-white vertical light at frame left (the device, unseen)
    this.led = el('div', 'abs', root);
    css(this.led, { left: '10px', top: '60px', width: '90px', height: '960px', background: 'linear-gradient(90deg, rgba(235,244,255,0), rgba(240,246,255,1) 50%, rgba(235,244,255,0))', filter: 'blur(22px)', opacity: 0, mixBlendMode: 'screen' });
    this.sub = Subtitle(root, 'May I?', 'lyra');
  },
  update(lt, t) {
    // escalator: rising from below the floor, moving forward; then settling beside her
    const cy = kf(lt, [[0, 60], [2.8, -150, E.cine]]);
    const cz = kf(lt, [[0, -520], [2.8, -300, E.cine], [5.5, -170, E.cine]]);
    const cx = kf(lt, [[0, 0], [2.8, -40], [5.5, -120, E.cine]]);
    // rack focus: far signs sharp while she searches (1.4–2.6), then back on her
    const focus = kf(lt, [[0, 800], [1.4, 1200], [2.0, 1200], [2.8, 560, E.cine], [5.5, 430]]);
    this.sp.pose({ x: cx, y: cy, z: cz, focus, aperture: 20 });
    // Chen walks forward, then stops (3.0) and unfolds the note
    this.chenL.z = kf(lt, [[0, 260], [3.0, 420, E.settle]]);
    this.chenL.x = kf(lt, [[0, -70], [3.0, -160, E.settle]]);
    for (const c of this.crowd) c.L.x = ((c.off + c.dir * lt * c.sp) % 2400 + 2400) % 2400 - 1200;
    this.sp.pose({});
    this.chen.update({ rimK: 0.35 + 0.4 * clamp((lt - 3.0) / 1.5) });
    this.pl.draw(t);
    this.led.style.opacity = (0.95 * clamp((lt - 3.0) / 1.2)).toFixed(3);
    this.sub.update(lt - 4.3, 0.5, 0.8);
  },
};

export const SCENES_HUMAN = [hook, note, phone, interchange];
