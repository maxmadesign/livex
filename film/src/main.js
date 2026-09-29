// Entry: builds the film (or a test entry via ?entry=name) and exposes the
// deterministic render hooks the capture script drives.
import { Film, imagesReady } from './engine.js';
import { installPost } from './post.js';

const params = new URLSearchParams(location.search);
const entry = params.get('entry') || 'film';

window.__ready = (async () => {
  const stage = document.getElementById('stage');
  // shared SVG filters: directional motion blur (long-exposure crowds, handoffs)
  document.body.insertAdjacentHTML('afterbegin', `<svg width="0" height="0" style="position:absolute"><defs>
    <filter id="mblur" x="-50%" y="-10%" width="200%" height="120%"><feGaussianBlur stdDeviation="46 3"/></filter>
    <filter id="mblur2" x="-50%" y="-10%" width="200%" height="120%"><feGaussianBlur stdDeviation="90 2"/></filter>
  </defs></svg>`);
  const film = new Film(stage, { fps: 30, duration: 60 });
  const mod = await import(`./${entry}.js`);
  await mod.setup(film);
  film.build();
  if (params.get('post') !== '0') installPost(film, stage);
  await document.fonts.ready;
  await imagesReady(stage);
  window.__film = film;
  window.__render = async (t) => {
    film.render(t);
    await imagesReady(stage);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  if (params.has('t')) await window.__render(parseFloat(params.get('t')));
  return { duration: film.duration, fps: film.fps };
})();
