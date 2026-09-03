import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse, read, sources } from './source.js';

const src = fileURLToPath(new URL('../src', import.meta.url));
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

/** What one module reaches for, split by whether the reach can be checked. */
type Reaches = {
  /** The specifiers it names, in the order they are written. */
  specifiers: string[];
  /** The routes out that carry no specifier to check, one line each. */
  refused: string[];
};

const REFUSED_IMPORT = 'reaches a module through an import() it computes at run time';

/**
 * Read what a module reaches for out of TypeScript's own syntax tree.
 *
 * `parse` says why a syntax tree and not a regex over the text. Both of these
 * left the package while a regex was doing the reading:
 *
 * ```ts
 * createRequire(import.meta.url)('@imgwhy/report');
 * await import(name);
 * ```
 *
 * A tree holds every form a module can arrive by. Two of those forms carry
 * nothing to check against the allowlist, so they are refused outright instead
 * of read:
 *
 * - `require`, under any name, including `createRequire`. This package is ESM
 *   throughout; the only thing `createRequire` does here is hand a specifier
 *   to a resolver that no static check can follow.
 * - A dynamic `import()` whose specifier is not a literal. `import(name)` has
 *   no name until it runs.
 *
 * What still gets past: a specifier assembled and run through `eval`, or a
 * module pulled in by something that is neither `import` nor `require` — a
 * loader hook, say. No check over source text can answer for those. The
 * manifest test below is the backstop, and only a partial one, because a
 * workspace hoists packages `runner` never declared and Node resolves them
 * anyway.
 */
function reaches(text: string): Reaches {
  const specifiers: string[] = [];
  const refused: string[] = [];

  /** A specifier position: either a literal to check, or a refusal. */
  const readSpecifier = (node: ts.Node | undefined): void => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
    else refused.push(REFUSED_IMPORT);
  };

  const visit = (node: ts.Node): void => {
    // `import …`, `import type …`, `export … from`, `export * from`.
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      readSpecifier(node.moduleSpecifier);
    }
    // `type X = import('…').Y`, which imports a module for its types alone.
    else if (ts.isImportTypeNode(node)) {
      readSpecifier(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument);
    }
    // `import('…')`, whether awaited or not.
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      readSpecifier(node.arguments[0]);
    }
    // `require`, `createRequire`, `module.require` — named anywhere at all,
    // because a name is all it takes to reach a resolver this cannot read.
    else if (ts.isIdentifier(node) && (node.text === 'require' || node.text === 'createRequire')) {
      refused.push(`reaches a module through ${node.text}`);
    }

    ts.forEachChild(node, visit);
  };

  visit(parse(text));
  return { specifiers, refused: [...new Set(refused)] };
}

/** The package a bare specifier belongs to, so a deep import cannot slip past. */
const packageOf = (specifier: string): string =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

/** Every way one module leaves the package, one line each. Empty is clean. */
function leaves(name: string, text: string): string[] {
  const { specifiers, refused } = reaches(text);
  return [
    ...refused.map((why) => `${name} ${why}`),
    ...specifiers
      .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))
      .filter((specifier) => !ALLOWED.has(packageOf(specifier)))
      .map((specifier) => `${name} imports ${specifier}`),
  ];
}

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
