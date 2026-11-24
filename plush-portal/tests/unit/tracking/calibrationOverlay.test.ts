import { describe, expect, it } from 'vitest';
import { LANGS, type DisplayProfileId } from '../../../src/core/types';
import { hasString, translate } from '../../../src/i18n';
import { registerAllStrings } from '../../../src/i18n/all';
import { calibrationStrings } from '../../../src/i18n/strings/calibration';
import { solveLayout } from '../../../src/layout/solve';
import { profileDefaults } from '../../../src/settings/spec';
import { ROTATED, type CountdownFailure } from '../../../src/tracking/countdown';
import { calibrationBox } from '../../../src/ui/CalibrationOverlay';
import { calibrationPhaseText } from '../../../src/ui/settings/tabCamera';

registerAllStrings();

const layoutFor = (profile: DisplayProfileId, vw: number, vh: number) => solveLayout(profile, profileDefaults(profile).layout, vw, vh);

const VIEWPORTS: [DisplayProfileId, number, number][] = [
  ['portrait86', 1080, 1920],
  ['portrait86', 2160, 3840],
  ['portrait86', 1200, 1920],
  ['portrait32', 1080, 1920],
  ['portrait32', 720, 1280],
  ['desktop', 1920, 1080],
  ['desktop', 1366, 768],
  ['desktop', 1280, 1000],
  ['mobile', 844, 390],
  ['mobile', 932, 430],
  ['mobile', 390, 844],
];

describe('calibration overlay placement', () => {
  it('stays inside the interactive safe zone and the viewport on every preset', () => {
    for (const [profile, vw, vh] of VIEWPORTS) {
      const layout = layoutFor(profile, vw, vh);
      const box = calibrationBox(layout);
      const label = `${profile} ${vw}x${vh}`;
      expect(box.y, label).toBeGreaterThanOrEqual(layout.safeTop);
      expect(box.y + box.h, label).toBeLessThanOrEqual(layout.safeBottom);
      expect(box.x, label).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w, label).toBeLessThanOrEqual(vw);
      // The ring and its text fit into the region (stacked: ring above ~4 lines; row: ring beside them).
      if (box.layout === 'stack') expect(box.ring * 1.9, label).toBeLessThanOrEqual(box.h + 1);
      else expect(box.ring + 2 * box.font, label).toBeLessThanOrEqual(box.h + 1);
      expect(box.font, label).toBeGreaterThanOrEqual(13);
      // Never over the control panel when the card fits above it.
      if (layout.panel.y - box.y >= 96) expect(box.y + box.h, label).toBeLessThanOrEqual(layout.panel.y);
    }
  });

  it('on the 86" portrait preset sits in the 25 %–75 % band, above the control panel', () => {
    for (const [vw, vh] of [[1080, 1920], [2160, 3840]]) {
      const layout = layoutFor('portrait86', vw, vh);
      const box = calibrationBox(layout);
      expect(box.y / vh).toBeGreaterThanOrEqual(0.25);
      expect((box.y + box.h) / vh).toBeLessThanOrEqual(0.75);
      expect(box.y + box.h).toBeLessThanOrEqual(layout.panel.y);
      expect(box.ring / vw).toBeGreaterThan(0.2); // a big, readable countdown on the kiosk
    }
  });

  it('keeps the control panel free where there is room, and scales down for phones', () => {
    for (const [profile, vw, vh] of [['desktop', 1920, 1080], ['portrait32', 1080, 1920], ['mobile', 844, 390]] as const) {
      const layout = layoutFor(profile, vw, vh);
      const box = calibrationBox(layout);
      expect(box.y + box.h, profile).toBeLessThanOrEqual(layout.panel.y);
      expect(box.y, profile).toBeGreaterThanOrEqual(layout.topBar.y + layout.topBar.h);
    }
    const phone = calibrationBox(layoutFor('mobile', 844, 390));
    const kiosk = calibrationBox(layoutFor('portrait86', 1080, 1920));
    expect(kiosk.layout).toBe('stack');
    expect(phone.ring).toBeLessThan(kiosk.ring);
    expect(phone.ring).toBeGreaterThanOrEqual(48);
    expect(phone.w).toBeLessThanOrEqual(844);
    // A portrait phone has the room for the big stacked card.
    expect(calibrationBox(layoutFor('mobile', 390, 844)).layout).toBe('stack');
  });
});

describe('calibration strings', () => {
  const FAILURES: CountdownFailure[] = ['no_face', 'unstable', 'not_running', 'camera_lost', 'denied', 'no_device', 'in_use', 'insecure', 'model_error'];
  it('explain every failure, phase and prompt in every language', () => {
    for (const lang of LANGS) {
      for (const f of FAILURES) expect(hasString(lang, `calibration.fail.${f}`), `${lang}:${f}`).toBe(true);
      for (const p of ['idle', 'waiting', 'countdown', 'capturing', 'done', 'failed', 'rotated']) expect(hasString(lang, `calibration.phase.${p}`), `${lang}:${p}`).toBe(true);
      for (const k of ['title', 'retry', 'skip', 'cancel', 'face.found', 'face.searching', 'done', 'insecure.title', 'insecure.body', 'rotated.title', 'recalibrate']) {
        expect(calibrationStrings[lang][`calibration.${k}`], `${lang}:${k}`).toBeTruthy();
      }
    }
    // The instruction asks to look at the screen and hold still (zh / ja included).
    expect(translate('en', 'calibration.title')).toMatch(/look at the screen/i);
    expect(translate('zh', 'calibration.title')).toContain('屏幕');
    expect(translate('ja', 'calibration.title')).toContain('画面');
    expect(translate('en', 'calibration.insecure.body', { origin: 'http://192.168.1.20:5173' })).toContain('http://192.168.1.20:5173');
  });

  it('the settings tab reports the tracker state as it is', () => {
    const t = (key: string, params?: Record<string, string | number>) => translate('en', key, params);
    expect(calibrationPhaseText(t, { phase: 'countdown', remaining: 2, detail: '' })).toBe('Counting down: 2');
    expect(calibrationPhaseText(t, { phase: 'countdown', remaining: 3, detail: 'waiting_camera' })).toBe('Waiting for the camera…');
    expect(calibrationPhaseText(t, { phase: 'failed', remaining: 0, detail: 'unstable' })).toMatch(/^Failed: Too much movement/);
    expect(calibrationPhaseText(t, { phase: 'failed', remaining: 0, detail: 'weird_code' })).toBe('Failed: weird_code');
    expect(calibrationPhaseText(t, { phase: 'idle', remaining: 0, detail: ROTATED })).toMatch(/rotated/i);
    expect(calibrationPhaseText(t, { phase: 'idle', remaining: 0, detail: '' })).toBe('Not running');
  });
});
