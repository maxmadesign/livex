import { Vector3 } from 'three';
import type { AudioPort, GuideEvent, GuideEventType, GuideFacts, GuidePort, SfxName, TrackerPort } from '../core/contracts';
import type { DisplayProfileId, Lang, RoundResult, ThemeId, Vec3 } from '../core/types';
import { getLog, log, logError } from '../diagnostics/log';
import { GameCore } from '../game/GameCore';
import type { RoundParams } from '../game/RoundController';
import { solveLayout, type HudLayout } from '../layout/solve';
import { computeWindowLayout, eyeToWorld, readWindowEnvironment, type WindowLayout } from '../perspective/windowGeometry';
import type { CollectionStore } from '../persistence/collection';
import { CLAW, FIXED_DT, GROUP, groups } from '../physics/fieldSpec';
import { FixedStepper, RAPIER, initRapier, type ImpactEvent, type ToyBody } from '../physics/PhysicsWorld';
import { PlushLibrary } from '../plush/PlushLibrary';
import type { PlushAsset } from '../plush/manifest';
import { Cabinet } from '../scene/Cabinet';
import { ClawVisual } from '../scene/ClawVisual';
import { Effects } from '../scene/Effects';
import { CabinetMaterials } from '../scene/materials';
import { Stage } from '../scene/Stage';
import { ToyVisuals } from '../scene/ToyVisuals';
import { diffSettings, type AiSettings, type CameraSettings, type GraphicsSettings, type Settings, type ViewSettings } from '../settings/spec';
import type { SettingsStore } from '../settings/store';
import { themeOf } from '../themes/themes';
import { AdaptiveQuality } from './AdaptiveQuality';
import { DemoPilot } from './DemoPilot';
import type { GameStore, PerfSnapshot } from './gameStore';

export interface PhysicalWindow {
  widthM: number;
  heightM: number;
  centerOffsetM: [number, number];
}

export type ConfigurableGuide = GuidePort & {
  configure(cfg: { settings: AiSettings; uiLang: Lang; themeId: ThemeId; themeVersion: number; voiceVolume?: number }): void;
};
export type ConfigurableTracker = TrackerPort & {
  configure(cfg: { camera: CameraSettings; view: ViewSettings; window: PhysicalWindow }): void;
};

export interface LaunchParams {
  display: DisplayProfileId | null;
  theme: ThemeId | null;
  lang: Lang | null;
  quality: 'safe' | 'medium' | 'high' | 'ultra' | null;
  /** Deterministic toy layout (tests). */
  seed: number | null;
  /** Exposes `window.__plush` for automated tests and tuning. */
  debug: boolean;
  /** Never ask for the camera (tests / kiosks without one). */
  noCamera: boolean;
}

export interface GameDeps {
  canvas: HTMLCanvasElement;
  settings: SettingsStore;
  collection: CollectionStore;
  ui: GameStore;
  audio: AudioPort;
  guide: ConfigurableGuide;
  tracker: ConfigurableTracker;
  launch: LaunchParams;
  /** CSS font-family used for text drawn into textures. */
  font: string;
}

type PauseReason = 'modal' | 'hidden' | 'context' | 'boot' | 'theme';

const _v = new Vector3();
const _eye: Vec3 = [0, 0, 1];
const _eyeWorld: Vec3 = [0, 0, 1];
const FRAME_SAMPLES = 180;

/**
 * Composition root of the running game: owns the authoritative simulation
 * (GameCore), the renderer and scene objects, and connects them to audio, the
 * AI guide, head tracking, settings and the UI store.
 */
export class Game {
  readonly library = new PlushLibrary();
  core!: GameCore;
  stage!: Stage;
  private materials: CabinetMaterials | null = null;
  private cabinet: Cabinet | null = null;
  private clawVisual: ClawVisual | null = null;
  private toyVisuals!: ToyVisuals;
  private effects!: Effects;
  private readonly stepper = new FixedStepper(FIXED_DT, 5);
  private readonly adaptive = new AdaptiveQuality();
  private readonly pilot = new DemoPilot();
  private readonly pauseReasons = new Set<PauseReason>(['boot']);
  private raf = 0;
  private lastFrame = 0;
  private lastRender = 0;
  private running = false;
  private time = 0;
  private layout!: WindowLayout;
  hud!: HudLayout;
  private profile: DisplayProfileId;
  private themeId: ThemeId;
  private themeVersion = 0;
  /** Settings applied to the running game (live values follow the draft while the dialog is open). */
  private applied: Settings;
  private committed: Settings;
  private pendingRebuild = false;
  private pendingLayout = false;
  private layoutTimer = 0;
  private readonly frameImpacts: ImpactEvent[] = [];
  private readonly frameTimes = new Float32Array(FRAME_SAMPLES);
  private frameCursor = 0;
  private frameCount = 0;
  private perfTimer = 0;
  private physicsMsAcc = 0;
  private stepsAcc = 0;
  private framesAcc = 0;
  private idleTime = 0;
  private attractTime = 0;
  private lossStreak = 0;
  private lastHintAt = -99;
  private restockTimer = 0;
  private restockQueue = 0;
  private resultTimer = 0;
  private retryPrompted = false;
  private celebrate = 0;
  private toastId = 0;
  private lastImpactSfx = 0;
  private tickTimer = 0.14;
  private firstStart = true;
  private disposed = false;
  private readonly offs: (() => void)[] = [];
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private thumbnailJob: Promise<void> | null = null;
  /** Latched keyboard / button directions. */
  private readonly dir = { left: false, right: false, back: false, front: false };

  constructor(private readonly deps: GameDeps) {
    const view = deps.settings.getState().view();
    this.applied = view;
    this.committed = deps.settings.getState().settings;
    this.profile = deps.ui.getState().profile;
    this.themeId = this.committed.themes.current;
  }

  /* ------------------------------------------------------------------ boot */

  private setBoot(progress: number, label: string): void {
    this.deps.ui.setState({ boot: { stage: 'loading', progress, label, error: null } });
  }

