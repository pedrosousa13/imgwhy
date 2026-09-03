import { describe, expect, it } from 'vitest';
import type { CapturedImage, DeviceProfile } from '../src/index.js';
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
  currentSrc: 'https://example.com/i/1080.png',
  naturalWidth: 1080,
  transferBytes: 118_231,
  loading: null,
  ...over,
});

describe('explainSelection', () => {
  it('resolves sizes, multiplies by the ratio and names the candidate that wins', () => {
    expect(explainSelection(image(), canonical)).toEqual({
      resolution: { kind: 'length', px: 640, clause: '100vw', cond: null },
      cssPx: 640,
      neededPx: 960,
      picked: { url: '/i/1080.png', w: 1080, x: null, raw: '1080w' },
    });
  });

  it('takes the clause a media condition selected, not the first one written', () => {
    const selection = explainSelection(
      image({ sizes: '(min-width: 1000px) 50vw, 100vw' }),
      canonical,
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
    const selection = explainSelection(image({ sizes: null }), canonical);

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
    const selection = explainSelection(image({ sizes: 'auto', renderedWidth: 620 }), canonical);

    expect(selection.resolution).toEqual({ kind: 'auto', clause: 'auto', cond: null });
    expect(selection.cssPx).toBe(620);
    expect(selection.neededPx).toBe(930);
    expect(selection.picked?.raw).toBe('1080w');
  });

  it('selects nothing when the clause that applied could not be read', () => {
    const selection = explainSelection(image({ sizes: 'fifty percent' }), canonical);

    expect(selection.resolution).toEqual({ kind: 'error', clause: 'fifty percent' });
    expect(selection.cssPx).toBeNull();
    expect(selection.neededPx).toBeNull();
    expect(selection.picked).toBeNull();
  });

  it('reads past sizes where no candidate carries a w descriptor', () => {
    // A page may write `sizes` on a tag whose srcset is densities only. A
    // browser ignores it, so no resolution is reported: there was none.
    const selection = explainSelection(
      image({ candidates: parseSrcset('/i/640.png 1x, /i/1080.png 2x'), sizes: '100vw' }),
      canonical,
    );

    expect(selection.resolution).toBeNull();
    expect(selection.cssPx).toBeNull();
    expect(selection.neededPx).toBeNull();
    expect(selection.picked?.raw).toBe('2x');
  });

  it('consults sizes when a list mixes w and x descriptors, because one w is enough', () => {
    // 1080 over the resolved 640 is a density of 1.6875, which reaches the
    // 1.5 the device asked for and undercuts the 4x. Without the resolved
    // width the w candidate would carry no density at all and the 4x would
    // win by default, so this row says the resolution reached selection.
    const selection = explainSelection(
      image({ candidates: parseSrcset('/i/1080.png 1080w, /i/2000.png 4x') }),
      canonical,
    );

    expect(selection.resolution?.kind).toBe('length');
    expect(selection.picked?.raw).toBe('1080w');
  });

  it('selects nothing for an image with no srcset at all', () => {
    const selection = explainSelection(image({ candidates: [], sizes: null }), canonical);

    expect(selection).toEqual({ resolution: null, cssPx: null, neededPx: null, picked: null });
  });

  it('takes the largest candidate when none reaches the ratio', () => {
    const selection = explainSelection(
      image({ candidates: parseSrcset('/i/320.png 320w, /i/640.png 640w') }),
      canonical,
    );

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
