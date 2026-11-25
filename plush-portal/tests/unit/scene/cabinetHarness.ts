/**
 * Builds a real `Cabinet` in Node (no DOM): a minimal canvas stand-in for the few canvas textures the
 * cabinet makes itself (the backdrop), and plain stand-in materials named after the CabinetMaterials
 * fields. The geometry is exactly what the browser builds; only textures and shaders are fake.
 */
import { BufferAttribute, Mesh, MeshBasicMaterial, type BufferGeometry, type Group, type Material } from 'three';
import { computeWindowLayout, type WindowEnvironment, type WindowLayout } from '../../../src/perspective/windowGeometry';
import type { FieldGeometry } from '../../../src/physics/fieldGeometry';
import { Cabinet } from '../../../src/scene/Cabinet';
import type { CabinetMaterials, DetailLevel } from '../../../src/scene/materials';
import { defaultSettings } from '../../../src/settings/spec';
import { THEMES } from '../../../src/themes/themes';
import type { ThemeId } from '../../../src/core/types';

/** A 2D context whose every call does nothing (gradients and image data are plain objects). */
function fakeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const target: Record<string, unknown> = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createConicGradient: () => gradient,
    createPattern: () => ({}),
    measureText: (s: string) => ({ width: 8 * String(s).length, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  return new Proxy(target, {
    get: (t, key: string) => (key in t ? t[key] : () => undefined),
    set: (t, key: string, value) => {
      t[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Installs `document.createElement('canvas')` (and `OffscreenCanvas`-free image stand-ins) once. */
export function installFakeCanvas(): void {
  const g = globalThis as unknown as { document?: unknown };
  if (g.document) return;
  g.document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') return {};
      const canvas = { width: 300, height: 150, style: {}, getContext: () => fakeContext(), toDataURL: () => 'data:,', addEventListener: () => undefined };
      return canvas;
    },
    createElementNS: (_ns: string, tag: string) => (g.document as { createElement: (t: string) => unknown }).createElement(tag),
  };
}

/** Stand-in materials: one MeshBasicMaterial per CabinetMaterials field, named after it. */
export function fakeMaterials(detail: DetailLevel = 1, ledCount = 3): CabinetMaterials {
  const made = new Map<string, Material>();
  const leds = Array.from({ length: ledCount }, (_, i) => {
    const m = new MeshBasicMaterial();
    m.name = `leds${i}`;
    return m;
  });
  const target: Record<string, unknown> = { detail, leds, brand: null, addAnimator: () => () => undefined };
  return new Proxy(target, {
    get: (t, key: string) => {
      if (key in t) return t[key];
      if (key === 'then') return undefined;
      let m = made.get(key);
      if (!m) {
        m = new MeshBasicMaterial();
        m.name = key;
        made.set(key, m);
      }
      return m;
    },
  }) as unknown as CabinetMaterials;
}

export function layoutFor(display: 'desktop' | 'portrait32' | 'portrait86' | 'mobile', w: number, h: number): WindowLayout {
  const s = defaultSettings();
  const env: WindowEnvironment = { viewportW: w, viewportH: h, screenW: w, screenH: h, canvasCenterX: w / 2, canvasCenterY: h / 2, simulated: true };
  return computeWindowLayout(env, { ...s.profiles[display].view, windowMode: 'fullscreen' }, s.profiles[display].layout.floorY);
}

export function buildCabinet(o: { theme?: ThemeId; detail?: DetailLevel; layout?: WindowLayout; field?: FieldGeometry } = {}): { cabinet: Cabinet; mats: CabinetMaterials } {
  installFakeCanvas();
  const mats = fakeMaterials(o.detail ?? 1);
  const layout = o.layout ?? layoutFor('desktop', 1280, 720);
  const theme = THEMES[o.theme ?? 'sakura'];
  const cabinet = o.field ? new Cabinet(layout, theme, mats, o.field) : new Cabinet(layout, theme, mats);
  return { cabinet, mats };
}

/** FNV-1a over bytes. */
function fnv(bytes: Uint8Array, h = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function attrBytes(a: BufferAttribute): Uint8Array {
  const arr = a.array as ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number };
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}

/** One line per mesh of the group, in order: material name, flags, and a hash of every attribute's bytes. */
export function meshDigest(group: Group): string[] {
  const out: string[] = [];
  group.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry as BufferGeometry;
    const m = mesh.material as Material;
    const parts = Object.keys(g.attributes)
      .sort()
      .map((k) => `${k}:${g.getAttribute(k).count}:${fnv(attrBytes(g.getAttribute(k) as BufferAttribute)).toString(16)}`);
    const index = g.getIndex();
    if (index) parts.push(`index:${index.count}:${fnv(attrBytes(index)).toString(16)}`);
    out.push(`${mesh.name}|${m.name || m.type}|r${mesh.receiveShadow ? 1 : 0}c${mesh.castShadow ? 1 : 0}|o${mesh.renderOrder}|l${mesh.layers.mask}|${parts.join(',')}`);
  });
  return out;
}

/** Triangles of every drawn mesh (viewer-light stand-ins left out). */
export function triangles(group: Group): number {
  let n = 0;
  group.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.name === 'viewer-caster') return;
    const g = mesh.geometry;
    n += (g.getIndex()?.count ?? g.getAttribute('position').count) / 3;
  });
  return n;
}
