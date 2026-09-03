import { posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse, read, sources } from './source.js';

const src = fileURLToPath(new URL('../src', import.meta.url));

/** A package as this check reads it: module name → the source it holds. */
type Modules = Record<string, string>;

/**
 * Every measurement of an image that is not a byte count, under the names this
 * project calls them by.
 *
 * This is a vocabulary, not a proof, and it is worth being plain about which.
 * `naturalWidth`, `renderedWidth`, `viewport` and `dpr` are `CapturedImage` and
 * `DeviceProfile` fields, so they are the names a dimension actually travels
 * under here. `width` and `height` are on the list because that is how a
 * viewport states its own dimensions — `viewport.width` — and `px` because
 * that is what a resolved CSS length is called throughout the trace.
 *
 * A dimension under some other name gets past this list. That is why it is not
 * the only rule: `takesANumber` below does not read names at all, and a guess
 * has to be handed a dimension whatever the parameter is called.
 */
const DIMENSIONS = [
  'naturalWidth',
  'renderedWidth',
  'deviceScaleFactor',
  'viewport',
  'width',
  'height',
  'dpr',
  'px',
];

/** Whether `kind` is any of TypeScript's assignment operators, `=` included. */
const assigns = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;

/** Whether this expression writes to a member of that name. */
const writesTo = (node: ts.Expression, name: string): boolean =>
  (ts.isPropertyAccessExpression(node) && node.name.text === name) ||
  (ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === name);

/**
 * Every expression a property of this name is given, as written.
 *
 * Three forms give one, and reading only the first of them was how a guess got
 * past this file once already:
 *
 * ```ts
 * { transferBytes: estimate(image) }   // a property assignment
 * { transferBytes }                    // shorthand, from a local of that name
 * image.transferBytes = estimate(image);   // and every compound assignment
 * ```
 *
 * A fourth form carries the field without naming it — `{ ...image }` — and no
 * scan of the text can read what a spread holds. It needs none: a spread
 * copies a figure that some other place in the package already gave, and every
 * such place is one of the three forms above, in a module this scan opens.
 * What it cannot see is a spread of an object assembled outside the package.
 */
function given(name: string, text: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText() === name) {
      found.push(node.initializer.getText());
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === name) {
      found.push(node.name.text);
    } else if (
      ts.isBinaryExpression(node) &&
      assigns(node.operatorToken.kind) &&
      writesTo(node.left, name)
    ) {
      found.push(node.right.getText());
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return found;
}

/** Every place in the package that gives `transferBytes` a value. */
const sourcesOf = (modules: Modules): string[] =>
  Object.entries(modules).flatMap(([name, text]) =>
    given('transferBytes', text).map((expression) => `${name}: ${expression}`),
  );

/** Every name one module writes, whether declared, read or reached through. */
function names(text: string): Set<string> {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) found.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return found;
}

/**
 * Every parameter this module declares that takes a number in.
 *
 * This is the rule that does not depend on knowing what a dimension is called.
 * An estimate has to be handed the thing it scales, and the thing it scales is
 * a number, so a module that only ever hands on a size the protocol reported
 * needs no number from a caller at all.
 *
 * It reads the annotation rather than an inferred type, so a parameter left
 * untyped or widened to `unknown` gets past.
 */
function takesANumber(text: string): string[] {
  const numeric = (node: ts.Node): boolean =>
    node.kind === ts.SyntaxKind.NumberKeyword || ts.forEachChild(node, numeric) === true;
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && node.type && numeric(node.type)) found.push(node.getText());
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return found;
}

