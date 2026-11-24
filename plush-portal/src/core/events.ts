import type { Unsubscribe } from './types';

/**
 * Minimal typed event emitter. Listeners are called synchronously in
 * registration order; a throwing listener never prevents the others from
 * running (the error is reported through `onError`).
 */
export class Emitter<M extends Record<string, unknown>> {
  private listeners = new Map<keyof M, Set<(payload: never) => void>>();
  onError: (error: unknown, event: keyof M) => void = (error, event) => {
    console.error(`[events] listener for "${String(event)}" threw`, error);
  };

  on<K extends keyof M>(event: K, listener: (payload: M[K]) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (payload: never) => void);
    return () => {
      set!.delete(listener as (payload: never) => void);
    };
  }

  once<K extends keyof M>(event: K, listener: (payload: M[K]) => void): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        (listener as (payload: M[K]) => void)(payload);
      } catch (error) {
        this.onError(error, event);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
