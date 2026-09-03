import ts from 'typescript';
import { parse } from '../../../test/source.js';

/**
 * Reading an emitted report back as elements and attributes — and, for the one
 * element that is not markup, as the names its code reaches for.
 *
 * Two checks need it, and both need the same thing: `escaping.test.ts` asks
 * what ended up inside an attribute, and `self-contained.test.ts` asks whether
 * anything in the file can reach the network.
 *
 * A scanner rather than a search for strings, because the properties both
 * tests hold are about *where* a string sits. `https://example.com/i/640.png`
 * written as the text of a cell is a URL the report is allowed to show; the
 * same URL in a `src` is a request the file must never make, and no substring
 * search tells the two apart.
 */

export type Attribute = { name: string; value: string };
export type Element = { name: string; attributes: Attribute[] };

/**
 * A start or end tag, and the attribute blob inside it.
 *
 * `[^>]*` for the blob is safe here for the same reason the whole scanner is:
 * an attribute value holding a `>` would have to have come from the page, and
 * page content is escaped to `&gt;` before it reaches the document. `unread`
 * below is what proves the assumption rather than resting on it.
 */
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>/g;

const ATTRIBUTE = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * The document type declaration, which is not an element and has no
 * attributes: `<!doctype html>` would otherwise read as an element named
 * `doctype` carrying an attribute named `html`.
 *
 * Only one at the very start is taken off. Anything `<!`-shaped anywhere else
 * is left for `unread` to report, because nothing here writes one.
 */
const DOCTYPE = /^<!doctype [^>]*>/i;

/**
 * A script element, its attributes, and everything between its tags.
 *
 * Case-insensitive and non-greedy, which is how a browser reads one: the
 * content of a script element is not markup at all — the parser switches to
 * script data and runs to the first `</script`, whatever the text in between
 * looks like.
 */
const SCRIPT = /<script([^>]*)>([\s\S]*?)<\/script>/gi;

/**
 * The document as markup, which means without the parts that are not.
 *
 * The doctype is not an element. A script's content is not markup either, and
 * taking it out is what lets everything below stay honest: `i < panels.length`
 * inside a script is a comparison, and a scanner that read it as a tag — or as
 * a `<` nothing accounted for — would report the report's own code as an
 * injection and would keep reporting it until someone loosened the rule that
 * matters.
 *
 * What it costs is that no rule below sees inside a script, so `scripts` hands
 * that content back for the checks that are about a script rather than about
 * markup. Between them: `self-contained.test.ts` reads the code for anything
 * that fetches or writes markup, and reads a data island for a `<` — which
 * cannot be there, because `dataScript` writes every one of them as `\\u003c`.
 */
const markup = (document: string): string =>
  document.replace(DOCTYPE, '').replace(SCRIPT, (_whole, blob: string) => `<script${blob}></script>`);

const attributesOf = (blob: string): Attribute[] =>
  [...blob.matchAll(ATTRIBUTE)].map((found) => ({
    name: found[1].toLowerCase(),
    value: found[2] ?? found[3] ?? found[4] ?? '',
  }));

/** Every element in the document, in the order its tag was written. */
export const elements = (document: string): Element[] =>
  [...markup(document).matchAll(TAG)].map((found) => ({
    name: found[1].toLowerCase(),
    attributes: attributesOf(found[2]),
  }));

/** Every attribute of every element, one flat list. */
export const attributes = (document: string): Attribute[] =>
  elements(document).flatMap((element) => element.attributes);

/**
 * Every `<` the scanner did not consume as a tag.
 *
 * A checked document has none: the markup is written here, and everything
 * from the page is escaped, so a `<` outside a tag means either a tag shape
 * the scanner cannot read — in which case the allowlists above it are being
 * bypassed — or page content that arrived unescaped. Both are findings.
 */
export const unread = (document: string): string[] =>
  markup(document)
    .replace(TAG, '')
    .split('<')
    .slice(1)
    .map((rest) => `<${rest.slice(0, 60)}`);

/**
 * The text inside every `<style>` element, which is CSS and not markup.
 *
 * Case-insensitive, because HTML is: `<STYLE>` opens the same element, and a
 * scan that read past it would hand back no stylesheet at all and so bypass
 * every CSS rule the self-containment check holds. `elements` above lowercases
 * every tag name for the same reason, and the uppercase case is in that
 * check's attack table so it stays covered.
 */
const STYLE = /<style[^>]*>([\s\S]*?)<\/style>/gi;

