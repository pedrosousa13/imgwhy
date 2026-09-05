import type { Candidate, Capture, CapturedImage, DeviceProfile, Selection } from '@imgwhy/core';
import { explainSelection } from '@imgwhy/core';

/** One image as one device saw it. */
type Sighting = { device: DeviceProfile; image: CapturedImage };

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
 *   `← differs` marker included — and a CR or an LF ends this trace's line and
 *   gives the rest of an attribute a line of its own, which is a fact a reader
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
 * ordinary file name in the `file` column.
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
 * string delimiter to protect and a line of a trace has none.
 *
 * What comes back holds nothing a terminal acts on, so `String.length` is a
 * printed width for everything this deals with — which is what puts the
 * table's columns back under each other. `say` says where that stops being
 * true in general.
 */
const escape = (value: string): string =>
  value.replace(ESCAPED, (found) => {
    const code = found.charCodeAt(0);
    return `\\${SHORT.get(code) ?? `u${code.toString(16).padStart(4, '0')}`}`;
  });

/**
 * One finished line of the trace: escaped where it came off the page, or
 * written as a literal part of a template here.
 *
 * `Line` is not exported and it holds its text privately, so nothing outside
 * this module can make one. TypeScript compares a class with a private member
 * by name rather than by shape, so no string and no object literal can stand
 * in for one either. That is what makes `say` the only route to the trace: a
 * string off the page reaching a line has to pass through an interpolation,
 * and every interpolation escapes.
 *
 * There is no way to turn that off, and the reason is not distrust of the
 * next contributor. It is that escaping at each call site is a thing to
 * remember, and the line added to this trace next year is the one that would
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

/**
 * Anything an interpolation may carry.
 *
 * A `string` is page content until proven otherwise, so it is escaped — the
 * labels and the sentences this file writes are strings too, and escaping one
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
 *   is one character and none, and an astral character is two. So `table`'s
 *   columns line up against the characters `ESCAPED` names — which is what
 *   they had lost their alignment to — and not in general. A page can still
 *   put a wide character in a `sizes` string and shift everything to the right
 *   of it.
 * - **A mark that reorders nothing.** U+200E and U+200F are left as written.
 *   They lend their own direction to neutral text beside them without
 *   overriding anything, which is on the far side of the line `ESCAPED` draws.
 * - **The two `throw new Error(...)` below.** Each interpolates a name into a
 *   message that reaches stderr through `bin.ts`: one a page-derived `id`, one
 *   a `deviceId` out of a config file. Neither is escaped and neither is a
 *   line of the trace — both say an invariant of the Capture was broken, which
 *   is a crash rather than a report, and a run that reaches one prints no
 *   trace at all.
 * - **stderr.** Nothing here writes to it. What goes there is `run.ts`'s, and
 *   one of those messages carries the page's own URL — #51.
 * - **The Capture.** It is escaped nowhere and must not be. `--json` and
 *   `--out` are machine input, and a reader typing a recorded `sizes` string
 *   into the report's control has to get the string the page wrote.
 */
function say(parts: TemplateStringsArray, ...values: Value[]): Line {
  let out = parts[0];
  for (let i = 0; i < values.length; i++) {
    out += rendered(values[i]) + parts[i + 1];
  }
  return new Line(out);
}

const absolute = (url: string, base: string): string => {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
};

/**
 * The tail of a URL, which is what tells two candidates apart at a glance.
 *
 * A query is cut to 40 characters — 39 of it, since the `?` is the first of
 * them — and that is a column width and not a redaction. The `file` column has
 * to stay narrow enough to read down, and one signed URL's query is longer
 * than the rest of a row put together. A URL that will not parse falls back to
 * its own last 40 characters, which shortens the same way for the same reason.
 *
 * The same URL is written whole in the Capture and whole in the report, which
 * the README says and the report says on its own page.
 */
const fileOf = (url: string, base: string): string => {
  try {
    const parsed = new URL(url, base);
    return (parsed.pathname.split('/').pop() || parsed.hostname) + parsed.search.slice(0, 40);
  } catch {
    return url.slice(-40);
  }
};

/**
 * The weight of the response that arrived, as the runner recorded it.
 *
 * Unknown stays unknown. Nothing here turns a dimension into a weight: a
 * guess would read exactly like a measurement in this column, which is the
 * design's non-goal — "where `transferBytes` is null, report it as unknown".
 */
const bytesArrived = (transferBytes: number | null): string =>
  transferBytes === null ? 'unknown' : String(transferBytes);

