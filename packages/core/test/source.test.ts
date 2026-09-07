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
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { CapturedImage, DeviceProfile } from '@imgwhy/core';
import { coreSource, explainSelection, parseSrcset } from '@imgwhy/core';
import { parse, read, sources } from '../../../test/source.js';

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
  const trailing = '\n;({ parseSrcset, resolveSizes, selectCandidate, explainSelection })';
  return vm.runInContext(source + trailing, context) as Record<string, unknown>;
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
  declaresWidth: false,
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
 *
 * ## This table is load-bearing. Do not trim it.
 *
 * It looks like coverage of the algorithm, and the algorithm is covered
 * already — `explain.test.ts`, `sizes.test.ts` and `select.test.ts` each ask
 * these questions of the imported functions. What runs here is the *shipped*
 * copy, in a context with no globals, and that is a different question: it
 * asks whether every branch of the shipped copy can still run when its module
 * is gone from around it.
 *
 * The completeness check below reads names out of core's own top level. So it
 * answers for a name core declares and forgot to ship, and it cannot answer
 * for a name core never declared — a global that Node has and a page does not,
 * reached from inside one function. Nothing sees that until the branch holding
 * it runs somewhere with no globals, which is here, and only for the branches
 * in this table.
 *
 * A case dropped from it is a branch that could start reaching for `process`
 * or `require` without anything failing until a reader opened the report. Add
 * one when you add a branch; take none away.
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

/**
 * The two names a core module declares that do not ship.
 *
 * `PARTS` is the list itself: `source.ts` reads every module's to build the
 * string, so the list is how the shipping happens rather than a thing that is
 * shipped. A page handed one would hold an array naming modules it does not
 * have.
 *
 * `CAPTURE_SCHEMA` is the shape number of a file on disk. What ships is the
 * selection algorithm, and a report ships it to re-run the arithmetic over a
 * Capture some reader has already accepted — so nothing shipped has a version
 * to check, and `packages/cli/src/in.ts` is where the number is read.
 *
 * Both are exempted by name, which is a hole in the completeness check above
 * and the reason for the two checks that stand beside it: a shipped function
 * reaching for either would be a `ReferenceError` in a page, so the shipped
 * string is read for both names rather than only for what it declares, and
 * every core module's imports are read for either arriving under an alias —
 * which the string would carry as the alias and the comparison cannot see at
 * all, because an import binds a name without declaring one.
 */
const NOT_SHIPPED = new Set(['PARTS', 'CAPTURE_SCHEMA']);

/**
 * Every value one core module binds at its top level, by name.
 *
 * Every binding, not every function, and that is the point of it. The earlier
 * shape of this read function declarations and a `const` holding an arrow or a
 * function expression, which let two things through — `const memo = wrap(() =>
 * …)`, whose initializer is a call, and `const ROOT_FONT_PX = 16`, which is
 * not callable at all. Both are names a shipped function can reach for and a
 * page would not have.
 *
 * So the question asked is "what does this module's top level bind", and the
 * answer is checked against what ships — save for the two names `NOT_SHIPPED`
 * holds, which are filtered out here. A constant up there is allowed on one
 * condition, then: it cannot go into a `readonly Part[]`, so nothing ships it,
 * so no shipped function may read it. That condition is what the two checks
 * beside the comparison enforce — the shipped string is read for both exempted
 * names, and every core module's imports are read for either under any alias.
 *
 * The walk descends through blocks and control flow, because `var` and a
 * function declaration inside one are still module scope, and stops at every
 * function and class — a helper declared inside a function comes over with it
 * and has no business in a list.
 */
function declaredIn(text: string): string[] {
  const names: string[] = [];

  const bind = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.push(name.text);
    else for (const element of name.elements) if (ts.isBindingElement(element)) bind(element.name);
  };

  const walk = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
      if (node.name) names.push(node.name.text);
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) bind(declaration.name);
      return;
    }
    // Anything that is not a function or a class may still hold one of the
    // two above at module scope: a `var` in an `if`, a hoisted declaration in
    // a block. Statements only — an expression cannot bind a module name.
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    ts.forEachChild(node, (child) => {
      if (ts.isStatement(child) || ts.isSourceFile(child)) walk(child);
    });
  };

  walk(parse(text));
  return names.filter((name) => !NOT_SHIPPED.has(name));
}

