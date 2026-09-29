// 52–60  AI CITY — Row 12 Seat 7 ("Last stop"), rise to 100 m (the Paragons around the
// bowl read as clock ticks), rise to 500 m (seven bells light the old Route 7, then the
// city), the end card (a pencil stroke and a route cross into the X).
import { el, css, kf, E, clamp, inv, lerp, rng, reveal, spline, W, H } from './engine.js';
import { Space } from './space.js';
import { PointLights, reflectLights } from './env.js';
import { City, drawStadium } from './city.js';
import { StopCard, Note } from './route7.js';
import { MARK, WORD, LOCKUP, markSVG, wordmarkSVG } from './brand.js';

// ------------------------------------------------------------ 52.0–54.0  the seat
export const seat = {
  id: 'seat', t0: 52.0, t1: 54.0,
  build(root) {
    css(root, { background: 'linear-gradient(180deg, #04060b 0%, #0a0f1a 30%, #121820 46%, #0a100c 60%, #030504 100%)' });
    const sp = this.sp = new Space(root, { F: 1150 });
    const R = rng(101);
    const banks = [];
    for (const [bx, by] of [[-2600, -1500], [-900, -1700], [900, -1700], [2600, -1500]])
      for (let k = 0; k < 16; k++) banks.push({ x: bx + (k % 4) * 60, y: by - Math.floor(k / 4) * 60, z: 3000, c: '#f6f9ff', i: 1.0 });
    const stand = Array.from({ length: 420 }, () => ({ x: -3600 + R() * 7200, y: -60 - R() * 520, z: 5200 + R() * 800, c: R() < 0.55 ? '#ffe2b8' : '#dfe8ff', i: 0.18 + R() * 0.25 }));
    this.pl = PointLights(root, sp, [...banks, ...stand], { base: 2.6 });
    root.insertBefore(this.pl.el, sp.root);
    // the pitch below: a floodlit green plane in true perspective, out of focus
    const pitchWrap = el('div', 'layer', root);
    css(pitchWrap, { perspective: '900px', perspectiveOrigin: '50% 20%', filter: 'blur(14px) saturate(0.7) brightness(0.62)' });
    const pitch = el('div', 'abs', pitchWrap);
    css(pitch, { left: '-600px', top: '600px', width: '3100px', height: '1500px', transformOrigin: '50% 0', transform: 'rotateX(74deg)',
      background: 'radial-gradient(60% 80% at 50% 10%, rgba(255,255,255,0.18), rgba(0,0,0,0.35)), repeating-linear-gradient(90deg, #2a6e40 0 180px, #25623a 180px 360px)', boxShadow: 'inset 0 0 0 10px rgba(255,255,255,0.5)' });
    pitch.innerHTML = `<div style="position:absolute;left:50%;top:0;bottom:0;width:8px;background:rgba(255,255,255,.7)"></div><div style="position:absolute;left:50%;top:50%;width:520px;height:520px;margin:-260px 0 0 -260px;border:8px solid rgba(255,255,255,.7);border-radius:50%"></div>`;
    const glow = el('div', 'layer', root); css(glow, { background: 'linear-gradient(180deg, rgba(200,215,255,0.0) 30%, rgba(200,215,255,0.12) 52%, rgba(0,0,0,0) 62%), radial-gradient(70% 40% at 50% 75%, rgba(80,160,110,0.12), rgba(0,0,0,0) 70%)' });
    // the note, raised high like a banner, catching the floodlight
    this.noteWrap = el('div', 'abs', root);
    this.note = Note(this.noteWrap);
    css(this.noteWrap, { left: '0', top: '0', transformOrigin: '0 0' });
    this.stop = StopCard(root, { no: '07', name: 'Harbour Depot', sub: 'Route 7 · 19:28' });
    this.stopName = this.stop.el.querySelector('.name');
  },
  update(lt, t) {
    this.sp.pose({ x: 0, y: -150, z: -300, focus: 5000, aperture: 10 });
    this.pl.draw(t);
    const up = E.glide(inv(0.1, 1.0, lt));
    const s = 0.52;
    css(this.noteWrap, { transform: `translate(${lerp(560, 520, up)}px, ${lerp(1180, 250, up)}px) rotate(${lerp(-3, -9, up)}deg) scale(${s})`, filter: `brightness(${lerp(0.7, 1.08, up)})` });
    this.noteWrap.style.transform += ` rotate(${Math.sin(t * 3.1) * 0.8}deg)`;
    this.stop.update(lt - 0.05, { hold: 3 });
    // the plate flips: Harbour Depot -> Last stop
    this.stopName.textContent = lt > 0.55 ? 'Last stop' : 'Harbour Depot';
    this.stopName.style.filter = lt > 0.45 && lt < 0.65 ? `blur(${(1 - Math.abs(lt - 0.55) * 10) * 5}px)` : 'none';
  },
};

