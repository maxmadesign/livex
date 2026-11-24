import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRAND_KITS, type BrandKit } from '../../../src/brand';
import { brandFontStack, brandFontStatus, fallbackFamilies, loadBrandFont, onBrandFontStatus, resetBrandFonts } from '../../../src/brand/fonts';
import { brandFolder, fontStatus, logoStatus } from '../../../src/ui/settings/brandStatus';

const gtc: BrandKit = BRAND_KITS.gtc;
const neutral: BrandKit = BRAND_KITS.neutral;

describe('brand font stack', () => {
  it('drops generic families so CJK fonts listed after it still get their glyphs', () => {
    expect(fallbackFamilies(gtc)).toEqual(['Inter Variable', 'Inter', 'Helvetica Neue', 'Arial']);
    expect(fallbackFamilies({ font: { family: '', files: [], fallback: "'A B', system-ui, sans-serif, ui-sans-serif" } })).toEqual(['A B']);
  });

  it('puts the brand family first only once it has loaded', () => {
    expect(brandFontStack(gtc, false)).toBe('"Inter Variable", "Inter", "Helvetica Neue", "Arial"');
    expect(brandFontStack(gtc, true)).toBe(`"${gtc.font.family}", "Inter Variable", "Inter", "Helvetica Neue", "Arial"`);
    // A kit without a typeface never names one.
    expect(brandFontStack(neutral, true)).toBe(brandFontStack(neutral, false));
  });
});

describe('loading the brand font files', () => {
  let props: Record<string, string>;
  let added: unknown[];
  let responses: Record<string, { status: number; type: string }>;

  beforeEach(() => {
    resetBrandFonts();
    props = {};
    added = [];
    responses = {};
    vi.stubGlobal('document', {
      documentElement: { style: { setProperty: (name: string, value: string) => (props[name] = value) } },
      fonts: { add: (face: unknown) => added.push(face) },
    });
    vi.stubGlobal(
      'FontFace',
      class {
        constructor(
          public family: string,
          public data: ArrayBuffer,
          public descriptors: Record<string, string>,
        ) {}
        load() {
          return Promise.resolve(this);
        }
      },
    );
    vi.stubGlobal('fetch', async (url: string) => {
      const hit = Object.entries(responses).find(([suffix]) => url.endsWith(suffix))?.[1] ?? { status: 404, type: 'text/plain' };
      return {
        ok: hit.status < 400,
        status: hit.status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? hit.type : null) },
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetBrandFonts();
  });

  it('falls back silently when the official files are missing', async () => {
    const seen: string[] = [];
    const off = onBrandFontStatus(() => seen.push(brandFontStatus(gtc).state));
    const status = await loadBrandFont(gtc);
    off();
    expect(status.state).toBe('fallback');
    expect(status.missing).toEqual(gtc.font.files.map((f) => f.url).sort());
    expect(added).toEqual([]);
    expect(props['--font-brand']).toBe(brandFontStack(gtc, false));
    expect(seen).toEqual(['pending', 'fallback']);
    // Asked once per kit.
    expect(await loadBrandFont(gtc)).toBe(status);
  });

  it('does not take an HTML page (a dev server fallback) for a font', async () => {
    for (const file of gtc.font.files) responses[file.url] = { status: 200, type: 'text/html' };
    expect((await loadBrandFont(gtc)).state).toBe('fallback');
    expect(added).toEqual([]);
  });

  it('installs the files that exist and names the family first', async () => {
    responses[gtc.font.files[0]!.url] = { status: 200, type: 'font/woff2' };
    const status = await loadBrandFont(gtc);
    expect(status.state).toBe('loaded');
    expect(status.loaded).toEqual([gtc.font.files[0]!.url]);
    expect(status.missing).toEqual([gtc.font.files[1]!.url]);
    expect(added).toHaveLength(1);
    expect((added[0] as { family: string; descriptors: Record<string, string> }).family).toBe(gtc.font.family);
    expect((added[0] as { descriptors: Record<string, string> }).descriptors.weight).toBe(String(gtc.font.files[0]!.weight));
    expect(props['--font-brand']).toBe(brandFontStack(gtc, true));
  });

  it('asks for nothing when the kit has no typeface', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      throw new Error('no request expected');
    });
    expect((await loadBrandFont(neutral)).state).toBe('none');
    expect(calls).toBe(0);
    expect(props['--font-brand']).toBe(brandFontStack(neutral, false));
  });
});

describe('brand status lines (Settings → Themes & Toys)', () => {
  it('says whether the official logo, the placeholder or nothing is drawn, and where the file goes', () => {
    expect(logoStatus(gtc.logo, null).state).toBe('checking');
    expect(logoStatus(gtc.logo, { url: '/assets/brand/gtc/gtc-logo.svg', official: true, path: 'assets/brand/gtc/gtc-logo.svg' })).toMatchObject({ key: 'brand.status.logo.official', state: 'found' });
    expect(logoStatus(gtc.logo, { url: `/${gtc.logo.placeholder}`, official: false, path: gtc.logo.placeholder })).toMatchObject({
      key: 'brand.status.logo.placeholder',
      params: { path: gtc.logo.official[0] },
      state: 'placeholder',
    });
    expect(logoStatus(gtc.hostLogo, { url: null, official: false, path: null })).toMatchObject({ key: 'brand.status.logo.missing', params: { path: gtc.hostLogo!.official[0] }, state: 'missing' });
    expect(logoStatus(neutral.hostLogo, null)).toMatchObject({ key: 'brand.status.logo.none', state: 'none' });
    // The neutral kit's own original emblem is not a placeholder waiting for a file.
    expect(logoStatus(neutral.logo, { url: `/${neutral.logo.official[0]}`, official: false, path: neutral.logo.official[0]! }).state).toBe('original');
    expect(brandFolder(gtc)).toBe('assets/brand/gtc/');
  });

  it('says whether the brand font loaded or which fallback is drawn', () => {
    const base = { family: gtc.font.family, fallback: 'Inter Variable, Inter, Arial', loaded: [], missing: [] };
    expect(fontStatus(gtc, { ...base, state: 'pending' }).state).toBe('checking');
    expect(fontStatus(gtc, { ...base, state: 'loaded' })).toMatchObject({ key: 'brand.status.font.loaded', params: { family: gtc.font.family } });
    expect(fontStatus(gtc, { ...base, state: 'fallback' })).toMatchObject({
      key: 'brand.status.font.fallback',
      params: { family: gtc.font.family, fallback: 'Inter Variable', path: 'assets/brand/gtc/fonts/' },
    });
    expect(fontStatus(neutral, { ...base, family: '', state: 'none' })).toMatchObject({ key: 'brand.status.font.none', params: { fallback: 'Inter Variable' } });
  });
});
