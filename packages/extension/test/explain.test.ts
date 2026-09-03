import { explainSelection, parseSrcset } from '@imgwhy/core';
import { describe, expect, it } from 'vitest';
import type { Row } from '../src/explain.js';
import { panelOf } from '../src/explain.js';
import { image, reading } from './reading.js';

/**
 * One row's arithmetic as a reader sees it, one line per field.
 *
 * `[cache]` stands in for the mark the renderer draws. It is written into the
 * string rather than asserted separately so that a figure losing its mark is a
 * diff on the line it belongs to, which is where a reader would look.
 */
const said = (row: Row): string[] =>
  row.lines.map((line) => `${line.label}  ${line.value}${line.held ? '  [cache]' : ''}`);

/** The one row a single-image reading produces. */
const rowOf = (fields: Parameters<typeof image>[0]): Row => {
  const [row] = panelOf(reading({ images: [image(fields)] })).rows;
  if (row === undefined) throw new Error('the panel explained no image');
  return row;
};

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

    expect(panel.rows.map((row) => row.heading)).toEqual([
      'html > body > img:nth-of-type(1)',
      'html > body > img:nth-of-type(2)',
      'html > body > figure > img',
    ]);
  });

  it('heads the panel with the viewport and the ratio the arithmetic ran at', () => {
    const panel = panelOf(reading({ viewport: { width: 393, height: 852 }, dpr: 3 }));

    expect(panel.head).toBe('viewport 393×852 · DPR 3 · 0 images');
  });

  it('shows the whole arithmetic for a w descriptor: clause, width, pixels, winner', () => {
    expect(
      said(
        rowOf({
          srcset: '/i/640.png 640w, /i/1080.png 1080w',
          sizes: '(max-width: 768px) 100vw, 33vw',
          renderedWidth: 475,
          currentSrc: 'https://example.com/i/640.png',
        }),
      ),
    ).toEqual([
      'candidates  640w, 1080w',
      'sizes  (max-width: 768px) 100vw, 33vw',
      'clause used  33vw',
      'css px  475px',
      'needed  475px',
      'picked  640w  /i/640.png',
      'loaded  /i/640.png  [cache]',
      'bytes  unknown',
    ]);
  });

  it('agrees with core on the case the design works out by hand', () => {
    // > A 640px viewport at DPR 1.5 needs 960 physical pixels. It downloads the
    // > 1080w file. The element width never entered the calculation.
    //
    // Asserted twice over: once as the line a reader sees, and once against
    // `explainSelection` called directly. The second is what says the panel
    // asked core rather than arriving at the same answer on its own — a
    // reimplementation that agreed on this case would still be a
    // reimplementation, and `no-arithmetic.test.ts` is what refuses one.
    const live = image({
      srcset: '/i/640.png 640w, /i/1080.png 1080w',
      sizes: '100vw',
      renderedWidth: 320,
    });
    const row = panelOf(reading({ viewport: { width: 640, height: 960 }, dpr: 1.5, images: [live] }))
      .rows[0];

    expect(said(row)).toContain('needed  960px');
    expect(said(row)).toContain('picked  1080w  /i/1080.png');

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
    // it is rather than leaving three empty cells.
    expect(said(rowOf({ srcset: '/i/a.png 1x, /i/b.png 2x', currentSrc: '' }))).toEqual([
      'candidates  1x, 2x',
      'clause used  x descriptors only',
      'css px  —',
      'needed  —',
      'picked  1x  /i/a.png',
      'loaded  (none)  [cache]',
      'bytes  unknown',
    ]);
  });

  it('still shows a sizes string the browser read past, because the page wrote one', () => {
    // A page may write `sizes` on a densities-only `srcset`, and a browser
    // ignores it. Dropping the line would leave a reader who can see the
    // attribute in DevTools with no answer about it at all.
    expect(said(rowOf({ srcset: '/i/a.png 1x, /i/b.png 2x', sizes: '50vw' }))).toContain(
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
        }),
      ),
    ).toContain('sizes  50vw from a matching <source>');
  });

  it('says a sizes string is absent where no clause was written at all', () => {
    expect(said(rowOf({ srcset: '/i/640.png 640w, /i/1080.png 1080w' }))).toEqual([
      'candidates  640w, 1080w',
      'sizes  (absent)',
      'clause used  absent → 100vw default',
      'css px  1440px',
      'needed  1440px',
      'picked  1080w  /i/1080.png',
      'loaded  (none)  [cache]',
      'bytes  unknown',
    ]);
  });

  it('names the clause at fault where a length could not be read, and picks nothing', () => {
    expect(
      said(rowOf({ srcset: '/i/640.png 640w, /i/1080.png 1080w', sizes: '(min-width: 100px) wide' })),
    ).toEqual([
      'candidates  640w, 1080w',
      'sizes  (min-width: 100px) wide',
      'clause used  (min-width: 100px) wide',
      'css px  unreadable',
      'needed  —',
      'picked  —',
      'loaded  (none)  [cache]',
      'bytes  unknown',
    ]);
  });

  it('stops at one line where there was nothing to select between', () => {
    // A 1×1 tracking pixel and an image the page never shows are both bytes the
    // browser went and got, so neither is filtered out — but neither has a
    // choice to explain, and eight lines of dashes would bury the images that
    // do choose. `trace.ts` collapses the same case for the same reason.
    expect(said(rowOf({ currentSrc: 'https://example.com/px.gif' }))).toEqual([
      'selection  no srcset, so nothing was selected',
      'loaded  /px.gif  [cache]',
      'bytes  unknown',
    ]);
    expect(said(rowOf({ srcset: '/i/one.png 800w' }))).toEqual([
      'selection  one candidate only, so selection is a formality',
      'loaded  (none)  [cache]',
      'bytes  unknown',
    ]);
  });

  it('marks the loaded file on every row, held copy or not', () => {
    // The mark is not a warning about this image. It is a statement about what
    // the figure is: `currentSrc` is what the browser has, and a browser that
    // has a larger variant already never ran selection at all. There is no
    // reading of the page that can tell the two apart, so the mark cannot be
    // conditional on anything.
    const panel = panelOf(
      reading({
        images: [
          image({ srcset: '/i/640.png 640w, /i/1080.png 1080w', sizes: '100vw' }),
          image({ currentSrc: 'https://example.com/px.gif' }),
        ],
      }),
    );
    const held = panel.rows.flatMap((row) => row.lines.filter((line) => line.held));

    expect(held.map((line) => line.label)).toEqual(['loaded', 'loaded']);
  });

  it('marks the width an auto clause resolved to, and every figure under it', () => {
    // The design's failure mode 1, arriving as arithmetic rather than as a
    // loaded file. `auto` defers to layout, so core answers with the width the
    // element ended up at — and for an image the page gives no width of its
    // own, the width it ended up at is the width of whichever file the browser
    // already held. So `css px`, `needed` and `picked` all descend from a held
    // copy, and a prediction that agrees with `loaded` here agrees because one
    // produced the other. Cache-cold, the same page lays the image out at
    // nothing and picks nothing.
    const [row] = panelOf(
      reading({
        dpr: 2,
        images: [
          image({
            srcset: '/i/400.png 400w, /i/1200.png 1200w',
            sizes: 'auto',
            renderedWidth: 1200,
            currentSrc: 'https://example.com/i/1200.png',
            loading: 'lazy',
          }),
        ],
      }),
    ).rows;
    if (row === undefined) throw new Error('the panel explained no image');

    expect(said(row)).toEqual([
      'candidates  400w, 1200w',
      'sizes  auto',
      'clause used  auto',
      'css px  1200px  [cache]',
      'needed  2400px  [cache]',
      'picked  1200w  /i/1200.png  [cache]',
      'loaded  /i/1200.png  [cache]',
      'bytes  unknown',
    ]);
    expect(row.notes).toEqual([
      'sizes resolved to auto, so the width above is the width this render laid the image out ' +
        'at — and for an image the page gives no width of its own, that is the width of ' +
        'whichever file the browser already held. Every marked figure descends from it, so a ' +
        'prediction that agrees with the loaded file may agree because one produced the other. ' +
        'An empty cache is the only way to tell.',
    ]);
  });

  it('marks nothing else, so the mark keeps meaning one thing', () => {
    const panel = panelOf(
      reading({
        images: [
          image({
            srcset: '/i/640.png 640w, /i/1080.png 1080w',
            sizes: '33vw',
            renderedWidth: 475,
            currentSrc: 'https://example.com/i/640.png',
            loading: 'lazy',
          }),
        ],
      }),
    );
    const unmarked = panel.rows.flatMap((row) => row.lines.filter((line) => !line.held));

    expect(unmarked.map((line) => line.label)).toEqual([
      'candidates',
      'sizes',
      'clause used',
      'css px',
      'needed',
      'picked',
      'bytes',
    ]);
  });

  it('says why a prediction and a loaded file may differ without either being wrong', () => {
    const row = rowOf({
      srcset: '/i/640.png 640w, /i/1080.png 1080w',
      sizes: '33vw',
      renderedWidth: 475,
      currentSrc: 'https://example.com/i/1080.png',
    });

    expect(said(row)).toContain('picked  640w  /i/640.png');
    expect(said(row)).toContain('loaded  /i/1080.png  [cache]');
    expect(row.notes).toEqual([
      'picked and loaded disagree. A browser holding a larger variant reuses it and never runs ' +
        'selection at all, so a disagreement here is not necessarily a bug — it is the first ' +
        'thing to rule out. An empty cache is the only way to tell.',
    ]);
  });

  it('says nothing extra where the prediction and the loaded file agree', () => {
    // A relative candidate URL and an absolute `currentSrc` are the same file,
    // and a comparison that missed that would put the note on every row and
    // teach a reader to skip it.
    expect(
      rowOf({
        srcset: '/i/640.png 640w, /i/1080.png 1080w',
        sizes: '33vw',
        renderedWidth: 475,
        currentSrc: 'https://example.com/i/640.png',
      }).notes,
    ).toEqual([]);
  });

  it('claims no disagreement about an image that has loaded nothing yet', () => {
    // A lazy image below the fold has an empty `currentSrc`, which is not a
    // file that differs from the prediction. It is no file at all.
    expect(
      rowOf({ srcset: '/i/640.png 640w, /i/1080.png 1080w', sizes: '33vw', currentSrc: '' }).notes,
    ).toEqual([]);
  });

  it('says loading=lazy in the heading, where the trace says it too', () => {
    expect(rowOf({ loading: 'lazy' }).heading).toBe('html > body > img   loading=lazy');
    expect(rowOf({ loading: 'eager' }).heading).toBe('html > body > img');
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
    // A line reading `0 background images` on every page would bury the pages
    // that have some, which is the rule `trace.ts` keeps.
    expect(panelOf(reading()).footer).toHaveLength(2);
  });
});

