import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REFUSED_IMPORT, leaving, reaches, read, sources } from '../../../test/source.js';

const src = fileURLToPath(new URL('../src', import.meta.url));

/**
 * Every package the extension may name, which is the design's dependency
 * table for it:
 *
 * | `@imgwhy/extension` | Manifest V3 extension. Explain the page you are
 * looking at. | core |
 *
 * One entry, and nothing imports it yet. This slice's panel says very little
 * and needs no arithmetic to say it, so the package declares no dependency at
 * all — an entry in `package.json` that nothing imports is an install for
 * nobody, and the next slice adds it in the same commit as the first `import`.
 * The name is allowed here rather than left out until then because a check
 * that has to be loosened before a legitimate change can land is a check
 * someone will loosen without reading it.
 *
 * Which is also why nothing below asserts that `package.json` declares no
 * dependency today. That is true, and it is true for a reason that expires:
 * the assertion would fail the moment #10 writes its first `import` and the
 * contributor's move would be to delete it. A check whose own argument
 * predicts its removal is not worth writing.
 *
 * An allowlist rather than a list of packages to refuse, for the reason the
 * runner's mirror of this gives: a name that does not exist yet cannot be
 * refused by name. Everything not named is refused, so a dependency cannot
 * arrive by being forgotten.
 */
const ALLOWED = new Set(['@imgwhy/core']);

/**
 * Every way one module leaves this package, one line each. Empty is clean.
 *
 * `node:` is not exempt, as it is not in the report's mirror of this check and
 * is in the runner's. The runner opens browsers and reads files. This package
 * is a service worker and a function that runs in a page, and neither of those
 * has a filesystem — a `node:` import here would mean it had started being
 * something else, and would fail at load in Chrome besides.
 */
const leaves = leaving(ALLOWED, false);

/**
 * What the extension may reach for.
 *
 * The mirror of the runner's and the report's boundary checks, carrying more
 * weight here than in either: `dormant.test.ts` and `privacy.test.ts` read
 * this package's own modules, and a module pulled in from somewhere else is
 * one neither of them reads. That is how a listener or a request arrives
 * without appearing in any file they look at, which is why the routes that
 * carry no specifier — `require`, a computed `import()` — are refused
 * outright rather than checked against the list.
 */
describe('the extension package boundary', () => {
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
});

/**
 * The check, read against an extension that reaches somewhere it should not.
 *
 * Held here rather than tried on a branch and reverted, so the failure each
 * route should cause is a passing test instead of a note in a commit message.
 */
describe('the extension boundary check, given a module that leaves', () => {
  const attacks: [string, string[], string[]][] = [
    [
      'a browser driver, which is the runner\'s job and needs a machine',
      ["import { chromium } from 'playwright';", 'export const open = () => chromium.launch();'],
      ['leaving.ts imports playwright'],
    ],
    [
      'a Node built-in, which a service worker does not have',
      ["import { readFileSync } from 'node:fs';", 'export const read = () => readFileSync("x");'],
      ['leaving.ts imports node:fs'],
    ],
    [
      'a deep import, which names no package until the path is cut off it',
      ["export { formatCapture } from 'imgwhy/dist/trace.js';"],
      ['leaving.ts imports imgwhy/dist/trace.js'],
    ],
    [
      'a dynamic import of a specifier it computes',
      ["const name = ['@imgwhy', 'core'].join('/');", 'export const core = await import(name);'],
      [`leaving.ts ${REFUSED_IMPORT}`],
    ],
    [
      'a require, which reaches a resolver no static check can follow',
      ["export const core = require('@imgwhy/core');"],
      ['leaving.ts reaches a module through require'],
    ],
    [
      'core itself, which is the one name the list allows',
      ["export { selectCandidate } from '@imgwhy/core';"],
      [],
    ],
  ];

  it.each(attacks)('catches %s', (_route, source, expected) => {
    expect(leaves('leaving.ts', source.join('\n'))).toEqual(expected);
  });

  it('reads no import out of a comment, which a regex over the text cannot help', () => {
    const commented = [
      "/** Never `import { chromium } from 'playwright'`, which needs a machine. */",
      "// A path out would read `from '../../report/src/index.js'`.",
      'export const plain = true;',
    ].join('\n');

    expect(leaves('commented.ts', commented)).toEqual([]);
  });
});
