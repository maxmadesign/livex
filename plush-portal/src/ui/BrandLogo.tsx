import { useEffect, useState, type CSSProperties } from 'react';
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
 * A kit logo drawn exactly as supplied: scaled uniformly into a box of the slot's aspect (never
 * stretched, tinted, filtered or animated). With `plate` it sits on a plain black plate whose padding
 * is the kit's clear space, so nothing else (text, light effects) comes closer than that; without
 * it the caller keeps that space free. `height` is the logo height in CSS px; when it is left out
 * the stylesheet sets --logo-h. Styles: src/ui/theme-gpu.css (.pp-brand-logo).
 */
export function BrandLogo({ slot, height, alt, plate = true, testId }: { slot: LogoSlot; height?: number; alt: string; plate?: boolean; testId?: string }) {
  const logo = useBrandLogo(slot);
  const style = {
    '--logo-aspect': slot.aspect,
    '--logo-clear-k': slot.clearSpace,
    ...(height !== undefined ? { '--logo-h': `${Math.round(height)}px` } : {}),
  } as CSSProperties;
  return (
    // Until the file is known the box keeps its place but shows nothing (no empty plate flashes up).
    <span className="pp-brand-logo" data-plate={plate} data-ready={!!logo?.url} data-official={logo?.official ?? false} data-testid={testId} style={style}>
      {logo?.url ? <img src={logo.url} alt={alt} draggable={false} /> : <span className="slot" aria-hidden="true" />}
    </span>
  );
}
