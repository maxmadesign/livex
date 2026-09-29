// The protagonist's own screen: a generic, unbranded phone. In the motion film it
// carries the human story (time, place, the message that started the journey,
// the battery dying) before any LiveX node appears.
import { el, css, reveal, clamp, E, inv, lerp } from './engine.js';

export function Phone(parent, { w = 420, clock = '04:52', date = 'Tuesday, 29 September', notes = [], battery = 1 } = {}) {
  const h = w * 2.08;
  const body = el('div', 'abs', parent);
  css(body, { width: w + 'px', height: h + 'px', borderRadius: w * 0.16 + 'px', background: 'linear-gradient(145deg, #2a2d33, #0d0e11 40%, #1b1d22)', padding: w * 0.028 + 'px', boxShadow: '0 40px 120px rgba(0,0,0,0.6), inset 0 0 0 1.5px rgba(255,255,255,0.12)' });
  const scr = el('div', 'abs', body);
  css(scr, { left: w * 0.028 + 'px', top: w * 0.028 + 'px', right: w * 0.028 + 'px', bottom: w * 0.028 + 'px', borderRadius: w * 0.135 + 'px', overflow: 'hidden', background: 'radial-gradient(120% 80% at 30% 20%, #3a3f55 0%, #171a24 55%, #0b0c10 100%)' });
  const island = el('div', 'abs', scr); css(island, { left: '50%', top: w * 0.03 + 'px', width: w * 0.28 + 'px', height: w * 0.075 + 'px', marginLeft: -w * 0.14 + 'px', borderRadius: '99px', background: '#000' });
  const bat = el('div', 'abs', scr, `<span class="pct"></span><span class="cell"><i></i></span>`);
  css(bat, { right: w * 0.07 + 'px', top: w * 0.045 + 'px', display: 'flex', alignItems: 'center', gap: '6px', font: `600 ${w * 0.034}px var(--sans)`, color: '#fff' });
  const cell = bat.querySelector('.cell'); css(cell, { width: w * 0.06 + 'px', height: w * 0.03 + 'px', border: '1.5px solid rgba(255,255,255,0.6)', borderRadius: '4px', padding: '1.5px', display: 'block' });
  const fill = bat.querySelector('i'); css(fill, { display: 'block', height: '100%', background: '#ff453a', borderRadius: '2px' });
  const pct = bat.querySelector('.pct');
  const dateEl = el('div', 'abs', scr, date); css(dateEl, { left: 0, right: 0, top: w * 0.2 + 'px', textAlign: 'center', font: `500 ${w * 0.05}px var(--sans)`, color: 'rgba(255,255,255,0.8)' });
  const time = el('div', 'abs', scr, clock); css(time, { left: 0, right: 0, top: w * 0.25 + 'px', textAlign: 'center', font: `600 ${w * 0.24}px var(--sans)`, letterSpacing: '-0.03em', color: 'rgba(255,255,255,0.94)' });
  const stack = el('div', 'abs', scr); css(stack, { left: w * 0.045 + 'px', right: w * 0.045 + 'px', top: w * 0.7 + 'px', display: 'flex', flexDirection: 'column', gap: w * 0.022 + 'px' });
  const cards = notes.map(n => {
    const c = el('div', '', stack, `<div style="display:flex;justify-content:space-between;font:600 ${w * 0.032}px var(--sans);color:rgba(255,255,255,.62);text-transform:uppercase;letter-spacing:.04em"><span>${n.app || 'Messages'}</span><span>${n.when || 'now'}</span></div>
      <div style="font:600 ${w * 0.042}px var(--sans);color:#fff;margin-top:6px">${n.from}</div><div style="font:400 ${w * 0.04}px/1.3 var(--sans);color:rgba(255,255,255,.9);margin-top:2px">${n.text}</div>`);
    css(c, { padding: `${w * 0.035}px ${w * 0.045}px`, borderRadius: w * 0.06 + 'px', background: 'rgba(255,255,255,0.14)', backdropFilter: 'blur(20px)' });
    return c;
  });
  const low = el('div', 'abs', scr, `<div style="font:600 ${w * 0.045}px var(--sans)">Low Battery</div><div style="font:400 ${w * 0.036}px var(--sans);opacity:.8;margin-top:6px">1% battery remaining</div>`);
  css(low, { left: w * 0.12 + 'px', right: w * 0.12 + 'px', top: w * 0.95 + 'px', padding: w * 0.05 + 'px', borderRadius: w * 0.06 + 'px', background: 'rgba(40,40,46,0.86)', textAlign: 'center', color: '#fff', backdropFilter: 'blur(20px)', opacity: 0 });
  const black = el('div', 'abs', scr); css(black, { inset: '0', background: '#000', opacity: 0 });
  return {
    el: body, w, h,
    // notesP: array of reveal progress per notification; lowP: low-battery sheet; off: screen death
    update({ notesP = [], lowP = 0, off = 0, level = battery } = {}) {
      pct.textContent = `${Math.max(0, Math.round(level))}%`;
      fill.style.width = `${Math.max(3, level)}%`;
      cards.forEach((c, i) => reveal(c, E.glide(clamp(notesP[i] ?? 0)), { y: -20, blur: 10, scale: 0.96 }));
      reveal(low, E.glide(clamp(lowP)), { y: 20, blur: 10, scale: 0.94 });
      black.style.opacity = off;
    },
  };
}
