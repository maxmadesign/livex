import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { brandForTheme, type BrandKit } from '../brand';
import type { ThemeId } from '../core/types';
import { requestImmersive } from '../layout/phone';
import { hasCoarsePointer, type HudLayout } from '../layout/solve';
import type { Settings } from '../settings/spec';
import { BrandLogo } from './BrandLogo';
import { useApp, useSettings, useT, useUi } from './context';
import { scoreHudRect, type ScoreHudRect } from './ScoreHud';

/** Size of the big START / GRAB button (src/ui/hud.css .pp-grab): the call to action is never smaller. */
const MAIN_BUTTON = 2.15;
/** Width of a Latin capital of the call to action title in em (Fredoka bold; the brand sans is wider). */
const NARROW_EM = 0.64;
const NARROW_EM_BRAND = 0.72;

/** A cartoon hand that keeps tapping the call to action. */
function TapHand() {
  return (
    <span className="pp-cta-hand" aria-hidden="true">
      <i className="ripple" />
      <svg viewBox="0 0 64 64">
        <path
          d="M26 6c3 0 5 2.2 5 5v17.5l2-.4c2.5-.4 4.7.9 5.4 3.1l.4-.1c2.6-.6 4.9.7 5.6 3l.3-.1c2.7-.5 5.1 1.2 5.5 3.8l1.3 10.6C52.4 56 46.7 62 39.5 62h-6.8c-4.3 0-8.2-2.2-10.4-5.8L13.8 42c-1.4-2.3-.8-5.2 1.4-6.7 2.1-1.4 4.9-1 6.5.9L21 37V11c0-2.8 2.2-5 5-5Z"
          fill="#fff"
          stroke="#3a2e44"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path d="M31 30v10M38.5 32v8M45.5 35v6" stroke="#3a2e44" strokeWidth="2.6" strokeLinecap="round" fill="none" opacity="0.55" />
      </svg>
    </span>
  );
}

/**
 * Centre and size of the call to action. Centred in the safe zone; where the control panel is a bar
 * inside the zone (portrait), centred in the free part above it; on a phone held sideways, between
 * the direction pad and the action button, below the top bar and the DEMO badge. Never smaller than
 * the big START button where the screen allows it.
 */
export function ctaGeometry(layout: HudLayout, score: ScoreHudRect | null = null): { cx: number; cy: number; w: number; h: number } {
  const u = layout.unit;
  const main = layout.touch * MAIN_BUTTON;
  const maxW = layout.vw - 2 * Math.max(12, layout.marginX);
  // Wider and taller than the big START button (which pulses up to 4.5 % larger).
  let w = Math.min(maxW, Math.max(760 * u, main * 3, 260));
  let h = Math.max(main * 1.15, 230 * u, 64);
  let cx = layout.vw / 2;
  const bottom = layout.panelStyle === 'bar' ? Math.min(layout.safeBottom, layout.panel.y - 10 * u) : layout.safeBottom;
  let cy = (layout.safeTop + bottom) / 2;
  const c = layout.controls;
  if (c) {
    const gap = Math.max(8, 12 * u);
    // Below the top bar and the DEMO badge under it; where the score sits under the top bar
    // (small phones), below the score, which then carries the DEMO tag (src/ui/Hud.tsx).
    const top = score && score.place === 'belowTop' ? score.y + score.h + gap : layout.topBar.y + layout.topBar.h + 14 + 62 * u + gap;
    if (layout.orientation === 'landscape') {
      const [left, right] = c.dpad.x <= c.action.x ? [c.dpad, c.action] : [c.action, c.dpad];
      const x0 = left.x + left.w + gap;
      const x1 = right.x - gap;
      const y1 = Math.min(c.status.y, c.menu.y) - gap;
      // The button pulses up to 4.5 % larger: it never grows into the pad or the action button.
      w = Math.max(160, Math.min(w, (x1 - x0) / 1.045));
      h = Math.max(56, Math.min(h, y1 - top));
      cx = (x0 + x1) / 2;
      cy = (top + y1) / 2;
    } else {
      const y1 = Math.min(c.dpad.y, c.action.y, c.status.y, c.menu.y) - gap;
      h = Math.max(56, Math.min(h, y1 - top));
      cy = (top + y1) / 2;
    }
  }
  return { cx, cy, w, h };
}

/** True when a real win in `theme` shows the prize-claim QR code (settings.rewards.mode, docs/REWARDS.md). */
export function rewardsShown(mode: Settings['rewards']['mode'], theme: ThemeId): boolean {
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return brandForTheme(theme)?.id === 'gtc';
}

