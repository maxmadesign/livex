/**
 * Rendering of the machines (docs/design/machines.md, section 5). Everything a machine looks like
 * follows its FieldGeometry, the same object the physics is built from:
 *
 *   floor.ts       the play floor with the machine's hole, collar, light lip and front lip
 *   fixtures.ts    bars, fences, shelf deck and gutter, merged into the cabinet's material buckets
 *   itemLooks.ts   item colours per theme (the gpu theme draws palette colours only)
 *   printAtlas.ts  the printed portraits of boxes and snacks (one canvas texture per theme)
 *   preview.ts     small static machine models and card pictures for the lobby
 *
 * plus `ItemVisuals` (src/scene/ItemVisuals.ts) for the items themselves. This module also answers
 * what the stage and the effects need to know about the opening.
 */
import type { FieldGeometry, Rect } from '../../physics/fieldGeometry';
import { fixtureBounds } from '../../physics/fieldGeometry';
import { CHUTE, FIELD } from '../../physics/fieldSpec';

export { buildHoleFloor, frontSpans, innerEdges } from './floor';
export { buildFixtures, capsuleGeometry, prizeSignSpot, type DressContext } from './fixtures';

export interface OpeningLook {
  /** The prize opening (effects erupt from it, particles fall through it). */
  opening: Rect;
  /** Height of its mouth: the top of the guard walls or fences around it, else just above the floor. */
  mouthY: number;
  /** The floor hole the contact shadows must never darken. */
  contactHole: Rect;
  /** Whether any of the floor is left to receive contact shadows (a shelf covers all of it). */
  floorVisible: boolean;
}

/** What the stage and the effects need to know about a machine's opening and floor. */
export function openingLook(field: FieldGeometry): OpeningLook {
  const o = field.opening;
  const opening: Rect = { xMin: o.xMin, xMax: o.xMax, zMin: o.zMin, zMax: o.zMax };
  let mouthY = 0.012;
  if (field.chuteGuard) mouthY = CHUTE.wallHeight + 0.012;
  else {
    for (const f of field.fixtures) {
      if (f.look !== 'acrylic') continue;
      const b = fixtureBounds(f);
      const near = b.max[0] > o.xMin - 0.03 && b.min[0] < o.xMax + 0.03 && b.max[2] > o.zMin - 0.03 && b.min[2] < o.zMax + 0.03;
      if (near) mouthY = Math.max(mouthY, b.max[1] + 0.012);
    }
  }
  const contactHole: Rect = field.floor.kind === 'classic' ? { xMin: CHUTE.xMin, xMax: CHUTE.xMax, zMin: CHUTE.zMin, zMax: CHUTE.zMax } : { ...field.floor.hole };
  return { opening, mouthY, contactHole, floorVisible: visibleFloorShare(field, contactHole) > 0.02 };
}

/**
 * Share of the floor (0..1) that is neither the hole nor covered by a fixture lying on it (a shelf
 * block, the gutter), sampled on a 5 cm grid.
 */
export function visibleFloorShare(field: FieldGeometry, hole: Rect): number {
  const covers = field.fixtures
    .filter((f) => f.look === 'deck' || f.look === 'ramp')
    .map((f) => fixtureBounds(f))
    .filter((b) => b.min[1] < 0.05);
  let seen = 0, total = 0;
  for (let x = -FIELD.halfWidth + 0.025; x < FIELD.halfWidth; x += 0.05)
    for (let z = -FIELD.depth + 0.025; z < 0; z += 0.05) {
      total++;
      if (x > hole.xMin && x < hole.xMax && z > hole.zMin && z < hole.zMax) continue;
      if (covers.some((b) => x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2])) continue;
      seen++;
    }
  return seen / total;
}
