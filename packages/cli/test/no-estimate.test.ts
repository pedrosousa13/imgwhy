import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse, read, sources } from '../../runner/test/source.js';

const src = fileURLToPath(new URL('../src', import.meta.url));

/** A package as this check reads it: module name → the source it holds. */
type Modules = Record<string, string>;

/** The name a property is written under, with any quotes taken off. */
const nameOf = (name: ts.PropertyName): string =>
  ts.isStringLiteralLike(name) ? name.text : name.getText();

/** Every expression written into the named column, as its own subtree. */
function fillers(column: string, text: string): ts.Expression[] {
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && nameOf(node.name) === column) {
      found.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return found;
}

/** Every call to the named function, as its own subtree. */
function callsTo(name: string, text: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText() === name) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return found;
}

/** Whether this expression is a call to the named function. */
const isCallTo = (node: ts.Expression, name: string): boolean =>
  ts.isCallExpression(node) && node.expression.getText() === name;

/**
 * Whether this expression is a plain read of the named field.
 *
 * `image.transferBytes` and `s.image.transferBytes` are reads. A call in the
 * chain is not: `guessed(image).transferBytes` names the right field on the
 * wrong object, and is exactly how a guess would be dressed as a recording.
 */
const readsField = (node: ts.Expression, field: string): boolean => {
  const plain = (target: ts.Expression): boolean =>
    ts.isIdentifier(target) ||
    (ts.isPropertyAccessExpression(target) && plain(target.expression));
  return ts.isPropertyAccessExpression(node) && node.name.text === field && plain(node.expression);
};

/** Every name a module declares at its top level or imports into itself. */
function moduleNames(text: string): Set<string> {
  const found = new Set<string>();
  const declared = (name: ts.BindingName | ts.Identifier | undefined): void => {
    if (!name) return;
    if (ts.isIdentifier(name)) found.add(name.text);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) if (ts.isBindingElement(element)) declared(element.name);
    }
  };

  for (const statement of parse(text).statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      declared(clause?.name);
      const bound = clause?.namedBindings;
      if (bound && ts.isNamespaceImport(bound)) declared(bound.name);
      if (bound && ts.isNamedImports(bound)) for (const it of bound.elements) declared(it.name);
    } else if (ts.isVariableStatement(statement)) {
      for (const one of statement.declarationList.declarations) declared(one.name);
    } else if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      declared(statement.name);
    }
  }
  return found;
}

/** Every name one subtree writes, whether declared, read or reached through. */
function namesIn(node: ts.Node): Set<string> {
  const found = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) found.add(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

/** The declaration of the named const or function, as its own subtree. */
function declarationOf(name: string, text: string): ts.Node | null {
  let found: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node;
    } else if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return found;
}

/**
 * Every way the printed figure could be something other than the transfer the
 * runner recorded, one line each. Empty is clean.
 *
 * Three rules, and each one closes a route the other two leave open:
 *
 * 1. Whatever fills the column is a call to the formatter. The column name is
 *    a fixed string, so a value cannot reach that column without being written
 *    under it somewhere in this package — including in a helper whose result is
 *    spread into a row.
 * 2. The formatter is only ever handed a plain read of the recorded field. This
 *    is also what covers the collapsed `bytes` line of an image with nothing to
 *    select, which fills no column and still prints a figure.
 * 3. Where the formatter is declared, it reaches nothing its own module holds —
 *    so it cannot delegate to a guess, whatever it was handed.
 */
function estimating(modules: Modules, column: string, formatter: string): string[] {
  return Object.entries(modules).flatMap(([name, text]) => {
    const reachable = moduleNames(text);
    reachable.delete(formatter);
    const declaration = declarationOf(formatter, text);

    return [
      ...fillers(column, text)
        .filter((filler) => !isCallTo(filler, formatter))
        .map((filler) => `${name} fills ${column} from ${filler.getText()}`),
      ...callsTo(formatter, text)
        .filter(
          (call) =>
            call.arguments.length !== 1 ||
            !call.arguments.every((given) => readsField(given, 'transferBytes')),
        )
        .map(
          (call) =>
            `${name} hands ${formatter} ${call.arguments.map((given) => given.getText()).join(', ')}`,
        ),
      ...(declaration
        ? [...namesIn(declaration)]
            .filter((used) => reachable.has(used))
            .map((used) => `${name}'s ${formatter} reaches ${used}`)
        : []),
    ];
  });
}

/**
 * The design's non-goal, as a check rather than an inspection:
 *
 * > **Estimated bytes.** Where `transferBytes` is null, report it as unknown.
 * > Do not guess from pixel dimensions.
 *
 * This half guards where the figure is printed, which is where a guess would
 * do its damage: `bytes arrived` reads exactly like a measurement whatever put
 * it there. The runner's half — where the figure is measured — is
 * `packages/runner/test/no-estimate.test.ts`.
 *
 * It has to be a separate file rather than one more case over there, because
 * `trace.ts` is the one module that legitimately does arithmetic on pixel
 * dimensions. `css px` and `needed` are dimensions multiplied by a device
 * ratio, and that is the arithmetic the whole tool exists to show. So a rule
 * that bans a dimension from this module cannot be written. What can be
 * written is that the byte column, alone among the nine, comes from one
 * formatter handed one recorded field.
 */
