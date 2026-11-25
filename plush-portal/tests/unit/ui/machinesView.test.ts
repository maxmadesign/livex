import { afterEach, describe, expect, it } from 'vitest';
import { INITIAL_MACHINE, type MachineCardInfo, type MachineUiState, type SessionResultUi } from '../../../src/app/gameStore';
import { DISPLAY_PROFILE_IDS, LANGS, THEME_IDS, type DisplayProfileId } from '../../../src/core/types';
import type { ScoreAward } from '../../../src/game/scoring';
import { hasString } from '../../../src/i18n';
import { registerAllStrings } from '../../../src/i18n/all';
import { NO_INSETS } from '../../../src/layout/safeArea';
import { solveLayout } from '../../../src/layout/solve';
import { defaultSettings, getFieldAt, listFieldPaths } from '../../../src/settings/spec';
import { NVIDIA_PALETTE } from '../../../src/brand/palette';
import { labelKey } from '../../../src/ui/settings/Field';
import { scoreHudRect } from '../../../src/ui/ScoreHud';
import { genreArtSvg, machineArtUrl, setMachinePreviewSource } from '../../../src/ui/machines/art';
import {
  INITIALS_LETTERS,
  TIME_LOW_SECONDS,
  cardsAcross,
  cycleLetter,
  formatClock,
  initialCardIndex,
  lobbyButton,
  lobbyFlow,
  normaliseInitials,
  plateLow,
  plateParams,
  progressSegments,
  ruleLine,
  secondsUntil,
  sessionHudRect,
  sessionSubtitle,
  showSessionHud,
  tryToastMs,
  tryToastView,
  wrapIndex,
} from '../../../src/ui/machines/view';

registerAllStrings();

const machines = defaultSettings().machines;
const VIEWPORTS: Record<DisplayProfileId, { w: number; h: number }[]> = {
  desktop: [
    { w: 1280, h: 720 },
    { w: 1920, h: 1080 },
  ],
  portrait32: [{ w: 1080, h: 1920 }],
  portrait86: [{ w: 1080, h: 1920 }],
  mobile: [
    { w: 844, h: 390 },
    { w: 390, h: 844 },
  ],
};
const layoutFor = (profile: DisplayProfileId, w: number, h: number) => solveLayout(profile, defaultSettings().profiles[profile].layout, w, h, NO_INSETS);
const session = (extra: Partial<MachineUiState['session']>): MachineUiState['session'] => ({ ...INITIAL_MACHINE.session, ...extra });

describe('machine UI: numbers and the coin plate', () => {
  it('formats the clock as m:ss and never below zero', () => {
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(0.2)).toBe('0:01');
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(120)).toBe('2:00');
  });

  it('shows the time plate as m:ss and leaves the other plates alone', () => {
    expect(plateParams({ key: 'machines.plate.time', params: { s: 42 } })).toEqual({ s: '0:42' });
    expect(plateParams({ key: 'machines.plate.tries', params: { left: 2, total: 5 } })).toEqual({ left: 2, total: 5 });
    expect(plateParams({ key: 'machines.plate.free' })).toBeUndefined();
  });

  it('marks a timed run urgent in its last ten seconds only', () => {
    expect(plateLow({ session: session({ kind: 'timed', state: 'running', secondsLeft: TIME_LOW_SECONDS }) })).toBe(true);
    expect(plateLow({ session: session({ kind: 'timed', state: 'running', secondsLeft: TIME_LOW_SECONDS + 1 }) })).toBe(false);
    expect(plateLow({ session: session({ kind: 'timed', state: 'over', secondsLeft: 0 }) })).toBe(false);
    expect(plateLow({ session: session({ kind: 'tries', state: 'running', secondsLeft: null }) })).toBe(false);
  });

  it('writes each card’s rule line from the committed settings', () => {
    expect(ruleLine('shelf', machines)).toEqual({ key: 'machines.rule.shelf', params: { tries: machines.shelf.tries, items: machines.shelf.rewardItems } });
    expect(ruleLine('rush', machines)).toEqual({ key: 'machines.rule.rush', params: { s: machines.rush.seconds } });
    expect(ruleLine('bridge', machines).key).toBe('machines.rule.bridge');
    expect(ruleLine('classic', machines).key).toBe('machines.rule.classic');
  });
});

