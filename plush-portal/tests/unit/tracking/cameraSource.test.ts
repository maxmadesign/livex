import { describe, expect, it } from 'vitest';
import { classifyCameraError, listVideoInputs, openCamera, type CameraEnvironment } from '../../../src/tracking/cameraSource';

const secure: CameraEnvironment = { secure: true, policyAllows: true, framed: false };
const err = (name: string, message = 'x') => Object.assign(new Error(message), { name });

describe('classifyCameraError', () => {
  it('maps permission problems to "denied"', () => {
    expect(classifyCameraError(err('NotAllowedError', 'Permission denied'), secure).state).toBe('denied');
    expect(classifyCameraError(err('NotAllowedError', 'Permission dismissed'), secure).state).toBe('denied');
    expect(classifyCameraError(err('PermissionDeniedError'), secure).state).toBe('denied');
  });

  it('distinguishes policy / insecure-context blocks from a user denial', () => {
    const blocked = classifyCameraError(err('NotAllowedError'), { secure: true, policyAllows: false, framed: true });
    expect(blocked.state).toBe('insecure');
    expect(blocked.detail).toContain('allow="camera"');
    expect(classifyCameraError(err('NotAllowedError'), { secure: false, policyAllows: null, framed: false }).state).toBe('insecure');
    expect(classifyCameraError(err('SecurityError'), secure).state).toBe('insecure');
    // In an iframe where the policy cannot be queried, a denial keeps the hint.
    const framed = classifyCameraError(err('NotAllowedError'), { secure: true, policyAllows: null, framed: true });
    expect(framed.state).toBe('denied');
    expect(framed.detail).toContain('iframe');
  });

  it('maps missing devices to "no_device"', () => {
    for (const name of ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'NotSupportedError']) {
      expect(classifyCameraError(err(name), secure).state).toBe('no_device');
    }
  });

  it('maps busy / unreadable cameras to "in_use"', () => {
    for (const name of ['NotReadableError', 'TrackStartError', 'AbortError']) {
      expect(classifyCameraError(err(name), secure).state).toBe('in_use');
    }
    expect(classifyCameraError(err('SomethingNew'), secure).state).toBe('in_use');
  });

  it('keeps the original error text for diagnostics', () => {
    expect(classifyCameraError(err('NotReadableError', 'Could not start video source'), secure).detail).toBe(
      'NotReadableError: Could not start video source',
    );
    expect(classifyCameraError('weird', secure).detail).toContain('weird');
  });
});

describe('outside a browser', () => {
  it('openCamera resolves with a failure instead of throwing', async () => {
    const result = await openCamera({ deviceId: '', resolution: '480p' });
    expect(result.ok).toBe(false);
  });
  it('listVideoInputs returns an empty list', async () => {
    expect(await listVideoInputs()).toEqual([]);
  });
});
