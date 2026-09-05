import { fileURLToPath } from 'node:url';
import type { Capture, CapturedImage, DeviceProfile } from '@imgwhy/core';
import { parseSrcset } from '@imgwhy/core';
import { describe, expect, it } from 'vitest';
import { read, reaches } from '../../../test/source.js';
import { compareCaptures, formatComparison } from '../src/compare.js';

const DEVICES: DeviceProfile[] = [
  { id: 'iphone-se', name: 'iPhone SE', viewport: { width: 375, height: 667 }, dpr: 2 },
  { id: 'desktop', name: 'Desktop', viewport: { width: 1440, height: 900 }, dpr: 1 },
];

const HERO = 'html > body > main > img';
const LOGO = 'html > body > header > img';

/**
 * Three files to choose between, which is what makes a `sizes` string decide
 * something.
 *
 * At 375 CSS pixels and a ratio of 2 the phone needs 750, so `100vw` takes the
 * 1280 and `50vw` takes the 640. The desktop needs 1440 whatever `sizes` says
 * below it, so it takes the largest offered either way — which is the pair a
 * diff has to keep apart: one device moved and the other did not.
 */
const SRCSET = '/i/320.png 320w, /i/640.png 640w, /i/1280.png 1280w';

/** What one render made of the hero: the string it resolved, and what arrived. */
type Rendered = { sizes: string; bytes: number | null };

const hero = ({ sizes, bytes }: Rendered): CapturedImage => ({
  id: HERO,
  selector: HERO,
  candidates: parseSrcset(SRCSET),
  sizes,
  sizesSource: 'img',
  renderedWidth: 375,
  declaresWidth: false,
  currentSrc: 'https://example.com/i/1280.png',
  naturalWidth: 1280,
  transferBytes: bytes,
  loading: null,
});

/** An image with nothing to select, so its row has no descriptor to move. */
const logo = (bytes: number | null): CapturedImage => ({
  id: LOGO,
  selector: LOGO,
  candidates: [],
  sizes: null,
  sizesSource: 'img',
  renderedWidth: 120,
  declaresWidth: true,
  currentSrc: 'https://example.com/i/logo.png',
  naturalWidth: 120,
  transferBytes: bytes,
  loading: null,
});

/** A Capture of one page, written as what each device run saw. */
const capture = (
  runs: Record<string, CapturedImage[]>,
  devices: DeviceProfile[] = DEVICES,
): Capture => ({
  url: 'https://example.com/',
  capturedAt: '2026-01-01T00:00:00.000Z',
  devices,
  runs: Object.entries(runs).map(([deviceId, images]) => ({
    deviceId,
    images,
    backgroundImageCount: 0,
  })),
});

const diff = (before: Capture, after: Capture): string =>
  formatComparison(compareCaptures(before, after));

/** A row read back as its cells, so a check does not depend on the padding. */
const cells = (line: string): string[] => line.trim().split(/\s{2,}/);

/** The one row a device wrote, or a failure saying how many it wrote. */
function rowFor(output: string, device: string): string[] {
  const found = output.split('\n').filter((line) => cells(line)[0] === device);
  if (found.length !== 1) throw new Error(`${found.length} rows for ${device} in\n${output}`);
  return cells(found[0]);
}

/** The last line, which is where the counts are. */
const summaryOf = (output: string): string => output.split('\n')[output.split('\n').length - 1];

const RENDERED = { sizes: '100vw', bytes: 11573 };