  async init(): Promise<void> {
    const { ui, settings, canvas } = this.deps;
    try {
      this.setBoot(0.05, 'physics');
      await initRapier();
      this.setBoot(0.15, 'assets');
      await this.library.loadManifest();
      const s = this.committed;
      this.stage = new Stage(canvas, this.effectiveGraphics().graphics);
      this.stage.onContextLost = () => {
        this.setPaused('context', true);
        ui.setState({ webglLost: true });
        log('warn', 'render', 'WebGL context lost');
      };
      this.stage.onContextRestored = () => {
        ui.setState({ webglLost: false });
        log('info', 'render', 'WebGL context restored');
        this.rebuildScene(true);
        this.setPaused('context', false);
      };
      this.toyVisuals = new ToyVisuals(this.library, { lod: s.graphics.lod, fur: s.graphics.fur, deform: s.graphics.deform });
      this.effects = new Effects();
      this.stage.scene.add(this.toyVisuals.group, this.effects.group);

      this.measure();
      this.core = new GameCore({
        binFloorY: this.layout.binFloorY,
        toyFriction: s.gameplay.toyFriction,
        params: this.roundParams(s),
        field: this.fieldOptions(s),
        themeId: this.themeId,
      });
      this.bindCore();

      await this.loadTheme(this.themeId, (p) => this.setBoot(0.2 + 0.55 * p, 'toys'));
      this.setBoot(0.8, 'scene');
      this.rebuildScene(false);
      this.populate();
      this.setBoot(0.9, 'shaders');
      this.syncSettingsToPorts(null, this.applied);
      this.updateEye(performance.now(), 0);
      await this.stage.warmUp();
      this.setBoot(1, 'ready');

      this.offs.push(settings.subscribe(() => this.onSettingsChanged()));
      this.offs.push(this.deps.tracker.subscribe((status) => ui.setState({ tracker: status })));
      this.offs.push(this.deps.audio.subscribe((status) => ui.setState({ audio: status })));
      this.offs.push(this.deps.guide.subscribe((line, status) => ui.setState({ guideLine: line, guideStatus: status })));
      window.addEventListener('resize', this.onResize);
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('blur', this.onBlur);

      ui.setState({ boot: { stage: 'ready', progress: 1, label: 'ready', error: null }, warnings: [...this.library.warnings], themeId: this.themeId });
      this.setPaused('boot', false);
      this.start();
      this.emitGuide('welcome');
      this.queueThumbnails();
      if (this.deps.launch.debug) this.installDebugApi();
    } catch (error) {
      logError('boot', error);
      ui.setState({ boot: { stage: 'error', progress: 0, label: 'error', error: error instanceof Error ? error.message : String(error) } });
    }
  }

  private roundParams(s: Settings): RoundParams {
    const g = s.gameplay;
    return {
      moveSpeed: g.moveSpeed,
      moveAccel: g.moveAccel,
      descendSpeed: g.descendSpeed,
      liftSpeed: g.liftSpeed,
      clawForce: g.clawForce,
      closeSpeed: g.closeSpeed,
      ropeSwing: g.ropeSwing,
      gripAssist: g.gripAssist,
      aimTimeLimit: g.aimTimeLimit,
    };
  }

  private fieldOptions(s: Settings) {
    return {
      count: s.gameplay.toyCount,
      scale: s.themes.toyScale,
      density: s.themes.stackDensity,
      massScale: s.gameplay.toyMass,
      seed: this.deps.launch.seed ?? (Date.now() & 0xffff),
    };
  }

  private enabledAssets(): PlushAsset[] {
    const disabled = new Set(this.committed.themes.disabledToys);
    const all = this.library.assets(this.themeId);
    const enabled = all.filter((a) => !disabled.has(a.id));
    // Never leave the machine empty: if everything was switched off, use the whole theme.
    return enabled.length > 0 ? enabled : all;
  }

  private async loadTheme(themeId: ThemeId, onProgress?: (p: number) => void): Promise<void> {
    this.library.setCustomModels(this.committed.themes.customModels);
    await this.library.loadTheme(themeId, (done, total) => onProgress?.(done / Math.max(1, total)));
    for (const warning of this.library.warnings) log('warn', 'assets', warning);
    for (const note of this.library.notes) log('info', 'assets', note);
  }

  /** (Re)creates everything that depends on the theme or the window layout. */
  private rebuildScene(afterContextLoss: boolean): void {
    const theme = themeOf(this.themeId);
    const g = this.applied.graphics;
    if (!this.materials || this.materials.theme !== theme || afterContextLoss) {
      this.clawVisual?.dispose();
      this.clawVisual = null;
      this.materials?.dispose();
      this.materials = new CabinetMaterials(theme, g.textures, this.deps.font);
      this.materials.setGlassQuality(this.effectiveGraphics().graphics.glass);
      this.stage.setTheme(theme);
      this.effects.setTheme(theme);
    }
    this.cabinet?.dispose();
    this.cabinet = new Cabinet(this.layout, theme, this.materials);
    this.cabinet.group.traverse((o) => {
      const mat = (o as { material?: unknown }).material;
      if (mat === this.materials!.glass || mat === this.materials!.acrylic) o.userData.skipAO = true;
    });
    this.stage.scene.add(this.cabinet.group);
    if (!this.clawVisual) {
      this.clawVisual = new ClawVisual(this.core.claw, this.materials);
      this.stage.scene.add(this.clawVisual.group);
    }
    this.stage.setLayout(this.layout);
    this.toyVisuals.setDisplay(this.cabinet.displaySlots, this.library.assets(this.themeId));
    this.stage.requestEnvironmentRefresh();
    this.pendingLayout = false;
  }

  /** Fills the play field and settles it without rendering (nothing pops into place on screen). */
  private populate(): void {
    this.core.field.setOptions(this.fieldOptions(this.committed));
    this.core.populate(this.enabledAssets(), this.deps.launch.seed ?? undefined);
    this.toyVisuals.sync(this.core.phys.toys.values());
    this.restockQueue = 0;
  }

  /* --------------------------------------------------------------- layout */

  private measure(): void {
    const canvas = this.deps.canvas;
    const env = readWindowEnvironment(canvas);
    const profile = this.applied.profiles[this.profile];
    this.hud = solveLayout(this.profile, profile.layout, env.viewportW, env.viewportH);
    this.layout = computeWindowLayout(env, profile.view, this.hud.floorY);
    if (this.stage) {
      this.stage.resize(env.viewportW, env.viewportH, window.devicePixelRatio || 1);
      this.effects.setViewportHeight(this.stage.effective.height);
      this.stage.camera.setWindow(0, this.layout.centerY, 0, this.layout.width, this.layout.height);
    }
  }

