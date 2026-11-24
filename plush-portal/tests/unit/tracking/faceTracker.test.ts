import { afterEach, describe, expect, it } from 'vitest';
import type { TrackerState } from '../../../src/core/contracts';
import type { Vec3 } from '../../../src/core/types';
import { defaultSettings } from '../../../src/settings/spec';
import { mountMatrix, screenToCamera } from '../../../src/tracking/cameraTransform';
import type { CameraHandle, CameraOpenResult, CameraRequest } from '../../../src/tracking/cameraSource';
import { effectiveFocalRef } from '../../../src/tracking/eyeEstimator';
import { createFaceTracker, type CalibrationEvent, type FaceTracker, type TrackerConfig } from '../../../src/tracking/FaceTracker';
import { uprightFrame } from '../../../src/tracking/frameGeometry';
import type { BackendFactory, BackendKind, FrameSource, InferenceBackend } from '../../../src/tracking/inference/backends';
import type { InferenceResult } from '../../../src/tracking/inference/protocol';
import { packFaces, synthFace } from './syntheticFace';

/* ------------------------------------------------------------------ fakes */

class FakeCamera implements CameraHandle {
  readonly label = 'Fake camera';
  readonly width = 640;
  readonly height = 480;
  readonly video = null;
  closed = false;
  private readonly callbacks = new Set<() => void>();
  private ended: ((detail: string) => void) | null = null;
  constructor(readonly deviceId: string) {}
  onFrame(callback: () => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }
  onEnded(callback: (detail: string) => void): void {
    this.ended = callback;
  }
  close(): void {
    this.closed = true;
    this.callbacks.clear();
  }
  emitFrame(): void {
    for (const callback of [...this.callbacks]) callback();
  }
  unplug(): void {
    this.closed = true;
    this.ended?.('unplugged');
  }
  get listening(): number {
    return this.callbacks.size;
  }
}

