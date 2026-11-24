/**
 * Thin wrapper around MediaPipe FaceLandmarker shared by the inference worker
 * and the main-thread fallback. Loads the WASM runtime and the model from
 * local URLs only.
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { drawUpright, type SensorRotation } from '../frameGeometry';
import { FLOATS_PER_FACE, FLOATS_PER_LANDMARK, MAX_LANDMARK_ID, TRACKED_LANDMARK_IDS } from '../landmarks';
import type { BackendInfo, Delegate, InferenceResult } from './protocol';

export interface CoreOptions {
  wasmBase: string;
  modelUrl: string;
  delegate: Delegate;
  numFaces: number;
  /** true inside an ES module worker (loads vision_wasm_module_internal.js via import()). */
  useModule: boolean;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Any2d = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Reads the renderer string of a throw-away WebGL2 context (same GPU path MediaPipe will use). */
export function probeGl(): { available: boolean; renderer: string | null; software: boolean } {
  try {
    const canvas = makeCanvas(1, 1);
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return { available: false, renderer: null, software: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { available: true, renderer, software: /swiftshader|llvmpipe|software|softpipe|basic render/i.test(renderer) };
  } catch {
    return { available: false, renderer: null, software: false };
  }
}

/** glog style lines ("W1124 04:58:52.08 … file.cc:181] …") and TFLite "INFO:" chatter. */
const MEDIAPIPE_LOG = /^(?:[IWEF]\d{4} \d\d:\d\d:\d\d\.\d+|INFO: |WARNING: |ERROR: )/;

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';
const CONSOLE_METHODS: readonly ConsoleMethod[] = ['log', 'info', 'warn', 'error'];

/**
 * MediaPipe's WASM runtime prints its start-up chatter through console.error /
 * console.warn (Emscripten binds stdout/stderr to the console methods that
 * exist while the module is created). While `fn` runs, those methods are
 * wrapped so MediaPipe's own lines go to console.debug – real MediaPipe errors
 * ("E…"/"F…" lines) are kept as warnings – and every other message passes
 * through untouched. The wrappers stay bound inside the WASM module after the
 * originals are restored.
 */
export async function withQuietMediaPipeLogs<T>(fn: () => Promise<T>): Promise<T> {
  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();
  for (const method of CONSOLE_METHODS) {
    const original = console[method] as (...args: unknown[]) => void;
    originals.set(method, original);
    console[method] = (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === 'string' && MEDIAPIPE_LOG.test(first)) {
        if (/^[EF]\d{4} |^ERROR: /.test(first)) originals.get('warn')!.call(console, '[mediapipe]', ...args);
        else console.debug('[mediapipe]', ...args);
        return;
      }
      original.apply(console, args);
    };
  }
  try {
    return await fn();
  } finally {
    for (const method of CONSOLE_METHODS) console[method] = originals.get(method)! as never;
  }
}

export class LandmarkerCore {
  readonly info: BackendInfo;
  private landmarker: FaceLandmarker | null;
  private lastTimestamp = 0;
  private rotateCanvas: AnyCanvas | null = null;
  private rotateCtx: Any2d | null = null;

  private constructor(landmarker: FaceLandmarker, info: BackendInfo) {
    this.landmarker = landmarker;
    this.info = info;
  }

  /** Creates the task and validates it by running one real inference on a blank frame. */
  static create(options: CoreOptions): Promise<LandmarkerCore> {
    return withQuietMediaPipeLogs(() => LandmarkerCore.createInternal(options));
  }

  private static async createInternal(options: CoreOptions): Promise<LandmarkerCore> {
    const gl = probeGl();
    if (!gl.available) {
      // MediaPipe uploads every frame through WebGL, for the CPU delegate as well.
      throw new Error('WebGL2 is not available in this context (required by MediaPipe image input)');
    }
    const t0 = performance.now();
    const fileset = await FilesetResolver.forVisionTasks(options.wasmBase, options.useModule);
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: options.modelUrl, delegate: options.delegate },
      runningMode: 'VIDEO',
      numFaces: Math.max(1, Math.min(4, Math.round(options.numFaces))),
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    const initMs = performance.now() - t0;
    const core = new LandmarkerCore(landmarker, {
      delegate: options.delegate,
      glRenderer: gl.renderer,
      softwareGl: gl.software,
      initMs,
      probeMs: 0,
    });
    try {
      // Validation: an actual inference. A delegate that only fails once it runs is caught here.
      const blank = makeCanvas(96, 96);
      const ctx = blank.getContext('2d') as Any2d | null;
      if (ctx) {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, 96, 96);
      }
      const t1 = performance.now();
      const result = landmarker.detectForVideo(blank as TexImageSource, 1);
      core.info.probeMs = performance.now() - t1;
      core.lastTimestamp = 1;
      if (!result || !Array.isArray(result.faceLandmarks)) throw new Error('validation inference returned no result');
    } catch (error) {
      core.close();
      throw error;
    }
    return core;
  }

  /**
   * Runs the detector on `source` (rotated upright first when needed) and
   * packs the tracked landmarks of every face.
   */
  detect(source: TexImageSource, sourceWidth: number, sourceHeight: number, rotation: SensorRotation, captureMs: number): InferenceResult {
    const landmarker = this.landmarker;
    if (!landmarker) throw new Error('landmarker is closed');
    const t0 = performance.now();
    let input: TexImageSource = source;
    let width = sourceWidth;
    let height = sourceHeight;
    if (rotation !== 0) {
      const swap = rotation === 90 || rotation === 270;
      width = swap ? sourceHeight : sourceWidth;
      height = swap ? sourceWidth : sourceHeight;
      if (!this.rotateCanvas || this.rotateCanvas.width !== width || this.rotateCanvas.height !== height) {
        this.rotateCanvas = makeCanvas(width, height);
        this.rotateCtx = this.rotateCanvas.getContext('2d') as Any2d | null;
      }
      if (!this.rotateCtx) throw new Error('2D canvas is not available for sensor rotation');
      drawUpright(this.rotateCtx, source as CanvasImageSource, sourceWidth, sourceHeight, rotation);
      input = this.rotateCanvas as TexImageSource;
    }
    // MediaPipe requires strictly increasing integer-ish timestamps in VIDEO mode.
    const timestamp = Math.max(this.lastTimestamp + 1, Math.round(captureMs));
    this.lastTimestamp = timestamp;
    const result = landmarker.detectForVideo(input, timestamp);
    const all = result.faceLandmarks ?? [];
    let faceCount = 0;
    for (const face of all) if (face.length > MAX_LANDMARK_ID) faceCount++;
    const faces = new Float32Array(faceCount * FLOATS_PER_FACE);
    let f = 0;
    for (const face of all) {
      if (face.length <= MAX_LANDMARK_ID) continue;
      const base = f * FLOATS_PER_FACE;
      for (let i = 0; i < TRACKED_LANDMARK_IDS.length; i++) {
        const lm = face[TRACKED_LANDMARK_IDS[i]!]!;
        const o = base + i * FLOATS_PER_LANDMARK;
        faces[o] = lm.x;
        faces[o + 1] = lm.y;
        faces[o + 2] = lm.z;
      }
      f++;
    }
    return { captureMs, inferMs: performance.now() - t0, faceCount, faces, frameWidth: width, frameHeight: height };
  }

  close(): void {
    try {
      this.landmarker?.close();
    } catch {
      /* already gone */
    }
    this.landmarker = null;
    this.rotateCanvas = null;
    this.rotateCtx = null;
  }
}