/** `label` and value, on the label column every image block shares. */
const field = (label: string, value: string): Line => say`  ${label.padEnd(10)}  ${value}`;

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * The `sizes` string this device resolved against, and the element it came off
 * where that was not the `<img>`.
 *
 * A `<picture>` can put the `sizes` string on the `<source>` whose `media`
 * matched, and then the attribute a reader finds on the tag is not the one the
 * browser read. Where it came off the tag — which is every image outside a
 * `<picture>`, and every one inside a `<picture>` whose matching source wrote
 * no `sizes` of its own — the tag is where a reader would look anyway, and the
 * line says nothing extra.
 *
 * `media` is the only thing a `<source>` is evaluated on. Its `type` is not
 * read, so nothing here can say a format decided anything, because none did.
 */
const offered = (image: CapturedImage): string => {
  const element = image.sizesSource === 'source' ? ' from a matching <source>' : '';
  return `${image.sizes ?? '(absent)'}${element}`;
};

/** One reading per sighting of one image, keyed by the device that took it. */
const readings = (
  sightings: Sighting[],
  of: (image: CapturedImage) => string,
): [device: string, value: string][] =>
  sightings.map(({ device, image }) => [device.name, of(image)]);

/** Every distinct value with the devices that measured it, in first-seen order. */
function grouped(measurements: [device: string, value: string][]): [string, string[]][] {
  const devicesByValue = new Map<string, string[]>();
  for (const [device, value] of measurements) {
    const measured = devicesByValue.get(value);
    if (measured) measured.push(device);
    else devicesByValue.set(value, [device]);
  }
  return [...devicesByValue];
}

/**
 * One value where every device agrees, or every value with the devices that
 * measured it.
 *
 * The devices usually agree, and five lines saying the same thing would bury
 * the images that do differ, so agreement stays one value and names no device.
 * Disagreement is the case that has to: a bare `12345, unknown` says two
 * things were measured and leaves a reader with no way to tell which device
 * measured which.
 */
function agreed(measurements: [device: string, value: string][]): string {
  const groups = grouped(measurements);
  return groups
    .map(([value, measured]) =>
      groups.length === 1 ? value : `${value} on ${measured.join(', ')}`,
    )
    .join(', ');
}

/**
 * One `label` line per distinct value, naming the devices where they differ.
 *
 * `<picture>` is why this is not one line. With a `<source>` in play, what an
 * image offered is not the same on every device: the candidates come off
 * whichever source matched, and a block that wrote them once would be writing
 * one device's markup over the others'. A list of candidates has commas in it,
 * so `agreed` cannot say this on one line — its own separator would disappear
 * into theirs.
 *
 * Where every device agrees, which is every page with no `<picture>` on it, it
 * is one line and names no device, exactly as it was.
 */
const fieldPerValue = (
  label: string,
  measurements: [device: string, value: string][],
): Line[] => {
  const groups = grouped(measurements);
  return groups.map(([value, measured]) =>
    field(label, groups.length === 1 ? value : `${value} on ${measured.join(', ')}`),
  );
};

/**
 * The same, for one figure per sighting of one image.
 *
 * This is what keeps the report per device for the image an image block cannot
 * table — nothing was selected, so there is no arithmetic to lay out.
 */
const perDevice = (sightings: Sighting[], of: (image: CapturedImage) => string): string =>
  agreed(readings(sightings, of));

/**
 * One device's line of the arithmetic, keyed by the column each value prints
 * under.
 *
 * The keys are the headings, so a row cannot line its values up against the
 * wrong columns and the compiler says so when one is missing.
 */
type Row = {
  device: string;
  viewport: string;
  DPR: string;
  'clause used': string;
  'css px': string;
  needed: string;
  picked: string;
  file: string;
  'bytes arrived': string;
};

/** The columns, left to right. */
const COLUMNS: (keyof Row)[] = [
  'device',
  'viewport',
  'DPR',
  'clause used',
  'css px',
  'needed',
  'picked',
  'file',
  'bytes arrived',
];

/**
 * One row per line, columns padded to the widest cell.
 *
 * Every column is left aligned, so a reader can run an eye straight down one
 * of them and every row breaks in the same place.
 */
