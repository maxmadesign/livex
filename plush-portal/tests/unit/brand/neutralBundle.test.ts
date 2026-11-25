import path from 'node:path';
import { build, type Rollup } from 'vite';
import { describe, expect, it } from 'vitest';

/**
 * The kit copy of the GPU theme (src/i18n/strings/gpu.ts, ui.*.ts) is chosen so that a public demo
 * build (VITE_BRAND=neutral) decides it while bundling: the GTC kit's copy must not be in such a
 * bundle at all, not merely unused. Bundles the four string modules the way the app does (one
 * entry that only uses the merged tables) and looks for the GTC copy in the output.
 */

const root = path.resolve(__dirname, '../../..');
const ENTRY = 'virtual:kit-copy';
const MODULES = ['gpu.ts', 'ui.en.ts', 'ui.zh.ts', 'ui.ja.ts'].map((f) => JSON.stringify(path.join(root, 'src/i18n/strings', f)));

async function bundle(brand: string): Promise<string> {
  const out = (await build({
    configFile: false,
    root,
    logLevel: 'silent',
    mode: 'production',
    define: { 'import.meta.env.VITE_BRAND': JSON.stringify(brand) },
    plugins: [
      {
        name: 'kit-copy-entry',
        resolveId: (id: string) => (id === ENTRY ? `\0${ENTRY}` : null),
        load: (id: string) =>
          id === `\0${ENTRY}`
            ? `import { gpuStrings } from ${MODULES[0]}; import { uiEn } from ${MODULES[1]}; import { uiZh } from ${MODULES[2]}; import { uiJa } from ${MODULES[3]};\nexport default [gpuStrings, uiEn, uiZh, uiJa];`
            : null,
      },
    ],
    build: { write: false, minify: false, modulePreload: false, rollupOptions: { input: ENTRY } },
  })) as Rollup.RollupOutput | Rollup.RollupOutput[];
  const outputs = Array.isArray(out) ? out : [out];
  return outputs.flatMap((o) => o.output.filter((c): c is Rollup.OutputChunk => c.type === 'chunk').map((c) => c.code)).join('\n');
}

/** Phrases only the GTC kit's copy uses (en / zh / ja), and one only the neutral copy uses. */
const GTC_COPY = ['Welcome to GTC!', 'GTC booth claw machine', 'GTC 展台', 'GTCブース', 'GTCへようこそ'];
const NEUTRAL_COPY = 'Welcome to the GPU Party!';

describe('GPU theme copy in a bundle', () => {
  it('a neutral build carries none of the GTC copy; a GTC build carries it', { timeout: 120_000 }, async () => {
    const neutral = await bundle('neutral');
    expect(neutral).toContain(NEUTRAL_COPY);
    for (const phrase of GTC_COPY) expect(neutral, phrase).not.toContain(phrase);
    const gtc = await bundle('gtc');
    for (const phrase of GTC_COPY) expect(gtc, phrase).toContain(phrase);
  });
});