/** String key of the line under the call to action's title. */
export function attractSubKey(kit: BrandKit | null, rewards: Settings['rewards'] | null): string {
  if (rewards) return `brand.attract.reward.${rewards.options}`;
  return kit ? 'brand.attract.sub' : 'attract.sub';
}

/** Sizes of the event logo and welcome headline above the call to action (brand kit themes only). */
export interface AttractBrandGeometry {
  /** Gap between the block and the top of the call to action, px. */
  gap: number;
  /** Logo height in px (0 = no room for it); the plate adds the kit's clear space around it. */
  logo: number;
  /** Headline font size in px. */
  headline: number;
}

/**
 * How big the event logo and the welcome headline can be in the free space between the top bar (and
 * the DEMO badge or the score under it) and the top of the call to action (`ctaTop`, as drawn), never
 * overlapping either, so the call to action itself keeps the geometry the layout tests check (inside
 * the 86" reach band). The logo shrinks to fit and is left out first; null = not even the headline fits.
 */
export function attractBrandGeometry(
  layout: HudLayout,
  ctaTop: number,
  kit: Pick<BrandKit, 'logo'>,
  opts: { score: ScoreHudRect | null; badge: boolean; headlineChars: number; wide: boolean },
): AttractBrandGeometry | null {
  const u = layout.unit;
  const gap = Math.max(10, 18 * u);
  const bottom = ctaTop - gap;
  const bar = layout.topBar;
  let top = bar.y + bar.h + Math.max(8, 12 * u);
  const score = opts.score;
  if (score && (score.place === 'top' || score.place === 'belowTop')) top = Math.max(top, score.y + score.h + Math.max(8, 10 * u));
  if (opts.badge) {
    // The DEMO badge under the top bar (or the score) during demo rounds (src/ui/Hud.tsx).
    const badgeTop = score?.place === 'belowTop' ? score.y + score.h + 12 * u : Math.max(layout.safeTop + 10, bar.y + bar.h + 14);
    top = Math.max(top, badgeTop + 60 * u + 8);
  }
  const room = bottom - top;
  const maxW = layout.vw - 2 * Math.max(12, layout.marginX);
  // Headline: large display text, narrowed until the whole line fits across the screen.
  const perChar = opts.wide ? 1.04 : 0.6;
  let headline = Math.max(15, 46 * u * layout.fontScale);
  headline = Math.min(headline, maxW / (Math.max(1, opts.headlineChars) * perChar));
  const lineH = headline * 1.2;
  if (headline < 12 || room < lineH) return null;
  // Logo on its plate: the plate is the clear space, (1 + 2 × clearSpace) logo heights tall.
  const k = kit.logo.clearSpace;
  const spacing = Math.max(6, 10 * u);
  let logo = Math.min(Math.max(36, 96 * u), (room - lineH - spacing) / (1 + 2 * k), maxW / (kit.logo.aspect + 2 * k));
  if (logo < 24) logo = 0;
  return { gap, logo: Math.floor(logo), headline: Math.floor(headline * 10) / 10 };
}

/** Height of an element as laid out (0 until it is mounted), kept up to date while `active`. */
function useHeight(ref: RefObject<HTMLElement | null>, active: boolean): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, active]);
  return height;
}

/**
 * Attract / demo mode call to action: a big "tap to play" in the middle of the screen (and of
 * the 86" safe zone) while the machine plays by itself, with a pulsing glow ring, a shimmer,
 * a tapping hand and sparkles to invite a player. Pressing it — like START, Space or Enter —
 * stops the demo on the spot and starts a player round (Game.pressStart). Reduced motion keeps
 * it still. In a theme dressed by a brand kit (src/brand) the event logo (as supplied, on a black
 * plate, never animated) and a welcome headline sit above it, and the line under the title invites
 * the visitor to scan the prize-claim QR code when rewards are on. Mounted above the HUD and below
 * dialogs (src/ui/App.tsx). Styles: src/ui/game.css, src/ui/theme-gpu.css. Strings:
 * src/i18n/strings/attract.ts, brand.* in ui.*.ts.
 */
