// Look-dev: all seven places, 2 s each, UI settled.
import { PlaceShot } from './places.js';
const KINDS = ['retail', 'hotel', 'hospital', 'campus', 'stadium', 'corporate', 'plaza'];
export async function setup(film) {
  KINDS.forEach((k, i) => film.add({ id: k, t0: i * 2, t1: i * 2 + 2, build(root) { this.s = PlaceShot(root, k); }, update(t) { this.s.update(t + 1.2, 3); } }));
}
