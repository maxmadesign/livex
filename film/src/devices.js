// LiveX hardware, built from the real product renders (cut out of the spec sheets)
// with a live DOM "screen" mapped into each render's exact screen quad via a
// homography, so Lyra + UI sit in the true perspective of the true product.
import { el, css, quadMatrix } from './engine.js';

// Screen quads measured from the cutouts (see assets/cut/screens.json).
// hCm = real overall height, used to keep every device at true physical scale.
export const DEVICES = {
  gateway:      { img: 'assets/cut/gateway_front.png', w: 509, h: 941, hCm: 218, quad: [[93, 60], [435, 94], [435, 825], [92, 849]], name: 'Gateway', spec: '86" · 218 cm' },
  gatewayBack:  { img: 'assets/cut/gateway_back.png',  w: 460, h: 870, hCm: 218, name: 'Gateway' },
  paragon:      { img: 'assets/cut/paragon_front.png', w: 449, h: 980, hCm: 246, quad: [[95, 227], [381, 243], [382, 779], [95, 794]], name: 'Paragon Outdoor', spec: '65" · IP55 · 3200 nits' },
  paragonBack:  { img: 'assets/cut/paragon_back.png',  w: 437, h: 968, hCm: 246, name: 'Paragon Outdoor' },
  portal55:     { img: 'assets/cut/portal_55.png', w: 405, h: 868, hCm: 125.5, quad: [[31, 50], [389, 77], [390, 824], [30, 848]], name: 'Portal', spec: '55"' },
  portal43:     { img: 'assets/cut/portal_43.png', w: 369, h: 737, hCm: 98.6, quad: [[30, 46], [357, 65], [357, 700], [31, 719]], name: 'Portal', spec: '43"' },
  portal32:     { img: 'assets/cut/portal_32.png', w: 331, h: 640, hCm: 73.9, quad: [[30, 52], [316, 65], [317, 609], [31, 622]], name: 'Portal', spec: '32"' },
};

export const SCREEN_W = 1080, SCREEN_H = 1920; // every LiveX screen is a 9:16 portrait canvas

// Build a device. Returns { el, screen, spec, pxPerCm } — `el` is sized in the
// render's native pixels; scale it with CSS to place it in a scene.
export function Device(kind, parent, { glass = true, glow = 0 } = {}) {
  const spec = DEVICES[kind];
  const root = el('div', 'device', parent);
  css(root, { width: spec.w + 'px', height: spec.h + 'px' });
  const img = el('img', 'device-img', root); img.src = spec.img; img.draggable = false;
  let screen = null, sheen = null;
  if (spec.quad) {
    screen = el('div', 'device-screen', root);
    css(screen, { width: SCREEN_W + 'px', height: SCREEN_H + 'px', transform: quadMatrix(SCREEN_W, SCREEN_H, spec.quad) });
    if (glass) {
      sheen = el('div', 'device-sheen', root);
      css(sheen, { width: SCREEN_W + 'px', height: SCREEN_H + 'px', transform: quadMatrix(SCREEN_W, SCREEN_H, spec.quad) });
    }
  }
  return { el: root, img, screen, sheen, spec, pxPerCm: spec.h / spec.hCm };
}

// Place a device so that its real height maps to `cmToPx` pixels per cm,
// with its floor contact point at (x, y) in the parent.
export function placeDevice(dev, { x, y, cmToPx, anchor = 0.5 }) {
  const s = (dev.spec.hCm * cmToPx) / dev.spec.h;
  css(dev.el, {
    position: 'absolute', left: '0', top: '0', transformOrigin: '0 0',
    transform: `translate(${x - dev.spec.w * s * anchor}px, ${y - dev.spec.h * s}px) scale(${s})`,
  });
  return s;
}
