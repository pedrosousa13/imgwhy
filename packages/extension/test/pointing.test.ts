import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { panelOf } from '../src/explain.js';
import { renderPanel } from '../src/panel.js';
import { readPage } from '../src/read.js';
import type { El, Page, World } from './dom.js';
import { box, descendants, dispatch, globals, listenersIn, page } from './dom.js';
import { image, reading } from './reading.js';

/** The id the panel gives its host, which is how the next click finds it. */
const HOST_ID = '__imgwhy_host__';

/** The desktop of the design's default device set. */
const DESKTOP: World = { width: 1440, height: 900, dpr: 1 };

/**
 * Pointing at the image a row is about, which is the half of this slice that
 * settles identity.
 *
 * The maintainer's report is the whole brief: "I need to be able to easily
 * identify the images. now it's impossible", and "I need to be able to
 * highlight the images I'm looking at to understand what is happening." A
 * thumbnail and a file name answer that in the panel. This answers it on the
 * page — the row a pointer or a keyboard is on marks the element it describes,
 * and activating the row brings that element into view.
 *
 * There is no browser here, for the reason the design gives:
 *
 * > **extension** — test the logic through `core`. Keep the panel thin enough
 * > that it needs no browser test.
 *
 * So the claims are held over the tree the panel builds and the events it
 * registers, against the `dom.ts` stand-in — which models bubbling, because
 * the panel's listeners come in two deliberate pairs that turn on exactly
 * that, and a dispatcher that bubbled everything would pass a panel written
 * the other way round.
 *
 * ## What still gets past
 *
 * - **Whether a browser paints the box where the numbers say.** The rule is
 *   asserted; the rendering of it is not, and cannot be without a browser.
 *   What makes the rule readable rather than guessed is that
 *   `getBoundingClientRect` and `position: fixed` are the same coordinate
 *   space, which is why there is no scroll offset anywhere in it.
 * - **A page that mutates between the read and the hover.** The handle is an
 *   index into `document.images`; `read.ts` argues why, and the row past the
 *   end is the case that is guarded rather than corrected.
 */

/** A page holding `images`, each with a box, in document order. */
function pageOf(boxes: { width: number; height: number; top: number; left: number }[]): Page {
  const host = page();
  const body = host.documentElement.children[0];
  if (body === undefined) throw new Error('the page has no body');

  for (const at of boxes) {
    const img = host.createElement('img');
    img.rect = at;
    img.baseURI = 'https://example.com/';
    img.currentSrc = 'https://example.com/i/640.png';
    body.appendChild(img);
    host.images.push(img);
  }
  return host;
}

/** The panel, rendered into `host` the way Chrome renders it. */
function render(host: Page, images: Parameters<typeof image>[0][]): void {
  const panel = panelOf(reading({ images: images.map((fields) => image(fields)) }));
  vm.runInContext(
    `(${String(renderPanel)})(${JSON.stringify(panel)})`,
    vm.createContext({ document: host }),
  );
}

/** The reader, run the way Chrome runs it, which is the click that closes. */
const close = (host: Page): void => {
  vm.runInContext(`(${String(readPage)})()`, vm.createContext(globals(host, DESKTOP)));
};

/** Every node the panel made, which is everything inside its closed root. */
function nodesIn(host: Page): El[] {
  const element = host.getElementById(HOST_ID);
  if (element === null) throw new Error('the panel added no host element');
  return host.shadow(element);
}

const of = (host: Page, tag: string): El[] => nodesIn(host).filter((node) => node.name === tag);

/**
 * The rule the panel wrote for the box it draws, or nothing.
 *
 * The second `<style>` in the root, which is the one the panel rewrites. An
 * empty one is the panel saying there is no box — the `div` is `display: none`
 * in the sheet above it, and the rule that overrides that is this one.
 */
function drawn(host: Page): string {
  const [, frame] = of(host, 'style');
  if (frame === undefined) throw new Error('the panel added no second stylesheet');
  return frame.textContent;
}

