import { relative } from 'node:path';
import ts from 'typescript';
import { parse, read, sources } from '../../../test/source.js';

/**
 * Reading this package's own source, and the rule lists every check over it
 * shares.
 *
 * `dormant.test.ts` asks what runs before anyone clicks, `privacy.test.ts`
 * what the code can reach, `manifest.test.ts` what the manifest declares.
 * None of the three can be observed from a running extension — an extension
 * that phones home looks exactly like one that does not until you watch the
 * network — so all three read the text, the way
 * `no-type-negotiation.test.ts` reads the runner's.
 *
 * `test/source.ts` states the repo's division and this follows it: the reading
 * is shared, the allowlists are not. So `modulesIn`, `why` and `Rules` are
 * here and every allowlist stays with the check that owns it. It is here
 * rather than at the root because only this package reads it; what every
 * package shares is `parse`, and that is already at the root.
 *
 * A syntax tree rather than a regex over the text, for the reason
 * `test/source.ts` gives: a tree holds no comments, so `fetch` written in a
 * doc comment explaining that nothing fetches is not a finding, and it holds
 * every form a name can be written in rather than the forms whoever wrote the
 * pattern thought of.
 */

/**
 * A list of things refused by name, each with the reason it is refused.
 *
 * Every check in this directory keeps one beside its allowlist, and keeps it
 * for the same reason: the allowlist covers the code that ships, and this
 * covers the next contributor, who widens the allowlist because the one entry
 * in front of them seemed harmless. Both lists have to be edited to get past a
 * check, and the reason a rule carries is what the failing line says.
 */
export type Rules = [RegExp, string][];

/** The first reason a list gives for one name, or nothing. */
export const why = (rules: Rules, name: string): string | undefined =>
  rules.find(([pattern]) => pattern.test(name))?.[1];

/** A package as these checks read it: module name → the source it holds. */
export type Modules = Record<string, string>;

/**
 * Every module under `dir`, keyed the way the package imports itself, so a
 * finding names the file a reader would open.
 */
export const modulesIn = (dir: string): Modules =>
  Object.fromEntries(
    sources(dir).map((file) => [relative(dir, file).split(/[\\/]/).join('/'), read(file)]),
  );

/** What one module touches, split by the questions worth asking of it. */
export type Surface = {
  /** Every dotted path it names off `chrome`, in its longest form. */
  chrome: string[];
  /** Every event name handed to an `addEventListener`, where it is a literal. */
  events: string[];
  /** Names it uses and never binds: everything it reaches for outside itself. */
  globals: string[];
  /** Property names it calls. */
  called: string[];
  /** Property names it writes to. */
  written: string[];
  /** Every string it writes. */
  strings: string[];
  /** Reaches this reading cannot name, one line each. */
  refused: string[];
};

/** Whether `node` is the name half of a declaration rather than a value. */
function isDeclaredName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    ((ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isModuleDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isImportClause(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isExportSpecifier(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isTypeParameterDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ts.isQualifiedName(parent)
  );
}

const ASSIGNS = new Set([ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken]);

/** Whether `node` is the target of an assignment rather than a read of one. */
function isWritten(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent) && parent.left === node) {
    const { kind } = parent.operatorToken;
    return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
  }
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
    return ASSIGNS.has(parent.operator);
  }
  return false;
}

/**
 * The whole path hanging off one `chrome`, and whether it stops being readable
 * part way along.
 *
 * The longest form rather than each step of it, because the step is not what
 * an allowlist can be written against: `chrome.action.onClicked.addListener`
 * is the only length at which "the one listener a click needs" is nameable.
 * `chrome['tabs']` reads the same way; `chrome[api]` does not, and is refused
 * rather than read.
 */
function pathFrom(root: ts.Identifier): { path: string; computed: boolean } {
  const parts = [root.text];
  let node: ts.Node = root;

  for (;;) {
    const parent = node.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
      parts.push(parent.name.text);
      node = parent;
    } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
      if (!ts.isStringLiteralLike(parent.argumentExpression)) return { path: parts.join('.'), computed: true };
      parts.push(parent.argumentExpression.text);
      node = parent;
    } else {
      return { path: parts.join('.'), computed: false };
    }
  }
}

/**
 * Whether one path leaves `chrome` bound to a name of its own.
 *
 * `const { scripting } = chrome` and `const api = chrome.tabs` both put an
 * extension API within reach under a name no path off `chrome` mentions, so
 * the allowlist would see a call on some local object. Neither is written
 * here, so both are refused outright.
 */
function isAliased(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) return true;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  return false;
}

