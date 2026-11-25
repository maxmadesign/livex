import { useMemo, useSyncExternalStore } from 'react';
import type { GenreId, MachineId } from '../../game/machines/ids';
import type { ThemeId } from '../../core/types';
import { THEMES } from '../../themes/themes';

/**
 * Card art of the machines: an original illustration per genre (a claw over a plush pile, a box on
 * two bars, boxes tumbling off a shelf, a gem pile against a stopwatch), drawn as SVG in the colours
 * of the current theme. The GPU theme gets its palette only (black, greys, white and the brand green).
 *
 * Injection point for the rendered previews of the machines (the rendering workstream's
 * `buildMachinePreview`): `setMachinePreviewSource(fn)` registers a function that returns an image
 * URL (a data URL of a rendered preview) for a machine and theme, or null to keep this art. The
 * lobby cards and the session card read it through `machineArtUrl`, nothing else changes.
 */

export type MachinePreviewSource = (id: MachineId, genre: GenreId, themeId: ThemeId) => string | null;

let previewSource: MachinePreviewSource | null = null;
let previewVersion = 0;
const listeners = new Set<() => void>();

/** Registers (or clears, with null) the source of rendered machine previews. */
export function setMachinePreviewSource(source: MachinePreviewSource | null): void {
  previewSource = source;
  previewVersion++;
  for (const notify of listeners) notify();
}

