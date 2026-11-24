/**
 * Chooses and follows the primary player. Pure, time is passed in.
 *
 * - Acquisition: the best face inside the central zone must stay there for a
 *   short while before it is locked.
 * - Once locked, the player is followed purely by position / size continuity.
 *   Other faces are ignored even when they are bigger or more central, so a
 *   passer-by cannot steal the viewpoint.
 * - If the locked player disappears, the lock is kept for a while (the
 *   viewpoint holds / returns to neutral meanwhile) and only then released.
 *
 * No identity features are computed or stored: the only state is the last
 * image position and apparent size of the tracked face.
 */

export interface FaceCandidate {
  /** Face centre in normalised upright frame coordinates (as delivered). */
  u: number;
  v: number;
  /** Apparent face size: outer-eye-corner distance divided by the frame width. */
  size: number;
  /** Rigid fit residual (see FaceMeasurement.residual). */
  residual: number;
}

export interface SelectorConfig {
  /** Half width of the central acquisition zone, normalised (0.5 = whole frame). */
  centerZone: number;
  /** A candidate must be visible this long before it is locked, ms. */
  lockAfterMs: number;
  /** … and in at least this many updates. */
  lockAfterSamples: number;
  /** The lock is released when the player was missing for this long, ms. */
  releaseAfterMs: number;
  /** Association gate in multiples of the apparent face size. */
  gateFaceSizes: number;
  /** Largest plausible change of apparent size between two observations. */
  maxSizeRatio: number;
  /** Faces whose rigid fit is worse than this are ignored. */
  maxResidual: number;
  /** A different candidate replaces the current one only if it scores this much better. */
  switchRatio: number;
}

export const DEFAULT_SELECTOR_CONFIG: SelectorConfig = {
  centerZone: 0.34,
  lockAfterMs: 280,
  lockAfterSamples: 3,
  releaseAfterMs: 2500,
  gateFaceSizes: 1.6,
  maxSizeRatio: 1.7,
  maxResidual: 0.2,
  switchRatio: 1.35,
};

export type SelectorState = 'searching' | 'locked' | 'missing';

interface Track {
  u: number;
  v: number;
  size: number;
  /** Image-space velocity (normalised units per second), lightly smoothed. */
  du: number;
  dv: number;
  firstSeenMs: number;
  lastSeenMs: number;
  samples: number;
}

export class PrimarySelector {
  config: SelectorConfig;
  private track: Track | null = null;
  private lockedFlag = false;
  /** True while the locked player is not visible. */
  private missingFlag = false;
  /** height / width of the upright frame, to compare u and v distances. */
  private aspect = 0.75;

  constructor(config: Partial<SelectorConfig> = {}) {
    this.config = { ...DEFAULT_SELECTOR_CONFIG, ...config };
  }

  reset(): void {
    this.track = null;
    this.lockedFlag = false;
    this.missingFlag = false;
  }

  get state(): SelectorState {
    if (!this.lockedFlag || !this.track) return 'searching';
    return this.missingFlag ? 'missing' : 'locked';
  }

  get locked(): boolean {
    return this.lockedFlag;
  }

  /** Milliseconds since the locked player was last seen (0 when visible or not locked). */
  missingMs(nowMs: number): number {
    if (!this.lockedFlag || !this.track) return 0;
    return Math.max(0, nowMs - this.track.lastSeenMs);
  }

  /**
   * Feeds the faces of one inference. Returns the index of the primary
   * player in `faces`, or -1 when there is none in this frame.
   */
  update(timeMs: number, faces: readonly FaceCandidate[], aspect = this.aspect): number {
    this.aspect = aspect;
    const cfg = this.config;

    if (this.lockedFlag && this.track) {
      const index = this.associate(timeMs, faces, this.track);
      if (index >= 0) {
        this.observe(timeMs, this.track, faces[index]!);
        this.missingFlag = false;
        return index;
      }
      this.missingFlag = true;
      if (timeMs - this.track.lastSeenMs < cfg.releaseAfterMs) return -1;
      // The player is gone: release the lock and start looking again.
      this.reset();
    }

    // Acquisition.
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < faces.length; i++) {
      const score = this.acquisitionScore(faces[i]!);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }

    if (this.track) {
      const current = this.associate(timeMs, faces, this.track);
      if (current < 0 || this.acquisitionScore(faces[current]!) <= 0) {
        // Candidate vanished or left the zone.
        this.track = null;
      } else if (best !== current && bestScore > this.acquisitionScore(faces[current]!) * cfg.switchRatio) {
        // A clearly better candidate appeared: start over with it.
        this.track = null;
      } else {
        this.observe(timeMs, this.track, faces[current]!);
        if (timeMs - this.track.firstSeenMs >= cfg.lockAfterMs && this.track.samples >= cfg.lockAfterSamples) {
          this.lockedFlag = true;
          this.missingFlag = false;
          return current;
        }
        return -1;
      }
    }

    if (best >= 0) {
      const f = faces[best]!;
      this.track = { u: f.u, v: f.v, size: f.size, du: 0, dv: 0, firstSeenMs: timeMs, lastSeenMs: timeMs, samples: 1 };
    }
    return -1;
  }

  /** > 0 for faces that may become the primary player; higher is better. */
  private acquisitionScore(face: FaceCandidate): number {
    const cfg = this.config;
    if (!(face.size > 0) || face.residual > cfg.maxResidual) return 0;
    const off = Math.abs(face.u - 0.5) / cfg.centerZone;
    if (off > 1 || Math.abs(face.v - 0.5) > 0.47) return 0;
    // Prefer the nearest (largest) face, discounted towards the edge of the zone.
    return face.size * (1 - 0.6 * off * off);
  }

  /** Index of the face that continues `track`, or -1. */
  private associate(timeMs: number, faces: readonly FaceCandidate[], track: Track): number {
    const cfg = this.config;
    const dt = Math.max(0, (timeMs - track.lastSeenMs) / 1000);
    // Predict with the smoothed velocity, but never extrapolate more than a quarter second.
    const horizon = Math.min(dt, 0.25);
    const pu = track.u + track.du * horizon;
    const pv = track.v + track.dv * horizon;
    // The gate widens while the player is unseen (they may have moved meanwhile).
    const gate = cfg.gateFaceSizes * track.size * (1 + Math.min(dt, 1.5) * 1.5);
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i]!;
      if (!(f.size > 0) || f.residual > cfg.maxResidual) continue;
      const ratio = f.size / track.size;
      if (ratio > cfg.maxSizeRatio || ratio < 1 / cfg.maxSizeRatio) continue;
      const d = Math.hypot(f.u - pu, (f.v - pv) * this.aspect);
      if (d > gate) continue;
      // Position first, with a small penalty for size changes to break ties when faces overlap.
      const cost = d / track.size + Math.abs(Math.log(ratio)) * 0.5;
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    return best;
  }

  private observe(timeMs: number, track: Track, face: FaceCandidate): void {
    const dt = (timeMs - track.lastSeenMs) / 1000;
    if (dt > 1e-3 && dt < 0.5) {
      const k = Math.min(1, dt / 0.15);
      track.du += ((face.u - track.u) / dt - track.du) * k;
      track.dv += ((face.v - track.v) / dt - track.dv) * k;
    } else if (dt >= 0.5) {
      track.du = 0;
      track.dv = 0;
    }
    track.u = face.u;
    track.v = face.v;
    // Size follows slowly so a single bad frame cannot poison the gate.
    track.size += (face.size - track.size) * 0.5;
    track.lastSeenMs = timeMs;
    track.samples++;
  }
}
