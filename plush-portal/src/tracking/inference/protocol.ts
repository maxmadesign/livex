/**
 * Messages between the tracker (main thread) and the inference worker.
 * Only image frames go in and only landmark coordinates come out; nothing is
 * stored on either side.
 */
import type { SensorRotation } from '../frameGeometry';

export type Delegate = 'GPU' | 'CPU';

export interface InitMessage {
  type: 'init';
  /** Absolute URL of the directory with the MediaPipe WASM runtime. */
  wasmBase: string;
  /** Absolute URL of face_landmarker.task. */
  modelUrl: string;
  delegate: Delegate;
  numFaces: number;
}

export interface FrameMessage {
  type: 'frame';
  seq: number;
  /** performance.now() of the main thread when the frame was grabbed. */
  captureMs: number;
  image: ImageBitmap;
  /** Clockwise rotation that makes the frame upright. */
  rotation: SensorRotation;
}

export interface DisposeMessage {
  type: 'dispose';
}

export type ToWorker = InitMessage | FrameMessage | DisposeMessage;

export interface BackendInfo {
  delegate: Delegate;
  /** Unmasked WebGL renderer string of the context class MediaPipe uses, when available. */
  glRenderer: string | null;
  /** True when that renderer is a software rasteriser (SwiftShader, llvmpipe, …). */
  softwareGl: boolean;
  /** Milliseconds spent creating the task (WASM + model). */
  initMs: number;
  /** Milliseconds of the validation inference on a blank frame. */
  probeMs: number;
}

export interface ReadyMessage {
  type: 'ready';
  info: BackendInfo;
}

export interface ResultMessage {
  type: 'result';
  seq: number;
  captureMs: number;
  /** Time spent inside detectForVideo (plus rotation), ms. */
  inferMs: number;
  faceCount: number;
  /** faceCount × FLOATS_PER_FACE floats, see landmarks.ts. */
  faces: Float32Array;
  /** Size of the upright frame the detector saw, real pixels. */
  frameWidth: number;
  frameHeight: number;
}

export interface ErrorMessage {
  type: 'error';
  stage: 'init' | 'frame';
  seq?: number;
  message: string;
}

export type FromWorker = ReadyMessage | ResultMessage | ErrorMessage;

export interface InferenceResult {
  captureMs: number;
  inferMs: number;
  faceCount: number;
  faces: Float32Array;
  frameWidth: number;
  frameHeight: number;
}
