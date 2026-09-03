import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REFUSED_IMPORT, leaving, reaches, read, sources } from '../../../test/source.js';

const src = fileURLToPath(new URL('../src', import.meta.url));
const manifest = fileURLToPath(new URL('../package.json', import.meta.url));

/**
 * Every package `report` may name, which is the design's dependency table for
 * it: core, and nothing else.
 *
 * This is the mirror of the check the runner carries. There, the point is that
 * the runner never reaches the report; here, that the report never reaches the
 * runner, and never reaches Playwright through it. A report is a pure function
 * of a Capture — the Capture is the seam, and "neither knows about the other"
 * is a claim in both directions or it is not a seam.
 *
 * An allowlist rather than a list of packages to refuse, so nothing has to be
 * added here when a package lands, and a name that was never spelled right
 * cannot pass by accident. Adding a name is the deliberate act.
 *
 * `node:` is not exempt, which is the one way this list is stricter than the
 * runner's. The runner opens browsers and reads files; this package takes a
 * Capture and returns a string, so a Node built-in in it would mean it had
 * started doing something else — reading a template off disk, say, which is
 * the first step to a report that is not one file.
 */
const ALLOWED = new Set(['@imgwhy/core']);

/**
 * Every way one module leaves this package, one line each. Empty is clean.
 *
 * `node:` is not exempt, which is the one way this is stricter than the
 * runner's: the paragraph above says why.
 */
const leaves = leaving(ALLOWED, false);

describe('the report package boundary', () => {
  const files = sources(src);

  it('has sources to check, so nothing below passes for want of a file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('reaches no package but core, by any route', () => {
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

  it('declares no dependency but core', () => {
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
 * The check, read against modules written to leave anyway.
 *
 * Every source below is a real way for this package to stop being a pure
 * function of a Capture. They are held here rather than appended to a source
 * file, so the failure they should cause is a passing test rather than a note
 * in a commit message.
 */
describe('the report package boundary check, given a module that leaves anyway', () => {
  const attacks: [string, string[], string[]][] = [
    [
      'a browser, which would make a report of a page rather than of a Capture',
      ["import { chromium } from 'playwright';", 'export const open = chromium.launch;'],
      ['leaving.ts imports playwright'],
    ],
    [
      'the runner, which is the other half of a seam that only works both ways',
      ["import { capturePage } from '@imgwhy/runner';", 'export const measure = capturePage;'],
      ['leaving.ts imports @imgwhy/runner'],
    ],
    [
      'the command, which would make the report depend on its own caller',
      ["export { formatCapture } from 'imgwhy/dist/trace.js';"],
      ['leaving.ts imports imgwhy/dist/trace.js'],
    ],
    [
      'a Node built-in, which the runner may have and this package may not',
      ["import { readFileSync } from 'node:fs';", 'export const read = readFileSync;'],
      ['leaving.ts imports node:fs'],
    ],
    [
      'a template engine, which would put the markup somewhere other than here',
      ["import handlebars from 'handlebars';", 'export const compile = handlebars.compile;'],
      ['leaving.ts imports handlebars'],
    ],
    [
      'a require it builds itself',
      [
        "import { createRequire } from 'node:module';",
        'const load = createRequire(import.meta.url);',
        "export const runner = load('@imgwhy/runner');",
      ],
      [
        'leaving.ts reaches a module through createRequire',
        'leaving.ts imports node:module',
      ],
    ],
    [
      'a dynamic import of a specifier it computes',
      [
        "const name = ['@imgwhy', 'runner'].join('/');",
        'export const runner = await import(name);',
      ],
      [`leaving.ts ${REFUSED_IMPORT}`],
    ],
    [
      'an import of types alone, which erases at build time and is still a dependency',
      ["import type { Browser } from 'playwright';", 'export type Held = Browser;'],
      ['leaving.ts imports playwright'],
    ],
    [
      'an import type inside a type, which no import statement announces',
      ["export type Held = import('playwright').Browser;"],
      ['leaving.ts imports playwright'],
    ],
  ];

  it.each(attacks)('catches %s', (_route, source, expected) => {
    expect(leaves('leaving.ts', source.join('\n'))).toEqual(expected);
  });

  it('is quiet about the imports the package actually makes', () => {
    const shipped = [
      "import type { Capture } from '@imgwhy/core';",
      "import { explainSelection } from '@imgwhy/core';",
      "import { html } from './html.js';",
      'export const used = [explainSelection, html];',
      'export type Held = Capture;',
    ].join('\n');

    expect(leaves('report.ts', shipped)).toEqual([]);
  });

  it('reads no import out of a comment, which a regex over the text cannot help', () => {
    const commented = [
      "/** Never `import { chromium } from 'playwright'` — a Capture is the seam. */",
      "// A path out would read `from '../../runner/src/capture.js'`.",
      'export const plain = true;',
    ].join('\n');

    expect(leaves('commented.ts', commented)).toEqual([]);
  });
});