  private onResize = (): void => {
    const before = this.layout;
    this.measure();
    this.configureTracker();
    // The projection follows immediately; the cabinet shell is rebuilt once the size settles.
    if (!before || Math.abs(before.width - this.layout.width) > 1e-3 || Math.abs(before.top - this.layout.top) > 1e-3 || Math.abs(before.bottom - this.layout.bottom) > 1e-3) {
      this.pendingLayout = true;
      this.layoutTimer = 0.25;
    }
  };

  private applyPendingLayout(): void {
    if (!this.pendingLayout || this.core.machine.busy) return;
    this.core.phys.setBinFloor(this.layout.binFloorY);
    this.rebuildScene(false);
  }

  /* ---------------------------------------------------------------- pause */

  setPaused(reason: PauseReason, paused: boolean): void {
    const was = this.pauseReasons.size > 0;
    if (paused) this.pauseReasons.add(reason);
    else this.pauseReasons.delete(reason);
    const now = this.pauseReasons.size > 0;
    if (was === now) return;
    this.clearDirections();
    // Never simulate the time that passed while paused.
    this.stepper.reset();
    this.lastFrame = performance.now();
    this.deps.ui.setState({ paused: now });
    const hidden = this.pauseReasons.has('hidden');
    this.deps.guide.setPaused(now);
    if (now) {
      this.deps.audio.setLoop('motor_trolley', 0);
      this.deps.audio.setLoop('motor_winch', 0);
    }
    if (hidden) this.deps.audio.suspend();
    else this.deps.audio.resume();
  }

  get paused(): boolean {
    return this.pauseReasons.size > 0;
  }

  private onVisibility = (): void => {
    const hidden = document.visibilityState === 'hidden';
    this.setPaused('hidden', hidden);
    this.deps.tracker.setPaused(hidden);
    if (hidden) this.deps.guide.silence();
  };

  private onBlur = (): void => {
    this.clearDirections();
  };

  /** A dialog opened or closed. Rounds, physics and the aim timer are frozen while one is open. */
  setModalOpen(open: boolean): void {
    this.setPaused('modal', open);
    if (open) this.deps.guide.silence();
  }

  /* ---------------------------------------------------------------- input */

  setDirection(direction: 'left' | 'right' | 'back' | 'front', pressed: boolean): void {
    if (this.paused && pressed) return;
    if (this.dir[direction] === pressed) return;
    this.dir[direction] = pressed;
    if (pressed) {
      this.touchActivity();
      const phase = this.core.machine.phase;
      if (phase === 'READY' || phase === 'AIMING') this.deps.audio.playSfx('dir_press');
    }
    this.pushInput();
  }

  clearDirections(): void {
    this.dir.left = this.dir.right = this.dir.back = this.dir.front = false;
    if (this.core) this.core.controller.clearInput();
  }

  private pushInput(): void {
    const c = this.core.controller;
    if (this.core.machine.demo) return;
    c.inputX = (this.dir.right ? 1 : 0) - (this.dir.left ? 1 : 0);
    // "Up" on the pad moves the claw towards the back of the cabinet (−Z), "down" towards the glass.
    c.inputZ = (this.dir.front ? 1 : 0) - (this.dir.back ? 1 : 0);
  }

  /** Start button / first tap: leaves attract mode, unlocks audio and (once) starts head tracking. */
  pressStart(): void {
    if (this.paused) return;
    this.touchActivity();
    const m = this.core.machine;
    void this.deps.audio.unlock();
    if (this.firstStart) {
      this.firstStart = false;
      this.deps.audio.setTheme(this.themeId, { immediate: true });
      if (this.applied.camera.enabled && !this.deps.launch.noCamera) void this.deps.tracker.start();
    }
    if (m.demo && m.phase !== 'ATTRACT') {
      // A player takes over from the demo: drop the demo round and start a real one.
      this.core.controller.resetRound('player_took_over', 'READY');
      this.afterRoundBoundary();
    } else if (m.phase === 'ATTRACT') {
      m.start(false);
    } else return;
    this.deps.audio.playSfx('start_game');
    if (!this.deps.ui.getState().firstPlayDone) {
      this.deps.ui.setState({ firstPlayDone: true });
      this.emitGuide('first_play');
    }
  }

  grab(): boolean {
    if (this.paused || this.core.machine.demo) return false;
    this.touchActivity();
    const ok = this.core.controller.requestGrab();
    this.deps.audio.playSfx(ok ? 'grab_confirm' : 'ui_error');
    return ok;
  }

  /** "Play again" after a result (also used by the auto-advance after a miss). */
  playAgain(): void {
    if (this.paused) return;
    this.touchActivity();
    const m = this.core.machine;
    if (m.phase !== 'RESULT') return;
    this.deps.ui.setState({ result: null, prize: null });
    m.next(false);
  }

  /** Abandons the current round and puts the claw back (Settings → Gameplay → restart round). */
  restartRound(): void {
    this.core.controller.resetRound('manual_restart', this.core.machine.phase === 'ATTRACT' ? 'ATTRACT' : 'READY');
    this.deps.ui.setState({ result: null, prize: null });
    this.afterRoundBoundary();
  }

  /** Rebuilds the toy layout now (only between rounds; otherwise it is queued). */
  rebuildToys(): void {
    if (this.core.machine.busy) {
      this.pendingRebuild = true;
      this.deps.ui.setState({ pendingChange: true });
      return;
    }
    this.populate();
    this.toast('toast.layoutRebuilt');
  }

  restockNow(): void {
    this.restockQueue = this.core.field.missing();
  }

  requestTip(): void {
    this.emitGuide('user_requested_tip');
  }

  private touchActivity(): void {
    this.idleTime = 0;
    this.attractTime = 0;
  }

  /* ---------------------------------------------------------------- rounds */

