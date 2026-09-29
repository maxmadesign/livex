// Route 7 — the film's own graphic objects. Everything here is drawn in code:
// the 1985 destination blind, the pencil note, the flip phone, stop cards,
// subtitles in two voices, rain, the clock tower, the split-flap rewind, fabrics.
import { el, css, rng, clamp, lerp, inv, E, reveal, noise1, W, H } from './engine.js';

// ---------------------------------------------------------------- stop card
// "05 · Harbour Interchange" — the bus-stop plate that marks every numbered stop.
export function StopCard(parent, { no = '', name = '', sub = 'Route 7', x = 96, y = 912 } = {}) {
  const c = el('div', 'stop', parent);
  css(c, { left: x + 'px', top: y + 'px' });
  const main = el('div', 'main', c, `${no ? `<span class="no">${no}</span><span style="opacity:.5">·</span>` : ''}<span class="name">${name}</span>`);
  const s = el('div', 'sub', c, sub);
  return {
    el: c, subEl: s,
    // t: seconds since the ding. In 0.32 s, hold, out after `hold`
    update(t, { hold = 1.4, subText = null } = {}) {
      if (subText != null) s.textContent = subText;
      const pin = E.glide(clamp(t / 0.32));
      const pout = E.exit(clamp((t - hold) / 0.35));
      c.style.display = t < 0 || pout >= 1 ? 'none' : 'flex';
      c.style.opacity = (pin * (1 - pout)).toFixed(3);
      c.style.transform = `translateX(${(1 - pin) * -16}px)`;
      c.style.filter = pout > 0 ? `blur(${pout * 8}px)` : (pin < 1 ? `blur(${(1 - pin) * 6}px)` : 'none');
    },
  };
}

// ---------------------------------------------------------------- subtitles
// People speak in Instrument Serif italic; Lyra speaks in Geist. Two typefaces,
// two voices — the audience learns it without being told.
export function Subtitle(parent, text, who = 'human', { y = 858, tone = 'light' } = {}) {
  const s = el('div', who === 'lyra' ? 'sub-lyra' : 'sub-human', parent);
  css(s, { top: y + 'px' });
  if (tone === 'dark') css(s, { color: '#16181b', textShadow: '0 0 24px rgba(255,255,255,0.8)' });
  const words = text.split(' ').map((w, i, a) => el('span', 'w', s, w + (i < a.length - 1 ? ' ' : '')));
  return {
    el: s,
    // t since line start; dur = spoken length; out after hold
    update(t, dur = 1.2, hold = 1.0) {
      const vis = t >= 0 && t < dur + hold + 0.3;
      s.style.display = vis ? 'block' : 'none';
      if (!vis) return;
      const n = words.length;
      words.forEach((w, i) => reveal(w, E.settle(clamp((t / dur) * (n + 1) - i)), { y: 6, blur: 6, scale: 1 }));
      const out = clamp((t - dur - hold) / 0.3);
      s.style.opacity = 1 - out;
    },
  };
}

