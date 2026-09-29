// Look-dev: Lyra makes room for the answer (screen-only view).
import { el, css, clamp, E, inv } from './engine.js';
import { LyraScreen, Card, Caption, Voice } from './ui.js';
export async function setup(film) {
  film.add({
    id: 'room', t0: 0, t1: 4,
    build(root) {
      css(root, { background: '#111' });
      const holder = el('div', 'abs', root); css(holder, { left: '420px', top: '20px', width: '1080px', height: '1920px', transform: 'scale(0.54)', transformOrigin: '0 0', overflow: 'hidden' });
      const holder2 = el('div', 'abs', root); css(holder2, { left: '1000px', top: '20px', width: '1080px', height: '1920px', transform: 'scale(0.54)', transformOrigin: '0 0', overflow: 'hidden' });
      this.a = LyraScreen(holder, { place: 'St. Aurelia · Level 1', clock: '04:52', cut: true });
      this.cap = Caption(this.a.content, 'Keep her head in your elbow.', { top: 1150 });
      this.b = LyraScreen(holder2, { place: 'Maison Nord', clock: '18:42', cut: true });
      this.card = Card(this.b.content, { top: 1330, rows: [`<div class="eyebrow">Picked for you · 3 left</div>`, `<h3>Cashmere scarf, oat</h3>`, `<p>Soft enough for a first winter.</p>`] });
      this.v = Voice(this.b.content);
    },
    update(t) {
      this.a.idle(t); this.a.statusIn(1); this.a.makeRoom(0); this.cap.update(1);
      this.b.idle(t); this.b.statusIn(1); this.b.makeRoom(E.settle(clamp(t / 1.2))); this.card.update(clamp((t - 0.4) / 1)); this.v.update(t, 0.6);
    },
  });
}
