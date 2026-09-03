/**
 * Markup that is finished: escaped where it came from the page, or written as
 * a literal part of a template here.
 *
 * `Markup` is not exported, and it holds its text privately, so nothing
 * outside this module can make one. TypeScript compares a class with a
 * private member by name rather than by shape, so no object literal can stand
 * in for one either. That is what makes `html` the only route to the output:
 * a string from the page reaching the document has to pass through an
 * interpolation, and every interpolation escapes.
 */
class Markup {
  constructor(private readonly text: string) {}

  toString(): string {
    return this.text;
  }
}

/** Finished markup. `html` is the only thing that makes it. */
export type Html = Markup;

/**
 * Anything an interpolation may carry.
 *
 * A `string` is page content until proven otherwise, so it is escaped. A
 * `number` cannot carry markup. `Html` is already finished. A list is every
 * one of those, which is how a row of cells or a list of candidates arrives.
 *
 * What is deliberately missing is `null`, `undefined` and `boolean`. Each of
 * them has a plausible rendering and no obvious one — `null` as the empty
 * string or as the word, `false` as nothing or as "false" — and a report that
 * prints "undefined" in a cell has lost the reader. The compiler asks for the
 * decision at the call site instead.
 */
export type Value = string | number | Html | readonly Value[];

/**
 * The five characters that can leave element text, or a quoted attribute
 * value, and start markup.
 *
 * `&` goes first, so nothing this replaces can be read back as an escape of
 * its own. Both quotes are included, so a double-quoted attribute value and a
 * single-quoted one are equally safe — neither quoting style is the weaker
 * one, which is the guarantee, and it is a guarantee about quoted values.
 *
 * An *unquoted* attribute value ends at a space, so covering one would mean
 * escaping space, `=` and the backtick as well. That is not done, for a
 * reason and not by oversight: this list also escapes every string that
 * reaches element text, and a report's text is full of spaces — the `sizes`
 * string, a selector, a URL. `&#32;` in every gap would make the emitted
 * document unreadable to buy safety at a site that does not exist. No
 * attribute in the report carries an interpolation at all; `escaping.test.ts`
 * proves it, by reading back every attribute value the document holds and
 * refusing any that is not one of this package's own words.
 *
 * So: write attribute values quoted. An unquoted one is the case this list
 * does not answer for, and the check above is what keeps it from arriving.
 */
