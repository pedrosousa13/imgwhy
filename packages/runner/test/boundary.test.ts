import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const manifest = fileURLToPath(new URL('../package.json', import.meta.url));

/**
 * Every package `runner` may name, which is the design's dependency table for
 * it: core, and Playwright.
 *
 * This is an allowlist rather than a list of packages to refuse, and that is
 * the point of it. `@imgwhy/report` arrives in M2 and does not exist yet, so a
 * check that named it would pass today by accident and keep passing if the
 * name were ever misspelled. Nothing has to be added here when report lands —
 * or when anything else lands. Adding a name is the deliberate act.
 */
const ALLOWED = new Set(['@imgwhy/core', 'playwright']);

/** Every `.ts` file under `src`, so a file added later is covered by default. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * The specifiers one file imports from.
 *
 * A regex reads them rather than a parser: this only has to see the import
 * forms the repo writes — `import`, `import type`, `export … from`, and a
 * dynamic `import(…)` — and every one of them puts the specifier in quotes
 * straight after `import` or `from`.
 */
function specifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/\b(?:import|from)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  );
}

/** The package a bare specifier belongs to, so a deep import cannot slip past. */
const packageOf = (specifier: string): string =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

describe('the runner package boundary', () => {
  const files = sources(src);

  it('has sources to check, so nothing below passes for want of a file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports no package but core and Playwright', () => {
    const outside = files.flatMap((file) =>
      specifiers(file)
        .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))
        .filter((specifier) => !ALLOWED.has(packageOf(specifier)))
        .map((specifier) => `${relative(src, file)} imports ${specifier}`),
    );

    expect(outside).toEqual([]);
  });

  it('reaches outside its own directory for nothing at all', () => {
    const escaping = files.flatMap((file) =>
      specifiers(file)
        .filter((specifier) => specifier.startsWith('.'))
        .filter((specifier) => {
          const target = resolve(dirname(file), specifier);
          return target !== src.slice(0, -1) && !target.startsWith(src);
        })
        .map((specifier) => `${relative(src, file)} imports ${specifier}`),
    );

    expect(escaping).toEqual([]);
  });

  it('declares no dependency but core and Playwright', () => {
    const declared: Record<string, string> =
      JSON.parse(readFileSync(manifest, 'utf8')).dependencies ?? {};

    expect(Object.keys(declared).sort()).toEqual([...ALLOWED].sort());
  });

  it('imports core, so the allowlist is doing work rather than matching nothing', () => {
    const all = files.flatMap(specifiers);

    expect(all).toContain('@imgwhy/core');
    expect(all.some((specifier) => specifier.startsWith('./'))).toBe(true);
  });
});
