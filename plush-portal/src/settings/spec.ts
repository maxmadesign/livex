/**
 * Single source of truth for every persisted setting: default, valid range,
 * UI step and when a change takes effect. The sanitiser, the settings UI and
 * the import/export validation are all derived from this table.
 */
import { DISPLAY_PROFILE_IDS, LANGS, THEME_IDS, type DisplayProfileId, type Vec3 } from '../core/types';

/**
 * live    – applied immediately (and previewed while the settings dialog is open)
 * round   – authoritative gameplay/physics value; latched at the next round boundary
 * rebuild – needs the toy layout / scene to be rebuilt; queued until the round is over
 */
export type ApplyMode = 'live' | 'round' | 'rebuild';

export interface NumField {
  kind: 'num';
  def: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  apply: ApplyMode;
}
export interface BoolField {
  kind: 'bool';
  def: boolean;
  apply: ApplyMode;
}
export interface EnumField<T extends string = string> {
  kind: 'enum';
  def: T;
  options: readonly T[];
  apply: ApplyMode;
}
export interface StrField {
  kind: 'str';
  def: string;
  maxLen: number;
  apply: ApplyMode;
  /** Never written to exported configuration files. */
  noExport?: boolean;
}
export interface Vec3Field {
  kind: 'vec3';
  def: Vec3;
  min: number;
  max: number;
  step: number;
  unit?: string;
  apply: ApplyMode;
}
export interface StrListField {
  kind: 'strList';
  def: string[];
  maxItems: number;
  maxLen: number;
  apply: ApplyMode;
}
export interface JsonListField<T = unknown> {
  kind: 'jsonList';
  def: T[];
  maxItems: number;
  /** Returns a cleaned item or null to drop it. */
  sanitize: (item: unknown) => T | null;
  apply: ApplyMode;
}

export type Field = NumField | BoolField | EnumField | StrField | Vec3Field | StrListField | JsonListField;
export interface SpecGroup {
  [key: string]: Field | SpecGroup;
}

export type InferField<F> = F extends NumField
  ? number
  : F extends BoolField
    ? boolean
    : F extends EnumField<infer T>
      ? T
      : F extends StrField
        ? string
        : F extends Vec3Field
          ? Vec3
          : F extends StrListField
            ? string[]
            : F extends JsonListField<infer T>
              ? T[]
              : F extends SpecGroup
                ? { -readonly [K in keyof F]: InferField<F[K]> }
                : never;

const num = (def: number, min: number, max: number, step: number, apply: ApplyMode = 'live', unit?: string): NumField => ({
  kind: 'num',
  def,
  min,
  max,
  step,
  unit,
  apply,
});
const bool = (def: boolean, apply: ApplyMode = 'live'): BoolField => ({ kind: 'bool', def, apply });
const en = <T extends string>(def: T, options: readonly T[], apply: ApplyMode = 'live'): EnumField<T> => ({
  kind: 'enum',
  def,
  options,
  apply,
});
const str = (def: string, maxLen: number, apply: ApplyMode = 'live', noExport = false): StrField => ({
  kind: 'str',
  def,
  maxLen,
  apply,
  noExport,
});
const vec3 = (def: Vec3, min: number, max: number, step: number, apply: ApplyMode = 'live', unit?: string): Vec3Field => ({
  kind: 'vec3',
  def,
  min,
  max,
  step,
  unit,
  apply,
});
const strList = (maxItems: number, maxLen: number, apply: ApplyMode = 'live'): StrListField => ({
  kind: 'strList',
  def: [],
  maxItems,
  maxLen,
  apply,
});

/* ------------------------------------------------------------ custom models */

/** A locally imported GLB that replaces the visual of one character slot. */
export interface CustomModelEntry {
  /** Manifest id of the character slot that is replaced. */
  slotId: string;
  /** Key of the binary in IndexedDB (never the data itself). */
  fileKey: string;
  fileName: string;
  displayName: string;
  /** Uniform scale applied after auto-fitting to the slot's size. */
  scale: number;
  /** Rotation around Y in degrees so the model faces the glass. */
  yawDeg: number;
  bytes: number;
}

