import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REFUSED_IMPORT, leaving, reaches, read, sources } from '../../../test/source.js';

const src = fileURLToPath(new URL('../src', import.meta.url));
const manifest = fileURLToPath(new URL('../package.json', import.meta.url));

/**
 * Every package `runner` may name, which is the design's dependency table for
 * it: core, and Playwright.
 *
 * This is an allowlist rather than a list of packages to refuse, and that is
 * the point of it. `@imgwhy/report` did not exist when this was written, so a
 * check that named it would have passed by accident and kept passing if the
 * name were ever misspelled. Nothing had to be added here when report landed —
 * or when anything else lands. Adding a name is the deliberate act.
 *
 * The report carries the mirror of this check, because "neither knows about
 * the other" is a claim in both directions or it is not a seam.
 */
const ALLOWED = new Set(['@imgwhy/core', 'playwright']);

/**
 * Every way one module leaves this package, one line each. Empty is clean.
 *
 * `node:` is exempt here and is not in the report's mirror of this check. The
 * runner opens browsers and reads files, so a Node built-in in it is the job.
 */
const leaves = leaving(ALLOWED, true);

describe('the runner package boundary', () => {
  const files = sources(src);

  it('has sources to check, so nothing below passes for want of a file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('reaches no package but core and Playwright, by any route', () => {
    const outside = files.flatMap((file) => leaves(relative(src, file), read(file)));

    expect(outside).toEqual([]);
  });

  it('reaches outside its own directory for nothing at all', () => {
    const inside = (path: string): boolean => path === src || path.startsWith(src + sep);
    const escaping = files.flatMap((file) =>
      reaches(read(file))
        .specifiers.filter((specifier) => specifier.startsWith('.'))
        .filter((specifier) => !inside(resolve(dirname(file), specifier)))
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
    const all = files.flatMap((file) => reaches(read(file)).specifiers);

    expect(all).toContain('@imgwhy/core');
    expect(all.some((specifier) => specifier.startsWith('./'))).toBe(true);
  });
});

/**
 * The check, read against modules written to defeat it.
 *
 * Every source below is a real way to reach `@imgwhy/report` from this
 * package, and the first two are the ones that passed while a regex over the
 * source text was doing the reading. They are held here rather than appended
 * to a source file, so the failure they should cause is a passing test rather
 * than a note in a commit message.
 */
describe('the runner package boundary check, given a module that leaves anyway', () => {
  const attacks: [string, string[], string[]][] = [
    [
      'a require it builds itself',
      [
        "import { createRequire } from 'node:module';",
        'const load = createRequire(import.meta.url);',
        "export const report = load('@imgwhy/report');",
      ],
      ['leaving.ts reaches a module through createRequire'],
    ],
    [
      'a dynamic import of a specifier it computes',
      [
        "const name = ['@imgwhy', 'report'].join('/');",
        'export const report = await import(name);',
      ],
      [`leaving.ts ${REFUSED_IMPORT}`],
    ],
    [
      'a deep import, which names no package until the path is cut off it',
      ["export { formatCapture } from 'imgwhy/dist/trace.js';"],
      ['leaving.ts imports imgwhy/dist/trace.js'],
    ],
    [
      'a plain require',
      ["export const report = require('@imgwhy/report');"],
      ['leaving.ts reaches a module through require'],
    ],
    [
      'a dynamic import of a literal',
      ["export const report = await import('@imgwhy/report');"],
      ['leaving.ts imports @imgwhy/report'],
    ],
    [
      'an import of types alone, which erases at build time and is still a dependency',
      ["import type { Report } from '@imgwhy/report';", 'export type Held = Report;'],
      ['leaving.ts imports @imgwhy/report'],
    ],
    [
      'an import type inside a type, which no import statement announces',
      ["export type Held = import('@imgwhy/report').Report;"],
      ['leaving.ts imports @imgwhy/report'],
    ],
  ];

  it.each(attacks)('catches %s', (_route, source, expected) => {
    expect(leaves('leaving.ts', source.join('\n'))).toEqual(expected);
  });

  it('reads no import out of a comment, which a regex over the text cannot help', () => {
    const commented = [
      "/** Formats with `chalk`, as `import chalk from 'chalk'` would. */",
      "// A path out would read `from '../../report/src/index.js'`.",
      'export const plain = true;',
    ].join('\n');

    expect(leaves('commented.ts', commented)).toEqual([]);
  });
});
