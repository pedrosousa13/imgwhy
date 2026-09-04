import type { Candidate, CapturedImage, DeviceProfile, Resolution, Selection } from '@imgwhy/core';
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
 * So nothing below decides anything about selection. `explainSelection` is the
 * whole of the decision and this module is the wording around it — which is
 * why `through-core.test.ts` refuses a multiplication or a division anywhere in
 * this package: a density is a division and physical pixels are a
 * multiplication, and neither has any other use in a package that reads a DOM
 * and lays out text. The one thing this module does decide is the verdict, and
 * it decides that by comparison alone: whether the file that loaded is the file
 * core picked, and whether the pick covers the pixels core says are needed.
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
 * How a verdict reads before its word is read.
 *
 * Three tones for eight words, because the words say what happened and the tone
 * says whether that is a problem. `good` is the file that should have loaded,
 * and it is quiet on purpose: the panel exists to find the rows that are not.
 * `warn` is bytes wasted or pixels stretched, and every one of them carries a
 * clause saying what to do about it, one opening down, because a warning with
 * no action is noise. `quiet` is a row that is not a finding against the page —
 * either the device had no say in it, or the panel cannot say. The second half
 * of that is deliberate and it is the only honest place for those rows: a
 * reading the panel cannot stand behind must not wear the tone that means
 * "this one is fine".
 *
 * A closed set of three words the extension owns, and the one property the
 * renderer writes as a class. No page string can reach it.
 *
 * The tone is also the order. It is what puts the warnings at the top of the
 * list and counts them first in the head, so "worst first" is decided in one
 * place and both halves of the panel agree about what it means.
 */
export type Tone = 'good' | 'warn' | 'quiet';

/**
 * What the browser did, in one word a reader takes in before any other.
 *
 * The maintainer's question, verbatim: "at a glance, I need to know if it's
 * correct or not." So the row leads with a word that answers it, and the word
 * is derived by comparison from core's `Selection` and the file that loaded —
 * no arithmetic, only `===`, `<` and `>=` on descriptors and on the pixel
 * figures core already worked out.
 *
 * - `fit` — the loaded file is the one the arithmetic picks, and it covers the
 *   pixels needed. A second file at the same descriptor counts as the pick,
 *   because two candidates at one descriptor are the same pixels either way.
 * - `oversized` — the loaded file is a larger candidate than the pick. Wasted
 *   bytes; a held copy the browser reused is the likeliest cause.
 * - `undersized` — the loaded file does not cover the pixels needed, so the
 *   image is upscaled wherever the page draws it at that size. Either no
 *   candidate covers them and the largest stood in, or the browser loaded
 *   something smaller than the pick.
 * - `no choice` — one candidate, no `srcset`, or every candidate naming one
 *   file. The device made no difference.
 * - `can’t tell` — the pick agrees with the loaded file, and the width the pick
 *   was made against came from layout. So the loaded file may have produced the
 *   figure that confirms it, and the agreement is not evidence.
 * - `no width` — `sizes` resolved to nothing at all, so there was no width to
 *   select against. An image this render drew no box for, most often.
 * - `not loaded` — nothing has loaded yet, so there is no file to judge. A lazy
 *   image below the fold, most often.
 * - `unknown` — the comparison cannot settle it: nothing was picked because a
 *   `sizes` clause would not read, or the loaded file is not one the `srcset`
 *   offers. Unknown is the honest word, and the clause says which it was.
 *
 * The brief named four. `not loaded` and `unknown` are here because the four do
 * not cover a lazy image or a broken `sizes`, and `can’t tell` and `no width`
 * because they do not cover a reading that confirms itself or an element with
 * no box — and forcing any of the four into a category it does not belong to
 * would be a verdict that lies at a glance.
 *
 * Every one of the eight is plain English, and that is a requirement rather
 * than a preference. `can’t tell` was `circular` for one slice, which is exact
 * jargon for an honest idea — and the maintainer read the panel and asked what
 * the tag meant, which is the whole argument against it: a verdict has one job,
 * to be understood without being looked up, and a word a reader has to go and
 * learn buys nothing at a glance. So the word names the consequence and the
 * mechanism moved to the note the row already carried, where a reader who wants
 * it is already asking. The apostrophe is the typographic one, because the panel
 * writes `×`, `—` and `…` and this is copy rather than a token.
 *
 * What `oversized` deliberately does not mean, because the review of #24 asked:
 * the page having asked for more than it needed. `sizes="100px"` against 640w
 * and 1080w is a 6.4× oversupply and still reads `fit`, and that is correct —
 * 640w genuinely is the smallest candidate covering 100 px, so the browser did
 * exactly the right thing and the waste is the page's. Saying so needs the
 * ratio of what arrived to what was needed, which is a division, and the
 * arithmetic is core's. So every verdict here is a verdict on the browser's
 * choice, and page-side oversupply is a claim this package does not make.
 */
export type Verdict = { word: string; tone: Tone };

/**
 * One image, said.
 *
 * The order of the fields is the order the panel reads them, and the three
 * levels the issue asks for. First what a reader sees without opening
 * anything: the verdict, the descriptor of the file that loaded, the name of
 * that file, and one short clause that says why. Then `notes` and `steps`, the
 * reasoning and the arithmetic, opened once. Then `details`, the whole URLs and
 * where the image sat, opened again.
 *
 * The headline is the descriptor and not the file name, and that is the
 * maintainer's own words: "need to know the size that loaded like was it
 * 640vw? which one? simple stuff." The `srcset` token is the answer to that
 * question; the file name is how a reader confirms which image it was.
 */
