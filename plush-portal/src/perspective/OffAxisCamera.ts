import { PerspectiveCamera } from 'three';
import { chooseClipPlanes, offAxisFrustum, type Frustum } from './offAxis';

/**
 * Camera whose projection is always derived from an eye position and a fixed
 * window rectangle in the world (the glass front of the cabinet).
 *
 * `updateProjectionMatrix()` is overridden, so any code that calls it (resize
 * handlers, post-processing passes, Three internals) re-derives the off-axis
 * matrix instead of replacing it with a symmetric one.
 */
export class OffAxisCamera extends PerspectiveCamera {
  /** Window centre in world space. The window lies in the plane z = windowZ, facing +Z. */
  private windowX = 0;
  private windowY = 0;
  private windowZ = 0;
  private windowW = 1;
  private windowH = 1;
  /** How far behind the window the scene extends (world units). */
  sceneDepth = 14;
  private readonly frustumScratch: Frustum = { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0 };

  constructor() {
    super(50, 1, 0.1, 100);
    this.matrixAutoUpdate = false;
    this.position.set(0, 0, 1);
    this.quaternion.identity();
    this.updateProjectionMatrix();
    this.syncMatrices();
  }

  /** Sets the window rectangle (world units). Does not move the eye. */
  setWindow(centerX: number, centerY: number, centerZ: number, width: number, height: number): void {
    this.windowX = centerX;
    this.windowY = centerY;
    this.windowZ = centerZ;
    this.windowW = Math.max(width, 1e-4);
    this.windowH = Math.max(height, 1e-4);
    this.updateProjectionMatrix();
  }

  /** Sets the eye position in world space and refreshes projection + view matrices. */
  setEyeWorld(x: number, y: number, z: number): void {
    // Keep the eye strictly in front of the window.
    const minZ = this.windowZ + 0.02;
    this.position.set(x, y, z < minZ ? minZ : z);
    this.updateProjectionMatrix();
    this.syncMatrices();
  }

  /** Eye position relative to the window centre (window units). */
  getEyeLocal(): { x: number; y: number; z: number } {
    return {
      x: this.position.x - this.windowX,
      y: this.position.y - this.windowY,
      z: this.position.z - this.windowZ,
    };
  }

  getWindow(): { x: number; y: number; z: number; width: number; height: number } {
    return { x: this.windowX, y: this.windowY, z: this.windowZ, width: this.windowW, height: this.windowH };
  }

  override updateProjectionMatrix(): void {
    // Guard: PerspectiveCamera's constructor calls this before our fields exist.
    if (this.frustumScratch === undefined) {
      super.updateProjectionMatrix();
      return;
    }
    const ex = this.position.x - this.windowX;
    const ey = this.position.y - this.windowY;
    const ez = Math.max(this.position.z - this.windowZ, 0.02);
    const { near, far } = chooseClipPlanes(ez, this.sceneDepth);
    const f = offAxisFrustum(ex, ey, ez, this.windowW, this.windowH, near, far, this.frustumScratch);
    this.near = near;
    this.far = far;
    // Informational only (some helpers read these); the matrix below is authoritative.
    this.aspect = this.windowW / this.windowH;
    this.fov = (2 * Math.atan(this.windowH / 2 / ez) * 180) / Math.PI;
    this.projectionMatrix.makePerspective(f.left, f.right, f.top, f.bottom, f.near, f.far, this.coordinateSystem);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }

  /** The camera never rotates: its axes stay aligned with the window axes. */
  private syncMatrices(): void {
    this.quaternion.identity();
    this.scale.set(1, 1, 1);
    this.updateMatrix();
    this.updateMatrixWorld(true);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }
}
