import type { Candidate, CapturedImage, DeviceProfile, Selection } from '@imgwhy/core';
import { explainSelection, parseSrcset } from '@imgwhy/core';
import type { RawImage, Reading } from './read.js';

/**
 * The arithmetic, asked of core in the service worker.
 *
 * This is the half of the extension that is a normal module. It imports
 * `@imgwhy/core` with a real `import` and calls it, which is only possible
 * here: `chrome.scripting.executeScript` sends `String(func)` rather than the
 * function, so anything injected into the page arrives with no imports and no
 * module around it. Putting the arithmetic in the page would mean shipping
 * core as text or bundling it in; putting it here means a plain call, and the
 * only thing that crosses into the page is data.
 *
 * Which is the design's load-bearing decision, applied:
 *
 * > A measured result and a hypothetical result use the same call. The CLI
 * > passes numbers it recorded. The report passes numbers you typed into a
 * > control. The extension passes numbers it read from the live DOM. None of
 * > them reimplements the algorithm, so none of them can disagree with the
 * > others.
 *
 * So nothing below decides anything. `explainSelection` is the whole of the
 * decision and this module is the wording around it — which is why
 * `through-core.test.ts` refuses a multiplication or a division anywhere in
 * this package: a density is a division and physical pixels are a
 * multiplication, and neither has any other use in a package that reads a DOM
 * and lays out text.
 *
 * The vocabulary is the command line's wherever the command line has a word
 * for the same thing. `clause used`, `css px`, `needed`, `picked` and
 * `unknown` all come out of `cli/src/trace.ts`, because a figure that reads
 * differently in two front ends is a figure a reader will assume was computed
 * differently.
 */

/**
 * One field of one row: a label, its value, and whether a held copy could
 * explain the value.
 *
 * `held` is the design's requirement carried in the data rather than left to
 * the renderer:
 *
 * > The extension explains and predicts. It cannot measure […]. The interface
 * > must say so wherever it shows a number that the cache could have
 * > contaminated.
 *
 * A flag rather than a sentence per line, because the sentence is the same
 * sentence every time and the panel says it once in the footer. What the flag
 * has to be is per figure, so that a reader can see which figures it covers
 * without reading the footer first.
 */
export type Line = { label: string; value: string; held: boolean };

/**
 * One file this image involved, named by its whole URL.
 *
 * Whole and uncut, which is the difference between this and the `picked` and
 * `loaded` lines above it. Those are one line of a grid and have to fit on one,
 * so `fileOf` shortens them — and a shortened URL is a URL two files can share.
 * The issue puts it as a criterion: two images whose URLs differ only by
 * directory must be distinguishable, and the only reading that always is, is
 * the whole string. So the row carries both: a line a reader compares at a
 * glance, and the address underneath it that settles an argument.
 *
 * Absolute, because a candidate is written relative and `currentSrc` is not,
 * and two URLs a reader is meant to compare have to be the same kind of thing.
 */
export type Source = { label: string; url: string };

/**
 * One image, said.
 *
 * The order of the fields is the order the panel reads them: what this image is
 * (`at`, `name`, `alt`, `file`), the one line that says what happened (`gist`,
 * `mark`), and then the arithmetic a reader opens (`lines`, `sources`,
 * `notes`).
 *
 * That split is the issue's, and it is a split of one flat list into a
 * headline and a detail. Twenty-three images on a photo page produced
 * twenty-three blocks of eight figures and four paragraphs of prose, which is
 * a panel taller than any screen and a reader who can see one row of it. So
 * every row now says who it is and what happened in two short lines, and holds
 * the rest until it is asked. Nothing was cut: `lines`, `sources` and `notes`
 * are the whole of what was standing in the row before.
 */
export type Row = {
  /**
   * Where this image sits in `document.images`, which is how the panel finds
   * the element to mark. `read.ts` says why it is an index and what it costs.
   */
  at: number;
  /** The headline: which file this row is about, short enough to scan. */
  name: string;
  /** What the thumbnail says where it has nothing to show. */
  alt: string;
  /**
   * The whole URL of the file the browser loaded, or the empty string where it
   * loaded none. This is the one value in the panel that becomes a request:
   * `renderPanel` assigns it to the thumbnail's `src`, whole and untouched,
   * and `privacy.test.ts` holds that it is never anything else.
   */
  file: string;
  /** The one line under the name: what was picked, and what loaded. */
  gist: string;
  /** What the cache mark means on this row, said where the mark is. */
  mark: string;
  lines: Line[];
  sources: Source[];
  /** Prose the arithmetic needs, shown where a reader opens the row. */
  notes: string[];
};

