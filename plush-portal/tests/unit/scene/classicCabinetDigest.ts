/**
 * One digest per case for the classic cabinet: every merged mesh's material, flags and attribute bytes.
 * `machineDressing.test.ts` compares the classic cabinet against the value recorded on the tree before
 * machine dressing existed (CLASSIC_CABINET_DIGEST), so the classic floor and chute stay byte-identical.
 */
import { buildCabinet, layoutFor, meshDigest } from './cabinetHarness';
import type { DetailLevel } from '../../../src/scene/materials';
import type { ThemeId } from '../../../src/core/types';

export const DIGEST_CASES: { name: string; theme: ThemeId; detail: DetailLevel; display: 'desktop' | 'portrait32' | 'portrait86' | 'mobile'; w: number; h: number }[] = [
  { name: 'desktop sakura medium', theme: 'sakura', detail: 1, display: 'desktop', w: 1280, h: 720 },
  { name: 'portrait32 ocean high', theme: 'ocean', detail: 2, display: 'portrait32', w: 1080, h: 1920 },
  { name: 'mobile cosmic safe', theme: 'cosmic', detail: 0, display: 'mobile', w: 844, h: 390 },
  { name: 'portrait86 storybook ultra', theme: 'storybook', detail: 3, display: 'portrait86', w: 1080, h: 1920 },
];

function fnvString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function classicDigests(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of DIGEST_CASES) {
    const { cabinet } = buildCabinet({ theme: c.theme, detail: c.detail, layout: layoutFor(c.display, c.w, c.h) });
    const lines = meshDigest(cabinet.group);
    out[c.name] = `${lines.length}:${fnvString(lines.join('\n'))}`;
    cabinet.dispose();
  }
  return out;
}
