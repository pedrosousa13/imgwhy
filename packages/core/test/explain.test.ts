import { describe, expect, it } from 'vitest';
import type { CapturedImage, DeviceProfile, Selection } from '../src/index.js';
import { explainSelection, parseSrcset } from '../src/index.js';

const HERO_SRCSET = '/i/640.png 640w, /i/1080.png 1080w, /i/1920.png 1920w';

/** The design's canonical case: 640 CSS px at DPR 1.5 needs 960, so 1080w. */
const canonical: DeviceProfile = {
  id: 'canonical',
  name: 'Canonical',
  viewport: { width: 640, height: 800 },
  dpr: 1.5,
};

const image = (over: Partial<CapturedImage> = {}): CapturedImage => ({
  id: 'html > body > main > img',
  selector: 'html > body > main > img',
  candidates: parseSrcset(HERO_SRCSET),
  sizes: '100vw',
  sizesSource: 'img',
  renderedWidth: 620,
  declaresWidth: false,
  currentSrc: 'https://example.com/i/1080.png',
  naturalWidth: 1080,
  transferBytes: 118_231,
  loading: null,
  ...over,
});

/**
 * The `width` selection, or a failure naming what came back instead.
 *
 * A Selection carries the arithmetic `sizes` set off in one of its three kinds
 * only, so a check about that arithmetic has to say which kind it expected.
 * Asking through this rather than through a cast means a wrong kind fails the
 * check that asked for it, and says which kind arrived.
 */
function width(selection: Selection): Extract<Selection, { kind: 'width' }> {
  if (selection.kind !== 'width') {
    throw new Error(`expected a width selection, got ${selection.kind}`);
  }
  return selection;
}