describe('the printed transfer size, checked against estimation', () => {
  /** The package as the check reads it, keyed the way it imports itself. */
  const modules: Modules = Object.fromEntries(
    sources(src).map((file) => [relative(src, file).split(/[\\/]/).join('/'), read(file)]),
  );
  const COLUMN = 'bytes arrived';
  const FORMATTER = 'bytesArrived';

  it('has the formatter and the column to check, so nothing below passes for want of them', () => {
    expect(declarationOf(FORMATTER, modules['trace.ts'] ?? '')).not.toBeNull();
    // One per row, and one for the image that had nothing to select.
    expect(callsTo(FORMATTER, modules['trace.ts'] ?? '').length).toBeGreaterThanOrEqual(2);
    expect(fillers(COLUMN, modules['trace.ts'] ?? '')).toHaveLength(1);
  });

  it('prints no figure the runner did not record', () => {
    expect(estimating(modules, COLUMN, FORMATTER)).toEqual([]);
  });
});

/**
 * The check, read against a trace written to defeat it.
 *
 * Each case is a real way to put a guess in the column a reader trusts, and
 * they are held here rather than tried on a branch and reverted, so the failure
 * they should cause is a passing test instead of a note in a commit message.
 *
 * ## What still gets past
 *
 * - **A tenth column.** `Row` is a closed type, so a new column is a
 *   deliberate edit to it — but no rule here keys on a column that does not
 *   exist yet.
 * - **A computed key.** `{ [column]: guess }` writes into the column without
 *   naming it, and nothing read out of the text can say what `column` holds.
 * - **A formatter that computes from the recorded figure itself.** It can only
 *   reach `transferBytes`, and `transferBytes` is not a pixel dimension, so
 *   whatever it did there would not be the non-goal.
 * - **Whatever put the figure in `transferBytes`.** That is the runner half's
 *   to answer.
 */
describe('the printed estimation check, given a trace that guesses anyway', () => {
  const COLUMN = 'bytes arrived';
  const FORMATTER = 'bytesArrived';

  /** The shipped arrangement, with one module's source swapped in. */
  const packaged = (overrides: Modules): Modules => ({
    'trace.ts': `const bytesArrived = (transferBytes: number | null): string =>
        transferBytes === null ? 'unknown' : String(transferBytes);
      const chosen = (image) => ({ 'bytes arrived': bytesArrived(image.transferBytes) });`,
    ...overrides,
  });

  const found = (overrides: Modules): string[] =>
    estimating(packaged(overrides), COLUMN, FORMATTER);

  it('is quiet about the arrangement that ships', () => {
    expect(found({})).toEqual([]);
  });

  it('catches the column filled without the formatter at all', () => {
    expect(
      found({
        'trace.ts': `const chosen = (image) => ({
          'bytes arrived': String(Math.round(image.naturalWidth * 0.25)),
        });`,
      }),
    ).toEqual(['trace.ts fills bytes arrived from String(Math.round(image.naturalWidth * 0.25))']);
  });

  it('catches a guess reached through a fallback on the recorded figure', () => {
    expect(
      found({
        'trace.ts': `const chosen = (image) => ({
          'bytes arrived': bytesArrived(image.transferBytes ?? guessFrom(image.naturalWidth)),
        });`,
      }),
    ).toEqual([
      'trace.ts hands bytesArrived image.transferBytes ?? guessFrom(image.naturalWidth)',
    ]);
  });

  it('catches the formatter handed a dimension instead of the recorded field', () => {
    expect(
      found({
        'trace.ts': `const chosen = (image) => ({
          'bytes arrived': bytesArrived(image.naturalWidth),
        });`,
      }),
    ).toEqual(['trace.ts hands bytesArrived image.naturalWidth']);
  });

  it('catches the right field read off the wrong object', () => {
    expect(
      found({
        'trace.ts': `const chosen = (image) => ({
          'bytes arrived': bytesArrived(guessed(image).transferBytes),
        });`,
      }),
    ).toEqual(['trace.ts hands bytesArrived guessed(image).transferBytes']);
  });

  it('catches a formatter that delegates, however honest its argument looks', () => {
    expect(
      found({
        'trace.ts': `const guessFrom = (image) => Math.round(image.naturalWidth * 0.25);
          const bytesArrived = (image): string =>
            image.transferBytes === null ? String(guessFrom(image)) : String(image.transferBytes);
          const chosen = (image) => ({ 'bytes arrived': bytesArrived(image.transferBytes) });`,
      }),
    ).toEqual(["trace.ts's bytesArrived reaches guessFrom"]);
  });

  it('catches a second module filling the column, which one file read cannot', () => {
    expect(
      found({
        'weights.ts': `export const weigh = (image) => ({
          'bytes arrived': String(image.naturalWidth * 4),
        });`,
      }),
    ).toEqual(['weights.ts fills bytes arrived from String(image.naturalWidth * 4)']);
  });

  it('reads nothing out of a comment, which a regex over the text cannot help', () => {
    expect(
      found({
        'trace.ts': `/** Never \`'bytes arrived': String(naturalWidth * 0.25)\`, and never a guess. */
          const bytesArrived = (transferBytes: number | null): string =>
            transferBytes === null ? 'unknown' : String(transferBytes);
          const chosen = (image) => ({ 'bytes arrived': bytesArrived(image.transferBytes) });`,
      }),
    ).toEqual([]);
  });
});
