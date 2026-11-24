import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { brandFilesJson, listBrandFiles } from '../../../server/brandFiles';
import { createStaticHandler } from '../../../server/static';
import { brandFiles, mayExist, resetBrandFiles } from '../../../src/brand/files';
import { BRAND_KITS } from '../../../src/brand/kits';
import { resetBrandCache, resolveLogo } from '../../../src/brand';

const dirs: string[] = [];
function site(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'plush-brand-'));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.unstubAllGlobals();
  resetBrandCache();
});

describe('brand file listing (server side)', () => {
  it('lists files under assets/brand with site-root paths, skipping READMEs, dot files and itself', () => {
    const root = site({
      'assets/brand/gtc/gtc-logo.placeholder.svg': '<svg/>',
      'assets/brand/gtc/gtc-logo.svg': '<svg/>',
      'assets/brand/gtc/fonts/NVIDIASans-Bold.woff2': 'x',
      'assets/brand/gtc/README.md': '# readme',
      'assets/brand/gtc/.DS_Store': 'x',
      'assets/brand/files.json': '{}',
      'assets/themes/gpu/logo.svg': '<svg/>',
    });
    expect(listBrandFiles(root)).toEqual(['assets/brand/gtc/fonts/NVIDIASans-Bold.woff2', 'assets/brand/gtc/gtc-logo.placeholder.svg', 'assets/brand/gtc/gtc-logo.svg']);
  });

  it('answers an empty list when the folder is missing', () => {
    expect(JSON.parse(brandFilesJson(site({})))).toEqual({ files: [] });
  });

  it('lists the placeholder shipped in public/ and no official file', () => {
    const files = listBrandFiles(path.resolve(__dirname, '../../../public'));
    expect(files).toContain(BRAND_KITS.gtc.logo.placeholder);
    for (const official of BRAND_KITS.gtc.logo.official) expect(files).not.toContain(official);
  });

  it('the static handler serves a live listing and revalidates brand files', async () => {
    const root = site({ 'index.html': '<!doctype html>', 'assets/brand/gtc/gtc-logo.placeholder.svg': '<svg/>' });
    const handler = createStaticHandler(root);
    const first = await handler('/assets/brand/files.json', 'GET');
    expect(first?.headers.get('cache-control')).toBe('no-cache');
    expect(((await first!.json()) as { files: string[] }).files).toEqual(['assets/brand/gtc/gtc-logo.placeholder.svg']);
    // Official artwork dropped into the served folder shows up without a rebuild.
    writeFileSync(path.join(root, 'assets/brand/gtc/gtc-logo.svg'), '<svg/>');
    const second = await handler('/assets/brand/files.json', 'GET');
    expect(((await second!.json()) as { files: string[] }).files).toContain('assets/brand/gtc/gtc-logo.svg');
    const logo = await handler('/assets/brand/gtc/gtc-logo.svg', 'GET');
    expect(logo?.headers.get('cache-control')).toBe('no-cache');
  });
});

describe('brand file listing (browser side)', () => {
  function stubFetch(listing: string[] | null, images: string[] = []) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      if (url.endsWith('assets/brand/files.json')) {
        return listing === null ? new Response('nope', { status: 404 }) : new Response(JSON.stringify({ files: listing }), { headers: { 'content-type': 'application/json' } });
      }
      if (images.some((i) => url.endsWith(i))) return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
      return new Response('missing', { status: 404 });
    });
    return calls;
  }

  it('never requests an official logo the listing does not contain', async () => {
    resetBrandFiles();
    const calls = stubFetch([BRAND_KITS.gtc.logo.placeholder!]);
    const logo = await resolveLogo(BRAND_KITS.gtc.logo);
    expect(logo).toMatchObject({ official: false, path: BRAND_KITS.gtc.logo.placeholder });
    expect(calls.filter((c) => /gtc-logo\.(svg|png)$/.test(c))).toEqual([]);
  });

  it('uses an official logo once it is listed', async () => {
    resetBrandFiles();
    stubFetch([BRAND_KITS.gtc.logo.official[0]!, BRAND_KITS.gtc.logo.placeholder!], [BRAND_KITS.gtc.logo.official[0]!]);
    expect(await resolveLogo(BRAND_KITS.gtc.logo)).toMatchObject({ official: true, path: BRAND_KITS.gtc.logo.official[0] });
  });

  it('falls back to probing when the host has no listing', async () => {
    resetBrandFiles();
    stubFetch(null, [BRAND_KITS.gtc.logo.official[1]!]);
    expect(await brandFiles()).toBeNull();
    expect(await mayExist('assets/brand/gtc/anything.svg')).toBe(true);
    expect(await resolveLogo(BRAND_KITS.gtc.logo)).toMatchObject({ official: true, path: BRAND_KITS.gtc.logo.official[1] });
  });

  it('paths outside assets/brand are always probed', async () => {
    resetBrandFiles();
    stubFetch([]);
    expect(await mayExist('assets/themes/gpu/logo.svg')).toBe(true);
    expect(await mayExist('assets/brand/gtc/gtc-logo.svg')).toBe(false);
  });
});
