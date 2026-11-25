/**
 * App glue of the machine framework (docs/design/machines.md, workstream D; sections 3.5, 4.1-4.5,
 * 4.7, 4.10 and 6.3). Game.ts keeps only hook lines; everything that depends on which machine is
 * played lives here:
 *
 *   - switching: selectMachine → a switch at a round boundary behind the theme curtain (visuals
 *     cleared, core.setMachine, scene rebuilt, claw visual recreated, warm-up);
 *   - settlement of items tries (shelf, rush: the genre's scorer, booked once per round id), the
 *     session card, the session prize (collection + one claim code) and the local rankings;
 *   - today's pick and its points bonus, the optional unlock mode, the lobby cards;
 *   - attract mode with several machines (per-genre pilots, the idle reset back to `home`, the
 *     optional attract cycle) and the guide events of the machines;
 *   - the `ui.machine` slice the HUD, the deck and the lobby read.
 *
 * Classic takes none of the new paths: its rules are null, its results go through Game's own code,
 * today's pick never selects it and its scores stay in the `scores` record. Nothing here decides an
 * outcome; points, prizes and rankings are computed from what physics reported.
 */
import type { Object3D, Vector3 } from 'three';
import type { AudioPort, GuideEventType, GuideFacts } from '../core/contracts';
import type { Lang, RoundResult, ThemeId } from '../core/types';
import type { GameCore } from '../game/GameCore';
import { bridgeState } from '../game/machines/bridge';
import { dailyPick, isUnlocked, winsToUnlock, type UnlockMode } from '../game/machines/daily';
import type { GenreId, MachineId, SessionEndReason } from '../game/machines/ids';
import { GENRES, MACHINES, isMachineId, isPendingGenre, isPlayable, machineDef, resolveMachine } from '../game/machines/registry';
import { rankPosition } from '../game/machines/rush';
import type { MachineDef, ScoredItem, SessionSnapshot } from '../game/machines/types';
import { rarityOf, type RarityTier } from '../game/rarity';
import type { RoundParams } from '../game/RoundController';
import type { ScoreAward, ScoreKeeper, ScoringDifficulty } from '../game/scoring';
import type { FieldOptions } from '../game/ToyField';
import type { CollectionStore } from '../persistence/collection';
import { UNKNOWN_INITIALS, addRanking, loadMachineRecord, rankingsOf, recordPlay, saveMachineRecord } from '../persistence/machines';
import type { RankEntry } from '../game/machines/rush';
import { loadScores, saveScores } from '../persistence/scores';
import { CHUTE_CENTER, PRIZE_SENSOR } from '../physics/fieldSpec';
import { openingCenter } from '../physics/fieldGeometry';
import type { ItemSpec } from '../physics/items';
import type { ToyBody } from '../physics/PhysicsWorld';
import type { PlushAsset } from '../plush/manifest';
import type { FxBurstKind, Vec3Like } from '../scene/fx/api';
import type { Settings } from '../settings/spec';
import { DemoPilot } from './DemoPilot';
import type { GameStore, MachineCardInfo, MachineUiState } from './gameStore';
import { MachinePilot, type Pilot } from './MachinePilot';
import { COUNTDOWN_SFX, MULTI_DROP_SFX, STAFF_RESET_SFX, SWITCH_SFX, TIME_UP_SFX, itemScoredSfx, rankSfx, type SfxCue } from './machineSfx';

/** The manifest id a prize names: the character printed on a machine item, else the plush itself. */
export function prizeTypeOf(toy: Pick<ToyBody, 'asset' | 'item'>): string {
  return toy.item?.print ?? toy.asset.id;
}

/**
 * Machine names for the guide's facts (`facts.machine.name`, in the guide's language). The interface
 * strings live in the `machines` i18n namespace; these are the same names [design section 10, #1].
 */
export const MACHINE_NAMES: Readonly<Record<MachineId, Readonly<Record<Lang, string>>>> = {
  classic: { en: 'Plush Classic', zh: '经典娃娃机', ja: 'クラシック' },
  bridge: { en: 'Tippy Bridge', zh: '摇摇桥', ja: 'ゆらゆらブリッジ' },
  shelf: { en: 'Tumble Shelf', zh: '翻落货架', ja: 'ころころシェルフ' },
  rush: { en: 'Sparkle Rush', zh: '闪耀冲刺', ja: 'キラキララッシュ' },
};

/** Where a won prize leaves the field on classic: the prize exit, just below the floor (Game.ts's numbers). */
export const CLASSIC_EXIT_POS: Vec3Like = Object.freeze({ x: CHUTE_CENTER.x, y: PRIZE_SENSOR.yTop + 0.04, z: CHUTE_CENTER.z });

/**
 * Seconds a try's RESULT stays before the next try starts by itself on an items machine, while the
 * session goes on: a miss, a try that scored items (shelf: time to watch the boxes land), and rush's
 * quick turnaround. Prize machines (classic, bridge) keep Game's own rule.
 */
export const AUTO_ADVANCE: Readonly<Record<GenreId, { miss: number; scored: number } | null>> = {
  classic: null,
  bridge: null,
  shelf: { miss: 1.15, scored: 2.0 },
  rush: { miss: 0.35, scored: 0.35 },
};

/** Longest wait for a session prize's claim code before its line goes out without the scan invitation. */
const PRIZE_LINE_WAIT_MS = 1500;
/** Initials may be entered for this long; then the place is saved as `???`. */
export const INITIALS_SECONDS = 30;
/** Attract cycle: the next offered machine after this many demo rounds. */
export const ATTRACT_CYCLE_ROUNDS = 3;
/** Shelf: a box this close to the front edge after a try that scored nothing earns the "so close" line. */
const SHELF_EDGE = 0.03;
/** Settlements remembered for the debug API. */
const SETTLEMENT_LOG = 64;

/**
 * The item renderer (src/scene/ItemVisuals.ts, rendering workstream) as the game drives it. Game
 * holds one when it exists; until then items are simply not drawn.
 */
