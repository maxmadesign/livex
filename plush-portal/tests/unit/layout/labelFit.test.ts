import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRAB_LABEL_WIDTH, labelEm } from '../../../src/layout/labelFit';
import { solveLayout, NO_INSETS } from '../../../src/layout/solve';
import { uiEn } from '../../../src/i18n/strings/ui.en';
import { uiJa } from '../../../src/i18n/strings/ui.ja';
import { uiZh } from '../../../src/i18n/strings/ui.zh';
import { defaultSettings } from '../../../src/settings/spec';

const css = readFileSync(new URL('../../../src/ui/hud.css', import.meta.url), 'utf8');
const KEYS = ['hud.start', 'hud.grab', 'hud.again'] as const;

/**
 * Measured in Chromium with the bundled display font (reviewer browser check, 2026-11-24): the widest
 * unbreakable run of each label in em, letter spacing included. The estimate must never be smaller.
 */
const MEASURED_EM: Record<string, number> = { START: 3.06, スタート: 4.08, もういちど: 5.09 };

describe('big button label fit', () => {
  it('estimates the widest unbreakable run, never below the measured width', () => {
    for (const [text, em] of Object.entries(MEASURED_EM)) expect(labelEm(text), text).toBeGreaterThanOrEqual(em);
    expect(labelEm('PLAY AGAIN')).toBeCloseTo(labelEm('AGAIN'), 9);
    expect(labelEm('再玩一次')).toBeGreaterThan(4);
    expect(labelEm('')).toBe(1);
  });

  it('is wired into hud.css with the same usable width', () => {
    expect(css).toContain(`.pp-grab span { font-size: min(1em, calc(var(--touch) * ${GRAB_LABEL_WIDTH} / var(--label-em, 1))); }`);
    // 86 % of a button 2.15 touch sizes wide, with a margin.
    expect(GRAB_LABEL_WIDTH).toBeLessThan(0.86 * 2.15);
  });

  it('leaves the default English label sizes untouched on every preset', () => {
    // .pp-grab: 46 units (START / GRAB), phones 40; PLAY AGAIN 27 / 26 (hud.css).
    const s = defaultSettings().profiles;
    for (const [profile, vw, vh, big] of [
      ['desktop', 1920, 1080, 46],
      ['portrait32', 1080, 1920, 46],
      ['portrait86', 1080, 1920, 46],
      ['mobile', 852, 393, 40],
    ] as const) {
      const l = solveLayout(profile, s[profile].layout, vw, vh, NO_INSETS);
      for (const key of ['hud.start', 'hud.grab'] as const) {
        const fit = (l.touch * GRAB_LABEL_WIDTH) / labelEm(uiEn[key]!);
        expect(fit, `${profile} ${key}`).toBeGreaterThanOrEqual(big * l.unit);
      }
    }
  });

  it('has a label for every language', () => {
    for (const table of [uiEn, uiZh, uiJa]) for (const key of KEYS) expect(labelEm(table[key] ?? '')).toBeGreaterThan(1);
  });
});