// ---------------------------------------------------------------- 16mm, 1985
// A 4:3 window with gate weave, flicker, coarse grain, halation and a warm/teal grade.
export function Film16(parent) {
  const gate = el('div', 'abs', parent);
  css(gate, { left: '240px', top: '0', width: '1440px', height: '1080px', overflow: 'hidden', background: '#0b0908' });
  const inner = el('div', 'abs', gate); css(inner, { width: '1440px', height: '1080px' });
  const hal = el('div', 'abs', gate); css(hal, { inset: '0', pointerEvents: 'none' });
  const grade = el('div', 'abs', gate);
  css(grade, { inset: '0', background: 'linear-gradient(180deg, rgba(20,60,64,0.28), rgba(40,30,20,0.18))', mixBlendMode: 'multiply' });
  const warm = el('div', 'abs', gate);
  css(warm, { inset: '0', background: 'radial-gradient(70% 60% at 50% 45%, rgba(255,190,120,0.16), rgba(0,0,0,0) 70%)', mixBlendMode: 'screen' });
  const vig = el('div', 'abs', gate);
  css(vig, { inset: '0', background: 'radial-gradient(85% 80% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.65) 100%)' });
  const g = el('canvas', 'abs', gate); g.width = 480; g.height = 360;
  css(g, { width: '1440px', height: '1080px', mixBlendMode: 'overlay', opacity: 0.55, imageRendering: 'auto' });
  const gx = g.getContext('2d'); const id = gx.createImageData(480, 360);
  const dust = el('canvas', 'abs', gate); dust.width = 1440; dust.height = 1080; css(dust, { opacity: 0.7 });
  const dx = dust.getContext('2d');
  const label = el('div', 'year', gate, '1985'); css(label, { left: '56px', top: '48px' });
  return {
    gate, inner, label,
    // open in [0,1]: 4:3 -> 16:9 (the matte opens on the match cut)
    update(t, { open = 0 } = {}) {
      const f = Math.floor(t * 24), r = rng(777 + f * 131);
      const wx = (r() - 0.5) * 3, wy = (r() - 0.5) * 3, rot = (r() - 0.5) * 0.08;
      inner.style.transform = `translate(${wx}px, ${wy}px) rotate(${rot}deg)`;
      inner.style.filter = `brightness(${1 + (r() - 0.5) * 0.07}) contrast(1.08) saturate(0.85)`;
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) { const v = 128 + (r() + r() - 1) * 150; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      gx.putImageData(id, 0, 0);
      dx.clearRect(0, 0, 1440, 1080);
      if (r() < 0.5) { dx.fillStyle = 'rgba(255,255,255,0.5)'; for (let k = 0; k < 3; k++) { dx.beginPath(); dx.arc(r() * 1440, r() * 1080, r() * 2.5 + 0.5, 0, 7); dx.fill(); } }
      if (r() < 0.25) { dx.strokeStyle = 'rgba(0,0,0,0.35)'; dx.lineWidth = 1; const x = r() * 1440; dx.beginPath(); dx.moveTo(x, 0); dx.lineTo(x + (r() - 0.5) * 20, 1080); dx.stroke(); }
      const w = lerp(1440, 1920, E.cine(open));
      css(gate, { left: (1920 - w) / 2 + 'px', width: w + 'px' });
    },
  };
}