function table(rows: Row[]): Line[] {
  // Measured after the escape, because the width a column is padded to has to
  // be the printed width: a control character is one character in the string
  // the page wrote and six in the string a terminal shows, so a column
  // measured before the escape is a column the next row does not line up
  // under — the one defect here a reader sees rather than obeys.
  //
  // Only the measuring happens here. Every cell reaches its line through an
  // interpolation, so `say` is what escapes the text, once, exactly as it does
  // for every other line — and the row is walked out of `COLUMNS`, so a tenth
  // column would be measured and written with the nine without a line of this
  // changing. The last cell takes no padding, which is what the trailing trim
  // used to do.
  const printed = (cell: string): number => escape(cell).length;
  const widths = COLUMNS.map((column) =>
    Math.max(printed(column), ...rows.map((row) => printed(row[column]))),
  );
  const line = (cells: string[]): Line =>
    say`${cells.flatMap((cell, i) =>
      i === cells.length - 1 ? [cell] : [cell, ' '.repeat(widths[i] - printed(cell) + 2)],
    )}`;
  return [line(COLUMNS), ...rows.map((row) => line(COLUMNS.map((column) => row[column])))];
}

/**
 * Explain every image on a page across every device, as arithmetic a reader
 * can check.
 *
 * An image gets one block: what it offered, and then one table row per device,
 * which is where the devices disagree. What it offered is usually one thing —
 * and where a `<picture>` put a different `<source>` in front of each device,
 * it is one line per distinct value, naming the devices. That way a page with
 * a dozen images stays a page you can scan, and the interesting column — the
 * file each device picked — reads straight down.
 */
export function formatCapture(capture: Capture): string {
  const groups = groupById(capture);
  const head = [
    say`url      ${capture.url}`,
    say`images   ${groups.length} on ${capture.devices.length} devices`,
    ...backgrounds(capture),
  ];
  const blocks = groups.flatMap(([id, sightings], index) => [
    say``,
    ...imageBlock(capture.url, capture.devices, id, sightings, index + 1, groups.length),
  ]);
  return [...head, ...blocks].join('\n');
}

/**
 * How many files this page's CSS painted, and why that is all there is to say
 * about them.
 *
 * A CSS background image has no selection mechanism at all: it reaches the
 * browser as a URL in a stylesheet, with no `srcset` beside it and no `sizes`
 * to resolve. There is nothing to select between, so there is no arithmetic to
 * table — which is exactly why the count has to be stated rather than left
 * out. A trace of every `<img>` on a page reads like a trace of every image on
 * it, and on a page that paints its hero in CSS it is not one.
 *
 * Per device, because the count is a property of a render: a media query can
 * paint a background at one viewport and not at the next. Where they agree,
 * `agreed` says so once.
 *
 * Nothing at all where nothing was painted. A line reading `0 background
 * images` on every page would bury the pages that have some.
 */
function backgrounds(capture: Capture): Line[] {
  if (capture.runs.every((run) => run.backgroundImageCount === 0)) return [];

  const counted: [string, string][] = [];
  for (const device of capture.devices) {
    // Device order, and a device that never rendered has nothing to report.
    // Every run's device is known by here: `groupById` has already refused a
    // capture whose run names one the capture does not describe.
    const run = capture.runs.find((one) => one.deviceId === device.id);
    if (run) counted.push([device.name, plural(run.backgroundImageCount, 'background image')]);
  }

  // The sentence is its own string because a Line cannot be concatenated —
  // that is the point of one — and it does not fit a template on one line.
  const explains =
    'A CSS background image has no selection mechanism at all, so imgwhy counts them and ' +
    'explains nothing further.';
  return [say`css      ${agreed(counted)}. ${explains}`];
}

/** Every image, keyed by the id that holds across runs, in first-seen order. */
function groupById(capture: Capture): [string, Sighting[]][] {
  const devices = new Map(capture.devices.map((device) => [device.id, device]));
  const byId = new Map<string, Sighting[]>();

  for (const run of capture.runs) {
    const device = devices.get(run.deviceId);
    if (!device) throw new Error(`the capture has a run for "${run.deviceId}" but no such device`);
    for (const image of run.images) {
      const sightings = byId.get(image.id);
      if (sightings) sightings.push({ device, image });
      else byId.set(image.id, [{ device, image }]);
    }
  }

  return [...byId];
}