function sanitizeCustomModel(item: unknown): CustomModelEntry | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  if (typeof o.slotId !== 'string' || typeof o.fileKey !== 'string') return null;
  const n = (v: unknown, d: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  return {
    slotId: o.slotId.slice(0, 64),
    fileKey: o.fileKey.slice(0, 96),
    fileName: typeof o.fileName === 'string' ? o.fileName.slice(0, 120) : 'model.glb',
    displayName: typeof o.displayName === 'string' ? o.displayName.slice(0, 60) : '',
    scale: n(o.scale, 1, 0.5, 2),
    yawDeg: n(o.yawDeg, 0, -180, 180),
    bytes: n(o.bytes, 0, 0, 64 * 1024 * 1024),
  };
}

/* -------------------------------------------------------- per-display profile */

interface ProfileDefaults {
  safeTop: number;
  safeBottom: number;
  anchorY: number;
  panelWidth: number;
  uiScale: number;
  touchSize: number;
  floorY: number;
  screenW: number;
  screenH: number;
  bottomElevation: number;
  windowMode: 'fullscreen' | 'window';
  eye: Vec3;
  camPos: Vec3;
  camPitch: number;
  maxOffset: Vec3;
  minDistance: number;
  /** Side / top-bottom margin as a fraction of the viewport (default 0.035 / 0.02). */
  marginX?: number;
  marginY?: number;
  /**
   * Portrait kiosk presets: 'simulate916' shows the game in a centred 9:16 box that stands for the
   * real screen when the browser window has another shape (src/layout/frame.ts). Default 'fill'.
   */
  frame?: 'simulate916' | 'fill';
}

function profileSpec(d: ProfileDefaults) {
  return {
    layout: {
      /** Shrinks / moves UI automatically so it always fits the viewport and never covers the toys. */
      autoFit: bool(true),
      /** Interactive safe zone, normalised screen Y (0 = top, 1 = bottom). */
      safeTop: num(d.safeTop, 0, 0.6, 0.01),
      safeBottom: num(d.safeBottom, 0.4, 1, 0.01),
      /** Normalised Y of the centre of the main control panel. */
      anchorY: num(d.anchorY, 0.2, 0.95, 0.005),
      /** Control panel width as a fraction of the viewport width. */
      panelWidth: num(d.panelWidth, 0.3, 1, 0.01),
      uiScale: num(d.uiScale, 0.4, 1.8, 0.01),
      fontScale: num(1, 0.75, 1.6, 0.01),
      /** Minimum touch target in design pixels (1080 px wide portrait / 1920 px wide desktop reference). */
      touchSize: num(d.touchSize, 56, 180, 2, 'live', 'px'),
      marginX: num(d.marginX ?? 0.035, 0, 0.15, 0.005),
      marginY: num(d.marginY ?? 0.02, 0, 0.15, 0.005),
      handedness: en('right', ['right', 'left'] as const),
      hudDensity: en('standard', ['minimal', 'standard', 'rich'] as const),
      showGuides: bool(false),
      /** Normalised Y of the front edge of the play floor in the 3D scene. */
      floorY: num(d.floorY, 0.3, 0.85, 0.005),
      /**
       * simulate916: lay the game out in the largest centred 9:16 box of the browser window and treat
       * that box as the preset's whole physical screen (portrait presets only; ignored elsewhere).
       * fill: use the whole browser window, whatever its shape.
       */
      frame: en(d.frame ?? 'fill', ['simulate916', 'fill'] as const),
    },
    view: {
      /** Physical size of the full screen in metres (phones go down to ~0.06 m). */
      screenW: num(d.screenW, 0.04, 4, 0.001, 'live', 'm'),
      screenH: num(d.screenH, 0.04, 4, 0.001, 'live', 'm'),
      /** Height of the bottom edge of the screen above the floor (installation note, used for eye-height hints). */
      bottomElevation: num(d.bottomElevation, 0, 2.5, 0.01, 'live', 'm'),
      /**
       * fullscreen: the game canvas covers the whole physical screen.
       * window: the canvas is a browser window on the screen; its physical size is derived from CSS pixels.
       */
      windowMode: en(d.windowMode, ['fullscreen', 'window'] as const),
      /** Reference (neutral) eye position relative to the centre of the window, metres. */
      eye: vec3(d.eye, -3, 5, 0.01, 'live', 'm'),
      /** Camera position relative to the centre of the screen, metres. */
      camPos: vec3(d.camPos, -3, 3, 0.005, 'live', 'm'),
      /** Camera tilt: positive pitch looks down, positive yaw looks to the viewer's right. */
      camPitch: num(d.camPitch, -60, 60, 0.5, 'live', '°'),
      camYaw: num(0, -60, 60, 0.5, 'live', '°'),
      camRoll: num(0, -45, 45, 0.5, 'live', '°'),
      /** Sensor rotation for cameras mounted sideways. */
      camRotation: en('0', ['0', '90', '180', '270'] as const),
      /** Horizontal field of view of the unrotated camera frame. */
      hfov: num(63, 30, 130, 0.5, 'live', '°'),
      /** Enable when the camera itself already delivers a mirrored image. */
      mirror: bool(false),
      /** absolute: use the measured eye position directly. relative: offsets from the calibrated neutral pose. */
      mode: en('relative', ['relative', 'absolute'] as const),
      gainX: num(1, 0, 3, 0.05),
      gainY: num(1, 0, 3, 0.05),
      gainZ: num(1, 0, 3, 0.05),
      /** Largest allowed offset from the reference eye, metres. */
      maxOffset: vec3(d.maxOffset, 0.02, 2, 0.01, 'live', 'm'),
      minDistance: num(d.minDistance, 0.15, 2, 0.01, 'live', 'm'),
      /** Distance from the screen at which the quick calibration is taken. */
      refDistance: num(d.eye[2], 0.2, 5, 0.01, 'live', 'm'),
      /** Calibration results (written by the calibration routine, editable for experts). */
      calibrated: bool(false),
      /** focal length (px, at the reference frame width) × inter-pupillary distance (m); 0 = derive from hfov. */
      calDepthK: num(0, 0, 500, 0.01),
      /** Measured eye position (window coordinates, metres) that corresponds to the neutral pose. */
      calNeutral: vec3(d.eye, -5, 5, 0.001, 'live', 'm'),
    },
  } as const satisfies SpecGroup;
}