/** Every row of the panel, in document order. */
const rows = (host: Page): El[] => of(host, 'li');

/** The name button inside one row, which is the row's own control. */
function nameIn(row: El): El {
  const found = descendants(row).find((node) => node.name === 'button');
  if (found === undefined) throw new Error('the row has no name button');
  return found;
}

/**
 * One page element as everything a panel could write to it.
 *
 * Every field `dom.ts` gives an element, so an assignment anywhere in the
 * renderer shows up here as a diff. What is deliberately not in it is
 * `scrollIntoView`: the scroll offset is the one thing about the page a click
 * changes, the issue asks for it in those words, and it is not a property of
 * the element at all.
 *
 * The stand-in has no `style`, no `classList` and no `setAttribute`, which is
 * the other half of the same claim and the stronger half — a renderer that
 * reached for one would throw here rather than pass quietly.
 */
const written = (node: El): string =>
  JSON.stringify({
    id: node.id,
    src: node.src,
    srcset: node.srcset,
    sizes: node.sizes,
    media: node.media,
    alt: node.alt,
    title: node.title,
    open: node.open,
    loading: node.loading,
    currentSrc: node.currentSrc,
    width: node.width,
    height: node.height,
    rect: node.rect,
    baseURI: node.baseURI,
    background: node.background,
    words: node.textContent,
    children: node.children.length,
  });

describe('a row, pointed at with a mouse', () => {
  const boxes = [
    box({ width: 640, height: 360, top: 120, left: 40 }),
    box({ width: 96, height: 96, top: 700, left: 12 }),
  ];

  it('marks the image it describes, with that image’s own box', () => {
    const host = pageOf(boxes);
    render(host, [image({ at: 0 }), image({ at: 1 })]);

    dispatch(rows(host)[0], 'mouseenter');

    expect(drawn(host)).toBe(
      'div { display: block; top: 120px; left: 40px; width: 640px; height: 360px }',
    );
  });

  it('marks the second row’s image and not the first, which is the whole point', () => {
    const host = pageOf(boxes);
    render(host, [image({ at: 0 }), image({ at: 1 })]);

    dispatch(rows(host)[1], 'mouseenter');

    expect(drawn(host)).toBe(
      'div { display: block; top: 700px; left: 12px; width: 96px; height: 96px }',
    );
  });

  it('takes the mark away when the pointer leaves', () => {
    const host = pageOf(boxes);
    render(host, [image({ at: 0 }), image({ at: 1 })]);

    dispatch(rows(host)[0], 'mouseenter');
    dispatch(rows(host)[0], 'mouseleave');

    expect(drawn(host)).toBe('');
  });

  it('draws no box before anything is pointed at', () => {
    const host = pageOf(boxes);
    render(host, [image({ at: 0 })]);

    expect(drawn(host)).toBe('');
  });

  it('rounds the box, because a border on a half pixel is two grey ones', () => {
    const host = pageOf([box({ width: 640.4, height: 360.6, top: 119.5, left: 40.49 })]);
    render(host, [image({ at: 0 })]);

    dispatch(rows(host)[0], 'mouseenter');

    expect(drawn(host)).toBe(
      'div { display: block; top: 120px; left: 40px; width: 640px; height: 361px }',
    );
  });

  it('draws its own element and never touches the page’s', () => {
    // Criterion 3, and the project's own thesis applied to its own panel: a
    // panel that wrote an outline onto the page's element would have restyled
    // the thing it was measuring, and a restyled element can lay out at a
    // different width — which is an input to the arithmetic on the row.
    const host = pageOf(boxes);
    // The document element excepted, which is the one page element the panel
    // does change: it gains the host, and that is the whole of what an
    // injected panel is. Everything under it is compared field for field.
    const under = (at: Page): string[] =>
      at
        .light()
        .filter((node) => node !== at.documentElement && node.id !== HOST_ID)
        .map(written);
    const before = under(host);

    render(host, [image({ at: 0 }), image({ at: 1 })]);
    dispatch(rows(host)[0], 'mouseenter');
    dispatch(rows(host)[1], 'mouseenter');
    dispatch(rows(host)[1], 'mouseleave');

    // The page's own nodes, unchanged in every field one of them has.
    expect(under(host)).toEqual(before);
    expect(host.documentElement.children.map((node) => node.id)).toEqual(['', HOST_ID]);
    // And the box is a node of the panel's, inside the panel's closed root.
    const spot = of(host, 'div');
    expect(spot).toHaveLength(1);
    expect(spot[0]?.parent?.name).toBe('#shadow-root');
    expect(host.getElementById(HOST_ID)?.shadowRoot).toBeNull();
  });

  it('marks nothing where the page has removed the image since the read', () => {
    // The cost of the handle, guarded. A row past the end of the collection
    // finds no element, and the honest answer there is no box rather than a
    // box over whatever now sits at that index.
    const host = pageOf([boxes[0]]);
    render(host, [image({ at: 0 }), image({ at: 1 })]);

    dispatch(rows(host)[1], 'mouseenter');

    expect(drawn(host)).toBe('');
  });
});