/** Called when the preview source changes (the lobby re-reads the art). */
export function onMachinePreviewSource(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

interface ArtPalette {
  bgTop: string;
  bgBottom: string;
  floor: string;
  line: string;
  main: string;
  deep: string;
  accent: string;
  accent2: string;
  light: string;
  shade: string;
  face: string;
}

/** The art's colours for a theme (the GPU theme: its palette only). */
export function artPalette(themeId: ThemeId): ArtPalette {
  const ui = THEMES[themeId].ui;
  if (themeId === 'gpu') {
    return { bgTop: '#262626', bgBottom: '#0d0d0d', floor: '#1a1a1a', line: '#4d4d4d', main: ui.primary, deep: ui.primaryDeep, accent: '#ffffff', accent2: ui.glow, light: '#ffffff', shade: '#000000', face: '#000000' };
  }
  const dark = themeId === 'cosmic';
  return {
    bgTop: dark ? '#3b2d6b' : ui.panel,
    bgBottom: dark ? ui.paper : mix(ui.glow, ui.panel),
    floor: dark ? '#241b44' : ui.paper,
    line: dark ? ui.glow : ui.primaryDeep,
    main: ui.primary,
    deep: ui.primaryDeep,
    accent: ui.accent,
    accent2: ui.accent2,
    light: '#ffffff',
    shade: dark ? '#120c26' : ui.ink,
    face: dark ? '#120c26' : ui.ink,
  };
}

/** Average of two #rrggbb colours. */
function mix(a: string, b: string): string {
  const p = (c: string, i: number) => parseInt(c.slice(1 + 2 * i, 3 + 2 * i), 16);
  const out = [0, 1, 2].map((i) => Math.round((p(a, i) + p(b, i)) / 2).toString(16).padStart(2, '0'));
  return `#${out.join('')}`;
}

const W = 320;
const H = 200;

function frame(p: ArtPalette, body: string, id: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<defs><linearGradient id="bg-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bgTop}"/><stop offset="1" stop-color="${p.bgBottom}"/></linearGradient>`,
    `<radialGradient id="glow-${id}" cx="0.5" cy="0.35" r="0.6"><stop offset="0" stop-color="${p.light}" stop-opacity="0.55"/><stop offset="1" stop-color="${p.light}" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="${W}" height="${H}" fill="url(#bg-${id})"/>`,
    `<rect width="${W}" height="${H}" fill="url(#glow-${id})"/>`,
    sparkle(26, 30, 7, p.light, 0.8),
    sparkle(292, 24, 5, p.light, 0.7),
    sparkle(300, 92, 4, p.accent2, 0.8),
    body,
    `</svg>`,
  ].join('');
}

function sparkle(x: number, y: number, r: number, fill: string, opacity: number): string {
  const s = r * 0.28;
  return `<path d="M${x} ${y - r}L${x + s} ${y - s}L${x + r} ${y}L${x + s} ${y + s}L${x} ${y + r}L${x - s} ${y + s}L${x - r} ${y}L${x - s} ${y - s}Z" fill="${fill}" opacity="${opacity}"/>`;
}

/** The three-finger claw hanging at (x, y) (the hub's top centre). */
function claw(p: ArtPalette, x: number, y: number, rope: number, open = 1): string {
  const spread = 16 + 8 * open;
  return [
    `<line x1="${x}" y1="${y - rope}" x2="${x}" y2="${y}" stroke="${p.line}" stroke-width="3" stroke-linecap="round"/>`,
    `<rect x="${x - 17}" y="${y}" width="34" height="15" rx="6" fill="${p.deep}"/>`,
    `<rect x="${x - 11}" y="${y + 3}" width="22" height="4" rx="2" fill="${p.light}" opacity="0.45"/>`,
    `<path d="M${x - 10} ${y + 14}C${x - spread - 6} ${y + 26} ${x - spread - 4} ${y + 40} ${x - spread + 4} ${y + 48}" fill="none" stroke="${p.line}" stroke-width="4.5" stroke-linecap="round"/>`,
    `<path d="M${x + 10} ${y + 14}C${x + spread + 6} ${y + 26} ${x + spread + 4} ${y + 40} ${x + spread - 4} ${y + 48}" fill="none" stroke="${p.line}" stroke-width="4.5" stroke-linecap="round"/>`,
    `<path d="M${x} ${y + 15}L${x} ${y + 44}" stroke="${p.line}" stroke-width="4.5" stroke-linecap="round"/>`,
    `<circle cx="${x - spread + 4}" cy="${y + 49}" r="4" fill="${p.main}"/>`,
    `<circle cx="${x + spread - 4}" cy="${y + 49}" r="4" fill="${p.main}"/>`,
    `<circle cx="${x}" cy="${y + 46}" r="4" fill="${p.main}"/>`,
  ].join('');
}

/** A round plush face with ears at (x, y), radius r. */
function plush(p: ArtPalette, x: number, y: number, r: number, body: string, ears: 'round' | 'pointy' = 'round'): string {
  const ear =
    ears === 'round'
      ? `<circle cx="${x - r * 0.68}" cy="${y - r * 0.72}" r="${r * 0.36}" fill="${body}"/><circle cx="${x + r * 0.68}" cy="${y - r * 0.72}" r="${r * 0.36}" fill="${body}"/>`
      : `<path d="M${x - r * 0.9} ${y - r * 0.35}L${x - r * 0.62} ${y - r * 1.22}L${x - r * 0.18} ${y - r * 0.8}Z" fill="${body}"/><path d="M${x + r * 0.9} ${y - r * 0.35}L${x + r * 0.62} ${y - r * 1.22}L${x + r * 0.18} ${y - r * 0.8}Z" fill="${body}"/>`;
  return [
    ear,
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${body}"/>`,
    `<ellipse cx="${x - r * 0.25}" cy="${y - r * 0.35}" rx="${r * 0.35}" ry="${r * 0.2}" fill="${p.light}" opacity="0.45"/>`,
    `<circle cx="${x - r * 0.33}" cy="${y + r * 0.05}" r="${r * 0.1}" fill="${p.face}"/>`,
    `<circle cx="${x + r * 0.33}" cy="${y + r * 0.05}" r="${r * 0.1}" fill="${p.face}"/>`,
    `<path d="M${x - r * 0.12} ${y + r * 0.3}Q${x} ${y + r * 0.42} ${x + r * 0.12} ${y + r * 0.3}" fill="none" stroke="${p.face}" stroke-width="${Math.max(1.2, r * 0.08)}" stroke-linecap="round"/>`,
    `<ellipse cx="${x - r * 0.58}" cy="${y + r * 0.28}" rx="${r * 0.16}" ry="${r * 0.1}" fill="${p.deep}" opacity="0.45"/>`,
    `<ellipse cx="${x + r * 0.58}" cy="${y + r * 0.28}" rx="${r * 0.16}" ry="${r * 0.1}" fill="${p.deep}" opacity="0.45"/>`,
  ].join('');
}