const PROFILE_DEFAULTS: Record<DisplayProfileId, ProfileDefaults> = {
  desktop: {
    safeTop: 0,
    safeBottom: 1,
    anchorY: 0.84,
    panelWidth: 0.94,
    uiScale: 1,
    touchSize: 84,
    floorY: 0.69,
    // 24" 16:9 monitor as a starting point; the real size can be entered in Camera & Parallax.
    screenW: 0.531,
    screenH: 0.299,
    bottomElevation: 0.95,
    windowMode: 'window',
    eye: [0, 0.14, 0.62],
    camPos: [0, 0.16, 0],
    camPitch: 4,
    maxOffset: [0.3, 0.22, 0.3],
    minDistance: 0.3,
  },
  portrait32: {
    safeTop: 0,
    safeBottom: 1,
    anchorY: 0.865,
    panelWidth: 0.94,
    uiScale: 1,
    touchSize: 104,
    floorY: 0.6,
    // Nominal 32" 9:16 panel.
    screenW: 0.398,
    screenH: 0.708,
    bottomElevation: 1.0,
    windowMode: 'fullscreen',
    frame: 'simulate916',
    eye: [0, 0.2, 0.62],
    camPos: [0, 0.37, 0],
    camPitch: 8,
    maxOffset: [0.4, 0.3, 0.35],
    minDistance: 0.3,
  },
  portrait86: {
    safeTop: 0.25,
    safeBottom: 0.75,
    anchorY: 0.6,
    panelWidth: 0.6,
    uiScale: 0.66,
    touchSize: 100,
    floorY: 0.48,
    // Nominal 86" 9:16 panel.
    screenW: 1.071,
    screenH: 1.904,
    bottomElevation: 0.12,
    windowMode: 'fullscreen',
    frame: 'simulate916',
    eye: [0, 0.5, 0.95],
    camPos: [0, 0.98, 0],
    camPitch: 18,
    maxOffset: [0.7, 0.5, 0.55],
    minDistance: 0.45,
  },
  // Phone, mostly held sideways (src/layout/solve.ts → solvePhone). Design units are phone units
  // (600 on the short side), so touchSize 100 ≈ 56–68 CSS px. Docked at the bottom (anchor 0.86).
  mobile: {
    safeTop: 0,
    safeBottom: 1,
    anchorY: 0.86,
    panelWidth: 1,
    uiScale: 1,
    touchSize: 100,
    floorY: 0.7,
    marginX: 0.02,
    marginY: 0.025,
    // Nominal 6.1" 19.5:9 phone sideways (PHONE_NOMINAL_SCREEN in src/perspective/windowGeometry.ts):
    // left at exactly this size, the real size is estimated from the phone's CSS pixels.
    screenW: 0.141,
    screenH: 0.065,
    bottomElevation: 1.1,
    windowMode: 'window',
    // Held in the hands about 35 cm from the eyes; front camera at the left end when the top of
    // the phone points left (the usual way to turn it).
    eye: [0, 0, 0.35],
    camPos: [-0.065, 0, 0],
    camPitch: 0,
    maxOffset: [0.12, 0.09, 0.15],
    minDistance: 0.18,
  },
};

