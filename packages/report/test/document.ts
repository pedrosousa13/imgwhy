/**
 * Reading an emitted report back as elements and attributes.
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

const markup = (document: string): string => document.replace(DOCTYPE, '');

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

/** The text inside every `<style>` element, which is CSS and not markup. */
export const stylesheets = (document: string): string[] =>
  [...document.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((found) => found[1]);
