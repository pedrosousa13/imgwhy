import type { CapturedImage, DeviceProfile } from '@imgwhy/core';
import { explainSelection, parseSrcset } from '@imgwhy/core';
import { describe, expect, it } from 'vitest';
import { readPanel } from '../src/panel.js';
import type { Readout } from '../src/panel.js';

const WIDTHS = '/i/640.png 640w, /i/1080.png 1080w, /i/1920.png 1920w';
const DENSITIES = '/i/200.png 1x, /i/300.png 2x';

const imageOf = (
  srcset: string,
  sizes: string | null,
  renderedWidth = 375,
  // `auto` is a width only for a lazy image, which is the standard's own
  // condition, so a case about `auto` has to say which kind of image it is.
  loading: CapturedImage['loading'] = null,
): CapturedImage => ({
  id: 'main > img',
  selector: 'main > img',
  candidates: parseSrcset(srcset),
  sizes,
  sizesSource: 'img',
  renderedWidth,
  declaresWidth: false,
  currentSrc: '',
  naturalWidth: 0,
  transferBytes: null,
  loading,
});

const deviceOf = (width: number, dpr: number): DeviceProfile => ({
  id: 'typed',
  name: 'typed',
  viewport: { width, height: 800 },
  dpr,
});

/** The readout for one image on one device, the way both callers ask for it. */
const read = (image: CapturedImage, device: DeviceProfile): Readout =>
  readPanel(explainSelection(image, device), image.candidates, device.dpr);

describe('readPanel', () => {
  it('names the clause that matched, out of the several that did not', () => {
    const image = imageOf(WIDTHS, '(min-width: 1000px) 50vw, 100vw');

    expect(read(image, deviceOf(1440, 1)).clause).toBe('(min-width: 1000px) 50vw');
    expect(read(image, deviceOf(375, 2)).clause).toBe('100vw');
  });

  it('resolves the clause to a CSS width and multiplies it by the ratio', () => {
    const readout = read(imageOf(WIDTHS, '100vw'), deviceOf(375, 2));

    expect(readout.cssPx).toBe('375px');
    expect(readout.needed).toBe('750px');
    expect(readout.picked).toBe('1080w');
  });

  it('says why the winner won, with the arithmetic in the sentence', () => {
    expect(read(imageOf(WIDTHS, '100vw'), deviceOf(375, 2)).reason).toBe(
      '375 css px × DPR 2 = 750 physical pixels, and 1080w is the smallest candidate ' +
        'at or above that.',
    );
  });

  it('says the largest stood in where nothing reached the pixels needed', () => {
    expect(read(imageOf(WIDTHS, '100vw'), deviceOf(1440, 3)).reason).toBe(
      '1440 css px × DPR 3 = 4320 physical pixels, and no candidate reaches that, ' +
        'so the largest wins: 1920w.',
    );
  });

  it('marks the candidate that won, and only that one', () => {
    const readout = read(imageOf(WIDTHS, '100vw'), deviceOf(375, 2));

    expect(readout.marks).toEqual(['', '← picked', '']);
  });

  it('reads past sizes where every descriptor is a density, the way a browser does', () => {
    const readout = read(imageOf(DENSITIES, '100vw'), deviceOf(820, 2));

    expect(readout.clause).toBe('x descriptors only');
    expect(readout.cssPx).toBe('—');
    expect(readout.needed).toBe('—');
    expect(readout.picked).toBe('2x');
    expect(readout.reason).toBe('2x is the smallest density at or above DPR 2.');
  });

  it('says the largest density stood in where the ratio ran past every one', () => {
    expect(read(imageOf(DENSITIES, null), deviceOf(393, 3)).reason).toBe(
      'No density reaches DPR 3, so the largest wins: 2x.',
    );
  });

  it('says a clause carrying no length could not be read', () => {
    const readout = read(imageOf(WIDTHS, 'wide'), deviceOf(375, 2));

    expect(readout.clause).toBe('wide');
    expect(readout.cssPx).toBe('unreadable');
    expect(readout.needed).toBe('—');
    expect(readout.picked).toBe('—');
    expect(readout.reason).toBe(
      'The clause wide carries no length to read, and no candidate carries a density, ' +
        'so nothing could be selected.',
    );
  });

  it('names the 100vw default where the page wrote no sizes at all', () => {
    expect(read(imageOf(WIDTHS, null), deviceOf(375, 2)).clause).toBe('absent → 100vw default');
  });

  it('takes the width layout ended at where the clause said auto', () => {
    const readout = read(imageOf(WIDTHS, 'auto', 300, 'lazy'), deviceOf(1440, 2));

    expect(readout.cssPx).toBe('300px');
    expect(readout.needed).toBe('600px');
  });

  it('rounds a fractional width, because a pixel count is what a reader checks', () => {
    const readout = read(imageOf(WIDTHS, '33.33vw'), deviceOf(375, 2.625));

    expect(readout.cssPx).toBe('125px');
    expect(readout.needed).toBe('328px');
  });

  it('says an image with no srcset had nothing to choose between', () => {
    const readout = read(imageOf('', null), deviceOf(375, 2));

    expect(readout.clause).toBe('no srcset');
    expect(readout.picked).toBe('—');
    expect(readout.marks).toEqual([]);
    expect(readout.reason).toBe('The page shipped no srcset, so there was nothing to select.');
  });
});
