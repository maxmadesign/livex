/**
 * Inference backends and the runtime probing chain.
 *
 * Nothing here assumes that a given combination works: every backend is
 * created and validated with a real inference before it is used, and the
 * tracker falls through worker+GPU → worker+CPU → main-thread CPU.
 */
import type { SensorRotation } from '../frameGeometry';
import type { BackendInfo, Delegate, FromWorker, InferenceResult, ToWorker } from './protocol';

export type BackendKind = 'worker-gpu' | 'worker-cpu' | 'main-gpu' | 'main-cpu';

/** What a backend needs from the camera to grab the current frame. */
export interface FrameSource {
  video: HTMLVideoElement | null;
  width: number;
  height: number;
}

export interface InferenceBackend {
  readonly kind: BackendKind;
  readonly info: BackendInfo;
  /** Runs one inference on the current camera frame. Rejects on failure or timeout. */
  infer(source: FrameSource, captureMs: number, rotation: SensorRotation): Promise<InferenceResult>;
  dispose(): void;
}

export interface BackendOptions {
  wasmBase: string;
  modelUrl: string;
  numFaces: number;
  initTimeoutMs?: number;
  frameTimeoutMs?: number;
}

export type BackendFactory = (kind: BackendKind, options: BackendOptions) => Promise<InferenceBackend>;

const delegateOf = (kind: BackendKind): Delegate => (kind.endsWith('gpu') ? 'GPU' : 'CPU');
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

class WorkerBackend implements InferenceBackend {
  private seq = 0;
  private pending = new Map<number, { resolve: (r: InferenceResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private disposed = false;

  private constructor(
    private readonly worker: Worker,
    readonly kind: BackendKind,
    readonly info: BackendInfo,
    private readonly frameTimeoutMs: number,
  ) {
    worker.onmessage = (event: MessageEvent<FromWorker>) => this.onMessage(event.data);
    worker.onerror = (event) => this.failAll(new Error(`inference worker crashed: ${event.message || 'unknown error'}`));
  }

  static create(kind: BackendKind, options: BackendOptions): Promise<WorkerBackend> {
    return new Promise((resolve, reject) => {
      if (typeof Worker === 'undefined') {
        reject(new Error('Web Workers are not available'));
        return;
      }
      if (typeof createImageBitmap !== 'function') {
        reject(new Error('createImageBitmap is not available'));
        return;
      }
      let worker: Worker;
      try {
        worker = new Worker(new URL('./faceWorker.ts', import.meta.url), { type: 'module', name: 'plush-face-tracking' });
      } catch (error) {
        reject(new Error(`could not start the inference worker (${describe(error)})`));
        return;
      }
      const fail = (error: Error) => {
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error('inference worker did not initialise in time')), options.initTimeoutMs ?? 40_000);
      worker.onerror = (event) => fail(new Error(`inference worker failed to load: ${event.message || 'unknown error'}`));
      worker.onmessageerror = () => fail(new Error('inference worker sent an unreadable message'));
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const message = event.data;
        if (message.type === 'ready') {
          clearTimeout(timer);
          resolve(new WorkerBackend(worker, kind, message.info, options.frameTimeoutMs ?? 4000));
        } else if (message.type === 'error') {
          fail(new Error(message.message));
        }
      };
      const init: ToWorker = {
        type: 'init',
        wasmBase: options.wasmBase,
        modelUrl: options.modelUrl,
        delegate: delegateOf(kind),
        numFaces: options.numFaces,
      };
      worker.postMessage(init);
    });
  }

  async infer(source: FrameSource, captureMs: number, rotation: SensorRotation): Promise<InferenceResult> {
    if (this.disposed) throw new Error('backend is disposed');
    if (!source.video) throw new Error('no video element to read frames from');
    // The bitmap is transferred to the worker, which closes it right after the inference.
    const image = await createImageBitmap(source.video);
    if (this.disposed) {
      image.close();
      throw new Error('backend is disposed');
    }
    const seq = ++this.seq;
    return new Promise<InferenceResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error('inference timed out'));
      }, this.frameTimeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      const message: ToWorker = { type: 'frame', seq, captureMs, image, rotation };
      try {
        this.worker.postMessage(message, [image]);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(seq);
        image.close();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failAll(new Error('backend is disposed'));
    try {
      const message: ToWorker = { type: 'dispose' };
      this.worker.postMessage(message);
    } catch {
      /* worker already gone */
    }
    // Give the worker a moment to release the model, then make sure it is gone.
    setTimeout(() => this.worker.terminate(), 200);
  }

  private onMessage(message: FromWorker): void {
    if (message.type === 'result') {
      const entry = this.pending.get(message.seq);
      if (!entry) return; // timed out earlier: stale result, drop it
      this.pending.delete(message.seq);
      clearTimeout(entry.timer);
      entry.resolve({
        captureMs: message.captureMs,
        inferMs: message.inferMs,
        faceCount: message.faceCount,
        faces: message.faces,
        frameWidth: message.frameWidth,
        frameHeight: message.frameHeight,
      });
    } else if (message.type === 'error' && message.stage === 'frame' && message.seq !== undefined) {
      const entry = this.pending.get(message.seq);
      if (!entry) return;
      this.pending.delete(message.seq);
      clearTimeout(entry.timer);
      entry.reject(new Error(message.message));
    }
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}

