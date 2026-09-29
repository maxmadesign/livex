// The generated cut's graphic layer: everything the camera didn't shoot. Subtitles for
// the narration and dialogue (two typefaces, two voices), stop cards, the 1985/2026 year
// stamps and the 4:3 gate of the opening, then the code-drawn end card. Rendered with a
// transparent background (render.mjs --alpha) and laid over the Seedance edit.
import { el, css, clamp, inv } from './engine.js';
import { StopCard, Subtitle } from './route7.js';
import { endcard } from './s5_final.js';

// [start, spoken duration, who, text, tone] — matches gen/plan.md and the voice files;
// tone 'dark' for the two lines that play over Lyra's white studio
export const LINES = [
  [0.25, 3.07, 'human', 'Thirty-one years, I drove the number seven.'],
  [3.55, 3.13, 'human', 'Tonight, my granddaughter plays her first match…'],
  [6.8, 2.71, 'human', '…right where my old depot used to be.'],
  [9.6, 0.76, 'lyra', 'May I?'],
  [10.5, 2.75, 'human', 'They built a stadium on my bus depot.', 'dark'],
  [13.45, 2.12, 'lyra', "Route 7's last stop. I know it.", 'dark'],
  [21.0, 1.8, 'human', 'Somebody still remembered.'],
  [33.8, 0.68, 'human', 'Gate C?'],
  [34.6, 3.32, 'human', 'Past the clock tower. Follow the scarves.'],
  [38.6, 3.08, 'human', "The city had changed. The route hadn't."],
  [42.6, 2.51, 'human', 'I drove this route for thirty years.'],
  [45.2, 0.99, 'lyra', 'Then you know the way.'],
  [52.9, 0.9, 'human', 'Last stop.'],
];

const CARDS = [
  [25.5, '05', 'Harbour Interchange', 'Route 7 · 18:31', 1.2],
  [28.0, '', '→ Exit B', '', 1.0],
  [30.0, '06', 'Market Hall', 'Route 7 · 18:38', 1.2],
  [42.0, '07', 'Harbour Depot', 'Route 7 · 18:52', 1.3],
  [47.0, '01', "St. Mary's", 'Route 7 · 18:53', 0.72],
  [48.0, '02', 'Western Univ', 'Route 7 · 18:53', 0.72],
  [49.0, '03', 'Harbour Hotel', 'Route 7 · 18:53', 0.72],
  [50.0, '04', 'Pier Tower', 'Route 7 · 18:53', 0.72],
  [51.0, '', '→ Gate C', '', 0.72],
  [52.2, '07', 'Last stop', 'Route 7 · 19:08', 1.4],
];

const layer = {
  id: 'overlay', t0: 0, t1: 57.0, z: 5,
  build(root) {
    css(root, { background: 'transparent' });
    // the 1985 gate: a 4:3 window inside the 16:9 frame
    this.gate = ['left', 'right'].map(side => {
      const b = el('div', 'abs', root); css(b, { top: 0, height: '1080px', width: '240px', left: side === 'left' ? 0 : '1680px', background: '#000' }); return b;
    });
    this.year = ['1985', '2026'].map((y, i) => {
      const d = el('div', 'abs', root, y);
      css(d, { left: i ? '96px' : '336px', top: '64px', font: '500 18px var(--mono)', letterSpacing: '0.24em', color: 'rgba(255,255,255,0.72)' });
      return d;
    });
    this.subs = LINES.map(([t, d, who, text, tone = 'light']) => {
      const s = Subtitle(root, text, who, { y: 930, tone });
      // generated footage is busier than the code film's plates: give light text a soft dark halo
      if (tone === 'light') css(s.el, { textShadow: '0 1px 2px rgba(0,0,0,0.55), 0 0 22px rgba(0,0,0,0.45)' });
      return { t, d, s };
    });
    this.cards = CARDS.map(([t, no, name, sub, hold]) => {
      const c = StopCard(root, { no, name, sub, y: 912 });
      if (!sub) c.subEl.style.display = 'none';
      return { t, c, hold };
    });
  },
  update(lt, t) {
    const g = t < 1.5 ? 1 : 0;
    this.gate.forEach(b => { b.style.opacity = g; });
    this.year[0].style.opacity = (inv(0.15, 0.4, t) * (1 - inv(1.3, 1.48, t))).toFixed(3);
    this.year[1].style.opacity = (inv(1.6, 1.85, t) * (1 - inv(3.1, 3.4, t))).toFixed(3);
    this.subs.forEach(({ t: t0, d, s }) => s.update(t - t0, d, 0.55));
    this.cards.forEach(({ t: t0, c, hold }) => c.update(t - t0, { hold }));
  },
};

// the end card, with a credit line that says how this cut was made
const card = {
  ...endcard,
  build(root) {
    endcard.build.call(this, root);
    this.credit.textContent = 'SPEC FILM · MADE BY CLAUDE WITH GPT-IMAGE 2.5 AND SEEDANCE 2.5';
  },
};

export async function setup(film) {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  film.stage.style.background = 'transparent';
  film.add(layer);
  film.add(card);
}
