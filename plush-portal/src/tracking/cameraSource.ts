/**
 * Camera access. Video only (never audio), opened only on request, every
 * failure mapped to a precise tracker state, and every track really stopped
 * on close.
 */
import type { TrackerState } from '../core/contracts';
import type { CameraSettings } from '../settings/spec';

export type CameraFailureState = Extract<TrackerState, 'denied' | 'no_device' | 'in_use' | 'insecure'>;

export interface CameraHandle {
  readonly label: string;
  /** Actual negotiated frame size (raw, before any rotation). */
  readonly width: number;
  readonly height: number;
  readonly deviceId: string;
  /** Hidden video element the frames are read from (null only for test doubles). */
  readonly video: HTMLVideoElement | null;
  readonly closed: boolean;
  /** Calls `callback` whenever a new camera frame is available. Returns an unsubscribe function. */
  onFrame(callback: () => void): () => void;
  /** Calls `callback` once if the camera stops on its own (unplugged, permission revoked, …). */
  onEnded(callback: (detail: string) => void): void;
  /** Stops every track and releases the device. */
  close(): void;
}

export type CameraOpenResult = { ok: true; camera: CameraHandle } | { ok: false; state: CameraFailureState; detail: string };

export interface CameraRequest {
  deviceId: string;
  resolution: CameraSettings['resolution'];
}

export type CameraOpener = (request: CameraRequest) => Promise<CameraOpenResult>;

const RESOLUTIONS: Record<CameraSettings['resolution'], { width: number; height: number }> = {
  '360p': { width: 640, height: 360 },
  '480p': { width: 640, height: 480 },
  '720p': { width: 1280, height: 720 },
};

export interface CameraEnvironment {
  /** window.isSecureContext */
  secure: boolean;
  /** Result of the Permissions-Policy check for "camera"; null when the browser cannot tell. */
  policyAllows: boolean | null;
  /** True when the page runs inside an iframe. */
  framed: boolean;
}

/** Maps a getUserMedia rejection to a tracker state. Pure. */
export function classifyCameraError(error: unknown, env: CameraEnvironment): { state: CameraFailureState; detail: string } {
  const name = (error as { name?: string } | null)?.name ?? 'Error';
  const message = (error as { message?: string } | null)?.message ?? String(error);
  const base = `${name}: ${message}`;
  const iframeHint = env.framed ? ' The embedding iframe needs allow="camera".' : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      if (env.policyAllows === false) {
        return { state: 'insecure', detail: `${base} (blocked by Permissions-Policy).${iframeHint}` };
      }
      if (!env.secure) return { state: 'insecure', detail: `${base} (not a secure context; use HTTPS or localhost)` };
      return { state: 'denied', detail: env.framed ? `${base}${iframeHint}` : base };
    case 'SecurityError':
      return { state: 'insecure', detail: `${base}${iframeHint}` };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
    // Browsers / shells that cannot capture at all (e.g. headless without a prompt UI).
    case 'NotSupportedError':
      return { state: 'no_device', detail: base };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { state: 'in_use', detail: base };
    case 'TypeError':
      return env.secure ? { state: 'no_device', detail: base } : { state: 'insecure', detail: `${base} (not a secure context)` };
    default:
      return { state: 'in_use', detail: base };
  }
}

function readEnvironment(): CameraEnvironment {
  const secure = typeof window !== 'undefined' ? window.isSecureContext !== false : false;
  let policyAllows: boolean | null = null;
  try {
    const doc = document as Document & {
      permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
      featurePolicy?: { allowsFeature?: (feature: string) => boolean };
    };
    const policy = doc.permissionsPolicy ?? doc.featurePolicy;
    if (policy?.allowsFeature) policyAllows = policy.allowsFeature('camera');
  } catch {
    policyAllows = null;
  }
  let framed = false;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true;
  }
  return { secure, policyAllows, framed };
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

class BrowserCamera implements CameraHandle {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly deviceId: string;
  private closedFlag = false;
  private endedCallback: ((detail: string) => void) | null = null;
  private readonly cleanups = new Set<() => void>();

  constructor(
    private readonly stream: MediaStream,
    readonly video: HTMLVideoElement,
  ) {
    const track = stream.getVideoTracks()[0]!;
    const settings = track.getSettings();
    this.label = track.label || 'Camera';
    this.deviceId = settings.deviceId ?? '';
    this.width = video.videoWidth || settings.width || 0;
    this.height = video.videoHeight || settings.height || 0;
    track.addEventListener('ended', this.handleEnded);
  }

  get closed(): boolean {
    return this.closedFlag;
  }

