// Entry: builds the film (or a test entry via ?entry=name) and exposes the
// deterministic render hooks the capture script drives.
import { Film, imagesReady } from './engine.js';
import { installPost } from './post.js';

const params = new URLSearchParams(location.search);
const entry = params.get('entry') || 'film';

window.__ready = (async () => {
  const stage = document.getElementById('stage');
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
