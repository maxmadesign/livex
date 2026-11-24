import type { GraphicsSettings } from '../settings/spec';

/**
 * Automatic optimiser. Judges the frame times of consecutive ~1 s windows and, only when
 * the target cannot be held for several windows in a row, removes cost in this order:
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
    this.lastWasSlow = false;
  }

  /** Forget reductions (called when the user changes graphics settings). */
  clear(): void {
    this.level = 0;
    this.reset();
  }

  private lastWasSlow = false;

  /**
   * Feed one frame time in ms. Returns true when the reduction level changed.
   * `user` (optional) lets the optimiser skip steps that would change nothing
   * for the current settings.
   */
  sample(frameMs: number, targetFps: number, user?: GraphicsSettings): boolean {
    if (!this.enabled) return false;
    // An isolated hitch (tab switch, shader compile) says nothing about steady-state cost and is
    // ignored; several very slow frames in a row are a slow machine and do count (clamped).
    if (frameMs > 250) {
      const isolated = !this.lastWasSlow;
      this.lastWasSlow = true;
      if (isolated) return false;
      frameMs = 250;
    } else this.lastWasSlow = false;
    this.samples[this.cursor] = frameMs;
    this.cursor = (this.cursor + 1) % WINDOW;
    this.count = Math.min(WINDOW, this.count + 1);
    this.sinceEval += frameMs;
    // Each evaluation looks only at the frames since the previous one (about 1 s; at very low
    // frame rates a handful of frames must do), so a short burst cannot colour several verdicts.
    const enough = this.count >= 30 || (this.count >= 6 && this.sinceEval >= 2500);
    if (this.sinceEval < 900 || !enough) return false;
    this.sinceEval = 0;
    const sorted = Array.from(this.samples.subarray(0, this.count)).sort((a, b) => a - b);
    this.count = 0;
    this.cursor = 0;
    const p80 = sorted[Math.floor(sorted.length * 0.8)]!;
    const target = 1000 / targetFps;
    const before = this.level;
    if (p80 > target * 1.22) {
      this.fastEvals = 0;
      // Three slow windows in a row (about 3 s) before anything is removed, so a dip of a second
      // or two changes nothing. A machine that is far over budget drops two steps at a time.
      if (++this.slowEvals >= 3 && this.level < STEPS.length) {
        const jumps = p80 > target * 2.5 ? 2 : 1;
        for (let j = 0; j < jumps && this.level < STEPS.length; j++) {
          // Advance to the next step that really changes something for these settings.
          const active = user ? this.apply(user).reductions.length : -1;
          do this.level++;
          while (user && this.level < STEPS.length && this.apply(user).reductions.length === active);
        }
        this.slowEvals = 0;
      }
    } else if (p80 < target * 0.72) {
      this.slowEvals = 0;
      // Recover slowly: several clean seconds before anything is restored.
      if (++this.fastEvals >= 7 && this.level > 0) {
        this.level--;
        this.fastEvals = 0;
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
