// Film-level post: 35mm-style grain (seeded per frame), vignette, and a global
// exposure/flash layer that scenes can drive through film.fx.
import { el, css, rng } from './engine.js';

export function installPost(film, stage) {
  const fx = film.fx = { flash: 0, vignette: 1, grain: 1, fade: 0 };
  const vig = el('div', 'post vignette', stage);
  const g = el('canvas', 'post grain', stage);
  const GW = 960, GH = 540; g.width = GW; g.height = GH;
  css(g, { width: '1920px', height: '1080px' });
  const ctx = g.getContext('2d');
  const img = ctx.createImageData(GW, GH);
  const flash = el('div', 'post flash', stage);
  const fade = el('div', 'post', stage); css(fade, { background: '#000', opacity: 0 });

  film.addPost(t => {
    // grain: new pattern every frame (24 distinct fields per second looks like film)
    const frame = Math.floor(t * 24);
    const r = rng(9001 + frame * 7919);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 128 + (r() + r() + r() - 1.5) * 90;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    g.style.opacity = (0.16 * fx.grain).toFixed(3);
    vig.style.opacity = fx.vignette.toFixed(3);
    flash.style.opacity = fx.flash.toFixed(3);
    fade.style.opacity = fx.fade.toFixed(3);
    // scenes set fx each frame; reset defaults for the next frame
    fx.flash = 0; fx.vignette = 1; fx.grain = 1; fx.fade = 0;
  });
}
