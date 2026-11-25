import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { LANGS, type Lang } from '../../../src/core/types';
import { translate } from '../../../src/i18n';
import { registerAllStrings } from '../../../src/i18n/all';
import type { App } from '../../../src/app/bootstrap';
import { AppContext } from '../../../src/ui/context';
import { RewardInstruction, type RewardView } from '../../../src/ui/RewardCard';
import { defaultSettings } from '../../../src/settings/spec';

registerAllStrings();

/** The instruction line under the QR of a win card, rendered as the card renders it. */
function instruction(view: RewardView, lang: Lang): string {
  const settings = defaultSettings();
  settings.system.language = lang;
  const app = { settings: createStore(() => ({ settings, draft: null, repaired: false })) } as unknown as App;
  const html = renderToStaticMarkup(createElement(AppContext.Provider, { value: app }, createElement(RewardInstruction, { view })));
  return html.replace(/<[^>]+>/g, '');
}

const view = (state: RewardView['state']): RewardView => ({
  state,
  url: 'https://example.com/plush-portal-demo/K7M2ABCD',
  code: 'K7M2ABCD',
  options: 'both',
  visibleUntil: 0,
  totalMs: 60_000,
  reason: null,
  discountText: '',
});

describe('win card instruction of a public demo copy', () => {
  it('does not promise a prize next to the "DEMO — not redeemable" label', () => {
    for (const lang of LANGS) {
      const demo = instruction(view('demoBuild'), lang);
      // The review saw "Scan to collect your prize or get a swag discount" under a DEMO code.
      expect(demo, lang).toBe(translate(lang, 'reward.instr.demo'));
      expect(demo, lang).not.toBe(translate(lang, 'reward.instr.both'));
      // A real code keeps the invitation to scan.
      expect(instruction(view('ready'), lang), lang).toBe(translate(lang, 'reward.instr.both'));
    }
    expect(translate('en', 'reward.instr.demo')).not.toMatch(/prize|swag|collect/i);
  });
});