function imageBlock(
  base: string,
  devices: DeviceProfile[],
  id: string,
  sightings: Sighting[],
  index: number,
  total: number,
): Line[] {
  const first = sightings[0];
  if (!first) throw new Error(`the capture groups image "${id}" with no sighting to explain`);
  const { candidates } = first.image;
  const lazy = sightings.some((s) => s.image.loading === 'lazy');
  const lines = [say`image ${index} of ${total}  ${id}${lazy ? '   loading=lazy' : ''}`];

  // Nothing to select means nothing to explain, and a table of five identical
  // rows would only bury the images that do choose. This is also what keeps a
  // 1×1 tracking pixel to one line: the runner records every image, and the
  // ones with no choice to make say so and stop.
  if (candidates.length < 2) {
    const files = perDevice(sightings, (image) => fileOf(image.currentSrc, base));
    const why = candidates.length === 0 ? 'no srcset' : 'one candidate only';
    lines.push(say`  ${why}, so nothing was selected — file  ${files}`);
    // Bytes still arrived for it, so they are still reported. A 1×1 tracking
    // pixel weighs what it weighs whether or not anything chose it.
    //
    // Per device, the way the file above is, and for the same reason: a lazy
    // image still in flight when one render finished loading reads as a size
    // on the devices that got it and unknown on the ones that did not, rather
    // than as two figures with nothing to attach either of them to.
    lines.push(field('bytes', perDevice(sightings, (image) => bytesArrived(image.transferBytes))));
    return lines;
  }

  // `w` and `x` descriptors are answered by different questions, and a page
  // may carry both. `sizes` only enters the `w` case; a browser reads past it
  // otherwise, however the tag was written.
  //
  // Asked of every sighting rather than of the first, because a `<picture>`
  // can put a `w` descriptor in front of one device and an `x` in front of
  // the next, and a line dropped on the strength of one render would be a
  // line dropped for all of them.
  const byWidth = sightings.some((s) => s.image.candidates.some((c) => c.w != null));
  const wrote = sightings.some((s) => s.image.sizes !== null);

  lines.push(
    ...fieldPerValue(
      'candidates',
      readings(sightings, (image) => image.candidates.map((c) => c.raw).join(', ')),
    ),
  );
  if (byWidth || wrote) {
    lines.push(...fieldPerValue('sizes', readings(sightings, offered)));
  }

  // A responsive layout can move an image, and then the id names where it sat
  // on some devices only. Say where it sat on the others.
  const moved = new Map<string, string[]>();
  for (const { device, image } of sightings) {
    if (image.selector === id) continue;
    const names = moved.get(image.selector);
    if (names) names.push(device.name);
    else moved.set(image.selector, [device.name]);
  }
  for (const [selector, names] of moved) {
    lines.push(field('also at', `${selector} on ${names.join(', ')}`));
  }

  const absent = devices.filter((d) => !sightings.some((s) => s.device.id === d.id));
  if (absent.length) lines.push(field('not on', absent.map((d) => d.name).join(', ')));

  lines.push(say``);
  lines.push(...table(sightings.map((s) => row(base, s))).map((l) => say`  ${l}`));
  return lines;
}

/**
 * The width column: a measurement, the word for a clause that would not read,
 * or nothing to say.
 *
 * One case per kind of Selection, so a fourth kind in core would fail to
 * compile here rather than print a blank cell.
 */
function cssPxCell(selection: Selection): string {
  switch (selection.kind) {
    case 'density':
      return '—';
    case 'unreadable':
      return 'unreadable';
    case 'width':
      return `${Math.round(selection.cssPx)}px`;
  }
}

/**
 * One device's arithmetic, as columns.
 *
 * The arithmetic itself is `explainSelection` in core, not this function. A
 * `density` selection is core saying `sizes` never entered — nothing carries a
 * `w` descriptor — which is the case this table has three columns with nothing
 * to put in them.
 */
function row(base: string, { device, image }: Sighting): Row {
  const selection = explainSelection(image, device);
  return {
    device: device.name,
    viewport: `${device.viewport.width}×${device.viewport.height}`,
    DPR: String(device.dpr),
    'clause used':
      selection.kind === 'density' ? 'x descriptors only' : selection.resolution.clause,
    'css px': cssPxCell(selection),
    needed: selection.kind === 'width' ? `${Math.round(selection.neededPx)}px` : '—',
    ...chosen(base, image, selection.picked),
  };
}

/**
 * The picked descriptor, the file the browser went and got — which should
 * agree — and what that file cost on the wire.
 */
function chosen(
  base: string,
  image: CapturedImage,
  picked: Candidate | null,
): Pick<Row, 'picked' | 'file' | 'bytes arrived'> {
  const file = image.currentSrc ? fileOf(image.currentSrc, base) : '(none)';
  // The cache is disabled for every render, so a disagreement is not a held
  // copy standing in. It is the prediction to question.
  const differs =
    picked !== null && image.currentSrc !== '' && absolute(picked.url, base) !== image.currentSrc;
  return {
    picked: picked ? picked.raw : '—',
    file: differs ? `${file} ← differs` : file,
    'bytes arrived': bytesArrived(image.transferBytes),
  };
}
