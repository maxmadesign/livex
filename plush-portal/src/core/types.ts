/**
 * Shared primitive types. This file has no runtime dependencies so it can be
 * imported from the browser bundle, the Node tools and the API server alike.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export const THEME_IDS = ['sakura', 'storybook', 'ocean', 'cosmic', 'gpu'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const LANGS = ['en', 'zh', 'ja'] as const;
export type Lang = (typeof LANGS)[number];

export const DISPLAY_PROFILE_IDS = ['desktop', 'portrait32', 'portrait86', 'mobile'] as const;
export type DisplayProfileId = (typeof DISPLAY_PROFILE_IDS)[number];

/** Round state machine phases (see src/game/RoundMachine.ts). */
export const ROUND_PHASES = [
  'ATTRACT',
  'READY',
  'AIMING',
  'DESCENDING',
  'CLOSING',
  'LIFTING',
  'TRANSPORTING',
  'RELEASING',
  'SETTLING',
  'RESULT',
] as const;
export type RoundPhase = (typeof ROUND_PHASES)[number];

export type RoundOutcome = 'won' | 'empty' | 'slipped';

/** Why a toy that was really gripped got away. Always derived from physics facts. */
export type SlipReason =
  | 'eccentric' // grabbed far from the toy's centre of mass
  | 'weak_support' // too few fingers under the toy
  | 'contact_lost' // fingers lost contact for too long
  | 'transport_swing' // came loose while the trolley accelerated / swung
  | 'overload' // load exceeded what the grip could hold
  | 'bounced_out'; // carried all the way and released, but it bounced off the chute rim

/** How close the claw came to a toy during a round. */
export type ContactLevel = 'none' | 'touched' | 'gripped' | 'lifted';

export interface RoundResult {
  roundId: number;
  outcome: RoundOutcome;
  demo: boolean;
  themeId: ThemeId;
  /** Instance id of the toy that was the valid grip target, if any. */
  targetToyId: string | null;
  /** Character type id (manifest id) of the target / prize. */
  targetTypeId: string | null;
  /** Set only when outcome === 'won'. Unique per awarded prize. */
  prizeId: string | null;
  contact: ContactLevel;
  slipReason: SlipReason | null;
  /** Phase in which the toy got away (slipped only). */
  slipPhase: RoundPhase | null;
  /** How long the target stayed off the ground while held, in ms. */
  liftedMs: number;
  /** Grip quality 0..1 computed from real contacts when the grip was established. */
  gripQuality: number;
  /**
   * Offset from the claw axis to the nearest toy centre when the grab started,
   * in metres. +x is to the player's right, +z is towards the player (front).
   */
  nearest: { dx: number; dz: number; dist: number; typeId: string } | null;
  /** Only on non-classic machines (docs/design/machines.md); classic results never carry it. */
  machine?: MachineRoundInfo;
}

/** One item scored in a try of an items machine (shelf, rush). */
export interface MachineItem {
  toyId: string;
  kind: 'box' | 'snack' | 'gem' | 'coin';
  look: string;
  print: string | null;
  value: number;
  /** 1-based order within the try. */
  index: number;
}

export interface MachineRoundInfo {
  id: string; // MachineId
  genre: string; // GenreId
  items: MachineItem[]; // shelf / rush: items scored in this try
  progress: number | null; // bridge: 0..1 after the try (presentation / guide only)
  progressGain: number | null;
  stuck: boolean; // bridge: "Call staff" is lit
}

export type Unsubscribe = () => void;