export function AttractOverlay({ layout }: { layout: HudLayout }) {
  const app = useApp();
  const t = useT();
  const phase = useUi((s) => s.phase);
  const demo = useUi((s) => s.demo);
  const modal = useUi((s) => s.modal);
  const paused = useUi((s) => s.paused);
  const themeBusy = useUi((s) => s.themeBusy);
  const scoring = useUi((s) => s.score.enabled);
  const themeId = useUi((s) => s.themeId);
  const calibrating = useUi((s) => s.tracker.calibration.phase !== 'idle');
  const rewards = useSettings((s) => s.rewards);
  // Phones: the compact calibration card (src/ui/CalibrationOverlay.tsx) sits where the call to
  // action is, so the call to action steps aside while a calibration (or its result card) is shown.
  const shown = (phase === 'ATTRACT' || demo) && modal === null && !themeBusy && !(layout.controls && calibrating);
  // The call to action grows with its text (a two-line sub-line); the brand block sits above it as drawn.
  const wrapRef = useRef<HTMLDivElement>(null);
  const wrapHeight = useHeight(wrapRef, shown);
  if (!shown) return null;
  const score = scoring ? scoreHudRect(layout) : null;
  const { cx, cy, w, h } = ctaGeometry(layout, score);
  const kit = brandForTheme(themeId);
  // The keyboard hint only where a keyboard is likely (landscape desks, no touch screen).
  const keys = layout.panelStyle === 'split' && !layout.controls && !hasCoarsePointer();
  // The title never runs out of the button (small phones, the longer Japanese title): an upper bound
  // for its font size from the button's inner width, wide CJK glyphs vs. narrow uppercase Latin
  // (src/ui/game.css .pp-cta .title takes the smaller of this and its own size).
  const title = t('attract.cta');
  const wide = /[぀-ヿ㐀-鿿＀-￯]/.test(title);
  const narrow = kit ? NARROW_EM_BRAND : NARROW_EM;
  const fit = Math.max(14, (w - 2 * 49 * layout.unit) / (Math.max(1, [...title].length) * (wide ? 1.06 : narrow)));
  const sub = t(attractSubKey(kit, rewardsShown(rewards.mode, themeId) ? rewards : null));
  const welcome = kit ? t('brand.attract.welcome', { event: kit.eventName }) : '';
  // Same condition as the DEMO badge in src/ui/Hud.tsx.
  const badge = demo && phase !== 'ATTRACT' && !(layout.controls && score?.place === 'belowTop');
  // The wrap is centred on cy and starts with the call to action (the keyboard hint is below it).
  const ctaTop = cy - Math.max(h, wrapHeight) / 2;
  const brand = kit ? attractBrandGeometry(layout, ctaTop, kit, { score, badge, headlineChars: [...welcome].length, wide: /[぀-ヿ㐀-鿿＀-￯]/.test(welcome) }) : null;
  return (
    <div className="pp-attract" data-testid="attract" data-brand={kit?.id} aria-live="polite">
      <div className="pp-attract-glow" style={{ left: cx, top: cy, width: w * 1.6, height: h * 2.6 }} />
      <div className="pp-cta-wrap" ref={wrapRef} style={{ left: cx, top: cy, width: w }}>
        <div className="pp-cta-box">
          <span className="pp-cta-ring" />
          <span className="pp-cta-ring late" />
          <button
            type="button"
            className="pp-cta"
            data-testid="attract-cta"
            style={{ minHeight: h, '--cta-fit': `${fit.toFixed(1)}px` } as CSSProperties}
            disabled={paused}
            onClick={() => {
              // Phones: like the START button, the first tap also asks for full screen / landscape (best effort).
              if (layout.profile === 'mobile' && hasCoarsePointer()) requestImmersive();
              app.game.pressStart();
            }}
          >
            <span className="shine" aria-hidden="true" />
            <span className="title">{title}</span>
            <span className="sub">{sub}</span>
            <i className="spark a" aria-hidden="true" />
            <i className="spark b" aria-hidden="true" />
            <i className="spark c" aria-hidden="true" />
            <i className="spark d" aria-hidden="true" />
            <TapHand />
          </button>
        </div>
        {keys ? <span className="pp-cta-keys">{t('attract.keys')}</span> : null}
        {/* Anchored to the top of the call to action as drawn, and after it in document order: its
            rings pass behind the logo plate, never over it. */}
        {kit && brand ? (
          <div className="pp-attract-brand" data-testid="attract-brand" style={{ bottom: `calc(100% + ${brand.gap.toFixed(1)}px)`, '--headline': `${brand.headline}px` } as CSSProperties}>
            {brand.logo > 0 ? <BrandLogo slot={kit.logo} height={brand.logo} alt={t('brand.logo.alt', { event: kit.eventName })} testId="attract-logo" /> : null}
            <p className="pp-attract-welcome">{welcome}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
