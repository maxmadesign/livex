// Film-level typography: place slugs, the running clock, node labels, end card.
// Rules: mono for facts (place, time, coordinates), sans for voice, one serif
// italic moment for emotion. Nothing flies in; type resolves out of blur, the way
// a lens racks focus.
import { el, css, reveal, clamp, lerp, E, inv } from './engine.js';
import { markSVG, wordmarkSVG, MARK, WORD } from './brand.js';

export function Slug(parent, { text = '', sub = '', x = 96, y = 940, align = 'left' } = {}) {
  const s = el('div', 'slug', parent);
  css(s, { left: x + 'px', top: y + 'px' });
  if (align === 'right') css(s, { left: 'auto', right: x + 'px', flexDirection: 'row-reverse' });
  const rule = el('div', 'rule', s);
  const t = el('span', '', s, text);
  const st = sub ? el('span', '', s, sub) : null;
  if (st) css(st, { color: 'rgba(255,255,255,0.45)' });
  return {
    el: s,
    update(p, out = 0) {
      rule.style.transform = `scaleX(${E.glide(clamp(p * 1.6))})`;
      reveal(t, E.settle(clamp(p * 1.8 - 0.25)), { y: 0, blur: 6, scale: 1 });
      if (st) reveal(st, E.settle(clamp(p * 1.8 - 0.55)), { y: 0, blur: 6, scale: 1 });
      s.style.opacity = 1 - out;
    },
  };
}

// hh:mm:ss running clock (tabular), optional frame counter
export function Clock(parent, { start = [18, 42, 7], x = 1824, y = 64, size = 18, frames = false } = {}) {
  const c = el('div', 'slug', parent);
  css(c, { left: 'auto', right: (1920 - x) + 'px', top: y + 'px', fontSize: size + 'px', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.16em' });
  const [h0, m0, s0] = start;
  return {
    el: c,
    update(sec, vis = 1) {
      const tot = h0 * 3600 + m0 * 60 + s0 + Math.floor(sec);
      const h = Math.floor(tot / 3600) % 24, m = Math.floor(tot / 60) % 60, s = tot % 60;
      const f = Math.floor((sec % 1) * 30);
      c.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${frames ? ':' + String(f).padStart(2, '0') : ''}`;
      c.style.opacity = vis;
    },
  };
}

// End card: mark resolves, wordmark and title rack into focus, tagline lands last.
// Layout (1920x1080): lockup centred at y≈430; title at y≈520; tagline at y≈700.
export function EndCard(parent, { title = 'AI City', tagline = '', kicker = '' } = {}) {
  const wrap = el('div', 'layer', parent);
  const mark = el('div', 'abs', wrap, markSVG({ size: 92, glow: 0 }));
  const word = el('div', 'abs', wrap, wordmarkSVG({ height: 40 }));
  const ttl = el('div', 'title-xl', wrap, title);
  css(ttl, { left: '0', right: '0', textAlign: 'center', top: '500px', fontSize: '176px' });
  const tag = el('div', 'abs', wrap, tagline);
  css(tag, { left: '0', right: '0', top: '730px', textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '46px', color: 'rgba(255,255,255,0.86)', letterSpacing: '-0.005em' });
  const kick = kicker ? el('div', 'slug', wrap, kicker) : null;
  if (kick) css(kick, { left: '0', right: '0', justifyContent: 'center', top: '830px', color: 'rgba(255,255,255,0.5)' });
  const mw = 92 * MARK.w / 100, ww = 40 * WORD.w / 100, gap = 34;
  const total = mw + gap + ww, x0 = 960 - total / 2;
  css(mark, { left: x0 + 'px', top: '384px' });
  css(word, { left: x0 + mw + gap + 'px', top: '410px' });
  return {
    el: wrap,
    // t: seconds since the end card began
    update(t, out = 0) {
      const pm = inv(0.0, 0.9, t);
      mark.style.opacity = clamp(pm * 1.5);
      mark.style.filter = `blur(${(1 - E.glide(pm)) * 14}px) drop-shadow(0 0 ${lerp(24, 6, E.glide(pm))}px rgba(255,255,255,${0.6 * (1 - pm) + 0.25}))`;
      mark.style.transform = `scale(${lerp(1.18, 1, E.glide(pm))})`;
      reveal(word, E.settle(inv(0.35, 1.1, t)), { y: 0, blur: 10, scale: 1 });
      reveal(ttl, E.settle(inv(0.7, 1.7, t)), { y: 16, blur: 18, scale: 1.02 });
      reveal(tag, E.settle(inv(1.5, 2.4, t)), { y: 10, blur: 10, scale: 1 });
      if (kick) reveal(kick, E.settle(inv(2.1, 2.9, t)), { y: 0, blur: 6, scale: 1 });
      wrap.style.opacity = 1 - out;
    },
  };
}

// Tiny ground-truth label for a node in the city: "HOSPITAL · PORTAL 55"
export function NodeLabel(parent, text) {
  const n = el('div', 'node-label', parent, text);
  return {
    el: n,
    place(x, y, p = 1) { css(n, { transform: `translate(${x + 14}px, ${y - 22}px)` }); reveal(n, E.settle(clamp(p)), { y: 0, blur: 5, scale: 1 }); },
  };
}
