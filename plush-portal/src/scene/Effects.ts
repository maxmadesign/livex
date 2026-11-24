import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Points,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { makeRng } from '../core/math';
import { FIELD } from '../physics/fieldSpec';
import type { ParticleKind, ThemeDef } from '../themes/themes';

const MAX_PARTICLES = 420;
const KIND_INDEX: Record<ParticleKind, number> = { petals: 0, confetti: 1, bubbles: 2, stars: 3 };

interface Particle {
  alive: boolean;
  ambient: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  rot: number;
  spin: number;
  seed: number;
  color: Color;
}

/**
 * Lightweight effects that never touch gameplay: the aim reticle and beam,
 * a few drifting ambient motes and the theme's celebration burst.
 */
export class Effects {
  readonly group = new Group();
  private readonly reticle: Mesh;
  private readonly reticleDot: Mesh;
  private readonly beam: Mesh;
  private readonly points: Points;
  private readonly material: ShaderMaterial;
  private readonly particles: Particle[] = [];
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly colors = new Float32Array(MAX_PARTICLES * 4);
  private readonly params = new Float32Array(MAX_PARTICLES * 3);
  private theme: ThemeDef | null = null;
  private ambientTarget = 0;
  private burstBudget = 60;
  private rng = makeRng(1234);
  private time = 0;
  reducedMotion = false;
  /** Hints selected in the gameplay settings. */
  showReticle = true;
  showBeam = true;

