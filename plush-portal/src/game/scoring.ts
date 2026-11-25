/**
 * Points system. Pure and headless: it only reads facts the simulation already
 * produced (outcome, prize type, grip facts) and never feeds anything back, so
 * switching it off or on cannot change physics, grip rules or outcomes.
 *
 *   win   = (base × difficulty + first-catch bonus + clean-grab bonus) × combo
 *   slip  = 10 consolation points, combo reset
 *   empty = 0, combo reset
 *
 * Every round is settled at most once (by round id), however often the game
 * reports it — the same idempotency rule as the prize collection.
 */
import type { RoundOutcome } from '../core/types';
import { TIER_POINTS, rarityOf, type RarityTier } from './rarity';

export type ScoringDifficulty = 'easy' | 'arcade' | 'skill' | 'custom';

export const DIFFICULTY_MULTIPLIER: Readonly<Record<ScoringDifficulty, number>> = Object.freeze({
  easy: 0.8,
  arcade: 1,
  skill: 1.5,
  custom: 1,
});

export const SCORING_RULES = Object.freeze({
  /** First time a character enters the collection: + this share of its base points. */
  firstCatchBonus: 0.5,
  /** Centred grab: + this share of the base points. */
  cleanGrabBonus: 0.2,
  /** Consolation for a toy that was really gripped and then got away. */
  slipPoints: 10,
  /** Grip facts of a "clean" grab: aim error small enough for this centring score… */
  cleanMinCentering: 0.8,
  /** …with at least this many fingers on the toy. */
  cleanMinFingers: 3,
});

/** Combo multiplier for the n-th consecutive win: 1st ×1, 2nd ×1.5, 3rd ×2, 4th and later ×3. */
export function comboMultiplier(streak: number): number {
  if (streak >= 4) return 3;
  if (streak === 3) return 2;
  if (streak === 2) return 1.5;
  return 1;
}

/** The grip facts the clean-grab bonus looks at (src/physics/GripMonitor GripFacts). */
export interface GripSummary {
  /** 1 = the claw's axis was on the toy's centre of mass when it came down, 0 = far off. */
  centering: number;
  fingers: number;
}

/** A centred grab: the aim was close to the toy's centre and all three fingers held it. */
export function isCleanGrab(grip: GripSummary | null | undefined): boolean {
  if (!grip) return false;
  return grip.centering >= SCORING_RULES.cleanMinCentering && grip.fingers >= SCORING_RULES.cleanMinFingers;
}

export interface RoundScoreInput {
  roundId: number;
  outcome: RoundOutcome;
  /** Manifest id of the prize (won) or of the toy that got away (slipped). */
  typeId: string | null;
  difficulty: ScoringDifficulty;
  /** True when this prize is the first of its character in the collection. */
  firstCatch: boolean;
  grip: GripSummary | null;
  demo: boolean;
}

export interface ScoreAward {
  roundId: number;
  outcome: RoundOutcome;
  demo: boolean;
  typeId: string | null;
  /** Rarity of the prize; null when nothing was won. */
  tier: RarityTier | null;
  /** Tier base points (100 / 250 / 500 / 1000); 0 when nothing was won. */
  base: number;
  difficultyMultiplier: number;
  /** base × difficulty, rounded. */
  basePoints: number;
  firstCatch: number;
  cleanGrab: number;
  /** Slip consolation points. */
  consolation: number;
  /** Consecutive wins including this round (0 after a slip or an empty grab). */
  streak: number;
  comboMultiplier: number;
  /** Points added by the combo multiplier. */
  comboBonus: number;
  total: number;
  /** Session score (player or demo track) after this round. */
  session: number;
  best: number;
  /** This round lifted the best session score (never for demo rounds). */
  newBest: boolean;
  /** Machines with items (shelf, rush): items scored in the try. Absent on classic rounds. */
  items?: number;
  /** Machines: extra rows of the breakdown (multi-drop, handful, today's pick). Absent on classic rounds. */
  extras?: { key: string; points: number }[];
  /** Machines: the today's-pick multiplier applied to this round (absent or 1 = none). */
  dailyBonus?: number;
}

export type RoundScore = Omit<ScoreAward, 'session' | 'best' | 'newBest'>;

/** Points for one round, given the number of consecutive wins before it. */
export function scoreRound(input: RoundScoreInput, streakBefore: number): RoundScore {
  const difficultyMultiplier = DIFFICULTY_MULTIPLIER[input.difficulty] ?? 1;
  const common = { roundId: input.roundId, outcome: input.outcome, demo: input.demo, typeId: input.typeId, difficultyMultiplier };
  if (input.outcome !== 'won') {
    const consolation = input.outcome === 'slipped' ? SCORING_RULES.slipPoints : 0;
    return {
      ...common,
      tier: null,
      base: 0,
      basePoints: 0,
      firstCatch: 0,
      cleanGrab: 0,
      consolation,
      streak: 0,
      comboMultiplier: 1,
      comboBonus: 0,
      total: consolation,
    };
  }
  const tier = rarityOf(input.typeId);
  const base = TIER_POINTS[tier];
  const basePoints = Math.round(base * difficultyMultiplier);
  const firstCatch = input.firstCatch ? Math.round(base * SCORING_RULES.firstCatchBonus) : 0;
  const cleanGrab = isCleanGrab(input.grip) ? Math.round(base * SCORING_RULES.cleanGrabBonus) : 0;
  const streak = Math.max(0, Math.floor(streakBefore)) + 1;
  const multiplier = comboMultiplier(streak);
  const subtotal = basePoints + firstCatch + cleanGrab;
  const total = Math.round(subtotal * multiplier);
  return {
    ...common,
    tier,
    base,
    basePoints,
    firstCatch,
    cleanGrab,
    consolation: 0,
    streak,
    comboMultiplier: multiplier,
    comboBonus: total - subtotal,
    total,
  };
}