/* ------------------------------------------------------------------- the spec */

export const SETTINGS_VERSION = 1;

export const settingsSpec = {
  system: {
    language: en('en', LANGS),
    /** In attract mode the machine plays clearly labelled demo rounds by itself (nothing is counted). */
    attractDemo: bool(true),
    /**
     * Seconds without any player input before the machine fully resets to the self-playing
     * attract / demo mode (score, open dialogs, round). 0 = never. Replaces the former
     * `attractIdleSec` (a customised old value is migrated in src/settings/store.ts).
     */
    idleSeconds: num(60, 0, 600, 5, 'live', 's'),
    reducedMotion: en('system', ['system', 'on', 'off'] as const),
    /** Public display lock: players get a reduced options panel; full settings need the PIN. */
    lockSettings: bool(false),
    lockPin: str('', 8, 'live', true),
    /** Diagnostics overlay with safe, redacted logs. */
    verboseLog: bool(false),
  },
  display: {
    /** '' until the player (or ?display=) picked a preset. */
    profile: en('' as '' | DisplayProfileId, ['', ...DISPLAY_PROFILE_IDS] as const),
  },
  profiles: {
    desktop: profileSpec(PROFILE_DEFAULTS.desktop),
    portrait32: profileSpec(PROFILE_DEFAULTS.portrait32),
    portrait86: profileSpec(PROFILE_DEFAULTS.portrait86),
    /** Phone (landscape first, upright also playable): its own layout and viewing geometry, see docs/DISPLAYS.md. */
    mobile: profileSpec(PROFILE_DEFAULTS.mobile),
  },
  gameplay: {
    difficulty: en('arcade', ['easy', 'arcade', 'skill', 'custom'] as const, 'round'),
    /** Trolley top speed, m/s. */
    moveSpeed: num(0.42, 0.15, 0.9, 0.01, 'round', 'm/s'),
    moveAccel: num(2.4, 0.5, 8, 0.1, 'round', 'm/s²'),
    descendSpeed: num(0.55, 0.2, 1.2, 0.01, 'round', 'm/s'),
    liftSpeed: num(0.42, 0.15, 1, 0.01, 'round', 'm/s'),
    /** Finger motor strength multiplier. */
    clawForce: num(1, 0.3, 2, 0.05, 'round'),
    /** Finger closing speed multiplier. */
    closeSpeed: num(1, 0.4, 2.5, 0.05, 'round'),
    /** Strength of the limited, slippable grip assist that is created after real multi-finger contact. 0 = pure friction. */
    gripAssist: num(1, 0, 1.5, 0.05, 'round'),
    /** 0 = stiff cable, 1 = free swinging cable. */
    ropeSwing: num(0.55, 0, 1.5, 0.05, 'round'),
    toyFriction: num(1, 0.4, 1.6, 0.05, 'round'),
    toyMass: num(1, 0.6, 1.8, 0.05, 'rebuild'),
    /** 0 = no time limit while aiming. */
    aimTimeLimit: num(0, 0, 60, 1, 'round', 's'),
    restock: en('afterWin', ['afterWin', 'whenLow', 'manual'] as const, 'round'),
    /** Number of toys on the play field. */
    toyCount: num(18, 6, 30, 1, 'rebuild'),
    /** Soft target ring under the claw. */
    aimReticle: bool(true),
    /** Thin guide line from the claw to the reticle. */
    aimBeam: bool(true),
    tips: bool(true),
    /** Points system (score, combos, rarity bonuses) on or off. Presentation only: it never changes physics or outcomes. */
    scoring: bool(true),
  },
  themes: {
    current: en('sakura', THEME_IDS, 'rebuild'),
    /** Character type ids the player switched off. */
    disabledToys: strList(48, 64, 'rebuild'),
    toyScale: num(0.92, 0.8, 1.25, 0.01, 'rebuild'),
    /** 0 = one tidy layer, 1 = a tall pile. */
    stackDensity: num(0.2, 0, 1, 0.05, 'rebuild'),
    customModels: {
      kind: 'jsonList',
      def: [],
      maxItems: 24,
      sanitize: sanitizeCustomModel,
      apply: 'rebuild',
    } as JsonListField<CustomModelEntry>,
  },
  graphics: {
    preset: en('medium', ['safe', 'medium', 'high', 'ultra', 'custom'] as const),
    /** Automatically lowers expensive effects / internal resolution to hold the target frame rate. */
    autoOptimize: bool(true),
    /** Internal 3D resolution relative to native device pixels (the DOM HUD always stays native). */
    renderScale: num(1, 0.35, 1.5, 0.05),
    /** Upper bound for the 3D pixel count, megapixels. */
    maxPixels: num(2.1, 0.4, 8.3, 0.1, 'live', 'MP'),
    /** Highest device pixel ratio the 3D view uses (phones report 3 or more; Safe caps it at 1.25). */
    maxDpr: num(2, 0.75, 4, 0.25, 'live', '×'),
    targetFps: en('60', ['30', '60', '120'] as const),
    lod: en('medium', ['low', 'medium', 'high'] as const),
    textures: en('1k', ['512', '1k', '2k', '4k'] as const),
    shadows: en('medium', ['off', 'low', 'medium', 'high'] as const),
    ao: en('off', ['off', 'low', 'high'] as const),
    glass: en('medium', ['low', 'medium', 'high'] as const),
    reflections: en('static', ['static', 'refresh', 'live'] as const),
    fur: en('shell', ['flat', 'sheen', 'shell', 'shellHigh'] as const),
    deform: en('basic', ['basic', 'fine', 'ultra'] as const),
    aa: en('fxaa', ['off', 'fxaa', 'smaa', 'msaa2', 'msaa4'] as const),
    bloom: num(0.25, 0, 1, 0.05),
    particles: num(60, 0, 300, 10),
    /** Multiplier for particle bursts and light effects (grab, win, combo, attract). 0 = none. */
    fxIntensity: num(1, 0, 1.5, 0.05),
    /** Moving light show on wins and in attract mode. */
    lightShow: bool(true),
    exposure: num(1, 0.6, 1.6, 0.02),
    toneMapping: en('neutral', ['aces', 'agx', 'neutral'] as const),
    dof: bool(false),
    motionBlur: bool(false),
    perfPanel: bool(false),
  },
  audio: {
    master: num(0.8, 0, 1, 0.01),
    music: num(0.55, 0, 1, 0.01),
    sfx: num(0.8, 0, 1, 0.01),
    voice: num(0.9, 0, 1, 0.01),
    muted: bool(false),
    track: en('theme', ['theme', ...THEME_IDS] as const),
    ducking: num(0.6, 0, 1, 0.05),
    outputDevice: str('', 256, 'live', true),
    /** A soft chime every 20–30 s while the machine shows its attract / demo mode. */
    attractChime: bool(true),
  },
  ai: {
    enabled: bool(true),
    subtitles: bool(true),
    voice: bool(true),
    /** 'openai' uses the server proxy when a key is configured; 'local' always uses the built-in lines. */
    provider: en('openai', ['openai', 'local'] as const),
    /** Empty = use the server's configured model. */
    model: str('', 80),
    speechModel: str('', 80),
    voiceName: str('', 40),
    voiceSpeed: num(1, 0.7, 1.3, 0.05),
    /**
     * Momo's language (subtitles, GPT lines, local lines and voice): 'en' = always English, whatever
     * the UI language; 'ui' = follow the UI language. Replaces the older `ai.language` (dropped on load).
     */
    voiceLanguage: en('en', ['en', 'ui'] as const),
    personality: str('', 400),
    /** Empty = built-in Momo prompt. */
    systemPrompt: str('', 4000),
    frequency: en('normal', ['quiet', 'normal', 'chatty'] as const),
    length: en('short', ['short', 'medium'] as const),
    timeoutMs: num(2500, 800, 8000, 100, 'live', 'ms'),
    cache: en('session', ['off', 'session', 'persistent'] as const),
    /** Voice used when no AI voice is available. */
    localVoice: en('babble', ['babble', 'system', 'none'] as const),
    /** Only sent to models that accept it. */
    temperature: num(0.9, 0, 1.5, 0.05),
  },
  camera: {
    /** Head Tracking / Window Perspective. */
    enabled: bool(true),
    deviceId: str('', 256, 'live', true),
    resolution: en('480p', ['360p', '480p', '720p'] as const),
    inferenceHz: num(18, 5, 30, 1, 'live', 'Hz'),
    numFaces: num(2, 1, 4, 1),
    delegate: en('auto', ['auto', 'gpu', 'cpu'] as const),
    /** Time constant of the per-frame follow smoothing. */
    smoothMs: num(70, 0, 400, 5, 'live', 'ms'),
    /** One Euro filter parameters (position in metres). */
    filterMinCutoff: num(1.4, 0.2, 6, 0.1, 'live', 'Hz'),
    filterBeta: num(6, 0, 40, 0.5),
    deadzoneMm: num(2, 0, 25, 0.5, 'live', 'mm'),
    /** Jumps larger than this between two samples are treated as outliers unless they persist. */
    outlierM: num(0.35, 0.05, 1.5, 0.01, 'live', 'm'),
    lostHoldMs: num(700, 100, 4000, 50, 'live', 'ms'),
    returnMs: num(1500, 200, 6000, 50, 'live', 'ms'),
    reacquireMs: num(450, 50, 2500, 50, 'live', 'ms'),
    /** When the camera starts, count down and take the player's current head position / direction as the neutral baseline. */
    autoCalibrate: bool(true),
    /** Length of that countdown. */
    calibrationSeconds: num(3, 1, 10, 1, 'live', 's'),
    /** Head-turn effect: turning the head (relative to the baseline) also shifts the view that way. 0 = off. */
    headWeight: num(0.4, 0, 1.5, 0.05),
    /** auto: lower camera resolution / tracking rate / faces on phones and low-power devices; on / off force it. */
    lowPower: en('auto', ['auto', 'on', 'off'] as const),
    /**
     * Head-direction baseline per display preset (degrees), written by the countdown calibration:
     * how far the player's head was turned (yaw, + = to their right) and tilted (pitch, + = up)
     * relative to facing the centre of the game window. The eye-position baseline of the same
     * calibration is `profiles.<id>.view.calNeutral`. Only used while that preset is calibrated.
     */
    headBaseline: {
      desktop: { yaw: num(0, -60, 60, 0.1, 'live', '°'), pitch: num(0, -60, 60, 0.1, 'live', '°') },
      portrait32: { yaw: num(0, -60, 60, 0.1, 'live', '°'), pitch: num(0, -60, 60, 0.1, 'live', '°') },
      portrait86: { yaw: num(0, -60, 60, 0.1, 'live', '°'), pitch: num(0, -60, 60, 0.1, 'live', '°') },
      mobile: { yaw: num(0, -60, 60, 0.1, 'live', '°'), pitch: num(0, -60, 60, 0.1, 'live', '°') },
    },
  },
} as const satisfies SpecGroup;