export interface ItemVisualsPort {
  readonly group: Object3D;
  sync(toys: Iterable<ToyBody>): void;
  update(alpha: number, dt: number): void;
  positionOf(toy: ToyBody, out: Vector3): boolean;
  clear(): void;
  dispose(): void;
}

/** What the director needs from the game (Game implements it; the unit tests fake it). */
export interface DirectorHost {
  readonly core: GameCore;
  readonly ui: GameStore;
  readonly collection: CollectionStore;
  readonly scores: ScoreKeeper;
  readonly audio: Pick<AudioPort, 'playSfx' | 'playWin'>;
  /** ?debug=1: switches are allowed with the lobby off and the debug override exists. */
  readonly debug: boolean;
  /** ?machine= of this page load (null: machines.home). */
  readonly launchMachine: MachineId | null;
  /** Committed settings. */
  settings(): Settings;
  themeId(): ThemeId;
  enabledAssets(): PlushAsset[];
  roundParams(): RoundParams;
  fieldOptions(): FieldOptions;
  seed(): number | undefined;
  /** The difficulty the current round is scored with. */
  difficulty(): ScoringDifficulty;
  /** Attract mode (the ATTRACT phase or a demo round). */
  inAttract(): boolean;
  /** The switch curtain: themeBusy and the 'theme' pause. */
  setBusy(busy: boolean): void;
  /** Before core.setMachine: toy and item visuals cleared, aura off, claw visual disposed. */
  clearScene(): void;
  /** After core.setMachine: cabinet rebuilt for the new geometry, claw visual recreated, visuals synced. */
  buildScene(): void;
  /** The field changed on the spot (a reset): toy and item visuals follow. */
  syncVisuals(): void;
  warmUp(): Promise<void>;
  /** The lobby dialog closes (a pick was made). */
  closeLobby(): void;
  /** START: leaves attract mode into a player round. */
  pressStart(): void;
  publishScore(award: ScoreAward | null): void;
  /** A "+N" popup at a world position. */
  popup(at: Vec3Like, award: ScoreAward): void;
  burst(kind: FxBurstKind, at: Vec3Like, tier?: RarityTier, scale?: number): void;
  celebrate(tier: RarityTier, at: Vec3Like): void;
  lightShow(mode: 'jackpot' | 'win'): void;
  /** Cabinet LED energy pulse (0..2). */
  ledPulse(energy: number): void;
  emitGuide(type: GuideEventType, result?: RoundResult): void;
  /** A claim code for a real prize (src/rewards RewardFlow.onWin), then the card's QR time starts. */
  requestReward(roundId: number, typeId: string): void;
  cardShown(roundId: number): void;
  resetRewards(): void;
  toast(key: string, params?: Record<string, string | number>): void;
  log(level: 'info' | 'warn', message: string): void;
  /** Wall clock, ms. */
  now(): number;
  /** The local date, YYYY-MM-DD. */
  today(): string;
  guideLanguage(): Lang;
}

export interface Settlement {
  roundId: number;
  machineId: MachineId;
  demo: boolean;
  items: number;
  total: number;
}

type MachineFacts = NonNullable<GuideFacts['machine']>;

interface SwitchOptions {
  /** Called from attract mode by a player: START once the switch is done. */
  start: boolean;
  /** Announce it (machine_selected). */
  guide: boolean;
  why: string;
  /** Only while attract mode lasts: dropped if a player starts before it ran (the way back home). */
  attractOnly?: boolean;
}