/**
 * Every core module the two readings below are run over.
 *
 * `sources` recurses, so a helper written into `src/<subdir>/` is read too. A
 * flat listing was what this had before, and it would have let a whole
 * directory of unshipped helpers past the check.
 *
 * `source.ts` is left out, and it is the only file that is: it assembles the
 * shipped copy rather than being part of one. A page has nothing to do with a
 * function that hands out source, and shipping it would put a `PARTS` list in
 * a page with no modules for it to name. The import reading needs the same
 * exemption for the same reason — `source.ts` imports every module's `PARTS`,
 * aliased, because collecting them is what it is for.
 */
const coreModules = (): string[] =>
  sources(src).filter((file) => basename(file) !== 'source.ts');

/** Every name core binds at the top level of a module, by name. */
const declaredInCore = (): string[] =>
  coreModules().flatMap((file) => declaredIn(read(file)));

/**
 * Every import of a name that does not ship, one line per specifier.
 *
 * The imported name and the local one are both read, because either resolving
 * to nothing in a page is the same failure: `import { CAPTURE_SCHEMA as SHAPE }`
 * puts `SHAPE` into a shipped function, and `import { schema as PARTS }` would
 * put a name the shipped string does declare over one it means something else
 * by.
 *
 * No exception for `import type`. Such an import erases rather than throwing,
 * so it is the one shape of this that a page would survive — but neither
 * exempted name is a type, and a core module naming either in an import is a
 * mistake whichever keyword it was written with.
 */
