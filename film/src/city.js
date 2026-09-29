// AI CITY — the real city at night, from altitude, and its Physical AI layer.
// No network lines, no holograms: every LiveX node is simply a point of white light
// on the ground. The network is shown as *synchrony*: the nodes breathe together,
// on the beat, because they are one intelligence.
import { el, css, rng, clamp, lerp, E, inv, W, H } from './engine.js';
import { CityLights } from './env.js';

export function City(root, { seed = 7, nodes = 420, featured = [] } = {}) {
  const city = CityLights({ seed });
  const S = city.size;
  const cam = el('div', 'layer', root);
  css(cam, { perspective: '1500px', perspectiveOrigin: '50% 12%' });
  const plane = el('div', 'abs', cam);
  css(plane, { width: S + 'px', height: S + 'px', left: (W / 2 - S / 2) + 'px', top: (H / 2 - S / 2) + 'px', transformOrigin: '50% 50%' });
  css(city.canvas, { position: 'absolute', left: 0, top: 0, width: S + 'px', height: S + 'px', filter: 'brightness(1.6) contrast(1.22) saturate(1.2) sepia(0.12)',
    WebkitMaskImage: 'radial-gradient(closest-side, #000 72%, transparent 100%)', maskImage: 'radial-gradient(closest-side, #000 72%, transparent 100%)' });
  plane.appendChild(city.canvas);

  // nodes: where life happens (dense districts), never in the river or parks
  const R = rng(seed * 31 + 5);
  const pts = [];
  while (pts.length < nodes) {
    const x = R() * S, y = R() * S;
    if (city.inRiver(x, y) || city.inPark(x, y)) continue;
    if (R() > city.dens(x, y) * 1.1) continue;
    const dx = x - city.centre[0], dy = y - city.centre[1];
    pts.push({ x, y, d: Math.hypot(dx, dy) / S, kind: R() });
  }
  pts.sort((a, b) => a.d - b.d);
  const dots = pts.map(p => {
    const n = el('div', 'abs', plane);
    css(n, { left: p.x - 30 + 'px', top: p.y - 30 + 'px', width: '60px', height: '60px', borderRadius: '50%', mixBlendMode: 'screen', opacity: 0,
      background: 'radial-gradient(circle, rgba(255,255,255,1) 0 6%, rgba(236,242,255,0.55) 11%, rgba(190,210,255,0.12) 30%, rgba(0,0,0,0) 62%)' });
    return { ...p, n };
  });
  // featured nodes (the places of the story) — labelled in screen space
  const labels = featured.map(f => {
    const lab = el('div', 'node-label', root, f.label);
    const line = el('div', 'abs', root); css(line, { width: '1px', background: 'rgba(255,255,255,0.55)', transformOrigin: '0 100%' });
    return { ...f, lab, line };
  });
  const haze = el('div', 'layer', root);
  css(haze, { background: 'linear-gradient(180deg, rgba(10,12,18,1) 0%, rgba(10,12,18,0.85) 14%, rgba(8,9,12,0.25) 34%, rgba(0,0,0,0) 52%), radial-gradient(80% 30% at 50% 22%, rgba(255,170,100,0.10), rgba(0,0,0,0) 70%)' });
  const tilt = el('div', 'layer', root);
  css(tilt, { backdropFilter: 'blur(4px)', WebkitMaskImage: 'linear-gradient(180deg, #000 0%, #000 18%, transparent 42%, transparent 88%, #000 100%)', maskImage: 'linear-gradient(180deg, #000 0%, #000 18%, transparent 42%, transparent 88%, #000 100%)' });

  let M = null;
  const self = {
    plane, city, dots,
    // cam: { rx, rz, s, ty } ; reveal in [0,1] = fraction of nodes awake ; beat in [0,1] pulse
    update(t, { rx = 62, rz = -14, s = 0.7, ty = 80, tx = 0, reveal = 1, beat = 0, labelsOn = 0, dim = 1 } = {}) {
      const tr = `translate(${tx}px, ${ty}px) rotateX(${rx}deg) rotateZ(${rz}deg) scale(${s})`;
      plane.style.transform = tr;
      city.canvas.style.opacity = dim;
      const nAwake = reveal * dots.length;
      for (let i = 0; i < dots.length; i++) {
        const D = dots[i];
        const a = clamp(nAwake - i);             // wakes in order of distance from the centre
        const pulse = 0.72 + 0.28 * beat;
        D.n.style.opacity = (a * pulse).toFixed(3);
        D.n.style.transform = `scale(${(0.7 + 0.5 * beat) * (0.6 + 0.4 * a)})`;
      }
      // screen-space labels for featured nodes
      if (labels.length) {
        M = new DOMMatrix(`perspective(1500px)`);
        const rect = { ox: W / 2, oy: H * 0.12 };
        for (const L of labels) {
          const p = self.project(L.x, L.y, tr);
          const up = 70 + (L.h || 0);
          css(L.line, { left: p[0] + 'px', top: p[1] - up + 'px', height: up + 'px', opacity: labelsOn * (L.on ?? 1) });
          css(L.lab, { transform: `translate(${p[0] + 10}px, ${p[1] - up - 8}px)`, opacity: labelsOn * (L.on ?? 1) });
        }
      }
    },
    // project a point on the plane (texture px) to screen px, matching CSS 3D maths
    project(x, y, tr) {
      const po = [W / 2, H * 0.12];                         // perspective-origin
      const m = new DOMMatrix(tr);
      const local = new DOMPoint(x - S / 2, y - S / 2, 0, 1);
      const p = m.transformPoint(local);
      // plane origin (centre of element) in screen space
      const cx = W / 2, cy = H / 2;
      const X = p.x + cx, Y = p.y + cy, Z = p.z;
      const d = 1500;
      const k = d / (d - Z);
      return [po[0] + (X - po[0]) * k, po[1] + (Y - po[1]) * k, k];
    },
    nearestNode(x, y) { let b = dots[0], bd = 1e18; for (const D of dots) { const dd = (D.x - x) ** 2 + (D.y - y) ** 2; if (dd < bd) { bd = dd; b = D; } } return b; },
  };
  return self;
}

