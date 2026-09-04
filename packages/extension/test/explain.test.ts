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

  it('heads the panel with the two inputs every row reasons from, and the counts', () => {
    // Width and ratio as two fields rather than one line, because they are
    // the inputs every row's reasoning names and the panel lays them out as
    // such.
    expect(panelOf(reading({ viewport: { width: 393, height: 852 }, dpr: 3 })).head).toEqual({
      width: '393 px',
      dpr: 'DPR 3 (retina)',
      counts: '0 images',
    });
    expect(panelOf(reading({ images: [image()] })).head.counts).toBe('1 image · 1 no choice');
  });

  /**
   * The glance-level answer for a whole page, which is the one figure a reader
   * of twenty-three rows wanted and the header did not have.
   *
   * `23 images` says how much there is to read and nothing about what it says.
   * The counts say where the problems are before a single row is read, and they
   * partition the page — every image is counted exactly once, which is what
   * makes the line an answer rather than a highlight reel.
   */
  describe('the counts the header states', () => {
    /** One image per verdict word, on one page, in a deliberate jumble. */
    const everySort = (): Parameters<typeof image>[0][] => [
      // fit
      { srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/640.png' },
      // oversized
      { srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' },
      // no choice
      { currentSrc: 'https://example.com/px.gif' },
      // undersized
      { srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png' },
      // can't tell
      { srcset: TWO, sizes: 'auto', loading: 'lazy', renderedWidth: 1080, naturalWidth: 1080, currentSrc: 'https://example.com/i/1080.png' },
      // not loaded
      { srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: '' },
      // unknown
      { srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/other.png' },
      // no width
      { srcset: TWO, sizes: 'auto', renderedWidth: 0, loading: 'lazy' },
      // fit again, so one count is not one row
      { srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/640.png' },
    ];

    it('says the count of every verdict on the page, worst first, and leaves out the rest', () => {
      // The order is the severity order the list offers as "warnings first",
      // and it is the same on every page — a header whose words moved about
      // with the page would be a header a reader has to re-read.
      const panel = panelOf(reading({ images: everySort().map((fields) => image(fields)) }));

      expect(panel.head.counts).toBe(
        '9 images · 1 oversized · 1 undersized · 1 can’t tell · 1 no width · 1 not loaded · ' +
          '1 unknown · 1 no choice · 2 fit',
      );
    });

    it('counts every image exactly once, so the line is an answer and not a selection', () => {
      // The claim the fixed order costs: a verdict left out of it would vanish
      // from the header, and the header would quietly under-report a page. The
      // counts are read back and summed against the number of rows.
      const rows = everySort().map((fields) => image(fields));
      const panel = panelOf(reading({ images: rows }));
      const [total, ...counted] = panel.head.counts.split(' · ');

      expect(total).toBe('9 images');
      expect(
        counted
          .map((one) => Number(one.split(' ')[0]))
          .reduce((sum, one) => sum + one, 0),
      ).toBe(rows.length);
      // And every word counted is a word some row actually carries.
      expect(counted.map((one) => one.split(' ').slice(1).join(' ')).sort()).toEqual(
        [...new Set(panel.rows.map((row) => row.verdict.word))].sort(),
      );
    });

    it('says the page the report was written about, in the words it asked for', () => {
      // The maintainer's own page: one oversized, three the panel cannot stand
      // behind, nineteen that are fine. Finding the two that are wrong meant
      // scrolling past nineteen that are not, and this line is where that stops.
      const copies = (count: number, fields: Parameters<typeof image>[0]) =>
        Array.from({ length: count }, () => image(fields));
      const many = [
        ...copies(1, { srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' }),
        ...copies(3, { srcset: TWO, sizes: 'auto', loading: 'lazy', renderedWidth: 1080, naturalWidth: 1080, currentSrc: 'https://example.com/i/1080.png' }),
        ...copies(19, { srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/640.png' }),
      ];

      expect(panelOf(reading({ images: many })).head.counts).toBe(
        '23 images · 1 oversized · 3 can’t tell · 19 fit',
      );
    });

    it('says nothing but the count on a page with no image at all', () => {
      expect(panelOf(reading()).head.counts).toBe('0 images');
    });
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
        declaresWidth: live.declaresWidth,
        naturalWidth: live.naturalWidth,
        currentSrc: live.currentSrc,
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

  it('marks the loaded file on the rows a held copy would explain, and not the rest', () => {
    // This asserted the opposite until #36: the mark on every row a file
    // loaded, on the argument that `currentSrc` is what the browser has and no
    // reading of the page says whether it chose it. That argument is still
    // sound and it is the footer's, where it is made once about the panel. As a
    // rule for a row it made the word unconditional, and a word on all
    // twenty-three rows of a page tells a reader nothing about any of them —
    // so the mark now goes where it changes the conclusion. `where the cache
    // mark earns its place` below is the rule case by case; this is that the
    // mark varies across one page at all.
    const panel = panelOf(
      reading({
        images: [
          image({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' }),
          image({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/640.png' }),
          image({ currentSrc: 'https://example.com/px.gif' }),
          image({ srcset: TWO, sizes: '100vw' }),
        ],
      }),
    );

    expect(panel.rows.map((row) => row.mark)).toEqual([
      'what the browser has, not what it chose',
      null,
      null,
      null,
    ]);
    // The flag on the `loaded` line is untouched, on every row a file loaded.
    // It says which figure the mark is about; whether the row draws one at all
    // is the row's `mark`, and `panel.ts` reads the two together.
    expect(panel.rows.map((row) => row.details.filter((line) => line.held).map((l) => l.label))).toEqual([
      ['loaded'],
      ['loaded'],
      ['loaded'],
      [],
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
    expect(row.why).toBe('Needs 2400 px, and 1200w is the largest file on offer.');
    expect(row.mark).toBe(
      'what the browser has, not what it chose — and the width above descends from it',
    );
    expect(row.notes).toEqual([
      'On your 1440 px wide screen, sizes is auto, so the browser took the width from the layout, ' +
        '1200 px. At DPR 2 it needs a file at least 2400 px wide, but no file is wide enough, so ' +
        'the browser took the largest, 1200w, and the image is stretched to fit; add a candidate ' +
        'above 1200w.',
      'sizes resolved to auto, so the width above is the width this render laid the image out ' +
        'at — and for an image the page gives no width of its own, that is the width of ' +
        'whichever file the browser already held. Every marked figure descends from it, so a ' +
        'prediction that agrees with the loaded file may agree because one produced the other. ' +
        'An empty cache is the only way to tell.',
    ]);
  });

  it('writes no note where there is nothing further to say', () => {
    // One candidate is one clause and no reasoning: "only one file on offer"
    // is the whole of it, and a note repeating the sentence above would be the
    // same words twice. Every row with a choice to explain has one.
    expect(rowOf({ srcset: '/i/one.png 800w', currentSrc: 'https://example.com/i/one.png' }).notes).toEqual(
      [],
    );
    expect(
      rowOf({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' })
        .notes,
    ).toHaveLength(1);
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
 * The one clause a collapsed row says, which is the whole of what a scan
 * reads.
 *
 * It used to be the answer and three caveats, in that order and in one
 * paragraph, and on a page of twenty-three images three rows filled the panel:
 * finding the two that were wrong meant scrolling past nineteen that were not.
 * So the answer is what is left here and the caveats are behind the disclosure
 * the row already had — which is not a deletion, and the describe below is
 * where every word of them is asserted.
 *
 * Two facts left with them, and this is the one part of the move worth arguing.
 * The viewport width and the ratio were in every sentence deliberately, to
 * answer the maintainer's "is it because of my device?" — and that was right
 * while the sentence was the only place they appeared. The head states them as
 * inputs now, so a row that named them again was answering a question a reader
 * could already see the answer to, three lines at a time, twenty-three times.
 *
 * Every number in every clause is core's, formatted. Nothing here is
 * recomputed, and `through-core.test.ts` refuses the operators that would let
 * it be.
 */
describe('the clause a collapsed row leads with', () => {
  const at = (fields: Parameters<typeof image>[0], dpr = 1, width = 1440): string =>
    rowOf(fields, dpr, width).why;

  it('width-selected and it fit: the pixels needed, and the file that covers them', () => {
    // The issue's own shape: "Needs 1468 px, and 1920w is the smallest that
    // covers it." The descriptor and the verdict are already the headline, so
    // the clause is what the headline does not say.
    expect(
      at({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/640.png' }),
    ).toBe('Needs 475 px, and 640w is the smallest file that covers it.');
  });

  it('width-selected and a larger file loaded: the pixels needed, and what covered them', () => {
    expect(at({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' })).toBe(
      'Needs 475 px, and 640w covers it, so 1080w is larger than needed.',
    );
  });

  it('width-selected and nothing covers it: says the largest on offer is all there is', () => {
    expect(at({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/1080.png' }, 3)).toBe(
      'Needs 4320 px, and 1080w is the largest file on offer.',
    );
  });

  it('width-selected and a smaller file loaded: says the loaded file falls short', () => {
    expect(at({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png' })).toBe(
      'Needs 1440 px, and 640w does not cover it.',
    );
  });

  it('width-selected and nothing loaded yet: says so, and what the arithmetic will pick', () => {
    expect(at({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: '' })).toBe(
      'Nothing has loaded yet, and the arithmetic picks 640w.',
    );
  });

  it('width-selected and the loaded file is not a candidate: says so rather than guessing', () => {
    expect(at({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/other.png' })).toBe(
      'The loaded file is not one the srcset offers.',
    );
  });

  it('density-selected: names the density rather than a pixel figure there is none of', () => {
    // No `sizes` entered, so there is no width and no pixel count to open
    // with. The ratio is the whole cause, and the clause points at the head
    // field that holds it rather than repeating the figure.
    expect(at({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' }, 2)).toBe(
      '2x is the smallest density at or above your pixel ratio.',
    );
    expect(at({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' }, 3)).toBe(
      '2x is the densest on offer, and your pixel ratio is higher.',
    );
    expect(at({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' })).toBe(
      '1x covers your pixel ratio, so 2x is larger than needed.',
    );
    expect(
      at({ srcset: '/i/hi.png 2x', srcAttribute: '/i/lo.png', currentSrc: 'https://example.com/i/lo.png' }, 2),
    ).toBe('2x covers your pixel ratio, and src (1x) does not.');
  });

  it('unreadable sizes: says the clause would not read, and names it in the steps', () => {
    // The clause's own text is page content and can be any length at all, so
    // it stays in the `clause used` line where a reader is looking for it. A
    // collapsed row says which kind of failure it was.
    expect(at({ srcset: TWO, sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/640.png' })).toBe(
      'The sizes clause could not be read, so nothing was picked.',
    );
    expect(
      at(
        { srcset: '/i/640.png 640w, /i/hi.png 2x', sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/hi.png' },
        2,
      ),
    ).toBe('2x is the smallest density at or above your pixel ratio.');
  });

  it('no width at all: says nothing was picked, and blames no descriptor for it', () => {
    // True of both ways core arrives at no width — a box this render drew
    // nothing for, and a page that wrote `0px` itself — which is why the
    // clause names neither. The note says which.
    expect(at({ srcset: TWO, sizes: 'auto', renderedWidth: 0, loading: 'lazy' })).toBe(
      'No width to select against, so nothing was picked.',
    );
    expect(at({ srcset: TWO, sizes: '0px' })).toBe(
      'No width to select against, so nothing was picked.',
    );
  });

  it('a w and an x descriptor: says the two cannot be ranked', () => {
    // The pick is the 2x and the browser took the 640w, which is neither
    // larger nor smaller: a page that mixes the two on one tag has written a
    // srcset a browser reads as all w.
    expect(
      at({ srcset: '/i/a.png 640w, /i/b.png 2x', sizes: '100vw', currentSrc: 'https://example.com/i/a.png' }),
    ).toBe('A w and an x descriptor cannot be ranked against each other.');
  });

  it('the device had no say: says so and stops', () => {
    expect(at({ currentSrc: 'https://example.com/px.gif' })).toBe(
      'No srcset, so your device made no difference here.',
    );
    expect(at({ srcset: '/i/one.png 800w', currentSrc: 'https://example.com/i/one.png' })).toBe(
      'Only one file on offer, so your device made no difference here.',
    );
    expect(
      at({ srcset: '/clear.png 320w, /clear.png 640w, /clear.png 1280w', sizes: '100vw', currentSrc: 'https://example.com/clear.png' }),
    ).toBe('All 3 candidates name one file, so your device made no difference here.');
  });

  it('says one thing and holds no caveat, on every verdict there is', () => {
    // The property rather than the wording: a collapsed clause is one
    // sentence, and none of the hedges that used to follow the answer is in
    // it. Every one of them is asserted in the describe below, where they went.
    const clauses = [
      at({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/640.png' }),
      at({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' }),
      at({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png' }),
      at({ srcset: TWO, sizes: 'auto', loading: 'lazy', renderedWidth: 1080, naturalWidth: 1080, currentSrc: 'https://example.com/i/1080.png' }),
      at({ srcset: TWO, sizes: 'auto', loading: 'lazy', renderedWidth: 0 }),
      at({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: '' }),
      at({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/other.png' }),
      at({ currentSrc: 'https://example.com/px.gif' }),
    ];

    for (const clause of clauses) {
      // One sentence: one full stop, at the end.
      expect(clause.split('. ')).toHaveLength(1);
      expect(clause.slice(-1)).toBe('.');
      // And none of the words a caveat is made of.
      expect(clause).not.toMatch(/held copy|empty cache|likeliest|would read the same|DPR /);
      // Nor the device facts the head already states.
      expect(clause).not.toContain('1440 px wide');
    }
  });
});

/**
 * The reasoning, behind the disclosure the row already had.
 *
 * Every sentence here is the sentence the collapsed row used to say, moved
 * rather than rewritten: the causal chain from the reader's device through
 * `sizes` to the pixels needed, the cause named as a likelihood where the panel
 * cannot know it, and the cure. It is shown with the steps, because a reader
 * who opened a row asked for exactly this — and the two device facts belong
 * here for the same reason, which is that this is where the question was asked.
 */
describe('the reasoning a row holds behind its disclosure', () => {
  const because = (fields: Parameters<typeof image>[0], dpr = 1, width = 1440): string[] =>
    rowOf(fields, dpr, width).notes;

  const only = (fields: Parameters<typeof image>[0], dpr = 1, width = 1440): string => {
    const [said] = because(fields, dpr, width);
    if (said === undefined) throw new Error('the row holds no reasoning at all');
    return said;
  };

  it('width-selected and it fit: names the device, the clause, the pixels, and the pick', () => {
    expect(
      only({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/640.png' }),
    ).toBe(
      'On your 1440 px wide screen, sizes says 33vw, which comes to 475 px. At DPR 1 it needs a ' +
        'file at least that wide, and 640w is the smallest that is wide enough.',
    );
  });

  it('width-selected and a larger file loaded: says the pick, then the likely cause, then the cure', () => {
    // The cause is named as a likelihood rather than as a fact, because a
    // larger file than the pick is equally consistent with a viewport that
    // shrank after load and with script that rewrote either attribute.
    expect(only({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' })).toBe(
      'On your 1440 px wide screen, sizes says 33vw, which comes to 475 px. At DPR 1 it needs a ' +
        'file at least that wide. The arithmetic picks 640w, but the browser loaded 1080w, which is ' +
        'larger. A held copy reused rather than chosen again is the likeliest cause, and a viewport ' +
        'that shrank after load or script that rewrote sizes or srcset would read the same; an ' +
        'empty cache is the only way to see the real pick.',
    );
  });

  it('width-selected and nothing covers it: says the largest stood in, and what to add', () => {
    expect(only({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/1080.png' }, 3)).toBe(
      'On your 1440 px wide screen, sizes says 100vw, so the image counts as full width. At DPR 3 ' +
        'it needs a file at least 4320 px wide, but no file is wide enough, so the browser took the ' +
        'largest, 1080w, and the image is stretched to fit; add a candidate above 1080w.',
    );
  });

  it('width-selected and a smaller file loaded: says what it falls short of, and where to look', () => {
    expect(only({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png' })).toBe(
      'On your 1440 px wide screen, sizes says 100vw, so the image counts as full width. At DPR 1 ' +
        'it needs a file at least that wide. The arithmetic picks 1080w, but the browser loaded ' +
        '640w, which does not cover the pixels needed above, so the image is upscaled wherever the ' +
        'page draws it at that size; check what set this src.',
    );
  });

  it('width-selected and nothing loaded yet: says what the arithmetic will pick, and why', () => {
    expect(only({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: '' })).toBe(
      'On your 1440 px wide screen, sizes says 33vw, which comes to 475 px. At DPR 1 it needs a ' +
        'file at least that wide. Nothing has loaded yet; when it does, the arithmetic picks 640w.',
    );
  });

  it('width-selected and the loaded file is not a candidate: says where to look', () => {
    expect(only({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/other.png' })).toBe(
      'On your 1440 px wide screen, sizes says 33vw, which comes to 475 px. At DPR 1 it needs a ' +
        'file at least that wide. The arithmetic picks 640w, but the loaded file is not one the ' +
        'srcset offers; check what set this src.',
    );
  });

  it('words each kind of sizes resolution as its own cause', () => {
    // A pixel length is not followed by "which is N px", because that would say
    // the number twice. A clause with a condition is named whole, so a reader
    // can see which one matched at this viewport. The two defaults are two
    // findings about the page, and are told apart.
    const loaded = 'https://example.com/i/640.png';
    expect(only({ srcset: TWO, sizes: '580px', currentSrc: loaded })).toContain(
      'On your 1440 px wide screen, sizes says 580px. At DPR 1 it needs a file at least that wide, ' +
        'and 640w is the smallest that is wide enough.',
    );
    expect(only({ srcset: TWO, sizes: '(max-width: 768px) 100vw, 33vw', currentSrc: loaded }, 1, 600)).toContain(
      'On your 600 px wide screen, sizes matched (max-width: 768px) 100vw, so the image counts as ' +
        'full width. At DPR 1 it needs a file at least that wide, and 640w is the smallest that is ' +
        'wide enough.',
    );
    expect(only({ srcset: TWO, sizes: null, currentSrc: 'https://example.com/i/1080.png' })).toContain(
      'On your 1440 px wide screen, there is no sizes, so the 100vw default counts the image as ' +
        'full width. At DPR 1 it needs a file at least that wide, but no file is wide enough, so ' +
        'the browser took the largest, 1080w, and the image is stretched to fit; add a candidate ' +
        'above 1080w.',
    );
    expect(
      only({ srcset: TWO, sizes: '(min-width: 2000px) 50vw', currentSrc: 'https://example.com/i/1080.png' }),
    ).toContain('On your 1440 px wide screen, no sizes clause matched, so the 100vw default ' +
                  'counts the image as full width. At DPR 1 it needs a file at least that wide, but ' +
                  'no file is wide enough, so the browser took the largest, 1080w, and the image is ' +
                  'stretched to fit; add a candidate above 1080w.');
  });

  it('density-selected: names the ratio, and that sizes never entered', () => {
    expect(only({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' }, 2)).toBe(
      'Your screen is DPR 2 (retina) and no candidate carries a width, so the ratio decided alone, ' +
        'and 2x is the smallest density at or above it.',
    );
    expect(only({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' }, 3)).toBe(
      'Your screen is DPR 3 (retina) and no candidate carries a width, so the ratio decided ' +
        'alone, but no candidate reaches it, so the browser took the densest, 2x, and the image is ' +
        'stretched to fit; add a candidate above 2x.',
    );
    expect(only({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: 'https://example.com/i/b.png' })).toBe(
      'Your screen is DPR 1 (standard) and no candidate carries a width, so the ratio decided ' +
        'alone. The arithmetic picks 1x, but the browser loaded 2x, which is larger. A held copy ' +
        'reused rather than chosen again is the likeliest cause, and a viewport that shrank after ' +
        'load or script that rewrote sizes or srcset would read the same; an empty cache is the ' +
        'only way to see the real pick.',
    );
  });

  it('unreadable sizes: names the clause at fault, and what to fix', () => {
    expect(only({ srcset: TWO, sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/640.png' })).toBe(
      'The sizes clause (min-width: 100px) wide could not be read as a length, so there is no ' +
        'width to select against and nothing was picked; fix the sizes attribute.',
    );
    expect(
      only(
        { srcset: '/i/640.png 640w, /i/hi.png 2x', sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/hi.png' },
        2,
      ),
    ).toBe(
      'The sizes clause (min-width: 100px) wide could not be read as a length, so only the x ' +
        'candidates could be judged against DPR 2 (retina), and 2x is the smallest density at or ' +
        'above it.',
    );
  });

  it('no width at all: names the box this render drew, or the length the page wrote', () => {
    expect(only({ srcset: TWO, sizes: 'auto', renderedWidth: 0, loading: 'lazy' })).toBe(
      'Sizes is auto, so the browser took the width from the layout, 0 px, so there was no width ' +
        'to select against and nothing was picked — an image this render drew no box for, such as a ' +
        'lazy one below the fold, is the ordinary cause. The srcset is not what to look at here.',
    );
    expect(only({ srcset: TWO, sizes: '0px' })).toBe(
      'Sizes says 0px, so there was no width to select against and nothing was picked — an image ' +
        'this render drew no box for, such as a lazy one below the fold, is the ordinary cause. The ' +
        'srcset is not what to look at here.',
    );
  });

  it('a w and an x descriptor: says the two cannot be ranked, and names both', () => {
    expect(
      only({ srcset: '/i/a.png 640w, /i/b.png 2x', sizes: '100vw', currentSrc: 'https://example.com/i/a.png' }),
    ).toBe(
      'On your 1440 px wide screen, sizes says 100vw, so the image counts as full width. At DPR 1 ' +
        'it needs a file at least that wide. The arithmetic picks 2x, but the browser loaded 640w, ' +
        'and a w and an x descriptor cannot be ranked against each other.',
    );
  });

  it('the device had no say: says where the one file came from, and what the descriptors cost', () => {
    expect(only({ currentSrc: 'https://example.com/px.gif' })).toBe(
      'No srcset, so your device made no difference here; the src attribute is the only file on ' +
        'offer.',
    );
    expect(
      only({ srcset: '/clear.png 320w, /clear.png 640w, /clear.png 1280w', sizes: '100vw', currentSrc: 'https://example.com/clear.png' }),
    ).toBe(
      'All 3 candidates name one file, so your device made no difference here — the descriptors ' +
        'differ and the bytes do not.',
    );
  });

  it('carries every warning’s cure, which is what a warning is for', () => {
    // A warning with no action is noise. The cure moved with the rest of the
    // reasoning and it is still a clause after a semicolon, one opening away
    // from the word that says something is wrong.
    const warned = [
      { srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' },
      { srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png' },
    ];

    for (const fields of warned) {
      expect(rowOf(fields).verdict.tone).toBe('warn');
      expect(only(fields)).toMatch(/; (?:an empty cache is the only way|add a candidate|check what set)/);
    }
    expect(only({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/1080.png' }, 3)).toMatch(
      /; add a candidate above 1080w/,
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
    expect(verdictOf({ srcset: '/i/one.png 800w', currentSrc: 'https://example.com/i/one.png' })).toEqual(['no ' +
                                                                                                             'choice', 'quiet']);
    expect(
      verdictOf({ srcset: '/clear.png 320w, /clear.png 640w', sizes: '100vw', currentSrc: 'https://example.com/clear.png' }),
    ).toEqual(['no choice', 'quiet']);
  });

  it('is not loaded where there is no file to judge yet', () => {
    expect(verdictOf({ srcset: TWO, sizes: '33vw', currentSrc: '' })).toEqual(['not loaded', 'quiet']);
    expect(verdictOf({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: '' })).toEqual(['not loaded', 'quiet']);
  });

  it('is still no choice where nothing loaded and there was nothing to choose between', () => {
    // The one row where `not loaded` is not the word, and it is the right way
    // round: `no choice` answers "did my device decide this", which a lazy
    // `<img src>` with no `srcset` answers with a flat no whether or not it has
    // loaded. What says nothing arrived is the rest of the row — no descriptor
    // for the headline, no file for a thumbnail to ask for, and no mark, since
    // there is no held copy for one to be about.
    const row = rowOf({ srcAttribute: '/i/hero.png', loading: 'lazy', renderedWidth: 300 });

    expect([row.verdict.word, row.verdict.tone]).toEqual(['no choice', 'quiet']);
    expect([row.loaded, row.name, row.file, row.mark]).toEqual(['—', '', '', null]);
  });

  it('is unknown where the comparison cannot settle it, and never a guess', () => {
    expect(verdictOf({ srcset: TWO, sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/640.png' })).toEqual(['unknown', 'quiet']);
    expect(verdictOf({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/other.png' })).toEqual(['unknown', 'quiet']);
  });

  it('says can’t tell in plain words, rather than naming the mechanism', () => {
    // The maintainer read the panel and asked what `circular` meant, which is
    // the argument against the word: a verdict has one job, and it is to be
    // understood without being looked up. The mechanism is exact and it is not
    // gone — it is the note the row carries, one opening away, and the case
    // below is where every word of it is asserted.
    expect(
      verdictOf({ srcset: TWO, sizes: 'auto', loading: 'lazy', renderedWidth: 1080, naturalWidth: 1080, currentSrc: 'https://example.com/i/1080.png' }),
    ).toEqual(['can’t tell', 'quiet']);
  });

  it('names every verdict in plain words a reader needs no glossary for', () => {
    // The closed list, so a word that needs looking up cannot arrive quietly.
    // Each is either an outcome (`fit`, `oversized`, `undersized`) or a plain
    // statement that the panel cannot answer — and not one of them is a term
    // of art.
    const words = [
      verdictOf({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/640.png' }),
      verdictOf({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' }),
      verdictOf({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png' }),
      verdictOf({ srcset: TWO, sizes: 'auto', loading: 'lazy', renderedWidth: 1080, naturalWidth: 1080, currentSrc: 'https://example.com/i/1080.png' }),
      verdictOf({ srcset: TWO, sizes: 'auto', loading: 'lazy', renderedWidth: 0 }),
      verdictOf({ srcset: TWO, sizes: '33vw', currentSrc: '' }),
      verdictOf({ srcset: TWO, sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/640.png' }),
      verdictOf({ currentSrc: 'https://example.com/px.gif' }),
    ].map(([word]) => word);

    expect(words).toEqual([
      'fit',
      'oversized',
      'undersized',
      'can’t tell',
      'no width',
      'not loaded',
      'unknown',
      'no choice',
    ]);
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
    // `lazy` is what makes the browser read `auto` at all, and the natural
    // width matching the box is what says the box may be the file's own: the
    // page declares no width, so nothing else can have set it.
    const row = rowOf({
      srcset: TWO,
      sizes: 'auto',
      loading: 'lazy',
      renderedWidth: 1080,
      naturalWidth: 1080,
      currentSrc: 'https://example.com/i/1080.png',
    });

    expect([row.verdict.word, row.verdict.tone]).toEqual(['can’t tell', 'quiet']);
    // The clause says the consequence, which is that there is nothing here to
    // check: the file laid the image out, the width became `needed`, `needed`
    // produced the pick, and the pick then agreed with the file.
    expect(row.why).toBe(
      'The width may be the loaded file’s own, so the pick cannot disagree with it.',
    );
    // And the mechanism is intact, one opening away, in the two paragraphs the
    // row carries: the arithmetic as it ran, and why its agreement is worth
    // nothing. The tail the sentence used to carry is gone from it because
    // this is where it said the same thing — twice in one disclosure would be
    // the reader reading it twice.
    expect(row.notes).toEqual([
      'On your 1440 px wide screen, sizes is auto, so the browser took the width from the layout, ' +
        '1080 px. At DPR 1 it needs a file at least that wide, and 1080w is the smallest that is ' +
        'wide enough.',
      'sizes resolved to auto, so the width above is the width this render laid the image out ' +
        'at — and for an image the page gives no width of its own, that is the width of ' +
        'whichever file the browser already held. Every marked figure descends from it, so a ' +
        'prediction that agrees with the loaded file may agree because one produced the other. ' +
        'An empty cache is the only way to tell.',
    ]);
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
    expect(one.why).toBe('src (1x) is the smallest density at or above your pixel ratio.');
    expect(one.notes).toEqual([
      'Your screen is DPR 1 (standard) and no candidate carries a width, so the ratio decided ' +
        'alone, and src (1x) is the smallest density at or above it.',
    ]);
    expect(said(one.steps)).toEqual([
      'clause used  x descriptors only',
      'needed  DPR 1 (standard)',
      'candidates  2x, src (1x) (picked)',
    ]);

    // The same tag on a retina screen, where the ratio picks the other one.
    const two = rowOf(offered, 2);
    expect([two.verdict.word, two.verdict.tone]).toEqual(['undersized', 'warn']);
    expect(two.why).toBe('2x covers your pixel ratio, and src (1x) does not.');
    expect(two.notes).toEqual([
      'Your screen is DPR 2 (retina) and no candidate carries a width, so the ratio decided ' +
        'alone. The arithmetic picks 2x, but the browser loaded src (1x), which does not cover the ' +
        'pixels needed above, so the image is upscaled wherever the page draws it at that size; ' +
        'check what set this src.',
    ]);
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
      rowOf({ srcAttribute: '/i/one.png', currentSrc: 'https://example.com/i/one.png' }).notes,
    ).toEqual([
      'No srcset, so your device made no difference here; the src attribute is the only file on ' +
        'offer.',
    ]);
  });

  it('says a zero width is a box this render drew, and blames no descriptor for it', () => {
    // Finding 3. A `sizesPx` of zero is unknown to core, so nothing is picked —
    // and the row read `unknown` with "fix the srcset", which is a lazy image
    // below the fold being told its perfectly good `srcset` is broken.
    const row = rowOf({ srcset: TWO, sizes: 'auto', renderedWidth: 0, loading: 'lazy' });

    expect([row.verdict.word, row.verdict.tone]).toEqual(['no width', 'quiet']);
    // Two notes, because an `auto` clause resolved to this width as well as
    // failing to give one: the second is the same argument every marked figure
    // on the panel carries, and a box of zero is a marked figure.
    expect(row.notes[0]).toBe(
      'Sizes is auto, so the browser took the width from the layout, 0 px, so there was no width ' +
        'to select against and nothing was picked — an image this render drew no box for, such as a ' +
        'lazy one below the fold, is the ordinary cause. The srcset is not what to look at here.',
    );
    expect(row.notes).toHaveLength(2);
    // And the same for a page that wrote the zero itself, which is the other
    // way core arrives at no width at all.
    expect(rowOf({ srcset: TWO, sizes: '0px' }).notes).toEqual([
      'Sizes says 0px, so there was no width to select against and nothing was picked — an image ' +
        'this render drew no box for, such as a lazy one below the fold, is the ordinary cause. The ' +
        'srcset is not what to look at here.',
    ]);
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
      }).notes,
    ).toEqual([
      'On your 1440 px wide screen, sizes says 33vw, which comes to 475 px. At DPR 1 it needs a ' +
        'file at least that wide. The arithmetic picks 640w, but the browser loaded 1080w, which is ' +
        'larger. A held copy reused rather than chosen again is the likeliest cause, and a viewport ' +
        'that shrank after load or script that rewrote sizes or srcset would read the same; an ' +
        'empty cache is the only way to see the real pick.',
    ]);
  });

  it('claims a stretch only where the loaded file falls short of the figure above', () => {
    // Finding 4's second half. "So the image is stretched to fit" was asserted
    // of a smaller file without saying against what: the pixels needed are what
    // `sizes` asked for, not what the page drew, so the honest claim names the
    // figure the row already shows and says the upscale follows from it.
    expect(
      rowOf({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png' }).notes,
    ).toEqual([
      'On your 1440 px wide screen, sizes says 100vw, so the image counts as full width. At DPR 1 ' +
        'it needs a file at least that wide. The arithmetic picks 1080w, but the browser loaded ' +
        '640w, which does not cover the pixels needed above, so the image is upscaled wherever the ' +
        'page draws it at that size; check what set this src.',
    ]);
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
    expect(row.why).toBe('Needs 320 px, and 640w is the smallest file that covers it.');
    // The tie is a caveat about the file name beside the headline rather than
    // an outcome, so it went behind the disclosure with the rest of them.
    expect(row.notes).toEqual([
      'On your 1440 px wide screen, sizes says 320px. At DPR 1 it needs a file at least that ' +
        'wide, and 640w is the smallest that is wide enough. The browser loaded 640w, which is a ' +
        'different file at the same descriptor, so the pixels are the same either way.',
    ]);

    // And where neither of the two covers the need, the stretch is the
    // srcset's and not the browser's — the tie is still a tie.
    const short = rowOf({
      srcset: '/i/a.png 640w, /i/b.png 640w',
      sizes: '100vw',
      currentSrc: 'https://example.com/i/a.png',
    });
    expect([short.verdict.word, short.verdict.tone]).toEqual(['undersized', 'warn']);
    expect(short.why).toBe('Needs 1440 px, and 640w is the largest file on offer.');
    expect(short.notes).toEqual([
      'On your 1440 px wide screen, sizes says 100vw, so the image counts as full width. At DPR 1 ' +
        'it needs a file at least that wide, but no file is wide enough, so the browser took the ' +
        'largest, 640w, and the image is stretched to fit; add a candidate above 640w. The browser ' +
        'loaded 640w, which is a different file at the same descriptor, so the pixels are the same ' +
        'either way.',
    ]);
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
    expect(row.why).toBe('Needs 100 px, and 640w is the smallest file that covers it.');
    expect(row.notes).toEqual([
      'On your 1440 px wide screen, sizes says 100px. At DPR 1 it needs a file at least that wide, ' +
        'and 640w is the smallest that is wide enough.',
    ]);
  });
});

/**
 * When the cache mark stands on a row, one case per line of the rule.
 *
 * It stood on every row a file loaded, and the argument for that was sound as
 * far as it went: `currentSrc` is what the browser has, and no reading of a
 * page says whether it chose it. What it left out is that the same is true of
 * every row — on a page a person has browsed every image is cached, so the
 * word stood on all twenty-three rows of the maintainer's own page and
 * distinguished none of them from any other.
 *
 * So it stands where it changes the conclusion, which `markFor` states as two
 * clauses: the loaded file is not the file the arithmetic picked, or a figure
 * the row shows descends from the held file. Every case below is one line of
 * that rule, and the cases that must not mark are as much of it as the ones
 * that must — a word that appears everywhere and a word that appears nowhere
 * are the same word.
 *
 * The footer is untouched, and `explains the mark once` above holds it. It
 * makes its claim about the panel rather than about a row: nothing marked can
 * be read as the outcome of the arithmetic, which is as true of the rows that
 * carry the mark now as it was of all of them.
 */
describe('where the cache mark earns its place', () => {
  const markAt = (fields: Parameters<typeof image>[0], dpr = 1, width = 1440): string | null =>
    rowOf(fields, dpr, width).mark;

  /** The two things the mark ever says. `markOf` is where they are worded. */
  const HELD = 'what the browser has, not what it chose';
  const DESCENDS = `${HELD} — and the width above descends from it`;

  it('marks a row where a larger file than the pick loaded', () => {
    // The case the mark was made for: a held copy reused rather than chosen
    // again is the likeliest cause of the difference, so the mark is what
    // explains the row rather than a fact repeated on every row beside it.
    expect(
      markAt({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/1080.png' }),
    ).toBe(HELD);
  });

  it('marks a row where a smaller file than the pick loaded', () => {
    expect(markAt({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/640.png' })).toBe(
      HELD,
    );
  });

  it('marks a row where a different file shares the pick’s descriptor', () => {
    // The pixels are the same either way, so the verdict is `fit` — and the
    // file the browser has is still not the file the arithmetic picked, which
    // is a difference nothing on the page explains and a held copy does.
    expect(
      markAt({ srcset: '/i/a.png 640w, /i/b.png 640w', sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/b.png' }),
    ).toBe(HELD);
  });

  it('marks a row whose loaded file is not one the srcset offers', () => {
    expect(
      markAt({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/other.png' }),
    ).toBe(HELD);
  });

  it('marks a row whose loaded descriptor cannot be ranked against the pick', () => {
    expect(
      markAt({ srcset: '/i/640.png 640w, /i/2x.png 2x', sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/2x.png' }),
    ).toBe(HELD);
  });

  it('marks a no choice row whose loaded file is not the one file on offer', () => {
    // One candidate is no choice at all, and the row still has a difference to
    // explain: the srcset offered one file and the browser has another.
    expect(markAt({ srcset: '/i/one.png 800w', currentSrc: 'https://example.com/i/other.png' })).toBe(
      HELD,
    );
  });

  it('marks a row whose width came from the layout the held file may have set', () => {
    // The second clause, and the one the mark says more about: `auto` deferred
    // to layout, the page sized nothing itself, so `css px` and every figure
    // under it may be the loaded file's own doing. Which is also the reading
    // that produces `can’t tell`, so the verdict and the mark agree by
    // construction rather than by coincidence.
    expect(
      markAt({ srcset: TWO, sizes: 'auto', loading: 'lazy', renderedWidth: 1080, naturalWidth: 1080, currentSrc: 'https://example.com/i/1080.png' }),
    ).toBe(DESCENDS);
  });

  it('marks a no choice row whose figures descend from the one file it offers', () => {
    // A `srcset` whose candidates all name one file made no choice, and its
    // width came off the layout all the same. The device made no difference to
    // the bytes; the held file may still have written the figure.
    expect(
      markAt({ srcset: '/clear.png 320w, /clear.png 640w', sizes: 'auto', loading: 'lazy', renderedWidth: 640, naturalWidth: 640, currentSrc: 'https://example.com/clear.png' }),
    ).toBe(DESCENDS);
  });

  it('leaves an ordinary fit row unmarked, where the browser loaded the pick', () => {
    // The row the rule exists for. The mark is true of it and it is true of
    // every other row on the page alike, which is the definition of a word
    // that costs a reader attention and buys nothing.
    expect(
      markAt({ srcset: TWO, sizes: '33vw', renderedWidth: 475, currentSrc: 'https://example.com/i/640.png' }),
    ).toBeNull();
  });

  it('leaves an undersized row unmarked where the pick itself is what loaded', () => {
    // A warning is not evidence of a held copy. The largest file on offer
    // loaded and it does not cover the pixels needed, which is the srcset's
    // doing and reads exactly the same cache-cold.
    expect(markAt({ srcset: TWO, sizes: '100vw', currentSrc: 'https://example.com/i/1080.png' })).toBeNull();
  });

  it('leaves a no choice row unmarked where the file on offer is the one that loaded', () => {
    // Both kinds: one candidate, and a srcset whose every candidate names one
    // file. Neither has a difference to explain.
    expect(markAt({ srcset: '/i/one.png 800w', currentSrc: 'https://example.com/i/one.png' })).toBeNull();
    expect(
      markAt({ srcset: '/clear.png 320w, /clear.png 640w', sizes: '100vw', currentSrc: 'https://example.com/clear.png' }),
    ).toBeNull();
  });

  it('leaves a row with no srcset at all unmarked, because the page offered no other file', () => {
    // The plainest row there is, and the case worth settling deliberately: the
    // loaded file matches no candidate here because there are no candidates,
    // not because the browser has something the page did not offer. Nothing
    // was picked, so nothing differs from the pick — and the row's own answer,
    // "your device made no difference here", is the same cache-hot or cold.
    expect(markAt({ currentSrc: 'https://example.com/px.gif' })).toBeNull();
  });

  it('leaves a row unmarked where the sizes clause would not read, since nothing was picked', () => {
    // `unknown` for a reason the cache has no part in: there is no width to
    // select against, so there is no pick for the loaded file to differ from.
    expect(
      markAt({ srcset: TWO, sizes: '(min-width: 100px) wide', currentSrc: 'https://example.com/i/640.png' }),
    ).toBeNull();
  });

  it('says nothing where nothing loaded, since no held copy could have supplied it', () => {
    expect(markAt({ srcset: TWO, sizes: '33vw', renderedWidth: 475 })).toBeNull();
  });

  it('leaves a no width row unmarked rather than claim a width of zero descends from a file', () => {
    // The edge the second clause has to settle: `sizes: auto` on an image this
    // render drew no box for resolves to nothing, and `markFor` requires a
    // width figure the row can use as well as a layout that produced it. "The
    // width above descends from it" about `0px` is a claim about a figure the
    // row does not usefully show, and the verdict here already says the
    // arithmetic never ran — not that it ran on the file's own width.
    expect(
      markAt({ srcset: TWO, sizes: 'auto', loading: 'lazy', renderedWidth: 0, naturalWidth: 0, currentSrc: 'https://example.com/i/640.png' }),
    ).toBeNull();
  });

  it('claims nothing about a zero width on a row it marks for the difference alone', () => {
    // The other half of that decision. A `w` candidate beside an `x` one still
    // has a density to judge, so this row is picked and judged with a width of
    // zero — and the difference between the pick and the loaded file is real,
    // so the row marks. What it must not do is add the clause about the width.
    expect(
      markAt({ srcset: '/i/640.png 640w, /i/2x.png 2x', sizes: 'auto', loading: 'lazy', renderedWidth: 0, naturalWidth: 0, currentSrc: 'https://example.com/i/640.png' }),
    ).toBe(HELD);
  });

  it('marks a can’t tell row whether or not it has a width figure to point at', () => {
    // The verdict is a clause of the rule in its own right, and this row is why
    // it cannot be derived from the layout question alone: a `w` candidate
    // beside an `x` one is picked and judged at a width of zero, the pick is
    // what loaded, and the width it was picked against may still be the loaded
    // file's own. The row says "the width may be the loaded file's own" and
    // must not then say nothing about the cache.
    const row = rowOf({
      srcset: '/i/640.png 640w, /i/2x.png 2x',
      sizes: 'auto',
      loading: 'lazy',
      renderedWidth: 0,
      naturalWidth: 0,
      currentSrc: 'https://example.com/i/2x.png',
    });

    expect(row.verdict.word).toBe('can’t tell');
    // The plain wording, because there is no width figure above to descend
    // from anything — the clause the mark adds is about a figure, and this row
    // shows none it can use.
    expect(row.mark).toBe(HELD);
  });

  it('flags no figure on a row whose only width figure is zero', () => {
    // The per-figure half of the same decision. `panel.ts` draws a chip where a
    // line is flagged and the row carries a mark, so a flag left on `0px` here
    // would put `cache` beside a figure the mark itself has stopped claiming —
    // the two halves of one rule disagreeing on one row.
    expect(
      said(
        rowOf({ srcset: '/i/640.png 640w, /i/2x.png 2x', sizes: 'auto', loading: 'lazy', renderedWidth: 0, naturalWidth: 0, currentSrc: 'https://example.com/i/640.png' }).steps,
      ),
    ).toEqual([
      'sizes  auto',
      'clause used  auto',
      'css px  0px',
      'needed  0px × DPR 1 = 0px',
      'candidates  640w (loaded), 2x (picked)',
    ]);
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
    expect(rowOf({ currentSrc: 'https://example.com/i/a.png', alt: 'A person' }).alt).toBe('A ' +
                                                                                             'person');
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
