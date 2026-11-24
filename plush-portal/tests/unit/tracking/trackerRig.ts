/**
 * Test helper (not a test file): a FaceTracker wired to a fake camera and a fake detector that
 * renders synthetic faces (syntheticFace.ts) for people described in SCREEN terms: eye position
 * and where the head points (yaw + = to the player's right, pitch + = up, relative to looking at
 * the centre of the game window, or an absolute screen direction).
 */
import type { TrackerState } from '../../../src/core/contracts';
import type { Vec3 } from '../../../src/core/types';
import { defaultSettings } from '../../../src/settings/spec';
import { mountMatrix, screenToCamera } from '../../../src/tracking/cameraTransform';
import type { CameraHandle, CameraOpenResult, CameraRequest } from '../../../src/tracking/cameraSource';
import type { DeviceInfo } from '../../../src/tracking/devicePolicy';
import { effectiveFocalRef } from '../../../src/tracking/eyeEstimator';
import { createFaceTracker, type CalibrationEvent, type FaceTracker, type TrackerConfig } from '../../../src/tracking/FaceTracker';
import { uprightFrame } from '../../../src/tracking/frameGeometry';
import type { BackendFactory, BackendKind, BackendOptions, InferenceBackend } from '../../../src/tracking/inference/backends';
import type { InferenceResult } from '../../../src/tracking/inference/protocol';
import { packFaces, synthFace } from './syntheticFace';

const DEG = Math.PI / 180;

export interface Person {
  /** True eye midpoint, screen space (= window space here), metres. */
  eye: Vec3;
  /** Head turn relative to looking at the window centre, degrees (+ right / + up). */
  yawDeg?: number;
  pitchDeg?: number;
}

export class FakeCamera implements CameraHandle {
  readonly label = 'Fake camera';
  readonly width: number;
  readonly height: number;
  readonly video = null;
  closed = false;
  private readonly callbacks = new Set<() => void>();
  private ended: ((detail: string) => void) | null = null;
  constructor(readonly deviceId: string, size: [number, number]) {
    this.width = size[0];
    this.height = size[1];
  }
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
}

export interface Rig {
  tracker: FaceTracker;
  config: TrackerConfig;
  clock: { now: number };
  cameras: FakeCamera[];
  requests: CameraRequest[];
  backendOptions: BackendOptions[];
  inferCalls: number;
  answerCamera: (result?: CameraOpenResult) => void;
  /** People in view at a capture time. */
  scene: (t: number) => Person[];
  /** Frame size the fake detector reports (switch to portrait to simulate a phone rotation). */
  frameSize: [number, number];
  run: (ms: number) => Promise<{ eye: Vec3; source: string }>;
  states: TrackerState[];
  calibrations: CalibrationEvent[];
  /** Calls the injected screen-orientation listener. */
  rotateScreen: () => void;
  configure: (patch?: Partial<TrackerConfig>) => void;
}

export const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

/** Camera-space yaw / pitch (estimator convention) of a head pointing along screen direction `d`. */
function cameraAngles(d: Readonly<Vec3>, matrix: Float64Array): { yaw: number; pitch: number } {
  const x = matrix[0]! * d[0] + matrix[3]! * d[1] + matrix[6]! * d[2];
  const y = matrix[1]! * d[0] + matrix[4]! * d[1] + matrix[7]! * d[2];
  const z = matrix[2]! * d[0] + matrix[5]! * d[1] + matrix[8]! * d[2];
  const n = Math.hypot(x, y, z);
  return { yaw: Math.atan2(x / n, -z / n), pitch: Math.asin(-y / n) };
}

/** Screen direction of a head at `eye` that looks at the window centre, turned by yaw / pitch (radians). */
function gazeDirection(eye: Readonly<Vec3>, yaw: number, pitch: number): Vec3 {
  const z = Math.max(1e-3, eye[2]);
  const y0 = Math.atan2(-eye[0], z) + yaw;
  const p0 = Math.atan2(-eye[1], Math.hypot(eye[0], z)) + pitch;
  return [Math.sin(y0) * Math.cos(p0), Math.sin(p0), -Math.cos(y0) * Math.cos(p0)];
}