export type Settings = InferField<typeof settingsSpec>;
export type ProfileSettings = Settings['profiles'][DisplayProfileId];
export type LayoutSettings = ProfileSettings['layout'];
export type ViewSettings = ProfileSettings['view'];
export type GameplaySettings = Settings['gameplay'];
export type GraphicsSettings = Settings['graphics'];
export type AudioSettings = Settings['audio'];
export type AiSettings = Settings['ai'];
export type CameraSettings = Settings['camera'];

/**
 * Graphics values that belong to the quality presets but were added after presets were
 * already stored. `src/app/presets.ts` builds GRAPHICS_PRESETS from this table. When a stored
 * or imported configuration has a named preset but lacks one of these keys, the key takes its
 * preset's value instead of the plain default (an upgraded "Safe" install stays light and the
 * highlighted preset stays true). Keys added to the presets later go here as well.
 */
export const GRAPHICS_PRESET_ADDITIONS = {
  safe: { fxIntensity: 0.5, lightShow: false, maxDpr: 1.25 },
  medium: { fxIntensity: 1, lightShow: true, maxDpr: 2 },
  high: { fxIntensity: 1.2, lightShow: true, maxDpr: 3 },
  ultra: { fxIntensity: 1.5, lightShow: true, maxDpr: 3 },
} as const satisfies Record<Exclude<GraphicsSettings['preset'], 'custom'>, Partial<GraphicsSettings>>;

