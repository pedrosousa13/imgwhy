import type { Capture, CapturedImage, DeviceProfile } from '@imgwhy/core';
import { describe, expect, it } from 'vitest';
import { serializeCapture } from '../src/out.js';
import { formatCapture } from '../src/trace.js';

/**
 * The characters a page put in an attribute to be acted on, with the line it
 * wanted the trace to write behind them.
 *
 * ESC opens a sequence a terminal executes and BEL ends it — this one retitles
 * the window, and an erase-line sequence takes the `← differs` marker off a
 * row. The CR and the LF are the other half: they end a line early and give
 * the rest of the attribute a line of its own, so the words behind them are a
 * fact the page wrote into a trace that promises one fact per line. NUL is
 * there because a check reading the whole trace should cover the character a
 * length calculation is likeliest to lose.
 *
 * The last two are not control characters and do those same two things. The
 * bidi override displays the text behind it in the order the page chose rather
 * than the order imgwhy wrote it, and the line separator ends a line for
 * anything reading stdout a line at a time.
 */
const CONTROLS = '\u001b]0;imgwhy-pwned\u0007\r\nFORGED LINE\u0000\u202edesrever\u2028';

/** One string as a page written to break the trace would write it. */
const carrying = (text: string): string => `${text}${CONTROLS}`;

/**
 * Everything a terminal or a line reader acts on, which is the trace's whole
 * alphabet less the backslash it writes them with: every control character,
 * the bidi embeddings, overrides and isolates, and the two separators that end
 * a line.
 */
const ACTED_ON = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

/** A control character, which is all `JSON.stringify` promises to escape. */
const CONTROL = /\p{Cc}/u;

/**
 * Every line of the given text still holding one of `pattern`'s. Empty is
 * clean.
 *
 * The split is on the newlines the trace itself wrote — its own separator is
 * the one control character it is allowed — so a page's newline arriving
 * intact reads here as a line that ends early and a line that starts with the
 * page's words, and either way this list is not empty.
 */
const holding = (text: string, pattern: RegExp): string[] =>
  text.split('\n').filter((line) => pattern.test(line));

/** Where each column of a table line begins, which is what lined up means. */
const starts = (line: string): number[] =>
  [...line.matchAll(/(?:^|\s{2})\S/g)].map((found) => found.index + found[0].length - 1);

/** The table at the end of a block, header row first, blank lines dropped. */
function tableLines(trace: string): string[] {
  const all = trace.split('\n');
  const header = all.findIndex((line) => line.trimStart().startsWith('device'));
  if (header === -1) throw new Error(`no table in\n${trace}`);
  return all.slice(header).filter((line) => line.trim() !== '');
}

/** The one line holding `text`, or a failure saying how many did. */
function lineWith(trace: string, text: string): string {
  const found = trace.split('\n').filter((line) => line.includes(text));
  if (found.length !== 1) throw new Error(`${found.length} lines hold "${text}" in\n${trace}`);
  return found[0];
}

const DEVICES: DeviceProfile[] = [
  { id: 'desktop', name: carrying('Desktop'), viewport: { width: 1440, height: 900 }, dpr: 1 },
  { id: 'tablet', name: carrying('Tablet'), viewport: { width: 820, height: 1180 }, dpr: 2 },
  // Rendered nothing, so the block names it absent — which is one more page
  // string, since a config file writes these names and a non-empty string is
  // the whole of the check on one.
  { id: 'phone', name: carrying('Phone'), viewport: { width: 375, height: 667 }, dpr: 3 },
];

const HERO = carrying('html > body > main > img');

/**
 * The image with a choice to make, so every column of the table is filled.
 *
 * `selector` is a parameter because a responsive layout can move an image, and
 * a selector that differs from the id is what makes the block write the `also
 * at` line — one more string off the page.
 */
const hero = (selector: string): CapturedImage => ({
  id: HERO,
  selector,
  candidates: [
    { url: carrying('/i/640.png'), w: 640, x: null, raw: carrying('640w') },
    { url: carrying('/i/1080.png'), w: 1080, x: null, raw: carrying('1080w') },
  ],
  sizes: carrying('100vw'),
  // Off a `<source>`, so the offered line writes the sentence naming that
  // element beside the string the page wrote.
  sizesSource: 'source',
  renderedWidth: 1440,
  declaresWidth: false,
  currentSrc: carrying('/i/1080.png'),
  naturalWidth: 1080,
  transferBytes: 41_233,
  loading: 'eager',
});