/**
 * The whole panel as plain data, which is what crosses into the page.
 *
 * Strings and booleans and nothing else. `executeScript` serialises its `args`,
 * so a function, an element or a class instance in here would arrive as
 * nothing — and a renderer that took a `Selection` would be a renderer asking
 * core questions in a place core cannot go.
 */
export type Panel = { head: string; rows: Row[]; footer: string[] };

/** The word for a figure nothing measured. Never a guess in its place. */
const UNKNOWN = 'unknown';

/**
 * What the footer says about the two things the extension cannot do.
 *
 * Both sentences are the design's, and both are requirements rather than
 * footnotes. The first is the cache: a browser holding a larger variant
 * reuses it, selection never runs, and no reading of the page can tell that
 * apart from a selection that ran and chose the same file. The second is the
 * weight: `PerformanceResourceTiming.transferSize` reads zero for a
 * cross-origin response without `Timing-Allow-Origin`, which most image CDNs
 * do not send, so a figure taken from it would read like a measurement and be
 * a statement about nothing. Unknown is the honest answer, and the command
 * line is where a measured one comes from.
 *
 * A function rather than a constant, and that is not a style choice.
 * `dormant.test.ts` asks that every module the worker imports have a top level
 * that does nothing when it loads, and a concatenation of two long strings is
 * something — small, and the small ones are the dangerous kind, so the check
 * refuses all of them rather than judging. Building the list on the one call
 * that reads it costs a click nothing.
 */
const footerOf = (): string[] => [
  'A marked figure is what the browser has, not what it chose. A browser holding a larger ' +
    'variant reuses it and selection never runs, so nothing marked can be read as the outcome ' +
    'of the arithmetic above.',
  'bytes is unknown here and stays unknown. transferSize reads zero for a cross-origin ' +
    'response without Timing-Allow-Origin, so a page cannot weigh most of the images on it — ' +
    'and imgwhy never guesses a weight from pixels. Run the command line for measured bytes.',
];

/** The sentence a disagreement between the prediction and the page needs. */
const disagrees = (): string =>
  'picked and loaded disagree. A browser holding a larger variant reuses it and never runs ' +
  'selection at all, so a disagreement here is not necessarily a bug — it is the first thing ' +
  'to rule out. An empty cache is the only way to tell.';

/**
 * The sentence an `auto` width needs, which is the mark's meaning spelled out
 * for the one case where a marked figure is not a file.
 *
 * `sizes: auto` defers to layout, so core answers with the width the element
 * ended up at — and for an image the page gives no width of its own, the width
 * it ended up at is the width of whichever file the browser already held. Every
 * figure below it descends from that: `needed` is the width times the ratio and
 * `picked` is selection run against `needed`, so a prediction that agrees with
 * the loaded file may agree because one produced the other. Cache-cold, the
 * same page lays the image out at nothing and picks nothing.
 *
 * The mark alone would not say this. The footer says a marked figure is what
 * the browser has rather than what it chose, which reads correctly of a file
 * and not of a width — so the mark says which figures are affected and this
 * says how a width came to be one of them.
 */
const circular = (): string =>
  'sizes resolved to auto, so the width above is the width this render laid the image out at — ' +
  'and for an image the page gives no width of its own, that is the width of whichever file the ' +
  'browser already held. Every marked figure descends from it, so a prediction that agrees with ' +
  'the loaded file may agree because one produced the other. An empty cache is the only way to ' +
  'tell.';

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

const absolute = (url: string, base: string): string => {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
};

/**
 * How much of a URL fits on one line of the panel's grid.
 *
 * A shortened URL is a URL two files can share, which is why every row also
 * carries its `sources` — the whole address, uncut, under the arithmetic. This
 * figure is about a line a reader compares at a glance and nothing more.
 */
const WIDTH = 56;

/**
 * One string, cut to `WIDTH` from whichever end can be spared, with a `…`
 * wherever it was cut.
 *
 * The ellipsis is the whole point of having this rather than a bare `slice`. A
 * line the panel shortened and a line that was that short to begin with have to
 * read differently, or two candidates that differ only in the part the panel
 * dropped read as one file.
 */
const cut = (text: string, keep: 'head' | 'tail'): string =>
  text.length <= WIDTH
    ? text
    : keep === 'head'
      ? `${text.slice(0, WIDTH - 1)}…`
      : `…${text.slice(1 - WIDTH)}`;

/** The page's own origin, or nothing where its base is not a URL at all. */
const originOf = (base: string): string => {
  try {
    return new URL(base).origin;
  } catch {
    return '';
  }
};

