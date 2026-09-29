// Look-development frames: validates the "defocused reality" environment language.
import { el, css, W, H } from './engine.js';
import { Device, placeDevice } from './devices.js';
import { Bokeh, Passersby, Shafts, CityLights } from './env.js';
import { LyraScreen, Caption, Voice, Card } from './ui.js';

export async function setup(film) {
  // A — hotel lobby, dusk, Gateway hero
  film.add({
    id: 'lobby', t0: 0, t1: 5,
    build(root) {
      css(root, { background: 'linear-gradient(180deg, #120d0a 0%, #1b1410 55%, #0b0907 100%)' });
      const wash = el('div', 'layer', root);
      css(wash, { background: 'radial-gradient(60% 50% at 70% 35%, rgba(255,190,120,0.22), rgba(0,0,0,0) 70%), radial-gradient(40% 40% at 15% 30%, rgba(255,210,160,0.12), rgba(0,0,0,0) 70%)' });
      this.bk = Bokeh(root, { seed: 11, count: 90, palette: ['#ffcf98', '#ffb46a', '#fff1dc', '#ffd9b0'], size: [20, 200], band: [80, 700], alpha: [0.06, 0.32] });
      Shafts(root, { angle: 16, color: 'rgba(255,220,180,0.07)', x0: 900, spread: 900 });
      // floor: polished stone with reflection
      const floor = el('div', 'abs', root); css(floor, { top: '760px', left: '0', width: W + 'px', height: '320px', background: 'linear-gradient(180deg, rgba(40,30,24,0.0), rgba(10,8,6,0.85))' });
      const devWrap = el('div', 'layer', root);
      this.dev = Device('gateway', devWrap);
      placeDevice(this.dev, { x: 1180, y: 900, cmToPx: 3.7 });
      this.ui = LyraScreen(this.dev.screen, { place: 'Aurelia · Lobby', clock: '18:42' });
      this.card = Card(this.ui.content, { top: 1240, rows: [`<div class="eyebrow">Welcome back</div>`, `<h3>Room 1204 is ready.</h3>`, `<p>Your key is on your phone. The rooftop is quiet until eight.</p>`] });
      this.cap = Caption(this.ui.content, 'Welcome back, Mia.', { top: 1060 });
      this.voice = Voice(this.ui.content);
      // reflection
      const refl = el('div', 'layer', root);
      css(refl, { transform: 'scaleY(-1)', transformOrigin: '0 900px', opacity: 0.22, filter: 'blur(6px)', maskImage: 'linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 72%, rgba(0,0,0,0.8) 83%)', WebkitMaskImage: 'linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 72%, rgba(0,0,0,0.8) 83%)' });
      const d2 = Device('gateway', refl); placeDevice(d2, { x: 1180, y: 900, cmToPx: 3.7 });
      const s2 = el('div', 'layer', d2.screen); css(s2, { background: '#f4f1ec' });
      // screen light spill on floor
      const spill = el('div', 'abs', root); css(spill, { left: '880px', top: '860px', width: '620px', height: '160px', background: 'radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,0.18), rgba(0,0,0,0))', filter: 'blur(20px)', mixBlendMode: 'screen' });
      // protagonist, over-the-shoulder, defocused foreground
      const fg = el('div', 'abs', root);
      css(fg, { left: '120px', top: '260px', width: '620px', height: '1000px', filter: 'blur(26px)' });
      fg.innerHTML = `<svg viewBox="0 0 62 100" width="100%" height="100%"><g fill="#070504"><path d="M31 6 C22 6 18 14 18 22 C18 30 21 34 22 38 C14 40 6 46 4 58 L2 100 L60 100 L58 58 C56 46 48 40 40 38 C42 33 44 29 44 22 C44 13 40 6 31 6 Z"/></g></svg>`;
      this.pass = Passersby(root, { seed: 4, count: 1, blur: 44 });
    },
    update(t) {
      this.bk.draw(t, { drift: -6 });
      this.ui.idle(t); this.ui.statusIn(1);
      this.cap.update(1); this.card.update(1); this.voice.update(t, 0.7);
      this.pass.draw(t, { active: false });
    },
  });
  // B — AI City from altitude
  film.add({
    id: 'city', t0: 5, t1: 10,
    build(root) {
      css(root, { background: '#020305' });
      this.city = CityLights({ seed: 7 });
      const S = this.city.size;
      const cam = el('div', 'layer', root); css(cam, { perspective: '1400px', perspectiveOrigin: '50% 10%' });
      this.plane = el('div', 'abs', cam); css(this.plane, { width: S + 'px', height: S + 'px', left: (W / 2 - S / 2) + 'px', top: (H / 2 - S / 2) + 'px', transformOrigin: '50% 50%' });
      css(this.city.canvas, { position: 'absolute', left: 0, top: 0, width: S + 'px', height: S + 'px', filter: 'brightness(1.6) saturate(1.1)' });
      this.plane.appendChild(this.city.canvas);
      // nodes on the ground plane
      const r = (await_rng => null);
      this.nodes = [];
      const R = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(12345);
      for (let i = 0; i < 90; i++) {
        let x, y, tries = 0;
        do { x = R() * S; y = R() * S; tries++; } while ((this.city.inRiver(x, y) || this.city.dens(x, y) < 0.35) && tries < 50);
        const n = el('div', 'abs', this.plane);
        css(n, { left: x - 40 + 'px', top: y - 40 + 'px', width: '80px', height: '80px', opacity: 0, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,1) 0 5%, rgba(255,255,255,0.35) 9%, rgba(200,215,255,0.0) 40%)', mixBlendMode: 'screen' });
        this.nodes.push(n);
      }
      // atmosphere: horizon haze + tilt-shift blur band at the top
      const haze = el('div', 'layer', root); css(haze, { background: 'linear-gradient(180deg, rgba(24,30,44,1) 0%, rgba(16,20,30,0.75) 16%, rgba(6,8,12,0.0) 42%)' });
      const tilt = el('div', 'layer', root); css(tilt, { backdropFilter: 'blur(5px)', WebkitMaskImage: 'linear-gradient(180deg, #000 0%, #000 22%, transparent 48%, transparent 85%, #000 100%)', maskImage: 'linear-gradient(180deg, #000 0%, #000 22%, transparent 48%, transparent 85%, #000 100%)' });
    },
    update(t) {
      const k = t / 5;
      this.plane.style.transform = `translateY(${120 - k * 60}px) rotateX(${70 - k * 3}deg) rotateZ(${-18 + k * 6}deg) scale(${0.62 + k * 0.05})`;
      const beat = 0.5 + 0.5 * Math.cos((t * 1.6) * Math.PI * 2);
      this.nodes.forEach(n => { n.style.opacity = (0.55 + 0.45 * beat).toFixed(3); n.style.transform = `scale(${0.9 + 0.35 * beat})`; });
    },
  });
}
