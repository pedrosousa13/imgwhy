/**
 * What both terminal outputs are written with: one escaped line, and the
 * handful of shapes the trace and the diff both put on one.
 *
 * All of it was `trace.ts`'s, and it is here because `compare.ts` writes for
 * the same reader in the same alphabet. A second copy of the escaping would be
 * a second place for it to drift, and a guarantee that holds in one of two
 * outputs is not a guarantee: what a page can do to a terminal, it can do
 * through whichever output forgot. The wording travels with it for a smaller
 * reason — a reader who has read `unknown` in a trace should not have to learn
 * a second word for it in a diff.
 */

/**
 * The letter `JSON.stringify` writes after the backslash, by the code point it
 * writes it for.
 *
 * These six are the ones it spells short rather than as `\uXXXX`, and they are
 * spelled short here for the reason the escaping exists at all: one page should
 * produce one spelling of one attribute across both of a run's outputs. A trace
 * saying `\u000a` beside a Capture saying `\n` would be two spellings again,
 * in the one place a reader puts them side by side.
 *
 * The backslash is one of the six, and that is not a detail. Without it a page
 * writing the six characters `\u001b` and a page writing an ESC produce the
 * same line, and the trace could not say which of them it had found — which is
 * the honesty that writing a control character rather than dropping it was
 * for. `html.ts` puts `&` first in its own list for exactly this reason, and
 * one pass is what makes "first" true here: every character is replaced from
 * what the page wrote, so a backslash this writes is never read again.
 */
const SHORT = new Map([
  [0x5c, '\\'],
  [0x08, 'b'],
  [0x09, 't'],
  [0x0a, 'n'],
  [0x0c, 'f'],
  [0x0d, 'r'],
]);

/**
 * Everything a page string is written out for, which is three groups.
 *
 * - The backslash, so that what this writes can be read back. `SHORT` says
 *   why that matters.
 * - `\p{Cc}`, Unicode's control category: C0, DEL and C1. These are the
 *   characters a terminal reads as orders rather than as text. An ESC opens a
 *   sequence that retitles the window or erases the line it lands on — the
 *   `← differs` marker included — and a CR or an LF ends the line it
 *   sits on and gives the rest of an attribute a line of its own, which is a fact a reader
 *   would credit to imgwhy rather than to the page.
 * - The characters that do those same two things without being controls.
 *   U+202A to U+202E and U+2066 to U+2069 are the bidi embeddings, overrides
 *   and isolates: they reorder displayed text, so a page carrying one decides
 *   what a reader sees rather than what was written. U+2028 and U+2029 are the
 *   line and paragraph separators, and anything reading stdout a line at a
 *   time ends a line on either.
 *
 * Reordering text and ending a line is the line drawn, and it is drawn there
 * rather than at `\p{Cf}` deliberately. A soft hyphen, a ZWNJ and a ZWJ do
 * neither; a page is entitled to them, and escaping a ZWJ would mangle an
 * ordinary file name in the trace's `file` column.
 */
