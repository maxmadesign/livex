/**
 * Chooses and follows the primary player. Pure, time is passed in.
 *
 * - Acquisition: the best face inside the central zone must stay there for a
 *   short while before it is locked.
 * - Once locked, the player is followed purely by position / size continuity.
 *   Other faces are ignored even when they are bigger or more central.
 * - Everyone else in view is followed as an anonymous "other" track. A face
 *   that continues such a track can never be mistaken for the player, so a
 *   passer-by cannot steal the viewpoint – not even while the player is
 *   briefly hidden.
 * - If the locked player disappears, the lock is kept for a while (the
 *   viewpoint holds / returns to neutral meanwhile) and only then released.
 *
 * No identity features are computed or stored: the only state is the last
 * image position and apparent size of each face currently in view.
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
  /** Association gate at zero elapsed time, in multiples of the apparent face size. */
  gateFaceSizes: number;
  /** How fast the gate grows while a face is unseen, face sizes per second (≈ plausible head speed). */
  gateGrowthPerSec: number;
  /** Largest plausible change of apparent size between two observations. */
  maxSizeRatio: number;
  /** Faces whose rigid fit is worse than this are ignored. */
  maxResidual: number;
  /** A different candidate replaces the current one only if it scores this much better. */
  switchRatio: number;
  /** Other faces are forgotten after being unseen for this long, ms. */
  otherTimeoutMs: number;
}

export const DEFAULT_SELECTOR_CONFIG: SelectorConfig = {
  centerZone: 0.34,
  lockAfterMs: 280,
  lockAfterSamples: 3,
  releaseAfterMs: 2500,
  gateFaceSizes: 0.9,
  gateGrowthPerSec: 14,
  maxSizeRatio: 1.7,
  maxResidual: 0.2,
  switchRatio: 1.35,
  otherTimeoutMs: 700,
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

const MAX_OTHERS = 6;

export class PrimarySelector {
  config: SelectorConfig;
  private track: Track | null = null;
  private lockedFlag = false;
  /** True while the locked player is not visible. */
  private missingFlag = false;
  /** Everyone else currently in view (only while a player is locked). */
  private others: Track[] = [];
  /** height / width of the upright frame, to compare u and v distances. */
  private aspect = 0.75;

  constructor(config: Partial<SelectorConfig> = {}) {
    this.config = { ...DEFAULT_SELECTOR_CONFIG, ...config };
  }

  reset(): void {
    this.track = null;
    this.lockedFlag = false;
    this.missingFlag = false;
    this.others = [];
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
      const index = this.followLocked(timeMs, faces, this.track);
      if (index >= 0) {
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
      const current = this.nearest(timeMs, faces, this.track, null);
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
          // Everybody else who is in view right now starts as an "other".
          this.others = [];
          for (let i = 0; i < faces.length; i++) if (i !== current) this.addOther(timeMs, faces[i]!);
          return current;
        }
        return -1;
      }
    }

    if (best >= 0) this.track = this.newTrack(timeMs, faces[best]!);
    return -1;
  }

  /** > 0 for faces that may become the primary player; higher is better. */
  private acquisitionScore(face: FaceCandidate): number {
    const cfg = this.config;
    if (!this.usable(face)) return 0;
    const off = Math.abs(face.u - 0.5) / cfg.centerZone;
    if (off > 1 || Math.abs(face.v - 0.5) > 0.47) return 0;
    // Prefer the nearest (largest) face, discounted towards the edge of the zone.
    return face.size * (1 - 0.6 * off * off);
  }

  private usable(face: FaceCandidate): boolean {
    return face.size > 0 && face.residual <= this.config.maxResidual;
  }

  /**
   * Distance between a face and a track's predicted position (normalised
   * frame-width units, with a small penalty for size changes to break ties
   * when faces overlap). Returns Infinity when the face is outside the
   * track's gate or its size does not fit.
   */
  private distance(timeMs: number, face: FaceCandidate, track: Track): number {
    const cfg = this.config;
    const ratio = face.size / track.size;
    if (ratio > cfg.maxSizeRatio || ratio < 1 / cfg.maxSizeRatio) return Infinity;
    const dt = Math.max(0, (timeMs - track.lastSeenMs) / 1000);
    // Predict with the smoothed velocity, but never extrapolate more than a quarter second.
    const horizon = Math.min(dt, 0.25);
    const pu = track.u + track.du * horizon;
    const pv = track.v + track.dv * horizon;
    // The gate grows with the time the face was unseen: it may have moved meanwhile.
    const gate = (cfg.gateFaceSizes + cfg.gateGrowthPerSec * Math.min(dt, 0.75)) * track.size;
    const d = Math.hypot(face.u - pu, (face.v - pv) * this.aspect);
    if (d > gate) return Infinity;
    return d + Math.abs(Math.log(ratio)) * 0.15 * track.size;
  }

  /** Index of the usable face nearest to `track` within its gate (skipping `exclude`), or -1. */
  private nearest(timeMs: number, faces: readonly FaceCandidate[], track: Track, exclude: ReadonlySet<number> | null): number {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < faces.length; i++) {
      if (exclude?.has(i) || !this.usable(faces[i]!)) continue;
      const d = this.distance(timeMs, faces[i]!, track);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return best;
  }

  /** Updates the locked player and the other tracks; returns the player's index or -1. */
  private followLocked(timeMs: number, faces: readonly FaceCandidate[], track: Track): number {
    const cfg = this.config;
    // Forget others that left.
    this.others = this.others.filter((o) => timeMs - o.lastSeenMs <= cfg.otherTimeoutMs);

    // Faces that are better explained by somebody else's track are not the player.
    const claimed = new Map<number, Track>();
    const taken = new Set<number>();
    for (const other of this.others) {
      let best = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < faces.length; i++) {
        if (taken.has(i) || !this.usable(faces[i]!)) continue;
        const d = this.distance(timeMs, faces[i]!, other);
        if (d >= bestDistance) continue;
        // Contested with the player: whoever is (absolutely) closer to its prediction gets the face.
        if (d > this.distance(timeMs, faces[i]!, track)) continue;
        bestDistance = d;
        best = i;
      }
      if (best >= 0) {
        taken.add(best);
        claimed.set(best, other);
      }
    }

    const index = this.nearest(timeMs, faces, track, taken);
    if (index >= 0) this.observe(timeMs, track, faces[index]!);

    // Maintain the other tracks.
    for (const [i, other] of claimed) this.observe(timeMs, other, faces[i]!);
    for (let i = 0; i < faces.length; i++) {
      if (i === index || taken.has(i) || !this.usable(faces[i]!)) continue;
      this.addOther(timeMs, faces[i]!);
    }
    return index;
  }

  private addOther(timeMs: number, face: FaceCandidate): void {
    if (!this.usable(face)) return;
    if (this.others.length >= MAX_OTHERS) this.others.shift();
    this.others.push(this.newTrack(timeMs, face));
  }

  private newTrack(timeMs: number, face: FaceCandidate): Track {
    return { u: face.u, v: face.v, size: face.size, du: 0, dv: 0, firstSeenMs: timeMs, lastSeenMs: timeMs, samples: 1 };
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
