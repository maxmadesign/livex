import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The authoritative simulation (src/game, src/physics) must not depend on
 * rendering, UI or graphics settings: quality levels can then never change
 * physics, grip rules or outcomes.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = join(root, 'src');

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTs(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

interface Import {
  spec: string;
  typeOnly: boolean;
}

function importsOf(file: string): Import[] {
  const text = readFileSync(file, 'utf8');
  const out: Import[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const clause = m[3] ?? '';
    // `import { type A, type B }` is type-only too.
    const named = clause.match(/\{([^}]*)\}/);
    const allInlineTypes = !!named && named[1]!.split(',').map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith('type '));
    const hasDefaultOrNamespace = /^[A-Za-z_$*]/.test(clause.trim()) && !clause.trim().startsWith('{');
    out.push({ spec: m[4]!, typeOnly: !!m[2] || (allInlineTypes && !hasDefaultOrNamespace) });
  }
  for (const d of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: d[1]!, typeOnly: false });
  for (const d of text.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) out.push({ spec: d[1]!, typeOnly: false });
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Runtime (non type-only) dependency closure of a set of entry files. */
function closure(entries: string[]): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const imp of importsOf(file)) {
      if (imp.typeOnly) continue;
      const local = resolveLocal(file, imp.spec);
      if (local) queue.push(local);
      else if (!imp.spec.startsWith('.')) packages.set(imp.spec, relative(root, file));
    }
  }
  return { files, packages };
}

describe('authoritative simulation is independent of rendering', () => {
  const entries = [...listTs(join(src, 'game')), ...listTs(join(src, 'physics'))];
  const { files, packages } = closure(entries);
  const rel = [...files].map((f) => relative(src, f).split('\\').join('/'));

  it('finds the simulation sources', () => {
    expect(entries.length).toBeGreaterThanOrEqual(8);
    expect(rel).toContain('game/GameCore.ts');
    expect(rel).toContain('physics/GripMonitor.ts');
  });

  it('pulls in nothing from the scene, the UI, the app shell, audio, AI or tracking at run time', () => {
    const forbidden = ['scene/', 'ui/', 'app/', 'audio/', 'ai/', 'tracking/', 'themes/', 'perspective/', 'layout/', 'i18n/', 'persistence/', 'diagnostics/'];
    const offenders = rel.filter((f) => forbidden.some((dir) => f.startsWith(dir)));
    expect(offenders).toEqual([]);
    // What it is allowed to consist of.
    for (const f of rel) expect(/^(game|physics|core|plush\/manifest\.ts|settings\/spec\.ts)/.test(f), f).toBe(true);
  });

  it('uses only math from three and the physics engine', () => {
    const allowed = new Set(['three', '@dimforge/rapier3d-compat']);
    const extra = [...packages.keys()].filter((p) => !allowed.has(p));
    expect(extra).toEqual([]);
    expect([...packages.keys()].some((p) => p.startsWith('three/examples'))).toBe(false);
  });

  it('never reads graphics settings or renderer state', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const r = relative(src, file).split('\\').join('/');
      if (!r.startsWith('game/') && !r.startsWith('physics/')) continue;
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      if (/\bGraphicsSettings\b|\.graphics\b|WebGLRenderer|renderScale|\bGRAPHICS_PRESETS\b|requestAnimationFrame|\bdocument\.|\bwindow\./.test(text)) offenders.push(r);
      // No hidden randomness in the outcome path: only the seeded generator from core/math is allowed.
      if (/Math\.random\(/.test(text) && !r.endsWith('RoundMachine.ts')) offenders.push(`${r} (Math.random)`);
    }
    expect(offenders).toEqual([]);
  });

  it('the only Math.random in the round machine is the session id for prize ids', () => {
    const text = readFileSync(join(src, 'game', 'RoundMachine.ts'), 'utf8');
    const uses = text.match(/Math\.random\(/g) ?? [];
    expect(uses.length).toBeLessThanOrEqual(1);
    expect(text).toMatch(/sessionId: string = Math\.random\(\)/);
  });
});