/** Fills preset-owned graphics keys missing from older data with the stored preset's values. */
function fillPresetAdditions(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const graphics = (input as { graphics?: unknown }).graphics;
  if (!graphics || typeof graphics !== 'object' || Array.isArray(graphics)) return input;
  const g = graphics as Record<string, unknown>;
  const values = (GRAPHICS_PRESET_ADDITIONS as Record<string, Record<string, unknown>>)[String(g.preset)];
  if (!values) return input;
  const missing = Object.keys(values).filter((key) => g[key] === undefined);
  if (missing.length === 0) return input;
  const filled = { ...g };
  for (const key of missing) filled[key] = values[key];
  return { ...(input as Record<string, unknown>), graphics: filled };
}

/* ----------------------------------------------------------------- utilities */

export function isField(node: Field | SpecGroup): node is Field {
  return typeof (node as Field).kind === 'string' && 'def' in node;
}

function defaultOf(node: Field | SpecGroup): unknown {
  if (isField(node)) {
    if (node.kind === 'vec3') return [...node.def];
    if (node.kind === 'strList' || node.kind === 'jsonList') return [...node.def];
    return node.def;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node)) out[key] = defaultOf(node[key]!);
  return out;
}

export function defaultSettings(): Settings {
  return defaultOf(settingsSpec) as Settings;
}

