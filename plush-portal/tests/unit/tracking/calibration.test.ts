import { describe, expect, it } from 'vitest';
import { makeRng } from '../../../src/core/math';
import type { Vec3 } from '../../../src/core/types';
import { CalibrationCollector, hfovFromFocal, solveCalibration } from '../../../src/tracking/calibration';
import { cameraToScreen, mountMatrix, screenToCamera } from '../../../src/tracking/cameraTransform';
import { effectiveFocalRef, measureFace } from '../../../src/tracking/eyeEstimator';
import { uprightFrame } from '../../../src/tracking/frameGeometry';
import { REFERENCE_IPD_M } from '../../../src/tracking/landmarks';
import { focalForHfov, synthFace } from './syntheticFace';

const frame = uprightFrame(640, 480, 0, false);
const noWindowOffset = { widthM: 1.071, heightM: 1.904, centerOffsetM: [0, 0] as [number, number] };

describe('CalibrationCollector', () => {
  const focal = focalForHfov(63);
  const feed = (collector: CalibrationCollector, t: number, eye: Vec3, rng?: () => number) => {
    const packed = synthFace({ eye, frame, focal, noisePx: rng ? 0.3 : 0, rng });
    const m = measureFace(packed, 0, frame, focal)!;
    collector.push(t, m, packed);
    collector.tick(t);
  };

  it('finishes after about one second of stable samples and averages them', () => {
    const rng = makeRng(4);
    const collector = new CalibrationCollector();
    collector.start(0);
    let t = 0;
    while (collector.state === 'collecting' && t < 6000) {
      feed(collector, t, [0.05, -0.1, 0.9], rng);
      t += 55;
    }
    expect(collector.state).toBe('done');
    expect(t).toBeGreaterThan(800);
    expect(t).toBeLessThan(1400);
    const result = collector.result!;
    expect(result.samples).toBeGreaterThanOrEqual(8);
    const m = measureFace(result.face, 0, frame, focal)!;
    expect(m.camZ).toBeCloseTo(0.9, 2);
    expect(m.camX).toBeCloseTo(0.05, 2);
  });

  it('waits until the player stands still', () => {
    const collector = new CalibrationCollector();
    collector.start(0);
    let t = 0;
    // Walking sideways for 2 s, then standing still.
    while (collector.state === 'collecting' && t < 6000) {
      const x = t < 2000 ? -0.3 + (0.6 * t) / 2000 : 0.3;
      feed(collector, t, [x, 0, 0.9]);
      t += 55;
    }
    expect(collector.state).toBe('done');
    expect(t).toBeGreaterThan(2800);
    const m = measureFace(collector.result!.face, 0, frame, focal)!;
    expect(m.camX).toBeCloseTo(0.3, 2);
  });

  it('fails with "unstable" when the player never holds still', () => {
    const collector = new CalibrationCollector({ timeoutMs: 3000 });
    collector.start(0);
    for (let t = 0; t <= 3100; t += 55) feed(collector, t, [0.3 * Math.sin(t / 200), 0, 0.9]);
    expect(collector.state).toBe('failed');
    expect(collector.failure).toBe('unstable');
  });

  it('fails with "no_face" when nobody is there', () => {
    const collector = new CalibrationCollector({ timeoutMs: 2000 });
    collector.start(1000);
    collector.tick(2500);
    expect(collector.state).toBe('collecting');
    collector.tick(3001);
    expect(collector.state).toBe('failed');
    expect(collector.failure).toBe('no_face');
  });

  it('can be cancelled and restarted', () => {
    const collector = new CalibrationCollector();
    collector.start(0);
    collector.cancel();
    expect(collector.state).toBe('idle');
    collector.start(100);
    expect(collector.state).toBe('collecting');
  });
});