function importsNotShipped(text: string): string[] {
  const found: string[] = [];

  const check = (imported: string, local: string): void => {
    if (!NOT_SHIPPED.has(imported) && !NOT_SHIPPED.has(local)) return;
    found.push(imported === local ? imported : `${imported} as ${local}`);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause;
      // `import CAPTURE_SCHEMA from …`, which binds a default under a name.
      if (clause.name) check(clause.name.text, clause.name.text);
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          // `import * as PARTS from …`, one binding and no imported name.
          check(clause.namedBindings.name.text, clause.namedBindings.name.text);
        } else {
          for (const element of clause.namedBindings.elements) {
            check((element.propertyName ?? element.name).text, element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(parse(text));
  return found;
}

/** Every such import core holds, named by the module that wrote it. */
const importsNotShippedInCore = (): string[] =>
  coreModules().flatMap((file) =>
    importsNotShipped(read(file)).map((line) => `${basename(file)} imports ${line}`),
  );

/** Every name the shipped source declares. */
const declaredBy = (source: string): string[] =>
  [...source.matchAll(/^const ([A-Za-z_$][\w$]*) = /gm)].map((found) => found[1]);

describe('core, shipped as source', () => {
  const source = coreSource();

  it('declares every name core binds at a module top level, so nothing is left behind', () => {
    // A helper reached only through one branch would otherwise go missing, and
    // the branch that needed it would throw in the page rather than here.
    expect(declaredBy(source).sort()).toEqual(declaredInCore().sort());
  });

  it('names neither unshipped binding, so no shipped function reaches for one', () => {
    // The check above compares what the string declares against what core
    // binds, and both of these are filtered out of that comparison. A mention
    // is the failure it cannot see: the name would resolve to nothing in a
    // page, and the function holding it would throw where a reader opened the
    // report.
    for (const name of NOT_SHIPPED) expect(source).not.toContain(name);
  });

  it('imports neither unshipped binding, under its own name or any alias', () => {
    // The check above reads the shipped string for both names, which catches a
    // use inside the module that declares one — no import would show that. What
    // it cannot catch is an alias: `import { CAPTURE_SCHEMA as SHAPE }` puts
    // `SHAPE` in the shipped text and leaves the exempted name out of it, and
    // the completeness check sees no import binding at all. So the imports are
    // read too, and either name arriving under any local name is a finding.
    expect(importsNotShippedInCore()).toEqual([]);
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

/**
 * The import reading, given a module that reaches an exempted name under
 * another one.
 *
 * Held here for the reason the control above is: the failure an alias should
 * cause is a passing test rather than a note in a commit message.
 *
 * An alias is the one shape neither other check can see. `declaredIn` reads
 * bindings a module declares and an import binds without declaring, and the
 * shipped string carries the local name rather than the imported one — so
 * `expect(source).not.toContain('CAPTURE_SCHEMA')` passes while a shipped
 * function reaches for `SHAPE`, which a page does not have either.
 */
describe('a core module, given an exempted name imported under another', () => {
  it('reports an alias, which neither other check can see', () => {
    expect(importsNotShipped("import { CAPTURE_SCHEMA as SHAPE } from './types.js';")).toEqual([
      'CAPTURE_SCHEMA as SHAPE',
    ]);
  });

  it('reports one imported under its own name', () => {
    expect(importsNotShipped("import { PARTS } from './srcset.js';")).toEqual(['PARTS']);
  });

  it('reports a type-only import too, because neither name belongs in one', () => {
    expect(importsNotShipped("import type { CAPTURE_SCHEMA } from './types.js';")).toEqual([
      'CAPTURE_SCHEMA',
    ]);
  });

  it('passes over an import no exemption names', () => {
    expect(importsNotShipped("import { selectCandidate } from './select.js';")).toEqual([]);
  });
});

/**
 * The reading of a module's top level, against the shapes a helper arrives in.
 *
 * Every source below binds a name a shipped function could reach for, and the
 * first three are the ones the earlier reading missed: it looked for a
 * function declaration or a `const` holding an arrow, so a `const` holding a
 * call, a value that is not callable, and a `var` inside a block all passed
 * the completeness check and would have thrown in a reader's browser.
 *
 * The rest are the boundary on the other side: what a helper *inside* a
 * function is, which is part of that function's own text and no business of a
 * list, and the two exempted names — `PARTS`, which is how the shipping
 * happens rather than a thing that ships, and `CAPTURE_SCHEMA`, which no
 * shipped function reads.
 */
describe('what a core module binds at its top level', () => {
  const cases: [string, string, string[]][] = [
    ['a const holding a call', 'const memo = wrap(() => 1);', ['memo']],
    ['a const holding no function at all', 'const ROOT_FONT_PX = 16;', ['ROOT_FONT_PX']],
    ['a var inside a block, which is module scope anyway', '{ var cache = new Map(); }', ['cache']],
    ['a let and a class', 'let seen = 0;\nclass Reader {}', ['seen', 'Reader']],
    ['a name out of a destructuring', 'const { floor, ceil } = Math;', ['floor', 'ceil']],
    ['a function declaration, as before', 'function splitTop(s) {\n  return [s];\n}', ['splitTop']],
    ['an arrow in a const, as before', 'const toPx = (n) => n;', ['toPx']],
    [
      'a helper inside a function, which travels with it',
      'function a() {\n  const b = 1;\n  return b;\n}',
      ['a'],
    ],
    [
      'a helper inside an arrow, for the same reason',
      'const a = () => {\n  const b = 1;\n  return b;\n};',
      ['a'],
    ],
    [
      'PARTS, which is the list rather than a part',
      'const f = () => 1;\nexport const PARTS = [f];',
      ['f'],
    ],
    [
      'CAPTURE_SCHEMA, the other name no page is handed',
      'const f = () => 1;\nexport const CAPTURE_SCHEMA = 1;',
      ['f'],
    ],
    ['a type, which binds no value', 'type Length = { px: number };', []],
  ];

  it.each(cases)('reads %s', (_shape, source, expected) => {
    expect(declaredIn(source)).toEqual(expected);
  });
});
