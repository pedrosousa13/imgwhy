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
 * Three tones for six words, because the words say what happened and the tone
 * says whether that is a problem. `good` is the file that should have loaded,
 * and it is quiet on purpose: the panel exists to find the rows that are not.
 * `warn` is bytes wasted or pixels stretched, and every sentence under one
 * carries a clause saying what to do about it, because a warning with no
 * action is noise. `quiet` is a row the device had no say in.
 *
 * A closed set of three words the extension owns, and the one property the
 * renderer writes as a class. No page string can reach it.
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
 *   pixels needed.
 * - `oversized` — the loaded file is a larger candidate than the pick. Wasted
 *   bytes; a held copy the browser reused is the first thing to rule out.
 * - `undersized` — the loaded file does not cover the pixels needed, so the
 *   image is stretched. Either no candidate covers them and the largest stood
 *   in, or the browser loaded something smaller than the pick.
 * - `no choice` — one candidate, no `srcset`, or every candidate naming one
 *   file. The device made no difference.
 * - `not loaded` — nothing has loaded yet, so there is no file to judge. A lazy
 *   image below the fold, most often.
 * - `unknown` — the comparison cannot settle it: nothing was picked because a
 *   `sizes` clause would not read, or the loaded file is not one the `srcset`
 *   offers. Unknown is the honest word, and the sentence says which it was.
 *
 * The brief named four. `not loaded` and `unknown` are here because the four
 * do not cover a lazy image or a broken `sizes`, and forcing either into a
 * category it does not belong to would be a verdict that lies at a glance.
 */
export type Verdict = { word: string; tone: Tone };

/**
 * One image, said.
 *
 * The order of the fields is the order the panel reads them, and the three
 * levels the issue asks for. First what a reader sees without opening
 * anything: the verdict, the descriptor of the file that loaded, the name of
 * that file, and one sentence that says why. Then `steps`, the arithmetic as
 * aligned lines, opened once. Then `details`, the whole URLs and where the
 * image sat, opened again.
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
  /** The one sentence: what loaded and why, naming the reader's device. */
  why: string;
  /**
   * What the cache mark means on this row, said where the mark is. Null where
   * nothing loaded, because there is then nothing a held copy could have
   * supplied.
   */
  mark: string | null;
  /** The arithmetic as steps, opened once. */
  steps: Line[];
  /** Every file whole, and where the image sat, opened again. */
  details: Line[];
  /** Prose the arithmetic needs, shown with the steps. */
  notes: string[];
};

/**
 * The two inputs every row's sentence names, and the count.
 *
 * Separate fields rather than one line, because the viewport width and the
 * ratio are the two numbers that explain every row below them, and the panel
 * lays them out as inputs rather than as a line of metadata.
 */
export type Head = { width: string; dpr: string; images: string };

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
const NOT_LOADED: Verdict = { word: 'not loaded', tone: 'quiet' };
// A literal rather than `UNKNOWN`, because `dormant.test.ts` reads a constant
// initialised from another name as something that runs at load, and the word
// is the same word either way.
const UNSETTLED: Verdict = { word: 'unknown', tone: 'quiet' };

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
 * matched at this viewport; one without is the length alone. A length already
 * written in pixels is not followed by "which is N px", because that would say
 * the same number twice. The two defaults are separated because they are two
 * different findings about the page: no `sizes` at all, or a `sizes` whose
 * every condition missed this viewport.
 */
function widthOf(resolution: Resolution, cssPx: number): string {
  const px = `${Math.round(cssPx)} px`;
  switch (resolution.kind) {
    case 'length':
      if (resolution.cond !== null) return `sizes matched ${resolution.clause}, which is ${px}`;
      return resolution.clause === `${Math.round(cssPx)}px`
        ? `sizes gives it ${resolution.clause}`
        : `sizes gives it ${resolution.clause}, which is ${px}`;
    case 'auto':
      return `sizes is auto, and the width came from layout: ${px}`;
    case 'default':
      return resolution.clause.startsWith('absent')
        ? `no sizes is written, and the 100vw default gives it ${px}`
        : `no sizes clause matched, and the 100vw default gives it ${px}`;
    case 'error':
      return `the sizes clause ${resolution.clause} could not be read`;
  }
}

/**
 * The causal chain from the reader's device to the pixels needed, which every
 * sentence below contains.
 *
 * The device first and `sizes` second, in that order, because the reader's
 * question is "is it because of my device?" and the answer has to name the two
 * numbers on the line they are looking at. The viewport width and the ratio
 * are already in the panel head; naming them again in every sentence is
 * deliberate.
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
    case 'width':
      return (
        `your screen is ${device.viewport.width} px wide at ${at}; ` +
        `${widthOf(selection.resolution, selection.cssPx)}, ` +
        `so it needs ${Math.round(selection.neededPx)} device pixels`
      );
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
 * Whether `loaded` is a larger file than `picked`, a smaller one, or one the
 * two descriptors cannot rank.
 *
 * `w` against `w` and `x` against `x`. A page that mixes the two on one tag
 * has written a `srcset` a browser reads as all `w`, and the panel says the
 * two cannot be ranked rather than guessing which is bigger.
 */
function ranked(loaded: Candidate, picked: Candidate): 'larger' | 'smaller' | null {
  if (loaded.w !== null && picked.w !== null) return loaded.w > picked.w ? 'larger' : 'smaller';
  if (loaded.x !== null && picked.x !== null) return loaded.x > picked.x ? 'larger' : 'smaller';
  return null;
}

