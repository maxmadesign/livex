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

const post = (message: FromWorker, transfer: Transferable[] = []) => self.postMessage(message, transfer);
const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case 'init': {
      try {
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
