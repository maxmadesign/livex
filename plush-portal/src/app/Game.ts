import { Vector3 } from 'three';
import { guideLanguage } from '../ai/GuideDirector';
import { brandFacts } from '../brand';
import type { AudioPort, CalibrationPhase, GuideEvent, GuideEventType, GuideFacts, GuidePort, SfxName, TrackerPort, TrackerStatus } from '../core/contracts';
import type { DisplayProfileId, Lang, RoundResult, ThemeId, Vec3 } from '../core/types';
import { getLog, log, logError } from '../diagnostics/log';
import { ATTRACT_TIMING, AttractDirector, IdleTimer } from '../game/attract';
import { GameCore } from '../game/GameCore';
import { rarityOf, type RarityTier } from '../game/rarity';
import type { MachineId } from '../game/machines/ids';
import { isMachineId, resolveMachine } from '../game/machines/registry';
import type { RoundParams } from '../game/RoundController';
import { ScoreKeeper, comboMultiplier, type ScoreAward, type ScoringDifficulty } from '../game/scoring';
import { readFramedEnvironment } from '../layout/frame';
import { solveLayout, type HudLayout } from '../layout/solve';
import { computeWindowLayout, eyeToWorld, handheldCameraPosition, physicalScreenSize, type WindowEnvironment, type WindowLayout } from '../perspective/windowGeometry';
import type { CollectionStore } from '../persistence/collection';
import { clearScores, loadScores, saveScores } from '../persistence/scores';
import { CHUTE_CENTER, CLAW, FIXED_DT, GROUP, PRIZE_SENSOR, groups } from '../physics/fieldSpec';
import { FixedStepper, RAPIER, initRapier, type ImpactEvent, type ToyBody } from '../physics/PhysicsWorld';
import { PlushLibrary } from '../plush/PlushLibrary';
import type { PlushAsset } from '../plush/manifest';
import { Cabinet } from '../scene/Cabinet';
import { ClawVisual } from '../scene/ClawVisual';
import { Effects } from '../scene/Effects';
import type { FxApi, FxBurstKind, Vec3Like } from '../scene/fx/api';
import { CabinetMaterials } from '../scene/materials';
import { Stage } from '../scene/Stage';
import { ToyVisuals } from '../scene/ToyVisuals';
import { diffSettings, profileDefaults, type AiSettings, type CameraSettings, type GraphicsSettings, type Settings, type ViewSettings } from '../settings/spec';
import type { SettingsStore } from '../settings/store';
import { themeOf } from '../themes/themes';
import { RewardFlow, scannableQrOnScreen } from '../rewards/flow';
import { AdaptiveQuality } from './AdaptiveQuality';
import { DemoPilot } from './DemoPilot';
import { attachPeekDrag } from './PeekDrag';
import type { GameStore, MachineCardInfo, PerfSnapshot } from './gameStore';

/** Steering input as the round controller receives it, and where it came from. */
export interface SteerInput {
  x: number;
  z: number;
  source: 'keys' | 'stick' | 'none';
  /** Set when the game dropped every input (pause, dialog, blur, new round): a held stick lets go. */
  cleared?: boolean;
}

export interface PhysicalWindow {
  widthM: number;
  heightM: number;
  centerOffsetM: [number, number];
}