  private bindCore(): void {
    const { machine, controller } = this.core;
    const { ui, audio } = this.deps;
    machine.events.on('phase', (e) => {
      ui.setState({ phase: e.phase, roundId: e.roundId, demo: e.demo, aimSecondsLeft: -1 });
      if (this.applied.system.verboseLog) log('info', 'round', `${e.prev} → ${e.phase} (round ${e.roundId}${e.demo ? ', demo' : ''})`);
      if (e.phase === 'READY') this.afterRoundBoundary();
      if (e.phase === 'ATTRACT') {
        this.attractTime = 0;
        this.afterRoundBoundary();
      }
      if (e.phase === 'DESCENDING') {
        audio.playSfx('claw_descend');
        this.deps.guide.invalidateBefore(e.roundId);
        if (!e.demo) this.deps.collection.getState().recordAttempt();
      }
      if (e.phase === 'CLOSING') audio.playSfx('claw_close');
      if (e.phase === 'RELEASING') audio.playSfx('claw_open', { volume: 0.8 });
      if (e.phase === 'RESULT') this.resultTimer = 0;
      this.toyVisuals.focus = null;
    });
    machine.events.on('result', (result) => {
      if (this.applied.system.verboseLog) {
        log('info', 'round', `round ${result.roundId}: ${result.outcome} (contact ${result.contact}, grip ${result.gripQuality}${result.slipReason ? `, ${result.slipReason}` : ''})`);
      }
      this.onResult(result);
    });
    machine.events.on('award', (award) => {
      if (award.demo) return;
      const added = this.deps.collection.getState().addPrize(award.typeId, award.prizeId);
      if (added) ui.setState({ prize: { typeId: award.typeId, isNew: added.isNew, count: added.count } });
    });
    machine.events.on('abort', (e) => log('info', 'round', `round ${e.roundId} aborted: ${e.reason}`));
    controller.events.on('recovered', (e) => log('warn', 'round', `watchdog forced ${e.phase} in round ${e.roundId}`));
    controller.events.on('clawTouch', (e) => audio.playSfx('claw_touch', { volume: e.onToy ? 0.9 : 0.6 }));
    controller.events.on('gripEvaluated', (e) => {
      if (e.toy) {
        audio.playSfx('plush_rub', { volume: 0.5 + 0.4 * (e.facts?.quality ?? 0) });
        this.toyVisuals.focus = e.toy;
      }
    });
    controller.events.on('slipped', () => audio.playSfx('slip'));
    controller.events.on('prizeDetected', () => {
      audio.playSfx('chute_drop');
      this.celebrate = 1;
    });
    controller.events.on('aimTick', (e) => {
      ui.setState({ aimSecondsLeft: e.secondsLeft });
      if (e.secondsLeft <= 3 && e.secondsLeft > 0) audio.playSfx('countdown_tick');
    });
    controller.events.on('grabStarted', () => {
      if (!machine.demo && this.lossStreak === 0 && machine.roundId % 4 === 2) this.emitGuide('grab_started');
    });
  }

  private onResult(result: RoundResult): void {
    const { ui, audio } = this.deps;
    ui.setState({ result });
    this.retryPrompted = false;
    if (result.demo) return;
    if (result.outcome === 'won') {
      this.lossStreak = 0;
      audio.playSfx('win');
      const prize = ui.getState().prize;
      if (prize?.isNew) audio.playSfx('collect_unlock', { delay: 0.9 });
      const toy = result.targetToyId ? this.core.phys.toys.get(result.targetToyId) : undefined;
      if (toy && this.toyVisuals.positionOf(toy, _v)) this.effects.burst(_v.setY(_v.y + 0.1), 1);
      this.emitGuide('prize_won', result);
    } else if (result.outcome === 'slipped') {
      this.lossStreak++;
      this.emitGuide('slipped_after_grip', result);
    } else {
      this.lossStreak++;
      audio.playSfx('empty_grab');
      this.emitGuide('empty_grab', result);
    }
  }

  /** Runs whenever a round boundary is reached: queued changes, bin clearing, restocking. */
  private afterRoundBoundary(): void {
    const { field, controller } = this.core;
    // Collect the prize and return toys that fell in by accident.
    const removed = field.clearBin();
    if (removed.length > 0) controller.forgetStrays();
    this.toyVisuals.heldToy = null;
    if (this.pendingRebuild) {
      this.pendingRebuild = false;
      void this.applyQueuedRebuild();
    } else {
      const mode = this.committed.gameplay.restock;
      const missing = field.missing();
      if (mode === 'afterWin') this.restockQueue = missing;
      else if (mode === 'whenLow' && field.onField().length <= Math.ceil(this.committed.gameplay.toyCount * 0.6)) this.restockQueue = missing;
    }
    this.applyPendingLayout();
    this.toyVisuals.sync(this.core.phys.toys.values());
    if (this.applied.graphics.reflections !== 'static') this.stage.requestEnvironmentRefresh();
    this.deps.ui.setState({ pendingChange: this.pendingRebuild });
  }

  /** Applies theme / toy changes that were waiting for the round to end. */
  private async applyQueuedRebuild(): Promise<void> {
    const next = this.committed.themes.current;
    const { ui } = this.deps;
    if (next !== this.themeId) {
      ui.setState({ themeBusy: true });
      this.setPaused('theme', true);
      try {
        await this.loadTheme(next);
        this.core.phys.removeAllToys();
        this.toyVisuals.clear();
        this.themeId = next;
        this.themeVersion++;
        this.core.themeId = next;
        this.library.releaseExcept(next);
        this.rebuildScene(false);
        this.deps.audio.setTheme(next);
        this.deps.audio.playSfx('theme_sting');
        this.populate();
        ui.setState({ themeId: next });
        this.syncSettingsToPorts(null, this.applied);
        this.emitGuide('theme_changed');
        this.queueThumbnails();
        await this.stage.warmUp();
      } catch (error) {
        logError('theme', error);
        this.toast('toast.themeFailed');
      } finally {
        ui.setState({ themeBusy: false, pendingChange: false });
        this.setPaused('theme', false);
      }
      return;
    }
    // Same theme: toy selection, size, count or imported models changed.
    const before = new Map(this.library.assets(this.themeId).map((a) => [a.id, this.library.customEntry(a.id)?.fileKey]));
    try {
      await this.loadTheme(this.themeId);
    } catch (error) {
      logError('assets', error);
    }
    const stale = this.library.assets(this.themeId).filter((a) => before.get(a.id) !== this.library.customEntry(a.id)?.fileKey);
    this.core.phys.removeAllToys();
    this.toyVisuals.clear();
    this.populate();
    if (this.cabinet) this.toyVisuals.setDisplay(this.cabinet.displaySlots, this.library.assets(this.themeId));
    if (stale.length > 0) {
      const thumbnails = { ...ui.getState().thumbnails };
      for (const a of stale) delete thumbnails[a.id];
      ui.setState({ thumbnails });
      this.queueThumbnails();
    }
    ui.setState({ pendingChange: false, warnings: [...this.library.warnings] });
  }