/** No srcset, so the block collapses to the two lines that still have facts. */
const logo = (): CapturedImage => ({
  id: carrying('html > body > header > img'),
  selector: carrying('html > body > header > img'),
  candidates: [],
  sizes: null,
  sizesSource: 'img',
  renderedWidth: 120,
  declaresWidth: false,
  currentSrc: carrying('/i/logo.png'),
  naturalWidth: 120,
  transferBytes: null,
  loading: 'lazy',
});

/**
 * A Capture whose every string came from a page written to break the trace.
 *
 * None of these fields is imgwhy's to trust. The URL is the one a redirect
 * chose, so a hostile host names it; the `sizes` string, the descriptors and
 * every candidate URL are attributes off the page's own markup; the id and the
 * selector are DOM paths, which carry whatever the page put in an attribute
 * selector; and the device names come out of `imgwhy.config.json`.
 *
 * Two devices that saw the one image differently, so the block writes a line
 * per offer and names the devices each was offered to, and a third that
 * rendered nothing, so it writes the absent line as well. Two images, because
 * an image with nothing to select prints a different pair of lines. The
 * backgrounds are painted, so the head carries that line too. Between them,
 * every line this trace can write is in this one document.
 */
const hostile = (): Capture => ({
  url: carrying('https://evil.example/page'),
  capturedAt: '2026-09-04T00:00:00.000Z',
  devices: DEVICES,
  runs: [
    { deviceId: 'desktop', images: [logo(), hero(HERO)], backgroundImageCount: 2 },
    {
      deviceId: 'tablet',
      images: [logo(), hero(carrying('html > body > aside > img'))],
      backgroundImageCount: 3,
    },
  ],
});

const DESKTOP: DeviceProfile = {
  id: 'desktop',
  name: 'Desktop',
  viewport: { width: 1440, height: 900 },
  dpr: 1,
};

const TABLET: DeviceProfile = {
  id: 'tablet',
  name: 'Tablet',
  viewport: { width: 820, height: 1180 },
  dpr: 2,
};

/** An image whose every string is ordinary, for a case to make one hostile. */
const plain = (): CapturedImage => ({
  id: 'html > body > img',
  selector: 'html > body > img',
  candidates: [
    { url: '/i/640.png', w: 640, x: null, raw: '640w' },
    { url: '/i/1080.png', w: 1080, x: null, raw: '1080w' },
  ],
  sizes: '100vw',
  sizesSource: 'img',
  renderedWidth: 1440,
  declaresWidth: false,
  currentSrc: 'https://example.test/i/1080.png',
  naturalWidth: 1080,
  transferBytes: 41_233,
  loading: 'eager',
});

/** One page, seen the same way by each device named. */
const page = (image: CapturedImage, devices: DeviceProfile[] = [DESKTOP]): Capture => ({
  url: 'https://example.test/page.html',
  capturedAt: '2026-09-04T00:00:00.000Z',
  devices,
  runs: devices.map((device) => ({
    deviceId: device.id,
    images: [image],
    backgroundImageCount: 0,
  })),
});

/**
 * The trace of a page written to break out of it, read as a whole.
 *
 * A check per field would be a check per call site, and a call site is the
 * thing a contributor adding a line to the trace can forget. So this reads the
 * whole rendered trace instead: whatever line a page string reached, and
 * whatever line is added next, none of these characters is in it.
 */
describe('a trace of a page written to break out of it', () => {
  const trace = formatCapture(hostile());

  it('writes nothing a terminal or a line reader acts on, on any line', () => {
    expect(holding(trace, ACTED_ON)).toEqual([]);
  });

  it('ends no line but its own', () => {
    // Every string in the fixture carries a newline with these words behind
    // it, so a line of the trace starting with them is the page writing a
    // fact — which is the one thing the trace promises a reader.
    const forged = trace.split('\n').filter((line) => line.trimStart().startsWith('FORGED'));

    expect(forged).toEqual([]);
  });
});