/**
 * One URL as a line that tells two candidates apart at a glance.
 *
 * Everything the URL does not already share with the page: the path and the
 * query always, and the host as well where the file came from somewhere else.
 * Which is what makes the line distinguishing rather than decorative — a last
 * path segment alone renders `/a/1.png` and `/b/1.png` identically, and on the
 * row whose own note says `picked` and `loaded` disagree that reads as
 * nonsense. Within one page's base this mapping is one-to-one: a same-origin
 * URL renders its path, which opens with a slash, and a cross-origin one opens
 * with a host, which does not.
 *
 * Two ends, because the two kinds of URL keep what matters at opposite ones. A
 * path holds its file name last, so a long one is cut from the front. A scheme
 * that carries its own content holds the part a reader needs first — that it is
 * a `data:` or a `javascript:` URL at all — so those are cut from the back.
 * Which is also the answer to a URL whose path is not a path: the last segment
 * of `data:text/html,<p>…` is an arbitrary tail of the page's own text, and a
 * path always opens with a slash, so the slash is what says whether there is a
 * file name in there to take.
 */
const fileOf = (url: string, base: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return cut(url, 'tail');
  }

  if (!parsed.pathname.startsWith('/')) return cut(parsed.href, 'head');

  const elsewhere = parsed.origin === originOf(base) ? '' : parsed.host;
  return cut(`${elsewhere}${parsed.pathname}${parsed.search}`, 'tail');
};

/**
 * The browser the page is being looked at in, as a device profile.
 *
 * One profile rather than the command's five, because there is one browser and
 * it is the one in front of you. That is the whole difference between the two
 * front ends: the command renders a page as five devices and measures each,
 * and this explains the render you already have.
 */
const deviceOf = (reading: Reading): DeviceProfile => ({
  id: 'live',
  name: 'this browser',
  viewport: reading.viewport,
  dpr: reading.dpr,
});

/**
 * One reading of one image, in the shape core takes.
 *
 * Two fields are filled in rather than read, and both for a reason worth
 * writing down. `transferBytes` is null because a page cannot measure one —
 * null is core's own word for unknown, so the honest value is the value the
 * type already has for it. `naturalWidth` is zero because the extension does
 * not read a pixel dimension the arithmetic has no use for: `explainSelection`
 * reads `candidates`, `sizes` and `renderedWidth` and nothing else, and a
 * dimension is the one ingredient a guessed weight takes. `non-goals.test.ts`
 * refuses a read of one.
 */
const captured = (raw: RawImage): CapturedImage => ({
  id: raw.selector,
  selector: raw.selector,
  candidates: parseSrcset(raw.srcset),
  sizes: raw.sizes,
  sizesSource: raw.sizesSource,
  renderedWidth: raw.renderedWidth,
  currentSrc: raw.currentSrc,
  naturalWidth: 0,
  transferBytes: null,
  loading: raw.loading,
});

/**
 * The `sizes` string this browser resolved against, and the element it came
 * off where that was not the `<img>`.
 *
 * A `<picture>` can put the string on the `<source>` whose `media` matched,
 * and then the attribute a reader finds on the tag is not the one the browser
 * read. Where it came off the tag the tag is where a reader would look anyway,
 * and the line says nothing extra.
 */
const offered = (image: CapturedImage): string => {
  const element = image.sizesSource === 'source' ? ' from a matching <source>' : '';
  return `${image.sizes ?? '(absent)'}${element}`;
};

/**
 * The width column: a measurement, the word for a clause that would not read,
 * or nothing to say.
 *
 * One case per kind of Selection, so a fourth kind in core would fail to
 * compile here rather than leave a blank line in the panel.
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

/** The descriptor a browser picks, and the file that descriptor names. */
const picked = (candidate: Candidate | null, base: string): string =>
  candidate === null ? '—' : `${candidate.raw}  ${fileOf(candidate.url, base)}`;

/**
 * What the page wrote in `alt`, or the word for it having written none.
 *
 * Three answers, because the attribute has three states and two of them are
 * not the same finding. No attribute is a page that said nothing. `alt=""` is
 * a page that said this image carries no meaning of its own, which is correct
 * for a spacer and a bug on a hero — so the panel says which it is rather than
 * rendering both as an absence.
 */
const altSaid = (alt: string | null): string =>
  alt === null
    ? '(no alt attribute)'
    : alt === ''
      ? '(empty, so the page calls it decorative)'
      : alt;