export type ConfigurableGuide = GuidePort & {
  configure(cfg: { settings: AiSettings; uiLang: Lang; themeId: ThemeId; themeVersion: number; voiceVolume?: number }): void;
};
export type ConfigurableTracker = TrackerPort & {
  /** `profile`: the active display preset (selects its stored head baseline); trackers may ignore it. */
  configure(cfg: { camera: CameraSettings; view: ViewSettings; window: PhysicalWindow; profile?: DisplayProfileId }): void;
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
  /**
   * `?machine=`: the home machine of this page load (attract mode and the idle reset), overriding
   * machines.home without saving anything. Absent / null = machines.home.
   */
  machine?: MachineId | null;
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
const _p = new Vector3();
const _eye: Vec3 = [0, 0, 1];
const _eyeWorld: Vec3 = [0, 0, 1];
const FRAME_SAMPLES = 180;
/** Longest wait for a claim code before the win line goes out without the scan invitation. */
const PRIZE_LINE_WAIT_MS = 1500;
/** Cabinet LED energy of a win, by rarity (the existing materials.updateLeds input). */
const TIER_LED: Record<RarityTier, number> = { common: 0.75, rare: 1, epic: 1.3, legendary: 1.7 };
/** Where a won prize leaves the field: the prize exit, just below the floor. */
const EXIT_POS: Vec3Like = { x: CHUTE_CENTER.x, y: PRIZE_SENSOR.yTop + 0.04, z: CHUTE_CENTER.z };
/** Input events that count as "somebody is here" for the idle reset. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
/**
 * Inputs a browser accepts as the user gesture that may start audio (mouse: pointerdown; touch:
 * pointerup / touchend; keys: keydown). Any of them unlocks sound, not only START.
 */
const AUDIO_UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;
type LightMode = Parameters<FxApi['lightShow']>[0];

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
  /** The measured window environment behind `layout` (screen size, rotation). */
  private env: WindowEnvironment | null = null;
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
  /** Wall-clock idle detection (keeps counting while a dialog is open). */
  private readonly idle = new IdleTimer();
  private attract!: AttractDirector;
  /** Points system (src/game/scoring.ts); best and lifetime persist in src/persistence/scores.ts. */
  readonly scores = new ScoreKeeper(loadScores(), (record) => saveScores(record));
  /** Difficulty the current round is played (and scored) with: latched with the round's parameters. */
  private roundDifficulty: ScoringDifficulty = 'arcade';
  private popupId = 0;
  /**
   * Light show: the persistent mode last sent ('idle' / 'attract'). Timed shows are started by
   * `celebrate()` itself (epic: 'win', legendary: 'jackpot'); the game adds 'jackpot' for a ×3 combo.
   */
  private lightSent: LightMode | null = null;
  /** Cancel a running win / jackpot show before the next mode is sent (new player, idle reset). */
  private lightCancel = false;
  /** Round whose win sound (tier stinger + character voice) already played at the prize exit. */
  private winSoundRound = -1;
  /** Last calibration state seen from the tracker (sounds on its transitions). */
  private calPhase: CalibrationPhase = 'idle';
  private calRemaining = 0;
  private ctaTimer = 1.2;
  private ctaSide = 0;
  /** Effects already shown in this round (each fires once). */
  private liftShown = -1;
  private auraOn = false;
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
  /** Latched keyboard directions. */
  private readonly dir = { left: false, right: false, back: false, front: false };
  /** On-screen joystick gate (src/ui/Joystick.tsx): x right +1, z toward the player +1; 0, 0 = centred. */
  private readonly stick = { x: 0, z: 0 };
  /** HUD listeners of the steering input (the joystick mirrors the keys when nobody holds it). */
  private readonly inputListeners = new Set<(input: SteerInput) => void>();
  /** Prize-claim codes for real wins (src/rewards/flow.ts): the store's `reward` slice. */
  private readonly rewards: RewardFlow;

  constructor(private readonly deps: GameDeps) {
    const view = deps.settings.getState().view();
    this.applied = view;
    this.committed = deps.settings.getState().settings;
    this.profile = deps.ui.getState().profile;
    this.themeId = this.committed.themes.current;
    this.roundDifficulty = this.committed.gameplay.difficulty;
    this.scores.enabled = this.applied.gameplay.scoring;
    this.rewards = new RewardFlow({ ui: deps.ui, settings: () => this.committed.rewards });
  }

  /** The effects contract (src/scene/fx/api.ts); src/scene/Effects.ts implements it. */
  private get fx(): FxApi {
    return this.effects;
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
      this.stage.onSize = (_w, h) => this.effects?.setViewportHeight(h);
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
      this.toyVisuals = new ToyVisuals(this.library, { lod: s.graphics.lod, fur: s.graphics.fur, deform: s.graphics.deform, textures: s.graphics.textures });
      this.effects = new Effects();
      this.stage.scene.add(this.toyVisuals.group, this.effects.group);

      this.measure();
      // The home machine of this page load: ?machine= (never saved) or machines.home. Machines that are
      // not offered yet fall back to classic.
      const wanted = this.deps.launch.machine ?? s.machines.home;
      const machine = resolveMachine(wanted, s.machines);
      if (machine.def.id !== wanted) log('info', 'round', `machine "${wanted}" is not available; playing ${machine.def.id}`);
      this.core = new GameCore({
        binFloorY: this.layout.binFloorY,
        toyFriction: s.gameplay.toyFriction,
        params: this.roundParams(s),
        field: this.fieldOptions(s),
        themeId: this.themeId,
        machine,
      });
      this.attract = new AttractDirector(this.core);
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
      this.offs.push(this.deps.tracker.subscribe((status) => this.onTrackerStatus(status)));
      this.offs.push(attachPeekDrag({ canvas, tracker: this.deps.tracker, settings, ui, hud: () => this.hud, reducedMotion: () => this.effects.reducedMotion }));
      this.offs.push(this.deps.audio.subscribe((status) => ui.setState({ audio: status })));
      this.offs.push(this.deps.guide.subscribe((line, status) => ui.setState({ guideLine: line, guideStatus: status })));
      window.addEventListener('resize', this.onResize);
      // A phone turned by 180° (top left ↔ top right) changes no size, so no resize: the lens moved sides.
      screen.orientation?.addEventListener?.('change', this.onResize);
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('blur', this.onBlur);
      for (const type of ACTIVITY_EVENTS) window.addEventListener(type, this.onActivity, { capture: true, passive: true });
      for (const type of AUDIO_UNLOCK_EVENTS) window.addEventListener(type, this.onAudioGesture, { capture: true, passive: true });
      this.idle.touch();
      this.publishScore(null);

      ui.setState({ boot: { stage: 'ready', progress: 1, label: 'ready', error: null }, warnings: [...this.library.warnings], themeId: this.themeId });
      this.setPaused('boot', false);
      // Attract mode has its theme music too: select it now and try to start audio. A browser that
      // allows autoplay (a kiosk) plays the demo with sound at once; elsewhere the first tap, click
      // or key anywhere unlocks it (onAudioGesture). unlock() never throws.
      this.deps.audio.setTheme(this.themeId, { immediate: true });
      void this.deps.audio.unlock();
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
      const effective = this.effectiveGraphics().graphics;
      this.materials.setGlassQuality(effective.glass);
      this.materials.setFxLevel(effective.fxIntensity, effective.lightShow);
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
    const profile = this.applied.profiles[this.profile];
    // Portrait presets may simulate their 9:16 screen in a window of another shape: env and insets
    // are then those of the box (src/layout/frame.ts); otherwise the canvas is measured as before.
    const { env, insets } = readFramedEnvironment(canvas, this.profile, profile.layout);
    this.env = env;
    this.hud = solveLayout(this.profile, profile.layout, env.viewportW, env.viewportH, insets);
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

  /** A user gesture while the browser still holds audio back (at boot, or re-locked later): unlock now. */
  private onAudioGesture = (): void => {
    if (this.deps.audio.status().state === 'locked') void this.deps.audio.unlock();
  };

  /** A dialog opened or closed. Rounds, physics and the aim timer are frozen while one is open. */
  setModalOpen(open: boolean): void {
    this.setPaused('modal', open);
    if (open) this.deps.guide.silence();
  }

  /* ---------------------------------------------------------------- input */

  /** Keyboard arrows / WASD (src/ui/App.tsx). The joystick wins while it is deflected. */
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

  /**
   * The on-screen joystick's gate (src/ui/stickMath.ts): x right +1 / left −1, z toward the player
   * +1 / back −1, (0, 0) when centred or released. Each new gate clicks like a real lever's
   * microswitch. Ignored while paused, like a key press.
   */
  setStick(x: number, z: number): void {
    const sx = Number.isFinite(x) ? Math.sign(x) : 0;
    const sz = Number.isFinite(z) ? Math.sign(z) : 0;
    const engaged = sx !== 0 || sz !== 0;
    if (this.paused && engaged) return;
    if (this.stick.x === sx && this.stick.z === sz) return;
    this.stick.x = sx;
    this.stick.z = sz;
    if (engaged) {
      this.touchActivity();
      const phase = this.core.machine.phase;
      if (phase === 'READY' || phase === 'AIMING') this.deps.audio.playSfx('dir_press');
    }
    this.pushInput();
  }

  clearDirections(): void {
    this.dir.left = this.dir.right = this.dir.back = this.dir.front = false;
    this.stick.x = this.stick.z = 0;
    if (this.core) this.core.controller.clearInput();
    this.notifyInput({ x: 0, z: 0, source: 'none', cleared: true });
  }

  /** Follows the steering input (keys or joystick). Returns the unsubscribe function. */
  onInput(listener: (input: SteerInput) => void): () => void {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  private notifyInput(input: SteerInput): void {
    for (const listener of this.inputListeners) listener(input);
  }

  private pushInput(): void {
    const c = this.core.controller;
    if (this.core.machine.demo) return;
    // The joystick wins while it is deflected; otherwise the keys steer.
    const deflected = this.stick.x !== 0 || this.stick.z !== 0;
    if (deflected) {
      c.inputX = this.stick.x;
      c.inputZ = this.stick.z;
    } else {
      c.inputX = (this.dir.right ? 1 : 0) - (this.dir.left ? 1 : 0);
      // "Up" (arrow up / W) moves the claw towards the back of the cabinet (−Z), "down" towards the glass.
      c.inputZ = (this.dir.front ? 1 : 0) - (this.dir.back ? 1 : 0);
    }
    this.notifyInput({ x: c.inputX, z: c.inputZ, source: deflected ? 'stick' : c.inputX !== 0 || c.inputZ !== 0 ? 'keys' : 'none' });
  }

  /**
   * Start button, the attract call to action, Space / Enter: leaves attract mode at once (a
   * running demo round is stopped, the claw and the field are reset on the spot), unlocks audio,
   * (once) starts head tracking and begins a player round that is ready to aim.
   */
  pressStart(): void {
    if (this.paused) return;
    this.touchActivity();
    if (!this.attract.active) return;
    void this.deps.audio.unlock();
    if (this.firstStart) {
      this.firstStart = false;
      this.deps.audio.setTheme(this.themeId, { immediate: true });
      if (this.applied.camera.enabled && !this.deps.launch.noCamera) void this.deps.tracker.start();
    }
    this.pilot.reset();
    this.clearDirections();
    // New player, new session: the demo's show score and any old combo are gone.
    this.scores.resetSession();
    this.deps.ui.setState({ result: null, prize: null, scorePopups: [] });
    this.rewards.reset();
    this.attract.leave();
    this.restockQueue = 0;
    this.toyVisuals.sync(this.core.phys.toys.values());
    this.safeFx(() => this.fx.aura(null));
    this.auraOn = false;
    // A demo round's win / jackpot show ends with the demo.
    this.lightCancel = true;
    this.publishScore(null);
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
    // PLAY AGAIN dismisses the claim QR with the card (scan first, then play).
    this.rewards.reset();
    m.next(false);
  }

  /** Abandons the current round and puts the claw back (Settings → Gameplay → restart round). */
  restartRound(): void {
    this.core.controller.resetRound('manual_restart', this.core.machine.phase === 'ATTRACT' ? 'ATTRACT' : 'READY');
    this.deps.ui.setState({ result: null, prize: null });
    this.rewards.reset();
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

  /* ------------------------------------------------------------- machines */
  // Public contract of the machine framework (docs/design/machines.md, sections 2.2 and 4.11).
  // The bodies arrive with the machine director; until then every call is a safe no-op on classic.

  /** Switches to another machine at the next round boundary. False when refused. */
  selectMachine(id: MachineId): boolean {
    void id;
    return false;
  }

  /** Opens the machine lobby (the MACHINES deck button). */
  openLobby(): void {}

  /** A machine deck action: 'staff' = "Call staff" on the bridge. False when not available. */
  machineAction(action: 'staff'): boolean {
    void action;
    return false;
  }

  /** The two-step buttons of `twoStep` controls (button 1 = +x, button 2 = -z). */
  stepInput(step: 1 | 2, pressed: boolean): void {
    void step;
    void pressed;
  }

  /** PLAY AGAIN on a session card: a fresh session on the same machine. */
  newSession(): void {}

  /** Initials for a ranking place. False when no entry is waiting or the initials are invalid. */
  submitInitials(initials: string): boolean {
    void initials;
    return false;
  }

  /** The lobby cards. */
  machineCards(): MachineCardInfo[] {
    return [];
  }

  private touchActivity(): void {
    this.idle.touch();
  }

  private onActivity = (): void => {
    this.idle.touch();
  };

  /** True while a calibration countdown or capture is running. */
  private calibrating(): boolean {
    return this.calPhase === 'countdown' || this.calPhase === 'capturing';
  }

  /** Tracker status: to the UI store, plus the calibration sounds (a tick per second, a chime when done). */
  private onTrackerStatus(status: TrackerStatus): void {
    this.deps.ui.setState({ tracker: status });
    const cal = status.calibration;
    const { audio } = this.deps;
    if (cal.phase === 'done' && this.calPhase !== 'done') audio.playSfx('calibration_ok');
    else if (cal.phase === 'countdown' && cal.remaining > 0 && (this.calPhase !== 'countdown' || cal.remaining !== this.calRemaining)) audio.playSfx('countdown_tick');
    this.calPhase = cal.phase;
    this.calRemaining = cal.remaining;
    // Starting a calibration counts as activity: the idle reset must not cancel it.
    if (this.calibrating()) this.idle.touch();
  }

  /** Settings → System → Reset scores (best session score and lifetime points). */
  resetScores(): void {
    this.scores.resetAll();
    clearScores();
    this.publishScore(null);
  }

  /** Seconds since the last player input (diagnostics / tests). */
  idleSeconds(): number {
    return this.idle.idleSeconds();
  }

  /**
   * Seconds spent in the ATTRACT phase; the next demo round starts when it passes the delay.
   * Tests set it to 0 to keep the demo claw still while frames render (tests/e2e/20-screenshots).
   */
  get attractTime(): number {
    return this.attract ? this.attract.attractTime : 0;
  }
  set attractTime(seconds: number) {
    if (this.attract) this.attract.attractTime = seconds;
  }

  /**
   * Nobody played for `system.idleSeconds`: a full reset. Open dialogs close (a settings draft
   * is cancelled), the session score and combo are cleared, the guide stops talking, the view
   * returns to neutral (tracking keeps running), the field is restocked to the configured count
   * and the machine goes back to the self-playing attract mode.
   */
  idleReset(reason: 'idle' | 'debug' = 'idle'): void {
    log('info', 'round', reason === 'idle' ? `idle reset (${this.committed.system.idleSeconds} s without input)` : 'idle reset (requested through the debug API)');
    const { ui, guide, tracker } = this.deps;
    this.closeDialogs();
    guide.silence();
    tracker.setTestViewpoint(null);
    tracker.cancelCalibration();
    this.clearDirections();
    this.scores.resetSession();
    ui.setState({ result: null, prize: null, scorePopups: [], toast: null });
    this.rewards.reset();
    if (!this.attract.active) this.attract.enter('idle_reset');
    this.lightCancel = true;
    this.lossStreak = 0;
    this.retryPrompted = false;
    this.restockQueue = this.core.field.missing();
    this.publishScore(null);
    this.idle.touch();
  }

  /** Closes whatever dialog is open, exactly like its Cancel / close button (no sound). */
  private closeDialogs(): void {
    const { ui, settings, tracker, audio } = this.deps;
    const modal = ui.getState().modal;
    // The first-run display chooser stays: the machine is not usable before a preset is chosen.
    if (modal === null || modal === 'device') return;
    if (modal === 'settings') {
      settings.getState().cancelEdit();
      tracker.setTestViewpoint(null);
      tracker.attachPreview(null);
      audio.previewTrack(null);
    }
    ui.setState({ modal: null });
    this.setModalOpen(false);
  }

  /* ---------------------------------------------------------------- rounds */

  private bindCore(): void {
    const { machine, controller } = this.core;
    const { ui, audio } = this.deps;
    machine.events.on('phase', (e) => {
      ui.setState({ phase: e.phase, roundId: e.roundId, demo: e.demo, aimSecondsLeft: -1 });
      if (this.applied.system.verboseLog) log('info', 'round', `${e.prev} → ${e.phase} (round ${e.roundId}${e.demo ? ', demo' : ''})`);
      if (e.phase === 'READY') {
        // The round's parameters are latched now, so is the difficulty it is scored with.
        this.roundDifficulty = this.committed.gameplay.difficulty;
        this.afterRoundBoundary();
        if (e.demo && e.prev === 'ATTRACT') this.publishScore(null);
      }
      if (e.phase === 'ATTRACT') {
        this.attract.attractTime = 0;
        this.afterRoundBoundary();
        // Attract mode always shows a full machine, whatever the restock setting.
        this.restockQueue = this.core.field.missing();
        this.publishScore(null);
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
    controller.events.on('clawTouch', (e) => {
      audio.playSfx('claw_touch', { volume: e.onToy ? 0.9 : 0.6 });
      // First real finger contact with a toy.
      if (e.onToy) this.burstAt('contact', this.core.claw.gripCenter(_p));
    });
    controller.events.on('gripEvaluated', (e) => {
      if (e.toy) {
        audio.playSfx('plush_rub', { volume: 0.5 + 0.4 * (e.facts?.quality ?? 0) });
        this.toyVisuals.focus = e.toy;
      }
    });
    controller.events.on('liftStarted', (e) => {
      audio.playSfx('claw_lift');
      const toy = this.core.grip.target;
      // The character squeals as it leaves the pile (each character has its own voice).
      if (e.holding && toy) audio.playCharacter(toy.asset.id, 'lift', this.voiceOptions(toy, 0.25));
    });
    controller.events.on('slipped', (e) => {
      audio.playSfx('slip');
      audio.playCharacter(e.toy.asset.id, 'slip', this.voiceOptions(e.toy, 0));
      if (this.toyPosition(e.toy, _p)) this.burstAt('slip', _p, rarityOf(e.toy.asset.id));
    });
    controller.events.on('prizeDetected', (e) => this.onPrizeExit(e.roundId, e.toy));
    controller.events.on('aimTick', (e) => {
      ui.setState({ aimSecondsLeft: e.secondsLeft });
      if (e.secondsLeft <= 3 && e.secondsLeft > 0) audio.playSfx('countdown_tick');
    });
    controller.events.on('grabStarted', () => {
      const hub = this.core.claw.hubPose.pos;
      this.burstAt('grab', _p.set(hub[0]!, hub[1]! - 0.12, hub[2]!));
      if (!machine.demo && this.lossStreak === 0 && machine.roundId % 4 === 2) this.emitGuide('grab_started');
    });
  }

  /* ---------------------------------------------------------------- effects */

  private burstAt(kind: FxBurstKind, pos: Vec3Like, tier?: RarityTier, scale?: number): void {
    this.safeFx(() => this.fx.burst(kind, { x: pos.x, y: pos.y, z: pos.z }, tier || scale ? { tier, scale } : undefined));
  }

  /**
   * Effects are presentation only: a failing effect is logged and skipped. It must never reach
   * the frame loop's error recovery, which would abandon the round (every frame, for the aura).
   */
  private safeFx(run: () => void): void {
    try {
      run();
    } catch (error) {
      logError('fx', error);
    }
  }

  /** Render position of a toy (interpolated), falling back to its physics pose. */
  private toyPosition(toy: ToyBody, out: Vector3): Vector3 | null {
    if (this.toyVisuals.positionOf(toy, out)) return out;
    const p = toy.pose.pos;
    return out.set(p[0]!, p[1]!, p[2]!);
  }

  /**
   * A world position in CSS pixels relative to the game's box (the canvas), null when behind the
   * viewer. Score popups are laid out inside that box, which is the whole window except when a
   * 9:16 screen is simulated in a window of another shape (src/layout/frame.ts).
   */
  private toScreen(pos: Vec3Like): { x: number; y: number } | null {
    const camera = this.stage.camera;
    _v.set(pos.x, pos.y, pos.z).project(camera);
    if (!Number.isFinite(_v.x) || !Number.isFinite(_v.y) || _v.z > 1) return null;
    const rect = this.deps.canvas.getBoundingClientRect();
    const w = rect.width || this.hud.vw;
    const h = rect.height || this.hud.vh;
    return { x: ((_v.x + 1) / 2) * w, y: ((1 - _v.y) / 2) * h };
  }

  /** Character voice options: panned to where the toy is, quieter in demo rounds. */
  private voiceOptions(toy: ToyBody, delay: number): { delay: number; pan: number; volume?: number } {
    const pan = Math.max(-1, Math.min(1, (toy.pose.pos[0] ?? 0) * 1.6));
    return this.core.machine.demo ? { delay, pan, volume: 0.7 } : { delay, pan };
  }

  /**
   * The prize passed the exit sensor: the round is won (physically decided) and settled right
   * away, so the points pop up where the prize leaves the field. The result card shows the
   * same award later (settlement is idempotent per round).
   */
  private onPrizeExit(roundId: number, toy: ToyBody): void {
    const { audio } = this.deps;
    const demo = this.core.machine.demo;
    const tier = rarityOf(toy.asset.id);
    audio.playSfx('chute_drop');
    this.celebrate = Math.max(this.celebrate, TIER_LED[tier]);
    const award = this.settleRound(roundId, 'won', toy.asset.id, demo);
    // Ask for the claim code now, so it is usually ready when the win card appears.
    this.requestReward(roundId, toy.asset.id, demo);
    const streak = award ? award.streak : 0;
    // The light show escalates with the tier: celebrate() starts the 'win' show for epic and the
    // 'jackpot' show for legendary by itself; common and rare get particles and a flash only.
    // A ×3 combo earns the jackpot show whatever the tier.
    this.safeFx(() => this.fx.celebrate(tier, EXIT_POS));
    if (tier !== 'legendary' && award !== null && award.comboMultiplier >= 3) this.safeFx(() => this.fx.lightShow('jackpot'));
    this.burstAt('score', EXIT_POS, tier);
    if (streak >= 2) this.burstAt('combo', EXIT_POS, tier, Math.min(2, 0.6 + streak * 0.25));
    // Tier-aware win sound (stinger, sparkle / confetti / firework, jackpot fanfare) and the
    // character's own happy voice; a streak adds the combo hit.
    audio.playWin(this.themeId, tier, demo ? { volume: 0.7 } : undefined);
    audio.playCharacter(toy.asset.id, 'win', this.voiceOptions(toy, 0));
    if (streak >= 2) audio.playSfx('combo', { delay: 0.5 });
    this.winSoundRound = roundId;
    if (award) {
      const at = this.toScreen(EXIT_POS);
      if (at) this.addPopup(at, award);
      this.publishScore(award);
    }
  }

  /** Scores a round once (idempotent per round id); demo rounds never persist. */
  private settleRound(roundId: number, outcome: RoundResult['outcome'], typeId: string | null, demo: boolean): ScoreAward | null {
    const already = this.scores.awardFor(roundId);
    if (already) return null;
    const prize = this.deps.ui.getState().prize;
    const facts = this.core.grip.facts;
    return this.scores.settle({
      roundId,
      outcome,
      typeId,
      difficulty: this.roundDifficulty,
      firstCatch: !demo && outcome === 'won' && !!prize?.isNew && prize.typeId === typeId,
      grip: facts ? { centering: facts.centering, fingers: facts.fingers } : null,
      demo,
    });
  }

  /** Hands a win to the prize-claim flow (it ignores demo rounds and themes without rewards). */
  private requestReward(roundId: number, typeId: string | null, demo: boolean): void {
    if (demo || !typeId) return;
    const lang = this.language();
    const asset = this.library.assets().find((a) => a.id === typeId);
    try {
      this.rewards.onWin({ roundId, demo, themeId: this.themeId, prizeId: typeId, prizeName: asset ? asset.name[lang] : typeId, tier: rarityOf(typeId), lang });
    } catch (error) {
      logError('rewards', error);
    }
  }

  private addPopup(at: { x: number; y: number }, award: ScoreAward): void {
    const popups = this.deps.ui.getState().scorePopups.slice(-5);
    // The points counter ticks up as the popup rises.
    if (award.total > 0) this.deps.audio.playSfx('score_count', { delay: 0.3 });
    popups.push({
      id: ++this.popupId,
      x: at.x,
      y: at.y,
      points: award.total,
      tier: award.tier,
      kind: award.outcome === 'won' ? 'win' : 'slip',
      demo: award.demo,
      multiplier: award.comboMultiplier,
    });
    this.deps.ui.setState({ scorePopups: popups });
  }

  /** Removes a popup once its animation finished (called by the HUD). */
  dismissPopup(id: number): void {
    const popups = this.deps.ui.getState().scorePopups;
    if (popups.some((p) => p.id === id)) this.deps.ui.setState({ scorePopups: popups.filter((p) => p.id !== id) });
  }

  /** Pushes the points state to the HUD. `last` = the award just settled (null keeps the previous one). */
  private publishScore(last: ScoreAward | null): void {
    const demo = this.attract ? this.attract.active : true;
    const totals = this.scores.totals(demo);
    const prev = this.deps.ui.getState().score;
    this.deps.ui.setState({
      score: {
        enabled: this.applied.gameplay.scoring,
        demo,
        session: totals.session,
        streak: totals.streak,
        nextMultiplier: comboMultiplier(totals.streak + 1),
        best: totals.best,
        lifetime: totals.lifetime,
        last: last ?? (totals.session === 0 && totals.streak === 0 ? null : prev.last),
      },
    });
  }

  private onResult(result: RoundResult): void {
    const { ui, audio } = this.deps;
    // Slips and empty grabs are scored here; a win was already scored when the prize passed the exit.
    if (result.outcome !== 'won') {
      const award = this.settleRound(result.roundId, result.outcome, result.targetTypeId, result.demo);
      if (award) {
        if (award.total > 0) {
          const toy = result.targetToyId ? this.core.phys.toys.get(result.targetToyId) : undefined;
          const at = toy && this.toyPosition(toy, _p) ? this.toScreen(_p.setY(_p.y + 0.08)) : null;
          if (at) this.addPopup(at, award);
        }
        this.publishScore(award);
      }
    }
    ui.setState({ result });
    this.retryPrompted = false;
    if (result.outcome === 'won') {
      // Normally settled at the exit already; this only catches a win the exit event did not score.
      if (!this.scores.isSettled(result.roundId)) {
        const award = this.settleRound(result.roundId, 'won', result.targetTypeId, result.demo);
        if (award) this.publishScore(award);
      }
      // The prize lands in the bin (demo rounds show it too).
      const toy = result.targetToyId ? this.core.phys.toys.get(result.targetToyId) : undefined;
      if (toy && this.toyPosition(toy, _p)) this.burstAt('drop', _p.setY(_p.y + 0.06), rarityOf(toy.asset.id));
    }
    // The win sound normally played when the prize passed the exit; this only covers a win the exit
    // event did not report.
    if (result.outcome === 'won' && this.winSoundRound !== result.roundId) {
      this.winSoundRound = result.roundId;
      audio.playWin(this.themeId, rarityOf(result.targetTypeId), result.demo ? { volume: 0.7 } : undefined);
    }
    if (result.demo) return;
    if (result.outcome === 'won') {
      // A win the exit event missed still gets its code (one per round); the QR's time starts now.
      this.requestReward(result.roundId, result.targetTypeId, false);
      this.rewards.onCardShown(result.roundId);
      this.lossStreak = 0;
      const prize = ui.getState().prize;
      if (prize?.isNew) audio.playSfx('collect_unlock', { delay: 0.9 });
      this.emitPrizeWon(result);
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
        this.rewards.reset();
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
    if (!this.deps.ui.getState().restocking) {
      // Once per restock: the toys start raining in.
      this.deps.audio.playSfx('restock_rain', { volume: 0.9 });
      this.deps.ui.setState({ restocking: true });
    }
    this.deps.audio.playSfx('restock_drop', { volume: 0.7 });
    const p = toy.pose.pos;
    this.burstAt('restock', _p.set(p[0]!, p[1]!, p[2]!), rarityOf(toy.asset.id));
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
      // Toy names follow the guide's language (English by default), not the interface language:
      // a Chinese UI must not put Chinese names into English lines, GPT prompts or the voice.
      const lang = guideLanguage(this.applied.ai, this.language());
      const asset = result.targetTypeId ? this.library.assets().find((a) => a.id === result.targetTypeId) : undefined;
      facts.toy = asset ? { typeId: asset.id, name: asset.name[lang], kind: asset.kind[lang] } : null;
      if (result.nearest) {
        const near = this.library.assets().find((a) => a.id === result.nearest!.typeId);
        facts.nearest = { dx: result.nearest.dx, dz: result.nearest.dz, dist: result.nearest.dist, name: near ? near.name[lang] : '' };
      }
      facts.newCharacter = this.deps.ui.getState().prize?.isNew ?? false;
    }
    // Event identity for {event} / {host} and the GPT prompt; null (left out) for the neutral kit
    // and for themes no kit dresses, so those lines stay generic.
    const brand = brandFacts(this.themeId);
    if (brand) facts.brand = brand;
    // The claim QR (src/rewards): only while a real, issued code (or the labelled public-demo code)
    // for this very round is on screen as a scannable QR, so Momo never invites anyone to scan a QR
    // that is not there (a phone shows a claim link, a loopback-only code no QR at all).
    // The guide uses it on prize_won and on the retry prompt that follows while the card is up.
    const reward = this.deps.ui.getState().reward;
    const at = { roundId: machine.roundId, demo: machine.demo, phone: this.hud.controls !== null, now: Date.now(), outcome: result?.outcome };
    if (scannableQrOnScreen(reward, at)) facts.reward = { qr: true, options: reward.options };
    return facts;
  }

  /**
   * The win line may invite the player to scan the claim QR (facts.reward), which needs the code.
   * The code is normally issued while the prize drops; if it is still on its way when the card
   * appears, the line waits for it (at most PRIZE_LINE_WAIT_MS) rather than going out without the
   * invitation. A line for a round that has already ended is not sent.
   */
  private emitPrizeWon(result: RoundResult): void {
    const codePending = () => {
      const reward = this.deps.ui.getState().reward;
      return reward.roundId === result.roundId && reward.state === 'issuing';
    };
    if (!codePending()) {
      this.emitGuide('prize_won', result);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unsubscribe();
      clearTimeout(timer);
      if (this.disposed || this.core.machine.roundId !== result.roundId) return;
      // PLAY AGAIN, the idle reset or a restart dismissed the card meanwhile (they clear the result
      // before the round id moves on): the line would celebrate a card that is gone.
      if (this.deps.ui.getState().result?.roundId !== result.roundId) return;
      this.emitGuide('prize_won', result);
    };
    const unsubscribe = this.deps.ui.subscribe(() => {
      if (!codePending()) finish();
    });
    const timer = setTimeout(finish, PRIZE_LINE_WAIT_MS);
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
    this.materials?.setFxLevel(graphics.fxIntensity, graphics.lightShow);
    this.effects.setBudget(graphics.particles);
    this.effects.setIntensity(graphics.fxIntensity);
    this.effects.setLightShowEnabled(graphics.lightShow);
    this.effects.setViewportHeight(this.stage.effective.height);
    this.toyVisuals.setQuality({ lod: graphics.lod, fur: graphics.fur, deform: graphics.deform, textures: graphics.textures });
    this.deps.ui.setState({ effective: { ...this.stage.effective }, autoReductions: reductions });
  }

  private configureTracker(): void {
    let view = this.applied.profiles[this.profile].view;
    if (this.profile === 'mobile' && this.env) {
      // The preset's default lens position only fits a phone turned top-to-the-left: follow the real rotation.
      const screenM = physicalScreenSize(this.env, this.layout);
      const camPos = handheldCameraPosition(view.camPos, profileDefaults('mobile').view.camPos, this.env.orientationAngle, screenM.widthM, screenM.heightM);
      if (camPos !== view.camPos) view = { ...view, camPos: [camPos[0], camPos[1], camPos[2]] };
    }
    this.deps.tracker.configure({
      camera: this.applied.camera,
      view,
      window: { widthM: this.layout.physWidth, heightM: this.layout.physHeight, centerOffsetM: [this.layout.physOffsetX, this.layout.physOffsetY] },
      // The active preset reaches the tracker even when no calibration overlay is mounted.
      profile: this.profile,
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
      audio.setAttractChime(a.attractChime);
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
      if (this.scores.enabled !== next.gameplay.scoring || !prev) {
        this.scores.enabled = next.gameplay.scoring;
        if (this.attract) this.publishScore(null);
      }
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
      this.core.setParams(this.roundParams(committed));
      this.core.phys.setToyFriction(committed.gameplay.toyFriction);
      // Same rule as the round parameters: between rounds the new difficulty applies at once.
      if (this.core.machine.atRoundBoundary) this.roundDifficulty = committed.gameplay.difficulty;
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
      this.rewards.reset();
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
    // Idle reset: wall clock, also while paused by a dialog. A player round that is still running counts as activity.
    // A running calibration countdown counts as activity too: somebody stands in front of the camera.
    // The limit is the applied value: a time only previewed in the open settings dialog (typed or
    // imported into the draft) must not close the very dialog it is being edited in.
    const m = core.machine;
    // A claim QR on screen holds the reset back until rewards.qrSeconds have passed (the visitor
    // is scanning, not touching); the idle clock itself keeps running, so an overdue reset follows
    // as soon as the QR has hidden itself.
    const wall = Date.now();
    this.rewards.tick(wall);
    if (!this.rewards.holdsIdle(wall) && this.idle.due(this.committed.system.idleSeconds, (m.busy && !m.demo && !paused) || this.calibrating()) && this.needsIdleReset()) this.idleReset();

    const alpha = paused ? 1 : this.stepper.alpha;
    const grip = core.grip;
    this.toyVisuals.heldToy = grip.holding() ? grip.target : null;
    if (this.toyVisuals.heldToy) core.claw.gripCenter(_v);
    this.toyVisuals.update(alpha, paused ? 0 : dt, paused ? [] : grip.contacts, this.frameImpacts, FIXED_DT);
    if (this.toyVisuals.heldToy) this.updateGripLocal(this.toyVisuals.heldToy);
    this.clawVisual?.update(alpha);
    this.updateAim();
    this.updateShow(paused ? 0 : dt);
    this.celebrate = Math.max(0, this.celebrate - dt * 0.45);
    // Cabinet LEDs: the win energy (by rarity) plus whatever the running light show adds.
    let ledExtra = 0;
    try {
      ledExtra = this.fx.ledEnergy?.() ?? 0;
    } catch (error) {
      logError('fx', error);
    }
    this.materials?.updateLeds(this.time, this.celebrate + (Number.isFinite(ledExtra) ? Math.max(0, ledExtra) : 0), this.effects.reducedMotion);
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

  /** True when an idle reset has something to do (not already a clean, self-playing attract mode). */
  private needsIdleReset(): boolean {
    if (!this.attract.active) return true;
    const modal = this.deps.ui.getState().modal;
    return (modal !== null && modal !== 'device') || this.scores.totals(false).session > 0;
  }

  /**
   * Non-physical round flow: attract mode and its demo rounds, auto-advance after a miss,
   * guide hints. (The idle reset itself runs on the wall clock in `update`.)
   */
  private updateFlow(dt: number): void {
    const m = this.core.machine;
    const event = this.attract.update(dt, {
      demoEnabled: this.applied.system.attractDemo,
      firstDemo: this.firstStart && this.core.time < 30,
      restockPending: this.restockQueue > 0,
    });
    if (event === 'demoStarted') this.pilot.reset();
    if (event === 'demoEnded') this.deps.ui.setState({ result: null, prize: null });
    if (m.demo || m.phase === 'ATTRACT') return;
    const idle = this.idle.idleSeconds();
    switch (m.phase) {
      case 'READY':
      case 'AIMING':
        if (idle > 12 && this.time - this.lastHintAt > 25) {
          this.lastHintAt = this.time;
          this.emitGuide(this.lossStreak >= 2 ? 'aim_help' : 'idle_hint');
        }
        break;
      case 'RESULT': {
        this.resultTimer += dt;
        const result = this.deps.ui.getState().result;
        if (result && result.outcome !== 'won') {
          // A miss never blocks: the next round is ready almost immediately.
          if (this.resultTimer > 1.15) this.playAgain();
        } else if (!this.retryPrompted && this.resultTimer > 7) {
          this.retryPrompted = true;
          this.emitGuide('retry_prompt');
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Per-frame effects that follow the game state: the rarity aura around a held toy, the burst
   * on a successful lift, the light show mode and the sparkles around the attract call to action.
   */
  private updateShow(dt: number): void {
    const { machine: m, grip } = this.core;
    const held = this.toyVisuals.heldToy;
    if (held && this.toyPosition(held, _p)) {
      const tier = rarityOf(held.asset.id);
      // A successful lift: the toy really rose while held (GripMonitor's "lifted" milestone).
      if (grip.contactLevel === 'lifted' && this.liftShown !== m.roundId) {
        this.liftShown = m.roundId;
        this.burstAt('lift', _p, tier);
      }
      this.safeFx(() => this.fx.aura(_p, tier));
      this.auraOn = true;
    } else if (this.auraOn) {
      this.safeFx(() => this.fx.aura(null));
      this.auraOn = false;
    }

    const attract = this.attract.active;
    // 'idle' / 'attract' only set the mode a timed show returns to; 'off' cancels the show.
    if (this.lightCancel) {
      this.lightCancel = false;
      this.lightSent = null;
      this.safeFx(() => this.fx.lightShow('off'));
    }
    const mode: LightMode = attract ? 'attract' : 'idle';
    if (mode !== this.lightSent) {
      this.lightSent = mode;
      this.safeFx(() => this.fx.lightShow(mode));
    }

    // Attract mode: a gentle LED glow and a sparkle around the call to action every few seconds.
    if (attract && dt > 0) {
      this.celebrate = Math.max(this.celebrate, this.effects.reducedMotion ? 0 : 0.18);
      const modal = this.deps.ui.getState().modal;
      if ((this.ctaTimer -= dt) <= 0 && modal === null) {
        this.ctaTimer = ATTRACT_TIMING.ctaSparkle * (this.effects.reducedMotion ? 2 : 1);
        this.burstAt('cta', this.ctaWorldPosition(_p, this.ctaSide++ % 3));
      }
    } else this.ctaTimer = 1.2;
  }

  /**
   * A point near the call to action (which is centred in the safe zone), just behind the glass:
   * alternately left of it, right of it and above it.
   */
  private ctaWorldPosition(out: Vector3, side: number): Vector3 {
    const hud = this.hud;
    // Same centre as src/ui/AttractOverlay.tsx: the safe zone, above a bar panel.
    const bottom = hud.panelStyle === 'bar' ? Math.min(hud.safeBottom, hud.panel.y - 10 * hud.unit) : hud.safeBottom;
    const ny = (hud.safeTop + bottom) / 2 / Math.max(1, hud.vh);
    const y = this.layout.top - ny * this.layout.height;
    const dx = Math.min(0.32, this.layout.width * 0.3);
    if (side === 0) return out.set(-dx, y, -0.06);
    if (side === 1) return out.set(dx, y, -0.06);
    return out.set(0, y + Math.min(0.2, this.layout.height * 0.18), -0.06);
  }

  private updateAudio(dt: number): void {
    const { audio } = this.deps;
    // Attract / demo mode: the engine plays a soft chime every 20–30 s (no-op when unchanged).
    audio.setAttract(this.attract.active);
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
    if ((source === 'neutral' || source === 'drag') && this.core.machine.phase === 'ATTRACT' && !this.effects.reducedMotion) {
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
      /** Points system: HUD state, player and demo totals. */
      score: () => ({ ui: this.deps.ui.getState().score, player: this.scores.totals(false), demo: this.scores.totals(true), popups: this.deps.ui.getState().scorePopups }),
      /** Attract mode and the idle timer. */
      attract: () => ({ active: this.attract.active, idleSeconds: this.idle.idleSeconds(), limit: this.committed.system.idleSeconds, light: this.lightSent }),
      /** Runs the idle reset now (as if nobody had touched the machine for system.idleSeconds). */
      idleReset: () => this.idleReset('debug'),
      claw: CLAW,
      /** The machine being played and its session (docs/design/machines.md, section 4.7). */
      machine: () => {
        const def = this.core.def;
        return {
          id: def.def.id,
          genre: def.def.genre,
          controls: def.controls,
          presentation: def.module.presentation,
          session: this.core.session.snapshot(),
          rules: this.core.controller.rules?.debugState?.() ?? null,
        };
      },
      /** Resolves when the switch has finished (false when it was refused). */
      selectMachine: (id: string) => Promise.resolve(isMachineId(id) ? this.selectMachine(id) : false),
      /** Test hooks of the machines; each call counts as input like the rest of the API. */
      machineDebug: {
        /** An impulse (N·s) on the bridge box, or else on the first item (tests only). */
        nudge: (dx: number, dz: number, dy = 0): boolean => {
          this.idle.touch();
          const items = [...this.core.phys.toys.values()].filter((t) => t.item && !t.inBin);
          const toy = items.find((t) => t.item!.kind === 'box') ?? items[0];
          if (!toy) return false;
          toy.body.applyImpulse({ x: dx, y: dy, z: dz }, true);
          return true;
        },
        /** The clock of a running timed session. */
        setSessionSeconds: (seconds: number): void => {
          this.idle.touch();
          this.core.session.setSecondsLeft(seconds);
        },
        /** "Call staff" on the field, at a round boundary only. */
        staffReset: (): boolean => {
          this.idle.touch();
          if (!this.core.machine.atRoundBoundary) return false;
          return this.core.field.staffReset?.() ?? false;
        },
        itemPoses: (): { id: string; look: string; pos: number[] }[] => {
          this.idle.touch();
          return [...this.core.phys.toys.values()].filter((t) => t.item).map((t) => ({ id: t.id, look: t.item!.look, pos: Array.from(t.pose.pos) }));
        },
      },
      /** Local rankings of a machine (filled in with the machine persistence). */
      rankings: (id?: string): { initials: string; score: number }[] => {
        void id;
        return [];
      },
      /** Today's pick (null until the daily pick exists). */
      dailyPick: (): string | null => null,
    };
    // Automation that drives the game through this API plays the role of a player: every call
    // counts as input for the idle reset (a slow software-rendered test run must not be reset to
    // attract mode between its steps). Only `attract()` observes the idle clock without touching it.
    const touched = api as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(touched)) {
      if (typeof value !== 'function' || key === 'attract') continue;
      const fn = value as (...args: unknown[]) => unknown;
      touched[key] = (...args: unknown[]) => {
        this.idle.touch();
        return fn(...args);
      };
    }
    (window as unknown as { __plush: typeof api }).__plush = api;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    screen.orientation?.removeEventListener?.('change', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
    for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, this.onActivity, { capture: true });
    for (const type of AUDIO_UNLOCK_EVENTS) window.removeEventListener(type, this.onAudioGesture, { capture: true });
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