describe('the trace, given the attributes the reproduction served', () => {
  it('writes an escape sequence in sizes as the characters that spell it', () => {
    const trace = formatCapture(page({ ...plain(), sizes: '100vw\u001b]0;imgwhy-pwned\u0007' }));

    // Written rather than dropped: `--json` already spells that attribute
    // `100vw\u001b]0;imgwhy-pwned\u0007`, and a trace that spelled it any
    // other way would be two spellings of one attribute out of one run.
    expect(lineWith(trace, '  sizes ')).toContain(
      String.raw`100vw\u001b]0;imgwhy-pwned\u0007`,
    );
    expect(trace).not.toContain('\u001b');
  });

  it('keeps a candidate list a newline would have cut in two on one line', () => {
    const trace = formatCapture(
      page({
        ...plain(),
        candidates: [
          { url: '/a.gif', w: 400, x: null, raw: '400w\u001b[2K\rFORGED CANDIDATE LINE' },
          { url: '/b.gif', w: 800, x: null, raw: '800w' },
        ],
      }),
    );

    const written = trace.split('\n').filter((line) => line.includes('FORGED CANDIDATE LINE'));

    expect(written).toHaveLength(1);
    expect(written[0]).toContain(String.raw`400w\u001b[2K\rFORGED CANDIDATE LINE, 800w`);
  });

  it('spells everything --json spells the way --json spells it', () => {
    // A backslash, BS, TAB, LF, FF, CR, ESC, VT and NUL, written by code
    // because a source file holding them could not be read. Every one is a
    // character `JSON.stringify` escapes too, which is the set this case is
    // about: what makes writing a control character better than dropping it is
    // that one page produces one spelling of one attribute in both of a run's
    // outputs, and that is only true where the two spellings agree.
    const sizes = `100vw${String.fromCharCode(92, 8, 9, 10, 12, 13, 27, 11, 0)}`;

    const trace = formatCapture(page({ ...plain(), sizes }));

    // The Capture's own spelling, with the quotes JSON puts around a string
    // taken off. The double quote is the one character JSON escapes and this
    // does not, because JSON has a delimiter to protect and a line has none.
    expect(lineWith(trace, '  sizes ')).toContain(JSON.stringify(sizes).slice(1, -1));
  });

  it('tells the characters that spell an escape apart from the character they spell', () => {
    // The first page wrote a backslash, a `u` and four digits. The second
    // wrote an ESC. A trace that read back the same for both could not say
    // which one it found, and saying what the attribute held is the whole
    // reason these are written out rather than dropped.
    const written = String.raw`100vw\u001b`;
    const meant = '100vw\u001b';

    const asWritten = lineWith(formatCapture(page({ ...plain(), sizes: written })), '  sizes ');
    const asMeant = lineWith(formatCapture(page({ ...plain(), sizes: meant })), '  sizes ');

    expect(asWritten).not.toBe(asMeant);
    expect(asWritten).toContain(JSON.stringify(written).slice(1, -1));
    expect(asMeant).toContain(JSON.stringify(meant).slice(1, -1));
  });

  it('lines the columns up on rows whose page strings carried control characters', () => {
    const trace = formatCapture(page({ ...plain(), sizes: carrying('100vw') }, [DESKTOP, TABLET]));

    // The header and one row per device, and no more: a page's newline would
    // have made a fourth line out of half a row.
    const rows = tableLines(trace);
    expect(rows).toHaveLength(3);
    // Every column begins at the same offset on every line, which is what a
    // reader running an eye down one of them relies on. The offset is the
    // printed one only because the check above leaves nothing in the trace
    // that a terminal acts on — `say` says where that stops being true.
    expect(rows.map(starts)).toEqual([starts(rows[0]), starts(rows[0]), starts(rows[0])]);
  });
});

/**
 * The Capture, which the trace presents and does not edit.
 *
 * Escaping is presentation, and these two are what says so. A Capture is
 * machine input: `--json` and `--out` carry the page's own bytes, where
 * `JSON.stringify` has already written every control character as its `\u`
 * escape, so that artifact is inert with no help from the trace.
 */
describe('the capture itself, which the trace only presents', () => {
  it('reaches --json with every control character as its JSON escape', () => {
    const json = serializeCapture(hostile());

    expect(holding(json, CONTROL)).toEqual([]);
    expect(json).toContain(String.raw`\u001b`);
    // And it is still the page's Capture: what a parser reads back off stdout
    // is what the runner recorded, character for character.
    expect(JSON.parse(json)).toEqual(hostile());
  });

  it('still holds what the page held after the trace has been written', () => {
    const capture = hostile();

    formatCapture(capture);

    expect(capture).toEqual(hostile());
  });
});