// The destination blind of a 1985 route 7 bus: backlit fabric, rolling on a drum.
export function RollSign(parent, { entries = [['5', 'WESTERN UNIV'], ['6', 'MARKET HALL'], ['7', 'HARBOUR DEPOT']] } = {}) {
  const box = el('div', 'abs', parent);
  css(box, { left: '120px', top: '300px', width: '1200px', height: '420px', background: 'linear-gradient(180deg, #1b1714, #0d0b0a)', borderRadius: '10px', boxShadow: 'inset 0 0 0 14px #231d19, inset 0 0 40px rgba(0,0,0,0.9), 0 30px 80px rgba(0,0,0,0.7)', overflow: 'hidden' });
  const win = el('div', 'abs', box);
  css(win, { left: '40px', top: '40px', right: '40px', bottom: '40px', overflow: 'hidden', background: '#080707', borderRadius: '4px' });
  const band = el('div', 'abs', win); css(band, { left: '0', right: '0', top: '0' });
  const ROW = 340;
  entries.forEach(([no, dest], i) => {
    const row = el('div', 'abs', band);
    css(row, { top: i * ROW + 'px', left: '0', right: '0', height: ROW + 'px', display: 'flex', alignItems: 'center', gap: '44px', padding: '0 56px',
      font: "700 132px/1 'Barlow Cond', 'Inter Tight', sans-serif", letterSpacing: '0.02em', color: '#fff6e4', textShadow: '0 0 18px rgba(255,210,150,0.55), 0 0 2px #fff' });
    row.innerHTML = `<span class="rs-no" style="font-size:250px;line-height:1">${no}</span><span>${dest}</span>`;
  });
  // fabric texture + backlight falloff + glass
  const fab = el('div', 'abs', win);
  css(fab, { inset: '0', background: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0 1px, rgba(0,0,0,0.05) 1px 3px), radial-gradient(90% 120% at 50% 50%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)' });
  const glass = el('div', 'abs', box);
  css(glass, { inset: '0', background: 'linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.09) 42%, rgba(255,255,255,0) 50%)' });
  return {
    box, band, ROW,
    // k: position along the blind (0 = first entry, 1 = second, ...), fractional while rolling
    update(k) { band.style.transform = `translateY(${-k * ROW}px)`; },
    sevenRect() { return band.querySelectorAll('.rs-no')[entries.length - 1].getBoundingClientRect(); },
  };
}

// ---------------------------------------------------------------- the pencil note
// A folded ivory note in the granddaughter's pencil hand. Paper is procedural.
let _graphite = null;
function graphiteURL() {
  if (_graphite) return _graphite;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), r = rng(19), im = g.createImageData(256, 256);
  for (let i = 0; i < im.data.length; i += 4) { const v = 48 + r() * 70; im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v + 6; im.data[i + 3] = 150 + r() * 105; }
  g.putImageData(im, 0, 0); _graphite = c.toDataURL(); return _graphite;
}
let _paper = null;
function paperURL(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), r = rng(23);
  g.fillStyle = '#f2ede2'; g.fillRect(0, 0, w, h);
  const im = g.getImageData(0, 0, w, h), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const v = (r() - 0.5) * 10; d[i] += v; d[i + 1] += v; d[i + 2] += v - 1; }
  g.putImageData(im, 0, 0);
  g.globalAlpha = 0.05; g.strokeStyle = '#8a7f6a';
  for (let k = 0; k < 900; k++) { const x = r() * w, y = r() * h, a = r() * Math.PI, L = 4 + r() * 16; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke(); }
  g.globalAlpha = 1;
  // fold crease
  const gr = g.createLinearGradient(w / 2 - 30, 0, w / 2 + 30, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.48, 'rgba(0,0,0,0.07)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.53, 'rgba(0,0,0,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.92);
}

