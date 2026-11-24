import { afterEach, describe, expect, it, vi } from 'vitest';
import { disableUsageLogging, withQuietMediaPipeLogs } from '../../../src/tracking/inference/mediapipeGuards';

/** Mimics the shape of MediaPipe's task → usage logger → sender objects (names are minified in reality). */
function fakeTask() {
  let sent = 0;
  let timerCleared = false;
  const sender = {
    i: [] as unknown[], // pending events
    l: 'api-key',
    h: 1 as number | undefined,
    error: undefined as unknown,
    flush() {
      if (this.error) return;
      if (this.i.length > 0) {
        sent += this.i.length;
        this.i = [];
      }
    },
    close() {
      if (this.h !== undefined) {
        timerCleared = true;
        this.h = undefined;
      }
      this.flush();
    },
  };
  const logger = {
    m: sender,
    record(event: unknown) {
      if (!sender.error) sender.i.push(event);
    },
  };
  const task = {
    o: logger,
    h: { j: { HEAPU8: new Uint8Array(8), canvas: {} } }, // graph runner + wasm module look-alike
    detectForVideo() {
      logger.record({});
    },
    close() {
      sender.close();
    },
  };
  return { task, sender, logger, sent: () => sent, timerCleared: () => timerCleared };
}

describe('disableUsageLogging', () => {
  it('finds the sender structurally, stops its timer and makes every later upload a no-op', () => {
    const f = fakeTask();
    f.task.detectForVideo(); // one event is already queued
    expect(disableUsageLogging(f.task)).toBe(true);
    expect(f.timerCleared()).toBe(true);
    expect(f.sent()).toBe(0); // the queued event was NOT flushed while closing
    f.task.detectForVideo();
    f.task.detectForVideo();
    f.sender.flush(); // what the 60 s interval would call
    f.task.close(); // what dispose() calls
    expect(f.sent()).toBe(0);
    expect(f.sender.i.length).toBeLessThanOrEqual(1); // nothing accumulates any more
  });

  it('without the guard the fake really uploads (sanity check of the test double)', () => {
    const f = fakeTask();
    f.task.detectForVideo();
    f.task.close();
    expect(f.sent()).toBe(1);
  });

  it('returns false when there is nothing to disable and never throws on odd input', () => {
    expect(disableUsageLogging({ a: 1, b: { c: 'x' } })).toBe(false);
    expect(disableUsageLogging(null)).toBe(false);
    expect(disableUsageLogging(undefined)).toBe(false);
    expect(disableUsageLogging(42)).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(disableUsageLogging(cyclic)).toBe(false);
  });

  it('does not touch the task itself or unrelated objects that merely have close()', () => {
    const closeSpy = vi.fn();
    const task = { detectForVideo() {}, close: closeSpy, flush() {}, queue: [] as unknown[], helper: { close: closeSpy } };
    expect(disableUsageLogging(task)).toBe(false);
    expect(closeSpy).not.toHaveBeenCalled();
  });
});

describe('withQuietMediaPipeLogs', () => {
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  afterEach(() => {
    Object.assign(console, original);
  });

  it('demotes MediaPipe chatter to debug, keeps real errors visible and restores the console', async () => {
    const calls: string[] = [];
    console.error = (...args: unknown[]) => calls.push(`error:${String(args[0])}`);
    console.warn = (...args: unknown[]) => calls.push(`warn:${String(args[0])} ${String(args[1] ?? '')}`.trim());
    console.debug = (...args: unknown[]) => calls.push(`debug:${String(args[1] ?? args[0])}`);
    const patchedError = console.error;
    let bound: (...args: unknown[]) => void = () => undefined;

    const result = await withQuietMediaPipeLogs(async () => {
      // Emscripten binds its stderr to console.error while the module is created.
      bound = console.error.bind(console);
      console.error('INFO: Created TensorFlow Lite XNNPACK delegate for CPU.');
      console.warn('W1124 04:58:52.087000 2210688 face_landmarker_graph.cc:181] Sets FaceBlendshapesGraph acceleration to xnnpack by default.');
      console.error('E1124 04:58:52.100000 1 gl_context.cc:99] something actually failed');
      console.error('an unrelated application error');
      return 7;
    });

    expect(result).toBe(7);
    expect(console.error).toBe(patchedError); // restored
    expect(calls).toEqual([
      'debug:INFO: Created TensorFlow Lite XNNPACK delegate for CPU.',
      'debug:W1124 04:58:52.087000 2210688 face_landmarker_graph.cc:181] Sets FaceBlendshapesGraph acceleration to xnnpack by default.',
      'warn:[mediapipe] E1124 04:58:52.100000 1 gl_context.cc:99] something actually failed',
      'error:an unrelated application error',
    ]);
    // Lines printed later through the handle captured during creation stay filtered.
    bound('W1124 05:00:00.000000 1 inference_feedback_manager.cc:121] Feedback manager requires a model with a single signature inference.');
    expect(calls[calls.length - 1]).toContain('debug:W1124 05:00:00');
  });

  it('restores the console when the wrapped function throws', async () => {
    const before = console.error;
    await expect(withQuietMediaPipeLogs(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(console.error).toBe(before);
  });
});