/** Every relative specifier one module names, in the order it names them. */
function relativeImports(text: string): string[] {
  const found: string[] = [];
  const keep = (node: ts.Node | undefined): void => {
    if (node && ts.isStringLiteralLike(node) && node.text.startsWith('.')) found.push(node.text);
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      keep(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      keep(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      keep(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return found;
}

/** The module a relative specifier names, as this package's own key for it. */
function keyFor(modules: Modules, from: string, specifier: string): string | null {
  const path = posix.normalize(posix.join(posix.dirname(from), specifier));
  for (const candidate of [path.replace(/\.js$/, '.ts'), `${path}.ts`, `${path}/index.ts`]) {
    if (candidate in modules) return candidate;
  }
  return null;
}

/**
 * Every module the figure passes through: the one that produces it, and every
 * module that one reaches, transitively.
 *
 * The scope is the whole point. A check that reads the producing module alone
 * passes a package that moved the arithmetic one file sideways and called it
 * through a fallback, which is exactly how a guess got past this file once.
 *
 * `unreadable` holds every relative specifier that names no module this can
 * open. It is a hole, so a run that finds one fails rather than shrugging.
 */
function producing(modules: Modules, entry: string): { files: string[]; unreadable: string[] } {
  const files: string[] = [];
  const unreadable: string[] = [];
  const queue = [entry];

  while (queue.length) {
    const name = queue.shift();
    if (name === undefined || files.includes(name)) continue;
    const text = modules[name];
    if (text === undefined) {
      unreadable.push(name);
      continue;
    }
    files.push(name);
    for (const specifier of relativeImports(text)) {
      const reached = keyFor(modules, name, specifier);
      if (reached === null) unreadable.push(`${name} imports ${specifier}`);
      else queue.push(reached);
    }
  }

  return { files, unreadable };
}

/**
 * Every way the figure's own modules could be scaling something, one line
 * each. Empty is clean.
 */
function guessable(modules: Modules, entry: string): string[] {
  const { files } = producing(modules, entry);
  return files.flatMap((name) => {
    const text = modules[name] ?? '';
    const named = names(text);
    return [
      ...DIMENSIONS.filter((dimension) => named.has(dimension)).map(
        (dimension) => `${name} names ${dimension}`,
      ),
      ...takesANumber(text).map((parameter) => `${name} takes ${parameter} in from a caller`),
    ];
  });
}

/**
 * The design's non-goal, as a check rather than an inspection:
 *
 * > **Estimated bytes.** Where `transferBytes` is null, report it as unknown.
 * > Do not guess from pixel dimensions.
 *
 * A guess would read exactly like a measurement, which is why this is checked
 * in the source and not only in a result: a result can only ever show that
 * today's code guesses nothing.
 *
 * This half guards where the figure is measured. `transferBytes` takes its
 * value in one place, that place calls into one module, and that module —
 * with every module it reaches — names no pixel dimension and is handed no
 * number to scale. The other half guards where the figure is printed, in
 * `packages/cli/test/no-estimate.test.ts`, because a runner test cannot see
 * the CLI and the column a reader actually looks at is written there.
 */
describe('the transfer size, checked against estimation', () => {
  /** The package as the check reads it, keyed the way it imports itself. */
  const modules: Modules = Object.fromEntries(
    sources(src).map((file) => [relative(src, file).split(/[\\/]/).join('/'), read(file)]),
  );
  const entry = 'transfers.ts';

  it('has modules to check, so nothing below passes for want of a file', () => {
    expect(Object.keys(modules)).toContain(entry);
  });

  it('gives transferBytes one source across the package, the recorded transfer', () => {
    expect(sourcesOf(modules)).toEqual(['capture.ts: transfers.bytesFor(image.currentSrc)']);
  });

  it('produces the figure in modules this can open and read, all of them', () => {
    const { files, unreadable } = producing(modules, entry);

    expect(unreadable).toEqual([]);
    expect(files).toContain(entry);
    // The check reads the module it meant to read, rather than passing on a
    // renamed file it never opened.
    expect(names(modules[entry] ?? '').has('encodedDataLength')).toBe(true);
  });

  it('names no pixel dimension and takes no number in, where the figure is made', () => {
    expect(guessable(modules, entry)).toEqual([]);
  });
});

/**
 * The check, read against a package written to defeat it.
 *
 * The first case is the one that passed while this file read `transfers.ts`
 * and nothing else: the arithmetic moved one module sideways and was reached
 * through a fallback, so the producing module named no dimension and scaled
 * nothing, and all of it was still an estimate from pixels. The rest are the
 * forms a value can reach `transferBytes` by that a scan for a property
 * assignment does not see.
 *
 * They are held here rather than tried on a branch and reverted, so the
 * failure they should cause is a passing test instead of a note in a commit
 * message.
 *
 * ## What still gets past
 *
 * - **A spread of an object assembled outside this package.** `{ ...image }`
 *   carries a figure without naming it. Every in-package place that gives one
 *   is read, so a spread only ever copies a figure already accounted for; an
 *   object built somewhere else is not.
 * - **A dimension under a name `DIMENSIONS` does not hold, handed in as
 *   something other than a number** — inside an object, or through a parameter
 *   left untyped. Each rule alone has a hole here; together they are narrow.
 * - **A module reached by anything but a static relative import.** A computed
 *   `import()` names no module until it runs. `boundary.test.ts` refuses those
 *   outright for the whole package, which is the backstop.
 * - **What the CLI does with the figure afterwards.** That is the other half's
 *   to answer.
 */
describe('the estimation check, given a package that guesses anyway', () => {
  const RECORDED = 'transfers.bytesFor(image.currentSrc)';

  /** The shipped arrangement, with one module's source swapped in. */
  const packaged = (overrides: Modules): Modules => ({
    'capture.ts': `import { recordTransfers } from './transfers.js';
      export const image = { transferBytes: ${RECORDED} };`,
    'transfers.ts': `export const recordTransfers = (session: CDPSession) => ({
        bytesFor: (url: string) => bytesByUrl.get(url) ?? null,
      });
      const finished = ({ encodedDataLength }) => encodedDataLength;`,
    ...overrides,
  });

  it('catches an estimate in a second module, reached through a fallback', () => {
    const modules = packaged({
      'guess.ts': 'export const guessFrom = (px: number): number => Math.round(px * px * 0.25);',
      'transfers.ts': `import { guessFrom } from './guess.js';
        export const recordTransfers = (session: CDPSession) => ({
          bytesFor: (url: string) => bytesByUrl.get(url) ?? guessFrom(url.length),
        });`,
    });

    // Nothing about `capture.ts` changed, so the one-source rule is quiet.
    expect(sourcesOf(modules)).toEqual([`capture.ts: ${RECORDED}`]);
    // The module that produces the figure now reaches one that guesses.
    expect(producing(modules, 'transfers.ts').files).toEqual(['transfers.ts', 'guess.ts']);
    expect(guessable(modules, 'transfers.ts')).toEqual([
      'guess.ts names px',
      'guess.ts takes px: number in from a caller',
    ]);
  });

  it('catches an assignment to the field, which no property assignment names', () => {
    const modules = packaged({
      'capture.ts': `import { recordTransfers } from './transfers.js';
        export const fill = (image) => { image.transferBytes = estimate(image.naturalWidth); };`,
    });

    expect(sourcesOf(modules)).toEqual(['capture.ts: estimate(image.naturalWidth)']);
  });

  it('catches a compound assignment, which fills the field only when it is null', () => {
    const modules = packaged({
      'capture.ts': `export const fill = (image) => {
        image['transferBytes'] ??= estimate(image);
      };`,
    });

    expect(sourcesOf(modules)).toEqual(['capture.ts: estimate(image)']);
  });

  it('catches shorthand, which names the field and no expression at all', () => {
    const modules = packaged({
      'capture.ts': `export const toImage = (image) => {
        const transferBytes = estimate(image.naturalWidth);
        return { id: image.id, transferBytes };
      };`,
    });

    expect(sourcesOf(modules)).toEqual(['capture.ts: transferBytes']);
  });

  it('catches a guess that scales with nothing but +, which no operator list held', () => {
    const modules = packaged({
      'transfers.ts': `export const recordTransfers = (session: CDPSession) => ({
        bytesFor: (url: string) => bytesByUrl.get(url) ?? Math.round(naturalWidth + naturalWidth),
      });`,
    });

    expect(guessable(modules, 'transfers.ts')).toEqual(['transfers.ts names naturalWidth']);
  });

  it('refuses a module it cannot open, rather than reading none and passing', () => {
    const modules = packaged({
      'transfers.ts': `import { guessFrom } from './elsewhere/guess.js';
        export const recordTransfers = () => ({ bytesFor: () => guessFrom(1) });`,
    });

    expect(producing(modules, 'transfers.ts').unreadable).toEqual([
      'transfers.ts imports ./elsewhere/guess.js',
    ]);
  });

  it('reads nothing out of a comment, which a regex over the text cannot help', () => {
    const modules = packaged({
      'transfers.ts': `/** Never \`transferBytes: naturalWidth * 0.25\`, and never a \`dpr\`. */
        export const recordTransfers = () => ({ bytesFor: () => null });`,
    });

    expect(sourcesOf(modules)).toEqual([`capture.ts: ${RECORDED}`]);
    expect(guessable(modules, 'transfers.ts')).toEqual([]);
  });
});
