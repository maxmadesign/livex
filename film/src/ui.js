// Lyra OS — the screen UI that runs on every LiveX node.
// One system, many places: the same grid, type, motion and voice on a 32" Portal,
// an 86" Gateway and a 65" Paragon Outdoor. Only the content changes with the place.
//
// Grid: 1080 x 1920 portrait, 64 px margins, 6 columns / 24 px gutter.
// Zones: status (52-108) · Lyra (full height, never covered above the waist)
//        · content (y >= 1160) · caption (y 1030-1150) · voice (y 1790).
import { el, css, reveal, clamp, inv, lerp, E, noise1 } from './engine.js';
import { markSVG } from './brand.js';

export function LyraScreen(screen, { mode = 'light', photo = 'white', place = '', clock = '', cut = false } = {}) {
  const os = el('div', `lyra-os ${mode === 'dark' ? 'dark' : ''}`, screen);
  const bg = el('div', 'lyra-bg', os);
  if (mode === 'dark') css(bg, { background: 'radial-gradient(120% 70% at 50% 35%, #1a2030 0%, #07090d 70%)' });
  const ph = el('img', 'lyra-photo', os);
  ph.src = cut ? `assets/cut/lyra_${photo}_cut.png` : `assets/src/lyra_${photo}.jpg`;
  const status = el('div', 'os-status', os, `
    <div class="place">${markSVG({ size: 30, color: mode === 'dark' ? '#fff' : '#0d1117' })}<span>${place}</span></div>
    <div class="os-live"><span>${clock}</span><span class="os-dot"></span></div>`);
  const content = el('div', 'layer', os);
  const dot = status.querySelector('.os-dot');
  return {
    os, bg, photo: ph, status, content, dot,
    // idle life: Lyra breathes (0.35% scale at ~0.25 Hz) and sways a hair.
    idle(t, amt = 1) {
      const b = Math.sin(t * Math.PI * 2 * 0.24) * 0.0035 * amt;
      const sway = (noise1(t * 0.35, 11) - 0.5) * 0.35 * amt;
      ph.style.transform = `scale(${1 + b}) rotate(${sway * 0.2}deg) translateX(${sway * 3}px)`;
      dot.style.boxShadow = `0 0 0 ${6 + 5 * (0.5 + 0.5 * Math.sin(t * 5))}px rgba(47,91,234,${0.1 + 0.08 * Math.sin(t * 5)})`;
    },
    statusIn(p) { reveal(status, p, { y: -8, blur: 6 }); },
  };
}

// Live caption: words land one by one (blur-to-sharp), like speech being heard.
export function Caption(parent, text, { top = 1040, size = 46, align = 'center', left = 90, right = 90 } = {}) {
  const c = el('div', 'caption', parent);
  css(c, { top: top + 'px', fontSize: size + 'px', textAlign: align, left: left + 'px', right: right + 'px' });
  const words = text.split(' ').map((w, i, a) => el('span', 'w', c, w + (i < a.length - 1 ? ' ' : '')));
  return {
    el: c,
    // p in [0,1] over the spoken line; out in [0,1] fades the whole line
    update(p, out = 0) {
      const n = words.length;
      words.forEach((w, i) => reveal(w, E.settle(clamp(p * (n + 2) - i, 0, 1) ), { y: 10, blur: 8, scale: 1 }));
      c.style.opacity = 1 - out; c.style.filter = out > 0 ? `blur(${out * 8}px)` : 'none';
    },
  };
}