describe('explainSelection', () => {
  it('resolves sizes, multiplies by the ratio and names the candidate that wins', () => {
    expect(explainSelection(image(), canonical)).toEqual({
      kind: 'width',
      resolution: { kind: 'length', px: 640, clause: '100vw', cond: null },
      widthFrom: 'sizes',
      cssPx: 640,
      neededPx: 960,
      picked: { url: '/i/1080.png', w: 1080, x: null, raw: '1080w' },
    });
  });

  it('takes the clause a media condition selected, not the first one written', () => {
    const selection = width(
      explainSelection(image({ sizes: '(min-width: 1000px) 50vw, 100vw' }), canonical),
    );

    expect(selection.resolution).toEqual({
      kind: 'length',
      px: 640,
      clause: '100vw',
      cond: null,
    });
    expect(selection.picked?.raw).toBe('1080w');
  });

  it('falls back to the 100vw default when sizes is absent', () => {
    const selection = width(explainSelection(image({ sizes: null }), canonical));

    expect(selection.resolution).toEqual({
      kind: 'default',
      px: 640,
      clause: 'absent → 100vw default',
    });
    expect(selection.cssPx).toBe(640);
    expect(selection.picked?.raw).toBe('1080w');
  });

  it('defers an auto width to the width the element ended up at', () => {
    // `auto` asks layout, and layout is the one thing a Capture already
    // measured. 620 × 1.5 is 930, so 1080w still wins — from a different
    // number, which is what makes the two paths distinguishable.
    //
    // `lazy` is what makes the browser read `auto` at all. An eager image
    // carrying the same attribute is the case below this one.
    const selection = width(
      explainSelection(
        image({ sizes: 'auto', renderedWidth: 620, loading: 'lazy' }),
        canonical,
      ),
    );

    expect(selection.resolution).toEqual({ kind: 'auto', clause: 'auto', cond: null });
    expect(selection.cssPx).toBe(620);
    expect(selection.neededPx).toBe(930);
    expect(selection.picked?.raw).toBe('1080w');
  });

  /**
   * Where the width came from, which is the question a row's own agreement
   * cannot answer for itself.
   *
   * A width `sizes` gave is a figure the page wrote. A width layout gave may be
   * the loaded file's own size, and a pick made against that agrees with the
   * file because the file wrote the number. These four cases are how the two
   * are told apart, and only the last one is a width to distrust.
   */
  describe('where the width came from', () => {
    const lazyAuto = (over: Partial<CapturedImage>): CapturedImage =>
      image({ sizes: 'auto', loading: 'lazy', ...over });

    it('names sizes where a clause resolved to a length', () => {
      expect(width(explainSelection(image(), canonical)).widthFrom).toBe('sizes');
    });

    it('names sizes where auto was ignored, because a clause answered instead', () => {
      // The attribute says `auto` and the browser never read it, so the width
      // is the fallback clause's and there is nothing circular about it.
      const selection = explainSelection(image({ sizes: 'auto, 50vw', loading: null }), canonical);

      expect(width(selection).widthFrom).toBe('sizes');
    });

    it('names a declared width where the page gives the element one', () => {
      expect(width(explainSelection(lazyAuto({ declaresWidth: true }), canonical)).widthFrom).toBe(
        'layout-declared',
      );
    });

    it('names an independent box where the box is not the width of the file', () => {
      // `naturalWidth` is already in CSS pixels, so an element the page never
      // sized is exactly as wide as the file reports. Any other width was
      // somebody else's doing.
      const selection = explainSelection(
        lazyAuto({ declaresWidth: false, renderedWidth: 800, naturalWidth: 640 }),
        canonical,
      );

      expect(width(selection).widthFrom).toBe('layout-independent');
    });

    it('names an independent box where the box is narrower than the file too', () => {
      const selection = explainSelection(
        lazyAuto({ declaresWidth: false, renderedWidth: 400, naturalWidth: 640 }),
        canonical,
      );

      expect(width(selection).widthFrom).toBe('layout-independent');
    });

    it('reads a fractional box as the integer it lands on', () => {
      // A real layout hands back 639.98, and an intrinsic box is the integer.
      const selection = explainSelection(
        lazyAuto({ declaresWidth: false, renderedWidth: 639.98, naturalWidth: 640 }),
        canonical,
      );

      expect(width(selection).widthFrom).toBe('layout-intrinsic');
    });

    it('admits it cannot tell where the box is the width of the file', () => {
      const selection = explainSelection(
        lazyAuto({ declaresWidth: false, renderedWidth: 640, naturalWidth: 640 }),
        canonical,
      );

      expect(width(selection).widthFrom).toBe('layout-intrinsic');
    });

    it('admits it cannot tell where nothing has loaded, so there are no pixels to compare', () => {
      const selection = explainSelection(
        lazyAuto({ declaresWidth: false, renderedWidth: 300, naturalWidth: 0 }),
        canonical,
      );

      expect(width(selection).widthFrom).toBe('layout-intrinsic');
    });
  });

  it('selects nothing when the clause that applied could not be read', () => {
    // `unreadable` is the whole answer: there is no width to report, so the
    // Selection carries no field to report one in, and no reader has to know
    // that a null resolution meant three more nulls behind it.
    expect(explainSelection(image({ sizes: 'fifty percent' }), canonical)).toEqual({
      kind: 'unreadable',
      resolution: { kind: 'error', clause: 'fifty percent' },
      picked: null,
    });
  });

  it('reads past sizes where no candidate carries a w descriptor', () => {
    // A page may write `sizes` on a tag whose srcset is densities only. A
    // browser ignores it, so no resolution is reported: there was none, and a
    // `density` selection has nowhere to put one.
    expect(
      explainSelection(
        image({ candidates: parseSrcset('/i/640.png 1x, /i/1080.png 2x'), sizes: '100vw' }),
        canonical,
      ),
    ).toEqual({ kind: 'density', picked: { url: '/i/1080.png', w: null, x: 2, raw: '2x' } });
  });

  it('consults sizes when a list mixes w and x descriptors, because one w is enough', () => {
    // 1080 over the resolved 640 is a density of 1.6875, which reaches the
    // 1.5 the device asked for and undercuts the 4x. Without the resolved
    // width the w candidate would carry no density at all and the 4x would
    // win by default, so this row says the resolution reached selection.
    const mixed = image({ candidates: parseSrcset('/i/1080.png 1080w, /i/2000.png 4x') });
    const selection = width(explainSelection(mixed, canonical));

    expect(selection.resolution.kind).toBe('length');
    expect(selection.picked?.raw).toBe('1080w');
  });

  it('selects nothing for an image with no srcset at all', () => {
    const selection = explainSelection(image({ candidates: [], sizes: null }), canonical);

    expect(selection).toEqual({ kind: 'density', picked: null });
  });

  it('takes the largest candidate when none reaches the ratio', () => {
    const small = image({ candidates: parseSrcset('/i/320.png 320w, /i/640.png 640w') });
    const selection = width(explainSelection(small, canonical));

    expect(selection.neededPx).toBe(960);
    expect(selection.picked?.raw).toBe('640w');
  });

  it('gives one image two answers on two devices, which is what a matrix shows', () => {
    const desktop: DeviceProfile = {
      id: 'desktop',
      name: 'Desktop',
      viewport: { width: 1440, height: 900 },
      dpr: 1,
    };

    expect(explainSelection(image(), desktop).picked?.raw).toBe('1920w');
    expect(explainSelection(image(), canonical).picked?.raw).toBe('1080w');
  });
});
