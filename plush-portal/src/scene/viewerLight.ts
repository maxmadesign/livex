import { Color, SpotLight, Vector3, type Matrix4 } from 'three';
import { FIELD } from '../physics/fieldSpec';
import type { GraphicsSettings } from '../settings/spec';
import type { ThemeDef } from '../themes/themes';
import { sceneKit } from './brandScene';

/**
 * The viewer light: a small lamp at the player's eye. The screen is a window into the cabinet, so
 * the player stands in front of the glass like someone in the arcade — and a little light from
 * where they stand shines in, lights the fronts of the toys and the back wall and throws soft
 * shadows of the claw and the toys behind them. When the eye moves (head tracking, drag-to-peek,
 * the attract sway) the light moves with it and the shadows shift: one more cue that the box is real.
 *
 * It follows exactly the eye the off-axis camera uses (Stage.setEyeWorld), so it is as smooth as the
 * view itself, but not from exactly the same point: a light at the eye throws every shadow straight
 * behind the object that casts it, where that eye can never see it. So the lamp sits a little above
 * the eye (VIEWER_LIFT, about eleven degrees, like a lamp on the player's brow) and leads it
 * sideways (VIEWER_LEAD): step left and the lamp swings a bit further left, so the shadows of the
 * claw and the toys visibly slide to the right over the mat and the back wall, and back again.
 * Both are constants; LIFT 0 and LEAD 1 put the lamp exactly at the eye.
 *
 * One SpotLight with one shadow map (a point light would need six), aimed at the middle of the play
 * field, with a wide soft edge. Pure presentation: no collider, no physics, no outcome.
 */

/** Where the light aims: the middle of the play volume. */
export const VIEWER_TARGET: Readonly<[number, number, number]> = [0, 0.3, -FIELD.depth * 0.5];
/** Radius (m) around the target that the cone lights fully; it fades out to `VIEWER_EDGE`. */
export const VIEWER_CORE = 0.62;
export const VIEWER_EDGE = 1.45;
/** Light reaching the target (the same at every viewing distance), relative units like the key light's. */
export const VIEWER_INTENSITY = 1.1;
/** How far above the eye the light sits, as a fraction of its distance to the target (0.2 ≈ 11°). */
export const VIEWER_LIFT = 0.2;
/** Sideways, the light moves this many times as far from the centre of the window as the eye. */
export const VIEWER_LEAD = 1.7;
/**
 * While the viewer light is on, the stage's unshadowed fill (sky / ground light and the studio
 * environment) is lowered by these factors, so the scene keeps about its brightness instead of
 * washing out, and the new shadows keep their contrast.
 */
export const VIEWER_FILL_SCALE = 0.6;
export const VIEWER_ENV_SCALE = 0.8;
/**
 * Brightness falls off with distance (decay 1, normalised at the target): the front of the cabinet
 * gets a little more than the back wall, as from a lamp close to the glass, without the harsh
 * fall-off a real point source at arm's length would have.
 */
export const VIEWER_DECAY = 1;

/**
 * Layer of meshes that cast only the viewer light's shadow: the shadow stand-ins of the sculpted
 * plaques on the back wall (CabinetBuilder, `cast: 'viewer'`). The viewer light's shadow camera sees
 * this layer; the key light's shadow camera and every camera that draws the picture do not, so a
 * stand-in is never drawn on screen, and the steep key light does not throw long streaks under the
 * plaques. Its map is drawn only when the eye or a toy moved, so the plaques cost nothing on a still frame.
 */
export const VIEWER_CASTER_LAYER = 30;

/** Shadow map per shadow quality: none on Off / Low (Safe), 1024 PCF on Medium, 2048 soft on High. */
export const VIEWER_SHADOW: Record<GraphicsSettings['shadows'], { size: number; radius: number; blurSamples: number }> = {
  off: { size: 0, radius: 0, blurSamples: 0 },
  low: { size: 0, radius: 0, blurSamples: 0 },
  medium: { size: 1024, radius: 2.5, blurSamples: 0 },
  high: { size: 2048, radius: 9, blurSamples: 12 },
};

/** Warm white for the themes, neutral white where a brand kit (or the circuit theme) dresses the cabinet. */
export function viewerLightColor(theme: ThemeDef): string {
  return sceneKit(theme) || theme.cabinet.pattern === 'circuit' ? '#ffffff' : '#ffeedd';
}