const ESCAPES: [RegExp, string][] = [
  [/&/g, '&amp;'],
  [/</g, '&lt;'],
  [/>/g, '&gt;'],
  [/"/g, '&quot;'],
  [/'/g, '&#39;'],
];

const escape = (value: string): string =>
  ESCAPES.reduce((text, [pattern, entity]) => text.replace(pattern, entity), value);

const render = (value: Value): string => {
  if (typeof value === 'string') return escape(value);
  if (typeof value === 'number') return String(value);
  if (value instanceof Markup) return value.toString();
  return value.map(render).join('');
};

/**
 * Build markup from a template, escaping every interpolation.
 *
 * The escaping is handled once, here, rather than at each interpolation site,
 * because a site is a thing a contributor can forget. Every string in a
 * Capture came from a page nobody controls — image URLs, the `sizes` string,
 * a selector, the page URL after a redirect it chose — and the escaping is
 * not optional for any of them. So this tag has no way to turn it off: there
 * is no `raw`, and `Markup` cannot be built from outside this module, so the
 * only way a string reaches the document is escaped.
 *
 * The literal parts of the template are the markup, and they are written out
 * untouched. That is where the tags, the attributes and the whole of the
 * stylesheet live.
 *
 * ## What this does not cover
 *
 * HTML escaping is right for element text and for a quoted attribute value,
 * and it is not enough anywhere else:
 *
 * - **An unquoted attribute value.** `<div class=${x}>` ends the value at the
 *   first space, which `escape` leaves alone. `ESCAPES` says why it is left
 *   alone; no template here writes one, and no page string reaches an
 *   attribute at all.
 * - **Inside `<style>` or `<script>`.** Those parse their own grammar, where
 *   `&lt;` is not a `<` and `</script` ends the element whatever escaped it.
 *   So no value is interpolated into either: the report's stylesheet is a
 *   literal part of a template, with nothing from the page in it.
 * - **A URL in a fetching attribute.** Escaping a `javascript:` URL leaves it
 *   a working `javascript:` URL. The report puts no page URL in an `href` or a
 *   `src` at all — it writes them as text — which is the same rule that keeps
 *   the file from loading a remote resource.
 */
export function html(parts: TemplateStringsArray, ...values: Value[]): Html {
  let out = parts[0];
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + parts[i + 1];
  }
  return new Markup(out);
}

/**
 * The three runs of characters that leave a `<script>` element.
 *
 * A script element is not markup. The parser reads its content as script data
 * and stops at `</script`, whatever an HTML escape did to the text on the way
 * in — `&lt;/script&gt;` is `&lt;/script&gt;` to a JavaScript parser and the
 * element it sits in has already ended. `<!--` is the other half: it moves the
 * parser into the escaped-text state, where a following `<script` opens a
 * nested one and `</script>` no longer closes anything.
 *
 * So HTML escaping is not the answer here, and neither is a variant of it.
 * These three are refused outright.
 */
const BREAKOUT = /<\/script|<!--|<script/i;

/** Whichever of the three above is in `text`, or null. */
const breakout = (text: string): string | null => BREAKOUT.exec(text)?.[0].toLowerCase() ?? null;

/**
 * A `<script>` element carrying JavaScript this repo wrote.
 *
 * Nothing from the page reaches this. What goes in is core, as `coreSource()`
 * hands it over, and this package's own panel code — both of them literal
 * text, neither of them interpolated. That is the same rule the stylesheet
 * keeps, and it is kept for the same reason: escaping buys nothing inside an
 * element that parses its own grammar, so the answer is that nothing needing
 * an escape goes in. The Capture reaches the page through `dataScript` below,
 * as inert JSON the script reads.
 *
 * The refusal is a guarantee at render time rather than a rule someone has to
 * remember. Core is source read out of the built package, so an `</script>` in
 * a future core would arrive here, and a report is a file people mail to each
 * other: better a run that fails loudly than a document that quietly stopped
 * being one element.
 */
export function script(javascript: string): Html {
  const found = breakout(javascript);
  if (found !== null) {
    throw new Error(`the script carries "${found}", which would end the element it sits in`);
  }
  return new Markup(`<script>\n${javascript}\n</script>`);
}

/**
 * The Capture's numbers, as a `<script type="application/json">` island the
 * page's own script reads back.
 *
 * This is how page content reaches the script without ever being script. The
 * element holds data, not code: a browser runs nothing in it, and the panel
 * reads it with `JSON.parse`, so a hostile `sizes` string is a string on the
 * way in and a string on the way out.
 *
 * Every `<` and `>` is written as its JSON escape. Both are exact: a `<`
 * outside a string is not JSON at all, so the only ones this can touch are
 * inside a string, and `\u003c` in a JSON string *is* `<` — `JSON.parse` hands
 * back the character that went in. What it cannot be is `</script`, `<!--` or
 * `<script`, because none of those survives without a literal `<`.
 *
 * That is the whole of the escaping argument for this element, and it is
 * checked rather than asserted: `escaping.test.ts` renders a Capture whose
 * `sizes` string carries all three and reads the island back.
 */
export function dataScript(value: object): Html {
  const json = JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const found = breakout(json);
  if (found !== null) {
    // Unreachable: the replacement above leaves no `<` to start any of them.
    // Held anyway, because this element carries the one thing in the document
    // that came off the page, and a silent hole here is the whole file.
    throw new Error(`the data carries "${found}", which would end the element it sits in`);
  }
  return new Markup(`<script type="application/json">${json}</script>`);
}