// ------------------------------------------------------------ 54.0–57.0  100 m -> 500 m
const ROUTE = [["01", "St. Mary's"], ['02', 'Western Univ'], ['03', 'Harbour Hotel'], ['04', 'Pier Tower'], ['05', 'Harbour Interchange'], ['06', 'Market Hall'], ['07', 'Harbour Depot']];
export const rise = {
  id: 'rise', t0: 54.0, t1: 57.0,
  build(root) {
    css(root, { background: '#020304' });
    this.c = City(root, { seed: 7, nodes: 460 });
    const S = this.c.city.size;
    this.st = [S / 2, S / 2 + 60];
    drawStadium(this.c.city, this.st[0], this.st[1], { rx: 105, ry: 80, a: -0.35 });
    // the seven stops of the old Route 7, far (01) to near (07, the stadium plaza)
    const R = rng(7);
    this.route = ROUTE.map(([no, name], i) => {
      const k = i / 6;
      const x = this.st[0] - 900 * (1 - k) + Math.sin(k * 5) * 160 + (i === 6 ? 200 : 0);
      const y = this.st[1] - 1500 * (1 - k) + (i === 6 ? 140 : 0);
      const n = el('div', 'abs', this.c.plane);
      css(n, { left: x - 40 + 'px', top: y - 40 + 'px', width: '80px', height: '80px', borderRadius: '50%', opacity: 0, mixBlendMode: 'screen',
        background: 'radial-gradient(circle, #fff 0 7%, rgba(235,242,255,0.7) 13%, rgba(190,210,255,0.15) 34%, rgba(0,0,0,0) 62%)' });
      const lab = el('div', 'node-label', root, `${no} · ${name}`);
      const line = el('div', 'abs', root); css(line, { width: '1px', background: 'rgba(255,255,255,0.6)' });
      return { x, y, n, lab, line };
    });
    // the four Paragons around the bowl, as their true light shape: two white rectangles
    this.glyphs = [0, 1, 2, 3].map(i => {
      const a = -0.35 + i * Math.PI / 2 + 0.6;
      const x = this.st[0] + Math.cos(a) * 165, y = this.st[1] + Math.sin(a) * 128;
      const g = el('div', 'abs', this.c.plane);
      css(g, { left: x - 3 + 'px', top: y - 8 + 'px', width: '6px', height: '16px', opacity: 0 });
      g.innerHTML = `<i style="position:absolute;left:0;top:0;width:6px;height:4px;background:#fff;box-shadow:0 0 6px 1px rgba(255,255,255,.8)"></i><i style="position:absolute;left:0;bottom:0;width:6px;height:4px;background:#fff;box-shadow:0 0 6px 1px rgba(255,255,255,.8)"></i>`;
      return g;
    });
  },
  update(lt, t) {
    // camera: 100 m over the bowl, a held beat, then up to 500 m over the city
    const u = spline(t, [[54.0, 0], [55.2, 0.06], [55.5, 0.12], [56.6, 0.9], [57.0, 1]]);
    const s = lerp(4.6, 0.8, u), rx = lerp(34, 60, u), rz = lerp(-8, -22, u), ty = lerp(120, 70, u);
    // centre the stadium: translate the plane so the bowl stays near frame centre
    const S = this.c.city.size;
    const tx = -(this.st[0] - S / 2) * s, tyy = ty - (this.st[1] - S / 2) * s * Math.cos(rx * Math.PI / 180);
    const beat = Math.pow(0.5 + 0.5 * Math.cos((t - 52) * Math.PI * 2 * 1), 3);
    const reveal = t < 56.4 ? 0 : E.glide(inv(56.4, 57.0, t)) * (0.4 + 0.6 * inv(56.4, 57.0, t));
    this.c.update(t, { rx, rz, s, ty: tyy, tx, reveal, beat: t > 56.4 ? beat : 0, dim: 1 });
    const tr = this.c.plane.style.transform;
    // Paragon glyphs readable at 100 m, then they become points
    this.glyphs.forEach(g => { g.style.opacity = (clamp((t - 54.1) / 0.3) * (1 - clamp((t - 55.9) / 0.5))).toFixed(3); g.style.transform = `scale(${lerp(1, 2.2, u)})`; });
    // seven bells, eighth notes, far to near: 55.25 ... 56.75
    this.route.forEach((R, i) => {
      const tb = 55.25 + i * 0.25, k = clamp((t - tb) / 0.12), after = clamp((t - tb) / 0.9);
      R.n.style.opacity = t < tb ? 0 : (0.55 + 0.45 * (1 - after)).toFixed(3);
      R.n.style.transform = `scale(${lerp(0.4, 1.4, E.snap(k)) * (1 + (1 - after) * 0.6) * lerp(1, 2.2, u)})`;
      const p = this.c.project(R.x, R.y, tr);
      const on = t >= tb ? clamp((t - tb) / 0.15) * (1 - clamp((t - tb - 0.6) / 0.25)) : 0;
      css(R.line, { left: p[0] + 'px', top: p[1] - 56 + 'px', height: '56px', opacity: on });
      css(R.lab, { transform: `translate(${p[0] + 8}px, ${p[1] - 68}px)`, opacity: on });
    });
  },
};