/**
 * What the thumbnail's own `alt` says.
 *
 * Which is what a reader sees in the thumbnail's place whenever the file will
 * not draw — an image that has loaded nothing yet, a URL that 404s, a
 * `currentSrc` that is not an image at all. A broken-image glyph with no words
 * beside it says only that something failed; these say which image failed and
 * what the page called it.
 *
 * The page's own `alt` first, because it is the one description written by
 * somebody who could see the image. The file name where the page wrote none,
 * because a name is still an identification. And where nothing loaded there is
 * no file to describe, so it says that instead.
 */
const altFor = (raw: RawImage, name: string): string =>
  raw.currentSrc === ''
    ? 'nothing loaded'
    : raw.alt === null || raw.alt === ''
      ? name
      : raw.alt;

/**
 * What the cache mark means, said where the mark is rather than in a
 * paragraph under it.
 *
 * The footer still carries the argument in full. This is the short form, and
 * it exists because the mark and its meaning had drifted a whole panel apart:
 * a reader met a `cache` chip on a figure and had to scroll past every row to
 * find out what it claimed. A phrase on the chip closes that, and the row's
 * own note carries the same reasoning in a form a keyboard reaches — a
 * tooltip is a hover affordance and cannot be the only copy.
 */
const markOf = (laidOut: boolean): string =>
  laidOut
    ? 'what the browser has, not what it chose — and the width above descends from it'
    : 'what the browser has, not what it chose';

/**
 * One image's row.
 *
 * Two shapes, and the split is the same one `trace.ts` makes. An image with
 * fewer than two candidates had nothing to select between, so it says which of
 * the two reasons that was and stops — eight lines of dashes would only bury
 * the images that do choose, and this is also what keeps a 1×1 tracking pixel
 * to one line.
 */
