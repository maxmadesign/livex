import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { resolveLogo, type LogoSlot, type ResolvedLogo } from '../brand';

/**
 * The logo file of a kit slot (official file, else the original placeholder, else nothing), or
 * null while it is being looked up. resolveLogo caches per slot, so every screen agrees.
 */
export function useBrandLogo(slot: LogoSlot | null | undefined): ResolvedLogo | null {
  const [logo, setLogo] = useState<ResolvedLogo | null>(null);
  useEffect(() => {
    if (!slot) {
      setLogo({ url: null, official: false, path: null });
      return;
    }
    let live = true;
    void resolveLogo(slot).then((resolved) => {
      if (live) setLogo(resolved);
    });
    return () => {
      live = false;
    };
  }, [slot]);
  return logo;
}

/**
 * Moves the logo image by less than a pixel so that it starts on a whole device pixel. Centred
 * layouts (translate(-50%), flex centring) put it at fractional offsets (the attract logo sat at
 * x 572.35, y 114.48), where the whole bitmap is resampled and every edge of the artwork blurs. Runs
 * after every render and on window resizes. Thin details of a very small logo (a 2 px bar) still
 * blend with the plate at their own edges: that is the artwork's geometry, not a tint.
 */
function useWholePixels(ref: RefObject<HTMLImageElement | null>): void {
  useLayoutEffect(() => {
    const img = ref.current;
    if (!img) return;
    const snap = () => {
      img.style.translate = '';
      const r = img.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // Ancestors may scale the HUD (the simulated 9:16 screen): convert the screen offset back.
      const scale = img.offsetWidth > 0 && r.width > 0 ? r.width / img.offsetWidth : 1;
      const dx = (Math.round(r.left * dpr) / dpr - r.left) / scale;
      const dy = (Math.round(r.top * dpr) / dpr - r.top) / scale;
      if (Math.abs(dx) > 1e-3 || Math.abs(dy) > 1e-3) img.style.translate = `${dx.toFixed(3)}px ${dy.toFixed(3)}px`;
    };
    snap();
    window.addEventListener('resize', snap);
    return () => window.removeEventListener('resize', snap);
  });
}

/**
 * A kit logo drawn exactly as supplied: scaled uniformly into a box of the slot's aspect (never
 * stretched, tinted, filtered or animated) and placed on whole device pixels. With `plate` it sits
 * on a plain black plate whose padding is the kit's clear space, so nothing else (text, light
 * effects) comes closer than that; without it the caller keeps that space free. `height` is the
 * logo height in CSS px; when it is left out the stylesheet sets --logo-h. Styles:
 * src/ui/theme-gpu.css (.pp-brand-logo).
 */
export function BrandLogo({ slot, height, alt, plate = true, testId }: { slot: LogoSlot; height?: number; alt: string; plate?: boolean; testId?: string }) {
  const logo = useBrandLogo(slot);
  const imgRef = useRef<HTMLImageElement>(null);
  useWholePixels(imgRef);
  const style = {
    '--logo-aspect': slot.aspect,
    '--logo-clear-k': slot.clearSpace,
    ...(height !== undefined ? { '--logo-h': `${Math.round(height)}px` } : {}),
  } as CSSProperties;
  return (
    // Until the file is known the box keeps its place but shows nothing (no empty plate flashes up).
    <span className="pp-brand-logo" data-plate={plate} data-ready={!!logo?.url} data-official={logo?.official ?? false} data-testid={testId} style={style}>
      {logo?.url ? <img ref={imgRef} src={logo.url} alt={alt} draggable={false} /> : <span className="slot" aria-hidden="true" />}
    </span>
  );
}
