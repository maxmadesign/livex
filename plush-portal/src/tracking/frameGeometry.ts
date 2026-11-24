/**
 * Image-space conventions for the camera frame. This is the single place that
 * knows about sensor rotation and mirroring, so left/right can never be
 * flipped twice by different parts of the pipeline.
 *
 * Frames:
 *   raw       – the frame exactly as delivered by getUserMedia
 *   upright   – raw rotated clockwise by `rotation` so that faces are upright;
 *               this is what the detector sees and what the preview shows
 *   true      – upright with the horizontal mirror removed (when the camera
 *               delivers mirrored images); image +x is the camera's right
 *
 * Normalised coordinates are (u, v) in [0, 1], u to the right, v down.
 */
import { REFERENCE_FRAME_WIDTH } from './landmarks';

export type SensorRotation = 0 | 90 | 180 | 270;

export function parseRotation(value: string | number): SensorRotation {
  const n = ((Math.round(Number(value) / 90) * 90) % 360 + 360) % 360;
  return (n === 90 || n === 180 || n === 270 ? n : 0) as SensorRotation;
}

/** Maps normalised raw coordinates to normalised upright coordinates (clockwise rotation). */
export function rotateNormalized(u: number, v: number, rotation: SensorRotation): [number, number] {
  switch (rotation) {
    case 90:
      return [1 - v, u];
    case 180:
      return [1 - u, 1 - v];
    case 270:
      return [v, 1 - u];
    default:
      return [u, v];
  }
}

/** Inverse of {@link rotateNormalized}. */
export function unrotateNormalized(u: number, v: number, rotation: SensorRotation): [number, number] {
  switch (rotation) {
    case 90:
      return [v, 1 - u];
    case 180:
      return [1 - u, 1 - v];
    case 270:
      return [1 - v, u];
    default:
      return [u, v];
  }
}

export interface UprightFrame {
  /** Upright frame size in reference pixels (raw width scaled to REFERENCE_FRAME_WIDTH). */
  width: number;
  height: number;
  /** Upright frame size in real pixels. */
  pixelWidth: number;
  pixelHeight: number;
  rotation: SensorRotation;
  /** True when the upright frame is horizontally mirrored with respect to reality. */
  mirror: boolean;
}

/**
 * Geometry of the upright frame for a raw frame of `rawWidth` × `rawHeight`.
 * Pixels are square, so one scale factor converts both axes to reference pixels.
 */
export function uprightFrame(rawWidth: number, rawHeight: number, rotation: SensorRotation, mirror: boolean): UprightFrame {
  const w = Math.max(1, rawWidth);
  const h = Math.max(1, rawHeight);
  const scale = REFERENCE_FRAME_WIDTH / w;
  const swap = rotation === 90 || rotation === 270;
  return {
    width: (swap ? h : w) * scale,
    height: (swap ? w : h) * scale,
    pixelWidth: swap ? h : w,
    pixelHeight: swap ? w : h,
    rotation,
    mirror,
  };
}

/**
 * Whether the preview must be flipped with CSS / canvas to look like a mirror.
 * A camera that already mirrors its image must not be flipped a second time.
 */
export function previewNeedsFlip(mirror: boolean): boolean {
  return !mirror;
}

/** Converts a normalised upright (as delivered) u coordinate to the true, un-mirrored image. */
export function trueU(u: number, mirror: boolean): number {
  return mirror ? 1 - u : u;
}

/**
 * Draws `source` into a 2D context rotated clockwise by `rotation`. The
 * context's canvas must already have the upright pixel size. Kept here so the
 * pixel transform and {@link rotateNormalized} cannot drift apart.
 */
export function drawUpright(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  rawWidth: number,
  rawHeight: number,
  rotation: SensorRotation,
): void {
  ctx.save();
  switch (rotation) {
    case 90:
      ctx.translate(rawHeight, 0);
      ctx.rotate(Math.PI / 2);
      break;
    case 180:
      ctx.translate(rawWidth, rawHeight);
      ctx.rotate(Math.PI);
      break;
    case 270:
      ctx.translate(0, rawWidth);
      ctx.rotate(-Math.PI / 2);
      break;
    default:
      break;
  }
  ctx.drawImage(source, 0, 0, rawWidth, rawHeight);
  ctx.restore();
}
