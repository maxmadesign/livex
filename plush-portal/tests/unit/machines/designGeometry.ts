/**
 * The bridge and shelf layouts of docs/design/machines.md (sections 3.1 and 3.2) as test data.
 * They prove the physics layer can build the designed machines; the genre modules (WS-B, WS-C)
 * own and tune the real numbers in src/game/machines.
 */
import type { FieldGeometry, PrizeOpening } from '../../../src/physics/fieldGeometry';

const PIT = { xMin: -0.42, xMax: 0.02, zMin: -0.38, zMax: -0.06 };
const PIT_OPENING: PrizeOpening = { ...PIT, sensorTop: -0.1, sensorBottom: -0.3, awardComY: -0.06, overMargin: 0.02 };

/** TIPPY BRIDGE: two chrome bars over a pit inside the bin footprint, four acrylic fences. */
export const BRIDGE_GEOMETRY: FieldGeometry = {
  floor: { kind: 'hole', hole: PIT },
  chuteGuard: false,
  opening: PIT_OPENING,
  fixtures: [
    { id: 'barL', kind: 'bar', look: 'chrome', shape: { type: 'capsule', axis: 'z', halfLength: 0.15, radius: 0.012 }, center: [-0.287, 0.1, -0.22], friction: 0.35, restitution: 0.05 },
    { id: 'barR', kind: 'bar', look: 'chrome', shape: { type: 'capsule', axis: 'z', halfLength: 0.15, radius: 0.012 }, center: [-0.113, 0.1, -0.22], friction: 0.35, restitution: 0.05 },
    { id: 'sideL', kind: 'fence', look: 'acrylic', shape: { type: 'box', half: [0.005, 0.08, 0.165] }, center: [-0.425, 0.08, -0.22], friction: 0.3, restitution: 0.1 },
    { id: 'sideR', kind: 'fence', look: 'acrylic', shape: { type: 'box', half: [0.005, 0.08, 0.165] }, center: [0.025, 0.08, -0.22], friction: 0.3, restitution: 0.1 },
    { id: 'endBack', kind: 'fence', look: 'acrylic', shape: { type: 'box', half: [0.23, 0.08, 0.005] }, center: [-0.2, 0.08, -0.385], friction: 0.4, restitution: 0.05 },
    { id: 'endFront', kind: 'fence', look: 'acrylic', shape: { type: 'box', half: [0.23, 0.08, 0.005] }, center: [-0.2, 0.08, -0.055], friction: 0.4, restitution: 0.05 },
  ],
  home: { x: 0.2, z: -0.5 },
};

const TROUGH = { xMin: -0.5, xMax: 0, zMin: -0.3, zMax: 0 };

/** TUMBLE SHELF: a raised shelf with a lip, the trough in front of it, a slick gutter on the right. */
export const SHELF_GEOMETRY: FieldGeometry = {
  floor: { kind: 'hole', hole: TROUGH },
  chuteGuard: false,
  opening: { ...TROUGH, sensorTop: -0.1, sensorBottom: -0.3, awardComY: -0.06, overMargin: 0.02 },
  fixtures: [
    { id: 'shelf', kind: 'shelf', look: 'deck', shape: { type: 'box', half: [0.5, 0.08, 0.25] }, center: [0, 0.08, -0.55], friction: 0.55, restitution: 0.02 },
    { id: 'lip', kind: 'lip', look: 'chrome', shape: { type: 'box', half: [0.5, 0.007, 0.006] }, center: [0, 0.167, -0.306], friction: 0.4, restitution: 0.05 },
    {
      id: 'gutter',
      kind: 'gutter',
      look: 'ramp',
      shape: { type: 'box', half: [0.2532, 0.01, 0.15] },
      center: [0.25, 0.0499, -0.15],
      rot: [0, 0, 0.0792, 0.9969],
      friction: 0.05,
      restitution: 0.02,
      frictionCombine: 'min',
    },
  ],
  home: { x: 0.06, z: -0.4 },
};
