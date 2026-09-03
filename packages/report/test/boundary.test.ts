import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse, read, sources } from '../../../test/source.js';

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
 * `parse` says why a syntax tree and not a regex over the text. A tree holds
 * every form a module can arrive by, and two of those forms carry nothing to
 * check against the allowlist, so they are refused outright instead of read:
 *
 * - `require`, under any name, including `createRequire`. This package is ESM
 *   throughout, and the only thing `createRequire` does here is hand a
 *   specifier to a resolver no static check can follow.
 * - A dynamic `import()` whose specifier is not a literal. `import(name)` has
 *   no name until it runs.
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
      .filter((specifier) => !specifier.startsWith('.'))
      .filter((specifier) => !ALLOWED.has(packageOf(specifier)))
      .map((specifier) => `${name} imports ${specifier}`),
  ];
}

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
