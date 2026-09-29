// Look-dev: "powers of ten" — the plaza shrinks into one node of the city.
import { el, css, kf, E, clamp, inv, lerp, W, H } from './engine.js';
import { PlaceShot } from './places.js';
import { City } from './city.js';
export async function setup(film) {
  film.add({
    id: 'p10', t0: 0, t1: 5,
    build(root) {
      css(root, { background: '#020304' });
      const cityRoot = el('div', 'layer', root);
      this.c = City(cityRoot, {});
      this.cityRoot = cityRoot;
      const cx = this.c.city.centre;
      this.node = this.c.nearestNode(cx[0] + 30, cx[1] + 160);
      const plazaRoot = el('div', 'layer', root);
      this.plaza = PlaceShot(plazaRoot, 'plaza', { slug: false });
      this.plazaRoot = plazaRoot;
    },
    update(t) {
      const k = E.crane(inv(0.6, 3.4, t));
      const cam = { rx: lerp(70, 60, k), rz: lerp(-24, -14, k), s: lerp(2.4, 0.8, k), ty: lerp(420, 90, k) };
      const tr = `translate(0px, ${cam.ty}px) rotateX(${cam.rx}deg) rotateZ(${cam.rz}deg) scale(${cam.s})`;
      this.c.update(t, { ...cam, reveal: kf(t, [[1.6, 0.002], [2.4, 0.08], [3.6, 1, E.glide]]), beat: Math.pow(0.5 + 0.5 * Math.cos(t * Math.PI * 2), 3) });
      const p = this.c.project(this.node.x, this.node.y, tr);
      // the plaza frame collapses into a circle at the node's screen position
      const r = lerp(1400, 3, E.push(inv(0.4, 2.0, t)));
      const cxp = lerp(W / 2, p[0], E.cine(inv(0.4, 2.0, t))), cyp = lerp(H / 2, p[1], E.cine(inv(0.4, 2.0, t)));
      css(this.plazaRoot, { clipPath: `circle(${r}px at ${cxp}px ${cyp}px)`, opacity: t < 2.05 ? 1 : 0, filter: `brightness(${1 + E.push(inv(1.2, 2.0, t)) * 2})` });
      this.plaza.update(t + 1.2, 3);
      this.cityRoot.style.opacity = clamp(inv(0.5, 1.6, t));
    },
  });
}