interface Rig {
  tracker: FaceTracker;
  config: TrackerConfig;
  clock: { now: number };
  cameras: FakeCamera[];
  requests: CameraRequest[];
  /** Resolves the pending camera request. */
  answerCamera: (result?: CameraOpenResult) => void;
  backends: { kind: BackendKind; disposed: boolean; calls: number }[];
  /** Faces returned by the fake detector for a capture time (true screen-space eye positions). */
  scene: (t: number) => Vec3[];
  setScene: (scene: (t: number) => Vec3[]) => void;
  /** Advances the clock, delivers camera frames at 30 fps and renders at 60 fps. */
  run: (ms: number) => Promise<{ eye: Vec3; source: string }>;
  states: TrackerState[];
  calibrations: CalibrationEvent[];
  hangInference: boolean;
  /** Backend kinds whose inferences currently throw. */
  failKinds: Set<BackendKind>;
  trueHfov: number;
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function createRig(options: { backendBehaviour?: Partial<Record<BackendKind, 'ok' | 'fail'>>; autoAnswer?: boolean; trueHfov?: number } = {}): Rig {
  const settings = defaultSettings();
  const config: TrackerConfig = {
    camera: { ...settings.camera, delegate: 'auto' },
    view: { ...settings.profiles.desktop.view },
    window: { widthM: 0.531, heightM: 0.299, centerOffsetM: [0, 0] },
  };
  const clock = { now: 1000 };
  const cameras: FakeCamera[] = [];
  const requests: CameraRequest[] = [];
  const pending: ((result: CameraOpenResult) => void)[] = [];
  const backends: Rig['backends'] = [];
  const frame = uprightFrame(640, 480, 0, false);
  const rig = {} as Rig;
  rig.trueHfov = options.trueHfov ?? 63;
  rig.scene = () => [];
  rig.setScene = (scene) => {
    rig.scene = scene;
  };
  rig.hangInference = false;
  rig.failKinds = new Set();

  const behaviour = options.backendBehaviour ?? { 'worker-gpu': 'ok', 'worker-cpu': 'ok', 'main-cpu': 'ok' };
  const backendFactory: BackendFactory = async (kind) => {
    if ((behaviour[kind] ?? 'fail') === 'fail') throw new Error(`${kind} unavailable`);
    const record = { kind, disposed: false, calls: 0 };
    backends.push(record);
    const backend: InferenceBackend = {
      kind,
      info: { delegate: kind.endsWith('gpu') ? 'GPU' : 'CPU', glRenderer: 'Fake GPU', softwareGl: false, initMs: 1, probeMs: 1 },
      infer(_source: FrameSource, captureMs: number): Promise<InferenceResult> {
        record.calls++;
        if (rig.hangInference) return new Promise(() => undefined);
        if (rig.failKinds.has(kind)) return Promise.reject(new Error('GL context lost'));
        const view = rig.config.view;
        const matrix = mountMatrix({ pos: view.camPos, pitchDeg: view.camPitch, yawDeg: view.camYaw, rollDeg: view.camRoll });
        const focal = effectiveFocalRef(rig.trueHfov, 0);
        const faces = rig.scene(captureMs).map((eye) => synthFace({ eye: screenToCamera(eye, matrix, view.camPos), frame, focal }));
        return Promise.resolve({ captureMs, inferMs: 5, faceCount: faces.length, faces: packFaces(faces), frameWidth: 640, frameHeight: 480 });
      },
      dispose() {
        record.disposed = true;
      },
    };
    return backend;
  };

  const tracker = createFaceTracker({
    now: () => clock.now,
    openCamera: (request) => {
      requests.push(request);
      return new Promise<CameraOpenResult>((resolve) => {
        pending.push(resolve);
        if (options.autoAnswer !== false) rig.answerCamera();
      });
    },
    backendFactory,
    listCameras: async () => [{ id: 'fake', label: 'Fake camera' }],
    assetBase: 'http://localhost/mediapipe/',
  });
  rig.answerCamera = (result) => {
    const resolve = pending.shift();
    if (!resolve) return;
    if (result) {
      resolve(result);
      return;
    }
    const camera = new FakeCamera(requests[requests.length - 1]!.deviceId || 'default');
    cameras.push(camera);
    resolve({ ok: true, camera });
  };
  rig.tracker = tracker;
  rig.config = config;
  rig.clock = clock;
  rig.cameras = cameras;
  rig.requests = requests;
  rig.backends = backends;
  rig.states = [];
  rig.calibrations = [];
  tracker.subscribe((status) => {
    if (rig.states[rig.states.length - 1] !== status.state) rig.states.push(status.state);
  });
  tracker.onCalibration((event) => rig.calibrations.push(event));
  tracker.configure(config);

  rig.run = async (ms) => {
    const eye: Vec3 = [0, 0, 0];
    let source = '';
    const end = clock.now + ms;
    let nextFrame = clock.now;
    while (clock.now < end) {
      clock.now += 1000 / 60;
      if (clock.now >= nextFrame) {
        nextFrame += 1000 / 30;
        for (const camera of cameras) if (!camera.closed) camera.emitFrame();
        await flush();
      }
      source = tracker.sampleEye(clock.now, eye);
    }
    return { eye, source };
  };
  return rig;
}

const rigs: Rig[] = [];
const rigFor = (options?: Parameters<typeof createRig>[0]) => {
  const rig = createRig(options);
  rigs.push(rig);
  return rig;
};
afterEach(() => {
  for (const rig of rigs.splice(0)) rig.tracker.dispose();
});

/* ------------------------------------------------------------------ tests */

describe('FaceTracker', () => {
  it('is idle until started and always returns the neutral viewpoint', () => {
    const rig = rigFor();
    expect(rig.tracker.status().state).toBe('idle');
    const eye: Vec3 = [9, 9, 9];
    expect(rig.tracker.sampleEye(0, eye)).toBe('neutral');
    expect(eye).toEqual(rig.config.view.eye);
    expect(rig.requests).toHaveLength(0); // the camera is not touched before start()
  });

  it('does nothing when head tracking is switched off', async () => {
    const rig = rigFor();
    rig.tracker.configure({ ...rig.config, camera: { ...rig.config.camera, enabled: false } });
    expect(rig.tracker.status().state).toBe('off');
    await rig.tracker.start();
    expect(rig.requests).toHaveLength(0);
    expect(rig.tracker.status().state).toBe('off');
    // Switching it back on makes it startable again.
    rig.tracker.configure(rig.config);
    expect(rig.tracker.status().state).toBe('idle');
  });

  it('reports a denied permission and keeps the game on the fixed viewpoint', async () => {
    const rig = rigFor({ autoAnswer: false });
    const started = rig.tracker.start();
    expect(rig.tracker.status().state).toBe('requesting');
    rig.answerCamera({ ok: false, state: 'denied', detail: 'NotAllowedError: Permission denied' });
    await started;
    await flush();
    expect(rig.tracker.status().state).toBe('denied');
    expect(rig.tracker.status().detail).toContain('NotAllowedError');
    const { eye, source } = await rig.run(500);
    expect(source).toBe('neutral');
    expect(eye).toEqual(rig.config.view.eye);
    // Any backend that was being prepared meanwhile is released.
    expect(rig.backends.every((b) => b.disposed)).toBe(true);
  });

  it('an unanswered permission prompt never blocks: stop() cancels and a late grant is released at once', async () => {
    const rig = rigFor({ autoAnswer: false });
    let settled = false;
    void rig.tracker.start().then(() => {
      settled = true;
    });
    await rig.run(2000);
    expect(settled).toBe(false);
    expect(rig.tracker.status().state).toBe('requesting');
    expect((await rig.run(100)).source).toBe('neutral');
    rig.tracker.stop();
    expect(rig.tracker.status().state).toBe('idle');
    // The user finally clicks "Allow" long after tracking was switched off.
    rig.answerCamera();
    await flush();
    expect(rig.cameras).toHaveLength(1);
    expect(rig.cameras[0]!.closed).toBe(true);
    expect(rig.tracker.status().state).toBe('idle');
  });

  it('tracks the player: status, backend and viewpoint follow the real eye position', async () => {
    const rig = rigFor();
    const truth: Vec3 = [0.08, 0.2, 0.7];
    rig.setScene(() => [truth]);
    await rig.tracker.start();
    await flush();
    expect(rig.tracker.status().backend).toBe('worker-gpu');
    expect(rig.tracker.status().cameraLabel).toBe('Fake camera');
    expect(rig.tracker.status().videoWidth).toBe(640);
    const { eye, source } = await rig.run(2500);
    expect(rig.states).toEqual(['requesting', 'loading', 'searching', 'tracking']);
    expect(source).toBe('tracking');
    for (let i = 0; i < 3; i++) expect(Math.abs(eye[i]! - truth[i]!)).toBeLessThan(0.005);
    const status = rig.tracker.status();
    expect(status.facesSeen).toBe(1);
    expect(status.viewSource).toBe('tracking');
    expect(status.inferenceFps).toBeGreaterThan(12);
    expect(status.inferenceFps).toBeLessThanOrEqual(19);
    const diag = rig.tracker.diagnostics();
    expect(diag.primary).toBe('locked');
    expect(diag.measurement!.window[0]).toBeCloseTo(truth[0], 2);
  });

  it('follows the player sideways with the correct sign and without jumps', async () => {
    const rig = rigFor();
    const start = rig.clock.now;
    rig.setScene((t) => [[Math.max(-0.15, Math.min(0.15, -0.15 + ((t - start - 2000) / 2000) * 0.3)), 0.15, 0.65]]);
    await rig.tracker.start();
    const a = await rig.run(1900);
    expect(a.eye[0]).toBeLessThan(-0.13);
    let previous = a.eye[0];
    let worstStep = 0;
    for (let i = 0; i < 150; i++) {
      const frame = await rig.run(1000 / 60);
      worstStep = Math.max(worstStep, Math.abs(frame.eye[0] - previous));
      previous = frame.eye[0];
    }
    expect(previous).toBeGreaterThan(0.13);
    expect(worstStep).toBeLessThan(0.012);
  });

  it('runs one inference at a time and respects the inference rate', async () => {
    const rig = rigFor();
    rig.setScene(() => [[0, 0.14, 0.62]]);
    await rig.tracker.start();
    await rig.run(2000);
    const calls = rig.backends[0]!.calls;
    // 18 Hz cap from 30 fps camera frames over 2 s.
    expect(calls).toBeGreaterThan(28);
    expect(calls).toBeLessThanOrEqual(38);
    // A slow inference: no further frames are sent while one is in flight.
    rig.hangInference = true;
    await rig.run(1000);
    const afterHang = rig.backends[0]!.calls;
    expect(afterHang - calls).toBe(1);
  });

  it('pauses inference while the tab is hidden', async () => {
    const rig = rigFor();
    rig.setScene(() => [[0, 0.14, 0.62]]);
    await rig.tracker.start();
    await rig.run(500);
    rig.tracker.setPaused(true);
    const before = rig.backends[0]!.calls;
    await rig.run(1000);
    expect(rig.backends[0]!.calls).toBe(before);
    expect(rig.cameras[0]!.closed).toBe(false); // the camera itself stays open
    rig.tracker.setPaused(false);
    await rig.run(500);
    expect(rig.backends[0]!.calls).toBeGreaterThan(before);
  });

  it('holds, returns to neutral and re-acquires smoothly when the player disappears', async () => {
    const rig = rigFor();
    const truth: Vec3 = [0.12, 0.2, 0.7];
    let visible = true;
    rig.setScene(() => (visible ? [truth] : []));
    await rig.tracker.start();
    await rig.run(1500);
    visible = false;
    const held = await rig.run(400);
    expect(held.source).toBe('hold');
    expect(rig.tracker.status().state).toBe('lost');
    expect(Math.abs(held.eye[0] - truth[0])).toBeLessThan(0.01);
    const returning = await rig.run(900);
    expect(returning.source).toBe('returning');
    const neutral = await rig.run(2500);
    expect(neutral.source).toBe('neutral');
    expect(neutral.eye).toEqual(rig.config.view.eye);
    // The lock is released eventually and the search starts again.
    expect(rig.tracker.status().state).toBe('searching');
    visible = true;
    let previous = neutral.eye[0];
    let worstStep = 0;
    for (let i = 0; i < 120; i++) {
      const frame = await rig.run(1000 / 60);
      worstStep = Math.max(worstStep, Math.abs(frame.eye[0] - previous));
      previous = frame.eye[0];
    }
    expect(Math.abs(previous - truth[0])).toBeLessThan(0.01);
    expect(worstStep).toBeLessThan(0.02);
  });

  it('a second, closer person walking past does not move the viewpoint', async () => {
    const rig = rigFor();
    const player: Vec3 = [0, 0.14, 0.75];
    const start = rig.clock.now;
    rig.setScene((t) => {
      const elapsed = t - start;
      if (elapsed < 2000 || elapsed > 6000) return [player];
      const x = -0.5 + ((elapsed - 2000) / 4000) * 1.0;
      // In front of the player (closer to the camera), slightly lower.
      return [[x, 0.1, 0.5], player];
    });
    await rig.tracker.start();
    await rig.run(1900);
    let worst = 0;
    for (let i = 0; i < 280; i++) {
      const frame = await rig.run(1000 / 60);
      worst = Math.max(worst, Math.abs(frame.eye[0] - player[0]), Math.abs(frame.eye[2] - player[2]));
    }
    expect(worst).toBeLessThan(0.01);
    expect(rig.tracker.status().state).toBe('tracking');
  });

  it('stop() releases the camera and the backend; restart works', async () => {
    const rig = rigFor();
    rig.setScene(() => [[0, 0.14, 0.62]]);
    await rig.tracker.start();
    await rig.run(800);
    expect(rig.tracker.status().state).toBe('tracking');
    rig.tracker.stop();
    expect(rig.cameras[0]!.closed).toBe(true);
    expect(rig.cameras[0]!.listening).toBe(0);
    expect(rig.backends[0]!.disposed).toBe(true);
    const status = rig.tracker.status();
    expect(status.state).toBe('idle');
    expect(status.backend).toBeNull();
    expect(status.cameraLabel).toBeNull();
    expect(status.videoWidth).toBe(0);
    const back = await rig.run(2500);
    expect(back.source).toBe('neutral');
    // Restart: a fresh camera and backend.
    await rig.tracker.start();
    await rig.run(1500);
    expect(rig.cameras).toHaveLength(2);
    expect(rig.cameras[1]!.closed).toBe(false);
    expect(rig.backends).toHaveLength(2);
    expect(rig.tracker.status().state).toBe('tracking');
  });

  it('falls back to the next backend at start-up and reports model_error when none works', async () => {
    const rig = rigFor({ backendBehaviour: { 'worker-gpu': 'fail', 'worker-cpu': 'fail', 'main-cpu': 'ok' } });
    await rig.tracker.start();
    await flush();
    expect(rig.tracker.status().backend).toBe('main-cpu');
    expect(rig.tracker.diagnostics().attempts.map((a) => `${a.kind}:${a.ok}`)).toEqual(['worker-gpu:false', 'worker-cpu:false', 'main-cpu:true']);

    const broken = rigFor({ backendBehaviour: {} });
    await broken.tracker.start();
    await flush();
    expect(broken.tracker.status().state).toBe('model_error');
    expect(broken.tracker.status().detail).toContain('worker-gpu');
    expect(broken.cameras[0]!.closed).toBe(true); // no point keeping the camera on
    expect((await broken.run(200)).source).toBe('neutral');
  });

  it('replaces a backend that keeps failing while running', async () => {
    const rig = rigFor();
    rig.setScene(() => [[0, 0.14, 0.62]]);
    await rig.tracker.start();
    await rig.run(600);
    expect(rig.tracker.status().backend).toBe('worker-gpu');
    rig.failKinds.add('worker-gpu');
    await rig.run(1900);
    expect(rig.backends[0]!.disposed).toBe(true);
    expect(rig.tracker.status().backend).toBe('worker-cpu');
    expect(rig.tracker.status().state).toBe('tracking');
    expect(rig.tracker.diagnostics().lastError).toContain('GL context lost');
  });

  it('reports a camera that disappears while running', async () => {
    const rig = rigFor();
    rig.setScene(() => [[0, 0.14, 0.62]]);
    await rig.tracker.start();
    await rig.run(600);
    rig.cameras[0]!.unplug();
    expect(rig.tracker.status().state).toBe('no_device');
    expect(rig.backends[0]!.disposed).toBe(true);
    expect((await rig.run(3000)).source).toBe('neutral');
  });

  it('quick calibration fixes the depth scale and makes the current pose neutral', async () => {
    // The real camera is wider (80°) than the configured 63°: uncalibrated depth is wrong.
    const rig = rigFor({ trueHfov: 80 });
    const stand: Vec3 = [0.06, 0.1, 0.62];
    rig.config.view = { ...rig.config.view, refDistance: 0.62 };
    rig.tracker.configure(rig.config);
    rig.setScene(() => [stand]);
    await rig.tracker.start();
    const before = await rig.run(1500);
    expect(Math.abs(before.eye[2] - stand[2])).toBeGreaterThan(0.1);
    expect(rig.tracker.status().calibrated).toBe(false);

    const pending = rig.tracker.calibrate();
    await rig.run(1500);
    const outcome = await pending;
    expect(outcome.ok).toBe(true);
    expect(outcome.samples).toBeGreaterThanOrEqual(8);
    expect(outcome.hfovDeg).toBeGreaterThan(78);
    expect(outcome.hfovDeg).toBeLessThan(82);
    expect(rig.calibrations).toHaveLength(1);
    expect(rig.calibrations[0]!.kind).toBe('calibrate');
    expect(rig.calibrations[0]!.values).toEqual(outcome.values);
    expect(outcome.values!.calNeutral[2]).toBeCloseTo(0.62, 3);
    expect(rig.tracker.status().calibrated).toBe(true);

    // The calibrated pose now maps onto the reference eye (relative mode) …
    const after = await rig.run(1500);
    for (let i = 0; i < 3; i++) expect(Math.abs(after.eye[i]! - rig.config.view.eye[i]!)).toBeLessThan(0.004);
    // … and physical movement is reproduced 1:1 around it.
    rig.setScene(() => [[stand[0] + 0.1, stand[1], stand[2] + 0.15]]);
    const moved = await rig.run(2000);
    expect(moved.eye[0] - rig.config.view.eye[0]).toBeCloseTo(0.1, 2);
    expect(moved.eye[2] - rig.config.view.eye[2]).toBeCloseTo(0.15, 2);

    // The application persists the values and passes them back: nothing changes.
    const values = outcome.values!;
    rig.config.view = { ...rig.config.view, calDepthK: values.calDepthK, calNeutral: values.calNeutral, calibrated: true };
    rig.tracker.configure(rig.config);
    const persisted = await rig.run(800);
    expect(persisted.eye[0]).toBeCloseTo(moved.eye[0], 2);
  });

  it('calibrate() fails cleanly when not running or nobody is visible', async () => {
    const rig = rigFor();
    expect(await rig.tracker.calibrate()).toEqual({ ok: false, detail: 'not_running', samples: 0 });
    await rig.tracker.start();
    await rig.run(200);
    const pending = rig.tracker.calibrate();
    // Stopping mid-calibration resolves the promise.
    rig.tracker.stop();
    expect((await pending).detail).toBe('stopped');
  });

  it('recenter() makes the current position neutral without touching the depth scale', async () => {
    const rig = rigFor();
    rig.setScene(() => [[0.15, 0.25, 0.8]]);
    await rig.tracker.start();
    await rig.run(1500);
    rig.tracker.recenter();
    expect(rig.calibrations).toHaveLength(1);
    expect(rig.calibrations[0]!.kind).toBe('recenter');
    expect(rig.calibrations[0]!.values.calDepthK).toBe(rig.config.view.calDepthK);
    expect(rig.calibrations[0]!.values.calNeutral[0]).toBeCloseTo(0.15, 2);
    const after = await rig.run(1500);
    for (let i = 0; i < 3; i++) expect(Math.abs(after.eye[i]! - rig.config.view.eye[i]!)).toBeLessThan(0.004);
  });

  it('reopens the camera when the device changes and reloads the backend when the delegate changes', async () => {
    const rig = rigFor();
    rig.setScene(() => [[0, 0.14, 0.62]]);
    await rig.tracker.start();
    await rig.run(600);
    rig.config.camera = { ...rig.config.camera, deviceId: 'other-camera' };
    rig.tracker.configure(rig.config);
    await flush();
    await rig.run(1200);
    expect(rig.cameras).toHaveLength(2);
    expect(rig.cameras[0]!.closed).toBe(true);
    expect(rig.requests[1]!.deviceId).toBe('other-camera');
    expect(rig.tracker.status().state).toBe('tracking');

    const backendsBefore = rig.backends.length;
    rig.config.camera = { ...rig.config.camera, delegate: 'cpu' };
    rig.tracker.configure(rig.config);
    await flush();
    await rig.run(1200);
    expect(rig.backends.length).toBe(backendsBefore + 1);
    expect(rig.backends[backendsBefore - 1]!.disposed).toBe(true);
    expect(rig.tracker.status().backend).toBe('worker-cpu');
    expect(rig.cameras).toHaveLength(2); // the camera stayed open
    expect(rig.tracker.status().state).toBe('tracking');
  });

  it('switching tracking off stops everything', async () => {
    const rig = rigFor();
    rig.setScene(() => [[0, 0.14, 0.62]]);
    await rig.tracker.start();
    await rig.run(600);
    rig.tracker.configure({ ...rig.config, camera: { ...rig.config.camera, enabled: false } });
    expect(rig.tracker.status().state).toBe('off');
    expect(rig.cameras[0]!.closed).toBe(true);
    expect(rig.backends[0]!.disposed).toBe(true);
  });

  it('settings changes that move the viewpoint are blended in', async () => {
    const rig = rigFor();
    rig.setScene(() => [[0.1, 0.14, 0.62]]);
    await rig.tracker.start();
    const before = await rig.run(1500);
    rig.config.view = { ...rig.config.view, gainX: 2 };
    rig.tracker.configure(rig.config);
    const first = await rig.run(1000 / 30);
    expect(Math.abs(first.eye[0] - before.eye[0])).toBeLessThan(0.03);
    const settled = await rig.run(1500);
    expect(settled.eye[0]).toBeCloseTo(0.2, 2);
  });

  it('the manual test viewpoint is labelled "test" and limited like real movement', async () => {
    const rig = rigFor();
    rig.tracker.setTestViewpoint([0.1, 0, 0]);
    const shown = await rig.run(1200);
    expect(shown.source).toBe('test');
    expect(rig.tracker.status().viewSource).toBe('test');
    expect(shown.eye[0]).toBeCloseTo(rig.config.view.eye[0] + 0.1, 3);
    rig.tracker.setTestViewpoint([50, 0, 0]);
    const clamped = await rig.run(1200);
    expect(clamped.eye[0]).toBeLessThanOrEqual(rig.config.view.eye[0] + rig.config.view.maxOffset[0]);
    rig.tracker.setTestViewpoint(null);
    const back = await rig.run(2500);
    expect(back.source).toBe('neutral');
  });

  it('lists cameras and survives dispose', async () => {
    const rig = rigFor();
    expect(await rig.tracker.listCameras()).toEqual([{ id: 'fake', label: 'Fake camera' }]);
    await rig.tracker.start();
    rig.tracker.dispose();
    expect(rig.cameras[0]!.closed).toBe(true);
    await rig.tracker.start(); // no-op after dispose
    expect(rig.cameras).toHaveLength(1);
    const eye: Vec3 = [0, 0, 0];
    expect(typeof rig.tracker.sampleEye(rig.clock.now, eye)).toBe('string');
  });
});
