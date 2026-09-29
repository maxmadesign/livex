// Look-dev: split grid 1 -> 2 -> 4 -> 8 with seven places + hotel repeat.
import { kf, E, clamp, inv } from './engine.js';
import { Grid } from './grid.js';
import { PlaceShot } from './places.js';
const KINDS = ['hospital', 'hotel', 'retail', 'campus', 'stadium', 'corporate', 'plaza', 'hotel'];
export async function setup(film) {
  film.add({
    id: 'grid', t0: 0, t1: 8,
    build(root) { this.g = Grid(root, 8, (i, r) => PlaceShot(r, KINDS[i], { slug: false, centre: true, tight: 0.8 })); },
    update(t) {
      let a = 1, b = 2, k = 0;
      if (t < 2) { a = 1; b = 2; k = E.cine(inv(1.0, 2.0, t)); }
      else if (t < 4) { a = 2; b = 4; k = E.cine(inv(3.0, 4.0, t)); }
      else { a = 4; b = 8; k = E.cine(inv(5.0, 6.0, t)); }
      this.g.layout(a, b, k);
      this.g.panels.forEach((P, i) => P.api.update(t + 1.5, 3));
    },
  });
}