/** Settings that change which machines attract mode may show. */
const LINEUP_PATHS: readonly string[] = ['machines.home', 'machines.hidden', 'machines.lobby', 'machines.unlock', 'machines.attractCycle'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class MachineDirector {
  /** The attract pilot of classic (unchanged, one for the page's lifetime). */
  readonly demoPilot = new DemoPilot();
  private machinePilot: MachinePilot | null = null;
  private current: MachineId;
  /** Debug only: machines whose genre has landed may be built although they are not offered yet. */
  private allowUnavailable = false;
  private switching = false;
  /** How the last switch ended (whenSwitched after a switch that failed at once). */
  private lastOk = true;
  private pending: { id: MachineId; options: SwitchOptions } | null = null;
  /** A settings change of the current genre: the machine is rebuilt at the next fitting boundary. */
  private refreshQueued = false;
  private waiters: ((ok: boolean) => void)[] = [];
  /** Demo rounds since the last switch (the attract cycle). */
  private demoRounds = 0;
  /* The session on an items machine. */
  private sessionPoints = 0;
  private sessionItems = 0;
  /** The run's points without today's bonus (the ranking score). */
  private rankScore = 0;
  private overPending: SessionSnapshot | null = null;
  private lastSettled = 0;
  private lastTry: MachineUiState['lastTry'] = null;
  private axisStage: 'x' | 'z' | null = null;
  /** Items scored per round (the multi-drop sound on the second one). */
  private tryItems = { roundId: -1, count: 0 };
  /** Bridge: the last try's progress facts. */
  private lastBridge: { progress: number | null; gain: number | null; stuck: boolean } | null = null;
  /** One-shot facts of the event being emitted (items of a try, rank, reason). */
  private context: Partial<MachineFacts> = {};
  /** Character of the session prize while its session_over line is built (facts.toy). */
  private sayToy: string | null = null;
  /** Unsubscribes a session_over line that waits for its claim code. */
  private pendingSayOff: (() => void) | null = null;
  private readonly settled: Settlement[] = [];
  private readonly offs: (() => void)[] = [];

  constructor(private readonly host: DirectorHost) {
    this.current = host.core.def.def.id;
    this.machinePilot = this.pilotFor();
  }

  /* ------------------------------------------------------------------ state */

  get machineId(): MachineId {
    return this.current;
  }

  get genre(): GenreId {
    return this.host.core.def.def.genre;
  }

  /** The attract pilot of the machine being played: DemoPilot on classic, the genre's MachinePilot otherwise. */
  get pilot(): Pilot {
    return this.machinePilot ?? this.demoPilot;
  }

  get busy(): boolean {
    return this.switching;
  }

  private pilotFor(): MachinePilot | null {
    const def = this.host.core.def;
    const aim = def.module.aim;
    if (def.def.genre === 'classic' || !aim) return null;
    return new MachinePilot((core, round) => aim(core, round, def.params));
  }

  private get machines(): Settings['machines'] {
    return this.host.settings().machines;
  }

  /** A machine that may be built: offered to players, or (debug override) its genre module has landed. */
  private buildable(def: MachineDef): boolean {
    return isPlayable(def) || (this.allowUnavailable && !isPendingGenre(GENRES[def.genre]));
  }

  /** The machine of attract mode and of the idle reset: ?machine= or machines.home, if it can be built. */
  home(): MachineId {
    const want = this.host.launchMachine ?? this.machines.home;
    const def = machineDef(want);
    return def && this.buildable(def) ? def.id : 'classic';
  }

  /** The machines the lobby offers, in order (`home` is always offered). */
  offered(): MachineDef[] {
    const home = this.home();
    const hidden = this.machines.hidden;
    return MACHINES.filter((m) => this.buildable(m) && (m.id === home || !hidden.includes(m.id))).sort((a, b) => a.order - b.order);
  }

  private unlockMode(): UnlockMode {
    return this.machines.unlock === 'progress' ? 'progress' : 'open';
  }

  private unlocked(def: MachineDef): boolean {
    return isUnlocked(def, this.unlockMode(), this.host.collection.getState().wins, this.home());
  }

  /** Today's pick (null when off or when no machine but classic is offered). */
  dailyPick(): MachineId | null {
    if (!this.machines.dailyPick) return null;
    const ids = this.offered()
      .filter((d) => d.id !== 'classic' && this.unlocked(d))
      .map((d) => d.id);
    return dailyPick(this.host.today(), ids);
  }

  /** Points multiplier for a round settled now (re-evaluated at each settlement: it rolls over at midnight). */
  bonusFor(demo: boolean): number {
    if (demo || this.current === 'classic') return 1;
    const bonus = this.machines.dailyBonus;
    return this.dailyPick() === this.current && Number.isFinite(bonus) && bonus > 1 ? bonus : 1;
  }

  /** Debug override: machines that are not offered yet (their genre must have landed) may be selected. */
  setAllowUnavailable(on: boolean): void {
    this.allowUnavailable = on;
    this.refreshUi();
  }

  /** Where effects and popups anchor: the opening of the machine (classic: exactly Game's exit position). */
  exitPos(): Vec3Like {
    if (this.current === 'classic') return CLASSIC_EXIT_POS;
    return openingCenter(this.host.core.def.geometry.opening);
  }

  /* ------------------------------------------------------------------ binding */

  /** Subscribes to the core's long-lived emitters (Game.bindCore). */
  bind(): void {
    const { core } = this.host;
    this.offs.push(
      core.machine.events.on('phase', (e) => {
        if (e.phase === 'RESULT' && e.demo) this.demoRounds++;
        this.refreshUi();
      }),
      core.controllerEvents.on('itemScored', (e) => this.onItemScored(e.roundId, e.toy, e.item)),
      core.controllerEvents.on('axisStage', (e) => {
        this.axisStage = e.stage;
        this.refreshUi();
      }),
      core.session.events.on('started', (s) => this.onSessionStarted(s)),
      core.session.events.on('second', (e) => this.onSecond(e.secondsLeft)),
      core.session.events.on('timeLow', (e) => this.onTimeLow(e.secondsLeft)),
      core.session.events.on('over', (s) => this.onSessionOver(s)),
    );
    this.setPrints();
    this.refreshUi();
  }

  dispose(): void {
    this.dropSessionLine();
    for (const off of this.offs.splice(0)) off();
  }

  /* ------------------------------------------------------------------ switching */

  /**
   * A player (the lobby) or the debug API picks a machine. Refused (false) when the lobby is off
   * (except in debug), the machine is not offered or is locked. While the claw is busy the switch
   * is queued until the try ends ("switches after this try").
   */
  select(id: string): boolean {
    if (!isMachineId(id)) return false;
    if (!this.machines.lobby && !this.host.debug) return false;
    const def = machineDef(id);
    if (!def || !this.buildable(def)) return false;
    if (!this.offered().some((m) => m.id === id) && !this.host.debug) return false;
    if (!this.unlocked(def)) {
      this.host.toast('machines.toast.locked', { n: winsToUnlock(def, this.unlockMode(), this.host.collection.getState().wins, this.home()) });
      return false;
    }
    this.host.closeLobby();
    const options: SwitchOptions = { start: this.host.inAttract(), guide: true, why: 'player' };
    // One curtain at a time: a switch (or a theme change) under way finishes first.
    if (this.switching || this.host.ui.getState().themeBusy) {
      this.pending = { id, options };
      return true;
    }
    if (id === this.current) {
      if (options.start) this.host.pressStart();
      return true;
    }
    const m = this.host.core.machine;
    if (m.busy && !m.demo) {
      this.pending = { id, options };
      this.host.toast('machines.toast.after');
      this.refreshUi();
      return true;
    }
    void this.switchTo(id, options);
    return true;
  }

  /** Resolves once no switch is running or waiting (true when the last one succeeded). */
  whenSwitched(): Promise<boolean> {
    if (!this.switching && !this.pending) return Promise.resolve(this.lastOk);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * The switch itself (design section 4.2), at a round boundary, behind the theme curtain. The
   * synchronous part (stack rebuild, scene) runs at once; the promise resolves after the warm-up.
   */
  private async switchTo(id: MachineId, options: SwitchOptions): Promise<boolean> {
    const { host } = this;
    const { core, ui, scores } = host;
    this.switching = true;
    if (this.pending?.id === id) this.pending = null;
    host.setBusy(true);
    this.refreshUi();
    let ok = false;
    let cleared = false;
    try {
      const m = core.machine;
      if (host.inAttract() && m.phase !== 'ATTRACT') {
        // A demo round stops on the spot (as at a takeover); the machine stays in attract mode.
        if (m.busy) core.controller.resetRound('machine_switch', 'ATTRACT');
        else {
          core.controller.clearInput();
          m.toAttract();
        }
      } else if (m.phase === 'AIMING') core.controller.resetRound('machine_switch', 'READY');
      if (!m.atRoundBoundary) throw new Error(`not at a round boundary (${m.phase})`);
      const resolved = resolveMachine(id, this.machines, { includeUnavailable: this.allowUnavailable });
      if (resolved.def.id !== id) throw new Error(`machine "${id}" can not be built`);
      // The session being left: its line is not spoken over the next machine, and a top-10 place
      // still waiting for initials is kept as `???` (as PLAY AGAIN does; the idle reset drops it first).
      this.dropSessionLine();
      if (ui.getState().rankEntry) this.commitRank(UNKNOWN_INITIALS);
      host.resetRewards();
      ui.setState({ result: null, prize: null, sessionResult: null, rankEntry: null, scorePopups: [] });
      this.resetSessionState();
      this.lastBridge = null;
      this.axisStage = null;
      this.pilot.reset();
      host.clearScene();
      cleared = true;
      core.setMachine(resolved, { assets: host.enabledAssets(), seed: host.seed(), params: host.roundParams(), field: host.fieldOptions() });
      this.current = id;
      this.machinePilot = this.pilotFor();
      this.refreshQueued = false;
      this.demoRounds = 0;
      this.setPrints();
      host.buildScene();
      cleared = false;
      // Each machine keeps its own best and lifetime points; classic's stay in the `scores` record.
      if (id === 'classic') scores.useRecord(loadScores(), (r) => saveScores(r));
      else scores.useRecord(loadMachineRecord(id), (r) => saveMachineRecord(id, r));
      host.publishScore(null);
      this.refreshUi();
      this.cue(SWITCH_SFX);
      host.log('info', `machine switch to ${id} (${options.why})`);
      await host.warmUp();
      ok = true;
    } catch (error) {
      host.log('warn', `machine switch to ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
      host.toast('machines.toast.failed');
      // Never leave the cabinet without its scene (and the claw without its visual).
      if (cleared) {
        try {
          host.buildScene();
        } catch (inner) {
          host.log('warn', `scene rebuild after a failed switch failed: ${inner instanceof Error ? inner.message : String(inner)}`);
        }
      }
    } finally {
      host.setBusy(false);
      this.switching = false;
      this.refreshUi();
    }
    // A player's switch is announced (classic too: its facts simply carry no machine).
    if (ok && options.guide) host.emitGuide('machine_selected');
    if (ok && options.start && host.inAttract()) host.pressStart();
    this.lastOk = ok;
    if (!this.pending) {
      const waiters = this.waiters.splice(0);
      for (const resolve of waiters) resolve(ok);
    }
    return ok;
  }

  /* ------------------------------------------------------------------ per frame */

  /** Every rendered frame (Game.update): queued switches, the initials timeout, the attract cycle. */
  update(): void {
    const { core, ui } = this.host;
    const m = core.machine;
    const entry = ui.getState().rankEntry;
    if (entry && this.host.now() >= entry.deadline) this.commitRank(UNKNOWN_INITIALS);
    if (this.switching || ui.getState().themeBusy) return;
    const boundary = m.atRoundBoundary || (this.host.inAttract() && !m.busy);
    // The way back home was for attract mode: a player who started meanwhile stays where they are.
    if (this.pending?.options.attractOnly && !this.host.inAttract()) {
      this.pending = null;
      for (const resolve of this.waiters.splice(0)) resolve(false);
    }
    if (this.pending && (boundary || (this.host.inAttract() && m.demo))) {
      const { id, options } = this.pending;
      if (id === this.current && !this.refreshQueued) {
        this.pending = null;
        if (options.start && this.host.inAttract()) this.host.pressStart();
        for (const resolve of this.waiters.splice(0)) resolve(true);
        return;
      }
      void this.switchTo(id, options);
      return;
    }
    // Never at RESULT: a rebuild there would wipe the result card and a win's claim QR (bridge).
    if (this.refreshQueued && boundary && m.phase !== 'RESULT') {
      const snap = core.session.snapshot();
      // A tries / timed session is never rebuilt under a player; an open one (classic, bridge) is.
      if (snap.state === 'idle' || (snap.kind === 'open' && snap.state === 'running')) {
        void this.switchTo(this.current, { start: false, guide: false, why: 'settings' });
        return;
      }
    }
    if (this.machines.attractCycle && m.phase === 'ATTRACT' && this.demoRounds >= ATTRACT_CYCLE_ROUNDS && ui.getState().modal === null) {
      this.demoRounds = 0;
      const next = this.nextAttractMachine();
      if (next) void this.switchTo(next, { start: false, guide: false, why: 'attract cycle' });
    }
  }

  /**
   * The machines attract mode visits in turn: the offered ones that are unlocked, in lobby order.
   * With the lobby off the kiosk is a single machine (home only).
   */
  private attractRotation(): MachineDef[] {
    if (!this.machines.lobby) return this.offered().filter((d) => d.id === this.home());
    return this.offered().filter((d) => this.unlocked(d));
  }

  /** The attract cycle's next machine: the one after the current machine in the rotation (home when it is not in it). */
  private nextAttractMachine(): MachineId | null {
    const rotation = this.attractRotation();
    const i = rotation.findIndex((d) => d.id === this.current);
    const next = i < 0 ? this.home() : rotation[(i + 1) % rotation.length]?.id;
    return next && next !== this.current ? next : null;
  }

  /** Committed settings changed (paths of the diff). */
  onSettingsChanged(paths: readonly string[]): void {
    const genre = this.genre;
    if (genre !== 'classic' && paths.some((p) => p.startsWith(`machines.${genre}.`))) this.refreshQueued = true;
    // Attract mode follows a new home machine (or a line-up that no longer includes the machine it
    // shows) at once; otherwise it would wait for some later player's idle reset.
    if (this.host.inAttract() && !this.pending && paths.some((p) => LINEUP_PATHS.includes(p))) {
      const home = this.home();
      const keep = !paths.includes('machines.home') && this.machines.attractCycle && this.attractRotation().some((d) => d.id === this.current);
      if (home !== this.current && !keep) this.pending = { id: home, options: { start: false, guide: false, why: 'settings', attractOnly: true } };
    }
    if (paths.some((p) => p.startsWith('machines.'))) this.refreshUi();
  }

  /* ------------------------------------------------------------------ game flow hooks */

  /** START: a player took over from attract mode (the field is back to its start layout). */
  onStart(): void {
    this.dropSessionLine();
    this.resetSessionState();
    this.host.ui.setState({ sessionResult: null, rankEntry: null });
    this.refreshUi();
  }

  /**
   * The idle reset (Game.idleReset, already in attract mode): any session ended without a result,
   * an unconfirmed ranking place is dropped, and the machine returns to `home` behind the curtain.
   */
  onIdleReset(): void {
    this.dropSessionLine();
    this.host.ui.setState({ sessionResult: null, rankEntry: null });
    this.resetSessionState();
    const cancelled = this.pending !== null;
    this.pending = null;
    const home = this.home();
    const options: SwitchOptions = { start: false, guide: false, why: 'idle reset', attractOnly: true };
    // A switch (or a theme change) under way finishes first; then home.
    if (this.switching || this.host.ui.getState().themeBusy) this.pending = { id: home, options };
    else if (home !== this.current) void this.switchTo(home, options);
    // A player's switch that was waiting for the try will not happen.
    else if (cancelled) for (const resolve of this.waiters.splice(0)) resolve(false);
    this.refreshUi();
  }

  /**
   * The field was filled anew (Game.populate: a theme change from the player's theme button, a toy
   * setting, Settings → rebuild): what a session prize may be. A tries / timed session that has
   * already begun starts over with the fresh field; otherwise a theme change would hand the player a
   * full shelf or pile (both diamonds back) with the session's tries, clock and points running on.
   */
  afterPopulate(): void {
    this.setPrints();
    const { core } = this.host;
    const m = core.machine;
    const snap = core.session.snapshot();
    if (snap.kind === 'open' || snap.state !== 'running' || m.demo || this.host.inAttract()) return;
    if (snap.tries === 0 && !snap.timerStarted) return;
    this.restartSession();
  }

  /** The running session ends without a result and a fresh one starts at a new READY (the field is already fresh). */
  private restartSession(): void {
    const { core, ui, scores } = this.host;
    const m = core.machine;
    this.dropSessionLine();
    core.session.end('abandoned');
    this.resetSessionState();
    scores.resetSession();
    this.host.publishScore(null);
    ui.setState({ result: null, scorePopups: [] });
    this.host.log('info', `${this.current} session started over: the field was filled anew`);
    if (m.phase === 'RESULT') m.next(false);
    else core.controller.resetRound('new_session', 'READY');
    this.refreshUi();
  }

  /**
   * A try finished. Items machines (shelf, rush) are settled here and true is returned: Game's own
   * result code does not run (no result card, no classic guide lines). Prize machines (classic,
   * bridge) return false and Game's classic path runs.
   */
  onResult(result: RoundResult): boolean {
    const def = this.host.core.def;
    if (def.module.presentation === 'prize') {
      if (result.machine && def.def.genre === 'bridge') this.lastBridge = { progress: result.machine.progress, gain: result.machine.progressGain, stuck: result.machine.stuck };
      this.refreshUi();
      return false;
    }
    this.settleTry(result);
    return true;
  }

  /** The guide event of a prize machine's miss: the bridge reports its progress instead of an empty grab. */
  missEvent(result: RoundResult): GuideEventType {
    return this.genre === 'bridge' && result.machine ? 'machine_progress' : 'empty_grab';
  }

  /**
   * RESULT auto-advance on items machines: seconds until the next try (null: never, the session
   * card waits for PLAY AGAIN). undefined: Game's classic rule.
   */
  autoAdvance(): number | null | undefined {
    const rule = AUTO_ADVANCE[this.genre];
    if (!rule || this.host.core.machine.demo) return undefined;
    if (this.sessionOver()) return null;
    return this.lastTry && this.lastTry.items > 0 ? rule.scored : rule.miss;
  }

  /** A tries / timed session has ended and its card is up (PLAY AGAIN starts a new one). */
  sessionOver(): boolean {
    return this.overPending !== null || this.host.core.session.snapshot().state === 'over';
  }

  /**
   * The idle hint may speak: not while a timed run is under way, and not once a session is over (its
   * card or the initials entry is up and the claw is locked: "move the claw" would be wrong there).
   */
  allowHint(): boolean {
    if (this.sessionOver()) return false;
    const s = this.host.core.session.snapshot();
    return !(s.kind === 'timed' && s.state === 'running' && s.timerStarted);
  }

  /** PLAY AGAIN on a session card: the field back to its start layout and a new session. */
  newSession(): boolean {
    const { core, ui, scores } = this.host;
    const m = core.machine;
    if (m.demo || m.phase === 'ATTRACT' || !this.sessionOver()) return false;
    this.dropSessionLine();
    if (ui.getState().rankEntry) this.commitRank(UNKNOWN_INITIALS);
    this.host.resetRewards();
    ui.setState({ result: null, prize: null, sessionResult: null, rankEntry: null, scorePopups: [] });
    this.resetSessionState();
    scores.resetSession();
    this.host.publishScore(null);
    if (this.refreshQueued) {
      // A settings change of this genre waited for the session to end: rebuild now (a fresh session follows).
      core.session.newSession();
      void this.switchTo(this.current, { start: false, guide: false, why: 'settings' });
      return true;
    }
    core.session.newSession();
    this.host.syncVisuals();
    if (m.phase === 'RESULT') m.next(false);
    else core.controller.resetRound('new_session', 'READY');
    this.refreshUi();
    return true;
  }

  /** "Call staff" (bridge): the box back on its start pose, at a round boundary of a player round. Never awards. */
  machineAction(action: 'staff'): boolean {
    if (action !== 'staff') return false;
    const { core } = this.host;
    const m = core.machine;
    const field = core.field;
    if (!field.staffReset || m.demo || this.host.inAttract() || !m.atRoundBoundary || this.switching) return false;
    if (!field.staffReset()) return false;
    core.settle(1.5);
    this.host.syncVisuals();
    this.cue(STAFF_RESET_SFX);
    const box = core.field.onField().find((t) => t.item);
    if (box) {
      const p = box.pose.pos;
      this.host.burst('restock', { x: p[0]!, y: p[1]!, z: p[2]! });
    }
    this.host.toast('machines.staff.done');
    this.lastBridge = { progress: null, gain: null, stuck: false };
    this.refreshUi();
    return true;
  }

  /** Initials for the waiting ranking place. False when none waits or the initials are not three letters. */
  submitInitials(initials: string): boolean {
    const entry = this.host.ui.getState().rankEntry;
    if (!entry || typeof initials !== 'string') return false;
    const clean = initials.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(clean)) return false;
    this.commitRank(clean);
    return true;
  }

  /** The lobby cards, in lobby order. */
  cards(): MachineCardInfo[] {
    const { collection, scores } = this.host;
    const wins = collection.getState().wins;
    const machineWins = collection.getState().machineWins ?? {};
    const elsewhere = Object.entries(machineWins).reduce((sum, [k, v]) => (k === 'classic' ? sum : sum + v), 0);
    const pick = this.dailyPick();
    const mode = this.unlockMode();
    const home = this.home();
    return this.offered().map((def) => {
      const current = def.id === this.current;
      const record = current ? scores.totals(false) : def.id === 'classic' ? loadScores() : loadMachineRecord(def.id);
      const toUnlock = winsToUnlock(def, mode, wins, home);
      return {
        id: def.id,
        genre: def.genre,
        locked: toUnlock > 0,
        winsToUnlock: toUnlock,
        current,
        dailyPick: pick === def.id,
        best: record.best,
        prizesHere: def.id === 'classic' ? Math.max(0, wins - elsewhere) : (machineWins[def.id] ?? 0),
        top: rankingsOf(def.id)
          .slice(0, 3)
          .map((e) => ({ initials: e.initials, score: e.score })),
      };
    });
  }

  /** The local top 10 of a machine (default: the current one). */
  rankings(id: MachineId = this.current): RankEntry[] {
    return rankingsOf(id);
  }

  /** Facts of the machine for the guide (absent on classic: classic facts carry no `machine` key). */
  facts(): MachineFacts | undefined {
    const genre = this.genre;
    if (genre === 'classic') return undefined;
    const snap = this.host.core.session.snapshot();
    const f: MachineFacts = {
      id: this.current,
      genre,
      name: MACHINE_NAMES[this.current][this.host.guideLanguage()] ?? MACHINE_NAMES[this.current].en,
      tries: clamp(Math.floor(snap.tries), 0, 100_000),
    };
    if (snap.triesTotal !== null) f.triesLeft = clamp(snap.triesTotal - snap.tries, 0, 1000);
    if (snap.secondsLeft !== null) f.secondsLeft = clamp(Math.ceil(snap.secondsLeft), 0, 600);
    if (genre === 'bridge') {
      const b = this.lastBridge;
      if (b?.progress != null) f.progress = clamp(b.progress, 0, 1);
      if (b?.gain != null) f.progressGain = clamp(b.gain, -1, 1);
      f.stuck = b?.stuck ?? (this.host.core.field.stuck?.() ?? false);
    } else {
      f.sessionItems = clamp(this.sessionItems, 0, 5000);
      f.score = clamp(Math.round(this.sessionPoints), 0, 100_000_000);
    }
    return { ...f, ...this.context };
  }

  /** Settlements of items tries so far (debug API: one per try). */
  settlements(): Settlement[] {
    return this.settled.map((s) => ({ ...s }));
  }

  debugState(): Record<string, unknown> {
    return {
      current: this.current,
      home: this.home(),
      switching: this.switching,
      pending: this.pending?.id ?? null,
      refreshQueued: this.refreshQueued,
      allowUnavailable: this.allowUnavailable,
      offered: this.offered().map((d) => d.id),
      dailyPick: this.dailyPick(),
      bonus: this.bonusFor(false),
      session: { points: this.sessionPoints, items: this.sessionItems, rankScore: this.rankScore, overPending: this.overPending !== null },
      demoRounds: this.demoRounds,
      pilot: this.machinePilot ? 'machine' : 'demo',
    };
  }

  /* ------------------------------------------------------------------ items machines */

  private onItemScored(roundId: number, toy: ToyBody, item: ItemSpec): void {
    const demo = this.host.core.machine.demo;
    // A late piece after a run or session has ended is not the player's (the session ignores it): no show.
    if (!demo && this.sessionOver()) return;
    for (const cue of itemScoredSfx(item)) this.cue(cue, demo ? 0.7 : 1);
    const p = toy.pose.pos;
    const tier = item.print ? rarityOf(item.print) : valueTier(item.value);
    this.host.burst('score', { x: p[0]!, y: p[1]!, z: p[2]! }, tier);
    if (this.tryItems.roundId !== roundId) this.tryItems = { roundId, count: 0 };
    this.tryItems.count++;
    if (this.tryItems.count === 2) {
      this.cue(MULTI_DROP_SFX, demo ? 0.7 : 1);
      this.host.burst('combo', this.exitPos(), tier, 1);
    }
  }

  /** One items try: the genre's points (with today's bonus), booked once, the try toast, the guide. */
  private settleTry(result: RoundResult): void {
    const { core, ui, scores } = this.host;
    const def = core.def;
    const items: ScoredItem[] = (result.machine?.items ?? []).map((i) => ({ toyId: i.toyId, kind: i.kind, look: i.look as ScoredItem['look'], print: i.print, value: i.value, index: i.index }));
    const difficulty = this.host.difficulty();
    const scoreTry = def.module.scoreTry;
    const round = scoreTry ? scoreTry({ roundId: result.roundId, demo: result.demo, difficulty, items, dailyBonus: this.bonusFor(result.demo) }, def.params) : null;
    const award = round ? scores.settleScored(result.roundId, result.demo, round) : null;
    this.lastSettled = Math.max(this.lastSettled, result.roundId);
    const total = award ? award.total : 0;
    if (award) {
      this.settled.push({ roundId: result.roundId, machineId: this.current, demo: result.demo, items: items.length, total });
      if (this.settled.length > SETTLEMENT_LOG) this.settled.shift();
    }
    // The try toast replaces the result card on items machines (Hud's card reads ui.result).
    ui.setState({ result: null });
    if (award) {
      if (award.total > 0) this.host.popup(this.exitPos(), award);
      this.host.publishScore(award);
    }
    this.lastTry = { roundId: result.roundId, items: items.length, points: total };
    if (!result.demo) {
      this.sessionPoints += total;
      this.sessionItems += items.length;
      if (scoreTry && award) this.rankScore += scoreTry({ roundId: result.roundId, demo: false, difficulty, items, dailyBonus: 1 }, def.params).total;
      if (this.overPending) this.finishSession();
      else this.tryGuide(items.length);
    }
    this.refreshUi();
  }

  /** The guide after an items try while the session goes on (section 4.9's emission policy). */
  private tryGuide(items: number): void {
    const genre = this.genre;
    if (genre === 'shelf') {
      if (items > 0) this.say('items_scored', { items });
      else if (this.shelfBoxAtEdge()) this.say('machine_progress', { items: 0 });
    } else if (genre === 'rush') {
      // Rush speaks only for a handful; per-try lines would talk over the run.
      if (items >= 3) this.say('items_scored', { items });
    }
  }

  /** Shelf: a box still on the shelf within a few cm of its front edge. */
  private shelfBoxAtEdge(): boolean {
    const { core } = this.host;
    const p = core.def.params as { shelfFront?: number; shelfY?: number };
    if (typeof p.shelfFront !== 'number' || typeof p.shelfY !== 'number') return false;
    for (const toy of core.field.onField()) {
      if (!toy.item) continue;
      const c = toy.body.worldCom(core.phys.scratchV);
      if (c.y > p.shelfY && c.z < p.shelfFront + 0.02 && c.z > p.shelfFront - SHELF_EDGE) return true;
    }
    return false;
  }

  private onSessionStarted(s: SessionSnapshot): void {
    this.resetSessionState();
    if (s.machineId !== 'classic') recordPlay(s.machineId);
    this.setPrints();
    this.refreshUi();
  }

  private onSecond(secondsLeft: number): void {
    if (secondsLeft > 0 && secondsLeft <= 10) {
      this.cue(COUNTDOWN_SFX);
      this.host.ledPulse(0.6);
    } else if (secondsLeft === 0) this.cue(TIME_UP_SFX);
    this.refreshUi();
  }

  private onTimeLow(secondsLeft: number): void {
    this.say('time_low', { secondsLeft: clamp(secondsLeft, 0, 600) });
  }

  /**
   * A tries / timed session ended. When it ended at a try's result, the 'over' event comes before
   * Game hears the result: the card waits until that try is settled (settleTry).
   */
  private onSessionOver(s: SessionSnapshot): void {
    this.overPending = s;
    const m = this.host.core.machine;
    if (m.phase === 'READY' || this.lastSettled >= s.lastRoundId) this.finishSession();
  }

  /** The session card: summary, ranking place, the session prize with its one claim code. */
  private finishSession(): void {
    const snap = this.overPending;
    if (!snap) return;
    this.overPending = null;
    const { ui, scores, audio } = this.host;
    const id = snap.machineId;
    const reason: SessionEndReason = snap.reason ?? 'tries';
    let rank: number | null = null;
    // A timed run is a score attack with a local top 10 (never for demo runs: sessions ignore them).
    if (snap.kind === 'timed' && scores.enabled && this.rankScore > 0) {
      rank = rankPosition(rankingsOf(id), this.rankScore);
      if (rank !== null) ui.setState({ rankEntry: { machineId: id, score: this.rankScore, position: rank, deadline: this.host.now() + INITIALS_SECONDS * 1000 } });
    }
    const reward = snap.reward;
    ui.setState({
      sessionResult: {
        machineId: id,
        roundId: snap.lastRoundId,
        reason,
        items: snap.items,
        points: this.sessionPoints,
        best: scores.totals(false).best,
        rank,
        rewardTypeId: reward?.typeId ?? null,
      },
    });
    if (reward) {
      // One claim code per session prize (the collection entry came with the award event).
      this.host.requestReward(reward.roundId, reward.typeId);
      this.host.cardShown(reward.roundId);
      this.host.celebrate(reward.tier, this.exitPos());
      audio.playWin(this.host.themeId(), reward.tier);
      if (ui.getState().prize?.isNew) audio.playSfx('collect_unlock', { delay: 0.9 });
    }
    const rankCue = rankSfx(rank);
    if (rankCue) this.cue(rankCue, 1, 0.6);
    if (rank === 1) this.host.lightShow('jackpot');
    const overContext = { reason: reason === 'abandoned' ? null : reason, rank, items: snap.items };
    if (reward) this.sayWhenCodeSettles(reward.roundId, reward.typeId, overContext);
    else this.say('session_over', overContext);
    this.refreshUi();
  }

  /**
   * The session line names the prize and, when a claim QR is on screen, invites the scan. The code
   * is requested at the same moment, so the line waits for it (at most PRIZE_LINE_WAIT_MS), like
   * Game.emitPrizeWon does for a classic win; a new session or a switch first drops the line.
   */
  private sayWhenCodeSettles(roundId: number, typeId: string, context: Partial<MachineFacts>): void {
    this.dropSessionLine();
    const { ui } = this.host;
    const pending = () => {
      const r = ui.getState().reward;
      return r.roundId === roundId && r.state === 'issuing';
    };
    // The code came (or will not come) for this very round; a reset to idle (PLAY AGAIN, a switch,
    // the idle reset, a theme change) is not an answer and drops the line.
    const settled = () => {
      const r = ui.getState().reward;
      return r.roundId === roundId && r.state !== 'idle';
    };
    const send = () => {
      this.sayToy = typeId;
      try {
        this.say('session_over', context);
      } finally {
        this.sayToy = null;
      }
    };
    if (!pending()) {
      send();
      return;
    }
    let done = false;
    const finish = (deliver: boolean) => {
      if (done) return;
      done = true;
      unsubscribe();
      clearTimeout(timer);
      this.pendingSayOff = null;
      if (deliver && ui.getState().sessionResult?.roundId === roundId) send();
    };
    const unsubscribe = ui.subscribe(() => {
      if (!pending()) finish(settled());
    });
    const timer = setTimeout(() => finish(true), PRIZE_LINE_WAIT_MS);
    this.pendingSayOff = () => finish(false);
  }

  /** A session line still waiting for its claim code is not spoken any more. */
  private dropSessionLine(): void {
    this.pendingSayOff?.();
  }

  /** The session prize's character while its line is being built (Game.facts puts it in facts.toy). */
  sessionLineToy(): string | null {
    return this.sayToy;
  }

  private commitRank(initials: string): void {
    const { ui } = this.host;
    const entry = ui.getState().rankEntry;
    if (!entry) return;
    ui.setState({ rankEntry: null });
    const position = addRanking(entry.machineId, { initials, score: entry.score, at: this.host.now(), difficulty: this.host.difficulty() });
    const card = ui.getState().sessionResult;
    if (card && card.machineId === entry.machineId) ui.setState({ sessionResult: { ...card, rank: position } });
  }

  /** The characters a session prize may be: the enabled ones, least collected first (ties in manifest order). */
  private setPrints(): void {
    const { core, collection } = this.host;
    core.session.prints = () => {
      const counts = collection.getState().counts;
      return this.host
        .enabledAssets()
        .map((a, i) => ({ id: a.id, tier: rarityOf(a.id), n: counts[a.id] ?? 0, i }))
        .sort((a, b) => a.n - b.n || a.i - b.i)
        .map(({ id, tier }) => ({ id, tier }));
    };
  }

  private resetSessionState(): void {
    this.sessionPoints = 0;
    this.sessionItems = 0;
    this.rankScore = 0;
    this.overPending = null;
    this.lastTry = null;
  }

  /* ------------------------------------------------------------------ guide, sound, store */

  private say(type: GuideEventType, context: Partial<MachineFacts>): void {
    if (this.host.core.machine.demo) return;
    this.context = context;
    try {
      this.host.emitGuide(type);
    } finally {
      this.context = {};
    }
  }

  private cue(cue: SfxCue, volume = 1, delay = 0): void {
    const o = cue.options ?? {};
    this.host.audio.playSfx(cue.name, { ...o, volume: (o.volume ?? 1) * volume, delay: (o.delay ?? 0) + delay });
  }

  /** Writes the `ui.machine` slice (only when something changed). */
  refreshUi(): void {
    const { core, ui } = this.host;
    const def = core.def;
    const m = core.machine;
    const snap = core.session.snapshot();
    const genre = def.def.genre;
    let progress: number | null = null;
    let plate: MachineUiState['plate'] = { key: 'machines.plate.free' };
    if (genre === 'bridge') {
      const b = bridgeState(core.phys);
      progress = b.progress;
      // The try being played; while its result is up, still that try (not the next one: after a won
      // box "TRY 3" on the win card's screen named a try that box never had).
      plate = { key: 'machines.plate.try', params: { n: m.phase === 'RESULT' ? Math.max(1, b.tries) : b.tries + 1 } };
    } else if (snap.kind === 'tries' && snap.triesTotal !== null) {
      plate = { key: 'machines.plate.tries', params: { left: Math.max(0, snap.triesTotal - snap.tries), total: snap.triesTotal } };
    } else if (snap.kind === 'timed' && snap.secondsLeft !== null) {
      plate = { key: 'machines.plate.time', params: { s: Math.max(0, Math.ceil(snap.secondsLeft)) } };
    }
    const pick = this.dailyPick();
    const staffable = !!core.field.staffReset;
    const next: MachineUiState = {
      id: this.current,
      genre,
      controls: def.controls,
      presentation: def.module.presentation,
      switching: this.switching,
      lobby: this.machines.lobby && !this.switching && !(m.busy && !m.demo),
      session: {
        kind: snap.kind,
        state: snap.state,
        tries: snap.tries,
        triesTotal: snap.triesTotal,
        secondsLeft: snap.secondsLeft === null ? null : Math.max(0, Math.ceil(snap.secondsLeft)),
        items: snap.items,
        points: def.module.presentation === 'items' ? this.sessionPoints : this.host.scores.totals(false).session,
      },
      progress,
      staff: {
        available: staffable && !m.demo && m.phase !== 'ATTRACT' && (m.phase === 'READY' || m.phase === 'RESULT') && !this.switching,
        highlighted: staffable && (core.field.stuck?.() ?? false),
      },
      dailyPick: pick,
      bonus: this.bonusFor(false),
      lastTry: this.lastTry,
      axisStage: def.controls === 'twoStep' ? this.axisStage : null,
      plate,
    };
    const prev = ui.getState().machine;
    if (JSON.stringify(prev) !== JSON.stringify(next)) ui.setState({ machine: next });
  }
}

/** Effects tier of an unprinted item (gems, coins) by its value. */
function valueTier(value: number): RarityTier {
  if (value >= 150) return 'legendary';
  if (value >= 50) return 'epic';
  if (value >= 25) return 'rare';
  return 'common';
}