export function createRig(options: { autoAnswer?: boolean; device?: DeviceInfo; camera?: Partial<TrackerConfig['camera']>; view?: Partial<TrackerConfig['view']> } = {}): Rig {
  const settings = defaultSettings();
  const config: TrackerConfig = {
    camera: { ...settings.camera, delegate: 'auto', ...options.camera },
    view: { ...settings.profiles.desktop.view, ...options.view },
    window: { widthM: 0.531, heightM: 0.299, centerOffsetM: [0, 0] },
  };
  const clock = { now: 1000 };
  const pending: ((result: CameraOpenResult) => void)[] = [];
  const rig = {
    config,
    clock,
    cameras: [] as FakeCamera[],
    requests: [] as CameraRequest[],
    backendOptions: [] as BackendOptions[],
    inferCalls: 0,
    scene: () => [],
    frameSize: [640, 480],
    states: [] as TrackerState[],
    calibrations: [] as CalibrationEvent[],
  } as unknown as Rig;
  let orientationListener: (() => void) | null = null;

  const backendFactory: BackendFactory = async (kind: BackendKind, backendOptions: BackendOptions) => {
    rig.backendOptions.push(backendOptions);
    const backend: InferenceBackend = {
      kind,
      info: { delegate: 'CPU', glRenderer: 'Fake GPU', softwareGl: false, initMs: 1, probeMs: 1 },
      infer(_source, captureMs): Promise<InferenceResult> {
        rig.inferCalls++;
        const view = rig.config.view;
        const [w, h] = rig.frameSize;
        const frame = uprightFrame(w, h, 0, false);
        const matrix = mountMatrix({ pos: view.camPos, pitchDeg: view.camPitch, yawDeg: view.camYaw, rollDeg: view.camRoll });
        const focal = effectiveFocalRef(63, 0);
        const faces = rig.scene(captureMs).map((p) => {
          const angles = cameraAngles(gazeDirection(p.eye, (p.yawDeg ?? 0) * DEG, (p.pitchDeg ?? 0) * DEG), matrix);
          return synthFace({ eye: screenToCamera(p.eye, matrix, view.camPos), yaw: angles.yaw, pitch: angles.pitch, frame, focal });
        });
        return Promise.resolve({ captureMs, inferMs: 5, faceCount: faces.length, faces: packFaces(faces), frameWidth: w, frameHeight: h });
      },
      dispose() {},
    };
    return backend;
  };

  const tracker = createFaceTracker({
    now: () => clock.now,
    openCamera: (request) => {
      rig.requests.push(request);
      return new Promise<CameraOpenResult>((resolve) => {
        pending.push(resolve);
        if (options.autoAnswer !== false) rig.answerCamera();
      });
    },
    backendFactory,
    listCameras: async () => [],
    assetBase: 'http://localhost/mediapipe/',
    deviceInfo: () => options.device ?? { mobile: false, cores: 16, memoryGb: 16 },
    watchOrientation: (callback) => {
      orientationListener = callback;
      return () => {
        if (orientationListener === callback) orientationListener = null;
      };
    },
  });
  rig.answerCamera = (result) => {
    const resolve = pending.shift();
    if (!resolve) return;
    if (result) {
      resolve(result);
      return;
    }
    const camera = new FakeCamera(rig.requests[rig.requests.length - 1]!.deviceId || 'default', rig.frameSize);
    rig.cameras.push(camera);
    resolve({ ok: true, camera });
  };
  rig.tracker = tracker;
  rig.rotateScreen = () => orientationListener?.();
  rig.configure = (patch = {}) => {
    Object.assign(rig.config, patch);
    tracker.configure(rig.config);
  };
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
        for (const camera of rig.cameras) if (!camera.closed) camera.emitFrame();
        await flush();
      }
      source = tracker.sampleEye(clock.now, eye);
    }
    return { eye, source };
  };
  return rig;
}

/** Runs until `predicate` holds (checked every rendered frame) or `maxMs` passed; returns the elapsed ms. */
export async function runUntil(rig: Rig, predicate: () => boolean, maxMs: number): Promise<number> {
  const start = rig.clock.now;
  while (!predicate() && rig.clock.now - start < maxMs) await rig.run(1000 / 60);
  return rig.clock.now - start;
}