/**
 * Cone for an eye `distance` metres from the target: the half angle where the light ends, and the
 * penumbra (three.js: the fraction of that angle over which it fades) so that it is full strength
 * within VIEWER_CORE of the target.
 */
export function viewerCone(distance: number): { angle: number; penumbra: number } {
  const d = Math.max(0.05, distance);
  const angle = Math.min(1.25, Math.atan(VIEWER_EDGE / d));
  const inner = Math.min(angle * 0.95, Math.atan(VIEWER_CORE / d));
  return { angle, penumbra: Math.min(1, Math.max(0, 1 - inner / angle)) };
}

/**
 * How far a shadow caster must have moved since the viewer light's map was last drawn before it is
 * drawn again: half a millimetre, or 1/2000 in any rotation (and scale) term of its world matrix.
 */
export const CASTER_TOLERANCE = 0.0005;

/**
 * Tells the viewer light when one of its shadow casters (toys, the claw) moved. Each frame the
 * casters' world matrices are compared with those of the frame the map was last drawn with — not
 * with the previous frame and not rounded — so a slow creep still redraws it once it adds up to the
 * tolerance, while the sub-millimetre jitter of resting toys and of the claw hanging still never
 * does (rounded poses redrew it whenever such jitter crossed a rounding step).
 *
 * Only the toys and the claw are watched. Purely decorative animation (case fans, bobbing chips, the
 * LED wall, the plaques' stand-ins) is static or casts no shadow, so it never redraws the map.
 */
export class CasterWatch {
  private kept: number[] = [];
  private now: number[] = [];
  private version = 0;

  /** Starts this frame's list of casters. */
  begin(): void {
    this.now.length = 0;
  }

  /** Adds one caster (its world matrix; casters must come in the same order every frame). */
  add(matrixWorld: Matrix4): void {
    const e = matrixWorld.elements;
    this.now.push(e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!, e[12]!, e[13]!, e[14]!);
  }

  /** Adds every instance of an instanced caster (gems, coins, snack boxes: their world matrices). */
  addInstances(matrixWorld: Matrix4, instanceMatrices: ArrayLike<number>, count: number): void {
    this.add(matrixWorld);
    for (let i = 0; i < count; i++) {
      const o = i * 16;
      this.now.push(instanceMatrices[o]!, instanceMatrices[o + 1]!, instanceMatrices[o + 2]!, instanceMatrices[o + 4]!, instanceMatrices[o + 5]!, instanceMatrices[o + 6]!, instanceMatrices[o + 8]!, instanceMatrices[o + 9]!, instanceMatrices[o + 10]!, instanceMatrices[o + 12]!, instanceMatrices[o + 13]!, instanceMatrices[o + 14]!);
    }
  }

  /** A number that changes whenever a caster moved by more than the tolerance (or one came or went). */
  signature(): number {
    const now = this.now, kept = this.kept;
    let moved = now.length !== kept.length;
    for (let i = 0; !moved && i < now.length; i++) moved = Math.abs(now[i]! - kept[i]!) > CASTER_TOLERANCE;
    if (moved) this.version++;
    return this.version;
  }

  /** The map is being drawn with this frame's casters: later frames are compared with them. */
  keep(): void {
    const kept = this.kept;
    this.kept = this.now;
    this.now = kept;
  }
}

export class ViewerLight {
  readonly light: SpotLight;
  private enabled = true;
  private shadowSize = 0;
  private readonly eye = new Vector3(0, 0.5, 2);
  private lastSignature = Number.NaN;
  /** Diagnostics: shadow map renders so far. */
  shadowRenders = 0;

