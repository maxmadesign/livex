import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHONE } from '../../../src/layout/solve';

/**
 * The solver reserves room for Momo's block from PHONE.*; hud.css caps the block with the same
 * numbers. If the two drift apart the bubble can grow into a control, so they are checked together.
 */
const css = readFileSync(new URL('../../../src/ui/hud.css', import.meta.url), 'utf8');
const phones = css.slice(css.indexOf('/* ===================================================================== phones'));

describe('phone limits in hud.css match the solver', () => {
  it('caps the sideways bubble and Momo at the solver sizes', () => {
    expect(phones).toContain(`max-height: calc(var(--u) * ${PHONE.bubble} * var(--fs))`);
    expect(phones).toContain(`width: max(${PHONE.touchMin}px, calc(var(--u) * ${PHONE.momo}))`);
    expect(phones).toContain(`flex-direction: column-reverse; justify-content: flex-start; align-items: flex-end; gap: calc(var(--u) * ${PHONE.guideGap}); }`);
  });

  it('uses the short tier at the same height, with the same caps', () => {
    expect(phones).toContain(`@media (orientation: landscape) and (max-height: ${PHONE.shortHeight}px)`);
    expect(phones).toContain(`max-height: calc(var(--u) * ${PHONE.bubbleShort} * var(--fs))`);
    expect(phones).toContain(`width: max(${PHONE.touchMin}px, calc(var(--u) * ${PHONE.momoShort}))`);
  });

  it('caps the upright bubble at the solver row height', () => {
    expect(phones).toContain(`max-height: calc(var(--u) * (${PHONE.bubbleRow} * var(--fs) + 20))`);
  });

  it('fills the joystick slot of the solver and keeps the gap it assumes between menu buttons', () => {
    // The joystick takes the old direction pad's slot (3 touch sizes + 2 × PHONE.dpadGap) whole.
    expect(phones).toContain('.pp-panel.phone .pp-dpad { width: 100%; height: 100%; }');
    expect(phones).toContain(`gap: calc(var(--u) * ${PHONE.menuGap}); }`);
  });

  it('never lets a phone touch target fall under the minimum', () => {
    for (const rule of ['.pp-btn.small { min-height: 44px; min-width: 44px; }', '.pp-seg button { min-width: 44px; }', '.pp-range { height: 44px; }', 'button.pp-chip { min-height: 44px; min-width: 44px;']) {
      expect(phones, rule).toContain(rule);
    }
    expect(PHONE.touchMin).toBe(44);
  });
});
