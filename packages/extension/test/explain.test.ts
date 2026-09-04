import { explainSelection, parseSrcset } from '@imgwhy/core';
import { describe, expect, it } from 'vitest';
import type { Row } from '../src/explain.js';
import { panelOf } from '../src/explain.js';
import { image, reading } from './reading.js';

/**
 * One row's lines as a reader sees them, one per field.
 *
 * `[cache]` stands in for the mark the renderer draws. It is written into the
 * string rather than asserted separately so that a figure losing its mark is a
 * diff on the line it belongs to, which is where a reader would look.
 */
const said = (lines: Row['steps']): string[] =>
  lines.map((line) => `${line.label}  ${line.value}${line.held ? '  [cache]' : ''}`);

/** One field of one row's details, by the label a reader reads it against. */
const valueOf = (row: Row, label: string): string | undefined =>
  row.details.find((line) => line.label === label)?.value;

/** The one row a single-image reading produces, at the default desktop. */
const rowOf = (fields: Parameters<typeof image>[0], dpr = 1, width = 1440): Row => {
  const [row] = panelOf(
    reading({ viewport: { width, height: 900 }, dpr, images: [image(fields)] }),
  ).rows;
  if (row === undefined) throw new Error('the panel explained no image');
  return row;
};

/** The two-candidate `srcset` most cases below choose between. */
const TWO = '/i/640.png 640w, /i/1080.png 1080w';

/**
 * The arithmetic the panel shows, which is core's and not the extension's.
 *
 * The design's Testing section asks for exactly this and for nothing else:
 *
 * > **extension** — test the logic through `core`. Keep the panel thin enough
 * > that it needs no browser test.
 *
 * So this file runs the worker's half — the half that imports core as a module
 * rather than shipping it as text — against readings written by hand. There is
 * no browser in it, and no headless one either: a reading is plain data, and
 * `read.test.ts` is what proves the page produces one.
 *
 * The wording is the command line's wherever the command line has a word for
 * the same thing. `clause used`, `css px`, `needed`, `picked` and `unknown`
 * all come out of `cli/src/trace.ts`, because someone who has read a trace
 * should not have to learn the panel, and a figure that reads differently in
 * two front ends is a figure a reader will assume was computed differently.
 */