function rowOf(raw: RawImage, device: DeviceProfile): Row {
  const image = captured(raw);
  const base = raw.baseURI;

  // The headline, and the whole reason this slice exists. It used to be the DOM
  // path — `html > body > div:nth-of-type(2) > main > … > img` — which names
  // the one thing about an image nobody recognises it by, and which on a real
  // page wraps across two lines and pushes everything else off the panel. The
  // file the browser loaded is what a reader is looking for, so that is what
  // the row is called; the path is a line in the detail below, where it is
  // still selectable and still pasteable into DevTools.
  const name = image.currentSrc === '' ? '(nothing loaded)' : fileOf(image.currentSrc, base);

  // Marked on every row, held copy or not, and that is deliberate. The mark is
  // not a warning about this image: it says what the figure is. `currentSrc` is
  // what the browser has, and a browser that had a larger variant already never
  // ran selection at all — there is no reading of the page that tells the two
  // apart, so the mark cannot be conditional on anything.
  const loaded: Line = {
    label: 'loaded',
    value: image.currentSrc === '' ? '(none)' : fileOf(image.currentSrc, base),
    held: true,
  };
  const bytes: Line = { label: 'bytes', value: UNKNOWN, held: false };

  // Who this image is, above what happened to it. Three facts a reader uses to
  // recognise an image and none of which the arithmetic needs: what the page
  // called it, the shape this render drew it at, and where it sat.
  const box = `${Math.round(raw.renderedWidth)}×${Math.round(raw.renderedHeight)}`;
  const identity: Line[] = [
    { label: 'alt', value: altSaid(raw.alt), held: false },
    {
      label: 'rendered box',
      value:
        raw.renderedWidth === 0 && raw.renderedHeight === 0
          ? `${box}, so this render drew no box at all`
          : box,
      held: false,
    },
    ...(raw.loading === null ? [] : [{ label: 'loading', value: raw.loading, held: false }]),
    { label: 'selector', value: raw.selector, held: false },
  ];

  // Every file this row involves, whole. The loaded one first, because it is
  // the one a reader came to check, then every candidate in the order the page
  // offered them. Absolute, so a relative candidate and an absolute
  // `currentSrc` can be read against each other at all.
  const sources: Source[] = [
    ...(image.currentSrc === '' ? [] : [{ label: 'loaded', url: image.currentSrc }]),
    ...image.candidates.map((candidate) => ({
      label: candidate.raw,
      url: absolute(candidate.url, base),
    })),
  ];

  const carried = { at: raw.at, name, alt: altFor(raw, name), file: image.currentSrc, sources };

  if (image.candidates.length < 2) {
    const nothing = image.candidates.length === 0;
    const why = nothing
      ? 'no srcset, so nothing was selected'
      : 'one candidate only, so selection is a formality';
    return {
      ...carried,
      gist:
        `${nothing ? 'no srcset' : 'one candidate only'}, ` +
        `${image.currentSrc === '' ? 'nothing loaded yet' : 'one file loaded'}`,
      mark: markOf(false),
      lines: [...identity, { label: 'selection', value: why, held: false }, loaded, bytes],
      notes: [],
    };
  }

  const selection = explainSelection(image, device);

  // `sizes` enters the `w` case alone; a browser reads past it otherwise,
  // however the tag was written. The line is still written where the page wrote
  // the attribute, because a reader who can see it in DevTools would otherwise
  // get no answer about it at all — and `clause used` says it was read past.
  const wrote = selection.kind !== 'density' || image.sizes !== null;

  // A relative candidate URL and an absolute `currentSrc` are the same file,
  // so both are resolved before they are compared. An image that has loaded
  // nothing yet — a lazy one below the fold — disagrees with nothing.
  const prediction = selection.picked;
  const differs =
    prediction !== null &&
    image.currentSrc !== '' &&
    absolute(prediction.url, base) !== image.currentSrc;

  // Where a clause resolved to `auto`, the three figures below it are marked
  // and `circular` says why: the width is the width this render laid the image
  // out at, and for an image the page gives no width of its own that is the
  // width of the file the browser already held.
  //
  // Marked whenever the resolution is `auto` rather than only where the width
  // came from the file, and that is deliberate rather than approximate. An
  // `auto` image the page *does* give a CSS width has a `css px` no cache could
  // have touched — but this package reads a laid-out box and not a cascade, so
  // there is no reading of the page that tells the two apart. It is the
  // argument the `loaded` line already makes, applied where it applies again:
  // the mark says what a figure is, so it cannot be conditional on something
  // nothing here can see. The alternative is a figure that is sometimes
  // contaminated and never says so, which is criterion 2 unmet.
  const laidOut = selection.kind === 'width' && selection.resolution.kind === 'auto';

  return {
    ...carried,
    // The one line a reader reads while scanning: what the arithmetic chose,
    // and whether the page agrees with it. `loaded a different file` is the
    // only alarm in the panel, and it is the sentence the whole tool exists to
    // put in front of somebody.
    gist:
      `picked ${prediction === null ? 'nothing' : prediction.raw}, ` +
      `${
        image.currentSrc === ''
          ? 'nothing loaded yet'
          : differs
            ? 'loaded a different file'
            : 'and that is what loaded'
      }`,
    mark: markOf(laidOut),
    lines: [
      ...identity,
      {
        label: 'candidates',
        value: image.candidates.map((candidate) => candidate.raw).join(', '),
        held: false,
      },
      ...(wrote ? [{ label: 'sizes', value: offered(image), held: false }] : []),
      {
        label: 'clause used',
        value: selection.kind === 'density' ? 'x descriptors only' : selection.resolution.clause,
        held: false,
      },
      { label: 'css px', value: cssPxCell(selection), held: laidOut },
      {
        label: 'needed',
        value: selection.kind === 'width' ? `${Math.round(selection.neededPx)}px` : '—',
        held: laidOut,
      },
      { label: 'picked', value: picked(prediction, base), held: laidOut },
      loaded,
      bytes,
    ],
    // The circularity first, because it qualifies the arithmetic a
    // disagreement would be read against.
    notes: [...(laidOut ? [circular()] : []), ...(differs ? [disagrees()] : [])],
  };
}

/**
 * Explain every image on the page in front of you, as arithmetic a reader can
 * check.
 *
 * A pure function of a reading, which is what makes the panel testable without
 * a browser: the page produces plain data, this turns it into plain data, and
 * the renderer puts that data in nodes. The design asks for exactly that —
 * "test the logic through `core`. Keep the panel thin enough that it needs no
 * browser test."
 */
export function panelOf(reading: Reading): Panel {
  const device = deviceOf(reading);

  // Nothing at all where nothing was painted. A line reading `0 background
  // images` on every page would bury the pages that have some.
  const backgrounds =
    reading.backgroundImageCount === 0
      ? []
      : [
          `${plural(reading.backgroundImageCount, 'element')} on this page ` +
            `${reading.backgroundImageCount === 1 ? 'paints' : 'paint'} a CSS background image. ` +
            'A CSS background image has no selection mechanism at all, so imgwhy counts them ' +
            'and explains nothing further.',
        ];

  return {
    head:
      `viewport ${reading.viewport.width}×${reading.viewport.height} · ` +
      `DPR ${reading.dpr} · ${plural(reading.images.length, 'image')}`,
    rows: reading.images.map((raw) => rowOf(raw, device)),
    footer: [...footerOf(), ...backgrounds],
  };
}