/**
 * The line a URL becomes, which is the one thing on a row a reader compares
 * against another row.
 *
 * Two candidates the panel renders the same are two candidates a reader cannot
 * tell apart, and on the row whose own note says `picked` and `loaded` disagree
 * that reads as nonsense — the panel says they differ and shows one file twice.
 * So the property this holds is not a format. It is that a difference is
 * visible: either the line shows it, or the line carries a `…` saying something
 * was dropped to fit.
 */
describe('the file a candidate names, on one line of a 440px panel', () => {
  /** The `loaded` line of a page holding one image, which is one URL rendered. */
  const loadedOf = (currentSrc: string, baseURI = 'https://example.com/'): string => {
    const [row] = panelOf(reading({ images: [image({ currentSrc, baseURI })] })).rows;
    if (row === undefined) throw new Error('the panel explained no image');
    const [, loaded] = said(row);
    return loaded ?? '';
  };

  it('keeps the path, so two candidates in different directories read apart', () => {
    // The whole point. A last path segment renders `/a/1.png` and `/b/1.png`
    // identically, and this is the row that shows why that cannot stand: the
    // note says the two disagree.
    const row = rowOf({
      srcset: '/a/1.png 640w, /b/1.png 1080w',
      sizes: '100vw',
      currentSrc: 'https://example.com/a/1.png',
    });

    expect(said(row)).toContain('picked  1080w  /b/1.png');
    expect(said(row)).toContain('loaded  /a/1.png  [cache]');
    expect(row.notes).toHaveLength(1);
  });

  it('keeps the query, which is the whole of what a resizing CDN varies', () => {
    // A CDN that serves one file at every width puts the width in the query and
    // nothing else, so a line that dropped it would render every candidate on
    // the page as one file.
    expect(
      said(rowOf({ srcset: '/i/p.png?w=640&q=80 640w, /i/p.png?w=1080&q=80 1080w', sizes: '100vw' })),
    ).toContain('picked  1080w  /i/p.png?w=1080&q=80');
  });

  it('names the host of a file that came from somewhere the page did not', () => {
    // Which is the common shape of a disagreement worth reading: the page asked
    // for its own path and an image CDN answered.
    expect(loadedOf('https://cdn.example.net/i/1080.png')).toBe(
      'loaded  cdn.example.net/i/1080.png  [cache]',
    );
  });

  it('says a data: URI is one, rather than showing a tail of the page instead', () => {
    // A scheme that carries its own content has no path, so there is no file
    // name to take — the last segment of one is an arbitrary slice of whatever
    // the page inlined. The scheme is the part a reader can act on, so this is
    // the one shape cut from the back.
    expect(loadedOf('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')).toBe(
      'loaded  data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAA…  [cache]',
    );
    expect(loadedOf('javascript:alert(1)')).toBe('loaded  javascript:alert(1)  [cache]');
  });

  it('cuts a long path from the front, and says it cut it', () => {
    // The file name is at the end of a path, so the end is the half to keep —
    // and the `…` is what stops a cut line from reading like a short one.
    expect(loadedOf('https://example.com/assets/build/2026/09/very/deep/directory/hero-photograph.png')).toBe(
      'loaded  …s/build/2026/09/very/deep/directory/hero-photograph.png  [cache]',
    );
  });

  it('says what it can about a URL that resolves against no base at all', () => {
    // `baseURI` is what a `<base>` tag says, so it is page content like
    // everything else here, and a relative candidate against an unusable base
    // resolves to nothing. The string the page wrote is the honest answer.
    expect(loadedOf('/i/640.png', 'not a URL')).toBe('loaded  /i/640.png  [cache]');
  });
});