describe('a diff of two captures', () => {
  it('says which file each device picked and what it cost, on both sides', () => {
    const before = capture({
      'iphone-se': [hero({ sizes: '100vw', bytes: 11573 })],
      desktop: [hero({ sizes: '100vw', bytes: 20000 })],
    });
    const after = capture({
      'iphone-se': [hero({ sizes: '50vw', bytes: 6104 })],
      desktop: [hero({ sizes: '100vw', bytes: 20000 })],
    });

    expect(diff(before, after)).toBe(
      [
        `image 1 of 1  ${HERO}`,
        '  iPhone SE  1280w → 640w   11573 → 6104 bytes',
        '  Desktop    1280w → 1280w  unchanged',
        '',
        '1 image changed, 1 got smaller, 0 regressed',
      ].join('\n'),
    );
  });

  it('reports two identical captures as nothing at all, because nothing moved', () => {
    const one = capture({ 'iphone-se': [hero(RENDERED)], desktop: [hero(RENDERED)] });

    expect(diff(one, structuredClone(one))).toBe('0 images changed, 0 got smaller, 0 regressed');
  });

  it('writes no block for an image both captures agree on, so the changed ones read', () => {
    const before = capture({
      'iphone-se': [hero({ sizes: '100vw', bytes: 11573 }), logo(900)],
    });
    const after = capture({
      'iphone-se': [hero({ sizes: '50vw', bytes: 6104 }), logo(900)],
    });

    const output = diff(before, after);

    expect(output).toContain(`image 1 of 2  ${HERO}`);
    expect(output).not.toContain(LOGO);
    expect(summaryOf(output)).toBe('1 image changed, 1 got smaller, 0 regressed');
  });

  it('names an image only one capture carries rather than pairing it with another', () => {
    const before = capture({ 'iphone-se': [hero(RENDERED)] });
    const after = capture({ 'iphone-se': [logo(900)] });

    const output = diff(before, after);

    expect(output.split('\n')).toEqual([
      `image 1 of 2  ${HERO}  gone`,
      '',
      `image 2 of 2  ${LOGO}  added`,
      '',
      '0 images changed, 0 got smaller, 0 regressed, 1 added, 1 gone',
    ]);
  });

  it('names the devices only one capture carried, and diffs the ones both did', () => {
    const before = capture({
      'iphone-se': [hero({ sizes: '100vw', bytes: 11573 })],
      desktop: [hero({ sizes: '100vw', bytes: 20000 })],
    });
    const after = capture(
      { 'iphone-se': [hero({ sizes: '50vw', bytes: 6104 })], tablet: [hero(RENDERED)] },
      [
        DEVICES[0],
        { id: 'tablet', name: 'iPad', viewport: { width: 820, height: 1180 }, dpr: 2 },
      ],
    );

    const output = diff(before, after);

    expect(output.split('\n')[0]).toBe('devices  Desktop only in before, iPad only in after');
    expect(rowFor(output, 'iPhone SE')).toEqual(['iPhone SE', '1280w → 640w', '11573 → 6104 bytes']);
    // The one shared device wrote the one row: neither of the other two has a
    // before and an after to put either side of an arrow.
    expect(output.split('\n').filter((line) => line.startsWith('  '))).toHaveLength(1);
  });

  it('says nothing was compared where no device is in both, rather than "no change"', () => {
    const before = capture({ 'iphone-se': [hero(RENDERED)] }, [DEVICES[0]]);
    const after = capture({ desktop: [hero(RENDERED)] }, [DEVICES[1]]);

    expect(diff(before, after).split('\n')).toEqual([
      'devices  iPhone SE only in before, Desktop only in after',
      '         no device is in both captures, so no image could be compared',
      '',
      '0 images changed, 0 got smaller, 0 regressed',
    ]);
  });

  it('names a device that stopped seeing an image, rather than dropping its row', () => {
    const before = capture({
      'iphone-se': [hero(RENDERED)],
      desktop: [hero({ sizes: '100vw', bytes: 20000 })],
    });
    const after = capture({ 'iphone-se': [hero(RENDERED)], desktop: [] });

    const output = diff(before, after);

    expect(rowFor(output, 'Desktop')).toEqual([
      'Desktop',
      '1280w → (not seen)',
      '20000 → (not seen)',
    ]);
    expect(summaryOf(output)).toBe('1 image changed, 0 got smaller, 0 regressed');
  });
});

