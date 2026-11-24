/**
 * Small guards around the MediaPipe runtime that do not depend on MediaPipe
 * itself (so they can be unit tested without a browser).
 */

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

/**
 * MediaPipe Tasks (1.x) ships a usage-metrics logger that uploads performance
 * / utilisation statistics to `odml.pa.googleapis.com` once a minute and when
 * a task is closed (see the "Privacy Notice" in the package README). Head
 * tracking in this game is strictly local, so the logger is switched off:
 * its sender is put into its own "failed" state, `flush()` is replaced by a
 * no-op and its timer is stopped.
 *
 * The logger has no public off switch, so it is located structurally (an
 * object with `flush()` and `close()` hanging off the task) instead of by its
 * minified property name. Returns false when nothing was found – the worker's
 * network guard (see faceWorker.ts) still blocks the upload in that case.
 */
export function disableUsageLogging(task: unknown): boolean {
  // The sender: `flush()` + `close()` plus a queue (array) of pending log events.
  const isSender = (value: unknown): value is { flush: unknown; close: () => void; error?: unknown } =>
    !!value &&
    typeof value === 'object' &&
    typeof (value as { flush?: unknown }).flush === 'function' &&
    typeof (value as { close?: unknown }).close === 'function' &&
    !('detectForVideo' in (value as object)) &&
    Object.values(value as Record<string, unknown>).some(Array.isArray);
  const silence = (sender: { flush: unknown; close: () => void; error?: unknown }) => {
    sender.error = new Error('usage logging disabled');
    sender.flush = () => undefined;
    try {
      sender.close();
    } catch {
      /* ignore */
    }
  };
  let found = false;
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    // task → logger → sender: only the task's children and grandchildren are inspected.
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 1) return;
    seen.add(value);
    let children: unknown[];
    try {
      children = Object.values(value as Record<string, unknown>);
    } catch {
      return;
    }
    for (const child of children) {
      if (isSender(child)) {
        silence(child);
        found = true;
      } else if (child && typeof child === 'object' && !ArrayBuffer.isView(child) && !(child instanceof ArrayBuffer)) {
        visit(child, depth + 1);
      }
    }
  };
  visit(task, 0);
  return found;
}
