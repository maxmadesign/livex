import { describe, expect, it } from 'vitest';
import { LANGS } from '../../../src/core/types';
import { trackingStrings } from '../../../src/i18n/strings/tracking';

const STATES = ['off', 'idle', 'requesting', 'denied', 'no_device', 'in_use', 'insecure', 'loading', 'model_error', 'searching', 'tracking', 'lost'];
const SOURCES = ['neutral', 'tracking', 'hold', 'returning', 'reacquire', 'test'];
const BACKENDS = ['worker-gpu', 'worker-cpu', 'main-gpu', 'main-cpu'];
const CAL_RESULTS = ['ok', 'not_running', 'no_face', 'unstable', 'geometry', 'implausible', 'stopped'];

describe('tracking strings', () => {
  it('has the same keys in every language, all prefixed and non-empty', () => {
    const reference = Object.keys(trackingStrings.en).sort();
    expect(reference.length).toBeGreaterThan(60);
    for (const lang of LANGS) {
      expect(Object.keys(trackingStrings[lang]).sort()).toEqual(reference);
      for (const key of reference) {
        // Head-tracking setting labels are looked up by path (set.camera.<field>).
        expect(key.startsWith('tracking.') || key.startsWith('set.camera.'), key).toBe(true);
        expect(trackingStrings[lang][key]!.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('labels every calibration / phone setting of the Camera & Parallax tab', () => {
    for (const lang of LANGS) {
      const table = trackingStrings[lang];
      for (const key of ['set.camera.headWeight', 'set.camera.lowPower']) {
        expect(table[key], `${lang}:${key}`).toBeTruthy();
        expect(table[`${key}.hint`], `${lang}:${key}.hint`).toBeTruthy();
      }
      for (const o of ['auto', 'on', 'off']) expect(table[`set.camera.lowPower.o.${o}`], `${lang}:${o}`).toBeTruthy();
    }
  });

  it('covers every tracker state, view source, backend and calibration result', () => {
    for (const lang of LANGS) {
      const table = trackingStrings[lang];
      for (const state of STATES) {
        expect(table[`tracking.state.${state}`]).toBeTruthy();
        expect(table[`tracking.stateHint.${state}`]).toBeTruthy();
      }
      for (const source of SOURCES) expect(table[`tracking.source.${source}`]).toBeTruthy();
      for (const backend of BACKENDS) expect(table[`tracking.backend.${backend}`]).toBeTruthy();
      for (const result of CAL_RESULTS) expect(table[`tracking.calResult.${result}`]).toBeTruthy();
    }
  });

  it('uses the same placeholders in every language', () => {
    const placeholders = (text: string) => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');
    for (const key of Object.keys(trackingStrings.en)) {
      const expected = placeholders(trackingStrings.en[key]!);
      for (const lang of LANGS) expect(`${key}:${placeholders(trackingStrings[lang][key]!)}`).toBe(`${key}:${expected}`);
    }
  });

  it('never presents the test sliders as camera tracking', () => {
    expect(trackingStrings.en['tracking.source.test']).toMatch(/not the camera/i);
    expect(trackingStrings.zh['tracking.source.test']).toContain('非摄像头');
    expect(trackingStrings.ja['tracking.source.test']).toContain('カメラではありません');
  });
});