/** Every name one module reaches for, out of TypeScript's own syntax tree. */
export function surfaceOf(text: string): Surface {
  const bound = new Set<string>();
  const used = new Set<string>();
  const paths = new Set<string>();
  const events = new Set<string>();
  const called = new Set<string>();
  const written = new Set<string>();
  const strings = new Set<string>();
  const refused = new Set<string>();

  const bind = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) bound.add(name.text);
    else for (const element of name.elements) if (ts.isBindingElement(element)) bind(element.name);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
      bind(node.name);
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node)) &&
      node.name
    ) {
      bound.add(node.name.text);
    } else if (ts.isImportClause(node) && node.name) bound.add(node.name.text);
    else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) bound.add(node.name.text);

    if (ts.isIdentifier(node) && node.text === 'chrome' && !isDeclaredName(node)) {
      const { path, computed } = pathFrom(node);
      if (computed) refused.add('reaches an extension API through a name it computes at run time');
      else if (path === 'chrome') {
        if (isAliased(node)) refused.add('binds the whole of chrome to a name of its own');
        else paths.add(path);
      } else if (isAliased(node)) refused.add(`binds ${path} to a name of its own`);
      else paths.add(path);
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : null;
      const call = ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (name === null) {
        if (isWritten(node)) refused.add('writes to a property it computes at run time');
        else if (call) refused.add('calls a property it computes at run time');
      } else if (call) called.add(name);
      else if (isWritten(node)) written.add(name);
    }

    // The event a listener is registered for, whichever object it hangs off.
    if (
      ts.isCallExpression(node) &&
      /(?:^|\.)addEventListener$/.test(node.expression.getText()) &&
      node.arguments.length > 0
    ) {
      const first = node.arguments[0];
      if (ts.isStringLiteralLike(first)) events.add(first.text);
      else refused.add('registers a listener for an event it names at run time');
    }

    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      strings.add(node.text);
    }

    if (ts.isIdentifier(node) && !isDeclaredName(node)) used.add(node.text);

    ts.forEachChild(node, visit);
  };

  visit(parse(text));

  return {
    chrome: [...paths].sort(),
    events: [...events].sort(),
    globals: [...used].filter((name) => !bound.has(name)).sort(),
    called: [...called].sort(),
    written: [...written].sort(),
    strings: [...strings].sort(),
    refused: [...refused].sort(),
  };
}

/**
 * Whether one initialiser can be evaluated without anything happening.
 *
 * What separates a declaration from an effect at a module's top level.
 * `const HOST = '__imgwhy_host__'` does nothing when the worker loads;
 * `const panel = build()` does whatever `build` does, and a worker whose top
 * level holds the second has stopped being dormant however small the call is.
 * A function expression is inert because making one is not calling one.
 */
function isInert(node: ts.Expression | undefined): boolean {
  if (node === undefined) return true;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return true;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return true;
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.UndefinedKeyword) return true;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    return isInert(node.operand);
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return isInert(node.expression);
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(isInert);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(
      (property) => ts.isPropertyAssignment(property) && isInert(property.initializer),
    );
  }
  return false;
}

/** One top-level statement, named the way a finding should read. */
function nameOf(statement: ts.Statement): string {
  if (ts.isExpressionStatement(statement)) {
    const held = statement.expression;
    if (ts.isCallExpression(held)) return `calls ${held.expression.getText()}`;
    if (ts.isAwaitExpression(held)) return 'awaits something';
    return 'evaluates an expression';
  }
  if (ts.isVariableStatement(statement)) {
    const names = statement.declarationList.declarations
      .filter((declaration) => !isInert(declaration.initializer))
      .map((declaration) => declaration.name.getText())
      .join(', ');
    return `initialises ${names} with something that runs`;
  }
  const kind = ts.SyntaxKind[statement.kind]
    .replace(/(?:Declaration|Statement)$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return `runs a ${kind}`;
}

/**
 * Whether a statement at a module's top level does nothing when the module
 * loads.
 *
 * An import is quiet in itself: it runs the module it names, and every module
 * here is read by the same check, so an effect is reported where it lives.
 * Types and function declarations vanish or declare. Everything else is a
 * call, a loop, a branch or an assignment — the worker doing something before
 * anyone asked it to.
 */
function isQuiet(statement: ts.Statement): boolean {
  if (
    ts.isImportDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  ) {
    return true;
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.every((declaration) =>
      isInert(declaration.initializer),
    );
  }
  return false;
}

/**
 * Every statement at one module's top level that does something, one line
 * each. Empty is a module that costs nothing to load.
 *
 * `exempt` is the one statement a module is allowed to run, given by the text
 * of the thing it calls. Manifest V3 requires the worker to register its
 * listener synchronously at the top level — a listener added later is a
 * listener Chrome has already decided the worker does not have — so the
 * registration is not optional and cannot be moved inside anything. It is
 * named rather than pattern-matched so that a second registration, or a
 * different one, is a finding.
 */
export function topLevelEffects(text: string, exempt?: string): string[] {
  const isTheRegistration = (statement: ts.Statement): boolean =>
    exempt !== undefined &&
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    statement.expression.expression.getText() === exempt;

  // One line per statement, undeduplicated, because the count is part of the
  // answer: two registrations are two listeners, the panel toggles twice, and
  // the click does nothing. A reading that collapsed them would say the worker
  // ran one statement when it ran two.
  return parse(text)
    .statements.filter((statement) => !isQuiet(statement))
    .filter((statement) => !isTheRegistration(statement))
    .map((statement) => `${nameOf(statement)} at its top level`);
}
