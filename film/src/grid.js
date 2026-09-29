// Split-screen system: the frame divides 1 -> 2 -> 4 -> 8 -> 16. Every panel is a
// full 1920x1080 scene scaled into its cell, so each place keeps its own camera,
// light and depth. Dividers are 1 px warm grey hairlines.
import { el, css, lerp, clamp, E, W, H } from './engine.js';

// Cells for n panels (x, y, w, h in px). Order matters: panel i keeps its identity
// across layouts so cells can morph.
export function cells(n) {
  if (n <= 1) return [[0, 0, W, H]];
  if (n === 2) return [[0, 0, W / 2, H], [W / 2, 0, W / 2, H]];
  if (n === 4) return [[0, 0, W / 2, H / 2], [W / 2, 0, W / 2, H / 2], [0, H / 2, W / 2, H / 2], [W / 2, H / 2, W / 2, H / 2]];
  const cols = n === 8 ? 4 : 4, rows = n === 8 ? 2 : 4;
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([c * W / cols, r * H / rows, W / cols, H / rows]);
  return out;
}

// panelsRoot: container. makePanel(i, root) builds panel i into a 1920x1080 root.
export function Grid(parent, count, makePanel) {
  const wrap = el('div', 'layer', parent);
  const panels = Array.from({ length: count }, (_, i) => {
    const cell = el('div', 'abs', wrap);
    css(cell, { overflow: 'hidden', outline: '1px solid rgba(210,200,190,0.55)', outlineOffset: '-0.5px' });
    const inner = el('div', 'abs', cell);
    css(inner, { width: W + 'px', height: H + 'px', transformOrigin: '0 0' });
    const api = makePanel(i, inner);
    return { cell, inner, api, rect: [0, 0, W, H] };
  });
  return {
    el: wrap, panels,
    // layoutA -> layoutB with progress k. A panel absent from A grows out of its B cell's
    // left edge (a split line opening), a panel absent from B collapses.
    layout(nA, nB, k) {
      const A = cells(nA), B = cells(nB);
      panels.forEach((P, i) => {
        let a = A[i], b = B[i];
        if (!a && b) a = [b[0], b[1], 0, b[3]];
        if (a && !b) b = [a[0], a[1], 0, a[3]];
        if (!a && !b) { P.cell.style.display = 'none'; return; }
        const r = a.map((v, j) => lerp(v, b[j], k));
        if (r[2] < 0.5 || r[3] < 0.5) { P.cell.style.display = 'none'; return; }
        P.cell.style.display = 'block';
        P.rect = r;
        css(P.cell, { left: r[0] + 'px', top: r[1] + 'px', width: r[2] + 'px', height: r[3] + 'px' });
        // fit the 16:9 scene into the cell (cover), centred
        const s = Math.max(r[2] / W, r[3] / H);
        css(P.inner, { transform: `translate(${(r[2] - W * s) / 2}px, ${(r[3] - H * s) / 2}px) scale(${s})` });
      });
    },
  };
}