class MainThreadBackend implements InferenceBackend {
  private disposed = false;

  private constructor(
    readonly kind: BackendKind,
    readonly info: BackendInfo,
    private readonly core: { detect: (typeof import('./landmarkerCore').LandmarkerCore)['prototype']['detect']; close(): void },
  ) {}

  static async create(kind: BackendKind, options: BackendOptions): Promise<MainThreadBackend> {
    if (typeof document === 'undefined') throw new Error('main-thread inference needs a document');
    // Loaded on demand so MediaPipe stays out of the main bundle unless this fallback is used.
    const { LandmarkerCore } = await import('./landmarkerCore');
    const core = await LandmarkerCore.create({
      wasmBase: options.wasmBase,
      modelUrl: options.modelUrl,
      delegate: delegateOf(kind),
      numFaces: options.numFaces,
      useModule: false,
    });
    return new MainThreadBackend(kind, core.info, core);
  }

  async infer(source: FrameSource, captureMs: number, rotation: SensorRotation): Promise<InferenceResult> {
    if (this.disposed) throw new Error('backend is disposed');
    const video = source.video;
    if (!video) throw new Error('no video element to read frames from');
    return this.core.detect(video, video.videoWidth, video.videoHeight, rotation, captureMs);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.core.close();
  }
}

/** Default factory used in the browser. */
export const createBackend: BackendFactory = (kind, options) =>
  kind.startsWith('worker') ? WorkerBackend.create(kind, options) : MainThreadBackend.create(kind, options);

/** Order in which backends are tried for a `camera.delegate` setting. */
export function backendOrder(delegate: 'auto' | 'gpu' | 'cpu'): BackendKind[] {
  switch (delegate) {
    case 'gpu':
      return ['worker-gpu', 'main-gpu', 'worker-cpu', 'main-cpu'];
    case 'cpu':
      return ['worker-cpu', 'main-cpu'];
    default:
      return ['worker-gpu', 'worker-cpu', 'main-cpu'];
  }
}

export interface ProbeAttempt {
  kind: BackendKind;
  ok: boolean;
  /** Error text, or timing / renderer info for successful attempts. */
  detail: string;
  ms: number;
}

export interface SelectResult {
  backend: InferenceBackend | null;
  attempts: ProbeAttempt[];
}

/**
 * Tries the backends for `delegate` in order and returns the first one that
 * initialises and passes its validation inference.
 *
 * In 'auto' mode a GPU delegate that would run on a software rasteriser is
 * skipped in favour of the CPU delegate (and only used as a last resort):
 * software WebGL is far slower than the WASM CPU path.
 */
export async function selectBackend(
  delegate: 'auto' | 'gpu' | 'cpu',
  options: BackendOptions,
  factory: BackendFactory,
  isCancelled: () => boolean = () => false,
  skip: readonly BackendKind[] = [],
): Promise<SelectResult> {
  const attempts: ProbeAttempt[] = [];
  const order = backendOrder(delegate).filter((kind) => !skip.includes(kind));
  const lastResort: BackendKind[] = [];
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const attempt = async (kind: BackendKind, allowSoftwareGpu: boolean): Promise<InferenceBackend | null> => {
    const t0 = now();
    try {
      const backend = await factory(kind, options);
      const ms = now() - t0;
      const info = backend.info;
      const summary = `init ${info.initMs.toFixed(0)} ms, probe ${info.probeMs.toFixed(0)} ms, gl: ${info.glRenderer ?? 'n/a'}`;
      if (!allowSoftwareGpu && info.delegate === 'GPU' && info.softwareGl) {
        backend.dispose();
        attempts.push({ kind, ok: true, detail: `${summary} — skipped: GPU delegate on software WebGL`, ms });
        lastResort.push(kind);
        return null;
      }
      attempts.push({ kind, ok: true, detail: summary, ms });
      return backend;
    } catch (error) {
      attempts.push({ kind, ok: false, detail: describe(error), ms: now() - t0 });
      return null;
    }
  };

  for (const kind of order) {
    if (isCancelled()) return { backend: null, attempts };
    const backend = await attempt(kind, delegate !== 'auto');
    if (backend) {
      if (isCancelled()) {
        backend.dispose();
        return { backend: null, attempts };
      }
      return { backend, attempts };
    }
  }
  for (const kind of lastResort) {
    if (isCancelled()) return { backend: null, attempts };
    const backend = await attempt(kind, true);
    if (backend) return { backend, attempts };
  }
  return { backend: null, attempts };
}