  constructor() {
    this.group.name = 'effects';
    const ringMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    this.reticle = new Mesh(new RingGeometry(0.036, 0.044, 48), ringMat);
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.renderOrder = 20;
    this.reticle.userData.skipAO = true;
    this.reticleDot = new Mesh(new RingGeometry(0, 0.007, 20), ringMat.clone());
    this.reticleDot.rotation.x = -Math.PI / 2;
    this.reticleDot.renderOrder = 20;
    this.reticleDot.userData.skipAO = true;
    const beamMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false });
    this.beam = new Mesh(new CylinderGeometry(0.0022, 0.0022, 1, 6, 1, true), beamMat);
    this.beam.renderOrder = 19;
    this.beam.userData.skipAO = true;
    this.group.add(this.reticle, this.reticleDot, this.beam);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ alive: false, ambient: false, x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 0.01, rot: 0, spin: 0, seed: 0, color: new Color() });
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('aColor', new BufferAttribute(this.colors, 4));
    geometry.setAttribute('aParams', new BufferAttribute(this.params, 3));
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: { uKind: { value: 0 }, uPixelsPerUnit: { value: 800 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute vec3 aParams; // size (m), rotation, seed
        uniform float uPixelsPerUnit;
        varying vec4 vColor;
        varying float vRot;
        varying float vSeed;
        void main() {
          vColor = aColor;
          vRot = aParams.y;
          vSeed = aParams.z;
          vec4 mv = modelViewMatrix * vec4( position, 1.0 );
          gl_Position = projectionMatrix * mv;
          // projectionMatrix[1][1] * size / depth gives the size in NDC; convert to pixels.
          gl_PointSize = max( 1.0, aParams.x * projectionMatrix[ 1 ][ 1 ] / max( - mv.z, 0.05 ) * uPixelsPerUnit );
        }`,
      fragmentShader: /* glsl */ `
        uniform int uKind;
        varying vec4 vColor;
        varying float vRot;
        varying float vSeed;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float c = cos( vRot ), s = sin( vRot );
          vec2 q = vec2( c * p.x - s * p.y, s * p.x + c * p.y );
          float a;
          if ( uKind == 0 ) { // petal: a rounded teardrop that tumbles
            float tumble = 0.45 + 0.55 * abs( sin( vRot * 1.7 + vSeed ) );
            vec2 e = vec2( q.x / 0.62, ( q.y + 0.08 * q.x * q.x ) / tumble );
            a = 1.0 - smoothstep( 0.8, 1.0, length( e ) + 0.18 * e.y );
          } else if ( uKind == 1 ) { // confetti: a thin rectangle seen at an angle
            float flip = 0.25 + 0.75 * abs( sin( vRot * 2.3 + vSeed ) );
            vec2 d = abs( q ) - vec2( 0.78, 0.4 * flip );
            a = 1.0 - smoothstep( 0.0, 0.1, max( d.x, d.y ) );
          } else if ( uKind == 2 ) { // bubble: thin rim with a highlight
            float r = length( p );
            a = smoothstep( 1.0, 0.9, r ) * ( 0.16 + smoothstep( 0.62, 0.92, r ) * 0.7 );
            a += smoothstep( 0.2, 0.0, length( p - vec2( -0.36, -0.4 ) ) ) * 0.7;
          } else { // four-point sparkle
            vec2 d = abs( q );
            a = smoothstep( 1.0, 0.0, pow( d.x, 0.5 ) + pow( d.y, 0.5 ) ) * 1.6 + smoothstep( 0.35, 0.0, length( q ) );
          }
          a = clamp( a, 0.0, 1.0 ) * vColor.a;
          if ( a < 0.01 ) discard;
          gl_FragColor = vec4( vColor.rgb, a );
        }`,
    });
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 30;
    this.points.userData.skipAO = true;
    this.group.add(this.points);
  }

  setTheme(theme: ThemeDef): void {
    this.theme = theme;
    this.material.uniforms.uKind!.value = KIND_INDEX[theme.particles.kind];
    this.material.blending = theme.particles.kind === 'stars' || theme.particles.kind === 'bubbles' ? AdditiveBlending : NormalBlending;
    this.material.needsUpdate = true;
    const tint = new Color(theme.ui.primary).lerp(new Color(0xffffff), 0.5);
    (this.reticle.material as MeshBasicMaterial).color.copy(tint);
    (this.reticleDot.material as MeshBasicMaterial).color.copy(tint);
    (this.beam.material as MeshBasicMaterial).color.copy(tint);
    for (const p of this.particles) p.alive = false;
  }

  /** `count` is the decorative particle budget from the graphics settings (0..300). */
  setBudget(count: number): void {
    this.burstBudget = Math.max(0, Math.round(count));
    this.ambientTarget = Math.round(Math.min(40, count * 0.22));
  }

  /** Height of the drawing buffer, needed to size point sprites consistently. */
  setViewportHeight(pixels: number): void {
    this.material.uniforms.uPixelsPerUnit!.value = pixels * 0.5;
  }

  private spawn(ambient: boolean): Particle | null {
    for (const p of this.particles) {
      if (!p.alive) {
        p.alive = true;
        p.ambient = ambient;
        p.seed = this.rng() * 6.28;
        p.rot = this.rng() * 6.28;
        const colors = this.theme?.particles.colors ?? ['#ffffff'];
        p.color.set(colors[Math.floor(this.rng() * colors.length)]!);
        return p;
      }
    }
    return null;
  }

  /** Celebration burst (prize landed). `strength` 0..1. */
  burst(origin: Vector3, strength = 1): void {
    if (!this.theme) return;
    const kind = this.theme.particles.kind;
    const count = Math.round(this.burstBudget * (this.reducedMotion ? 0.3 : 1) * (0.5 + 0.5 * strength));
    for (let i = 0; i < count; i++) {
      const p = this.spawn(false);
      if (!p) break;
      const a = this.rng() * Math.PI * 2;
      const up = kind === 'bubbles' ? 0.25 + this.rng() * 0.5 : 0.9 + this.rng() * 1.5;
      const out = (kind === 'bubbles' ? 0.12 : 0.35) + this.rng() * 0.5;
      p.x = origin.x + (this.rng() - 0.5) * 0.12;
      p.y = origin.y + this.rng() * 0.08;
      p.z = Math.min(-0.03, origin.z + (this.rng() - 0.5) * 0.12);
      p.vx = Math.cos(a) * out;
      p.vz = Math.sin(a) * out * 0.6;
      p.vy = up;
      p.maxLife = p.life = 1.3 + this.rng() * 1.4;
      p.size = (kind === 'stars' ? 0.03 : kind === 'bubbles' ? 0.028 : 0.022) * (0.6 + this.rng() * 0.9);
      p.spin = (this.rng() - 0.5) * 9;
    }
  }

  /**
   * Aim helper. `visible` only while the player may aim; (x, z) is the claw
   * axis, `hitY` the height of whatever is under it, `clawY` the palm height.
   */
  setAim(visible: boolean, x: number, z: number, hitY: number, clawY: number): void {
    const showRing = visible && this.showReticle;
    const showBeam = visible && this.showBeam;
    this.reticle.visible = showRing;
    this.reticleDot.visible = showRing;
    this.beam.visible = showBeam;
    if (showRing) {
      this.reticle.position.set(x, hitY + 0.006, z);
      this.reticleDot.position.set(x, hitY + 0.006, z);
    }
    if (showBeam) {
      const top = clawY - 0.2;
      const length = Math.max(0.01, top - hitY);
      this.beam.position.set(x, hitY + length / 2, z);
      this.beam.scale.set(1, length, 1);
    }
  }

  update(dt: number): void {
    this.time += dt;
    const pulse = this.reducedMotion ? 1 : 1 + 0.08 * Math.sin(this.time * 5);
    this.reticle.scale.setScalar(pulse);
    (this.reticle.material as MeshBasicMaterial).opacity = 0.7 + 0.2 * Math.sin(this.time * 5);

    // Keep a handful of slow ambient motes drifting in the upper part of the cabinet.
    const kind = this.theme?.particles.kind ?? 'petals';
    let ambient = 0;
    for (const p of this.particles) if (p.alive && p.ambient) ambient++;
    const want = this.reducedMotion ? Math.min(6, this.ambientTarget) : this.ambientTarget;
    if (ambient < want && this.rng() < dt * 6) {
      const p = this.spawn(true);
      if (p) {
        const rising = kind === 'bubbles';
        p.x = (this.rng() * 2 - 1) * (FIELD.halfWidth - 0.05);
        p.z = -0.06 - this.rng() * (FIELD.depth - 0.14);
        p.y = rising ? 0.3 + this.rng() * 0.1 : FIELD.ceilingY - 0.08;
        p.vx = (this.rng() - 0.5) * 0.04;
        p.vz = (this.rng() - 0.5) * 0.03;
        p.vy = rising ? 0.05 + this.rng() * 0.05 : -(0.035 + this.rng() * 0.05);
        p.maxLife = p.life = 7 + this.rng() * 6;
        p.size = (kind === 'stars' ? 0.016 : kind === 'bubbles' ? 0.02 : 0.016) * (0.6 + this.rng() * 0.8);
        p.spin = (this.rng() - 0.5) * 1.6;
      }
    }

    let n = 0;
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0 || p.y < -1.4) {
        p.alive = false;
        continue;
      }
      if (p.ambient) {
        p.x += (p.vx + Math.sin(this.time * 0.7 + p.seed) * 0.02) * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        // Ambient motes stay above the toys so they never get in the way of aiming.
        if (p.y < 0.42 && kind !== 'bubbles') p.life = Math.min(p.life, 0.6);
        if (p.y > FIELD.ceilingY - 0.04) p.life = Math.min(p.life, 0.6);
      } else {
        const drag = kind === 'bubbles' ? 1.2 : 1.9;
        p.vx -= p.vx * drag * dt;
        p.vz -= p.vz * drag * dt;
        p.vy += (kind === 'bubbles' ? 0.25 : -2.6) * dt - p.vy * (kind === 'bubbles' ? 0.9 : 0.9) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z = Math.min(-0.02, p.z + p.vz * dt);
      }
      p.rot += p.spin * dt;
      const fade = Math.min(1, p.life / 0.6) * Math.min(1, (p.maxLife - p.life) / 0.25);
      this.positions[n * 3] = p.x;
      this.positions[n * 3 + 1] = p.y;
      this.positions[n * 3 + 2] = p.z;
      this.colors[n * 4] = p.color.r;
      this.colors[n * 4 + 1] = p.color.g;
      this.colors[n * 4 + 2] = p.color.b;
      this.colors[n * 4 + 3] = fade * (p.ambient ? 0.55 : 0.95);
      this.params[n * 3] = p.size;
      this.params[n * 3 + 1] = p.rot;
      this.params[n * 3 + 2] = p.seed;
      n++;
    }
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, n);
    if (n > 0) {
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('aColor').needsUpdate = true;
      geometry.getAttribute('aParams').needsUpdate = true;
    }
    this.points.visible = n > 0;
  }

  /** Number of live particles (diagnostics). */
  liveCount(): number {
    let n = 0;
    for (const p of this.particles) if (p.alive) n++;
    return n;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    for (const m of [this.reticle, this.reticleDot, this.beam]) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
    this.group.removeFromParent();
  }
}
