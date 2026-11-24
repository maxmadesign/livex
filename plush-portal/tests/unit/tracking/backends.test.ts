import { describe, expect, it } from 'vitest';
import {
  backendOrder,
  selectBackend,
  type BackendFactory,
  type BackendKind,
  type InferenceBackend,
} from '../../../src/tracking/inference/backends';
import type { BackendInfo } from '../../../src/tracking/inference/protocol';

const options = { wasmBase: '/mediapipe/wasm', modelUrl: '/mediapipe/models/face_landmarker.task', numFaces: 2 };

function fakeFactory(behaviour: Partial<Record<BackendKind, 'ok' | 'fail' | 'software'>>) {
  const created: BackendKind[] = [];
  const disposed: BackendKind[] = [];
  const factory: BackendFactory = async (kind) => {
    created.push(kind);
    const mode = behaviour[kind] ?? 'fail';
    if (mode === 'fail') throw new Error(`${kind} is not available here`);
    const info: BackendInfo = {
      delegate: kind.endsWith('gpu') ? 'GPU' : 'CPU',
      glRenderer: mode === 'software' ? 'ANGLE (SwiftShader)' : 'ANGLE (Real GPU)',
      softwareGl: mode === 'software',
      initMs: 100,
      probeMs: 10,
    };
    const backend: InferenceBackend = {
      kind,
      info,
      infer: () => Promise.reject(new Error('not used')),
      dispose: () => {
        disposed.push(kind);
      },
    };
    return backend;
  };
  return { factory, created, disposed };
}

describe('backendOrder', () => {
  it('tries the worker first and ends on the main thread', () => {
    expect(backendOrder('auto')).toEqual(['worker-gpu', 'worker-cpu', 'main-cpu']);
    expect(backendOrder('cpu')).toEqual(['worker-cpu', 'main-cpu']);
    expect(backendOrder('gpu')[0]).toBe('worker-gpu');
    expect(backendOrder('gpu')).toContain('main-cpu');
  });
});

describe('selectBackend', () => {
  it('uses worker + GPU when it really works', async () => {
    const f = fakeFactory({ 'worker-gpu': 'ok', 'worker-cpu': 'ok', 'main-cpu': 'ok' });
    const result = await selectBackend('auto', options, f.factory);
    expect(result.backend?.kind).toBe('worker-gpu');
    expect(f.created).toEqual(['worker-gpu']);
  });

  it('falls through worker+GPU → worker+CPU → main-thread CPU and records why', async () => {
    const f = fakeFactory({ 'main-cpu': 'ok' });
    const result = await selectBackend('auto', options, f.factory);
    expect(result.backend?.kind).toBe('main-cpu');
    expect(f.created).toEqual(['worker-gpu', 'worker-cpu', 'main-cpu']);
    expect(result.attempts.map((a) => a.ok)).toEqual([false, false, true]);
    expect(result.attempts[0]!.detail).toContain('not available');
  });

  it('returns null when nothing works', async () => {
    const f = fakeFactory({});
    const result = await selectBackend('auto', options, f.factory);
    expect(result.backend).toBeNull();
    expect(result.attempts).toHaveLength(3);
  });

  it('auto skips a GPU delegate that would run on software WebGL when the CPU path works', async () => {
    const f = fakeFactory({ 'worker-gpu': 'software', 'worker-cpu': 'ok' });
    const result = await selectBackend('auto', options, f.factory);
    expect(result.backend?.kind).toBe('worker-cpu');
    expect(f.disposed).toEqual(['worker-gpu']);
    expect(result.attempts[0]!.detail).toContain('software WebGL');
  });

  it('auto still falls back to the software GPU delegate as a last resort', async () => {
    const f = fakeFactory({ 'worker-gpu': 'software' });
    const result = await selectBackend('auto', options, f.factory);
    expect(result.backend?.kind).toBe('worker-gpu');
    expect(f.created).toEqual(['worker-gpu', 'worker-cpu', 'main-cpu', 'worker-gpu']);
  });

  it('a forced GPU delegate is honoured even on software WebGL', async () => {
    const f = fakeFactory({ 'worker-gpu': 'software', 'worker-cpu': 'ok' });
    const result = await selectBackend('gpu', options, f.factory);
    expect(result.backend?.kind).toBe('worker-gpu');
  });

  it('a forced CPU delegate never creates a GPU backend', async () => {
    const f = fakeFactory({ 'worker-gpu': 'ok', 'worker-cpu': 'ok' });
    const result = await selectBackend('cpu', options, f.factory);
    expect(result.backend?.kind).toBe('worker-cpu');
    expect(f.created).toEqual(['worker-cpu']);
  });

  it('skips backends that already failed at runtime', async () => {
    const f = fakeFactory({ 'worker-gpu': 'ok', 'worker-cpu': 'ok' });
    const result = await selectBackend('auto', options, f.factory, () => false, ['worker-gpu']);
    expect(result.backend?.kind).toBe('worker-cpu');
    expect(f.created).toEqual(['worker-cpu']);
  });

  it('disposes a backend that finishes after cancellation', async () => {
    const f = fakeFactory({ 'worker-gpu': 'ok' });
    let cancelled = false;
    const slow: BackendFactory = async (kind, o) => {
      const backend = await f.factory(kind, o);
      cancelled = true; // stop() was called while the model was loading
      return backend;
    };
    const result = await selectBackend('auto', options, slow, () => cancelled);
    expect(result.backend).toBeNull();
    expect(f.disposed).toEqual(['worker-gpu']);
  });
});