function roundToStep(v: number, f: { min: number; step: number }): number {
  if (!(f.step > 0)) return v;
  const n = Math.round((v - f.min) / f.step);
  // Avoid 0.30000000000000004 style noise.
  return Number((f.min + n * f.step).toFixed(6));
}

export function sanitizeField(field: Field, value: unknown): unknown {
  switch (field.kind) {
    case 'num': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return field.def;
      return Math.min(field.max, Math.max(field.min, roundToStep(value, field)));
    }
    case 'bool':
      return typeof value === 'boolean' ? value : field.def;
    case 'enum':
      return typeof value === 'string' && (field.options as readonly string[]).includes(value) ? value : field.def;
    case 'str':
      return typeof value === 'string' ? value.slice(0, field.maxLen) : field.def;
    case 'vec3': {
      if (!Array.isArray(value) || value.length !== 3) return [...field.def];
      return value.map((v, i) =>
        typeof v === 'number' && Number.isFinite(v) ? Math.min(field.max, Math.max(field.min, v)) : field.def[i]!,
      );
    }
    case 'strList': {
      if (!Array.isArray(value)) return [...field.def];
      const seen = new Set<string>();
      for (const item of value) {
        if (typeof item === 'string' && item.length > 0 && seen.size < field.maxItems) seen.add(item.slice(0, field.maxLen));
      }
      return [...seen];
    }
    case 'jsonList': {
      if (!Array.isArray(value)) return [...field.def];
      const out: unknown[] = [];
      for (const item of value) {
        if (out.length >= field.maxItems) break;
        const clean = field.sanitize(item);
        if (clean !== null) out.push(clean);
      }
      return out;
    }
  }
}

