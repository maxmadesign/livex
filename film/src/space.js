// 2.5D camera: layers live at real depths (cm), the camera dollies through them.
// Screen scale = F / (z - camZ), so a pull-back produces true parallax, and
// depth-of-field blur is computed from the thin-lens circle of confusion.
import { el, css, clamp, W, H } from './engine.js';
import { Device, SCREEN_W, SCREEN_H } from './devices.js';

export class Space {
  constructor(parent, { F = 1100 } = {}) {
    this.root = el('div', 'layer', parent);
    css(this.root, { isolation: 'isolate', zIndex: 0 });   // keep layer z-indices inside the space
    this.F = F; this.layers = [];
    this.cam = { x: 0, y: 0, z: -400, focus: 400, aperture: 0 };
  }
  // el is authored in px at `pxPerCm`; (ox, oy) is the element's own anchor in px
  add(node, { x = 0, y = 0, z = 0, pxPerCm = 1, ox = 0, oy = 0, dof = true, zIndex } = {}) {
    if (node.parentNode !== this.root) this.root.appendChild(node);
    css(node, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0' });
    const L = { node, x, y, z, pxPerCm, ox, oy, dof };
    this.layers.push(L);
    this.layers.sort((a, b) => b.z - a.z);
    this.layers.forEach((l, i) => { l.node.style.zIndex = l.zIndexFixed ?? i + 1; });
    return L;
  }
  pose(cam) {
    Object.assign(this.cam, cam);
    const c = this.cam;
    for (const L of this.layers) {
      const d = L.z - c.z;
      if (d <= 1) { L.node.style.display = 'none'; continue; }
      L.node.style.display = '';
      const k = this.F / d;                // screen px per world cm at this depth
      const s = k / L.pxPerCm;             // css scale of the authored element
      const sx = W / 2 + (L.x - c.x) * k - L.ox * s;
      const sy = H / 2 + (L.y - c.y) * k - L.oy * s;
      L.node.style.transform = `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px) scale(${s.toFixed(5)})`;
      if (L.dof && c.aperture > 0) {
        // circle of confusion in screen px (thin lens, relative)
        const coc = c.aperture * Math.abs(1 / c.focus - 1 / d) * this.F;
        const b = clamp(coc, 0, 60);
        L.node.style.filter = b > 0.4 ? `blur(${(b / Math.max(s, 0.02)).toFixed(2)}px)` : 'none';
      } else if (L.dof) L.node.style.filter = 'none';
    }
  }
  // world -> screen for overlays (labels etc.)
  project(x, y, z) {
    const c = this.cam, k = this.F / (z - c.z);
    return [W / 2 + (x - c.x) * k, H / 2 + (y - c.y) * k, k];
  }
}

// A device standing in a space: product render + live screen, with contact shadow,
// floor reflection, screen glow and light spill so it sits *in* the room.
// World units: cm. y = 0 is the floor, negative is up.
export function StagedDevice(space, kind, { x = 0, z = 0, reflect = 0.18, glow = 0.35, spill = 0.25, shadow = 0.8, lift = 0, halo = 0 } = {}) {
  const wrap = el('div', 'abs');
  const dev = Device(kind, wrap);
  const { w, h, hCm } = dev.spec;
  const ppc = h / hCm;
  // contact shadow (on the floor, under the device)
  const sh = el('div', 'abs', wrap);
  if (lift > 0) shadow = 0;
  css(sh, { left: `${-w * 0.08}px`, top: `${h - 26}px`, width: `${w * 1.16}px`, height: '52px', borderRadius: '50%', background: `radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,${shadow}), rgba(0,0,0,0) 70%)`, filter: 'blur(6px)', zIndex: -1 });
  // wall-mounted (Portal): the signature cobalt backlight washing the wall
  if (halo > 0) {
    // soft wall-wash hugging the frame (as in the Portal product shot), not a neon ring
    const hl = el('div', 'abs', wrap);
    css(hl, { left: `${-w * 0.18}px`, top: `${-h * 0.08}px`, width: `${w * 1.36}px`, height: `${h * 1.16}px`, background: `radial-gradient(60% 55% at 50% 50%, rgba(90,140,255,${0.42 * halo}) 55%, rgba(70,120,255,${0.16 * halo}) 72%, rgba(60,110,255,0) 100%)`, filter: `blur(${w * 0.06}px)`, mixBlendMode: 'screen', zIndex: -1 });
  }
  // reflection (mirror of the render, faded) — polished floors
  let refl = null;
  if (reflect > 0 && lift === 0) {
    refl = el('div', 'abs', wrap);
    css(refl, { left: '0', top: `${h}px`, width: `${w}px`, height: `${h}px`, transform: 'scaleY(-1)', transformOrigin: '50% 50%', opacity: reflect, filter: 'blur(3px)',
      WebkitMaskImage: 'linear-gradient(0deg, rgba(0,0,0,0.9), rgba(0,0,0,0) 40%)', maskImage: 'linear-gradient(0deg, rgba(0,0,0,0.9), rgba(0,0,0,0) 40%)' });
    const ri = el('img', 'abs', refl); ri.src = dev.spec.img; css(ri, { width: `${w}px`, height: `${h}px` });
  }
  // screen glow: soft light around the screen quad (the screen is a light source)
  let glowEl = null;
  if (dev.screen && glow > 0) {
    const q = dev.spec.quad;
    const gx = (q[0][0] + q[1][0]) / 2, gy = (q[0][1] + q[3][1]) / 2, gw = q[1][0] - q[0][0], gh = q[3][1] - q[0][1];
    glowEl = el('div', 'abs', wrap);
    css(glowEl, { left: `${gx - gw}px`, top: `${gy - gh * 0.8}px`, width: `${gw * 2}px`, height: `${gh * 1.6}px`, background: 'radial-gradient(50% 50% at 50% 50%, rgba(235,242,255,0.55), rgba(235,242,255,0) 70%)', opacity: glow, mixBlendMode: 'screen', filter: 'blur(30px)', zIndex: -1 });
    wrap.insertBefore(glowEl, wrap.firstChild);
  }
  // floor spill in front of the device
  let spillEl = null;
  if (spill > 0 && lift === 0) {
    spillEl = el('div', 'abs', wrap);
    css(spillEl, { left: `${-w * 0.4}px`, top: `${h - 40}px`, width: `${w * 1.8}px`, height: `${h * 0.28}px`, background: 'radial-gradient(50% 45% at 50% 40%, rgba(230,238,255,0.5), rgba(0,0,0,0) 70%)', opacity: spill, mixBlendMode: 'screen', filter: 'blur(14px)' });
  }
  wrap.appendChild(dev.el);
  const layer = space.add(wrap, { x, y: -lift, z, pxPerCm: ppc, ox: w / 2, oy: h });
  return { ...dev, wrap, layer, refl, glowEl, spillEl, ppc };
}

// Camera that puts a staged device's screen at a given screen rect (centre cx, cy and
// height hPx). Used for screen-anchored match cuts: two different devices in two
// different places occupy the exact same rectangle on the cut frame.
export function frameScreen(space, dev, { cx = W / 2, cy = H / 2, hPx = 700 } = {}) {
  const { w, h, quad } = dev.spec;
  const ppc = dev.ppc, L = dev.layer;
  const qcx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
  const qcy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
  const qh = ((quad[3][1] - quad[0][1]) + (quad[2][1] - quad[1][1])) / 2;
  const X = L.x + (qcx - w / 2) / ppc, Y = L.y - (h - qcy) / ppc, hcm = qh / ppc;
  const k = hPx / hcm;
  return { x: X - (cx - W / 2) / k, y: Y - (cy - H / 2) / k, z: L.z - space.F / k, focus: space.F / k };
}

// World position (cm) of a point on a staged device's screen canvas (u, v in 1080x1920).
import { quadMap } from './engine.js';
export function screenWorld(dev, u, v) {
  const map = dev._map || (dev._map = quadMap(1080, 1920, dev.spec.quad));
  const [px, py] = map(u, v);
  const L = dev.layer, { w, h } = dev.spec;
  return { x: L.x + (px - w / 2) / dev.ppc, y: L.y - (h - py) / dev.ppc, z: L.z };
}
