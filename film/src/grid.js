// Split-screen system: the frame divides 1 -> 2 -> 4 -> 8 -> 16. Every panel is a
// full 1920x1080 scene scaled into its cell, so each place keeps its own camera,
// light and depth. Dividers are 1 px warm grey hairlines.
import { el, css, lerp, clamp, E, W, H } from './engine.js';

// Layouts are built by *splitting*: every step halves each existing cell, and the
// new panel opens out of the far edge of the cell it splits from. Panel identity is
// stable across steps, so nothing ever crosses: 1 -> 2 (vertical split), 2 -> 4
// (horizontal), 4 -> 8 (vertical), 8 -> 16 (horizontal).
const STEPS = [1, 2, 4, 8, 16];
export function cells(n) {
  let rects = [[0, 0, W, H]];
  for (const m of STEPS.slice(1)) {
    if (m > n) break;
    const vertical = rects.length === 1 || rects.length === 4;
    const next = rects.map(r => vertical ? [r[0], r[1], r[2] / 2, r[3]] : [r[0], r[1], r[2], r[3] / 2]);
    const born = rects.map(r => vertical ? [r[0] + r[2] / 2, r[1], r[2] / 2, r[3]] : [r[0], r[1] + r[3] / 2, r[2], r[3] / 2]);
    rects = [...next, ...born];
  }
  return rects;
}
// where a newborn panel starts: zero-size at the far edge of its parent cell
function birth(nB, i) {
  const B = cells(nB), half = B.length / 2, parent = i - half;
  const r = B[i], vertical = half === 1 || half === 4;
  return vertical ? [r[0] + r[2], r[1], 0, r[3]] : [r[0], r[1] + r[3], r[2], 0];
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
        if (!a && b) a = birth(nB, i);
        if (a && !b) b = [a[0], a[1], 0, a[3]];
        if (!a && !b) { P.cell.style.display = 'none'; return; }
        const r = a.map((v, j) => lerp(v, b[j], k));
        if (r[2] < 0.5 || r[3] < 0.5) { P.cell.style.display = 'none'; return; }
        P.cell.style.display = 'block';
        P.rect = r;
        css(P.cell, { left: r[0] + 'px', top: r[1] + 'px', width: r[2] + 'px', height: r[3] + 'px' });
        // the scene keeps the scale of its *final* cell (no squash), centred in the
        // opening window, so a split reads as a window opening onto another place
        const sB = Math.max(b[2] / W, b[3] / H), sA = (a[2] > 0 && a[3] > 0) ? Math.max(a[2] / W, a[3] / H) : sB;
        const s = lerp(sA, sB, k) * (P.zoom || 1);
        css(P.inner, { transform: `translate(${(r[2] - W * s) / 2}px, ${(r[3] - H * s) / 2}px) scale(${s})` });
      });
    },
  };
}