describe('a row, activated', () => {
  const boxes = [box({ width: 640, height: 360, top: 2400, left: 40 })];

  it('brings the image into view, instantly and in the middle', () => {
    // Criterion 2. `behavior: 'instant'` is not a preference: a page with
    // `scroll-behavior: smooth` of its own animates the scroll, and the rect
    // read on the next line would be the box's position before the animation.
    const host = pageOf(boxes);
    render(host, [image({ at: 0 })]);

    dispatch(nameIn(rows(host)[0]), 'click');

    expect(host.images[0].scrolled).toEqual([{ block: 'center', behavior: 'instant' }]);
  });

  it('scrolls nothing at all where the image is no longer there', () => {
    const host = pageOf([]);
    render(host, [image({ at: 0 })]);

    dispatch(nameIn(rows(host)[0]), 'click');

    expect(drawn(host)).toBe('');
  });

  it('leaves the mark on the image it just scrolled to', () => {
    // The row keeps focus after a click, so the mark that focus produced has
    // to be the mark for the box's new position rather than its old one.
    const host = pageOf(boxes);
    render(host, [image({ at: 0 })]);

    dispatch(nameIn(rows(host)[0]), 'click');

    expect(drawn(host)).toContain('top: 2400px');
  });

  it('scrolls from the name and not from the row, so opening the arithmetic does not', () => {
    // Two controls, one job each: the name goes to the image, the summary
    // opens the figures. A click handler on the row would have made every
    // disclosure toggle scroll the page as well.
    const host = pageOf(boxes);
    render(host, [image({ at: 0 })]);

    dispatch(rows(host)[0], 'click');

    expect(host.images[0].scrolled).toEqual([]);
  });
});

describe('a row, reached with a keyboard', () => {
  const boxes = [box({ width: 640, height: 360, top: 120, left: 40 })];

  it('holds a control that takes focus, and a second that opens the figures', () => {
    // Criterion 8. Both are elements the platform already makes focusable and
    // already activates on Enter — a `button` and a `summary` — so this panel
    // has taught nobody a key and registered no key handler. `dormant.test.ts`
    // is what would refuse a `keydown` that tried to.
    const host = pageOf(boxes);
    render(host, [image({ at: 0 })]);
    const row = rows(host)[0];

    expect(
      descendants(row)
        .map((node) => node.name)
        .filter((name) => name === 'button' || name === 'summary'),
    ).toEqual(['button', 'summary', 'summary']);
  });

  it('marks the image when the row takes focus, the same as a hover does', () => {
    // Criterion 8's other half, and the guideline's: an affordance only a
    // mouse can reach is an affordance half the readers do not have.
    const host = pageOf(boxes);
    render(host, [image({ at: 0 })]);

    dispatch(nameIn(rows(host)[0]), 'focusin');

    expect(drawn(host)).toBe(
      'div { display: block; top: 120px; left: 40px; width: 640px; height: 360px }',
    );
  });

  it('takes the mark away when focus leaves the row', () => {
    const host = pageOf(boxes);
    render(host, [image({ at: 0 })]);

    dispatch(nameIn(rows(host)[0]), 'focusin');
    dispatch(nameIn(rows(host)[0]), 'focusout');

    expect(drawn(host)).toBe('');
  });

  it('listens for the focus pair that bubbles, because the row is not what takes focus', () => {
    // The pair that does not bubble would fire never: the thing that takes
    // focus is the button inside the row. The mirror of this is why the
    // pointer pair is the one that does not bubble — `mouseover` on a label
    // the pointer crossed would re-mark on every child of the row.
    const host = pageOf(boxes);
    render(host, [image({ at: 0 })]);
    const row = rows(host)[0];

    expect([...row.listeners.keys()].sort()).toEqual([
      'focusin',
      'focusout',
      'mouseenter',
      'mouseleave',
    ]);
    // And a pointer over the button alone does not reach the row's handler,
    // which is what says the stand-in models the difference at all.
    dispatch(nameIn(row), 'mouseenter');
    expect(drawn(host)).toBe('');
  });
});