describe('machine UI: the lobby', () => {
  const card = (extra: Partial<MachineCardInfo>): MachineCardInfo => ({ id: 'classic', genre: 'classic', locked: false, winsToUnlock: 0, current: false, dailyPick: false, best: 0, prizesHere: 0, top: [], ...extra });

  it('wraps around at both ends and starts on the current machine, else today’s pick', () => {
    expect(wrapIndex(4, 4)).toBe(0);
    expect(wrapIndex(-1, 4)).toBe(3);
    expect(wrapIndex(2, 0)).toBe(0);
    expect(initialCardIndex([card({}), card({ id: 'shelf', current: true }), card({ id: 'rush', dailyPick: true })])).toBe(1);
    expect(initialCardIndex([card({}), card({ id: 'shelf' }), card({ id: 'rush', dailyPick: true })])).toBe(2);
    expect(initialCardIndex([card({}), card({ id: 'shelf' })])).toBe(0);
  });

  it('is a sideways carousel on wide screens and a list on tall ones; three across on a desktop, about two on a phone', () => {
    expect(lobbyFlow({ vw: 1280, vh: 720 })).toBe('row');
    expect(lobbyFlow({ vw: 844, vh: 390 })).toBe('row');
    expect(lobbyFlow({ vw: 1080, vh: 1920 })).toBe('column');
    expect(lobbyFlow({ vw: 390, vh: 844 })).toBe('column');
    expect(cardsAcross(layoutFor('desktop', 1920, 1080), 4)).toBe(3);
    expect(cardsAcross(layoutFor('desktop', 1280, 720), 4)).toBe(3);
    const phone = cardsAcross(layoutFor('mobile', 844, 390), 4);
    expect(phone).toBeGreaterThan(1.5);
    expect(phone).toBeLessThanOrEqual(2.2);
    expect(cardsAcross(layoutFor('desktop', 1280, 720), 2)).toBe(2);
  });

  it('shows the MACHINES button only when there is a choice, and enables it at a boundary with nothing open', () => {
    const m = { lobby: true, switching: false };
    expect(lobbyButton(m, true, 4, false)).toEqual({ visible: true, enabled: true });
    expect(lobbyButton(m, true, 1, false)).toEqual({ visible: false, enabled: false });
    expect(lobbyButton(m, false, 4, false)).toEqual({ visible: false, enabled: false });
    expect(lobbyButton({ lobby: false, switching: false }, true, 4, false)).toEqual({ visible: true, enabled: false });
    expect(lobbyButton({ lobby: true, switching: true }, true, 4, false).enabled).toBe(false);
    expect(lobbyButton(m, true, 4, true).enabled).toBe(false);
  });
});