/** The one clause that says why the pick wins, per kind of selection. */
const winning = (selection: Selection, picked: Candidate): string =>
  selection.kind === 'width' && picked.w !== null
    ? `and ${picked.raw} is the smallest file that covers that`
    : `and ${picked.raw} is the smallest density at or above it`;

/** The clause for a pick that is the largest on offer and still falls short. */
const stretched = (selection: Selection, picked: Candidate): string =>
  selection.kind === 'width' && picked.w !== null
    ? `no file covers that, so ${picked.raw}, the largest on offer, is stretched to fit; ` +
      `add a candidate above ${picked.raw}`
    : `no candidate reaches that, so ${picked.raw}, the densest on offer, is stretched to fit; ` +
      `add a candidate above ${picked.raw}`;

/**
 * The verdict and the sentence for a row that had a real choice to make.
 *
 * One template per outcome, and every template has the same shape: the
 * outcome first, then the causal chain, then — where the outcome is a warning
 * — what to do about it. The reader who stops after the first clause has the
 * answer; the reader who goes on has the reason.
 */
function judged(
  selection: Selection,
  device: DeviceProfile,
  loaded: Candidate | null,
  has: boolean,
): { verdict: Verdict; why: string } {
  const picked = selection.picked;
  const chain = chainOf(selection, device);

  if (picked === null) {
    return {
      verdict: UNSETTLED,
      why:
        selection.kind === 'unreadable'
          ? `The sizes clause ${selection.resolution.clause} could not be read as a length, so ` +
            'there is no width to select against and nothing was picked; fix the sizes attribute.'
          : 'No candidate carries a readable descriptor, so nothing was picked; fix the srcset.',
    };
  }

  if (!has) {
    return {
      verdict: NOT_LOADED,
      why: `Nothing has loaded yet; when it does, the arithmetic picks ${picked.raw} — ${chain}.`,
    };
  }

  const picks = `The arithmetic picks ${picked.raw} — ${chain} — but `;

  if (loaded === null) {
    return {
      verdict: UNSETTLED,
      why: `${picks}the loaded file is not one the srcset offers; check what set this src.`,
    };
  }

  if (loaded === picked) {
    return covers(selection, picked, device.dpr)
      ? { verdict: FIT, why: `${capital(chain)} — ${winning(selection, picked)}.` }
      : { verdict: UNDERSIZED, why: `${capital(chain)} — ${stretched(selection, picked)}.` };
  }

  switch (ranked(loaded, picked)) {
    case 'larger':
      return {
        verdict: OVERSIZED,
        why:
          `${picks}the browser already held ${loaded.raw} and reused it rather than choosing ` +
          'again; an empty cache is the only way to see the real pick.',
      };
    case 'smaller':
      return {
        verdict: UNDERSIZED,
        why:
          `${picks}the browser loaded ${loaded.raw}, which is smaller, so the image is ` +
          'stretched to fit; check what set this src.',
      };
    case null:
      return {
        verdict: UNSETTLED,
        why:
          `${picks}the browser loaded ${loaded.raw}, and a w and an x descriptor cannot be ` +
          'ranked against each other.',
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
  // the one a reader came to check — and marked on every row a file loaded,
  // held copy or not, because `currentSrc` is what the browser has and there
  // is no reading of the page that says whether it chose it. Then every
  // candidate in the order the page offered them, or one line where they all
  // name one file: nine identical addresses say less than one sentence does.
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
          ? 'No srcset, so your device made no difference here; the src attribute is the only ' +
            'file on offer.'
          : 'Only one file on offer, so your device made no difference here.',
      mark: has ? markOf(false) : null,
      steps: [{ label: 'candidates', value: only === undefined ? '(no srcset)' : only.raw, held: false }],
      notes: [],
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
  // Marked whenever the resolution is `auto` rather than only where the width
  // came from the file, and that is deliberate rather than approximate. An
  // `auto` image the page *does* give a CSS width has a `css px` no cache could
  // have touched — but this package reads a laid-out box and not a cascade, so
  // there is no reading of the page that tells the two apart. The mark says
  // what a figure is, so it cannot be conditional on something nothing here
  // can see.
  const laidOut = selection.kind === 'width' && selection.resolution.kind === 'auto';

  const headline = !has ? '—' : loaded === null ? 'src' : loaded.raw;
  const steps = stepsOf(image, selection, device, loaded, laidOut);
  const notes = laidOut ? [circular()] : [];

  if (sameFile) {
    return {
      ...carried,
      verdict: NO_CHOICE,
      loaded: headline,
      why:
        `All ${urls.length} candidates name one file, so your device made no difference here — ` +
        'the descriptors differ and the bytes do not.',
      mark: has ? markOf(laidOut) : null,
      steps,
      notes,
    };
  }

  const { verdict, why } = judged(selection, device, loaded, has);
  return {
    ...carried,
    verdict,
    loaded: headline,
    why,
    mark: has ? markOf(laidOut) : null,
    steps,
    notes,
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
    head: {
      width: `${reading.viewport.width} px`,
      dpr: dprWord(reading.dpr),
      images: plural(reading.images.length, 'image'),
    },
    rows: reading.images.map((raw) => rowOf(raw, device)),
    footer: [...footerOf(), ...backgrounds],
  };
}
