import { describe, expect, it } from 'vitest';
import { computeWindowLayout, eyeToWorld, type WindowEnvironment } from '../../../src/perspective/windowGeometry';
import { FIELD } from '../../../src/physics/fieldSpec';
import { pileSlots, revealedX, ROW, rowX } from '../../../src/scene/arcadeRow';
import { defaultSettings } from '../../../src/settings/spec';

/** A canvas that is the whole physical screen (kiosk / simulated 9:16 screen). */
function env(w: number, h: number): WindowEnvironment {
  return { viewportW: w, viewportH: h, screenW: w, screenH: h, canvasCenterX: w / 2, canvasCenterY: h / 2, simulated: true };
}

const settings = defaultSettings();
const view = (id: 'desktop' | 'portrait32' | 'portrait86' | 'mobile') => ({ ...settings.profiles[id].view, windowMode: 'fullscreen' as const });

/** Eye in world units for an eye offset (metres) from the preset's reference eye. */
function eyeWorld(id: 'desktop' | 'portrait32' | 'portrait86' | 'mobile', w: number, h: number, dx = 0) {
  const v = view(id);
  const layout = computeWindowLayout(env(w, h), v, settings.profiles[id].layout.floorY);
  const out: [number, number, number] = [0, 0, 0];
  eyeToWorld(layout, [v.eye[0] + dx, v.eye[1], v.eye[2]], out);
  return { layout, eye: out };
}

describe('arcade row geometry', () => {
  it('pillars and neighbours stand outside our play field and its side glass', () => {
    expect(ROW.postInner).toBeGreaterThan(FIELD.halfWidth + 0.006);
    expect(ROW.postOuter).toBeGreaterThan(ROW.postInner);
    expect(ROW.glassX).toBeGreaterThan(ROW.postOuter);
    expect(ROW.fieldInner).toBeGreaterThan(ROW.glassX);
    expect(ROW.frontZ).toBeLessThan(0);
    expect(ROW.backZ).toBeLessThan(-FIELD.depth);
    // Nothing of the row comes in front of the glass (the screen plane, z = 0).
    expect(ROW.postFront).toBeLessThanOrEqual(0);
    expect(rowX(-1, 0.2)).toBeCloseTo(-rowX(1, 0.2), 12);
  });

  it('plush piles: six a side on landscape, three on the Safe tier, two a side on portrait, all on the neighbours’ floors', () => {
    expect(pileSlots(true, 1)).toHaveLength(12);
    expect(pileSlots(true, 0)).toHaveLength(6);
    expect(pileSlots(false, 3)).toHaveLength(4);
    for (const s of pileSlots(true, 2)) {
      const local = Math.abs(s.x) - ROW.fieldInner;
      expect(local).toBeGreaterThan(0.05);
      expect(local).toBeLessThan(ROW.fieldWidth - 0.05);
      expect(s.z).toBeLessThan(ROW.frontZ - 0.1);
      expect(s.z).toBeGreaterThan(ROW.backZ + 0.1);
      expect(s.y).toBeGreaterThanOrEqual(0);
    }
    // The two piles show different characters at the same spot.
    const slots = pileSlots(true, 1);
    expect(slots[0]!.pick).not.toBe(slots[6]!.pick);
    // Mirrored: same depth, opposite side.
    expect(slots[0]!.x).toBeCloseTo(-slots[6]!.x, 12);
    expect(slots[0]!.z).toBe(slots[6]!.z);
  });

  it('revealedX: the line from the eye past an edge, met at a deeper plane', () => {
    // Straight ahead of the edge: the hidden region starts right behind it.
    expect(revealedX(0.5, 2, 0.5, 0, -1)).toBeCloseTo(0.5, 12);
    // From the middle, the window edge at x = 0.5 reveals up to 0.75 one metre deep for an eye 2 m away.
    expect(revealedX(0, 2, 0.5, 0, -1)).toBeCloseTo(0.75, 12);
    // Moving the eye the other way reveals more; towards the edge, less.
    expect(revealedX(-0.5, 2, 0.5, 0, -1)).toBeGreaterThan(0.75);
    expect(revealedX(0.3, 2, 0.5, 0, -1)).toBeLessThan(0.75);
  });

  it('portrait 9:16: the neighbours are outside the window; a sideways eye reveals them through the side glass', () => {
    for (const id of ['portrait32', 'portrait86'] as const) {
      const neutral = eyeWorld(id, 1080, 1920);
      const max = view(id).maxOffset[0];
      const peek = eyeWorld(id, 1080, 1920, -max * 0.85);
      // The window shows the machine's width only: the pillar starts beyond the screen edge.
      expect(neutral.layout.width / 2).toBeLessThan(ROW.postOuter);
      // Through our right side glass, at the depth of the neighbour's claw.
      const edgeX = neutral.layout.width / 2 - neutral.layout.frame;
      const clawX = rowX(1, ROW.claw.x);
      const atNeutral = revealedX(neutral.eye[0], neutral.eye[2], edgeX, -0.045, ROW.claw.z);
      const peeking = revealedX(peek.eye[0], peek.eye[2], edgeX, -0.045, ROW.claw.z);
      expect(peeking).toBeGreaterThan(atNeutral + 0.1);
      expect(peeking, `${id}: a full sideways peek shows the neighbour's claw`).toBeGreaterThan(clawX);
      // And at the back the neighbour's inner glass is already in view at neutral on the 86" panel.
      if (id === 'portrait86') expect(revealedX(neutral.eye[0], neutral.eye[2], edgeX, -0.045, ROW.backZ)).toBeGreaterThan(ROW.glassX);
    }
  });

  it('landscape 16:9: the pillar and a good part of each neighbour are inside the window at neutral', () => {
    const { layout, eye } = eyeWorld('desktop', 1920, 1080);
    const inner = layout.width / 2 - layout.frame;
    expect(inner).toBeGreaterThan(ROW.postOuter + 0.3);
    // The neighbour's claw is in view straight on.
    expect(rowX(1, ROW.claw.x)).toBeLessThan(revealedX(eye[0], eye[2], inner, 0, ROW.claw.z));
  });
});