describe('machine UI: the session HUD', () => {
  it('shows only on a machine other than classic, for a player, not during a switch', () => {
    expect(showSessionHud({ id: 'shelf', switching: false }, 'READY', false)).toBe(true);
    expect(showSessionHud({ id: 'classic', switching: false }, 'READY', false)).toBe(false);
    expect(showSessionHud({ id: 'shelf', switching: true }, 'READY', false)).toBe(false);
    expect(showSessionHud({ id: 'shelf', switching: false }, 'ATTRACT', false)).toBe(false);
    expect(showSessionHud({ id: 'rush', switching: false }, 'DESCENDING', true)).toBe(false);
  });

  it('sits inside the safe zone, clear of the control panel and the score, on every preset', () => {
    for (const profile of DISPLAY_PROFILE_IDS) {
      for (const { w, h } of VIEWPORTS[profile]) {
        const layout = layoutFor(profile, w, h);
        const score = scoreHudRect(layout);
        const r = sessionHudRect(layout, score);
        const what = `${profile} ${w}×${h} (${r.place})`;
        expect(r.y, what).toBeGreaterThanOrEqual(layout.safeTop - 0.5);
        expect(r.y + r.h, what).toBeLessThanOrEqual(layout.safeBottom + 0.5);
        expect(r.x, what).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, what).toBeLessThanOrEqual(layout.vw + 0.5);
        const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlaps(r, layout.panel), `${what}: panel`).toBe(false);
        expect(overlaps(r, score), `${what}: score`).toBe(false);
        if (profile === 'portrait86') {
          expect(r.y / h, what).toBeGreaterThanOrEqual(0.25);
          expect((r.y + r.h) / h, what).toBeLessThanOrEqual(0.75);
        }
      }
    }
  });

  it('fills the bridge’s five progress segments in order', () => {
    expect(progressSegments(0)).toEqual([0, 0, 0, 0, 0]);
    expect(progressSegments(null)).toEqual([0, 0, 0, 0, 0]);
    expect(progressSegments(1)).toEqual([1, 1, 1, 1, 1]);
    const half = progressSegments(0.5);
    expect(half.slice(0, 2)).toEqual([1, 1]);
    expect(half[2]).toBeCloseTo(0.5, 6);
    expect(half.slice(3)).toEqual([0, 0]);
    expect(progressSegments(7)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('machine UI: the try toast and the session card', () => {
  const award = (extra: Partial<ScoreAward>): ScoreAward => ({
    roundId: 9,
    outcome: 'won',
    demo: false,
    typeId: null,
    tier: 'common',
    base: 40,
    difficultyMultiplier: 1,
    basePoints: 40,
    firstCatch: 0,
    cleanGrab: 0,
    consolation: 0,
    streak: 0,
    comboMultiplier: 1,
    comboBonus: 0,
    total: 40,
    session: 40,
    best: 40,
    newBest: false,
    ...extra,
  });

  it('names what dropped, the points and the extra rows of that very try', () => {
    const v = tryToastView('shelf', { roundId: 9, items: 2, points: 90 }, award({ comboMultiplier: 1.5, extras: [{ key: 'multiDrop', points: 20 }, { key: 'daily', points: 30 }], dailyBonus: 1.5 }));
    expect(v.scored).toBe(true);
    expect(v.headline).toEqual({ key: 'machines.try.boxes', params: { n: 2 } });
    expect(v.points).toBe(90);
    expect(v.extras).toEqual([
      { key: 'machines.try.multiDrop', params: { mult: 1.5 } },
      { key: 'machines.try.daily', params: { mult: 1.5 } },
    ]);
    expect(tryToastView('rush', { roundId: 9, items: 3, points: 70 }, award({ comboMultiplier: 1.25, extras: [{ key: 'handful', points: 10 }] })).extras).toEqual([{ key: 'machines.try.handful', params: { mult: 1.25 } }]);
    expect(tryToastView('rush', { roundId: 9, items: 1, points: 5 }, null).headline).toEqual({ key: 'machines.try.gems', params: { n: 1 } });
    // Another round's award, or a demo award, never lends its rows.
    expect(tryToastView('shelf', { roundId: 10, items: 2, points: 90 }, award({ extras: [{ key: 'daily', points: 30 }] })).extras).toEqual([]);
    expect(tryToastView('shelf', { roundId: 9, items: 2, points: 90 }, award({ demo: true, extras: [{ key: 'daily', points: 30 }] })).extras).toEqual([]);
    const miss = tryToastView('shelf', { roundId: 9, items: 0, points: 0 }, null);
    expect(miss).toMatchObject({ scored: false, headline: { key: 'machines.try.none' } });
    expect(tryToastMs('shelf', true)).toBeGreaterThan(tryToastMs('shelf', false));
    expect(tryToastMs('rush', true)).toBeLessThan(tryToastMs('shelf', true));
  });

  it('says what the session earned, or how close the shelf came', () => {
    const card = (extra: Partial<SessionResultUi>): SessionResultUi => ({ machineId: 'shelf', roundId: 4, reason: 'tries', items: 2, points: 100, best: 100, rank: null, rewardTypeId: null, ...extra });
    expect(sessionSubtitle(card({ rewardTypeId: 'sakura.bunny' }), 'shelf', machines, 'Cream Bunny')).toEqual({ key: 'machines.session.reward', params: { name: 'Cream Bunny' } });
    expect(sessionSubtitle(card({ items: 2 }), 'shelf', machines, null)).toEqual({ key: 'machines.session.noReward', params: { n: machines.shelf.rewardItems - 2 } });
    expect(sessionSubtitle(card({ items: machines.shelf.rewardItems }), 'shelf', machines, null).key).toBe('machines.session.thanks');
    expect(sessionSubtitle(card({ machineId: 'rush', reason: 'time' }), 'rush', machines, null).key).toBe('machines.session.noRewardRush');
    expect(sessionSubtitle(card({ machineId: 'rush', reason: 'time' }), 'rush', { ...machines, rush: { ...machines.rush, rewardValue: 0 } }, null).key).toBe('machines.session.thanks');
  });
});

describe('machine UI: initials', () => {
  it('cycles letters A ↔ Z and cleans what was entered', () => {
    expect(cycleLetter('A', 1)).toBe('B');
    expect(cycleLetter('A', -1)).toBe('Z');
    expect(cycleLetter('Z', 1)).toBe('A');
    expect(cycleLetter('m', 2)).toBe('O');
    expect(cycleLetter('?', 1)).toBe('B');
    expect(cycleLetter('C', 26 * 3)).toBe('C');
    expect(INITIALS_LETTERS).toHaveLength(26);
    expect(normaliseInitials(['a', 'b', 'c'])).toBe('ABC');
    expect(normaliseInitials(['Q'])).toBe('QAA');
    expect(normaliseInitials(['1', '!', 'xy'])).toBe('AAA');
    expect(normaliseInitials(['Z', 'Z', 'Z', 'Z'])).toBe('ZZZ');
  });

  it('counts the seconds left down to zero', () => {
    expect(secondsUntil(10_000, 0)).toBe(10);
    expect(secondsUntil(10_000, 9_001)).toBe(1);
    expect(secondsUntil(10_000, 12_000)).toBe(0);
  });
});

describe('machine card art', () => {
  afterEach(() => setMachinePreviewSource(null));

  it('draws every genre in every theme as a complete SVG', () => {
    for (const theme of THEME_IDS) {
      for (const genre of ['classic', 'bridge', 'shelf', 'rush'] as const) {
        const svg = genreArtSvg(genre, theme);
        expect(svg.startsWith('<svg'), `${genre}/${theme}`).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg).not.toMatch(/NaN|undefined|null|Infinity/);
        expect(svg.length).toBeGreaterThan(1500);
      }
    }
  });

  it('uses only the GPU palette on the GPU theme', () => {
    const allowed = new Set(Object.values(NVIDIA_PALETTE).map((c) => c.toLowerCase()));
    for (const genre of ['classic', 'bridge', 'shelf', 'rush'] as const) {
      const colours = [...genreArtSvg(genre, 'gpu').matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
      expect(colours.length).toBeGreaterThan(5);
      for (const c of colours) expect(allowed.has(c), `${genre}: ${c}`).toBe(true);
    }
  });

  it('switches to a registered rendered preview, and back to the drawing without one', () => {
    const drawn = machineArtUrl('shelf', 'shelf', 'sakura');
    expect(drawn.startsWith('data:image/svg+xml')).toBe(true);
    setMachinePreviewSource((id, genre, theme) => (id === 'shelf' ? `preview:${genre}:${theme}` : null));
    expect(machineArtUrl('shelf', 'shelf', 'ocean')).toBe('preview:shelf:ocean');
    expect(machineArtUrl('rush', 'rush', 'ocean').startsWith('data:image/svg+xml')).toBe(true);
    setMachinePreviewSource(null);
    expect(machineArtUrl('shelf', 'shelf', 'sakura')).toBe(drawn);
  });
});

describe('Settings → Gameplay → Machines', () => {
  it('has a label and a hint for every machines.* setting, and a label for every option, in every language', () => {
    const paths = listFieldPaths().filter((p) => p.startsWith('machines.'));
    expect(paths.length).toBeGreaterThanOrEqual(17);
    for (const path of paths) {
      const key = labelKey(path);
      const field = getFieldAt(path)!;
      for (const lang of LANGS) {
        expect(hasString(lang, key), `${lang}:${key}`).toBe(true);
        expect(hasString(lang, `${key}.hint`), `${lang}:${key}.hint`).toBe(true);
        if (field.kind === 'enum') for (const o of field.options) expect(hasString(lang, `${key}.o.${o}`), `${lang}:${key}.o.${o}`).toBe(true);
      }
    }
    for (const lang of LANGS) {
      expect(hasString(lang, 'set.machines.section')).toBe(true);
      for (const g of ['bridge', 'shelf', 'rush']) expect(hasString(lang, `set.machines.group.${g}`)).toBe(true);
    }
  });

  it('has every key the game and the director use, in every language', () => {
    const used = [
      'machines.toast.after',
      'machines.toast.locked',
      'machines.toast.failed',
      'machines.staff.done',
      'machines.plate.free',
      'machines.plate.try',
      'machines.plate.tries',
      'machines.plate.time',
      ...['classic', 'bridge', 'shelf', 'rush'].flatMap((id) => ['name', 'tag', 'tagline', 'howto'].map((k) => `machines.${id}.${k}`)),
    ];
    for (const lang of LANGS) for (const key of used) expect(hasString(lang, key), `${lang}:${key}`).toBe(true);
  });
});