export type Row = {
  /**
   * Where this image sits in `document.images`, which is how the panel finds
   * the element to mark. `read.ts` says why it is an index and what it costs.
   */
  at: number;
  verdict: Verdict;
  /**
   * The `srcset` descriptor of the file that loaded — `640w`, `2x` — which is
   * the headline of the row. `src` where the file came from the `src`
   * attribute rather than a candidate, and `—` where nothing has loaded.
   */
  loaded: string;
  /** The file-name segment of the loaded URL, beside the headline and smaller. */
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
  /**
   * The rendered size, where the image is too small for a thumbnail to show
   * anything and the panel says the size in its place. Null where a thumbnail
   * is drawn.
   */
  tiny: string | null;
  /**
   * The one short clause a collapsed row says: what the arithmetic asked for,
   * and which file answers it.
   *
   * One clause and no caveat, which is a change of shape rather than of
   * wording. This was the answer followed by three hedges in one paragraph —
   * about sixty words over seven lines on the row that needed them most — so
   * three rows filled the panel and a reader met the hedge before the fact. The
   * hedges are in `notes` now, behind the disclosure the row already had, and
   * `why` is what a scan reads.
   *
   * The reader's device is named in `notes` and not here. Both figures are
   * stated in the head as the inputs they are, and a row that repeated them was
   * answering a question a reader can see the answer to — twenty-three times,
   * three lines at a time.
   */
  why: string;
  /**
   * What the cache mark means on this row, said where the mark is. Null where
   * the row carries no mark, which is most rows: `markFor` is the rule, and it
   * puts the word where a held copy would change the conclusion rather than on
   * every row a file loaded.
   */
  mark: string | null;
  /** The arithmetic as steps, opened once. */
  steps: Line[];
  /** Every file whole, and where the image sat, opened again. */
  details: Line[];
  /**
   * The reasoning, shown with the steps: the causal chain from the reader's
   * device through `sizes` to the pixels needed, the cause named as a
   * likelihood where the panel cannot know it, the cure, and the argument
   * against trusting a width that came from layout.
   *
   * Every sentence here is a sentence the collapsed row used to say. Moved
   * rather than rewritten, and moved rather than dropped: the reader who
   * opened a row asked for exactly this, and a reader scanning twenty-three
   * rows did not.
   */
  notes: string[];
};

/**
 * The two inputs every row's reasoning names, and what the page's images
 * amount to.
 *
 * Separate fields rather than one line, because the viewport width and the
 * ratio are the two numbers that explain every row below them, and the panel
 * lays them out as inputs rather than as a line of metadata.
 */
export type Head = {
  width: string;
  dpr: string;
  /**
   * How many images, and how many of each verdict — `23 images · 1 oversized ·
   * 3 can’t tell · 19 fit`.
   *
   * The glance-level answer for a whole page, which is the thing a reader of
   * twenty-three rows wanted and `23 images` did not say: how much there is to
   * read, and nothing about what it says. The counts partition the page, so the
   * line is an answer rather than a highlight reel.
   */
  counts: string;
};

/**
 * The whole panel as plain data, which is what crosses into the page.
 *
 * Strings and booleans and nothing else. `executeScript` serialises its `args`,
 * so a function, an element or a class instance in here would arrive as
 * nothing — and a renderer that took a `Selection` would be a renderer asking
 * core questions in a place core cannot go.
 */
export type Panel = { head: Head; rows: Row[]; footer: string[] };

/** The word for a figure nothing measured. Never a guess in its place. */
const UNKNOWN = 'unknown';

const FIT: Verdict = { word: 'fit', tone: 'good' };
const OVERSIZED: Verdict = { word: 'oversized', tone: 'warn' };
const UNDERSIZED: Verdict = { word: 'undersized', tone: 'warn' };
const NO_CHOICE: Verdict = { word: 'no choice', tone: 'quiet' };
const CANT_TELL: Verdict = { word: 'can’t tell', tone: 'quiet' };
const NO_WIDTH: Verdict = { word: 'no width', tone: 'quiet' };
const NOT_LOADED: Verdict = { word: 'not loaded', tone: 'quiet' };
// A literal rather than `UNKNOWN`, because `dormant.test.ts` reads a constant
// initialised from another name as something that runs at load, and the word
// is the same word either way.
const UNSETTLED: Verdict = { word: 'unknown', tone: 'quiet' };

/**
 * Every verdict there is, worst first.
 *
 * The order the header's counts read in, and it is the same order on every
 * page: a line whose words moved about with the page would be a line a reader
 * has to read rather than recognise. Warnings, then the rows the panel cannot
 * stand behind, then the ones that are fine — which is the tone order the list
 * offers as "warnings first", so the header and the list agree.
 *
 * A function rather than a constant, and for the reason `footerOf` is one:
 * `dormant.test.ts` reads a top-level array built out of other names as
 * something that runs when the worker loads, and it is right to. Building the
 * list on the one call that reads it costs a click nothing.
 *
 * A written list rather than a walk over the rows, so a verdict left out of it
 * is a page the header under-reports. `explain.test.ts` sums the counts against
 * the number of rows, which is what fails when the ninth verdict arrives
 * without being added here.
 */
const everyVerdict = (): Verdict[] => [
  OVERSIZED,
  UNDERSIZED,
  CANT_TELL,
  NO_WIDTH,
  NOT_LOADED,
  UNSETTLED,
  NO_CHOICE,
  FIT,
];

/**
 * How many images got each verdict, worst first, with the ones no image got
 * left out.
 *
 * A count is a length and nothing else, which is what makes this arithmetic the
 * extension is allowed: `through-core.test.ts` refuses a multiplication and a
 * division because those two lines are the selection algorithm, and the number
 * of items in a list is neither.
 *
 * Verdicts no image on the page got are dropped rather than shown at zero. A
 * page of twenty-three photographs would otherwise carry five zeroes in the one
 * line a reader is meant to take in without reading.
 */
const tally = (rows: Row[]): string[] =>
  everyVerdict()
    .map((verdict) => ({
      word: verdict.word,
      count: rows.filter((row) => row.verdict.word === verdict.word).length,
    }))
    .filter((one) => one.count > 0)
    .map((one) => `${one.count} ${one.word}`);

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