// ------------------------------------------------------------ 57.0–60.0  end card
export const endcard = {
  id: 'endcard', t0: 57.0, t1: 60.01,
  build(root) {
    css(root, { background: '#000' });
    const size = 150, mw = size * MARK.w / 100;
    const wh = size * LOCKUP.wordH, gap = size * LOCKUP.gap, ww = wh * WORD.w / 100;
    const total = mw + gap + ww, x0 = 960 - total / 2, y0 = 300;
    this.geo = { size, mw, x0, y0 };
    // two strokes: pencil (bottom-left -> top-right), route (bottom-right -> top-left)
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    css(svg, { position: 'absolute', left: 0, top: 0, overflow: 'visible' });
    svg.innerHTML = `<defs><filter id="graph"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0.62  0 0 0 0 0.62  0 0 0 0 0.66  0 0 0 -2.2 1.6"/><feComposite in2="SourceGraphic" operator="in"/></filter>
      <filter id="glowB" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <path class="pa" d="M${x0 + mw * 0.06} ${y0 + size * 0.95} C ${x0 + mw * 0.35} ${y0 + size * 0.62}, ${x0 + mw * 0.62} ${y0 + size * 0.38}, ${x0 + mw * 0.96} ${y0 + size * 0.05}" fill="none" stroke="#9c9ca3" stroke-width="11" stroke-linecap="round" pathLength="1" stroke-dasharray="1 1" filter="url(#graph)"/>
      <path class="pb" d="M${x0 + mw * 0.94} ${y0 + size * 0.95} C ${x0 + mw * 0.66} ${y0 + size * 0.64}, ${x0 + mw * 0.38} ${y0 + size * 0.36}, ${x0 + mw * 0.05} ${y0 + size * 0.06}" fill="none" stroke="#2f5bea" stroke-width="9" stroke-linecap="round" pathLength="1" stroke-dasharray="1 1" filter="url(#glowB)"/>`;
    root.appendChild(svg);
    this.pa = svg.querySelector('.pa'); this.pb = svg.querySelector('.pb');
    this.mark = el('div', 'abs', root, markSVG({ size, glow: 0 }));
    css(this.mark, { left: x0 + 'px', top: y0 + 'px', opacity: 0 });
    this.word = el('div', 'abs', root, wordmarkSVG({ height: wh }));
    css(this.word, { left: x0 + mw + gap + 'px', top: y0 + size * LOCKUP.wordTop + 'px', opacity: 0 });
    this.title = el('div', 'title-xl', root, 'AI City');
    css(this.title, { left: 0, right: 0, textAlign: 'center', top: '500px', fontSize: '176px' });
    this.tag = el('div', 'abs', root, 'Ask the city<span class="dot">.</span>');
    css(this.tag, { left: 0, right: 0, top: '730px', textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '64px', color: '#fff' });
    this.dot = this.tag.querySelector('.dot');
    this.credit = el('div', 'abs', root, 'SPEC FILM · PICTURE, UI, MOTION AND SOUND WRITTEN IN CODE BY CLAUDE');
    css(this.credit, { left: 0, right: 0, top: '996px', textAlign: 'center', font: '500 15px var(--mono)', letterSpacing: '0.24em', color: 'rgba(255,255,255,0.38)' });
    this.flash = el('div', 'layer', root); css(this.flash, { background: 'radial-gradient(14% 20% at 44% 36%, rgba(255,255,255,0.55), rgba(0,0,0,0) 70%)', opacity: 0, mixBlendMode: 'screen' });
  },
  update(lt, t) {
    // 57.3–57.9 the strokes draw; 57.9 they cross and become the mark (white)
    const da = E.settle(inv(57.3, 57.85, t)), db = E.settle(inv(57.42, 57.9, t));
    this.pa.setAttribute('stroke-dashoffset', 1 - da); this.pb.setAttribute('stroke-dashoffset', 1 - db);
    const x = inv(57.9, 58.15, t);
    this.pa.style.opacity = this.pb.style.opacity = (1 - x).toFixed(3);
    this.mark.style.opacity = x.toFixed(3);
    this.mark.style.filter = `drop-shadow(0 0 ${lerp(26, 0, x)}px rgba(255,255,255,${0.9 * (1 - x)}))`;
    this.flash.style.opacity = (Math.max(0, 1 - Math.abs(t - 57.93) / 0.18) * 0.8).toFixed(3);
    reveal(this.word, E.settle(inv(58.2, 58.7, t)), { y: 0, blur: 10, scale: 1 });
    reveal(this.title, E.settle(inv(58.6, 59.3, t)), { y: 14, blur: 18, scale: 1.02 });
    reveal(this.tag, E.settle(inv(59.1, 59.6, t)), { y: 8, blur: 10, scale: 1 });
    // the full stop: her scarf red -> LiveX blue
    const c = inv(59.3, 59.6, t);
    this.dot.style.color = `rgb(${lerp(200, 47, c) | 0},${lerp(55, 91, c) | 0},${lerp(45, 234, c) | 0})`;
    this.credit.style.opacity = (0.9 * inv(59.35, 59.7, t)).toFixed(3);
  },
};

export const SCENES_FINAL = [seat, rise, endcard];
