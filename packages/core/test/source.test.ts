/**
 * Core as a report ships it: the text of the functions themselves.
 *
 * The import above names the package rather than `../src`, which every other
 * test here imports, and that is the point of this file. What it checks is
 * source text, and a transform of a module rewrites a call to another module's
 * function into a call through an import object — so a test reading a
 * transformed copy would be checking a document nobody is served. The command
 * ships the built package. `vitest.config.ts` is what keeps this import from
 * being rewritten, and `no-globals.test.ts` reads the build for the same
 * reason.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { CapturedImage, DeviceProfile } from '@imgwhy/core';
import { coreSource, explainSelection, parseSrcset } from '@imgwhy/core';

const src = fileURLToPath(new URL('../src', import.meta.url));

/**
 * The four functions a front end calls, read out of a context that ran nothing
 * but `coreSource()`.
 *
 * A bare context, the way `no-globals.test.ts` uses one: the source a report
 * ships runs in a page, and a page is not this process. Anything the shipped
 * copy reached for through a global here — `require`, `process`, a helper this
 * module happens to hold — would be missing in the page too, so it has to be
 * missing here.
 *
 * The declarations are read back through a trailing expression rather than off
 * the context's global object, because `const` at the top of a script goes to
 * the context's lexical scope and never becomes a property of its global.
 */
function inBareContext(source: string): Record<string, unknown> {
  const context = vm.createContext(Object.create(null));
  const read = '\n;({ parseSrcset, resolveSizes, selectCandidate, explainSelection })';
  return vm.runInContext(source + read, context) as Record<string, unknown>;
}

/** One image, as a Capture holds it, around a `srcset` and a `sizes`. */
const imageOf = (srcset: string, sizes: string | null, renderedWidth: number): CapturedImage => ({
  id: 'main > img',
  selector: 'main > img',
  candidates: parseSrcset(srcset),
  sizes,
  sizesSource: 'img',
  renderedWidth,
  currentSrc: '',
  naturalWidth: 0,
  transferBytes: null,
  loading: null,
});

const deviceOf = (width: number, dpr: number): DeviceProfile => ({
  id: 'typed',
  name: 'typed',
  viewport: { width, height: 800 },
  dpr,
});

const WIDTHS = '/i/640.png 640w, /i/1080.png 1080w, /i/1920.png 1920w';
const DENSITIES = '/i/200.png 1x, /i/300.png 2x';

/**
 * Every branch of the algorithm, so a helper that only one path reaches cannot
 * be left out of the shipped copy without something failing here.
 *
 * `calc()` reaches `splitTop`'s parenthesis counting, the media clauses reach
 * `evalCond`, `em` reaches `toPx`'s other unit, `auto` reaches the rendered
 * width, and the unreadable clause reaches the error branch.
 */
const CASES: [string, CapturedImage, DeviceProfile][] = [
  ['a width descriptor at DPR 2', imageOf(WIDTHS, '100vw', 375), deviceOf(375, 2)],
  ['the 640 at DPR 1.5 case', imageOf(WIDTHS, '100vw', 640), deviceOf(640, 1.5)],
  [
    'a media clause that matches',
    imageOf(WIDTHS, '(min-width: 1000px) 50vw, 100vw', 720),
    deviceOf(1440, 1),
  ],
  [
    'a media clause that does not',
    imageOf(WIDTHS, '(min-width: 1000px) 50vw, 100vw', 375),
    deviceOf(375, 2),
  ],
  ['a calc() length', imageOf(WIDTHS, 'calc(100vw - 2rem)', 1408), deviceOf(1440, 2)],
  ['an em length', imageOf(WIDTHS, '(max-width: 40em) 30em, 100vw', 480), deviceOf(600, 2)],
  ['auto, which layout decides', imageOf(WIDTHS, 'auto', 412), deviceOf(412, 2.625)],
  ['a clause with no length to read', imageOf(WIDTHS, 'wide', 375), deviceOf(375, 2)],
  ['an absent sizes', imageOf(WIDTHS, null, 375), deviceOf(375, 3)],
  ['density descriptors, which read past sizes', imageOf(DENSITIES, '100vw', 200), deviceOf(820, 2)],
  ['a ratio past every density', imageOf(DENSITIES, null, 200), deviceOf(393, 3)],
  ['nothing to select at all', imageOf('', null, 120), deviceOf(1440, 1)],
];

/** Every function one core module declares at its top level, by name. */
function declaredIn(text: string): string[] {
  const file = ts.createSourceFile('module.ts', text, ts.ScriptTarget.ESNext, true);
  const names: string[] = [];
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.push(statement.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        const isFunction =
          initializer !== undefined &&
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
        if (isFunction && ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    }
  }
  return names;
}

/**
 * Every function core is made of, by name.
 *
 * `source.ts` is left out, and it is the only thing that is: it assembles the
 * shipped copy rather than being part of one. A page has nothing to do with a
 * function that hands out source, and shipping it would put a `PARTS` list in
 * a page with no modules for it to name.
 */
const declaredInCore = (): string[] =>
  readdirSync(src)
    .filter((name) => name.endsWith('.ts') && name !== 'source.ts')
    .flatMap((name) => declaredIn(readFileSync(resolve(src, name), 'utf8')));

/** Every name the shipped source declares. */
const declaredBy = (source: string): string[] =>
  [...source.matchAll(/^const ([A-Za-z_$][\w$]*) = /gm)].map((found) => found[1]);

describe('core, shipped as source', () => {
  const source = coreSource();

  it('declares every function core is made of, so no helper is left behind', () => {
    // A helper reached only through one branch would otherwise go missing, and
    // the branch that needed it would throw in the page rather than here.
    expect(declaredBy(source).sort()).toEqual(declaredInCore().sort());
  });

  it('runs in a context with no globals at all, the way it runs in a page', () => {
    expect(Object.keys(inBareContext(source)).sort()).toEqual([
      'explainSelection',
      'parseSrcset',
      'resolveSizes',
      'selectCandidate',
    ]);
  });

  it.each(CASES)('answers %s exactly as the command does', (_case, image, device) => {
    const shipped = inBareContext(source).explainSelection as typeof explainSelection;

    expect(shipped(image, device)).toEqual(explainSelection(image, device));
  });

  it('is the source of the functions themselves, so it cannot be a copy that drifted', () => {
    expect(source).toContain(String(explainSelection));
    expect(source).toContain(String(parseSrcset));
  });
});

/**
 * The check, read against a shipped copy with a piece missing.
 *
 * Held here rather than tried on a branch and reverted, so the failure a
 * forgotten helper should cause is a passing test instead of a note in a
 * commit message.
 */
describe('the shipped source, given a helper left out of it', () => {
  it('throws in the bare context rather than answering wrongly', () => {
    const withoutToPx = coreSource()
      .split('\n')
      .filter((line) => !line.startsWith('const toPx = '))
      .join('\n');

    const shipped = inBareContext(withoutToPx).resolveSizes as (
      sizes: string,
      width: number,
    ) => unknown;

    expect(() => shipped('50vw', 1440)).toThrow(/toPx is not defined/);
  });

  it('sees a name the shipped source does not declare', () => {
    expect(declaredBy('const toPx = (n) => n;\nconst splitTop = (s) => [s];')).toEqual([
      'toPx',
      'splitTop',
    ]);
  });
});
