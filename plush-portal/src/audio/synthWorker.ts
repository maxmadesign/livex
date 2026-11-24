/**
 * Fallback synthesiser worker. When the baked audio files cannot be loaded the
 * engine asks this worker to render the same sounds from the same code that
 * produced the files. Rendering happens off the main thread, one file at a
 * time, so the game never stalls.
 */
import { buildSynthManifest } from './synth/fallbackManifest';
import type { AudioManifest } from './synth/manifest';
import { renderFileByKey } from './synth/renderFile';

export type SynthRequest = { id: number; type: 'describe' } | { id: number; type: 'render'; files: string[] };

export type SynthResponse =
  | { id: number; type: 'describe'; manifest: AudioManifest }
  | { id: number; type: 'file'; file: string; sampleRate: number; channels: Float32Array[]; loopStart?: number; loopEnd?: number }
  | { id: number; type: 'missing'; file: string }
  | { id: number; type: 'done' }
  | { id: number; type: 'error'; message: string };

interface WorkerScope {
  onmessage: ((ev: MessageEvent<SynthRequest>) => void) | null;
  postMessage(message: SynthResponse, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
let queue: Promise<void> = Promise.resolve();
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function handle(req: SynthRequest): Promise<void> {
  try {
    if (req.type === 'describe') {
      scope.postMessage({ id: req.id, type: 'describe', manifest: buildSynthManifest() });
      return;
    }
    for (const file of req.files) {
      const rendered = renderFileByKey(file);
      if (!rendered) {
        scope.postMessage({ id: req.id, type: 'missing', file });
      } else {
        scope.postMessage(
          { id: req.id, type: 'file', file, sampleRate: rendered.sampleRate, channels: rendered.channels, loopStart: rendered.loopStart, loopEnd: rendered.loopEnd },
          rendered.channels.map((c) => c.buffer as ArrayBuffer),
        );
      }
      // Yield so newer requests can be queued and the worker stays responsive.
      await pause();
    }
    scope.postMessage({ id: req.id, type: 'done' });
  } catch (error) {
    scope.postMessage({ id: req.id, type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

scope.onmessage = (ev) => {
  const req = ev.data;
  queue = queue.then(() => handle(req));
};
