import { describe, expect, it } from 'vitest';
import { makeRng } from '../../../src/core/math';
import { PrimarySelector, type FaceCandidate } from '../../../src/tracking/primarySelector';

const face = (u: number, v = 0.45, size = 0.14, residual = 0.02): FaceCandidate => ({ u, v, size, residual });
const DT = 55; // ms between inferences (18 Hz)

describe('PrimarySelector', () => {
  it('locks a stable central face only after it has been visible for a while', () => {
    const s = new PrimarySelector();
    const results: number[] = [];
    for (let i = 0; i < 12; i++) results.push(s.update(i * DT, [face(0.5)]));
    const lockedAt = results.findIndex((r) => r === 0);
    expect(lockedAt).toBeGreaterThanOrEqual(3);
    expect(lockedAt * DT).toBeGreaterThanOrEqual(s.config.lockAfterMs);
    expect(results.slice(0, lockedAt).every((r) => r === -1)).toBe(true);
    expect(s.state).toBe('locked');
  });

  it('does not lock faces outside the central zone or with a bad fit', () => {
    const s = new PrimarySelector();
    for (let i = 0; i < 40; i++) expect(s.update(i * DT, [face(0.06), face(0.95)])).toBe(-1);
    expect(s.state).toBe('searching');
    for (let i = 40; i < 80; i++) expect(s.update(i * DT, [face(0.5, 0.45, 0.14, 0.9)])).toBe(-1);
    expect(s.state).toBe('searching');
  });

  it('prefers the near, central face over a small one in the background', () => {
    const s = new PrimarySelector();
    let index = -1;
    for (let i = 0; i < 12; i++) index = s.update(i * DT, [face(0.42, 0.3, 0.05), face(0.55, 0.45, 0.15)]);
    expect(index).toBe(1);
  });

  it('a flickering candidate does not get locked', () => {
    const s = new PrimarySelector();
    for (let i = 0; i < 60; i++) {
      // visible on one frame, gone on the next: never stable for lockAfterMs
      expect(s.update(i * DT, i % 2 === 0 ? [face(0.5)] : [])).toBe(-1);
    }
  });

  it('follows the locked player around the frame, also outside the central zone', () => {
    const s = new PrimarySelector();
    for (let i = 0; i < 10; i++) s.update(i * DT, [face(0.5)]);
    let u = 0.5;
    for (let i = 10; i < 60; i++) {
      u += 0.008;
      expect(s.update(i * DT, [face(u)])).toBe(0);
    }
    expect(u).toBeGreaterThan(0.85);
  });

  it('a bigger passer-by crossing the frame never steals the viewpoint', () => {
    const rng = makeRng(21);
    const s = new PrimarySelector();
    for (let i = 0; i < 10; i++) s.update(i * DT, [face(0.5)]);
    expect(s.state).toBe('locked');
    // The passer-by walks from left to right through the whole frame, closer to the camera
    // (bigger face), passing right "over" the player's position in the image.
    let stolen = 0;
    let frames = 0;
    for (let i = 10; i < 10 + 80; i++) {
      const progress = (i - 10) / 80;
      const playerU = 0.5 + Math.sin(i / 9) * 0.01;
      const player = face(playerU, 0.45, 0.14);
      const passerby = face(-0.1 + progress * 1.2, 0.5, 0.24);
      // MediaPipe does not keep a stable order: shuffle.
      const swapped = rng() < 0.5;
      const faces = swapped ? [passerby, player] : [player, passerby];
      const index = s.update(i * DT, faces);
      frames++;
      if (index !== (swapped ? 1 : 0)) stolen++;
    }
    expect(frames).toBe(80);
    expect(stolen).toBe(0);
    expect(s.state).toBe('locked');
  });

  it('when the player is hidden, a bystander is ignored until the lock is released', () => {
    const s = new PrimarySelector({ releaseAfterMs: 2000 });
    for (let i = 0; i < 10; i++) s.update(i * DT, [face(0.5)]);
    const lostAt = 10 * DT;
    // The player walks away; someone else stands at the right-hand side.
    let t = lostAt;
    while (t < lostAt + 1900) {
      expect(s.update(t, [face(0.78, 0.45, 0.16)])).toBe(-1);
      expect(s.state).toBe('missing');
      expect(s.missingMs(t)).toBeGreaterThanOrEqual(0);
      t += DT;
    }
    // After the release time the bystander (inside the zone, stable) becomes the new primary.
    let index = -1;
    for (let i = 0; i < 20; i++) {
      index = s.update(t, [face(0.78, 0.45, 0.16)]);
      t += DT;
    }
    expect(index).toBe(0);
    expect(s.state).toBe('locked');
  });

  it('a neighbour who was already in view is never adopted while the lock is held', () => {
    const s = new PrimarySelector({ releaseAfterMs: 2500 });
    // Two people side by side; the one in the centre becomes the player.
    const neighbour = () => face(0.72, 0.46, 0.15);
    let index = -1;
    for (let i = 0; i < 12; i++) index = s.update(i * DT, [neighbour(), face(0.5)]);
    expect(index).toBe(1);
    // The player ducks away; the neighbour stays (and even leans towards the player's spot).
    let t = 12 * DT;
    let lean = 0.72;
    while (t < 12 * DT + 2400) {
      lean = Math.max(0.52, lean - 0.004);
      expect(s.update(t, [face(lean, 0.46, 0.15)])).toBe(-1);
      t += DT;
    }
    expect(s.state).toBe('missing');
  });

  it('a passer-by who hides the player for a moment does not take over', () => {
    const s = new PrimarySelector();
    for (let i = 0; i < 10; i++) s.update(i * DT, [face(0.5)]);
    let wrong = 0;
    for (let i = 10; i < 90; i++) {
      const progress = (i - 10) / 80;
      const passerbyU = -0.1 + progress * 1.2;
      const hidden = Math.abs(passerbyU - 0.5) < 0.09; // the player's face is covered
      const faces = hidden ? [face(passerbyU, 0.5, 0.24)] : [face(passerbyU, 0.5, 0.24), face(0.5)];
      const index = s.update(i * DT, faces);
      if (hidden ? index !== -1 : index !== 1) wrong++;
    }
    expect(wrong).toBe(0);
    expect(s.state).toBe('locked');
  });

  it('re-associates the same player after a short occlusion', () => {
    const s = new PrimarySelector();
    for (let i = 0; i < 10; i++) s.update(i * DT, [face(0.5)]);
    let t = 10 * DT;
    for (let i = 0; i < 9; i++) {
      expect(s.update(t, [])).toBe(-1);
      t += DT;
    }
    expect(s.state).toBe('missing');
    // Back half a second later, a little to the side: still the same lock, immediately.
    expect(s.update(t, [face(0.56)])).toBe(0);
    expect(s.state).toBe('locked');
  });

  it('rejects implausible size changes (a different face at the same place)', () => {
    const s = new PrimarySelector();
    for (let i = 0; i < 10; i++) s.update(i * DT, [face(0.5, 0.45, 0.14)]);
    expect(s.update(10 * DT, [face(0.5, 0.45, 0.4)])).toBe(-1);
    expect(s.update(11 * DT, [face(0.5, 0.45, 0.14)])).toBe(0);
  });

  it('reset() forgets the lock', () => {
    const s = new PrimarySelector();
    for (let i = 0; i < 10; i++) s.update(i * DT, [face(0.5)]);
    s.reset();
    expect(s.state).toBe('searching');
    expect(s.update(11 * DT, [face(0.5)])).toBe(-1);
  });
});