function sanitizeNode(node: Field | SpecGroup, value: unknown): unknown {
  if (isField(node)) return sanitizeField(node, value);
  const src = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node)) out[key] = sanitizeNode(node[key]!, src[key]);
  return out;
}

/** Cross-field rules that keep the UI reachable no matter what was imported. */
function enforceInvariants(s: Settings): Settings {
  for (const id of DISPLAY_PROFILE_IDS) {
    const layout = s.profiles[id].layout;
    if (layout.safeBottom - layout.safeTop < 0.3) {
      const mid = Math.min(0.85, Math.max(0.15, (layout.safeBottom + layout.safeTop) / 2));
      layout.safeTop = Number(Math.max(0, mid - 0.15).toFixed(3));
      layout.safeBottom = Number(Math.min(1, mid + 0.15).toFixed(3));
    }
    // The main panel anchor must stay inside the interactive zone.
    layout.anchorY = Math.min(layout.safeBottom - 0.04, Math.max(layout.safeTop + 0.04, layout.anchorY));
    const view = s.profiles[id].view;
    // The reference eye must stay in front of the screen and beyond the minimum distance.
    if (view.eye[2] < view.minDistance) view.eye[2] = view.minDistance;
    if (view.calNeutral[2] < 0.1) view.calNeutral[2] = view.eye[2];
  }
  return s;
}

/** Returns a complete, valid settings object from arbitrary input (unknown keys are dropped). */
export function sanitizeSettings(input: unknown): Settings {
  return enforceInvariants(sanitizeNode(settingsSpec, fillPresetAdditions(input)) as Settings);
}

export function getFieldAt(path: string): Field | null {
  let node: Field | SpecGroup = settingsSpec;
  for (const part of path.split('.')) {
    if (isField(node)) return null;
    const next: Field | SpecGroup | undefined = (node as SpecGroup)[part];
    if (!next) return null;
    node = next;
  }
  return isField(node) ? node : null;
}

export function getValueAt(settings: Settings, path: string): unknown {
  let node: unknown = settings;
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Immutable set: returns a new settings object with `path` replaced (value is sanitised against the spec). */
export function setValueAt(settings: Settings, path: string, value: unknown): Settings {
  const field = getFieldAt(path);
  if (!field) return settings;
  const clean = sanitizeField(field, value);
  const parts = path.split('.');
  const root: Record<string, unknown> = { ...(settings as unknown as Record<string, unknown>) };
  let cursor = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const child = { ...(cursor[key] as Record<string, unknown>) };
    cursor[key] = child;
    cursor = child;
  }
  cursor[parts[parts.length - 1]!] = clean;
  return enforceInvariants(root as unknown as Settings);
}

/** Lists every leaf path in the spec, e.g. "gameplay.moveSpeed". */
export function listFieldPaths(node: Field | SpecGroup = settingsSpec, prefix = ''): string[] {
  if (isField(node)) return [prefix];
  const out: string[] = [];
  for (const key of Object.keys(node)) out.push(...listFieldPaths(node[key]!, prefix ? `${prefix}.${key}` : key));
  return out;
}

/** Paths whose values differ between two settings objects. */
export function diffSettings(a: Settings, b: Settings): string[] {
  const changed: string[] = [];
  for (const path of listFieldPaths()) {
    const va = getValueAt(a, path);
    const vb = getValueAt(b, path);
    if (va === vb) continue;
    if (JSON.stringify(va) !== JSON.stringify(vb)) changed.push(path);
  }
  return changed;
}

export function profileDefaults(id: DisplayProfileId): ProfileSettings {
  return defaultOf(settingsSpec.profiles[id]) as ProfileSettings;
}

/** Strips fields that must never leave the device. */
export function exportableSettings(settings: Settings): unknown {
  const strip = (node: Field | SpecGroup, value: unknown): unknown => {
    if (isField(node)) return node.kind === 'str' && node.noExport ? undefined : value;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node)) {
      const v = strip(node[key]!, (value as Record<string, unknown>)[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  };
  return strip(settingsSpec, settings);
}
