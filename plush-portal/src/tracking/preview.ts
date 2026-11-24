/**
 * Calibration preview: the (upright, mirror-like) camera image with the
 * tracked landmarks drawn on top. It only exists while a container is
 * attached; nothing is recorded and frames are drawn straight to the canvas.
 *
 * Video and overlay are drawn under ONE canvas transform, so the overlay can
 * never be mirrored differently from the image.
 */
import { drawUpright, previewNeedsFlip, type SensorRotation } from './frameGeometry';
import { EYE_CORNER_SLOTS, FLOATS_PER_FACE, FLOATS_PER_LANDMARK, TRACKED_LANDMARK_IDS } from './landmarks';

export interface PreviewInfo {
  video: HTMLVideoElement | null;
  rawWidth: number;
  rawHeight: number;
  rotation: SensorRotation;
  mirror: boolean;
  /** Packed landmarks of the latest inference (upright frame, as delivered). */
  faces: Float32Array | null;
  faceCount: number;
  /** Index of the primary player in `faces`, or -1. */
  primaryIndex: number;
  /** True once the primary player is locked. */
  locked: boolean;
}

const MAX_DPR = 2;

export class TrackingPreview {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private raf = 0;
  private detached = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly getInfo: () => PreviewInfo,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('data-tracking-preview', '');
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, { width: '100%', height: 'auto', display: 'block', borderRadius: 'inherit' });
    this.ctx = this.canvas.getContext('2d');
    container.appendChild(this.canvas);
    this.raf = requestAnimationFrame(this.draw);
  }

  detach(): void {
    if (this.detached) return;
    this.detached = true;
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
    // Drop the pixels that were drawn.
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  private draw = (): void => {
    if (this.detached) return;
    this.raf = requestAnimationFrame(this.draw);
    const ctx = this.ctx;
    if (!ctx) return;
    const info = this.getInfo();
    const swap = info.rotation === 90 || info.rotation === 270;
    const uprightW = Math.max(1, swap ? info.rawHeight : info.rawWidth);
    const uprightH = Math.max(1, swap ? info.rawWidth : info.rawHeight);
    const hasVideo = !!info.video && info.rawWidth > 0 && info.video.readyState >= 2;

    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const cssWidth = Math.max(1, this.container.clientWidth || 320);
    const aspect = hasVideo ? uprightH / uprightW : 3 / 4;
    const cw = Math.round(cssWidth * dpr);
    const ch = Math.round(cssWidth * aspect * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!hasVideo) {
      ctx.fillStyle = 'rgba(20, 20, 30, 0.85)';
      ctx.fillRect(0, 0, cw, ch);
      return;
    }

    // One transform for image and overlay: upright pixels → canvas pixels, flipped like a mirror.
    if (previewNeedsFlip(info.mirror)) {
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
    }
    ctx.scale(cw / uprightW, ch / uprightH);
    try {
      drawUpright(ctx, info.video!, info.rawWidth, info.rawHeight, info.rotation);
    } catch {
      return; // the stream was closed between the check and the draw
    }

    if (!info.faces || info.faceCount === 0) return;
    const unit = uprightW / 320; // overlay sizes relative to the frame
    for (let f = 0; f < info.faceCount; f++) {
      const base = f * FLOATS_PER_FACE;
      const primary = f === info.primaryIndex;
      ctx.fillStyle = primary ? (info.locked ? 'rgba(120, 255, 200, 0.95)' : 'rgba(255, 220, 120, 0.95)') : 'rgba(255, 255, 255, 0.45)';
      const r = (primary ? 1.6 : 1.1) * unit;
      for (let i = 0; i < TRACKED_LANDMARK_IDS.length; i++) {
        const o = base + i * FLOATS_PER_LANDMARK;
        ctx.beginPath();
        ctx.arc(info.faces[o]! * uprightW, info.faces[o + 1]! * uprightH, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (primary) {
        let ex = 0;
        let ey = 0;
        for (const slot of EYE_CORNER_SLOTS) {
          ex += info.faces[base + slot * FLOATS_PER_LANDMARK]!;
          ey += info.faces[base + slot * FLOATS_PER_LANDMARK + 1]!;
        }
        ex = (ex / EYE_CORNER_SLOTS.length) * uprightW;
        ey = (ey / EYE_CORNER_SLOTS.length) * uprightH;
        ctx.strokeStyle = info.locked ? 'rgba(120, 255, 200, 1)' : 'rgba(255, 220, 120, 1)';
        ctx.lineWidth = 1.6 * unit;
        ctx.beginPath();
        ctx.arc(ex, ey, 7 * unit, 0, Math.PI * 2);
        ctx.moveTo(ex - 11 * unit, ey);
        ctx.lineTo(ex + 11 * unit, ey);
        ctx.moveTo(ex, ey - 11 * unit);
        ctx.lineTo(ex, ey + 11 * unit);
        ctx.stroke();
      }
    }
  };
}