  private stepRestock(dt: number): void {
    if (this.restockQueue <= 0) {
      if (this.deps.ui.getState().restocking) this.deps.ui.setState({ restocking: false });
      return;
    }
    const phase = this.core.machine.phase;
    if (phase !== 'READY' && phase !== 'AIMING' && phase !== 'ATTRACT') return;
    this.restockTimer -= dt;
    if (this.restockTimer > 0) return;
    this.restockTimer = 0.42;
    const toy = this.core.field.restockOne();
    if (!toy) {
      this.restockQueue = 0;
      return;
    }
    this.restockQueue--;
    this.toyVisuals.sync(this.core.phys.toys.values(), true);
    this.deps.audio.playSfx('restock_drop', { volume: 0.7 });
    if (!this.deps.ui.getState().restocking) this.deps.ui.setState({ restocking: true });
  }

  /* ---------------------------------------------------------------- guide */

  private facts(result?: RoundResult): GuideFacts {
    const { machine } = this.core;
    const collection = this.deps.collection.getState();
    const facts: GuideFacts = {
      phase: machine.phase,
      demo: machine.demo,
      attempts: collection.attempts,
      wins: collection.wins,
      lossStreak: this.lossStreak,
      headTracking: this.deps.ui.getState().tracker.state === 'tracking',
    };
    if (result) {
      facts.outcome = result.outcome;
      facts.contact = result.contact;
      facts.slipReason = result.slipReason;
      facts.liftedMs = result.liftedMs;
      const lang = this.language();
      const asset = result.targetTypeId ? this.library.assets().find((a) => a.id === result.targetTypeId) : undefined;
      facts.toy = asset ? { typeId: asset.id, name: asset.name[lang], kind: asset.kind[lang] } : null;
      if (result.nearest) {
        const near = this.library.assets().find((a) => a.id === result.nearest!.typeId);
        facts.nearest = { dx: result.nearest.dx, dz: result.nearest.dz, dist: result.nearest.dist, name: near ? near.name[lang] : '' };
      }
      facts.newCharacter = this.deps.ui.getState().prize?.isNew ?? false;
    }
    return facts;
  }

  private emitGuide(type: GuideEventType, result?: RoundResult): void {
    if (!this.applied.ai.enabled) return;
    const event: GuideEvent = { type, roundId: this.core.machine.roundId, themeId: this.themeId, facts: this.facts(result) };
    try {
      this.deps.guide.handle(event);
    } catch (error) {
      logError('guide', error);
    }
  }

  private language(): Lang {
    return this.applied.system.language;
  }

  /* ------------------------------------------------------------- settings */

  private effectiveGraphics(): { graphics: GraphicsSettings; scale: number; reductions: string[] } {
    const user = this.applied.graphics;
    this.adaptive.enabled = user.autoOptimize;
    return this.adaptive.apply(user);
  }

  private applyGraphicsNow(): void {
    const { graphics, scale, reductions } = this.effectiveGraphics();
    this.stage.applyGraphics(graphics);
    this.stage.setAutoScale(scale);
    this.materials?.setGlassQuality(graphics.glass);
    this.effects.setBudget(graphics.particles);
    this.effects.setViewportHeight(this.stage.effective.height);
    this.toyVisuals.setQuality({ lod: graphics.lod, fur: graphics.fur, deform: graphics.deform });
    this.deps.ui.setState({ effective: { ...this.stage.effective }, autoReductions: reductions });
  }

  private configureTracker(): void {
    const view = this.applied.profiles[this.profile].view;
    this.deps.tracker.configure({
      camera: this.applied.camera,
      view,
      window: { widthM: this.layout.physWidth, heightM: this.layout.physHeight, centerOffsetM: [this.layout.physOffsetX, this.layout.physOffsetY] },
    });
  }

  /** Pushes settings into the subsystems. `prev` = null applies everything. */
  private syncSettingsToPorts(prev: Settings | null, next: Settings): void {
    const changed = prev ? new Set(diffSettings(prev, next)) : null;
    const touched = (prefix: string) => !changed || [...changed].some((p) => p.startsWith(prefix));
    const { audio, guide, tracker } = this.deps;
    if (touched('audio.')) {
      const a = next.audio;
      audio.setVolumes({ master: a.master, music: a.music, sfx: a.sfx, voice: a.voice, muted: a.muted, ducking: a.ducking });
      audio.setMusicTrack(a.track);
      if (!prev || prev.audio.outputDevice !== a.outputDevice) {
        if (a.outputDevice || prev) void audio.setOutputDevice(a.outputDevice);
      }
    }
    if (touched('ai.') || touched('system.language') || touched('audio.') || !prev) {
      guide.configure({
        settings: next.ai,
        uiLang: next.system.language,
        themeId: this.themeId,
        themeVersion: this.themeVersion,
        voiceVolume: next.audio.muted ? 0 : next.audio.master * next.audio.voice,
      });
      if (prev && prev.ai.enabled && !next.ai.enabled) guide.silence();
    }
    if (touched('camera.') || touched('profiles.') || touched('display.') || !prev) {
      this.configureTracker();
      if (prev && prev.camera.enabled !== next.camera.enabled) {
        if (next.camera.enabled && !this.firstStart && !this.deps.launch.noCamera) void tracker.start();
        if (!next.camera.enabled) tracker.stop();
      }
    }
    if (touched('graphics.') && this.stage) {
      if (changed && prev && diffSettings({ ...prev, graphics: next.graphics } as Settings, prev).some((p) => p !== 'graphics.perfPanel')) this.adaptive.clear();
      this.applyGraphicsNow();
      if (prev && prev.graphics.textures !== next.graphics.textures) {
        // New texture tier: rebuild the theme materials (no physics involved).
        this.materials?.dispose();
        this.materials = null;
        this.clawVisual?.dispose();
        this.clawVisual = null;
        this.rebuildScene(false);
      }
    }
    if (touched('gameplay.')) {
      this.effects.showReticle = next.gameplay.aimReticle;
      this.effects.showBeam = next.gameplay.aimBeam;
    }
    this.effects.reducedMotion = this.toyVisuals.reducedMotion = this.reducedMotion(next);
  }