// Voice line: a single calm oscilloscope stroke in LiveX blue. level 0 = listening
// (flat, breathing), 1 = speaking (organic amplitude from layered noise).
export function Voice(parent, { top = 1790, width = 420 } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} 80`); svg.setAttribute('width', width); svg.setAttribute('height', 80);
  css(svg, { position: 'absolute', left: `${540 - width / 2}px`, top: top + 'px', overflow: 'visible' });
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#2f5bea'); path.setAttribute('stroke-width', '4'); path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path); parent.appendChild(svg);
  return {
    el: svg,
    update(t, level = 0, vis = 1) {
      let d = '';
      for (let i = 0; i <= 64; i++) {
        const u = i / 64, env = Math.sin(Math.PI * u) ** 1.5;
        const a = (0.06 + level * (0.55 * noise1(t * 6 + u * 3, 3) + 0.25)) * env;
        const y = 40 + Math.sin(u * 22 + t * 9) * a * 34 + Math.sin(u * 9 - t * 5) * a * 14;
        d += (i ? ' L' : 'M') + (u * width).toFixed(1) + ' ' + y.toFixed(1);
      }
      path.setAttribute('d', d);
      svg.style.opacity = vis;
    },
  };
}

// A card whose rows arrive in sequence. rows: array of HTML strings.
export function Card(parent, { left = 64, right = 64, top = 1180, rows = [], dark = false } = {}) {
  const c = el('div', 'card', parent);
  css(c, { left: left + 'px', right: right + 'px', top: top + 'px' });
  const rs = rows.map(h => el('div', '', c, h));
  return {
    el: c, rows: rs,
    update(p, out = 0) {
      reveal(c, E.glide(clamp(p * 1.6)), { y: 28, blur: 14, scale: 0.97 });
      rs.forEach((r, i) => reveal(r, E.settle(clamp(p * 2.2 - 0.25 - i * 0.14)), { y: 14, blur: 6, scale: 1 }));
      if (out > 0) { c.style.opacity = (1 - out) * parseFloat(c.style.opacity || 1); c.style.transform += ` translateY(${-out * 18}px)`; c.style.filter = `blur(${out * 10}px)`; }
    },
  };
}

// Route map for wayfinding / navigation: architectural line plan with the path
// drawing itself and a walker dot. `plan` = svg inner HTML (walls), `route` = path d.
export function RouteMap(parent, { left = 64, top = 1180, width = 952, height = 420, plan = '', route = '', dest = '' } = {}) {
  const wrap = el('div', 'card', parent);
  css(wrap, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px', padding: '0', overflow: 'hidden' });
  wrap.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="position:absolute;inset:0">
    <g class="plan" fill="none" stroke="rgba(13,17,23,0.16)" stroke-width="2">${plan}</g>
    <path class="route-bg" d="${route}" fill="none" stroke="rgba(47,91,234,0.14)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
    <path class="route" d="${route}" fill="none" stroke="#2f5bea" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1"/>
    <circle class="walker" r="11" fill="#fff" stroke="#2f5bea" stroke-width="5"/>
    <g class="dest"><circle r="20" fill="#2f5bea"/><circle r="36" fill="none" stroke="#2f5bea" stroke-width="2" opacity=".35"/></g>
  </svg>${dest}`;
  const route_ = wrap.querySelector('.route'), walker = wrap.querySelector('.walker'), destG = wrap.querySelector('.dest'), planG = wrap.querySelector('.plan');
  const total = route_.getTotalLength ? null : null;
  return {
    el: wrap,
    update(p, draw, out = 0) {
      reveal(wrap, E.glide(clamp(p * 1.5)), { y: 28, blur: 14, scale: 0.97 });
      planG.style.opacity = clamp(p * 2);
      const k = E.settle(clamp(draw));
      route_.setAttribute('stroke-dashoffset', (1 - k).toFixed(4));
      const L = route_.getTotalLength();
      const pt = route_.getPointAtLength(L * k);
      walker.setAttribute('cx', pt.x); walker.setAttribute('cy', pt.y);
      const end = route_.getPointAtLength(L);
      destG.setAttribute('transform', `translate(${end.x} ${end.y}) scale(${E.snap(clamp((draw - 0.85) * 6))})`);
      if (out > 0) { wrap.style.opacity = 1 - out; wrap.style.filter = `blur(${out * 10}px)`; }
    },
  };
}

// Screen-to-screen hand-off glyph: the live dot travels between nodes.
export function pulseRing(n, t, period = 1.6, color = '47,91,234') {
  const k = (t % period) / period;
  n.style.boxShadow = `0 0 0 ${k * 26}px rgba(${color},${(1 - k) * 0.28})`;
}