describe('the panel the worker computes from a reading', () => {
  it('writes one row per image, in the order the page holds them', () => {
    const panel = panelOf(
      reading({
        images: [
          image({ selector: 'html > body > img:nth-of-type(1)' }),
          image({ selector: 'html > body > img:nth-of-type(2)' }),
          image({ selector: 'html > body > figure > img' }),
        ],
      }),
    );

    expect(panel.rows.map((row) => valueOf(row, 'selector'))).toEqual([
      'html > body > img:nth-of-type(1)',
      'html > body > img:nth-of-type(2)',
      'html > body > figure > img',
    ]);
  });

  it('heads the panel with the two inputs every row names, and the count', () => {
    // Width and ratio as two fields rather than one line, because they are
    // the inputs that explain every row and the panel lays them out as such.
    expect(panelOf(reading({ viewport: { width: 393, height: 852 }, dpr: 3 })).head).toEqual({
      width: '393 px',
      dpr: 'DPR 3 (retina)',
      images: '0 images',
    });
    expect(panelOf(reading({ images: [image()] })).head.images).toBe('1 image');
  });

  it('says retina where the ratio is two or more, standard at one, and nothing in between', () => {
    // "Was it retina?" is the reader's word for it, so the panel says it. Two
    // is where the word was coined and where every phone sits; one is a
    // standard display; the Windows scaling steps between are neither, and
    // get no word rather than a wrong one.
    expect(panelOf(reading({ dpr: 1 })).head.dpr).toBe('DPR 1 (standard)');
    expect(panelOf(reading({ dpr: 1.5 })).head.dpr).toBe('DPR 1.5');
    expect(panelOf(reading({ dpr: 2 })).head.dpr).toBe('DPR 2 (retina)');
    expect(panelOf(reading({ dpr: 3 })).head.dpr).toBe('DPR 3 (retina)');
  });

  it('shows the arithmetic as steps for a w descriptor: sizes, clause, width, pixels, candidates', () => {
    expect(
      said(
        rowOf({
          srcset: TWO,
          sizes: '(max-width: 768px) 100vw, 33vw',
          renderedWidth: 475,
          renderedHeight: 317,
          currentSrc: 'https://example.com/i/640.png',
        }).steps,
      ),
    ).toEqual([
      'sizes  (max-width: 768px) 100vw, 33vw',
      'clause used  33vw',
      'css px  475px',
      'needed  475px × DPR 1 = 475px',
      'candidates  640w (picked), 1080w',
    ]);
  });

  it('marks the loaded candidate on the one line where it differs from the pick', () => {
    // The candidate list is the one line a reader compares: every descriptor
    // on offer, the pick marked, and the loaded one marked only where it is
    // not the pick — the headline already says what loaded.
    expect(
      said(
        rowOf({
          srcset: TWO,
          sizes: '33vw',
          renderedWidth: 475,
          currentSrc: 'https://example.com/i/1080.png',
        }).steps,
      ),
    ).toContain('candidates  640w (picked), 1080w (loaded)');
  });

  it('agrees with core on the case the design works out by hand', () => {
    // > A 640px viewport at DPR 1.5 needs 960 physical pixels. It downloads the
    // > 1080w file. The element width never entered the calculation.
    //
    // Asserted twice over: once as the line a reader sees, and once against
    // `explainSelection` called directly. The second is what says the panel
    // asked core rather than arriving at the same answer on its own — a
    // reimplementation that agreed on this case would still be a
    // reimplementation, and `through-core.test.ts` is what refuses one.
    const live = image({ srcset: TWO, sizes: '100vw', renderedWidth: 320 });
    const row = panelOf(reading({ viewport: { width: 640, height: 960 }, dpr: 1.5, images: [live] }))
      .rows[0];

    expect(said(row.steps)).toContain('needed  640px × DPR 1.5 = 960px');
    expect(said(row.steps)).toContain('candidates  640w, 1080w (picked)');

    const selection = explainSelection(
      {
        id: live.selector,
        selector: live.selector,
        candidates: parseSrcset(live.srcset),
        sizes: live.sizes,
        sizesSource: live.sizesSource,
        renderedWidth: live.renderedWidth,
        currentSrc: live.currentSrc,
        naturalWidth: 0,
        transferBytes: null,
        loading: live.loading,
      },
      { id: 'live', name: 'this browser', viewport: { width: 640, height: 960 }, dpr: 1.5 },
    );
    expect(selection.picked?.raw).toBe('1080w');
  });

  it('says the ratio decided alone where no candidate carries a w descriptor', () => {
    // Core's `density` selection, worded. `sizes` never entered, so there is no
    // clause to name and no width to show — and the panel says which of those
    // it is rather than leaving empty cells.
    expect(said(rowOf({ srcset: '/i/a.png 1x, /i/b.png 2x' }, 2).steps)).toEqual([
      'clause used  x descriptors only',
      'needed  DPR 2 (retina)',
      'candidates  1x, 2x (picked)',
    ]);
  });

  it('still shows a sizes string the browser read past, because the page wrote one', () => {
    // A page may write `sizes` on a densities-only `srcset`, and a browser
    // ignores it. Dropping the line would leave a reader who can see the
    // attribute in DevTools with no answer about it at all.
    expect(said(rowOf({ srcset: '/i/a.png 1x, /i/b.png 2x', sizes: '50vw' }).steps)).toContain(
      'sizes  50vw',
    );
  });

  it('names the element a sizes string came off, where it was not the img', () => {
    expect(
      said(
        rowOf({
          srcset: '/i/200.png 200w, /i/300.png 300w',
          sizes: '50vw',
          sizesSource: 'source',
        }).steps,
      ),
    ).toContain('sizes  50vw from a matching <source>');
  });

  it('says a sizes string is absent where no clause was written at all', () => {
    expect(said(rowOf({ srcset: TWO }).steps)).toEqual([
      'sizes  (absent)',
      'clause used  absent → 100vw default',
      'css px  1440px',
      'needed  1440px × DPR 1 = 1440px',
      'candidates  640w, 1080w (picked)',
    ]);
  });

  it('names the clause at fault where a length could not be read, and picks nothing', () => {
    expect(said(rowOf({ srcset: TWO, sizes: '(min-width: 100px) wide' }).steps)).toEqual([
      'sizes  (min-width: 100px) wide',
      'clause used  (min-width: 100px) wide',
      'css px  unreadable',
      'needed  —',
      'candidates  640w, 1080w',
    ]);
  });

  it('stops at one step where there was nothing to select between', () => {
    // A 1×1 tracking pixel and an image the page never shows are both bytes the
    // browser went and got, so neither is filtered out — but neither has a
    // choice to explain, and a column of dashes would bury the images that
    // do choose. `trace.ts` collapses the same case for the same reason.
    expect(said(rowOf({ currentSrc: 'https://example.com/px.gif' }).steps)).toEqual([
      'candidates  (no srcset)',
    ]);
    expect(said(rowOf({ srcset: '/i/one.png 800w' }).steps)).toEqual(['candidates  800w']);
  });

  it('marks the loaded file on every row a file loaded, held copy or not', () => {
    // The mark is not a warning about this image. It is a statement about what
    // the figure is: `currentSrc` is what the browser has, and a browser that
    // has a larger variant already never ran selection at all. There is no
    // reading of the page that can tell the two apart, so the mark cannot be
    // conditional on anything about the cache — only on there being a file for
    // the cache to have supplied.
    const panel = panelOf(
      reading({
        images: [
          image({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/1080.png' }),
          image({ currentSrc: 'https://example.com/px.gif' }),
          image({ srcset: TWO, sizes: '100vw' }),
        ],
      }),
    );

    expect(panel.rows.map((row) => row.details.filter((line) => line.held).map((l) => l.label))).toEqual([
      ['loaded'],
      ['loaded'],
      [],
    ]);
    expect(panel.rows.map((row) => row.mark)).toEqual([
      'what the browser has, not what it chose',
      'what the browser has, not what it chose',
      null,
    ]);
  });

  it('marks the width an auto clause resolved to, and every figure under it', () => {
    // The design's failure mode 1, arriving as arithmetic rather than as a
    // loaded file. `auto` defers to layout, so core answers with the width the
    // element ended up at — and for an image the page gives no width of its
    // own, the width it ended up at is the width of whichever file the browser
    // already held. So `css px` and `needed` descend from a held copy, and a
    // prediction that agrees with `loaded` here agrees because one produced
    // the other. Cache-cold, the same page lays the image out at nothing and
    // picks nothing.
    const row = rowOf(
      {
        srcset: '/i/400.png 400w, /i/1200.png 1200w',
        sizes: 'auto',
        renderedWidth: 1200,
        renderedHeight: 800,
        currentSrc: 'https://example.com/i/1200.png',
        loading: 'lazy',
      },
      2,
    );

    expect(said(row.steps)).toEqual([
      'sizes  auto',
      'clause used  auto',
      'css px  1200px  [cache]',
      'needed  1200px × DPR 2 = 2400px  [cache]',
      'candidates  400w, 1200w (picked)',
    ]);
    expect(row.why).toBe(
      'Your screen is 1440 px wide at DPR 2 (retina); sizes is auto, and the width came from ' +
        'layout: 1200 px, so it needs 2400 device pixels — no file covers that, so 1200w, the ' +
        'largest on offer, is stretched to fit; add a candidate above 1200w.',
    );
    expect(row.mark).toBe(
      'what the browser has, not what it chose — and the width above descends from it',
    );
    expect(row.notes).toEqual([
      'sizes resolved to auto, so the width above is the width this render laid the image out ' +
        'at — and for an image the page gives no width of its own, that is the width of ' +
        'whichever file the browser already held. Every marked figure descends from it, so a ' +
        'prediction that agrees with the loaded file may agree because one produced the other. ' +
        'An empty cache is the only way to tell.',
    ]);
  });

  it('writes no note where the arithmetic needs none', () => {
    // The cache argument for a disagreement now lives in the row's own
    // sentence, so a note repeating it would be the same prose twice.
    expect(
      rowOf({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' })
        .notes,
    ).toEqual([]);
  });

  it('explains the mark once, and what the extension cannot measure', () => {
    const panel = panelOf(reading());

    expect(panel.footer).toEqual([
      'A marked figure is what the browser has, not what it chose. A browser holding a larger ' +
        'variant reuses it and selection never runs, so nothing marked can be read as the ' +
        'outcome of the arithmetic above.',
      'bytes is unknown here and stays unknown. transferSize reads zero for a cross-origin ' +
        'response without Timing-Allow-Origin, so a page cannot weigh most of the images on it — ' +
        'and imgwhy never guesses a weight from pixels. Run the command line for measured bytes.',
    ]);
  });

  it('counts the CSS background images and explains nothing further about them', () => {
    // The design's non-goal, stated in the panel because a list of every
    // `<img>` reads like a list of every image, and on a page that paints its
    // hero in CSS it is not one.
    expect(panelOf(reading({ backgroundImageCount: 3 })).footer).toContain(
      '3 elements on this page paint a CSS background image. A CSS background image has no ' +
        'selection mechanism at all, so imgwhy counts them and explains nothing further.',
    );
    expect(panelOf(reading({ backgroundImageCount: 1 })).footer).toContain(
      '1 element on this page paints a CSS background image. A CSS background image has no ' +
        'selection mechanism at all, so imgwhy counts them and explains nothing further.',
    );
  });

  it('says nothing at all where no background was painted', () => {
    expect(panelOf(reading()).footer).toHaveLength(2);
  });
});

/**
 * The one sentence per row, which is the whole of what the maintainer asked
 * for: "I literally need to know which one got loaded and why. Succinctly."
 *
 * One template per outcome, and every template has the same shape — the
 * outcome, then the causal chain from the reader's device through `sizes` to
 * the pixels needed, then, where the outcome is a warning, what to do about
 * it. The device is named in every sentence on purpose: the reader's question
 * was "is it because of my device?", and the answer has to say *yes, these two
 * numbers* on the line they are looking at rather than in the head.
 *
 * Every number in every sentence is core's, formatted. Nothing here is
 * recomputed, and `through-core.test.ts` refuses the operators that would let
 * it be.
 */
describe('the sentence that says which file loaded and why', () => {
  const at = (fields: Parameters<typeof image>[0], dpr = 1, width = 1440): string =>
    rowOf(fields, dpr, width).why;

  it('width-selected and it fit: names the device, the clause, the pixels, and the pick', () => {
    expect(
      at({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/640.png' }),
    ).toBe(
      'Your screen is 1440 px wide at DPR 1 (standard); sizes gives it 33vw, which is 475 px, so ' +
        'it needs 475 device pixels — and 640w is the smallest file that covers that.',
    );
  });

  it('width-selected and a larger file loaded: says the pick, then the likely cause, then the cure', () => {
    // The cause is named as a likelihood rather than as a fact, because a
    // larger file than the pick is equally consistent with a viewport that
    // shrank after load and with script that rewrote either attribute.
    expect(at({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' })).toBe(
      'The arithmetic picks 640w — your screen is 1440 px wide at DPR 1 (standard); sizes gives ' +
        'it 33vw, which is 475 px, so it needs 475 device pixels — but the browser loaded 1080w, ' +
        'which is larger. A held copy reused rather than chosen again is the likeliest cause, ' +
        'and a viewport that shrank after load or script that rewrote sizes or srcset would read ' +
        'the same; an empty cache is the only way to see the real pick.',
    );
  });

  it('width-selected and nothing covers it: says the largest stood in, and what to add', () => {
    expect(at({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/1080.png' }, 3)).toBe(
      'Your screen is 1440 px wide at DPR 3 (retina); sizes gives it 100vw, which is 1440 px, so ' +
        'it needs 4320 device pixels — no file covers that, so 1080w, the largest on offer, is ' +
        'stretched to fit; add a candidate above 1080w.',
    );
  });

  it('width-selected and a smaller file loaded: says what it falls short of, and where to look', () => {
    expect(at({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png' })).toBe(
      'The arithmetic picks 1080w — your screen is 1440 px wide at DPR 1 (standard); sizes gives ' +
        'it 100vw, which is 1440 px, so it needs 1440 device pixels — but the browser loaded ' +
        '640w, which does not cover the pixels needed above, so the image is upscaled wherever ' +
        'the page draws it at that size; check what set this src.',
    );
  });

  it('width-selected and nothing loaded yet: says so, and what the arithmetic will pick', () => {
    expect(at({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: '' })).toBe(
      'Nothing has loaded yet; when it does, the arithmetic picks 640w — your screen is 1440 px ' +
        'wide at DPR 1 (standard); sizes gives it 33vw, which is 475 px, so it needs 475 device ' +
        'pixels.',
    );
  });

  it('width-selected and the loaded file is not a candidate: says so rather than guessing', () => {
    expect(at({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/other.png' })).toBe(
      'The arithmetic picks 640w — your screen is 1440 px wide at DPR 1 (standard); sizes gives ' +
        'it 33vw, which is 475 px, so it needs 475 device pixels — but the loaded file is not ' +
        'one the srcset offers; check what set this src.',
    );
  });

  it('words each kind of sizes resolution as its own cause', () => {
    // A pixel length is not followed by "which is N px", because that would say
    // the number twice. A clause with a condition is named whole, so a reader
    // can see which one matched at this viewport. The two defaults are two
    // findings about the page, and are told apart.
    const loaded = 'https://example.com/i/640.png';
    expect(at({ srcset: TWO, sizes: '580px', currentSrc: loaded })).toContain(
      '; sizes gives it 580px, so it needs 580 device pixels',
    );
    expect(at({ srcset: TWO, sizes: '(max-width: 768px) 100vw, 33vw', currentSrc: loaded }, 1, 600)).toContain(
      '; sizes matched (max-width: 768px) 100vw, which is 600 px, so it needs 600 device pixels',
    );
    expect(at({ srcset: TWO, sizes: null, currentSrc: 'https://example.com/i/1080.png' })).toContain(
      '; no sizes is written, and the 100vw default gives it 1440 px, so it needs 1440 device pixels',
    );
    expect(
      at({ srcset: TWO, sizes: '(min-width: 2000px) 50vw', currentSrc: 'https://example.com/i/1080.png' }),
    ).toContain('; no sizes clause matched, and the 100vw default gives it 1440 px, so it needs 1440');
  });

  it('density-selected and it fit: names the ratio, and that sizes never entered', () => {
    expect(at({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' }, 2)).toBe(
      'Your screen is DPR 2 (retina) and no candidate carries a width, so the ratio decided ' +
        'alone — and 2x is the smallest density at or above it.',
    );
  });

  it('density-selected and no candidate reaches the ratio: says the densest stood in', () => {
    expect(at({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' }, 3)).toBe(
      'Your screen is DPR 3 (retina) and no candidate carries a width, so the ratio decided ' +
        'alone — no candidate reaches that, so 2x, the densest on offer, is stretched to fit; add ' +
        'a candidate above 2x.',
    );
  });

  it('density-selected and a denser file loaded: says the pick, then the held copy', () => {
    expect(at({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' })).toBe(
      'The arithmetic picks 1x — your screen is DPR 1 (standard) and no candidate carries a ' +
        'width, so the ratio decided alone — but the browser loaded 2x, which is larger. A held ' +
        'copy reused rather than chosen again is the likeliest cause, and a viewport that shrank ' +
        'after load or script that rewrote sizes or srcset would read the same; an empty cache ' +
        'is the only way to see the real pick.',
    );
  });

  it('unreadable sizes with nothing to pick: names the clause at fault, and what to fix', () => {
    expect(at({ srcset: TWO, sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/640.png' })).toBe(
      'The sizes clause (min-width: 100px) wide could not be read as a length, so there is no ' +
        'width to select against and nothing was picked; fix the sizes attribute.',
    );
  });

  it('unreadable sizes with an x candidate to fall back on: says only those were judged', () => {
    expect(
      at(
        { srcset: '/i/640.png 640w, /i/hi.png 2x', sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/hi.png' },
        2,
      ),
    ).toBe(
      'The sizes clause (min-width: 100px) wide could not be read as a length, so only the x ' +
        'candidates could be judged against DPR 2 (retina) — and 2x is the smallest density at ' +
        'or above it.',
    );
  });

  it('no srcset: says the device made no difference, and where the one file came from', () => {
    expect(at({ currentSrc: 'https://example.com/px.gif' })).toBe(
      'No srcset, so your device made no difference here; the src attribute is the only file on offer.',
    );
  });

  it('one candidate: says the device made no difference', () => {
    expect(at({ srcset: '/i/one.png 800w', currentSrc: 'https://example.com/i/one.png' })).toBe(
      'Only one file on offer, so your device made no difference here.',
    );
  });

  it('every candidate one file: says so once, rather than pretending a choice was made', () => {
    // The maintainer's screenshot: a `1×1` overlay offering nine descriptors
    // that all resolve to `clear.png`. The arithmetic ran and picked one of
    // them, and it made no difference to the bytes.
    expect(
      at({ srcset: '/clear.png 320w, /clear.png 640w, /clear.png 1280w', sizes: '100vw', currentSrc: 'https://example.com/clear.png' }),
    ).toBe(
      'All 3 candidates name one file, so your device made no difference here — the descriptors ' +
        'differ and the bytes do not.',
    );
  });
});

/**
 * The verdict, which is the word a reader takes in before any other.
 *
 * "At a glance, I need to know if it's correct or not." One word per row, in
 * one of three tones, and derived by comparison alone: whether the loaded file
 * is the one core picked, and whether the pick covers the pixels core says are
 * needed. Every category is pinned here for every kind of `Selection` that can
 * produce it.
 */
describe('the verdict a row leads with', () => {
  const verdictOf = (fields: Parameters<typeof image>[0], dpr = 1): [string, string] => {
    const { verdict } = rowOf(fields, dpr);
    return [verdict.word, verdict.tone];
  };

  it('is fit, and quiet about it, where the loaded file is the pick and covers the need', () => {
    expect(verdictOf({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/640.png' })).toEqual(['fit', 'good']);
    expect(verdictOf({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' }, 2)).toEqual(['fit', 'good']);
    expect(
      verdictOf({ srcset: '/i/640.png 640w, /i/hi.png 2x', sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/hi.png' }, 2),
    ).toEqual(['fit', 'good']);
  });

  it('is oversized where a larger candidate than the pick loaded', () => {
    expect(verdictOf({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' })).toEqual(['oversized', 'warn']);
    expect(verdictOf({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' })).toEqual(['oversized', 'warn']);
    expect(
      verdictOf({ srcset: '/i/lo.png 1x, /i/hi.png 2x', sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/hi.png' }),
    ).toEqual(['oversized', 'warn']);
  });

  it('is undersized where the loaded file does not cover the pixels needed', () => {
    // Two routes to the same stretched image: no candidate covers it and the
    // largest stood in, or something loaded a file smaller than the pick.
    expect(verdictOf({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/1080.png' }, 3)).toEqual(['undersized', 'warn']);
    expect(verdictOf({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png' })).toEqual(['undersized', 'warn']);
    expect(verdictOf({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' }, 3)).toEqual(['undersized', 'warn']);
    expect(
      verdictOf({ srcset: '/i/640.png 640w, /i/hi.png 2x', sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/hi.png' }, 3),
    ).toEqual(['undersized', 'warn']);
  });

  it('is no choice where the device had no say', () => {
    expect(verdictOf({ currentSrc: 'https://example.com/px.gif' })).toEqual(['no choice', 'quiet']);
    expect(verdictOf({ srcset: '/i/one.png 800w', currentSrc: 'https://example.com/i/one.png' })).toEqual(['no choice', 'quiet']);
    expect(
      verdictOf({ srcset: '/clear.png 320w, /clear.png 640w', sizes: '100vw', currentSrc: 'https://example.com/clear.png' }),
    ).toEqual(['no choice', 'quiet']);
  });

  it('is not loaded where there is no file to judge yet', () => {
    expect(verdictOf({ srcset: TWO, sizes: '33vw', currentSrc: '' })).toEqual(['not loaded', 'quiet']);
    expect(verdictOf({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: '' })).toEqual(['not loaded', 'quiet']);
  });

  it('is unknown where the comparison cannot settle it, and never a guess', () => {
    expect(verdictOf({ srcset: TWO, sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/640.png' })).toEqual(['unknown', 'quiet']);
    expect(verdictOf({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/other.png' })).toEqual(['unknown', 'quiet']);
  });

  it('carries every warning with a clause saying what to do', () => {
    // A warning with no action is noise. Every `warn` sentence names a cure
    // after its semicolon.
    const warned = [
      rowOf({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' }),
      rowOf({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/1080.png' }, 3),
      rowOf({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png' }),
    ];

    for (const row of warned) {
      expect(row.verdict.tone).toBe('warn');
      expect(row.why).toMatch(/; (?:an empty cache is the only way|add a candidate|check what set)/);
    }
  });
});

/**
 * The six readings the review of #24 found the verdict confidently wrong about.
 *
 * Each is written as the reviewer reproduced it — a call into `panelOf` and the
 * whole reading it produced — because the defect in every one of them was the
 * wording rather than the arithmetic. Core picked the file a browser picks in
 * all six; what was wrong was what the panel said about the pick, and a verdict
 * is the first thing a reader takes from a row.
 *
 * The order is the issue's, worst first.
 */
describe('the verdict, where a reading could confirm itself or blame the wrong thing', () => {
  it('does not confirm an auto width with the file that produced it', () => {
    // Finding 1. The held file laid the image out, that width became `needed`,
    // and `needed` produced the pick — so a pick agreeing with the loaded file
    // agrees because one produced the other. The marks and the note were both
    // there and the verdict still read plain good, which is the panel being
    // quietest exactly where it knows least.
    const row = rowOf({
      srcset: TWO,
      sizes: 'auto',
      renderedWidth: 1080,
      currentSrc: 'https://example.com/i/1080.png',
    });

    expect([row.verdict.word, row.verdict.tone]).toEqual(['circular', 'quiet']);
    expect(row.why).toBe(
      'Your screen is 1440 px wide at DPR 1 (standard); sizes is auto, and the width came from ' +
        'layout: 1080 px, so it needs 1080 device pixels — and 1080w is the smallest file that ' +
        'covers that. But that width came from layout, and for an image the page gives no width ' +
        'of its own the layout width is the width of the file the browser already held — so the ' +
        'pick may agree with the loaded file because one produced the other; an empty cache is ' +
        'the only way to tell.',
    );
  });

  it('counts the src attribute as the 1x candidate HTML says it is', () => {
    // Finding 2. Select-an-image-source appends `src` to the source set when no
    // candidate carries a `w` descriptor and none is already 1x, so there were
    // two candidates here and the device ratio decided between them alone. The
    // row read `no choice` — "your device made no difference here" — which is
    // false at DPR 1 and false at DPR 2.
    const offered = {
      srcset: '/i/hi.png 2x',
      srcAttribute: '/i/lo.png',
      currentSrc: 'https://example.com/i/lo.png',
    };

    const one = rowOf(offered);
    expect([one.verdict.word, one.verdict.tone]).toEqual(['fit', 'good']);
    expect(one.loaded).toBe('src (1x)');
    expect(one.why).toBe(
      'Your screen is DPR 1 (standard) and no candidate carries a width, so the ratio decided ' +
        'alone — and src (1x) is the smallest density at or above it.',
    );
    expect(said(one.steps)).toEqual([
      'clause used  x descriptors only',
      'needed  DPR 1 (standard)',
      'candidates  2x, src (1x) (picked)',
    ]);

    // The same tag on a retina screen, where the ratio picks the other one.
    const two = rowOf(offered, 2);
    expect([two.verdict.word, two.verdict.tone]).toEqual(['undersized', 'warn']);
    expect(two.why).toBe(
      'The arithmetic picks 2x — your screen is DPR 2 (retina) and no candidate carries a ' +
        'width, so the ratio decided alone — but the browser loaded src (1x), which does not ' +
        'cover the pixels needed above, so the image is upscaled wherever the page draws it at ' +
        'that size; check what set this src.',
    );
  });

  it('leaves a src attribute out where the srcset already answers for it', () => {
    // The other half of the same rule, and the half a careless reading breaks.
    // A `w` descriptor anywhere means a browser reads past `src` entirely; a
    // candidate already at 1x means the src is not appended either; and a page
    // with no `srcset` at all still gets the sentence that names where its one
    // file came from rather than a candidate list of one.
    expect(
      said(
        rowOf({
          srcset: TWO,
          sizes: '100vw',
          srcAttribute: '/i/fallback.png',
          currentSrc: 'https://example.com/i/1080.png',
        }).steps,
      ),
    ).toContain('candidates  640w, 1080w (picked)');
    expect(
      said(
        rowOf({
          srcset: '/i/a.png 1x, /i/b.png 2x',
          srcAttribute: '/i/a.png',
          currentSrc: 'https://example.com/i/a.png',
        }).steps,
      ),
    ).toContain('candidates  1x (picked), 2x');
    expect(
      rowOf({ srcAttribute: '/i/one.png', currentSrc: 'https://example.com/i/one.png' }).why,
    ).toBe(
      'No srcset, so your device made no difference here; the src attribute is the only file on ' +
        'offer.',
    );
  });

  it('says a zero width is a box this render drew, and blames no descriptor for it', () => {
    // Finding 3. A `sizesPx` of zero is unknown to core, so nothing is picked —
    // and the row read `unknown` with "fix the srcset", which is a lazy image
    // below the fold being told its perfectly good `srcset` is broken.
    const row = rowOf({ srcset: TWO, sizes: 'auto', renderedWidth: 0, loading: 'lazy' });

    expect([row.verdict.word, row.verdict.tone]).toEqual(['no width', 'quiet']);
    expect(row.why).toBe(
      'Sizes is auto, and the width came from layout: 0 px, so there was no width to select ' +
        'against and nothing was picked — an image this render drew no box for, such as a lazy ' +
        'one below the fold, is the ordinary cause. The srcset is not what to look at here.',
    );
    // And the same for a page that wrote the zero itself, which is the other
    // way core arrives at no width at all.
    expect(rowOf({ srcset: TWO, sizes: '0px' }).why).toBe(
      'Sizes gives it 0px, so there was no width to select against and nothing was picked — an ' +
        'image this render drew no box for, such as a lazy one below the fold, is the ordinary ' +
        'cause. The srcset is not what to look at here.',
    );
  });

  it('names a held copy as the likely cause of a larger file rather than as the cause', () => {
    // Finding 4's first half. A larger file than the pick is equally consistent
    // with a viewport that shrank after load, with script that rewrote `sizes`
    // or `srcset`, and with a layout that changed — so the sentence says what
    // is known and names the likeliest cause as a likelihood.
    expect(
      rowOf({
        srcset: TWO,
        sizes: '33vw',
        renderedWidth: 475,
        currentSrc: 'https://example.com/i/1080.png',
      }).why,
    ).toBe(
      'The arithmetic picks 640w — your screen is 1440 px wide at DPR 1 (standard); sizes gives ' +
        'it 33vw, which is 475 px, so it needs 475 device pixels — but the browser loaded 1080w, ' +
        'which is larger. A held copy reused rather than chosen again is the likeliest cause, ' +
        'and a viewport that shrank after load or script that rewrote sizes or srcset would read ' +
        'the same; an empty cache is the only way to see the real pick.',
    );
  });

  it('claims a stretch only where the loaded file falls short of the figure above', () => {
    // Finding 4's second half. "So the image is stretched to fit" was asserted
    // of a smaller file without saying against what: the pixels needed are what
    // `sizes` asked for, not what the page drew, so the honest claim names the
    // figure the row already shows and says the upscale follows from it.
    expect(
      rowOf({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png' }).why,
    ).toBe(
      'The arithmetic picks 1080w — your screen is 1440 px wide at DPR 1 (standard); sizes gives ' +
        'it 100vw, which is 1440 px, so it needs 1440 device pixels — but the browser loaded ' +
        '640w, which does not cover the pixels needed above, so the image is upscaled wherever ' +
        'the page draws it at that size; check what set this src.',
    );
  });

  it('ranks two candidates at one descriptor as neither larger nor smaller', () => {
    // Finding 5. `>` with an else made equal fall through to "smaller, so the
    // image is stretched to fit" — same width, no stretch. Two files at one
    // descriptor are the same number of pixels whichever the browser took.
    const row = rowOf({
      srcset: '/i/a.png 640w, /i/b.png 640w',
      sizes: '320px',
      currentSrc: 'https://example.com/i/b.png',
    });

    expect([row.verdict.word, row.verdict.tone]).toEqual(['fit', 'good']);
    expect(row.why).toBe(
      'Your screen is 1440 px wide at DPR 1 (standard); sizes gives it 320px, so it needs 320 ' +
        'device pixels — and 640w is the smallest file that covers that. The browser loaded ' +
        '640w, which is a different file at the same descriptor, so the pixels are the same ' +
        'either way.',
    );

    // And where neither of the two covers the need, the stretch is the
    // srcset's and not the browser's — the tie is still a tie.
    const short = rowOf({
      srcset: '/i/a.png 640w, /i/b.png 640w',
      sizes: '100vw',
      currentSrc: 'https://example.com/i/a.png',
    });
    expect([short.verdict.word, short.verdict.tone]).toEqual(['undersized', 'warn']);
    expect(short.why).toBe(
      'Your screen is 1440 px wide at DPR 1 (standard); sizes gives it 100vw, which is 1440 px, ' +
        'so it needs 1440 device pixels — no file covers that, so 640w, the largest on offer, is ' +
        'stretched to fit; add a candidate above 640w. The browser loaded 640w, which is a ' +
        'different file at the same descriptor, so the pixels are the same either way.',
    );
  });

  it('is fit for a coarse candidate list, because the browser chose correctly', () => {
    // Finding 6, resolved by the maintainer as a narrowing rather than a code
    // change: 640w genuinely is the smallest candidate covering 100 px, so as a
    // verdict on the browser's choice `fit` is correct. The 6.4× oversupply is
    // the page's, and detecting it needs a ratio — a division the extension is
    // forbidden. So `oversized` means only "a larger candidate than the pick
    // loaded", and this reading is pinned as right rather than fixed.
    const row = rowOf({ srcset: TWO, sizes: '100px', currentSrc: 'https://example.com/i/640.png' });

    expect([row.verdict.word, row.verdict.tone]).toEqual(['fit', 'good']);
    expect(row.why).toBe(
      'Your screen is 1440 px wide at DPR 1 (standard); sizes gives it 100px, so it needs 100 ' +
        'device pixels — and 640w is the smallest file that covers that.',
    );
  });
});

/**
 * What a row says about which image it is, which is the issue's own complaint:
 *
 * > A row is headed by a DOM path […] and names files by a shortened last path
 * > segment, so a reader looking at a page cannot tell which row is the hero
 * > and which is a 20px icon.
 *
 * And this slice's addition, from the maintainer: "need to know the size that
 * loaded like was it 640vw? which one? simple stuff." So the headline is the
 * descriptor of the file that loaded, the name beside it is the file-name
 * segment, and the whole URL is in the details.
 */
describe('what a row says about which image it is', () => {
  it('heads the row with the descriptor of the file that loaded', () => {
    expect(rowOf({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/640.png' }).loaded).toBe('640w');
    expect(rowOf({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' }).loaded).toBe('1080w');
    expect(rowOf({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' }).loaded).toBe('2x');
    expect(rowOf({ srcset: '/i/one.png 800w', currentSrc: 'https://example.com/i/one.png' }).loaded).toBe('800w');
  });

  it('heads it with the pick where several descriptors name the loaded file', () => {
    // Nine descriptors, one file: the browser arrived at one of them, and the
    // one core picks is the one it would have arrived at.
    expect(
      rowOf({ srcset: '/clear.png 320w, /clear.png 640w, /clear.png 1280w', sizes: '100vw', currentSrc: 'https://example.com/clear.png' }).loaded,
    ).toBe('1280w');
  });

  it('says src where the file came from the src attribute, and a dash where none loaded', () => {
    expect(rowOf({ currentSrc: 'https://example.com/px.gif' }).loaded).toBe('src');
    expect(rowOf({ srcset: TWO, sizes: '33vw', currentSrc: 'https://example.com/i/other.png' }).loaded).toBe('src');
    expect(rowOf({ srcset: TWO, sizes: '33vw', currentSrc: '' }).loaded).toBe('—');
    expect(rowOf({ currentSrc: '' }).loaded).toBe('—');
  });

  it('names the row after the file-name segment of the URL, wherever the CDN put it', () => {
    // The Storyblok shape from the maintainer's page: the file name sits three
    // segments before the end, behind a resize and a filter. The last segment
    // that carries an extension is the rule, and it lands on `card-1.webp`.
    expect(
      rowOf({
        currentSrc: 'https://a.storyblok.com/f/123/640x506/f31865bb07/card-1.webp/m/640x506/filters:quality(70)',
      }).name,
    ).toBe('card-1.webp');
    expect(rowOf({ currentSrc: 'https://example.com/i/hero-photograph.png' }).name).toBe('hero-photograph.png');
    expect(rowOf({ currentSrc: 'https://example.com/i/p.png?w=640&q=80' }).name).toBe('p.png');
  });

  it('falls back to the last segment, then the host, where nothing looks like a file', () => {
    expect(rowOf({ currentSrc: 'https://example.com/images/resize/640' }).name).toBe('640');
    expect(rowOf({ currentSrc: 'https://cdn.example.net/' }).name).toBe('cdn.example.net');
  });

  it('says a data: URI is one, rather than naming a tail of the page instead', () => {
    // A scheme that carries its own content has no path, so there is no file
    // name to take — the last segment of one is an arbitrary slice of whatever
    // the page inlined. The scheme is the part a reader can act on, so this is
    // the one shape cut from the back.
    expect(rowOf({ currentSrc: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }).name).toBe(
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAA…',
    );
    expect(rowOf({ currentSrc: 'javascript:alert(1)' }).name).toBe('javascript:alert(1)');
  });

  it('names nothing where nothing loaded, because the verdict beside it says so', () => {
    expect(rowOf({ srcset: TWO, currentSrc: '' }).name).toBe('');
  });

  it('says what it can about a URL that resolves against no base at all', () => {
    // `baseURI` is what a `<base>` tag says, so it is page content like
    // everything else here, and a relative candidate against an unusable base
    // resolves to nothing. The string the page wrote is the honest answer.
    expect(rowOf({ currentSrc: '/i/640.png', baseURI: 'not a URL' }).name).toBe('/i/640.png');
  });

  it('carries the loaded file whole, which is the one value the panel requests', () => {
    // Whole and untouched: `panel.ts` gives this to the thumbnail's `src`, and
    // `privacy.test.ts` holds that a `src` is only ever a value that arrived
    // this way. Empty is an image that loaded nothing, and the panel then
    // points the browser at no URL at all.
    expect(rowOf({ currentSrc: 'https://example.com/i/640.png?w=640&q=80' }).file).toBe(
      'https://example.com/i/640.png?w=640&q=80',
    );
    expect(rowOf({ currentSrc: '' }).file).toBe('');
  });

  it('holds the whole URL of the loaded file and of every candidate in the details', () => {
    // Uncut and absolute, so a relative candidate and an absolute `currentSrc`
    // can be read against each other, and two files that differ only by a
    // directory can be told apart.
    expect(
      said(rowOf({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png', renderedWidth: 475, renderedHeight: 317 }).details),
    ).toEqual([
      'loaded  https://example.com/i/640.png  [cache]',
      '640w  https://example.com/i/640.png',
      '1080w  https://example.com/i/1080.png',
      'alt  (no alt attribute)',
      'rendered box  475×317',
      'selector  html > body > img',
      'bytes  unknown',
    ]);
  });

  it('collapses candidates that share one URL into a single statement', () => {
    expect(
      said(rowOf({ srcset: '/clear.png 320w, /clear.png 640w, /clear.png 1280w', sizes: '100vw', currentSrc: 'https://example.com/clear.png' }).details),
    ).toEqual([
      'loaded  https://example.com/clear.png  [cache]',
      '3 candidates  one file: https://example.com/clear.png',
      'alt  (no alt attribute)',
      'rendered box  0×0, so this render drew no box at all',
      'selector  html > body > img',
      'bytes  unknown',
    ]);
  });

  it('tells two images apart when their URLs differ only by a directory', () => {
    const deep = (at: string): string =>
      `https://example.com/assets/2026/${at}/a/very/deep/set/of/directories/that/go/on/images/hero.png`;
    const rows = panelOf(
      reading({ images: [image({ currentSrc: deep('one') }), image({ currentSrc: deep('two') })] }),
    ).rows;

    // The two names are the same string, and that is the finding rather than a
    // failure: the directory that separates these files is not the file name.
    // The whole URL is what separates them, and every row carries one.
    expect(rows[0]?.name).toBe(rows[1]?.name);
    expect(rows.map((row) => valueOf(row, 'loaded'))).toEqual([deep('one'), deep('two')]);
    expect(rows[0]?.file).not.toBe(rows[1]?.file);
  });

  it('says the alt text the page wrote, and which kind of nothing it wrote instead', () => {
    expect(valueOf(rowOf({ alt: 'A person at a desk' }), 'alt')).toBe('A person at a desk');
    expect(valueOf(rowOf({ alt: '' }), 'alt')).toBe('(empty, so the page calls it decorative)');
    expect(valueOf(rowOf({ alt: null }), 'alt')).toBe('(no alt attribute)');
  });

  it('says the box this render drew, which is the shape a reader recognises', () => {
    expect(valueOf(rowOf({ renderedWidth: 1200, renderedHeight: 80 }), 'rendered box')).toBe('1200×80');
    expect(valueOf(rowOf({ renderedWidth: 23.6, renderedHeight: 23.4 }), 'rendered box')).toBe('24×23');
    expect(valueOf(rowOf({}), 'rendered box')).toBe('0×0, so this render drew no box at all');
  });

  it('says what loading the page asked for, and says nothing where it asked for none', () => {
    expect(valueOf(rowOf({ loading: 'lazy' }), 'loading')).toBe('lazy');
    expect(valueOf(rowOf({ loading: 'eager' }), 'loading')).toBe('eager');
    expect(valueOf(rowOf({}), 'loading')).toBeUndefined();
  });

  it('says bytes are unknown on every row, and never a figure', () => {
    expect(valueOf(rowOf({ srcset: TWO, sizes: '100vw' }), 'bytes')).toBe('unknown');
    expect(valueOf(rowOf({}), 'bytes')).toBe('unknown');
  });

  it('words the thumbnail’s own alt, so a box that will not draw still says what it was', () => {
    expect(rowOf({ currentSrc: 'https://example.com/i/a.png', alt: 'A person' }).alt).toBe('A person');
    expect(rowOf({ currentSrc: 'https://example.com/i/a.png', alt: '' }).alt).toBe('a.png');
    expect(rowOf({ currentSrc: 'https://example.com/i/a.png' }).alt).toBe('a.png');
    expect(rowOf({ currentSrc: '' }).alt).toBe('nothing loaded');
  });

  it('says the size in place of a thumbnail where the image is too small to show', () => {
    // A 1×1 drawn into a 44px box is a square of one colour, or of the checked
    // ground behind it, and reads as a thumbnail that failed. Under eight CSS
    // pixels on both sides there is nothing to show, and the size is the
    // honest picture. A box of zero is an image this render did not draw, and
    // its file still gets a thumbnail.
    expect(rowOf({ renderedWidth: 1, renderedHeight: 1, currentSrc: 'https://example.com/clear.png' }).tiny).toBe('1×1');
    expect(rowOf({ renderedWidth: 4, renderedHeight: 7.4 }).tiny).toBe('4×7');
    expect(rowOf({ renderedWidth: 8, renderedHeight: 8 }).tiny).toBeNull();
    expect(rowOf({ renderedWidth: 1200, renderedHeight: 80 }).tiny).toBeNull();
    expect(rowOf({ renderedWidth: 0, renderedHeight: 0 }).tiny).toBeNull();
  });

  it('hands each row the index the reader gave it, which is the panel’s handle', () => {
    const rows = panelOf(
      reading({ images: [image({ at: 0 }), image({ at: 1 }), image({ at: 2 })] }),
    ).rows;

    expect(rows.map((row) => row.at)).toEqual([0, 1, 2]);
  });
});