/**
 * Today's pick (docs/design/machines.md, section 4.4) on a machine that scores with scoreRound (the
 * bridge): the round's points × `bonus`, rounded once, with the difference as a 'daily' breakdown
 * row. A bonus of 1 or less returns the round unchanged. Classic is never today's pick.
 */
export function applyDailyBonus(round: RoundScore, bonus: number): RoundScore {
  if (!(Number.isFinite(bonus) && bonus > 1)) return round;
  const total = Math.round(round.total * bonus);
  const extras = [...(round.extras ?? [])];
  if (total !== round.total) extras.push({ key: 'daily', points: total - round.total });
  return { ...round, total, extras, dailyBonus: bonus };
}

/** What is persisted (src/persistence/scores.ts). */
export interface ScoreRecord {
  best: number;
  lifetime: number;
}

export interface ScoreTotals {
  session: number;
  streak: number;
  best: number;
  lifetime: number;
}

const REMEMBERED_ROUNDS = 64;

/**
 * Keeps the session score, the combo streak, the best session score and the
 * lifetime total. Demo rounds run on a separate track: they are scored for the
 * show but never touch the player's session, best or lifetime, and are never persisted.
 */
export class ScoreKeeper {
  /** gameplay.scoring: when false nothing is awarded. */
  enabled = true;
  private readonly player = { session: 0, streak: 0 };
  private readonly demoTrack = { session: 0, streak: 0 };
  private best: number;
  private lifetime: number;
  private readonly settled = new Map<number, ScoreAward>();
  private onPersist: ((record: ScoreRecord) => void) | undefined;

  constructor(record: ScoreRecord = { best: 0, lifetime: 0 }, onPersist?: (record: ScoreRecord) => void) {
    this.best = record.best;
    this.lifetime = record.lifetime;
    this.onPersist = onPersist;
  }

  /** Scores a finished (or physically decided) round once. Returns null when off or already settled. */
  settle(input: RoundScoreInput): ScoreAward | null {
    if (!this.enabled) return null;
    if (this.settled.has(input.roundId)) return null;
    const track = input.demo ? this.demoTrack : this.player;
    return this.book(input.roundId, input.demo, scoreRound(input, track.streak));
  }

  /**
   * Machines (docs/design/machines.md, section 2.3): books points computed elsewhere (an items try's
   * scorer, or scoreRound with today's bonus) exactly like `settle` books its own. Same rules: once
   * per round id, nothing when scoring is off, demo rounds on their own track and never persisted.
   */
  settleScored(roundId: number, demo: boolean, round: RoundScore): ScoreAward | null {
    if (!this.enabled) return null;
    if (this.settled.has(roundId)) return null;
    return this.book(roundId, demo, { ...round, roundId, demo });
  }

  /**
   * A machine switch: best and lifetime of the machine now played (each machine keeps its own record)
   * and where they persist. The session score and combo start over; settled round ids are kept (they
   * keep counting across machines).
   */
  useRecord(record: ScoreRecord, onPersist?: (record: ScoreRecord) => void): void {
    this.best = record.best;
    this.lifetime = record.lifetime;
    this.onPersist = onPersist;
    this.resetSession();
  }

  private book(roundId: number, demo: boolean, round: RoundScore): ScoreAward {
    const track = demo ? this.demoTrack : this.player;
    track.streak = round.streak;
    track.session += round.total;
    let newBest = false;
    if (!demo) {
      this.lifetime += round.total;
      if (track.session > this.best) {
        this.best = track.session;
        newBest = true;
      }
      if (round.total > 0) this.onPersist?.({ best: this.best, lifetime: this.lifetime });
    }
    const award: ScoreAward = { ...round, session: track.session, best: this.best, newBest };
    this.settled.set(roundId, award);
    if (this.settled.size > REMEMBERED_ROUNDS) this.settled.delete(this.settled.keys().next().value!);
    return award;
  }

  /** The award of a round that was already settled, if any. */
  awardFor(roundId: number): ScoreAward | null {
    return this.settled.get(roundId) ?? null;
  }

  isSettled(roundId: number): boolean {
    return this.settled.has(roundId);
  }

  totals(demo = false): ScoreTotals {
    const track = demo ? this.demoTrack : this.player;
    return { session: track.session, streak: track.streak, best: this.best, lifetime: this.lifetime };
  }

  /** New player session (idle reset, a player leaving attract mode): score and combo start over. */
  resetSession(): void {
    this.player.session = 0;
    this.player.streak = 0;
    this.resetDemo();
  }

  /** The demo's own show score. */
  resetDemo(): void {
    this.demoTrack.session = 0;
    this.demoTrack.streak = 0;
  }

  /** Settings → System → Reset scores: best and lifetime as well. */
  resetAll(): void {
    this.resetSession();
    this.best = 0;
    this.lifetime = 0;
    this.onPersist?.({ best: 0, lifetime: 0 });
  }
}