  private reducedMotion(s: Settings): boolean {
    if (s.system.reducedMotion === 'on') return true;
    if (s.system.reducedMotion === 'off') return false;
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private onSettingsChanged(): void {
    const state = this.deps.settings.getState();
    const view = state.view();
    const committed = state.settings;
    const prevApplied = this.applied;
    const prevCommitted = this.committed;
    this.applied = view;
    this.committed = committed;

    // Display preset: applied values only (a preview would move the dialog under the player's finger).
    const wantProfile = (committed.display.profile || this.profile) as DisplayProfileId;
    if (wantProfile !== this.profile) {
      this.profile = wantProfile;
      this.deps.ui.setState({ profile: wantProfile, profileChosen: true });
      this.onResize();
    } else if (diffSettings(prevApplied, view).some((p) => p.startsWith(`profiles.${this.profile}.`))) {
      this.onResize();
    }

    // Live values follow the draft; they are previewed immediately.
    this.syncSettingsToPorts(prevApplied, view);

    // Authoritative gameplay / scene values only ever come from applied settings.
    const committedDiff = diffSettings(prevCommitted, committed);
    if (committedDiff.length === 0) return;
    if (committedDiff.some((p) => p.startsWith('gameplay.'))) {
      this.core.controller.setParams(this.roundParams(committed));
      this.core.phys.setToyFriction(committed.gameplay.toyFriction);
    }
    const rebuild = committedDiff.some(
      (p) => p.startsWith('themes.') || p === 'gameplay.toyCount' || p === 'gameplay.toyMass',
    );
    if (rebuild) {
      this.pendingRebuild = true;
      if (this.core.machine.atRoundBoundary && this.core.machine.phase !== 'RESULT') {
        this.pendingRebuild = false;
        void this.applyQueuedRebuild();
      } else this.deps.ui.setState({ pendingChange: true });
    }
  }

  /** Chooses a display preset (first-run chooser, launch parameter or settings). */
  chooseProfile(id: DisplayProfileId): void {
    this.deps.settings.getState().set('display.profile', id);
    if (this.deps.settings.getState().draft === null) return;
    // While the dialog is open the choice is applied right away as well: layouts are safe to preview.
    this.profile = id;
    this.deps.ui.setState({ profile: id, profileChosen: true });
    this.onResize();
  }

  toast(key: string, params?: Record<string, string | number>): void {
    this.deps.ui.setState({ toast: { id: ++this.toastId, key, params } });
  }

  /* ----------------------------------------------------------------- loop */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.lastRender = this.lastFrame;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    // Frame limiter for the 30 fps target.
    const target = Number(this.applied.graphics.targetFps);
    if (target <= 30 && now - this.lastRender < 1000 / target - 3) return;
    const frameMs = now - this.lastFrame;
    this.lastFrame = now;
    this.lastRender = now;
    const dt = Math.min(Math.max(frameMs / 1000, 0), 0.25);
    try {
      this.update(now, dt);
    } catch (error) {
      this.recover(error);
    }
    this.recordPerf(frameMs, dt, target);
  };

  private recover(error: unknown): void {
    logError('loop', error);
    // Put the machine back into a known state instead of freezing on a broken frame.
    try {
      this.core.controller.resetRound('error_recovery', this.core.machine.phase === 'ATTRACT' ? 'ATTRACT' : 'READY');
      this.deps.ui.setState({ result: null, prize: null });
      this.toast('toast.recovered');
    } catch (inner) {
      logError('loop', inner);
    }
  }

  private update(now: number, dt: number): void {
    const { core, stage } = this;
    const paused = this.paused;
    let steps = 0;
    this.frameImpacts.length = 0;
    if (!paused) {
      this.time += dt;
      steps = this.stepper.advance(dt);
      const t0 = performance.now();
      for (let i = 0; i < steps; i++) {
        if (core.machine.demo) this.pilot.update(core, FIXED_DT);
        core.fixedStep();
        for (const impact of core.phys.impacts) this.frameImpacts.push({ ...impact });
        this.stepRestock(FIXED_DT);
      }
      this.physicsMsAcc += performance.now() - t0;
      this.stepsAcc += steps;
      this.updateFlow(dt);
      this.updateAudio(dt);
    }
    if (this.pendingLayout && (this.layoutTimer -= dt) <= 0) this.applyPendingLayout();

    const alpha = paused ? 1 : this.stepper.alpha;
    const grip = core.grip;
    this.toyVisuals.heldToy = grip.holding() ? grip.target : null;
    if (this.toyVisuals.heldToy) core.claw.gripCenter(_v);
    this.toyVisuals.update(alpha, paused ? 0 : dt, paused ? [] : grip.contacts, this.frameImpacts, FIXED_DT);
    if (this.toyVisuals.heldToy) this.updateGripLocal(this.toyVisuals.heldToy);
    this.clawVisual?.update(alpha);
    this.updateAim();
    this.celebrate = Math.max(0, this.celebrate - dt * 0.45);
    this.materials?.updateLeds(this.time, this.celebrate, this.effects.reducedMotion);
    this.effects.update(paused ? 0 : dt);
    this.updateEye(now, dt);
    stage.render(dt);
  }

  private updateGripLocal(toy: ToyBody): void {
    // Where the claw holds the toy, in the toy's local frame (for the hanging sag).
    this.core.claw.gripCenter(_v);
    const p = toy.pose.pos, r = toy.pose.rot;
    const x = _v.x - p[0]!, y = _v.y - p[1]!, z = _v.z - p[2]!;
    // Rotate by the inverse quaternion.
    const qx = -r[0]!, qy = -r[1]!, qz = -r[2]!, qw = r[3]!;
    const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
    this.toyVisuals.gripLocal.set(
      (ix * qw + iw * -qx + iy * -qz - iz * -qy) / toy.scale,
      (iy * qw + iw * -qy + iz * -qx - ix * -qz) / toy.scale,
      (iz * qw + iw * -qz + ix * -qy - iy * -qx) / toy.scale,
    );
  }

