/// <reference lib="webworker" />
/**
 * Inference worker (ES module worker). Receives camera frames as transferred
 * ImageBitmaps, runs MediaPipe FaceLandmarker and returns packed landmark
 * coordinates. Frames are closed as soon as they have been processed and are
 * never stored or sent anywhere.
 */
import { LandmarkerCore } from './landmarkerCore';
import type { FromWorker, ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let core: LandmarkerCore | null = null;

/**
 * Network guard: this worker only ever needs the local WASM runtime and the
 * local model. Every request to another origin is refused, so neither camera
 * data nor library telemetry can leave the device from here, whatever a
 * dependency tries to do.
 */
function installNetworkGuard(allowedUrls: string[]): void {
  const allowed = new Set<string>([self.location.origin]);
  for (const url of allowedUrls) {
    try {
      allowed.add(new URL(url, self.location.href).origin);
    } catch {
      /* ignore malformed entries */
    }
  }
  const isLocal = (url: string): boolean => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return true;
    try {
      return allowed.has(new URL(url, self.location.href).origin);
    } catch {
      return false;
    }
  };
  const scope = self as unknown as Record<string, unknown>;
  if (scope.__plushNetworkGuard) return;
  scope.__plushNetworkGuard = true;

  const originalFetch = self.fetch.bind(self);
  self.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isLocal(url)) return Promise.reject(new TypeError('blocked: the tracking worker only loads local files'));
    return originalFetch(input, init);
  }) as typeof fetch;

  if (typeof XMLHttpRequest !== 'undefined') {
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      if (!isLocal(String(url))) throw new TypeError('blocked: the tracking worker only loads local files');
      return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;
  }
  // Nothing in here needs sockets or event streams.
  for (const name of ['WebSocket', 'EventSource', 'WebTransport']) {
    if (name in scope) {
      scope[name] = function Blocked() {
        throw new TypeError('blocked: the tracking worker has no network access');
      };
    }
  }
}

const post = (message: FromWorker, transfer: Transferable[] = []) => self.postMessage(message, transfer);
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'init': {
      try {
        installNetworkGuard([message.wasmBase, message.modelUrl]);
        core?.close();
        core = await LandmarkerCore.create({
          wasmBase: message.wasmBase,
          modelUrl: message.modelUrl,
          delegate: message.delegate,
          numFaces: message.numFaces,
          useModule: true,
        });
        post({ type: 'ready', info: core.info });
      } catch (error) {
        core = null;
        post({ type: 'error', stage: 'init', message: describe(error) });
      }
      break;
    }
    case 'frame': {
      const image = message.image;
      try {
        if (!core) throw new Error('worker is not initialised');
        const result = core.detect(image, image.width, image.height, message.rotation, message.captureMs);
        post({ type: 'result', seq: message.seq, ...result }, [result.faces.buffer]);
      } catch (error) {
        post({ type: 'error', stage: 'frame', seq: message.seq, message: describe(error) });
      } finally {
        image.close();
      }
      break;
    }
    case 'dispose': {
      core?.close();
      core = null;
      self.close();
      break;
    }
  }
};
