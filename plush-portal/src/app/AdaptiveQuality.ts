import type { GraphicsSettings } from '../settings/spec';

/**
 * Automatic optimiser. Watches a sliding window of frame times and, only when
 * the target cannot be held, removes cost in this order:
 *   decorative particles → bloom → ambient occlusion → expensive reflections /
 *   glass → internal resolution → shadow resolution.
 * It never touches physics, input, the number of toys or the layout. Upper and
 * lower thresholds plus hold counters give it hysteresis so it does not flap.
 */
export interface AdaptiveState {
  /** Extra internal-resolution scale (1 = none). */
  scale: number;
  /** Index into STEPS of the reductions currently applied. */
  level: number;
}

const STEPS = ['particles', 'bloom', 'ao', 'reflections', 'glass', 'scale90', 'scale80', 'scale70', 'shadows', 'scale60', 'scale50'] as const;
export type ReductionStep = (typeof STEPS)[number];

const WINDOW = 120;

export class AdaptiveQuality {
  private readonly samples = new Float32Array(WINDOW);
  private count = 0;
  private cursor = 0;
  private sinceEval = 0;
  private slowEvals = 0;
  private fastEvals = 0;
  level = 0;
  enabled = true;

  reset(): void {
    this.count = 0;
    this.cursor = 0;
    this.sinceEval = 0;
    this.slowEvals = 0;
    this.fastEvals = 0;
  }

  /** Forget reductions (called when the user changes graphics settings). */
  clear(): void {
    this.level = 0;
    this.reset();
  }

  /** Feed one frame time in ms. Returns true when the reduction level changed. */
  sample(frameMs: number, targetFps: number): boolean {
    if (!this.enabled) return false;
    // Ignore hitches that have nothing to do with steady-state cost (tab switch, shader compile).
    if (frameMs > 250) return false;
    this.samples[this.cursor] = frameMs;
    this.cursor = (this.cursor + 1) % WINDOW;
    this.count = Math.min(WINDOW, this.count + 1);
    this.sinceEval += frameMs;
    if (this.sinceEval < 900 || this.count < 30) return false;
    this.sinceEval = 0;
    const sorted = Array.from(this.samples.subarray(0, this.count)).sort((a, b) => a - b);
    const p80 = sorted[Math.floor(sorted.length * 0.8)]!;
    const target = 1000 / targetFps;
    const before = this.level;
    if (p80 > target * 1.22) {
      this.fastEvals = 0;
      if (++this.slowEvals >= 2 && this.level < STEPS.length) {
        this.level++;
        this.slowEvals = 0;
        this.count = 0; // measure the new configuration from scratch
      }
    } else if (p80 < target * 0.72) {
      this.slowEvals = 0;
      // Recover slowly: several clean seconds before anything is restored.
      if (++this.fastEvals >= 7 && this.level > 0) {
        this.level--;
        this.fastEvals = 0;
        this.count = 0;
      }
    } else {
      this.slowEvals = 0;
      this.fastEvals = 0;
    }
    return this.level !== before;
  }

  /** Applies the current reductions to a copy of the user's graphics settings. */
  apply(user: GraphicsSettings): { graphics: GraphicsSettings; scale: number; reductions: ReductionStep[] } {
    const g = { ...user };
    let scale = 1;
    const active = STEPS.slice(0, this.enabled ? this.level : 0);
    const reductions: ReductionStep[] = [];
    for (const step of active) {
      switch (step) {
        case 'particles':
          if (g.particles > 20) {
            g.particles = Math.round(g.particles * 0.3);
            reductions.push(step);
          }
          break;
        case 'bloom':
          if (g.bloom > 0.01) {
            g.bloom = 0;
            reductions.push(step);
          }
          break;
        case 'ao':
          if (g.ao !== 'off') {
            g.ao = 'off';
            reductions.push(step);
          }
          break;
        case 'reflections':
          if (g.reflections !== 'static') {
            g.reflections = 'static';
            reductions.push(step);
          }
          break;
        case 'glass':
          if (g.glass === 'high') {
            g.glass = 'medium';
            reductions.push(step);
          }
          break;
        case 'shadows':
          if (g.shadows === 'high') {
            g.shadows = 'medium';
            reductions.push(step);
          } else if (g.shadows === 'medium') {
            g.shadows = 'low';
            reductions.push(step);
          }
          break;
        default:
          scale = Math.min(scale, Number(step.slice(5)) / 100);
          reductions.push(step);
      }
    }
    return { graphics: g, scale, reductions };
  }
}