describe('what a diff calls a regression', () => {
  const shrankOrGrew = (before: number | null, after: number | null): Capture[] => [
    capture({ 'iphone-se': [hero({ sizes: '100vw', bytes: before })] }, [DEVICES[0]]),
    capture({ 'iphone-se': [hero({ sizes: '100vw', bytes: after })] }, [DEVICES[0]]),
  ];

  it('counts a bigger file for the same device, which is the whole of the rule', () => {
    const [before, after] = shrankOrGrew(6104, 11573);

    expect(compareCaptures(before, after)).toMatchObject({
      changed: 1,
      smaller: 0,
      regressed: 1,
    });
    expect(summaryOf(diff(before, after))).toBe('1 image changed, 0 got smaller, 1 regressed');
  });

  it('counts a smaller file as smaller, and does not also count it as regressed', () => {
    const [before, after] = shrankOrGrew(11573, 6104);

    expect(compareCaptures(before, after)).toMatchObject({ smaller: 1, regressed: 0 });
  });

  it('calls an image that grew on one device regressed, whatever it did on another', () => {
    const before = capture({
      'iphone-se': [hero({ sizes: '100vw', bytes: 6104 })],
      desktop: [hero({ sizes: '100vw', bytes: 20000 })],
    });
    const after = capture({
      'iphone-se': [hero({ sizes: '100vw', bytes: 11573 })],
      desktop: [hero({ sizes: '100vw', bytes: 10000 })],
    });

    expect(compareCaptures(before, after)).toMatchObject({ smaller: 0, regressed: 1 });
  });

  it('reports an image that stopped being weighed as changed, and not as regressed', () => {
    const [before, after] = shrankOrGrew(11573, null);

    expect(compareCaptures(before, after)).toMatchObject({
      changed: 1,
      smaller: 0,
      regressed: 0,
    });
    expect(rowFor(diff(before, after), 'iPhone SE')[2]).toBe('11573 → unknown');
  });

  it('reports a weight that was never recorded before as changed, and not as regressed', () => {
    const [before, after] = shrankOrGrew(null, 11573);

    expect(compareCaptures(before, after)).toMatchObject({ changed: 1, regressed: 0 });
  });

  it('does not call a device that vanished from the set a regression', () => {
    const before = capture({
      'iphone-se': [hero(RENDERED)],
      desktop: [hero({ sizes: '100vw', bytes: 20000 })],
    });
    const after = capture({ 'iphone-se': [hero(RENDERED)] }, [DEVICES[0]]);

    const output = diff(before, after);

    expect(output.split('\n')[0]).toBe('devices  Desktop only in before');
    expect(summaryOf(output)).toBe('0 images changed, 0 got smaller, 0 regressed');
  });

  it('does not call an image that stopped loading a regression, only a change', () => {
    const gone: CapturedImage = { ...hero(RENDERED), currentSrc: '', transferBytes: null };
    const before = capture({ 'iphone-se': [hero(RENDERED)] }, [DEVICES[0]]);
    const after = capture({ 'iphone-se': [gone] }, [DEVICES[0]]);

    expect(compareCaptures(before, after)).toMatchObject({ changed: 1, regressed: 0 });
  });
});

/**
 * The characters a page put in an attribute to be acted on.
 *
 * The same set `escaping.test.ts` writes into a trace, and it arrives here the
 * way `in.test.ts` says it does: a Capture carries every one of them through
 * `JSON.stringify` as an escape, so a Capture read back is how they reach a
 * diff. ESC opens a sequence a terminal executes, the CR and the LF end a line
 * and give the words behind them one of their own, the bidi override displays
 * what follows in the order the page chose, and NUL is the character a length
 * calculation is likeliest to lose.
 */
const CONTROLS = '\u001b]0;imgwhy-pwned\u0007\r\n  Forged  1w → 1w  0 bytes\u0000\u202edesrever\u2028';

/** One string as a page written to break the diff would write it. */
const carrying = (text: string): string => `${text}${CONTROLS}`;

/**
 * Everything a terminal or a line reader acts on, which is the diff's whole
 * alphabet less the backslash it writes them with.
 */
const ACTED_ON = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