  /** Non-physical round flow: idle handling, attract demo, auto-advance after a miss. */
  private updateFlow(dt: number): void {
    const m = this.core.machine;
    const s = this.applied;
    this.idleTime += dt;
    switch (m.phase) {
      case 'ATTRACT':
        this.attractTime += dt;
        if (s.system.attractDemo && this.attractTime > 6 && !this.firstStart) {
          this.pilot.reset();
          m.start(true);
        } else if (s.system.attractDemo && this.attractTime > 9) {
          this.pilot.reset();
          m.start(true);
        }
        break;
      case 'READY':
      case 'AIMING':
        if (m.demo) break;
        if (this.idleTime > s.system.attractIdleSec) {
          this.clearDirections();
          m.toAttract();
          this.deps.ui.setState({ result: null, prize: null });
        } else if (this.idleTime > 12 && this.time - this.lastHintAt > 25) {
          this.lastHintAt = this.time;
          this.emitGuide(this.lossStreak >= 2 ? 'aim_help' : 'idle_hint');
        }
        break;
      case 'RESULT': {
        this.resultTimer += dt;
        const result = this.deps.ui.getState().result;
        if (m.demo) {
          if (this.resultTimer > 2.2) {
            this.deps.ui.setState({ result: null, prize: null });
            m.toAttract();
          }
        } else if (result && result.outcome !== 'won') {
          // A miss never blocks: the next round is ready almost immediately.
          if (this.resultTimer > 1.15) this.playAgain();
        } else if (!this.retryPrompted && this.resultTimer > 7) {
          this.retryPrompted = true;
          this.emitGuide('retry_prompt');
        } else if (this.resultTimer > s.system.attractIdleSec) {
          this.deps.ui.setState({ result: null, prize: null });
          m.toAttract();
        }
        break;
      }
      default:
        this.idleTime = 0;
    }
  }

  private updateAudio(dt: number): void {
    const { audio } = this.deps;
    const claw = this.core.claw;
    const speed = Math.hypot(claw.trolleyVX, claw.trolleyVZ);
    const max = Math.max(0.1, this.core.controller.activeParams.moveSpeed);
    audio.setLoop('motor_trolley', Math.min(1, speed / max), 0.85 + 0.3 * Math.min(1, speed / max));
    const winch = Math.abs(claw.ropeSpeed) / Math.max(0.1, this.core.controller.activeParams.descendSpeed);
    audio.setLoop('motor_winch', Math.min(1, winch), claw.ropeSpeed < 0 ? 1.12 : 0.94);
    // Light ticking while a direction is held and the trolley is really travelling.
    const c = this.core.controller;
    const phase = this.core.machine.phase;
    const steering = !this.core.machine.demo && (phase === 'AIMING' || phase === 'READY') && Math.abs(c.inputX) + Math.abs(c.inputZ) > 0 && speed > 0.05;
    if (steering) {
      this.tickTimer -= dt;
      if (this.tickTimer <= 0) {
        this.tickTimer = 0.26;
        audio.playSfx('dir_tick', { volume: 0.4 });
      }
    } else this.tickTimer = 0.14;
    // Soft landings and glass taps, rate limited so a pile settling is not a drum roll.
    this.lastImpactSfx -= dt;
    if (this.lastImpactSfx > 0) return;
    let best: ImpactEvent | null = null;
    for (const impact of this.frameImpacts) if (!best || impact.strength > best.strength) best = impact;
    if (!best || best.strength < 0.7) return;
    this.lastImpactSfx = 0.09;
    const volume = Math.min(1, 0.25 + best.strength * 0.22);
    const pan = Math.max(-1, Math.min(1, best.toy.pose.pos[0]! * 1.6));
    let name: SfxName = 'plush_land';
    if (best.against === 'glass') name = 'glass_tap';
    else if (best.against === 'bin') name = 'prize_out';
    audio.playSfx(name, { volume, pan, pitch: 1.08 - Math.min(0.2, best.toy.mass * 0.4) });
  }

  private updateAim(): void {
    const m = this.core.machine;
    const visible = (m.phase === 'READY' || m.phase === 'AIMING') && !this.core.machine.demo ? true : m.phase === 'READY' || m.phase === 'AIMING';
    if (!visible) {
      this.effects.setAim(false, 0, 0, 0, 0);
      return;
    }
    const hub = this.core.claw.hubPose.pos;
    const x = hub[0]!, z = hub[2]!;
    this.ray.origin.x = x;
    this.ray.origin.y = hub[1]! - 0.22;
    this.ray.origin.z = z;
    const hit = this.core.phys.world.castRay(this.ray, 1.2, true, undefined, groups(GROUP.CLAW, GROUP.STATIC | GROUP.TOY | GROUP.TOY_SOFT));
    const hitY = hit ? this.ray.origin.y - hit.timeOfImpact : 0;
    this.effects.setAim(true, x, z, Math.max(0, hitY), hub[1]!);
  }

  private updateEye(now: number, dt: number): void {
    const view = this.applied.profiles[this.profile].view;
    let source: string;
    try {
      source = this.deps.tracker.sampleEye(now, _eye);
    } catch (error) {
      logError('tracker', error);
      _eye[0] = view.eye[0];
      _eye[1] = view.eye[1];
      _eye[2] = view.eye[2];
      source = 'neutral';
    }
    // A slow idle drift shows off the depth of the cabinet while nobody is tracked or playing.
    if (source === 'neutral' && this.core.machine.phase === 'ATTRACT' && !this.effects.reducedMotion) {
      const k = this.layout.physWidth;
      _eye[0] += Math.sin(this.time * 0.33) * 0.07 * k;
      _eye[1] += Math.sin(this.time * 0.21 + 1) * 0.03 * k;
    }
    void dt;
    eyeToWorld(this.layout, _eye, _eyeWorld);
    this.stage.setEyeWorld(_eyeWorld[0], _eyeWorld[1], _eyeWorld[2]);
  }

  /* ----------------------------------------------------------------- perf */