export const NOTE_LINES = [
  { t: '奶奶 —', font: "'Long Cang', 'Nanum Pen', cursive", size: 118, x: 110, y: 90 },
  { t: 'Gate C · 114', size: 132, x: 110, y: 250 },
  { t: 'Row 12 · Seat 7', size: 132, x: 110, y: 410, seven: true },
  { t: '19:30 ♡ 林', size: 124, x: 110, y: 575, lin: true },
];
export function Note(parent, { w = 1300, h = 820 } = {}) {
  const n = el('div', 'abs', parent);
  css(n, { width: w + 'px', height: h + 'px', backgroundImage: `url(${paperURL(w, h)})`, backgroundSize: 'cover', borderRadius: '6px', boxShadow: '0 40px 90px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.25)', transformOrigin: '50% 50%' });
  const lines = NOTE_LINES.map(L => {
    const d = el('div', 'abs', n);
    let html = L.t;
    if (L.seven) html = L.t.replace(/7$/, '<span class="seven">7</span>');
    if (L.lin) html = L.t.replace('林', `<span style="font-family:'Long Cang',cursive">林</span>`);
    d.innerHTML = html;
    css(d, { left: L.x + 'px', top: L.y + 'px', font: `${L.size}px/1.1 ${L.font || 'var(--hand)'}`, whiteSpace: 'nowrap', color: 'transparent',
      backgroundImage: `url(${graphiteURL()})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', transform: `rotate(${(L.y % 7) * 0.25 - 0.8}deg)`, letterSpacing: '0.01em' });
    return d;
  });
  // the pencil line under "Seat 7" — becomes the first stroke of the X at the end
  const under = el('div', 'abs', n);
  under.innerHTML = `<svg width="600" height="60" viewBox="0 0 600 60"><path d="M8 38 C160 22 330 44 590 18" fill="none" stroke="#3b3b40" stroke-width="7" stroke-linecap="round" opacity=".82"/></svg>`;
  css(under, { left: '520px', top: '532px', transform: 'scale(0.72, 1)', transformOrigin: '0 50%' });
  return { el: n, lines, seven: n.querySelector('.seven'), under, w, h };
}

// ---------------------------------------------------------------- flip phone
export function FlipPhone(parent, { from = 'Ming', text = "Mum, I'll come get you?" } = {}) {
  const p = el('div', 'abs', parent);
  css(p, { width: '420px', height: '820px', perspective: '1400px' });
  const lower = el('div', 'abs', p);
  css(lower, { left: '0', top: '410px', width: '420px', height: '410px', borderRadius: '18px 18px 40px 40px', background: 'linear-gradient(180deg, #3a3d44, #1b1d21)', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.06)' });
  const keys = el('div', 'abs', lower);
  css(keys, { left: '60px', top: '70px', width: '300px', height: '270px', background: 'repeating-linear-gradient(90deg, transparent 0 88px, rgba(0,0,0,0.35) 88px 100px), repeating-linear-gradient(0deg, transparent 0 58px, rgba(0,0,0,0.35) 58px 68px)', opacity: 0.7, borderRadius: '10px' });
  const upper = el('div', 'abs', p);
  css(upper, { left: '0', top: '0', width: '420px', height: '410px', borderRadius: '40px 40px 18px 18px', background: 'linear-gradient(180deg, #43464e, #26282d)', transformOrigin: '50% 100%', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.08)' });
  const scr = el('div', 'abs', upper);
  css(scr, { left: '38px', top: '46px', right: '38px', bottom: '40px', borderRadius: '10px', background: 'linear-gradient(180deg, #0f2238, #0a1422)', padding: '28px', color: '#dfeaff', font: '600 34px/1.25 var(--sans)', boxShadow: 'inset 0 0 30px rgba(0,0,0,0.6)' });
  scr.innerHTML = `<div style="font:500 22px var(--mono);letter-spacing:.12em;opacity:.7">MESSAGE · 18:29</div><div style="margin-top:18px;font-size:40px">${from}</div><div style="margin-top:8px;font-weight:400">${text}</div>`;
  return {
    el: p,
    // close in [0,1]: the upper half snaps shut toward the camera
    update(close = 0) {
      upper.style.transform = `rotateX(${-close * 178}deg)`;
      scr.style.opacity = 1 - clamp(close * 2);
    },
  };
}

// ---------------------------------------------------------------- rain
export function Rain(parent, { seed = 5, count = 520, angle = 8, color = 'rgba(210,225,255,0.35)' } = {}) {
  const cv = el('canvas', 'fill', parent); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), r = rng(seed);
  const drops = Array.from({ length: count }, () => ({ x: r() * W * 1.2, y: r() * H, z: r(), s: 0.7 + r() * 0.6 }));
  return {
    el: cv,
    draw(t, { gain = 1 } = {}) {
      g.clearRect(0, 0, W, H);
      g.strokeStyle = color; g.lineCap = 'round';
      const a = angle * Math.PI / 180;
      for (const d of drops) {
        const sp = 1400 + d.z * 1800, len = 18 + d.z * 46;
        const y = (d.y + t * sp * d.s) % (H + 80) - 40, x = d.x - Math.tan(a) * y;
        g.globalAlpha = (0.25 + d.z * 0.75) * gain;
        g.lineWidth = 0.6 + d.z * 1.4;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.sin(a) * len, y - Math.cos(a) * len); g.stroke();
      }
      g.globalAlpha = 1;
    },
  };
}

// ---------------------------------------------------------------- the 1978 clock tower
// Red brick, a warm lit clock face (hands at 18:52), stone cornice. Authored in cm.
export function ClockTower(parent, { hCm = 1400 } = {}) {
  const t = el('div', 'abs', parent);
  const W0 = 360, H0 = hCm;
  css(t, { width: W0 + 'px', height: H0 + 'px' });
  t.innerHTML = `<svg viewBox="0 0 ${W0} ${H0}" width="${W0}" height="${H0}">
    <defs><pattern id="brick" width="24" height="10" patternUnits="userSpaceOnUse"><rect width="24" height="10" fill="#5a2a22"/><path d="M0 9.5H24M12 0V5M0 5H24M0 5V10M24 5V10" stroke="#3a1914" stroke-width="1"/></pattern>
    <radialGradient id="face" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff2d6"/><stop offset=".8" stop-color="#ffd9a0"/><stop offset="1" stop-color="#c98a45"/></radialGradient>
    <linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="rgba(0,0,0,.55)"/><stop offset=".45" stop-color="rgba(0,0,0,.1)"/><stop offset="1" stop-color="rgba(0,0,0,.6)"/></linearGradient></defs>
    <rect x="40" y="220" width="280" height="${H0 - 220}" fill="url(#brick)"/>
    <rect x="40" y="220" width="280" height="${H0 - 220}" fill="url(#shade)"/>
    <path d="M20 220 H340 V250 H20 Z" fill="#6f625a"/><path d="M60 60 L180 0 L300 60 V220 H60 Z" fill="#3c1c17"/>
    <circle cx="180" cy="360" r="92" fill="#2a1410"/><circle cx="180" cy="360" r="80" fill="url(#face)"/>
    <g stroke="#3a2618" stroke-width="7" stroke-linecap="round"><line x1="180" y1="360" x2="180" y2="304"/><line x1="180" y1="360" x2="226" y2="382"/></g>
    ${Array.from({ length: 12 }, (_, i) => { const a = i / 12 * Math.PI * 2; return `<line x1="${180 + Math.sin(a) * 66}" y1="${360 - Math.cos(a) * 66}" x2="${180 + Math.sin(a) * 74}" y2="${360 - Math.cos(a) * 74}" stroke="#6b4a2e" stroke-width="4"/>`; }).join('')}
    <rect x="140" y="${H0 - 260}" width="80" height="260" rx="40" fill="#1c0e0b"/>
  </svg>`;
  const glow = el('div', 'abs', t);
  css(glow, { left: '20px', top: '200px', width: '320px', height: '320px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,200,130,0.55), rgba(255,160,80,0) 65%)', mixBlendMode: 'screen', filter: 'blur(10px)' });
  return { el: t, w: W0, h: H0 };
}

// ---------------------------------------------------------------- split-flap rewind
export function SplitFlap(parent, { digits = 2, size = 220 } = {}) {
  const wrap = el('div', 'abs', parent);
  css(wrap, { display: 'flex', gap: size * 0.08 + 'px', perspective: '900px' });
  const cells = Array.from({ length: digits }, () => {
    const c = el('div', '', wrap);
    css(c, { position: 'relative', width: size * 0.66 + 'px', height: size + 'px', background: '#161719', borderRadius: size * 0.05 + 'px', boxShadow: '0 20px 50px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.06)', font: `600 ${size * 0.78}px/${size}px var(--mono)`, color: '#f4f1ea', textAlign: 'center', overflow: 'hidden' });
    const top = el('div', 'abs', c); const bot = el('div', 'abs', c); const flap = el('div', 'abs', c);
    for (const [e, o] of [[top, 0], [bot, 1], [flap, 0]]) css(e, { left: 0, right: 0, height: size / 2 + 'px', top: o ? size / 2 + 'px' : 0, overflow: 'hidden', background: '#1b1c1f' });
    css(flap, { transformOrigin: '50% 100%', zIndex: 2, backfaceVisibility: 'hidden' });
    const hinge = el('div', 'abs', c); css(hinge, { left: 0, right: 0, top: size / 2 - 1 + 'px', height: '2px', background: '#050506', zIndex: 3 });
    return { c, top, bot, flap };
  });
  const face = (e, ch, half) => { e.innerHTML = `<div style="height:${size}px;${half ? `margin-top:-${size / 2}px` : ''}">${ch}</div>`; };
  return {
    el: wrap,
    // set(from, to, k): flipping from string `from` to `to` with progress k in [0,1]
    set(from, to, k) {
      cells.forEach((C, i) => {
        const a = from[i], b = to[i];
        if (a === b || k <= 0) { face(C.top, a, 0); face(C.bot, a, 1); C.flap.style.display = 'none'; return; }
        if (k >= 1) { face(C.top, b, 0); face(C.bot, b, 1); C.flap.style.display = 'none'; return; }
        face(C.top, b, 0); face(C.bot, a, 1);
        C.flap.style.display = 'block';
        if (k < 0.5) { css(C.flap, { top: 0, transformOrigin: '50% 100%', transform: `rotateX(${-k * 2 * 90}deg)` }); face(C.flap, a, 0); }
        else { css(C.flap, { top: size / 2 + 'px', transformOrigin: '50% 0%', transform: `rotateX(${(1 - (k - 0.5) * 2) * 90}deg)` }); face(C.flap, b, 1); }
      });
    },
  };
}

// ---------------------------------------------------------------- fabrics
export function knitCSS(color = '#c8372d') {
  return `repeating-linear-gradient(90deg, rgba(0,0,0,0.18) 0 3px, rgba(0,0,0,0) 3px 22px), repeating-linear-gradient(60deg, rgba(255,255,255,0.10) 0 6px, rgba(0,0,0,0.12) 6px 12px), repeating-linear-gradient(-60deg, rgba(255,255,255,0.06) 0 6px, rgba(0,0,0,0.1) 6px 12px), ${color}`;
}
export function stripeCSS() {
  return 'repeating-linear-gradient(90deg, #14213d 0 70px, #f4f1ea 70px 96px, #14213d 96px 118px, #f4f1ea 118px 144px), #14213d';
}

// ---------------------------------------------------------------- the protagonist
// Chen: a real human silhouette (158 cm), lit on her edges by whatever screen she
// faces, and the only warm red in the film — her hand-knitted scarf.
export function Chen(parent, { rim = 0.55, scarf = true, stripes = 0, backpack = false, flip = false, tone = 1, warmRim = false } = {}) {
  const c = el('div', 'abs', parent);
  css(c, { width: '521px', height: '1788px' });
  const inner = el('div', 'abs', c);
  css(inner, { width: '521px', height: '1788px', transform: flip ? 'scaleX(-1)' : 'none' });
  if (backpack) {
    const bp = el('div', 'abs', inner);
    css(bp, { left: '150px', top: '330px', width: '230px', height: '330px', borderRadius: '70px 70px 40px 40px', background: '#0b0a0a' });
  }
  inner.insertAdjacentHTML('beforeend', `<img src="assets/cut/human_sil.png" style="position:absolute;left:0;top:0;width:521px;height:1788px${tone !== 1 ? `;filter:brightness(${tone})` : ''}">
    <img class="rim" src="assets/cut/human_rim.png" style="position:absolute;left:0;top:0;width:521px;height:1788px;mix-blend-mode:screen;filter:${warmRim ? 'sepia(1) saturate(2.4) hue-rotate(-12deg) blur(3px)' : 'blur(1.5px)'}">`);
  // scarf: wrapped at the neck, one end falling over the chest
  const sc = el('div', 'abs', inner);
  css(sc, { left: '188px', top: '300px', width: '150px', height: '250px', borderRadius: '44% 44% 30% 30% / 26% 26% 60% 60%', background: knitCSS(), boxShadow: 'inset 0 -30px 40px rgba(0,0,0,0.55)', filter: 'brightness(0.75) blur(2px)', display: scarf ? 'block' : 'none' });
  const st = el('div', 'abs', inner);
  css(st, { left: '206px', top: scarf ? '318px' : '305px', width: '110px', height: scarf ? '70px' : '90px', borderRadius: '40% 40% 45% 45%', background: stripeCSS(), backgroundSize: '160px 100%', opacity: stripes, boxShadow: 'inset 0 -16px 22px rgba(0,0,0,0.55)', filter: 'brightness(0.8)' });
  const rimEl = inner.querySelector('.rim');
  rimEl.style.opacity = rim;
  return {
    el: c, pxPerCm: 1788 / 158,
    update({ rimK = rim, stripesK = null } = {}) { rimEl.style.opacity = rimK; if (stripesK != null) st.style.opacity = stripesK; },
  };
}
