// Look-dev: AI City finale — rise, nodes wake, synced pulse, labels, end card.
import { el, css, kf, E, clamp, inv } from './engine.js';
import { City } from './city.js';
import { EndCard } from './titles.js';
export async function setup(film) {
  film.add({
    id: 'city', t0: 0, t1: 8,
    build(root) {
      css(root, { background: '#020304' });
      this.c = City(root, { featured: [] });
      const S = this.c.city.size, cx = this.c.city.centre;
      const pick = (dx, dy) => this.c.nearestNode(cx[0] + dx, cx[1] + dy);
      const F = [['HOSPITAL · PORTAL 55', 120, -80], ['HOTEL · GATEWAY', -260, 60], ['PLAZA · PARAGON OUTDOOR', 40, 220], ['STADIUM · PARAGON', 420, 120], ['CAMPUS · PORTAL 43', -420, -240]];
      this.feat = F.map(([label, dx, dy]) => { const n = pick(dx, dy); return { label, x: n.x, y: n.y }; });
      this.c2 = null;
      // re-create with featured labels
      root.innerHTML = '';
      this.c = City(root, { featured: this.feat });
      this.end = EndCard(root, { title: 'AI City', tagline: 'AI meets you. Where life happens.' });
    },
    update(t) {
      const beat = Math.pow(0.5 + 0.5 * Math.cos(((t % 1) ) * Math.PI * 2), 3);
      this.c.update(t, {
        rx: kf(t, [[0, 66], [6, 56, E.crane]]), rz: kf(t, [[0, -22], [6, -10, E.crane]]), s: kf(t, [[0, 1.05], [6, 0.62, E.crane]]), ty: kf(t, [[0, 260], [6, 60, E.crane]]),
        reveal: kf(t, [[0.3, 0.01], [1.0, 0.05, E.push], [2.0, 0.3], [3.2, 1, E.glide]]), beat, labelsOn: kf(t, [[1.2, 0], [1.8, 1], [3.4, 1], [4.0, 0]]), dim: kf(t, [[4.4, 1], [5.2, 0.45]]),
      });
      this.end.update(t - 4.6);
      this.end.el.style.display = t > 4.5 ? 'block' : 'none';
    },
  });
}