/** One sentence's first letter, where a clause built to follow a dash opens it. */
const capital = (text: string): string => `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;

/**
 * How much of a name fits beside the headline.
 *
 * A shortened name is a name two files can share, which is why every row also
 * carries its whole URLs in `details`. This figure is about the token a
 * reader glances at and nothing more.
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

/**
 * The segment of a URL that looks like a file name, which is what a reader
 * recognises a file by.
 *
 * The last path segment is the wrong rule, and a Storyblok URL is why:
 * `…/f31865bb07/card-1.webp/m/640x506/filters:quality(70)` ends in a filter
 * and puts the file name three segments in. So the rule is the last segment
 * that carries an extension — a dot followed by one to five letters or digits
 * at its end — which is `card-1.webp` there and `640.png` on a plain path.
 * Where no segment does, the last one stands in, and where there is no path
 * at all the host does. A resizing CDN that puts the width in the query
 * renders every candidate as one name here, and that is accepted: the
 * headline beside this is the descriptor, and the whole URL is two openings
 * away.
 *
 * A URL whose path is not a path — `data:`, `javascript:` — has no file name
 * to take, and the scheme is the part a reader can act on, so it is cut from
 * the back instead. A path always opens with a slash, which is what tells the
 * two apart.
 */
const nameOf = (url: string, base: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return cut(url, 'tail');
  }

  if (!parsed.pathname.startsWith('/')) return cut(parsed.href, 'head');

  const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
  const named = segments.filter((segment) => /\.[a-z0-9]{1,5}$/i.test(segment));
  const last = named[named.length - 1] ?? segments[segments.length - 1] ?? parsed.host;
  return cut(last, 'tail');
};

/**
 * The ratio, in the reader's words as well as the platform's.
 *
 * "Was it retina?" is the question, so the answer says the word. Two and
 * above is retina — that is the ratio Apple coined the word for, and every
 * phone and most laptops sit at 2 or 3. Exactly one is a standard display.
 * The fractions in between — 1.25, 1.5, the Windows scaling steps — are
 * neither, and get no word rather than a wrong one.
 */
const dprWord = (dpr: number): string =>
  dpr >= 2 ? `DPR ${dpr} (retina)` : dpr === 1 ? `DPR ${dpr} (standard)` : `DPR ${dpr}`;

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
 * Every candidate the browser chose between, which is not always every
 * candidate the `srcset` names.
 *
 * HTML's select-an-image-source appends the `src` attribute to the source set:
 * "if child has a src attribute whose value is not the empty string and source
 * set does not contain an image source with a density descriptor value of 1,
 * and no image source with a width descriptor, append child's src attribute
 * value to source set's image sources". So on a densities-only `srcset`, the
 * `src` is a 1x candidate and the device pixel ratio decides between it and
 * whatever else is on offer — and a row that left it out said "only one file on
 * offer, so your device made no difference here" about a tag where the ratio
 * decided the whole thing.
 *
 * All three of the spec's conditions are read, because each of them is a real
 * page and dropping one would put a file in the list a browser never considered:
 *
 * - A `w` descriptor anywhere means a browser reads past `src` entirely.
 * - A candidate already at 1x is the 1x candidate, and the `src` is not
 *   appended beside it.
 * - An empty `src` names no file. It is also the one value a browser resolves
 *   against the document, so the attribute is read as written and an absent one
 *   arrives here as the empty string.
 *
 * A `srcset` with no candidates at all is left alone rather than answered with
 * a list of one. The row says "no srcset, so your device made no difference
 * here; the src attribute is the only file on offer", which is the same fact
 * and more of it.
 *
 * `src (1x)` is what the descriptor reads as, because the page wrote no
 * descriptor and `src` is already the word this panel uses for a file that came
 * off the attribute. The density is the part a reader needs to compare against
 * a `2x` beside it.
 */
const candidatesOf = (raw: RawImage): Candidate[] => {
  const written = parseSrcset(raw.srcset);
  const byWidth = written.some((candidate) => candidate.w !== null);
  const already = written.some((candidate) => candidate.x === 1);
  if (written.length === 0 || byWidth || already || raw.srcAttribute === '') return written;
  return [...written, { url: raw.srcAttribute, w: null, x: 1, raw: 'src (1x)' }];
};

/**
 * One reading of one image, in the shape core takes.
 *
 * One field is filled in rather than read. `transferBytes` is null because a
 * page cannot measure one — null is core's own word for unknown, so the honest
 * value is the value the type already has for it.
 *
 * `naturalWidth` was the second such field and is now read. It stood at zero
 * on the argument that a pixel dimension is the first ingredient of a guessed
 * weight, and `non-goals.test.ts` refuses the guess. It still does: nothing
 * here multiplies anything, and a weight is the recorded transfer or the word
 * `unknown`. What the number buys is the comparison in `core` that tells a box
 * the page sized from a box the loaded file sized, which is the difference
 * between a row that can be judged and a row that cannot.
 */
const captured = (raw: RawImage): CapturedImage => ({
  id: raw.selector,
  selector: raw.selector,
  candidates: candidatesOf(raw),
  sizes: raw.sizes,
  sizesSource: raw.sizesSource,
  renderedWidth: raw.renderedWidth,
  declaresWidth: raw.declaresWidth,
  currentSrc: raw.currentSrc,
  naturalWidth: raw.naturalWidth,
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
 * The size, where the image is too small for a thumbnail to show anything.
 *
 * A 1×1 tracking pixel drawn into a 44px box is a 44px square of one colour,
 * and a transparent one is a 44px square of the checked ground behind it —
 * either of which a reader takes for a thumbnail that failed. Saying `1×1`
 * in the box's place is the honest picture: the reader knows the size, and
 * knows the box is not broken.
 *
 * Eight CSS pixels on both sides is the threshold, because nothing that small
 * carries a picture a reader could recognise at 44px, and a favicon-sized
 * image at 16 does. A box of zero is not tiny: it is an image this render did
 * not draw, and its file is still worth a thumbnail.
 */
const tinyOf = (raw: RawImage): string | null => {
  const width = Math.round(raw.renderedWidth);
  const height = Math.round(raw.renderedHeight);
  const drawn = width > 0 && height > 0;
  return drawn && width < 8 && height < 8 ? `${width}×${height}` : null;
};

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
 * How `sizes` gave this image its width, as a clause of the sentence.
 *
 * One phrasing per kind of resolution, because each is a different cause. A
 * clause with a condition is named whole, so the reader can see which one
 * matched at this viewport; one without is the length alone. The two defaults
 * are separated because they are two different findings about the page: no
 * `sizes` at all, or a `sizes` whose every condition missed this viewport.
 *
 * "which is N px" is written only where N is a number the sentence has not
 * already said. A length written in pixels is that number; so is `100vw` on a
 * screen whose width the chain has just stated, which is the common case and
 * was the one that read worst — the maintainer's own row said 1720 three times
 * in one sentence and the reader had to check each one against the last.
 */
function widthOf(resolution: Resolution, cssPx: number, viewportWidth: number): string {
  const rounded = Math.round(cssPx);
  const px = `${rounded} px`;
  // The number, or the fact that it is the number already on the row. `sizes`
  // resolving to the whole viewport is the common case — `100vw`, and both
  // defaults — and writing the figure again there was the same value twice in
  // one sentence and a third time in the clause after it.
  const came = rounded === Math.round(viewportWidth)
    ? 'so the image counts as full width'
    : `which comes to ${px}`;

  switch (resolution.kind) {
    case 'length':
      if (resolution.cond !== null) return `sizes matched ${resolution.clause}, ${came}`;
      return resolution.clause === `${rounded}px`
        ? `sizes says ${resolution.clause}`
        : `sizes says ${resolution.clause}, ${came}`;
    case 'auto':
      return `sizes is auto, so the browser took the width from the layout, ${px}`;
    case 'default':
      return resolution.clause.startsWith('absent')
        ? `there is no sizes, so the 100vw default counts the image as full width`
        : `no sizes clause matched, so the 100vw default counts the image as full width`;
    case 'error':
      return `the sizes clause ${resolution.clause} could not be read`;
  }
}

/**
 * The causal chain from the reader's device to the pixels needed, which every
 * row's reasoning contains.
 *
 * The device first and `sizes` second, in that order, because the reader's
 * question is "is it because of my device?" and the answer has to name the two
 * numbers rather than point at them. Which is why the chain is here and not in
 * the collapsed clause: the head states the width and the ratio as the inputs
 * they are, so a row that named them again on every line was answering a
 * question a reader could already see the answer to. Behind the disclosure it
 * is answering one somebody asked.
 *
 * Lower case throughout, because the chain follows a dash as often as it opens
 * a sentence, and `capital` is what opens one.
 */
function chainOf(selection: Selection, device: DeviceProfile): string {
  const at = dprWord(device.dpr);
  switch (selection.kind) {
    case 'density':
      return `your screen is ${at} and no candidate carries a width, so the ratio decided alone`;
    case 'unreadable':
      return (
        `the sizes clause ${selection.resolution.clause} could not be read as a length, ` +
        `so only the x candidates could be judged against ${at}`
      );
    case 'width': {
      // Two sentences, one step each: what the page asked for, and what the
      // device makes of it. The old single sentence carried both behind a
      // semicolon and said the same number three times — 1720 as the screen,
      // 1720 as the width `sizes` resolved to, 1720 as the pixels needed — and
      // a reader had to check each against the last to find they were one fact.
      //
      // So a number is written once, at the step where it arises, and a step
      // that leaves it unchanged names the step rather than the value. `came`
      // above is the first of those; `wide` is the second, and it is what DPR 1
      // produces on every row.
      //
      // The unit is the file's, not the screen's. `device pixels` was a third
      // unit a reader had met no definition of, and it put the figure on the
      // screen when the thing being chosen is a file — while a `w` descriptor
      // is literally a file's width in pixels. Comparing a file with a file is
      // the comparison the browser made.
      const needs = Math.round(selection.neededPx);
      const wide = needs === Math.round(selection.cssPx) ? 'that' : `${needs} px`;

      return (
        `on your ${device.viewport.width} px wide screen, ` +
        `${widthOf(selection.resolution, selection.cssPx, device.viewport.width)}. ` +
        `At DPR ${device.dpr} it needs a file at least ${wide} wide`
      );
    }
  }
}

/**
 * Whether the pick covers what the device needs, which is the line between
 * `fit` and `undersized`.
 *
 * A comparison and not a computation. Core picks the smallest density at or
 * above the ratio and the largest where none reaches it; a `w` candidate's
 * density reaches the ratio exactly when its width reaches `neededPx`, and an
 * `x` candidate's density is its `x`. So the two figures core already worked
 * out are the two this compares, and no division is needed to ask the
 * question.
 */
function covers(selection: Selection, picked: Candidate, dpr: number): boolean {
  if (selection.kind === 'width' && picked.w !== null) return picked.w >= selection.neededPx;
  return (picked.x ?? 0) >= dpr;
}

/**
 * Whether `loaded` is a larger file than `picked`, a smaller one, the same
 * descriptor, or one the two descriptors cannot rank.
 *
 * `w` against `w` and `x` against `x`. A page that mixes the two on one tag
 * has written a `srcset` a browser reads as all `w`, and the panel says the
 * two cannot be ranked rather than guessing which is bigger.
 *
 * `equal` is its own answer and not a rounding of `smaller`, which is what this
 * read as before: `>` with an else sent two candidates at one descriptor —
 * `/i/a.png 640w, /i/b.png 640w`, where the browser took the other one — down
 * the branch that says the image is stretched. Same width, no stretch. Equal is
 * neither larger nor smaller, and a `srcset` that offers one is a `srcset`
 * where the choice made no difference to the pixels.
 */
function ranked(loaded: Candidate, picked: Candidate): 'larger' | 'smaller' | 'equal' | null {
  if (loaded.w !== null && picked.w !== null) {
    return loaded.w === picked.w ? 'equal' : loaded.w > picked.w ? 'larger' : 'smaller';
  }
  if (loaded.x !== null && picked.x !== null) {
    return loaded.x === picked.x ? 'equal' : loaded.x > picked.x ? 'larger' : 'smaller';
  }
  return null;
}

/**
 * Whether the width core selected against may be the loaded file's own doing.
 *
 * Which is what makes a row's own agreement worth nothing: `auto` defers to
 * layout, core answers with the width the element ended up at, and for an image
 * the page gives no width of its own that is the width of whichever file the
 * browser already held. `needed` is that width times the ratio and the pick is
 * selection run against `needed`, so the loaded file is upstream of the figure
 * that agrees with it.
 *
 * `core` answers it now, and the answer is narrower than the question this used
 * to ask. This read `resolution.kind === 'auto'` and stopped there, which put
 * the quietest verdict the panel has on every row of every page that writes
 * `sizes="auto"` — 15 rows of 23 on an ordinary one, nearly all of them images
 * the page had sized itself. `widthFrom` separates the three ways a layout
 * width comes about, and only the last of them is a width to distrust.
 */
const fromLayout = (selection: Selection): boolean =>
  selection.kind === 'width' && selection.widthFrom === 'layout-intrinsic';

/**
 * Whether the cache mark stands on this row, and what it says where it does.
 *
 * The whole rule, in one place, because "when the mark appears" is exactly the
 * kind of rule that decays into a guess: three call sites each deciding it
 * would be three rules within a slice or two.
 *
 * It used to be `has` alone — the mark on every row a file loaded. The argument
 * for that was sound as far as it went, and it is the footer's: `currentSrc` is
 * what the browser has, and no reading of a page says whether it chose it. What
 * it left out is that the same is true of every row. On a page a person has
 * browsed every image is cached, so the word stood on all twenty-three rows of
 * the maintainer's own page and distinguished none of them from any other — a
 * mark that never varies is decoration, and it costs a reader attention on
 * every row it sits on.
 *
 * So it stands where it changes the conclusion, which is two clauses:
 *
 * - The loaded file is not the file the arithmetic picked — a held copy reused
 *   rather than chosen again is the likeliest cause of that difference, so the
 *   mark is what explains the row. Which is `oversized` and `undersized` where
 *   the loaded file and the pick differ, a different file at the pick's own
 *   descriptor, a loaded file the `srcset` never offered, two descriptors that
 *   cannot be ranked, and the one file on offer where the browser has another.
 * - A figure the row shows descends from the held file — `sizes: auto` deferred
 *   to layout and the page sized nothing itself, so `css px` and every figure
 *   under it may be the loaded file's own doing. `fromLayout` is that question,
 *   and it is the same question `can’t tell` is: a verdict that depends on the
 *   held file cannot arise without it, so it needs no clause of its own.
 *
 * And nowhere else. A row where the browser loaded the pick and no figure
 * descends from what it held is a row the mark is true of exactly as much as it
 * is true of every other row on the page.
 *
 * A width of zero is not a figure a row shows, which is the one edge here worth
 * settling on purpose. `auto` on an image this render drew no box for resolves
 * to nothing, and "the width above descends from it" about `0px` is a claim
 * about a figure a reader cannot use — the verdict there is `no width`, which
 * says the arithmetic never ran rather than that it ran on the file's own
 * width. So the second clause asks for a width as well as a layout, and such a
 * row marks only where the first clause holds. `kind` is asked again for the
 * figure that follows it; `fromLayout` already answers for it.
 *
 * Null where nothing loaded, which is where it always was: there is then no
 * file for a held copy to have supplied.
 *
 * `selection` is null at the one site where no arithmetic ran at all — fewer
 * than two candidates, so nothing was selected and the single candidate on
 * offer stands in for the pick. A row with no `srcset` offers none, and a
 * browser that loaded the `src` has then loaded the only file there was.
 */
const markFor = (
  has: boolean,
  loaded: Candidate | null,
  picked: Candidate | null,
  selection: Selection | null,
): string | null => {
  if (!has) return null;

  const differs = picked !== null && loaded !== picked;
  const descends =
    selection !== null &&
    fromLayout(selection) &&
    selection.kind === 'width' &&
    selection.cssPx !== 0;

  return differs || descends ? markOf(descends) : null;
};

/**
 * What a collapsed row says, per outcome: the pixels the arithmetic asked for
 * and the file that answers them, in one short clause.
 *
 * Four of them, and every one has the same two halves — what was needed, and
 * which file covers it — because that is the pair the maintainer's own shape
 * asks for: "**1920w loaded.** Needs 1468 px, and 1920w is the smallest that
 * covers it." The first half of that is the headline the row already has, so
 * these are the second.
 *
 * A width-selected row opens with the figure and a density-selected row cannot,
 * because there is no width and no pixel count to open with: `sizes` never
 * entered, the ratio is the whole cause, and the clause points at the head
 * field that holds it rather than repeating the number. That is the same split
 * `winning` and `stretched` make below, and for the same reason.
 */
const fits = (selection: Selection, picked: Candidate): string =>
  selection.kind === 'width' && picked.w !== null
    ? `Needs ${Math.round(selection.neededPx)} px, and ${picked.raw} is the smallest file that covers it.`
    : `${picked.raw} is the smallest density at or above your pixel ratio.`;

/** The clause for a pick that is the largest on offer and still falls short. */
const biggest = (selection: Selection, picked: Candidate): string =>
  selection.kind === 'width' && picked.w !== null
    ? `Needs ${Math.round(selection.neededPx)} px, and ${picked.raw} is the largest file on offer.`
    : `${picked.raw} is the densest on offer, and your pixel ratio is higher.`;

/** The clause for a file larger than the one that would have covered it. */
const spare = (selection: Selection, picked: Candidate, loaded: Candidate): string =>
  selection.kind === 'width' && picked.w !== null
    ? `Needs ${Math.round(selection.neededPx)} px, and ${picked.raw} covers it, so ${loaded.raw} is larger than needed.`
    : `${picked.raw} covers your pixel ratio, so ${loaded.raw} is larger than needed.`;

/** The clause for a file that does not reach what the device needs. */
const short = (selection: Selection, picked: Candidate, loaded: Candidate): string =>
  selection.kind === 'width' && picked.w !== null
    ? `Needs ${Math.round(selection.neededPx)} px, and ${loaded.raw} does not cover it.`
    : `${picked.raw} covers your pixel ratio, and ${loaded.raw} does not.`;

/**
 * The one clause that says why the pick wins, per kind of selection.
 *
 * "wide enough" rather than "covers that", because covering is vague about what
 * is covered and the test the browser ran is a width against a width.
 */
const winning = (selection: Selection, picked: Candidate): string =>
  selection.kind === 'width' && picked.w !== null
    ? `and ${picked.raw} is the smallest that is wide enough`
    : `and ${picked.raw} is the smallest density at or above it`;

/** The clause for a pick that is the largest on offer and still falls short. */
const stretched = (selection: Selection, picked: Candidate): string =>
  selection.kind === 'width' && picked.w !== null
    ? `but no file is wide enough, so the browser took the largest, ${picked.raw}, and the ` +
      `image is stretched to fit; add a candidate above ${picked.raw}`
    : `but no candidate reaches it, so the browser took the densest, ${picked.raw}, and the ` +
      `image is stretched to fit; add a candidate above ${picked.raw}`;

/**
 * The verdict, the clause and the reasoning for a row that had a real choice
 * to make.
 *
 * Two levels rather than one sentence, which is the shape the disclosure
 * already had and the sentence did not use. `why` is the outcome in one short
 * clause; `because` is the causal chain, the cause named as a likelihood where
 * the panel cannot know it, and the cure. The reader who scans has the answer
 * and the reader who opens a row has the reason, and neither is made to read
 * the other's half.
 *
 * Every sentence in `because` is the sentence this used to return. It was
 * correct and it was too much to meet twenty-three times, which is a question
 * about where prose goes rather than about what it says.
 */
function judged(
  selection: Selection,
  device: DeviceProfile,
  loaded: Candidate | null,
  has: boolean,
): { verdict: Verdict; why: string; because: string[] } {
  const picked = selection.picked;
  const chain = chainOf(selection, device);

  if (picked === null) {
    // A width of zero is core reporting nothing to select against, and it is
    // not the `srcset`'s doing. `select.ts` treats a `sizesPx` of `0` as
    // unknown, so a lazy image below the fold with `sizes="auto"` — the
    // ordinary case, not an exotic one — used to be told "fix the srcset" about
    // a `srcset` with nothing wrong with it. Read here rather than fixed in
    // core, because core measures a laid-out page for the command line and a
    // width of zero there is a different finding: the command renders the page
    // itself, so an element it laid out at nothing is an element that has no
    // box at any scroll position. Only this front end can meet one that simply
    // has not been scrolled to yet.
    //
    // Inside the `picked === null` branch rather than before it, because "and
    // nothing was picked" has to stay true: a tag mixing a `w` candidate with
    // an `x` one still has a density to judge, so it is picked and judged
    // normally even where the width is zero.
    if (selection.kind === 'width' && selection.cssPx === 0) {
      return {
        verdict: NO_WIDTH,
        // The clause names neither cause, because there are two of them and
        // they are two different findings: a box this render drew nothing for,
        // and a page that wrote `0px` itself. The note is where they are told
        // apart, and a clause that named one of them would be wrong about the
        // other half of the time.
        why: 'No width to select against, so nothing was picked.',
        because: [
          `${capital(widthOf(selection.resolution, selection.cssPx, device.viewport.width))}, ` +
            'so there was no width to select against and nothing was picked — an image this ' +
            'render drew no box for, such as a lazy one below the fold, is the ordinary cause. ' +
            'The srcset is not what to look at here.',
        ],
      };
    }

    return {
      verdict: UNSETTLED,
      // The clause at fault is not named here and is named in the note. It is
      // page content, so its length is the page's to choose, and a collapsed
      // row is the one place in the panel that cannot afford an unbounded
      // string — `clause used` is where a reader is already looking for it.
      why:
        selection.kind === 'unreadable'
          ? 'The sizes clause could not be read, so nothing was picked.'
          : 'No candidate carries a readable descriptor, so nothing was picked.',
      because: [
        selection.kind === 'unreadable'
          ? `The sizes clause ${selection.resolution.clause} could not be read as a length, so ` +
            'there is no width to select against and nothing was picked; fix the sizes attribute.'
          : 'No candidate carries a readable descriptor, so nothing was picked; fix the srcset.',
      ],
    };
  }

  if (!has) {
    return {
      verdict: NOT_LOADED,
      why: `Nothing has loaded yet, and the arithmetic picks ${picked.raw}.`,
      because: [
        `${capital(chain)}. Nothing has loaded yet; when it does, the arithmetic picks ` +
          `${picked.raw}.`,
      ],
    };
  }

  const picks = `${capital(chain)}. The arithmetic picks ${picked.raw}, but `;

  if (loaded === null) {
    return {
      verdict: UNSETTLED,
      why: 'The loaded file is not one the srcset offers.',
      because: [`${picks}the loaded file is not one the srcset offers; check what set this src.`],
    };
  }

  const rank = loaded === picked ? 'equal' : ranked(loaded, picked);

  if (rank === 'equal') {
    // A second file at the same descriptor is the pick as far as any reading of
    // the page goes, so it is judged as the pick and the tie is named. Said
    // after the outcome rather than instead of it, because the outcome is what
    // a reader came for and the tie is why the file name below does not match
    // the descriptor beside it.
    const tie =
      loaded === picked
        ? ''
        : ` The browser loaded ${loaded.raw}, which is a different file at the same descriptor, ` +
          'so the pixels are the same either way.';

    if (!covers(selection, picked, device.dpr)) {
      return {
        verdict: UNDERSIZED,
        why: biggest(selection, picked),
        because: [`${capital(chain)}, ${stretched(selection, picked)}.${tie}`],
      };
    }

    // The one place a good verdict is withheld. Every figure the agreement
    // rests on descends from the file the agreement is about, so `fit` here
    // would be the row confirming its own coincidence — and it would do it in
    // the quietest words the panel has, which is the panel being least
    // sceptical exactly where it knows least.
    //
    // The clause says the consequence and not the arithmetic, which is the one
    // outcome where those are different things: a row that opened with the
    // figures would read exactly like `fit` at a glance, and the figures are
    // the part a reader cannot use. `circular()` is the mechanism and it is
    // appended after this, so the tail this sentence used to carry is not
    // written twice into one disclosure.
    return fromLayout(selection)
      ? {
          verdict: CANT_TELL,
          why: 'The width may be the loaded file’s own, so the pick cannot disagree with it.',
          because: [`${capital(chain)}, ${winning(selection, picked)}.${tie}`],
        }
      : {
          verdict: FIT,
          why: fits(selection, picked),
          because: [`${capital(chain)}, ${winning(selection, picked)}.${tie}`],
        };
  }

  switch (rank) {
    case 'larger':
      // What is known is that a larger candidate than the pick loaded. A held
      // copy is the likeliest cause and it is not the only one: a viewport that
      // shrank after load, script that rewrote `sizes` or `srcset`, and a
      // layout that changed all read exactly the same from here. So the cause
      // is named as a likelihood, which is what the panel can stand behind.
      return {
        verdict: OVERSIZED,
        why: spare(selection, picked, loaded),
        because: [
          `${picks}the browser loaded ${loaded.raw}, which is larger. A held copy reused rather ` +
            'than chosen again is the likeliest cause, and a viewport that shrank after load or ' +
            'script that rewrote sizes or srcset would read the same; an empty cache is the only ' +
            'way to see the real pick.',
        ],
      };
    case 'smaller':
      // The figure the shortfall is against is the one the row already shows,
      // and it is what `sizes` asked for rather than what the page drew — so
      // the upscale is stated as following from that figure rather than as an
      // observation of the rendered image, which nothing here can make.
      return {
        verdict: UNDERSIZED,
        why: short(selection, picked, loaded),
        because: [
          `${picks}the browser loaded ${loaded.raw}, which does not cover the pixels needed ` +
            'above, so the image is upscaled wherever the page draws it at that size; check what ' +
            'set this src.',
        ],
      };
    case null:
      return {
        verdict: UNSETTLED,
        why: 'A w and an x descriptor cannot be ranked against each other.',
        because: [
          `${picks}the browser loaded ${loaded.raw}, and a w and an x descriptor cannot be ` +
            'ranked against each other.',
        ],
      };
  }
}

/**
 * The arithmetic as steps, one line each, for a row with a choice to make.
 *
 * Aligned and compact, no prose — this is the "because x y z" the maintainer
 * asked for once the row is open. The multiplication to device pixels is
 * written out as text from the figures core returned, so a reader can check it
 * by eye; nothing here performs it.
 *
 * `sizes` enters the `w` case alone; a browser reads past it otherwise,
 * however the tag was written. The line is still written where the page wrote
 * the attribute, because a reader who can see it in DevTools would otherwise
 * get no answer about it at all — and `clause used` says it was read past.
 */
function stepsOf(
  image: CapturedImage,
  selection: Selection,
  device: DeviceProfile,
  loaded: Candidate | null,
  laidOut: boolean,
): Line[] {
  const picked = selection.picked;
  const wrote = selection.kind !== 'density' || image.sizes !== null;

  const candidates = image.candidates
    .map((candidate) =>
      candidate === picked
        ? `${candidate.raw} (picked)`
        : candidate === loaded && loaded !== picked
          ? `${candidate.raw} (loaded)`
          : candidate.raw,
    )
    .join(', ');

  const measured: Line[] =
    selection.kind === 'width'
      ? [
          { label: 'css px', value: `${Math.round(selection.cssPx)}px`, held: laidOut },
          {
            label: 'needed',
            value:
              `${Math.round(selection.cssPx)}px × DPR ${device.dpr} = ` +
              `${Math.round(selection.neededPx)}px`,
            held: laidOut,
          },
        ]
      : selection.kind === 'unreadable'
        ? [
            { label: 'css px', value: 'unreadable', held: false },
            { label: 'needed', value: '—', held: false },
          ]
        : [{ label: 'needed', value: dprWord(device.dpr), held: false }];

  return [
    ...(wrote ? [{ label: 'sizes', value: offered(image), held: false }] : []),
    {
      label: 'clause used',
      value: selection.kind === 'density' ? 'x descriptors only' : selection.resolution.clause,
      held: false,
    },
    ...measured,
    { label: 'candidates', value: candidates, held: false },
  ];
}

/**
 * One image's row.
 *
 * Two shapes, and the split is the same one `trace.ts` makes. An image with
 * fewer than two candidates had nothing to select between, so it says which of
 * the two reasons that was and stops — a column of dashes would only bury the
 * images that do choose, and this is also what keeps a 1×1 tracking pixel to
 * one line. A third case joins it here: a `srcset` whose every candidate
 * resolves to one URL, which the maintainer's screenshot showed as nine
 * identical addresses under a `1×1` overlay. The arithmetic ran, and the
 * device made no difference to the bytes.
 */
function rowOf(raw: RawImage, device: DeviceProfile): Row {
  const image = captured(raw);
  const base = raw.baseURI;
  const has = image.currentSrc !== '';

  // The name beside the headline, and the whole reason `nameOf` exists: the
  // recognisable part of a URL, wherever the CDN put it. Nothing where nothing
  // loaded, because the verdict beside it already says so.
  const name = has ? nameOf(image.currentSrc, base) : '';

  // Every candidate's URL, resolved, so a relative candidate and an absolute
  // `currentSrc` can be compared at all. The candidates that name the loaded
  // file are how the headline finds its descriptor.
  const urls = image.candidates.map((candidate) => absolute(candidate.url, base));
  const matching = image.candidates.filter((_, at) => urls[at] === image.currentSrc);
  const sameFile =
    urls.length > 1 && urls.filter((url) => url === urls[0]).length === urls.length;

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
  // the one a reader came to check — and flagged on every row a file loaded,
  // because `currentSrc` is what the browser has and there is no reading of the
  // page that says whether it chose it. The flag says which figure the mark is
  // about; whether the row draws one at all is `markFor`. Then every candidate
  // in the order the page offered them, or one line where they all name one
  // file: nine identical addresses say less than one sentence does.
  const files: Line[] = [
    ...(has ? [{ label: 'loaded', value: image.currentSrc, held: true }] : []),
    ...(sameFile
      ? [{ label: plural(urls.length, 'candidate'), value: `one file: ${urls[0]}`, held: false }]
      : image.candidates.map((candidate, at) => ({
          label: candidate.raw,
          value: urls[at] ?? candidate.url,
          held: false,
        }))),
  ];
  const details: Line[] = [...files, ...identity, { label: 'bytes', value: UNKNOWN, held: false }];

  const carried = {
    at: raw.at,
    name,
    alt: altFor(raw, name),
    file: image.currentSrc,
    tiny: tinyOf(raw),
    details,
  };

  if (image.candidates.length < 2) {
    const [only] = image.candidates;
    return {
      ...carried,
      verdict: NO_CHOICE,
      loaded: !has ? '—' : only !== undefined && matching.length > 0 ? only.raw : 'src',
      why:
        only === undefined
          ? 'No srcset, so your device made no difference here.'
          : 'Only one file on offer, so your device made no difference here.',
      mark: markFor(has, matching[0] ?? null, only ?? null, null),
      steps: [{ label: 'candidates', value: only === undefined ? '(no srcset)' : only.raw, held: false }],
      // One candidate is one clause and no reasoning: "only one file on offer"
      // is the whole of it, and a note repeating the clause above would be the
      // reader reading the same words twice. A page with no `srcset` at all has
      // one more fact to give, which is where its one file came from.
      notes:
        only === undefined
          ? [
              'No srcset, so your device made no difference here; the src attribute is the only ' +
                'file on offer.',
            ]
          : [],
    };
  }

  const selection = explainSelection(image, device);
  const picked = selection.picked;

  // The candidate that loaded, as the headline names it. Where several share
  // the loaded URL the pick is preferred, because that is the one the browser
  // would have arrived at; the first otherwise. Null is a file the `srcset`
  // never offered.
  const loaded =
    matching.length === 0
      ? null
      : picked !== null && matching.includes(picked)
        ? picked
        : (matching[0] ?? null);

  // Where a clause resolved to `auto`, the figures under it are marked and
  // `circular` says why: the width is the width this render laid the image
  // out at, and for an image the page gives no width of its own that is the
  // width of the file the browser already held.
  //
  // `fromLayout` says which `auto` resolutions those are rather than only the
  // ones where the width provably came from the file, and the verdict and the
  // mark ask it the same question: a row whose figures descend from the loaded
  // file cannot read as a confirmation of it.
  const laidOut = fromLayout(selection);

  const headline = !has ? '—' : loaded === null ? 'src' : loaded.raw;
  const steps = stepsOf(image, selection, device, loaded, laidOut);
  const circularity = laidOut ? [circular()] : [];

  if (sameFile) {
    return {
      ...carried,
      verdict: NO_CHOICE,
      loaded: headline,
      why: `All ${urls.length} candidates name one file, so your device made no difference here.`,
      mark: markFor(has, loaded, picked, selection),
      steps,
      notes: [
        `All ${urls.length} candidates name one file, so your device made no difference here — ` +
          'the descriptors differ and the bytes do not.',
        ...circularity,
      ],
    };
  }

  const { verdict, why, because } = judged(selection, device, loaded, has);
  return {
    ...carried,
    verdict,
    loaded: headline,
    why,
    mark: markFor(has, loaded, picked, selection),
    steps,
    // The reasoning first and the circularity argument after it, in the order a
    // reader who opened the row reads them: what the arithmetic did, and then
    // why its agreement with the loaded file is worth nothing.
    notes: [...because, ...circularity],
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

  // Every row first, because the head is a statement about them: the counts are
  // the verdicts the rows arrived at, and a header that guessed them from the
  // reading would be a second answer to a question the rows have answered.
  const rows = reading.images.map((raw) => rowOf(raw, device));

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
    head: {
      width: `${reading.viewport.width} px`,
      dpr: dprWord(reading.dpr),
      // The count, then what the images amount to. A middle dot rather than a
      // second line, because the two halves answer one question — how much is
      // here, and how much of it is a problem — and a reader takes them in
      // together or not at all.
      counts: [plural(rows.length, 'image'), ...tally(rows)].join(' · '),
    },
    rows,
    footer: [...footerOf(), ...backgrounds],
  };
}
