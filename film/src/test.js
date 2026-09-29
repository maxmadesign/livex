// Calibration entry: logo trace vs. source, device homography, UI card.
import { el, css } from './engine.js';
import { markSVG, wordmarkSVG, lockupSVG } from './brand.js';
import { Device, placeDevice } from './devices.js';

export async function setup(film) {
  film.add({
    id: 'calib', t0: 0, t1: 10,
    build(root) {
      css(root, { background: '#1a1d22' });
      // 1) logo trace: source crop at 4x, our vector on top in red
      const box = el('div', 'abs', root); css(box, { left: '40px', top: '40px', width: '680px', height: '840px', overflow: 'hidden' });
      const sheet = el('img', 'abs', box); sheet.src = 'assets/src/paragon_sheet.jpg';
      css(sheet, { width: 2000 * 4 + 'px', height: 1125 * 4 + 'px', left: -1460 * 4 + 'px', top: -470 * 4 + 'px', maxWidth: 'none', opacity: 0.9 });
      const m = el('div', 'abs', box, markSVG({ size: 470, color: 'rgba(255,40,40,0.6)' })); css(m, { left: '78px', top: '120px' });
      // 2) device with live screen
      const dev = Device('gateway', root);
      placeDevice(dev, { x: 1100, y: 1040, cmToPx: 4.5 });
      const ph = el('img', 'lyra-photo', dev.screen); ph.src = 'assets/src/lyra_white.jpg';
      const card = el('div', 'card', dev.screen, `<div class="eyebrow">Ward 6B · Pediatrics</div><h3>Elevator B,<br>Level 6</h3><p>3 min walk · I'll light the way.</p>`);
      css(card, { left: '72px', right: '72px', top: '1300px' });
      const dev2 = Device('portal55', root);
      placeDevice(dev2, { x: 1560, y: 900, cmToPx: 4.5 });
      const ph2 = el('img', 'lyra-photo', dev2.screen); ph2.src = 'assets/src/lyra_white.jpg';
      const dev3 = Device('paragon', root);
      placeDevice(dev3, { x: 1800, y: 1060, cmToPx: 3.2 });
      const ph3 = el('img', 'lyra-photo', dev3.screen); ph3.src = 'assets/src/lyra_black.jpg';
      // 3) mark + wordmark lockup
      const lock = el('div', 'abs', root, lockupSVG({ size: 120 })); css(lock, { left: '760px', top: '60px', display: 'flex', gap: '28px', alignItems: 'center' });
    },
    update() {},
  });
}