  /** `shadowLayer`: the shadow pre-pass layer of the Stage (its camera sees only lights). */
  constructor(shadowLayer: number) {
    const light = new SpotLight(0xffffff, VIEWER_INTENSITY, 0, 0.5, 0.5, VIEWER_DECAY);
    light.name = 'viewer-light';
    light.target.position.set(VIEWER_TARGET[0], VIEWER_TARGET[1], VIEWER_TARGET[2]);
    light.castShadow = false;
    const shadow = light.shadow;
    // Drawn only when the eye or something in the scene moved (see needsShadow).
    shadow.autoUpdate = false;
    shadow.needsUpdate = true;
    shadow.bias = -0.0006;
    shadow.normalBias = 0.004;
    // Concentrate the map's texels on the lit core of the cone.
    shadow.focus = 0.8;
    // A lit cabinet never has pitch-black shadows; this light is a modest fill.
    shadow.intensity = 0.95;
    shadow.camera.layers.enable(shadowLayer);
    shadow.camera.layers.enable(VIEWER_CASTER_LAYER);
    this.light = light;
    this.setEye(0, 0.5, 2);
  }

  /** Graphics settings: the light (graphics.viewerLight) and its shadow (graphics.shadows); `vsm` = High's soft maps. */
  setQuality(enabled: boolean, shadows: GraphicsSettings['shadows']): void {
    this.enabled = enabled;
    this.light.visible = enabled;
    const q = VIEWER_SHADOW[shadows];
    this.light.castShadow = enabled && q.size > 0;
    if (q.size > 0 && q.size !== this.shadowSize) {
      this.light.shadow.mapSize.set(q.size, q.size);
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
    }
    this.shadowSize = q.size;
    this.light.shadow.radius = q.radius;
    this.light.shadow.blurSamples = Math.max(1, q.blurSamples);
    this.light.shadow.bias = shadows === 'high' ? -0.0002 : -0.0006;
    this.invalidate();
  }

  setTheme(theme: ThemeDef): void {
    this.light.color = new Color(viewerLightColor(theme));
    this.invalidate();
  }

  /** The eye in world space (the off-axis camera's position): the light sits just above it and aims at the field. */
  setEye(x: number, y: number, z: number): void {
    this.eye.set(x, y, Math.max(0.05, z));
    const light = this.light;
    const eyeDistance = Math.hypot(VIEWER_TARGET[0] - x, VIEWER_TARGET[1] - y, VIEWER_TARGET[2] - this.eye.z);
    light.position.set(this.eye.x * VIEWER_LEAD, this.eye.y + eyeDistance * VIEWER_LIFT, this.eye.z);
    const p = light.position;
    const distance = Math.hypot(VIEWER_TARGET[0] - p.x, VIEWER_TARGET[1] - p.y, VIEWER_TARGET[2] - p.z);
    const cone = viewerCone(distance);
    light.angle = cone.angle;
    light.penumbra = cone.penumbra;
    // Same light at the target from any distance (decay normalised there).
    light.intensity = VIEWER_INTENSITY * Math.pow(distance, VIEWER_DECAY);
    // Depth range of the shadow camera: from just in front of the glass to behind the back wall.
    const camera = light.shadow.camera;
    const near = Math.max(0.03, p.z * 0.8 - 0.05);
    const far = distance + 1.6;
    if (Math.abs(camera.near - near) > 1e-6 || Math.abs(camera.far - far) > 1e-6) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
  }

  /** The eye the light follows (world space). */
  eyePosition(out: Vector3): Vector3 {
    return out.copy(this.eye);
  }

  /** The next shadow update must happen (new map size, theme, layout, context restored). */
  invalidate(): void {
    this.lastSignature = Number.NaN;
    this.light.shadow.needsUpdate = true;
  }

  /**
   * Called once per frame before the shadow pass with a number that changes whenever a shadow caster
   * moved (toys, claw; see CasterWatch). Marks the shadow map for an update when that number or the
   * eye changed, and returns whether it will be drawn.
   */
  needsShadow(sceneSignature: number): boolean {
    if (!this.enabled || !this.light.castShadow) return false;
    const e = this.eye;
    const signature = sceneSignature + e.x * 1.618 + e.y * 2.718 + e.z * 3.141;
    const shadow = this.light.shadow;
    if (signature !== this.lastSignature || !shadow.map || Number.isNaN(signature)) shadow.needsUpdate = true;
    this.lastSignature = signature;
    if (shadow.needsUpdate) this.shadowRenders++;
    return shadow.needsUpdate;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get shadowMapSize(): number {
    return this.light.castShadow ? this.shadowSize : 0;
  }

  dispose(): void {
    this.light.shadow.map?.dispose();
    this.light.removeFromParent();
    this.light.target.removeFromParent();
  }
}