describe('a diff of a capture that came off a hostile page', () => {
  /**
   * One image as a page meaning harm described it: an id that ends a line, a
   * descriptor that retitles a window, and a weight this code counted.
   *
   * The candidate is written out rather than parsed, because `raw` is a string
   * a Capture may carry any bytes in — the reader checks it for being a string
   * and for nothing else — and `raw` is what the descriptor column prints.
   */
  const image = (bytes: number): CapturedImage => ({
    id: carrying(HERO),
    selector: carrying(HERO),
    candidates: [{ url: '/i/320.png', w: 320, x: null, raw: carrying('320w') }],
    sizes: '100vw',
    sizesSource: 'img',
    renderedWidth: 375,
    declaresWidth: false,
    currentSrc: carrying('https://example.com/i/320.png'),
    naturalWidth: 320,
    transferBytes: bytes,
    loading: null,
  });

  /**
   * Two devices, one named off the page and one named plainly.
   *
   * The plain one is what gives the two rows a width to disagree about: a cell
   * measured before it was written out pads to the length of the string the
   * page wrote, and the row under it starts five characters early for every
   * control character above.
   */
  const hostile = (phone: number, desk: number): Capture => ({
    url: carrying('https://example.com/'),
    capturedAt: carrying('2026-01-01T00:00:00.000Z'),
    devices: [
      {
        id: carrying('iphone-se'),
        name: carrying('iPhone SE'),
        viewport: { width: 375, height: 667 },
        dpr: 2,
      },
      DEVICES[1],
    ],
    runs: [
      { deviceId: carrying('iphone-se'), images: [image(phone)], backgroundImageCount: 0 },
      { deviceId: 'desktop', images: [image(desk)], backgroundImageCount: 0 },
    ],
  });

  const output = (): string => diff(hostile(11573, 20000), hostile(6104, 20000));

  it('writes every control character out, so a page cannot make a terminal act', () => {
    expect(output().split('\n').filter((line) => ACTED_ON.test(line))).toEqual([]);
  });

  it('forges no row with a newline, because the rows are this code counting', () => {
    // One header, two device rows, the blank line and the summary. A CR or an
    // LF that survived would put the page's own row among them.
    expect(output().split('\n')).toHaveLength(5);
    expect(output().split('\n').filter((line) => line.trimStart().startsWith('Forged'))).toEqual(
      [],
    );
    expect(summaryOf(output())).toBe('1 image changed, 1 got smaller, 0 regressed');
  });

  it('keeps the columns under each other, measuring the width a terminal shows', () => {
    const rows = output().split('\n').filter((line) => line.startsWith('  '));

    // The two rows carry the same descriptor, so the device name is the only
    // column with a width to disagree about — and the last column is where a
    // disagreement shows. A cell measured before it was written out pads to
    // the length of the string the page wrote, and the plain row below starts
    // five characters early for every control character above it.
    expect(rows).toHaveLength(2);
    expect(rows[0].indexOf('11573 → 6104 bytes')).toBe(rows[1].indexOf('unchanged'));
  });
});

/**
 * The provenance rule `out.ts` states, read off the diff's own source: no part
 * of a path may come from the page.
 *
 * `in.ts` is where a Capture is opened, and `in.test.ts` checks that it opens
 * one file at the path its caller named. What is left to check is that nothing
 * downstream of it opens a second: a Capture is a bag of page strings by the
 * time it reaches these two modules, and a module with no way to name a file
 * has no way to build a path out of one.
 */
describe('the diff as a route to the filesystem', () => {
  const source = (name: string): string =>
    read(fileURLToPath(new URL(`../src/${name}`, import.meta.url)));

  it('names no module the command could open a second file with', () => {
    expect([...new Set(reaches(source('diff.ts')).specifiers)]).toEqual([
      './args.js',
      './compare.js',
      './in.js',
      './run.js',
    ]);
  });

  it('leaves the comparison with nothing but core and the escaping to reach for', () => {
    expect([...new Set(reaches(source('compare.ts')).specifiers)]).toEqual([
      '@imgwhy/core',
      './say.js',
    ]);
  });
});
