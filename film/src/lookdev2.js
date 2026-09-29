// Look-dev: the continuous pull-back (Lyra -> screen -> Gateway -> human -> room).
import { el, css, kf, E, W, H, rng } from './engine.js';
import { Space, StagedDevice } from './space.js';
import { PointLights, lightGrid, reflectLights } from './env.js';
import { LyraScreen, Caption } from './ui.js';

export async function setup(film) {
  film.add({
    id: 'pull', t0: 0, t1: 6,
    build(root) {
      css(root, { background: 'linear-gradient(180deg, #0b0806 0%, #15100c 48%, #1a130e 52%, #070504 100%)' });
      this.sp = new Space(root, { F: 1150 });
      // lights: two rows of ceiling downlights receding, a warm pendant cluster, the city through glass
      const R = rng(4);
      const ceil = lightGrid({ x0: -700, x1: 700, z0: 150, z1: 2600, nx: 5, nz: 9, y: -360, c: '#ffd9a8', i: 0.9 });
      const pend = Array.from({ length: 5 }, (_, i) => ({ x: -620 + R() * 200, y: -240 - R() * 90, z: 900 + R() * 200, c: '#ffc27a', i: 0.7 }));
      const city = Array.from({ length: 160 }, () => ({ x: -2600 + R() * 5200, y: -40 - R() * 700, z: 3200 + R() * 1500, c: R() < 0.7 ? '#ffcf9a' : '#dfe8ff', i: 0.5 + R() * 0.6 }));
      const lights = [...ceil, ...pend, ...city];
      this.pl = PointLights(root, this.sp, [...lights, ...reflectLights(ceil, 0.25), ...reflectLights(pend, 0.3)], { base: 2.4 });
      root.insertBefore(this.pl.el, this.sp.root);
      this.dev = StagedDevice(this.sp, 'gateway', { x: 0, z: 0, reflect: 0.16 });
      this.ui = LyraScreen(this.dev.screen, { place: 'Aurelia · Lobby', clock: '18:42' });
      this.cap = Caption(this.ui.content, 'Welcome back, Mia.', { top: 1060 });
      const hero = el('div', 'abs');
      hero.innerHTML = `<img src="assets/cut/human_sil.png" style="position:absolute;left:0;top:0;width:521px;height:1788px"><img src="assets/cut/human_rim.png" style="position:absolute;left:0;top:0;width:521px;height:1788px;opacity:.55;mix-blend-mode:screen">`;
      css(hero, { width: '521px', height: '1788px' });
      this.sp.add(hero, { x: -62, y: 0, z: -95, pxPerCm: 1788 / 166, ox: 260, oy: 1788 });
      // warm wall washes far behind (parallax, defocused)
      for (const [x, z, w, c] of [[-900, 1800, 1400, 'rgba(255,170,100,0.18)'], [1100, 2200, 1600, 'rgba(255,200,150,0.12)'], [0, 3000, 3000, 'rgba(120,140,190,0.10)']]) {
        const d = el('div', 'abs'); css(d, { width: w + 'px', height: '900px', background: `radial-gradient(50% 50% at 50% 50%, ${c}, rgba(0,0,0,0) 70%)` });
        this.sp.add(d, { x, y: -250, z, pxPerCm: 1, ox: w / 2, oy: 450, dof: false });
      }
      for (const [x, z] of [[-460, 600], [460, 640], [-980, 1200], [980, 1250]]) {
        const c = el('div', 'abs'); css(c, { width: '90px', height: '1700px', background: 'linear-gradient(90deg, #120d0a, #2a2019 55%, #0e0a08)' });
        this.sp.add(c, { x, y: 0, z, pxPerCm: 0.2, ox: 45, oy: 1700 });
      }
    },
    update(t) {
      const z = kf(t, [[0, -38], [0.6, -40], [5.4, -360, E.crane]]);
      const y = kf(t, [[0, -176], [5.4, -140, E.crane]]);
      const x = kf(t, [[0, 2], [5.4, -70, E.crane]]);
      this.sp.pose({ x, y, z, focus: -z, aperture: kf(t, [[0, 6], [3, 18], [5.4, 22]]) });
      this.pl.draw(t);
      this.ui.idle(t); this.ui.statusIn(1); this.cap.update(1);
    },
  });
}