describe('solveCalibration', () => {
  it('recovers the true focal length of an unknown camera from one known distance', () => {
    // The settings assume 63°, the real camera has 78°.
    const trueFocal = focalForHfov(78);
    const assumed = effectiveFocalRef(63, 0);
    const mount = { pos: [0, 0.37, 0] as Vec3, pitchDeg: 8, yawDeg: 0, rollDeg: 0 };
    const matrix = mountMatrix(mount);
    const truth: Vec3 = [0.04, 0.2, 0.62];
    const packed = synthFace({ eye: screenToCamera(truth, matrix, mount.pos), frame, focal: trueFocal });

    // Before calibration the depth is wrong by roughly the focal ratio.
    const before = measureFace(packed, 0, frame, assumed)!;
    const beforeScreen = cameraToScreen([before.camX, before.camY, before.camZ], matrix, mount.pos);
    expect(Math.abs(beforeScreen[2] - truth[2])).toBeGreaterThan(0.1);

    const solved = solveCalibration({
      face: packed,
      frame,
      matrix,
      cameraPos: mount.pos,
      refDistanceM: truth[2],
      window: noWindowOffset,
      focalGuess: assumed,
    });
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(Math.abs(solved.focalRef - trueFocal) / trueFocal).toBeLessThan(0.002);
    expect(solved.hfovDeg).toBeCloseTo(78, 0);
    expect(solved.values.calDepthK).toBeCloseTo(solved.focalRef * REFERENCE_IPD_M, 9);
    // The neutral pose is the true eye position.
    for (let i = 0; i < 3; i++) expect(solved.values.calNeutral[i]).toBeCloseTo(truth[i]!, 2);
    expect(solved.values.calNeutral[2]).toBeCloseTo(truth[2], 5);
  });

  it('after calibration other positions are measured correctly as well', () => {
    const trueFocal = focalForHfov(88);
    const mount = { pos: [0, 0.98, 0] as Vec3, pitchDeg: 18, yawDeg: 2, rollDeg: -1 };
    const matrix = mountMatrix(mount);
    const stand: Vec3 = [0, 0.5, 0.95];
    const solved = solveCalibration({
      face: synthFace({ eye: screenToCamera(stand, matrix, mount.pos), frame, focal: trueFocal }),
      frame,
      matrix,
      cameraPos: mount.pos,
      refDistanceM: stand[2],
      window: noWindowOffset,
      focalGuess: effectiveFocalRef(63, 0),
    });
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    const focal = effectiveFocalRef(63, solved.values.calDepthK);
    for (const truth of [[0.3, 0.45, 0.8], [-0.35, 0.6, 1.3], [0.1, 0.3, 0.6]] as Vec3[]) {
      const m = measureFace(synthFace({ eye: screenToCamera(truth, matrix, mount.pos), frame, focal: trueFocal }), 0, frame, focal)!;
      const got = cameraToScreen([m.camX, m.camY, m.camZ], matrix, mount.pos);
      for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - truth[i]!)).toBeLessThan(0.004);
    }
  });

  it('absorbs a face that is bigger or smaller than the canonical model', () => {
    const trueFocal = focalForHfov(63);
    const matrix = mountMatrix({ pos: [0, 0.16, 0], pitchDeg: 4, yawDeg: 0, rollDeg: 0 });
    const cameraPos: Vec3 = [0, 0.16, 0];
    const stand: Vec3 = [0, 0.14, 0.62];
    const big: Vec3 = [1.07, 1.07, 1.07];
    const solved = solveCalibration({
      face: synthFace({ eye: screenToCamera(stand, matrix, cameraPos), frame, focal: trueFocal, shape: big }),
      frame,
      matrix,
      cameraPos,
      refDistanceM: stand[2],
      window: noWindowOffset,
      focalGuess: trueFocal,
    });
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    // The constant absorbs the 7 % bigger face …
    expect(solved.focalRef / trueFocal).toBeGreaterThan(1.05);
    // … so depth is right at other distances too.
    const focal = effectiveFocalRef(63, solved.values.calDepthK);
    for (const z of [0.45, 0.9]) {
      const truth: Vec3 = [0, 0.14, z];
      const m = measureFace(synthFace({ eye: screenToCamera(truth, matrix, cameraPos), frame, focal: trueFocal, shape: big }), 0, frame, focal)!;
      const got = cameraToScreen([m.camX, m.camY, m.camZ], matrix, cameraPos);
      expect(Math.abs(got[2] - z)).toBeLessThan(0.01);
    }
  });

  it('stores the neutral pose relative to the window centre', () => {
    const focal = focalForHfov(63);
    const matrix = mountMatrix({ pos: [0, 0.16, 0], pitchDeg: 0, yawDeg: 0, rollDeg: 0 });
    const truth: Vec3 = [0.2, 0.1, 0.6];
    const solved = solveCalibration({
      face: synthFace({ eye: screenToCamera(truth, matrix, [0, 0.16, 0]), frame, focal }),
      frame,
      matrix,
      cameraPos: [0, 0.16, 0],
      refDistanceM: 0.6,
      window: { widthM: 0.3, heightM: 0.2, centerOffsetM: [0.08, -0.03] },
      focalGuess: focal,
    });
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(solved.values.calNeutral[0]).toBeCloseTo(0.12, 2);
    expect(solved.values.calNeutral[1]).toBeCloseTo(0.13, 2);
    expect(solved.values.calNeutral[2]).toBeCloseTo(0.6, 4);
  });

  it('refuses implausible results (wrong reference distance)', () => {
    const focal = focalForHfov(63);
    const matrix = mountMatrix({ pos: [0, 0, 0], pitchDeg: 0, yawDeg: 0, rollDeg: 0 });
    const packed = synthFace({ eye: [0, 0, 0.6], frame, focal });
    // Claiming the player stands 5 cm from the screen would need a 160°+ lens.
    const tooClose = solveCalibration({ face: packed, frame, matrix, cameraPos: [0, 0, 0], refDistanceM: 0.02, window: noWindowOffset, focalGuess: focal });
    expect(tooClose.ok).toBe(false);
    // Behind the camera plane is geometrically impossible.
    const behind = solveCalibration({ face: packed, frame, matrix, cameraPos: [0, 0, 0.5], refDistanceM: 0.3, window: noWindowOffset, focalGuess: focal });
    expect(behind.ok).toBe(false);
    // Garbage landmarks.
    const zeros = solveCalibration({ face: new Float32Array(packed.length), frame, matrix, cameraPos: [0, 0, 0], refDistanceM: 0.6, window: noWindowOffset, focalGuess: focal });
    expect(zeros.ok).toBe(false);
  });

  it('hfovFromFocal inverts focalForHfov', () => {
    for (const hfov of [50, 63, 78, 100]) expect(hfovFromFocal(focalForHfov(hfov))).toBeCloseTo(hfov, 9);
  });
});