  private recordPerf(frameMs: number, dt: number, targetFps: number): void {
    this.frameTimes[this.frameCursor] = frameMs;
    this.frameCursor = (this.frameCursor + 1) % FRAME_SAMPLES;
    this.frameCount = Math.min(FRAME_SAMPLES, this.frameCount + 1);
    this.framesAcc++;
    if (!this.paused && this.adaptive.sample(frameMs, targetFps, this.applied.graphics)) {
      this.applyGraphicsNow();
      log('info', 'perf', `auto optimiser level ${this.adaptive.level}`);
    }
    this.perfTimer += dt;
    if (this.perfTimer < 0.5) return;
    const sorted = Array.from(this.frameTimes.subarray(0, this.frameCount)).sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
    const info = this.stage.renderer.info.render;
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const tracker = this.deps.ui.getState().tracker;
    const perf: PerfSnapshot = {
      fps: avg > 0 ? 1000 / avg : 0,
      frameMs: avg,
      frameP50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      frameP95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      frameMax: sorted[sorted.length - 1] ?? 0,
      physicsMs: this.physicsMsAcc / Math.max(1, this.framesAcc),
      stepsPerFrame: this.stepsAcc / Math.max(1, this.framesAcc),
      droppedSteps: this.stepper.droppedSteps,
      trackingMs: tracker.inferenceMs,
      trackingFps: tracker.inferenceFps,
      calls: info.calls,
      triangles: info.triangles,
      toyTriangles: this.toyVisuals.triangles,
      particles: this.effects.liveCount(),
      heapMb: memory ? memory.usedJSHeapSize / 1048576 : null,
      gpuMs: null,
    };
    this.perfTimer = 0;
    this.physicsMsAcc = 0;
    this.stepsAcc = 0;
    this.framesAcc = 0;
    this.deps.ui.setState({ perf, effective: { ...this.stage.effective } });
  }

  /* ----------------------------------------------------------- thumbnails */

  /** Renders character portraits for the UI in the background (current theme first). */
  private queueThumbnails(): void {
    if (this.thumbnailJob) return;
    this.thumbnailJob = (async () => {
      try {
        const { renderThumbnails } = await import('../plush/thumbnails');
        const have = this.deps.ui.getState().thumbnails;
        const assets = this.library.assets(this.themeId).filter((a) => !have[a.id]);
        if (assets.length === 0) return;
        const made = await renderThumbnails(this.library, assets, 256);
        this.deps.ui.setState({ thumbnails: { ...this.deps.ui.getState().thumbnails, ...made } });
      } catch (error) {
        logError('thumbnails', error);
      } finally {
        this.thumbnailJob = null;
      }
    })();
  }

  /** Portraits of another theme (collection / settings previews). */
  async ensureThumbnails(theme: ThemeId): Promise<void> {
    try {
      const { renderThumbnails } = await import('../plush/thumbnails');
      const have = this.deps.ui.getState().thumbnails;
      const assets = this.library.assets(theme).filter((a) => !have[a.id]);
      if (assets.length === 0) return;
      const made = await renderThumbnails(this.library, assets, 256);
      this.deps.ui.setState({ thumbnails: { ...this.deps.ui.getState().thumbnails, ...made } });
      if (theme !== this.themeId) this.library.releaseExcept(this.themeId);
    } catch (error) {
      logError('thumbnails', error);
    }
  }

  /* ---------------------------------------------------------------- debug */

  private installDebugApi(): void {
    const api = {
      game: this,
      core: () => this.core,
      state: () => ({
        phase: this.core.machine.phase,
        roundId: this.core.machine.roundId,
        demo: this.core.machine.demo,
        paused: this.paused,
        claw: { x: this.core.claw.trolleyX, z: this.core.claw.trolleyZ, rope: this.core.claw.ropeLength, hub: Array.from(this.core.claw.hubPose.pos) },
        toys: [...this.core.phys.toys.values()].map((t) => ({ id: t.id, type: t.asset.id, inBin: t.inBin, pos: Array.from(t.pose.pos) })),
        steps: this.core.phys.stepCount,
        time: this.core.time,
        eye: Array.from(_eyeWorld),
        window: this.stage.camera.getWindow(),
        layout: this.layout,
        hud: this.hud,
        effective: { ...this.stage.effective },
        theme: this.themeId,
        profile: this.profile,
      }),
      /** Simulates `seconds` of game time without rendering (tests on slow software GL). */
      fastForward: (seconds: number) => {
        const steps = Math.round(seconds / FIXED_DT);
        for (let i = 0; i < steps; i++) {
          if (this.core.machine.demo) this.pilot.update(this.core, FIXED_DT);
          this.core.fixedStep();
          this.stepRestock(FIXED_DT);
          if (i % 12 === 0) this.updateFlow(FIXED_DT * 12);
        }
        this.toyVisuals.sync(this.core.phys.toys.values());
      },
      /** Moves the claw above (x, z) instantly (only between rounds). */
      placeClaw: (x: number, z: number) => {
        if (!this.core.machine.busy) this.core.claw.reset(x, z);
      },
      projection: () => Array.from(this.stage.camera.projectionMatrix.elements),
      log: () => getLog().map((e) => `[${e.level}] ${e.scope}: ${e.message}`),
      /** GPU resource counts (leak checks). */
      memory: () => ({ geometries: this.stage.renderer.info.memory.geometries, textures: this.stage.renderer.info.memory.textures, programs: this.stage.renderer.info.programs?.length ?? 0 }),
      /** Rapier object counts (leak checks). */
      bodies: () => ({ bodies: this.core.phys.world.bodies.len(), colliders: this.core.phys.world.colliders.len(), joints: this.core.phys.world.impulseJoints.len(), toys: this.core.phys.toys.size }),
      audio: () => this.deps.audio.status(),
      guide: () => ({ status: this.deps.guide.status(), line: this.deps.guide.currentLine() }),
      tracker: () => ({
        status: this.deps.tracker.status(),
        diagnostics: (this.deps.tracker as unknown as { diagnostics?: () => unknown }).diagnostics?.() ?? null,
      }),
      ui: () => this.deps.ui.getState(),
      settings: () => this.deps.settings.getState().settings,
      collection: () => {
        const c = this.deps.collection.getState();
        return { counts: c.counts, attempts: c.attempts, wins: c.wins, prizeIds: c.prizeIds };
      },
      claw: CLAW,
    };
    (window as unknown as { __plush: typeof api }).__plush = api;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
    for (const off of this.offs) off();
    this.toyVisuals?.dispose();
    this.effects?.dispose();
    this.clawVisual?.dispose();
    this.cabinet?.dispose();
    this.materials?.dispose();
    this.library.dispose();
    this.core?.dispose();
    this.stage?.dispose();
  }
}