// Draw the stadium onto the city light map: a floodlit bowl with a green pitch.
export function drawStadium(city, x, y, { rx = 150, ry = 110, a = -0.35 } = {}) {
  // a real bowl at night from altitude: dark translucent roof ring with a lit inner edge,
  // warm stands, and a floodlit pitch (the brightest green in the city, but not a sticker)
  const g = city.canvas.getContext('2d'), R = rng(99);
  g.save(); g.translate(x, y); g.rotate(a);
  g.fillStyle = '#05070a'; g.beginPath(); g.ellipse(0, 0, rx * 1.32, ry * 1.36, 0, 0, 7); g.fill();
  const pitch = g.createRadialGradient(0, 0, 0, 0, 0, rx * 0.7);
  pitch.addColorStop(0, '#4b6b52'); pitch.addColorStop(1, '#1b2e22');
  g.fillStyle = pitch; g.fillRect(-rx * 0.6, -ry * 0.52, rx * 1.2, ry * 1.04);
  g.strokeStyle = 'rgba(235,245,235,0.3)'; g.lineWidth = 1; g.strokeRect(-rx * 0.56, -ry * 0.47, rx * 1.12, ry * 0.94);
  g.beginPath(); g.moveTo(0, -ry * 0.47); g.lineTo(0, ry * 0.47); g.stroke(); g.beginPath(); g.arc(0, 0, ry * 0.14, 0, 7); g.stroke();
  for (let k = 0; k < 1400; k++) { const t = R() * 7, r = 0.74 + R() * 0.3; g.fillStyle = `rgba(255,${200 + R() * 40 | 0},150,${0.15 + R() * 0.35})`; g.fillRect(Math.cos(t) * rx * r, Math.sin(t) * ry * r * 1.04, 1.3, 1.3); }
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(225,235,255,0.55)'; g.lineWidth = 2.5; g.beginPath(); g.ellipse(0, 0, rx * 1.05, ry * 1.09, 0, 0, 7); g.stroke();
  g.strokeStyle = 'rgba(200,215,255,0.10)'; g.lineWidth = 22; g.beginPath(); g.ellipse(0, 0, rx * 1.05, ry * 1.09, 0, 0, 7); g.stroke();
  const fl = g.createRadialGradient(0, 0, 0, 0, 0, rx * 1.1); fl.addColorStop(0, 'rgba(210,235,215,0.22)'); fl.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fl; g.beginPath(); g.ellipse(0, 0, rx * 1.1, ry * 1.1, 0, 0, 7); g.fill();
  g.restore();
}