  onFrame(callback: () => void): () => void {
    const video = this.video as VideoWithFrameCallback;
    let active = true;
    let cleanup: () => void;
    if (typeof video.requestVideoFrameCallback === 'function') {
      // Fires exactly once per new camera frame (and not at all while the tab is hidden).
      let handle = 0;
      const tick = () => {
        if (!active) return;
        handle = video.requestVideoFrameCallback!(tick);
        callback();
      };
      handle = video.requestVideoFrameCallback(tick);
      cleanup = () => video.cancelVideoFrameCallback?.(handle);
    } else {
      // Fallback: poll and only report when the video clock advanced (a new frame was decoded).
      let lastTime = -1;
      const timer = setInterval(() => {
        if (!active || video.readyState < 2) return;
        if (video.currentTime !== lastTime) {
          lastTime = video.currentTime;
          callback();
        }
      }, 16);
      cleanup = () => clearInterval(timer);
    }
    const off = () => {
      if (!active) return;
      active = false;
      cleanup();
      this.cleanups.delete(off);
    };
    this.cleanups.add(off);
    return off;
  }

  onEnded(callback: (detail: string) => void): void {
    this.endedCallback = callback;
  }

  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    for (const off of [...this.cleanups]) off();
    for (const track of this.stream.getTracks()) {
      track.removeEventListener('ended', this.handleEnded);
      track.stop();
    }
    try {
      this.video.pause();
    } catch {
      /* ignore */
    }
    this.video.srcObject = null;
    this.video.removeAttribute('src');
    this.endedCallback = null;
  }

  private handleEnded = (): void => {
    if (this.closedFlag) return;
    const callback = this.endedCallback;
    this.close();
    callback?.('camera stream ended (device unplugged or permission revoked)');
  };
}

function waitForVideo(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      resolve();
      return;
    }
    const done = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('resize', onReady);
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => {
      if (video.videoWidth > 0) done();
    };
    const timer = setTimeout(() => done(Object.assign(new Error('camera delivered no frames'), { name: 'NotReadableError' })), timeoutMs);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('resize', onReady);
  });
}

/**
 * Opens the camera. Never throws. The returned promise stays pending while the
 * browser's permission prompt is open; callers must not block gameplay on it.
 */
export const openCamera: CameraOpener = async (request) => {
  const env = typeof window !== 'undefined' ? readEnvironment() : { secure: false, policyAllows: null, framed: false };
  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    return { ok: false, state: 'no_device', detail: 'no browser environment' };
  }
  if (!env.secure) {
    return { ok: false, state: 'insecure', detail: 'Camera access needs a secure context (HTTPS or http://localhost).' };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, state: 'insecure', detail: 'navigator.mediaDevices.getUserMedia is not available in this browser / context.' };
  }
  if (env.policyAllows === false) {
    return {
      ok: false,
      state: 'insecure',
      detail: `Camera is blocked by Permissions-Policy.${env.framed ? ' The embedding iframe needs allow="camera".' : ''}`,
    };
  }

  const size = RESOLUTIONS[request.resolution] ?? RESOLUTIONS['480p'];
  const base: MediaTrackConstraints = {
    width: { ideal: size.width },
    height: { ideal: size.height },
    frameRate: { ideal: 30, max: 30 },
  };
  const attempts: MediaTrackConstraints[] = request.deviceId
    ? [{ ...base, deviceId: { exact: request.deviceId } }, { ...base, facingMode: 'user' }]
    : [{ ...base, facingMode: 'user' }];

  let stream: MediaStream | null = null;
  let lastError: unknown = null;
  for (let i = 0; i < attempts.length; i++) {
    try {
      // Video only: the microphone is never requested for head tracking.
      stream = await navigator.mediaDevices.getUserMedia({ video: attempts[i]!, audio: false });
      break;
    } catch (error) {
      lastError = error;
      const name = (error as { name?: string } | null)?.name;
      // A remembered device that no longer exists: retry with any camera. Everything else is final.
      const retry = i + 1 < attempts.length && (name === 'OverconstrainedError' || name === 'NotFoundError');
      if (!retry) break;
    }
  }
  if (!stream) return { ok: false, ...classifyCameraError(lastError, env) };
  if (stream.getVideoTracks().length === 0) {
    for (const track of stream.getTracks()) track.stop();
    return { ok: false, state: 'no_device', detail: 'The stream has no video track.' };
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  try {
    await video.play();
    await waitForVideo(video, 8000);
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
    return { ok: false, ...classifyCameraError(error, env) };
  }
  return { ok: true, camera: new BrowserCamera(stream, video) };
};

/** Lists video input devices (labels are empty until camera permission was granted once). */
export async function listVideoInputs(): Promise<{ id: string; label: string }[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    let index = 0;
    return devices
      .filter((device) => device.kind === 'videoinput')
      .map((device) => {
        index++;
        return { id: device.deviceId, label: device.label || `Camera ${index}` };
      });
  } catch {
    return [];
  }
}
