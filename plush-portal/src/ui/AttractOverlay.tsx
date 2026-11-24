import type { CSSProperties } from 'react';
import { requestImmersive } from '../layout/phone';
import { hasCoarsePointer, type HudLayout } from '../layout/solve';
import { useApp, useT, useUi } from './context';
import { scoreHudRect, type ScoreHudRect } from './ScoreHud';

/** Size of the big START / GRAB button (src/ui/hud.css .pp-grab): the call to action is never smaller. */
const MAIN_BUTTON = 2.15;

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

/**
 * Attract / demo mode call to action: a big "tap to play" in the middle of the screen (and of
 * the 86" safe zone) while the machine plays by itself, with a pulsing glow ring, a shimmer,
 * a tapping hand and sparkles to invite a player. Pressing it — like START, Space or Enter —
 * stops the demo on the spot and starts a player round (Game.pressStart). Reduced motion keeps
 * it still. Mounted above the HUD and below dialogs (src/ui/App.tsx). Styles: src/ui/game.css.
 * Strings: src/i18n/strings/attract.ts.
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
  if (!(phase === 'ATTRACT' || demo) || modal !== null || themeBusy) return null;
  const { cx, cy, w, h } = ctaGeometry(layout, scoring ? scoreHudRect(layout) : null);
  // The keyboard hint only where a keyboard is likely (landscape desks, no touch screen).
  const keys = layout.panelStyle === 'split' && !layout.controls && !hasCoarsePointer();
  // The title never runs out of the button (small phones, the longer Japanese title): an upper bound
  // for its font size from the button's inner width, wide CJK glyphs vs. narrow uppercase Latin
  // (src/ui/game.css .pp-cta .title takes the smaller of this and its own size).
  const title = t('attract.cta');
  const wide = /[぀-ヿ㐀-鿿＀-￯]/.test(title);
  const fit = Math.max(14, (w - 2 * 49 * layout.unit) / (Math.max(1, [...title].length) * (wide ? 1.06 : 0.64)));
  return (
    <div className="pp-attract" data-testid="attract" aria-live="polite">
      <div className="pp-attract-glow" style={{ left: cx, top: cy, width: w * 1.6, height: h * 2.6 }} />
      <div className="pp-cta-wrap" style={{ left: cx, top: cy, width: w }}>
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
            <span className="sub">{t('attract.sub')}</span>
            <i className="spark a" aria-hidden="true" />
            <i className="spark b" aria-hidden="true" />
            <i className="spark c" aria-hidden="true" />
            <i className="spark d" aria-hidden="true" />
            <TapHand />
          </button>
        </div>
        {keys ? <span className="pp-cta-keys">{t('attract.keys')}</span> : null}
      </div>
    </div>
  );
}