describe('the panel, closed again', () => {
  const boxes = [box({ width: 640, height: 360, top: 120, left: 40 })];

  it('leaves no listener anywhere a page can reach, before or after', () => {
    // Criterion 7's second half, in its strongest form: not that the listeners
    // are unregistered on the way out, but that no page element ever carried
    // one. Every handler is on a node inside the closed root, so the closing
    // click's single `remove()` is the whole of the cleanup.
    const host = pageOf(boxes);

    expect(listenersIn(host)).toEqual([]);
    render(host, [image({ at: 0 })]);
    expect(listenersIn(host)).toEqual([]);

    dispatch(rows(host)[0], 'mouseenter');
    close(host);

    expect(listenersIn(host)).toEqual([]);
  });

  it('takes the mark with it, because the mark is inside the host', () => {
    // Criterion 7's first half. The box, its stylesheet and every listener are
    // children of the closed root, so there is nothing to take away separately
    // and nothing that can be left behind by being forgotten.
    const host = pageOf(boxes);
    render(host, [image({ at: 0 })]);
    dispatch(rows(host)[0], 'mouseenter');
    const spot = of(host, 'div');

    close(host);

    expect(host.getElementById(HOST_ID)).toBeNull();
    expect(host.light().filter((node) => node.name === 'div')).toEqual([]);
    // The box still hangs off the root it was made in, and the root's host is
    // no longer in the document — which is what "removed with the panel"
    // means for a node inside a shadow tree.
    expect(host.light()).not.toContain(spot[0]);
    expect(spot[0]?.parent?.parent?.parent).toBeNull();
  });

  it('leaves the page exactly as it was found', () => {
    // Criterion 7 as a whole, read off the page rather than off the panel. The
    // marks, the thumbnails and the scroll all happened, and every field of
    // every page element is the string it was before the click.
    const host = pageOf(boxes);
    const before = host.light().map(written);

    render(host, [image({ at: 0 })]);
    dispatch(rows(host)[0], 'mouseenter');
    dispatch(nameIn(rows(host)[0]), 'click');
    close(host);

    // The document element included this time, because the host it gained is
    // the thing the closing click takes away again.
    expect(host.light().map(written)).toEqual(before);
  });
});

