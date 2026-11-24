import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../../src/settings/spec';
import { LOW_POWER_MAX_HZ, effectiveCapture, lowPowerReason, readDeviceInfo } from '../../../src/tracking/devicePolicy';

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
};

describe('device policy (phones / low-power devices)', () => {
  it('recognises phones and tablets', () => {
    expect(readDeviceInfo({ userAgent: UA.android, hardwareConcurrency: 8 } as Navigator).mobile).toBe(true);
    expect(readDeviceInfo({ userAgent: UA.iphone } as Navigator).mobile).toBe(true);
    expect(readDeviceInfo({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 5 } as Navigator).mobile).toBe(true);
    expect(readDeviceInfo({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 0 } as Navigator).mobile).toBe(false);
    expect(readDeviceInfo({ userAgent: UA.windows, hardwareConcurrency: 16 } as Navigator)).toEqual({ mobile: false, cores: 16, memoryGb: null });
    expect(readDeviceInfo({ userAgent: UA.windows, userAgentData: { mobile: true } } as unknown as Navigator).mobile).toBe(true);
    expect(readDeviceInfo({} as Navigator)).toEqual({ mobile: false, cores: null, memoryGb: null });
    expect(readDeviceInfo({ userAgent: UA.windows, hardwareConcurrency: 4, deviceMemory: 4 } as unknown as Navigator).memoryGb).toBe(4);
  });

  it('decides when the reduced capture is used', () => {
    expect(lowPowerReason({ mobile: true, cores: 8, memoryGb: 8 })).toBe('phone');
    expect(lowPowerReason({ mobile: false, cores: 2, memoryGb: null })).toBe('low_power_device');
    expect(lowPowerReason({ mobile: false, cores: 4, memoryGb: 4 })).toBe('low_power_device');
    expect(lowPowerReason({ mobile: false, cores: 4, memoryGb: null })).toBeNull(); // unknown memory: no guess
    expect(lowPowerReason({ mobile: false, cores: 16, memoryGb: 32 })).toBeNull();
    expect(lowPowerReason({ mobile: false, cores: null, memoryGb: null })).toBeNull();
  });

  it('phones get a smaller frame, a lower rate and one face; desktops keep the settings', () => {
    const camera = defaultSettings().camera; // 480p, 18 Hz, 2 faces, lowPower auto
    expect(effectiveCapture(camera, { mobile: true, cores: 8, memoryGb: 8 })).toEqual({ resolution: '360p', inferenceHz: LOW_POWER_MAX_HZ, numFaces: 1, lowPower: true, reason: 'phone' });
    expect(effectiveCapture(camera, { mobile: false, cores: 16, memoryGb: 16 })).toEqual({ resolution: '480p', inferenceHz: 18, numFaces: 2, lowPower: false, reason: null });
    // Forced on / off.
    expect(effectiveCapture({ ...camera, lowPower: 'on' }, { mobile: false, cores: 16, memoryGb: 16 })).toMatchObject({ resolution: '360p', lowPower: true, reason: 'setting' });
    expect(effectiveCapture({ ...camera, lowPower: 'off' }, { mobile: true, cores: 8, memoryGb: 8 })).toMatchObject({ resolution: '480p', inferenceHz: 18, numFaces: 2, lowPower: false });
    // Never raises anything.
    expect(effectiveCapture({ ...camera, resolution: '360p', inferenceHz: 8 }, { mobile: true, cores: 8, memoryGb: 8 })).toMatchObject({ resolution: '360p', inferenceHz: 8 });
    expect(effectiveCapture({ ...camera, resolution: '720p', inferenceHz: 30 }, { mobile: true, cores: 8, memoryGb: 8 })).toMatchObject({ resolution: '360p', inferenceHz: 12 });
  });
});
