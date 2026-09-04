import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

/**
 * Reading this repo's own source, for the tests that check a property of the
 * code rather than of a result.
 *
 * Two kinds of those exist: the `boundary.test.ts` pair, which checks what the
 * runner and the report packages may reach for, and the `no-estimate.test.ts`
 * pair, which checks that no code path turns a pixel dimension into a byte
 * count. All of them need the reading below, and had it written out twice
 * before this file held it once.
 *
 * It sits at the root rather than inside a package because its readers are in
 * three of them, and one of those is the report — whose whole boundary claim
 * is that it never reaches the runner. A check on that property has no
 * business importing from the runner's own test directory to make it.
 *
 * What is deliberately not here is either package's allowlist, or either
 * package's attack table. Those are the parts that should differ: an allowlist
 * is the design's dependency table for one package, and a table of ways out is
 * a list of the ways out of that package in particular. The reading is the
 * same for both; what counts as leaving is not.
 */

/**
 * Every TypeScript file under `dir`, so a file added later is covered by
 * default — whichever of the three extensions it is written with.
 */
export function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.[cm]?ts$/.test(entry.name) ? [path] : [];
  });
}

/** One module's text, whole. */
export const read = (file: string): string => readFileSync(file, 'utf8');

/**
 * One module's syntax tree.
 *
 * A parser rather than a regex over the source text, for two reasons a regex
 * cannot be fixed to cover. A tree holds no comments, so a name or a specifier
 * written inside a doc comment is not a finding in a repo that comments this
 * much. And it holds every form a thing can be written in, rather than the
 * forms whoever wrote the pattern happened to think of.
 */
export const parse = (text: string): ts.SourceFile =>
  ts.createSourceFile('module.ts', text, ts.ScriptTarget.ESNext, true);

/** What one module reaches for, split by whether the reach can be checked. */
export type Reaches = {
  /** The specifiers it names, in the order they are written. */
  specifiers: string[];
  /** The routes out that carry no specifier to check, one line each. */
  refused: string[];
};

export const REFUSED_IMPORT = 'reaches a module through an import() it computes at run time';

/**
 * Read what a module reaches for out of TypeScript's own syntax tree.
 *
 * `parse` says why a syntax tree and not a regex over the text. Both of these
 * left a package while a regex was doing the reading:
 *
 * ```ts
 * createRequire(import.meta.url)('@imgwhy/report');
 * await import(name);
 * ```
 *
 * A tree holds every form a module can arrive by. Two of those forms carry
 * nothing to check against an allowlist, so they are refused outright instead
 * of read:
 *
 * - `require`, under any name, including `createRequire`. Every package here is
 *   ESM throughout; the only thing `createRequire` does is hand a specifier to
 *   a resolver that no static check can follow.
 * - A dynamic `import()` whose specifier is not a literal. `import(name)` has
 *   no name until it runs.
 *
 * What still gets past: a specifier assembled and run through `eval`, or a
 * module pulled in by something that is neither `import` nor `require` — a
 * loader hook, say. No check over source text can answer for those. Each
 * package's manifest test is the backstop, and only a partial one, because a
 * workspace hoists packages a package never declared and Node resolves them
 * anyway.
 */
export function reaches(text: string): Reaches {
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
export const packageOf = (specifier: string): string =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

/**
 * The `leaves` check for one package: every way one of its modules leaves it,
 * one line each. Empty is clean.
 *
 * Two things separate one package's check from another's, and both are
 * arguments rather than editions of this function. `allowed` is the design's
 * dependency table for the package. `exemptNode` is whether a Node built-in
 * counts as leaving: the runner opens browsers and reads files, so it may name
 * one, while the report takes a Capture and returns a string, so a `node:`
 * import there would mean it had started doing something else.
 */
export const leaving =
  (allowed: Set<string>, exemptNode: boolean) =>
  (name: string, text: string): string[] => {
    const { specifiers, refused } = reaches(text);
    return [
      ...refused.map((why) => `${name} ${why}`),
      ...specifiers
        .filter((specifier) => !specifier.startsWith('.'))
        .filter((specifier) => !(exemptNode && specifier.startsWith('node:')))
        .filter((specifier) => !allowed.has(packageOf(specifier)))
        .map((specifier) => `${name} imports ${specifier}`),
    ];
  };

/**
 * The text of every function bound to `name`, at any depth in a module.
 *
 * A tree rather than a pattern over the text, for the reason `parse` gives and
 * one more that belongs to this reading in particular. A pattern that stops
 * matching returns nothing, and nothing equals nothing — so a check comparing
 * two copies of a function would pass, loudest of all, on the day somebody
 * reformatted both of them out of its reach. A tree finds the declaration
 * however it is written, and a caller that refuses anything but one match
 * turns a missed read into a failure rather than a silent agreement.
 *
 * Every depth, because the functions this exists for are declared inside the
 * one that a browser is handed: `chrome.scripting.executeScript` and
 * `page.evaluate` both send `String(func)`, so a helper has to live in the
 * body it travels with.
 *
 * `getText` and not `getFullText`, which is what leaves the doc comment out.
 * The comments above these copies name each package's own tests and each
 * package's own reasons, and those are differences that should stay.
 */
export function functionsNamed(text: string, name: string): string[] {
  const found: string[] = [];

  const isFunction = (node: ts.Node): boolean =>
    ts.isArrowFunction(node) || ts.isFunctionExpression(node);

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found.push(node.getText());
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      isFunction(node.initializer)
    ) {
      found.push(node.getText());
    }

    ts.forEachChild(node, visit);
  };

  visit(parse(text));
  return found;
}