export const stylesheets = (document: string): string[] =>
  [...document.matchAll(STYLE)].map((found) => found[1]);

/**
 * One script element: what the browser will do with it, and what is inside it.
 *
 * `type` is what tells the two kinds apart, and they answer to different
 * rules. An empty type is a classic script and runs, so what matters is what
 * the code can reach. `application/json` runs nothing at all — it is the
 * report's data, and what matters is that it cannot stop being data.
 */
export type Script = { type: string; text: string };

export const scripts = (document: string): Script[] =>
  [...document.matchAll(SCRIPT)].map((found) => ({
    type: (attributesOf(found[1]).find((one) => one.name === 'type')?.value ?? '').toLowerCase(),
    text: found[2],
  }));

/**
 * What one script reaches for, split by the four questions worth asking of it.
 *
 * `reaches` in `test/source.ts` answers the same shape of question about a
 * module, and for the same reason: a syntax tree holds every form a thing can
 * be written in, where a pattern over the text holds the forms whoever wrote
 * it thought of. `el.innerHTML`, `el['inner' + 'HTML']` and
 * `Object.assign(el, { innerHTML })` are one act written three ways.
 */
export type Names = {
  /** Names it uses and never binds: everything it reaches for outside itself. */
  globals: string[];
  /** Property names it calls. */
  called: string[];
  /** Property names it writes to. */
  written: string[];
  /** Property names it writes into an object literal. */
  keys: string[];
  /** Reaches this reading cannot name, one line each. */
  refused: string[];
};

/** The name a member expression names, or null where it computes one. */
const memberName = (
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | null =>
  ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isStringLiteralLike(node.argumentExpression)
      ? node.argumentExpression.text
      : null;

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
 * Every name one script reaches for, out of TypeScript's own syntax tree.
 *
 * A global is a name used and never bound anywhere in the script, which is the
 * whole of what a script can reach outside itself: `fetch`, `XMLHttpRequest`,
 * `Image`, `WebSocket`, `eval` and `importScripts` are all one of those, and
 * so is a name a future edit invents.
 *
 * The other three are about what it can put onto an object it did not make.
 * `written` and `keys` are the same act by two routes — `el.src = url` and
 * `Object.assign(el, { src: url })` — and `called` is the third, because
 * `insertAdjacentHTML` and `createElement` are calls rather than assignments.
 * A property *read* is not here: reading `el.innerHTML` fetches nothing and
 * writes nothing, and the data field names a report reads are the Capture's
 * whole vocabulary.
 *
 * One route is refused rather than read. `el[whatever()] = x` names its
 * property when it runs, and no reading of the text can say which. Nothing in
 * the report writes one.
 */
export function namesIn(javascript: string): Names {
  const bound = new Set<string>();
  const used = new Set<string>();
  const called = new Set<string>();
  const written = new Set<string>();
  const keys = new Set<string>();
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
        ts.isClassExpression(node)) &&
      node.name
    ) {
      bound.add(node.name.text);
    } else if (ts.isImportClause(node) && node.name) {
      bound.add(node.name.text);
    } else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
      bound.add(node.name.text);
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = memberName(node);
      const call = ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (name === null) {
        if (isWritten(node)) refused.add('writes to a property it computes at run time');
        else if (call) refused.add('calls a property it computes at run time');
      } else if (call) called.add(name);
      else if (isWritten(node)) written.add(name);
    } else if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      if (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) keys.add(node.name.text);
      else refused.add('names a property it computes at run time in an object');
    }

    // A value position: an identifier that is not the name half of something.
    // A shorthand `{ src }` is both, and is counted as both.
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        ts.isParameter(parent) ||
        ts.isVariableDeclaration(parent) ||
        ts.isBindingElement(parent) ||
        ts.isImportClause(parent) ||
        ts.isImportSpecifier(parent) ||
        ts.isNamespaceImport(parent) ||
        ((ts.isFunctionDeclaration(parent) ||
          ts.isFunctionExpression(parent) ||
          ts.isClassDeclaration(parent) ||
          ts.isClassExpression(parent) ||
          ts.isMethodDeclaration(parent)) &&
          parent.name === node);
      if (!isName) used.add(node.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(parse(javascript));

  return {
    globals: [...used].filter((name) => !bound.has(name)).sort(),
    called: [...called].sort(),
    written: [...written].sort(),
    keys: [...keys].sort(),
    refused: [...refused].sort(),
  };
}