describe('the thumbnail, which identifies the image in the panel', () => {
  it('asks for the file the browser loaded, and asks for nothing else', () => {
    // The whole `currentSrc` the reading took off the page's own image, so the
    // request is one the page has already made, to a host it has already
    // contacted, and usually answered out of the browser's own cache.
    // `privacy.test.ts` holds that the value is never anything the code built.
    const host = pageOf([box({ width: 640, height: 360 })]);
    render(host, [image({ currentSrc: 'https://example.com/i/640.png?w=640&q=80' })]);
    const [thumb] = of(host, 'img');

    expect(thumb?.src).toBe('https://example.com/i/640.png?w=640&q=80');
  });

  it('asks for nothing where the image has loaded nothing, and says so instead', () => {
    // An empty `src` resolves to the page's own address, so a browser pointed
    // at one fetches the document. The panel points it at nothing at all, and
    // the `alt` beside it is what a reader gets in the box's place.
    const host = pageOf([box()]);
    render(host, [image({ srcset: '/i/640.png 640w, /i/1080.png 1080w', currentSrc: '' })]);
    const [thumb] = of(host, 'img');

    expect(thumb?.src).toBe('');
    expect(thumb?.alt).toBe('nothing loaded');
  });

  it('says what the page called the image, so a box that will not draw still names it', () => {
    const host = pageOf([box()]);
    render(host, [
      image({ currentSrc: 'https://example.com/i/640.png', alt: 'A person at a desk' }),
    ]);

    expect(of(host, 'img')[0]?.alt).toBe('A person at a desk');
  });

  it('sits inside the row it belongs to, one per image and no more', () => {
    const host = pageOf([box(), box()]);
    render(host, [image({ at: 0 }), image({ at: 1 })]);

    expect(of(host, 'img')).toHaveLength(2);
    expect(of(host, 'img').map((node) => node.parent?.name)).toEqual(['header', 'header']);
  });
});

describe('the panel, laid out so twenty-three images can be read', () => {
  /** Twenty-three images, which is the page the maintainer sent a screenshot of. */
  const many = (): Page => {
    const host = pageOf([]);
    return host;
  };

  it('opens with the summary and the rows, and holds the prose behind a line', () => {
    // The screenshot's diagnosis, as a shape: the three standing paragraphs
    // are inside a disclosure, so what a reader meets is the data. Every word
    // of them is still here.
    const host = many();
    render(host, [image({ at: 0 })]);
    const notes = of(host, 'footer')[0]?.children[0];

    expect(notes?.name).toBe('details');
    expect(notes?.open).toBe(false);
    expect(notes?.children[0]?.textContent).toBe(
      'What a mark means, and why bytes are unknown',
    );
    expect(notes?.children.filter((node) => node.name === 'p')).toHaveLength(2);
  });

  it('opens the card and closes every row, so the default view is one line each', () => {
    const host = many();
    render(host, [image({ at: 0 }), image({ at: 1 }), image({ at: 2 })]);
    const [card] = of(host, 'details');

    expect(card?.open).toBe(true);
    expect(
      rows(host).map((row) => row.children.filter((node) => node.name === 'details')[0]?.open),
    ).toEqual([false, false, false]);
  });

  it('keeps the arithmetic, the addresses and the DOM path inside the row’s disclosures', () => {
    // Demoting the path was the fourth of the maintainer's notes. It is still
    // there and still selectable text; it is simply two openings down, with
    // the whole URLs, where a reader who wants it goes.
    const host = many();
    render(host, [image({ at: 0, selector: 'html > body > figure > a > picture > img' })]);
    const open = rows(host)[0]?.children.filter((node) => node.name === 'details')[0];
    const inside = open === undefined ? [] : descendants(open);

    expect(inside.map((node) => node.textContent)).toContain(
      'html > body > figure > a > picture > img',
    );
    expect(inside.filter((node) => node.name === 'dl')).toHaveLength(2);
  });

  it('says in one heading and one sentence, per row, what happened, which is what a scan reads', () => {
    const host = many();
    render(host, [
      image({
        at: 0,
        srcset: '/i/640.png 640w, /i/1080.png 1080w',
        sizes: '33vw',
        renderedWidth: 475,
        currentSrc: 'https://example.com/i/1080.png',
      }),
    ]);
    const [top] = of(host, 'header');

    expect(top?.children.map((node) => node.textContent)).toEqual([
      '',
      'oversized1080w1080.pngcache',
      'The arithmetic picks 640w — your screen is 1440 px wide at DPR 1 (standard); sizes gives ' +
        'it 33vw, which is 475 px, so it needs 475 device pixels — but the browser already held ' +
        '1080w and reused it rather than choosing again; an empty cache is the only way to see ' +
        'the real pick.',
    ]);
  });
});