const ESCAPED = /[\\\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

/**
 * A page string with every one of those written out, as JSON's short escape or
 * as `\uXXXX`.
 *
 * Written rather than dropped, and that is the whole of the choice. The same
 * attribute already reads `\u001b` in `--json`, because `JSON.stringify`
 * escapes it there, so dropping it here would give one run two spellings of one
 * attribute across its two outputs, and the trace would be quietly short of
 * what the page held. A tool whose subject is what the page said does not
 * discard part of what it said.
 *
 * Where both escape, the two agree — which `escaping.test.ts` checks by reading
 * a line back against `JSON.stringify` itself rather than against a spelling
 * written out by hand. They do not escape the same set, and this one is the
 * stricter on purpose: `JSON.stringify` leaves DEL, C1, the bidi controls and
 * U+2028 as they came, the last of those being the old JSONP hazard, and every
 * one of them is a character a terminal or a line reader acts on. It also
 * leaves the double quote alone where JSON escapes it, because JSON has a
 * string delimiter to protect and a line of output has none.
 *
 * What comes back holds nothing a terminal acts on, so `String.length` is a
 * printed width for everything this deals with — which is what puts a table's
 * columns back under each other. `say` says where that stops being
 * true in general.
 */
export const escape = (value: string): string =>
  value.replace(ESCAPED, (found) => {
    const code = found.charCodeAt(0);
    return `\\${SHORT.get(code) ?? `u${code.toString(16).padStart(4, '0')}`}`;
  });

/**
 * One finished line: escaped where it came off the page, or written as a
 * literal part of a template by whichever module built the line.
 *
 * The class is exported as a type and never as a value, and it holds its text
 * privately, so nothing outside this module can make one. TypeScript compares a class with a private member
 * by name rather than by shape, so no string and no object literal can stand
 * in for one either. That is what makes `say` the only route to a line: a
 * string off the page reaching one has to pass through an interpolation, and
 * every interpolation escapes.
 *
 * There is no way to turn that off, and the reason is not distrust of the
 * next contributor. It is that escaping at each call site is a thing to
 * remember, and the line added to an output next year is the one that would
 * forget. `packages/report/src/html.ts` holds the same shape against the same
 * problem and says the rest of why.
 *
 * The shape is that file's, re-derived here rather than shared. Sharing it
 * would couple the command line to the report package, and the two escape
 * different alphabets for different readers: one answers to an HTML parser,
 * and this one to a terminal.
 */
class Line {
  constructor(private readonly text: string) {}

  toString(): string {
    return this.text;
  }
}

export type { Line };

/**
 * Anything an interpolation may carry.
 *
 * A `string` is page content until proven otherwise, so it is escaped — the
 * labels and the sentences a caller writes are strings too, and escaping one
 * of those changes nothing. A `number` cannot carry a control character. A
 * `Line` is already escaped, which is what lets a finished line be indented by
 * writing it into another one. A list is any of those, which is how a row of
 * cells arrives.
 */
type Value = string | number | Line | readonly Value[];

const rendered = (value: Value): string => {
  if (typeof value === 'string') return escape(value);
  if (typeof value === 'number') return String(value);
  if (value instanceof Line) return value.toString();
  return value.map(rendered).join('');
};

/**
 * Build one line from a template, escaping every interpolation.
 *
 * ## What this does not cover
 *
 * The guarantee is that a page cannot make a terminal act, and cannot end a
 * line. It is not a guarantee about everything a page can do to a line:
 *
 * - **Printed width.** `String.length` is the printed width of ASCII and of
 *   nothing else: `你好` is two characters and four cells, a zero-width space
 *   is one character and none, and an astral character is two. So a table's
 *   columns line up against the characters `ESCAPED` names — which is what
 *   they had lost their alignment to — and not in general. A page can still
 *   put a wide character in a `sizes` string and shift everything to the right
 *   of it.
 * - **A mark that reorders nothing.** U+200E and U+200F are left as written.
 *   They lend their own direction to neutral text beside them without
 *   overriding anything, which is on the far side of the line `ESCAPED` draws.
 * - **A `throw new Error(...)`.** `trace.ts` has two, each interpolating a
 *   name into a message that reaches stderr through `bin.ts`: one a
 *   page-derived `id`, one a `deviceId` out of a config file. Neither is
 *   escaped and neither is a line of any output — both say an invariant of the
 *   Capture was broken, which is a crash rather than a report, and a run that
 *   reaches one prints nothing at all.
 * - **stderr.** Nothing here writes to it. What goes there is `run.ts`'s and
 *   `diff.ts`'s: one of `run.ts`'s messages carries the page's own URL — #51 —
 *   while `diff.ts` quotes nothing it read out of a Capture, which is the rule
 *   `in.ts` states and holds. The one message under that rule carrying bytes
 *   off a file is the JSON parser's own, which `in.ts` puts through `escape`
 *   before it goes anywhere.
 * - **The Capture.** It is escaped nowhere and must not be. `--json` and
 *   `--out` are machine input, and a reader typing a recorded `sizes` string
 *   into the report's control has to get the string the page wrote.
 */
export function say(parts: TemplateStringsArray, ...values: Value[]): Line {
  let out = parts[0];
  for (let i = 0; i < values.length; i++) {
    out += rendered(values[i]) + parts[i + 1];
  }
  return new Line(out);
}

/** A count and the noun it counts, which English spells two ways. */
export const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * The weight of the response that arrived, as the runner recorded it.
 *
 * Unknown stays unknown. Nothing here turns a dimension into a weight: a
 * guess would read exactly like a measurement in this column, which is the
 * design's non-goal — "where `transferBytes` is null, report it as unknown".
 * The word is written once for both outputs, because a reader comparing a
 * trace against a diff of the same page is comparing two figures, and two
 * words for one missing figure would read as two different findings.
 */
export const bytesArrived = (transferBytes: number | null): string =>
  transferBytes === null ? 'unknown' : String(transferBytes);

/**
 * Cells laid out in columns, one line per row, each column padded to its
 * widest cell.
 *
 * Every column is left aligned, so a reader can run an eye straight down one
 * of them and every row breaks in the same place. A heading row is a row like
 * any other: whatever the caller puts first is measured with the rest, which
 * is what keeps a heading over the values under it.
 *
 * Measured after the escape, because the width a column is padded to has to be
 * the printed width: a control character is one character in the string the
 * page wrote and six in the string a terminal shows, so a column measured
 * before the escape is a column the next row does not line up under — the one
 * defect here a reader sees rather than obeys.
 *
 * Only the measuring happens here. Every cell reaches its line through an
 * interpolation, so `say` is what escapes the text, once, exactly as it does
 * for every other line — and a caller's rows are walked as they come, so a
 * tenth column is measured and written with the nine without a line of this
 * changing. The last cell of a row takes no padding, which is what a trailing
 * trim used to do.
 */
export function columns(rows: readonly (readonly string[])[]): Line[] {
  const printed = (cell: string): number => escape(cell).length;

  // Each width starts at 0 rather than at the first cell it meets, so a caller
  // with nothing to lay out gets no lines rather than a width of -Infinity.
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, at) => {
      widths[at] = Math.max(widths[at] ?? 0, printed(cell));
    });
  }

  return rows.map(
    (row) =>
      say`${row.flatMap((cell, at) =>
        at === row.length - 1 ? [cell] : [cell, ' '.repeat(widths[at] - printed(cell) + 2)],
      )}`,
  );
}