function classicArt(p: ArtPalette): string {
  return [
    `<rect x="0" y="150" width="${W}" height="50" fill="${p.floor}" opacity="0.85"/>`,
    // The prize chute on the left.
    `<rect x="18" y="112" width="70" height="58" rx="6" fill="${p.main}" opacity="0.35" stroke="${p.line}" stroke-width="2"/>`,
    `<rect x="30" y="124" width="46" height="10" rx="5" fill="${p.light}" opacity="0.7"/>`,
    claw(p, 182, 46, 46, 1),
    plush(p, 132, 150, 26, p.main),
    plush(p, 186, 146, 30, p.accent, 'pointy'),
    plush(p, 240, 152, 25, p.accent2),
    plush(p, 160, 176, 22, p.deep),
    plush(p, 214, 180, 22, p.main, 'pointy'),
    plush(p, 270, 182, 20, p.accent),
  ].join('');
}

function bridgeArt(p: ArtPalette): string {
  const bar = (y: number, x0: number, x1: number, r: number) =>
    `<rect x="${x0}" y="${y - r}" width="${x1 - x0}" height="${2 * r}" rx="${r}" fill="${p.line}"/><rect x="${x0 + 6}" y="${y - r * 0.55}" width="${x1 - x0 - 12}" height="${r * 0.5}" rx="${r * 0.25}" fill="${p.light}" opacity="0.5"/>`;
  return [
    `<rect x="0" y="168" width="${W}" height="32" fill="${p.floor}" opacity="0.85"/>`,
    // The pit between the fences and the two bars.
    `<rect x="70" y="120" width="180" height="62" rx="8" fill="${p.shade}" opacity="0.18"/>`,
    `<rect x="82" y="146" width="156" height="34" rx="6" fill="${p.shade}" opacity="0.22"/>`,
    `<path d="M160 156v16m-6 -6l6 6l6 -6" stroke="${p.accent2}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    bar(128, 54, 266, 6),
    bar(150, 44, 276, 7),
    // The box resting across the bars, one end raised.
    `<g transform="rotate(-11 160 124)">`,
    `<rect x="96" y="96" width="128" height="40" rx="5" fill="${p.main}" stroke="${p.deep}" stroke-width="3"/>`,
    `<path d="M96 96l14 -12h128l-14 12z" fill="${p.accent}" stroke="${p.deep}" stroke-width="3" stroke-linejoin="round"/>`,
    `<path d="M224 96l14 -12v40l-14 12z" fill="${p.deep}" opacity="0.85"/>`,
    `<rect x="104" y="104" width="112" height="6" rx="3" fill="${p.light}" opacity="0.5"/>`,
    plush(p, 160, 120, 12, p.accent2),
    `</g>`,
    claw(p, 214, 34, 34, 0.6),
  ].join('');
}

function shelfArt(p: ArtPalette): string {
  const box = (x: number, y: number, w: number, h: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="${p.deep}" stroke-width="2.5"/><rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="4" rx="2" fill="${p.light}" opacity="0.55"/><circle cx="${x + w / 2}" cy="${y + h * 0.62}" r="${Math.min(w, h) * 0.18}" fill="${p.light}" opacity="0.75"/>`;
  return [
    // The trough under the front edge: a recessed channel with a rim.
    `<rect x="0" y="158" width="${W}" height="42" fill="${p.floor}" opacity="0.9"/>`,
    `<path d="M12 166H308L296 196H24Z" fill="${p.shade}" opacity="0.32"/>`,
    `<path d="M24 182H296L292 196H28Z" fill="${p.shade}" opacity="0.22"/>`,
    `<rect x="10" y="162" width="300" height="6" rx="3" fill="${p.line}" opacity="0.85"/>`,
    // The shelf with its front lip.
    `<rect x="16" y="120" width="250" height="14" rx="4" fill="${p.line}"/>`,
    `<rect x="16" y="114" width="250" height="7" rx="3" fill="${p.accent}" opacity="0.9"/>`,
    box(36, 82, 40, 32, p.main),
    box(40, 52, 32, 30, p.accent2),
    box(88, 84, 36, 30, p.accent),
    box(136, 78, 44, 36, p.main),
    box(142, 48, 32, 30, p.accent),
    box(194, 86, 34, 28, p.accent2),
    // A box tumbling over the edge, with motion arcs.
    `<g transform="rotate(32 270 140)">${box(252, 122, 36, 30, p.main)}</g>`,
    `<path d="M232 104q30 -6 44 18M226 118q26 -2 38 16" fill="none" stroke="${p.light}" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`,
    claw(p, 120, 18, 18, 0.5),
  ].join('');
}

function rushArt(p: ArtPalette): string {
  const gem = (x: number, y: number, s: number, fill: string) =>
    `<path d="M${x - s} ${y - s * 0.35}L${x - s * 0.55} ${y - s}H${x + s * 0.55}L${x + s} ${y - s * 0.35}L${x} ${y + s}Z" fill="${fill}" stroke="${p.deep}" stroke-width="2" stroke-linejoin="round"/><path d="M${x - s} ${y - s * 0.35}H${x + s}M${x - s * 0.55} ${y - s}L${x - s * 0.25} ${y - s * 0.35}L${x} ${y + s}L${x + s * 0.25} ${y - s * 0.35}L${x + s * 0.55} ${y - s}" fill="none" stroke="${p.light}" stroke-width="1.5" opacity="0.7"/>`;
  const coin = (x: number, y: number, r: number) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${p.accent2}" stroke="${p.deep}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="${r * 0.62}" fill="none" stroke="${p.light}" stroke-width="2" opacity="0.8"/>`;
  return [
    `<rect x="0" y="150" width="${W}" height="50" fill="${p.floor}" opacity="0.85"/>`,
    gem(70, 160, 18, p.main),
    gem(110, 168, 15, p.accent),
    coin(146, 160, 13),
    gem(182, 162, 20, p.accent2),
    gem(226, 168, 16, p.main),
    coin(262, 162, 12),
    gem(92, 136, 14, p.accent2),
    gem(140, 132, 17, p.main),
    coin(206, 136, 11),
    gem(244, 140, 14, p.accent),
    gem(168, 112, 13, p.accent),
    // The stopwatch.
    `<circle cx="262" cy="62" r="34" fill="${p.light}" stroke="${p.deep}" stroke-width="5"/>`,
    `<rect x="254" y="18" width="16" height="10" rx="3" fill="${p.deep}"/>`,
    `<path d="M262 62V40" stroke="${p.main}" stroke-width="5" stroke-linecap="round"/>`,
    `<path d="M262 62L278 72" stroke="${p.face}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M262 28a34 34 0 0 1 34 34h-34z" fill="${p.main}" opacity="0.3"/>`,
    sparkle(118, 98, 9, p.accent2, 0.95),
    sparkle(214, 104, 7, p.light, 0.9),
    claw(p, 86, 32, 32, 0.8),
  ].join('');
}

const ART: Record<GenreId, (p: ArtPalette) => string> = { classic: classicArt, bridge: bridgeArt, shelf: shelfArt, rush: rushArt };

/** The SVG markup of a genre's card art in a theme's colours. */
export function genreArtSvg(genre: GenreId, themeId: ThemeId): string {
  return frame(artPalette(themeId), ART[genre](artPalette(themeId)), `${genre}-${themeId}`);
}

const cache = new Map<string, string>();

/** The card art as an image URL: the registered preview if there is one, else this module's SVG. */
export function machineArtUrl(id: MachineId, genre: GenreId, themeId: ThemeId): string {
  const preview = previewSource?.(id, genre, themeId);
  if (preview) return preview;
  const key = `${genre}/${themeId}`;
  let url = cache.get(key);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(genreArtSvg(genre, themeId))}`;
    cache.set(key, url);
  }
  return url;
}

/** The art of a machine as an <img> (decorative: the card names the machine in text). */
export function MachineArt({ id, genre, themeId, className }: { id: MachineId; genre: GenreId; themeId: ThemeId; className?: string }) {
  // A newly registered preview source redraws every card.
  const version = useSyncExternalStore(onMachinePreviewSource, () => previewVersion, () => previewVersion);
  const url = useMemo(() => machineArtUrl(id, genre, themeId), [id, genre, themeId, version]);
  return <img className={className ?? 'pp-machine-art'} src={url} alt="" draggable={false} data-genre={genre} />;
}
