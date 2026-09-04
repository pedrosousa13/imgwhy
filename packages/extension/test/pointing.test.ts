import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Panel } from '../src/explain.js';
import { panelOf } from '../src/explain.js';
import { renderPanel } from '../src/panel.js';
import type { Reading } from '../src/read.js';
import { readPage } from '../src/read.js';
import type { Page, Win, World } from './dom.js';
import {
  El,
  Ev,
  box,
  descendants,
  dispatch,
  globals,
  listenersIn,
  page,
  windowOf,
} from './dom.js';
import { image, reading } from './reading.js';

/** The id the panel gives its host, which is how the next click finds it. */
const HOST_ID = '__imgwhy_host__';

/**
 * The event the closing click fires on the window before it removes the host,
 * which is how the panel hears that it is going.
 *
 * Written out here rather than imported, for the reason the two injected
 * functions declare it twice: neither of them can see a shared constant, so
 * the name is the contract and a test that spelled it differently would be a
 * test agreeing with itself.
 */
const CLOSING = '__imgwhy_closing__';

/** What a row says where it can no longer find the image it describes. */
const NOT_FOUND = 'not found';

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
 * the other way round. It models a window as well, because the two claims this
 * file grew are about a scroll offset that moves and a box that moves with it.
 *
 * A page that mutates between the read and the hover used to be listed below
 * as something that got past. It is the subject of two of the describes now:
 * the scroll a click makes is the window's alone, and the element a row's
 * index resolves to is confirmed against the file the reading recorded before
 * anything is drawn on it.
 *
 * ## What still gets past
 *
 * - **Whether a browser paints the box where the numbers say.** The rule is
 *   asserted; the rendering of it is not, and cannot be without a browser.
 *   What makes the rule readable rather than guessed is that
 *   `getBoundingClientRect` and `position: fixed` are the same coordinate
 *   space, which is why there is no scroll offset in the rule and why the
 *   window is listened to instead.
 * - **Where a browser lands a scroll.** `scrollTo` is asserted as the figure
 *   it was handed, and the window model moves the boxes by exactly that. A
 *   browser clamps at the bottom of the document, and no claim here depends on
 *   the difference.
 */

/**
 * The file the image at one position on a page loaded.
 *
 * One address per image rather than one for the page, because the file the
 * browser loaded is what a row is confirmed against: two images sharing a URL
 * are two images no reading can tell apart, and a fixture that gave every
 * image the same one would let a panel that marked the neighbour pass.
 */
const fileAt = (at: number): string => `https://example.com/i/${at}-640.png`;

/** A page holding `images`, each with a box and its own file, in document order. */
function pageOf(boxes: { width: number; height: number; top: number; left: number }[]): Page {
  const host = page();
  const body = host.documentElement.children[0];
  if (body === undefined) throw new Error('the page has no body');

  for (const at of boxes) host.images.push(imageIn(host, body, at, fileAt(host.images.length)));
  return host;
}

/** One `<img>`, as the page holds it: a box, a file, and a place in the tree. */
function imageIn(host: Page, parent: El, at: Parameters<typeof box>[0], file: string): El {
  const img = host.createElement('img');
  img.rect = box(at);
  img.baseURI = 'https://example.com/';
  img.currentSrc = file;
  parent.appendChild(img);
  return img;
}

/**
 * The rows a reading of this page produces, each pointing at the image it
 * describes.
 *
 * Built off the page rather than written out, because that is the relation
 * every claim below is about: the row at index `n` is the row for the image
 * `document.images` held at `n` when the click read it, carrying the file that
 * image had loaded. A case that then moves the page moves it after this.
 */
const rowsFor = (host: Page): Parameters<typeof image>[0][] =>
  host.images.map((img, at) => ({ at, currentSrc: img.currentSrc }));

/**
 * The page's own script, inserting an image above everything the reading saw.
 *
 * The mutation the issue is about, and the reason it is written as a helper: an
 * infinite-scroll page that lazy-inserts one image above the fold shifts every
 * later entry of `document.images` by one, so every row's index now resolves to
 * the neighbour of the image it describes. Nothing about that is exotic; it is
 * one `insertBefore` in somebody's carousel.
 */
function insertImage(host: Page, at: Parameters<typeof box>[0], file: string): El {
  const body = host.documentElement.children[0];
  if (body === undefined) throw new Error('the page has no body');

  const img = imageIn(host, body, at, file);
  // `appendChild` put it last. The page put it first, which is the whole point
  // of the case: every later index moves by one.
  body.children.pop();
  body.children.unshift(img);
  host.images.unshift(img);
  return img;
}

/** The page's own script, taking one image away again. */
function removeImage(host: Page, at: number): void {
  const [img] = host.images.splice(at, 1);
  img?.remove();
}

/** One panel, rendered into `host` the way Chrome renders it. */
function paint(host: Page, panel: Panel, win: Win = windowOf(host)): void {
  vm.runInContext(
    `(${String(renderPanel)})(${JSON.stringify(panel)})`,
    vm.createContext({ document: host, window: win }),
  );
}

/** The panel, rendered into `host` the way Chrome renders it. */
function render(
  host: Page,
  images: Parameters<typeof image>[0][],
  win: Win = windowOf(host),
): void {
  paint(host, panelOf(reading({ images: images.map((fields) => image(fields)) })), win);
}

/** The reader, run the way Chrome runs it, which is the click that closes. */
const close = (host: Page, win: Win = windowOf(host)): void => {
  vm.runInContext(`(${String(readPage)})()`, vm.createContext(globals(host, DESKTOP, win)));
};

/**
 * The whole click, on a page nobody wrote a reading for: read it, ask the
 * worker, render what comes back.
 *
 * Three steps rather than one because the click is three, and because a claim
 * about what the panel requests is a claim about all three of them. A case that
 * hands `panelOf` a reading it wrote itself is a case that has already decided
 * what the page reported, which is where the defect in #34 lived.
 */
function clickIn(host: Page, win: Win = windowOf(host)): Reading {
  const found = vm.runInContext(
    `(${String(readPage)})()`,
    vm.createContext(globals(host, DESKTOP, win)),
  ) as Reading | null;
  if (found === null) throw new Error('the reader removed a panel instead of reading the page');

  paint(host, panelOf(found), win);
  return found;
}

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

/**
 * The flags on one row's heading, in order.
 *
 * Two things a row can say about itself with a word rather than a sentence:
 * `cache` where a held copy could explain the figures, and `not found` where
 * the handle no longer resolves to the image the row describes. Both are
 * `mark` elements, which is the platform's element for a figure flagged for
 * reference and needs no class of its own.
 */
const flagsIn = (row: El): string[] => {
  const named = descendants(row).find((node) => node.name === 'h2');
  return (named?.children ?? [])
    .filter((node) => node.name === 'mark')
    .map((node) => node.textContent);
};

/** The name button inside one row, which is the row's own control. */
function nameIn(row: El): El {
  const found = descendants(row).find((node) => node.name === 'button');
  if (found === undefined) throw new Error('the row has no name button');
  return found;
}

/**
 * The fields of the stand-in that are the tree itself rather than something a
 * renderer writes to an element.
 *
 * Named as a closed list, and it is the mechanism that keeps `written` below
 * complete as `dom.ts` grows: everything else an element has is compared
 * automatically, so a field added to the stand-in is a field this claim covers
 * on the commit that adds it. The list this replaced was written out by hand
 * and had fallen two fields behind — `className` and `scrolled` were both
 * missing, so `image.className = 'imgwhy-marked'` inside `place()` left every
 * test green while the panel restyled the element it was measuring.
 *
 * Why each of the seven is out:
 *
 * - `children`, `parent`, `attached` and `shadowRoot` are the shape of the
 *   tree. The panel does add a host to the document element, which is the whole
 *   of what an injected panel is, and the cases below compare the tree
 *   separately and by name.
 * - `name` is the tag, which nothing can write.
 * - `text` is the storage behind `textContent`; `words` below is that same
 *   state under the name a diff reads better under.
 * - `listeners` is a `Map`, which JSON renders as `{}` however full it is, so
 *   it could not be compared here even in principle. `listenersIn` is the claim
 *   about it, and it is the stronger form: no page element ever carried one.
 */
const STRUCTURE = new Set([
  'attached',
  'children',
  'listeners',
  'name',
  'parent',
  'shadowRoot',
  'text',
]);

/**
 * One page element as everything a panel could write to it.
 *
 * Every field `dom.ts` gives an element bar the seven above, read off the
 * element rather than listed, so an assignment anywhere in the renderer shows
 * up here as a diff — the scroll offset inside a page element included, and the
 * class name, and every `scrollIntoView` the element was asked for.
 *
 * The window's own offset is not here, because it is not a property of any
 * element: it is the one thing about the page a click changes, the issue asks
 * for it in those words, and it is the one change a reader can undo with a
 * scroll. The case at the end of this file undoes it and compares every field
 * again, which is the strongest form the claim has.
 *
 * The stand-in has no `style`, no `classList` and no `setAttribute`, which is
 * the other half of the same claim and the stronger half — a renderer that
 * reached for one would throw here rather than pass quietly.
 */
const written = (node: El): string =>
  JSON.stringify({
    ...Object.fromEntries(Object.entries(node).filter(([field]) => !STRUCTURE.has(field))),
    words: node.textContent,
    children: node.children.length,
  });

describe('what a page element is compared on', () => {
  it('covers every field the stand-in gives an element, and names what it leaves out', () => {
    // The claim `written` rests on, held over `dom.ts` itself rather than over
    // a list somebody kept up to date. A field added to the stand-in is
    // compared by the commit that adds it, and a field taken out of the
    // comparison has to be added to `STRUCTURE` by name — where the comment
    // above says why each of the seven is not something a renderer writes.
    const sample = new El('img');
    const compared = new Set(Object.keys(JSON.parse(written(sample))));

    expect(
      Object.keys(sample).filter((field) => !STRUCTURE.has(field) && !compared.has(field)),
    ).toEqual([]);
    expect([...STRUCTURE].sort()).toEqual([
      'attached',
      'children',
      'listeners',
      'name',
      'parent',
      'shadowRoot',
      'text',
    ]);
    // And the two the hand-written list had lost, named so they cannot be lost
    // again quietly: a restyled element lays out at a different width, and that
    // width is an input to the arithmetic on the very row doing the restyling.
    expect(compared).toContain('className');
    expect(compared).toContain('scrolled');
  });
});

describe('a row, pointed at with a mouse', () => {
  const boxes = [
    box({ width: 640, height: 360, top: 120, left: 40 }),
    box({ width: 96, height: 96, top: 700, left: 12 }),
  ];

  it('marks the image it describes, with that image’s own box', () => {
    const host = pageOf(boxes);
    render(host, rowsFor(host));

    dispatch(rows(host)[0], 'mouseenter');

    expect(drawn(host)).toBe(
      'div { display: block; top: 120px; left: 40px; width: 640px; height: 360px }',
    );
  });

  it('marks the second row’s image and not the first, which is the whole point', () => {
    const host = pageOf(boxes);
    render(host, rowsFor(host));

    dispatch(rows(host)[1], 'mouseenter');

    expect(drawn(host)).toBe(
      'div { display: block; top: 700px; left: 12px; width: 96px; height: 96px }',
    );
  });

  it('takes the mark away when the pointer leaves', () => {
    const host = pageOf(boxes);
    render(host, rowsFor(host));

    dispatch(rows(host)[0], 'mouseenter');
    dispatch(rows(host)[0], 'mouseleave');

    expect(drawn(host)).toBe('');
  });

  it('draws no box before anything is pointed at', () => {
    const host = pageOf(boxes);
    render(host, rowsFor(host));

    expect(drawn(host)).toBe('');
  });

  it('rounds the box, because a border on a half pixel is two grey ones', () => {
    const host = pageOf([box({ width: 640.4, height: 360.6, top: 119.5, left: 40.49 })]);
    render(host, rowsFor(host));

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

    render(host, rowsFor(host));
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
    // The cost of the handle, guarded. The row's index finds no element, and
    // no image left on the page loaded the file the row names, so the honest
    // answer is no box rather than a box over whatever now sits there.
    const host = pageOf(boxes);
    render(host, rowsFor(host));
    removeImage(host, 1);

    dispatch(rows(host)[1], 'mouseenter');

    expect(drawn(host)).toBe('');
  });
});

describe('a row, activated', () => {
  const boxes = [box({ width: 640, height: 360, top: 2400, left: 40 })];

  it('brings the image into view by scrolling the window, and instantly', () => {
    // Criterion 2, and the window rather than the element. `behavior:
    // 'instant'` is not a preference: a page with `scroll-behavior: smooth` of
    // its own animates the scroll, and the rect read on the next line would be
    // the box's position before the animation.
    //
    // The figure is a document coordinate, which is the rect's own `top` plus
    // where the page was already scrolled to — a panel that handed `scrollTo`
    // the rect alone would scroll to the right place only from the top of the
    // page.
    const host = pageOf(boxes);
    const win = windowOf(host);
    render(host, rowsFor(host), win);

    dispatch(nameIn(rows(host)[0]), 'click');

    expect(win.scrolled).toEqual([{ top: 2400, behavior: 'instant' }]);
    expect(win.scrollY).toBe(2400);
    // And `scrollIntoView` is not asked for at all, which is the half of the
    // claim that is about what a click does *not* touch.
    expect(host.images[0].scrolled).toEqual([]);
  });

  it('brings it into view from a page that was already scrolled, which is the offset in the sum', () => {
    // The term the case above cannot fail. `scrollTo` takes a document
    // coordinate and a rect is a viewport one, so the sum is the rect's own
    // `top` plus where the page was already scrolled to — and at the top of the
    // page those two figures are the same number, which is where every other
    // fixture in this file starts. Here the reader is 900 down the page and the
    // image is 300 below the fold, so the document coordinate is 1200 and the
    // rect alone would scroll to the wrong place by exactly the offset.
    const host = pageOf([box({ width: 640, height: 360, top: 300, left: 40 })]);
    const win = windowOf(host);
    win.scrollY = 900;
    render(host, rowsFor(host), win);

    dispatch(nameIn(rows(host)[0]), 'click');

    expect(win.scrolled).toEqual([{ top: 1200, behavior: 'instant' }]);
    expect(win.scrollY).toBe(1200);
    // And the mark is on the box where that scroll left it: the image was 300
    // below the fold and the page moved 300, so it is at the top of the
    // viewport.
    expect(drawn(host)).toBe(
      'div { display: block; top: 0px; left: 40px; width: 640px; height: 360px }',
    );
  });

  it('leaves every other scroll container where the page’s own script put it', () => {
    // The defect, as a page that has one. A carousel holds its track at an
    // offset its own code chose, and `scrollIntoView` scrolls every scroll
    // container between the image and the viewport — an `overflow: hidden` one
    // included, which a reader has no scrollbar to undo. The track moves, the
    // carousel's index and dot indicator still say otherwise, and the next
    // interaction animates from a position the script did not expect.
    //
    // So the window is the only thing a click moves. An image inside a clipped
    // container stays clipped, which is the honest outcome: the mark still says
    // where it sits, and the panel does not reach into machinery it cannot put
    // back.
    const host = pageOf([]);
    const body = host.documentElement.children[0] as El;
    const track = host.createElement('div');
    track.overflow = 'hidden';
    track.scrollTop = 240;
    body.appendChild(track);
    host.images.push(
      imageIn(host, track, { width: 320, height: 180, top: 2400 }, fileAt(0)),
    );
    const win = windowOf(host);
    render(host, rowsFor(host), win);

    dispatch(nameIn(rows(host)[0]), 'click');

    expect(track.scrollTop).toBe(240);
    expect(win.scrolled).toEqual([{ top: 2400, behavior: 'instant' }]);
  });

  it('scrolls nothing at all where the image is no longer there', () => {
    const host = pageOf(boxes);
    render(host, rowsFor(host));
    removeImage(host, 0);

    dispatch(nameIn(rows(host)[0]), 'click');

    expect(drawn(host)).toBe('');
  });

  it('leaves the mark on the image it just scrolled to, where the scroll left it', () => {
    // The row keeps focus after a click, so the mark that focus produced has
    // to be the mark for the box's new position rather than its old one. The
    // image was 2400 down the page and the window scrolled 2400, so the box is
    // at the top of the viewport and the mark says so.
    //
    // Which pins the order of the two lines in the click handler, now that a
    // scroll fires no event of its own here: marking before scrolling reads the
    // rect the page had before it moved, and nothing inside the call corrects
    // it. A browser would correct it on the next frame, one frame late.
    const host = pageOf(boxes);
    const win = windowOf(host);
    render(host, rowsFor(host), win);

    dispatch(nameIn(rows(host)[0]), 'click');

    expect(drawn(host)).toBe(
      'div { display: block; top: 0px; left: 40px; width: 640px; height: 360px }',
    );
  });

  it('scrolls from the name and not from the row, so opening the arithmetic does not', () => {
    // Two controls, one job each: the name goes to the image, the summary
    // opens the figures. A click handler on the row would have made every
    // disclosure toggle scroll the page as well.
    const host = pageOf(boxes);
    const win = windowOf(host);
    render(host, rowsFor(host), win);

    dispatch(rows(host)[0], 'click');

    expect(win.scrolled).toEqual([]);
    expect(host.images[0].scrolled).toEqual([]);
  });
});

/**
 * The mark, while it is up, which is the half of the pointing that goes stale.
 *
 * A rect is a measurement of one moment and the mark is written into a
 * stylesheet as fixed viewport coordinates, so anything that moves the image
 * after the read leaves the box over blank space — and a box over blank space
 * is the identity failure the mark exists to fix, stated more confidently than
 * before. So the rect is read again while a mark is up.
 *
 * ## What still gets past
 *
 * - **A layout shift that fires nothing at all.** A lazy ad slot inserted
 *   above the image while the reader is at the top of the page moves the box
 *   and gives the panel no event: scroll anchoring is what fires a scroll for
 *   most of these, and where it does not, the box stays where it was until the
 *   next scroll, resize or hover. Closing that means a `ResizeObserver` on a
 *   page element or a loop that polls, and the panel has neither — an observer
 *   on somebody's `<img>` is a reach into the page for a box that is already
 *   re-read on every signal the platform gives for free.
 * - **Which frame the box is painted in.** The listener is synchronous here
 *   and a browser fires `scroll` on the next frame, so a browser draws the box
 *   one frame behind a fast scroll. No test here can see a frame.
 */
describe('a mark, while it is up', () => {
  const boxes = [
    box({ width: 640, height: 360, top: 120, left: 40 }),
    box({ width: 96, height: 96, top: 700, left: 12 }),
  ];

  it('follows its image across a scroll', () => {
    const host = pageOf(boxes);
    const win = windowOf(host);
    render(host, rowsFor(host), win);
    dispatch(rows(host)[1], 'mouseenter');

    // The scroll and the event it causes are two steps, because in a browser
    // they are: the offset moves now and `scroll` fires on the next frame.
    win.scrollTo({ top: 300 });
    win.dispatchEvent(new Ev('scroll'));

    expect(drawn(host)).toBe(
      'div { display: block; top: 400px; left: 12px; width: 96px; height: 96px }',
    );
  });

  it('follows its image across a resize', () => {
    // A narrower window relays out the page, and where the page moved the
    // image to is the page's business — so the case says it, and what is
    // asserted is that the panel read the box again rather than the one it drew
    // with.
    const host = pageOf(boxes);
    const win = windowOf(host);
    render(host, rowsFor(host), win);
    dispatch(rows(host)[0], 'mouseenter');

    host.images[0].rect = box({ width: 320, height: 180, top: 96, left: 0 });
    win.dispatchEvent(new Ev('resize'));

    expect(drawn(host)).toBe(
      'div { display: block; top: 96px; left: 0px; width: 320px; height: 180px }',
    );
  });

  it('follows a layout shift that moves the image out from under it', () => {
    // The issue's own case: a lazy ad slot or a late web font resolving above
    // the image pushes it down the page while the pointer is on its row. The
    // signal is the scroll the browser's own scroll anchoring fires to keep
    // the reader where they were looking.
    const host = pageOf(boxes);
    const win = windowOf(host);
    render(host, rowsFor(host), win);
    dispatch(rows(host)[0], 'mouseenter');

    host.images[0].rect = box({ width: 640, height: 360, top: 620, left: 40 });
    win.dispatchEvent(new Ev('scroll'));

    expect(drawn(host)).toBe(
      'div { display: block; top: 620px; left: 40px; width: 640px; height: 360px }',
    );
  });

  it('listens on the window only while a mark is up, and takes those listeners down with it', () => {
    // The listeners the tracking costs, and the whole of what it costs. Three
    // go up together with the box and come down together with it: the two that
    // say the box may have moved, and the one that says the panel is going.
    const host = pageOf(boxes);
    const win = windowOf(host);
    render(host, rowsFor(host), win);

    expect([...win.listeners.keys()]).toEqual([]);

    dispatch(rows(host)[0], 'mouseenter');
    expect([...win.listeners.keys()].sort()).toEqual([CLOSING, 'resize', 'scroll']);

    dispatch(rows(host)[0], 'mouseleave');
    expect([...win.listeners.keys()]).toEqual([]);
  });

  it('takes them down when the panel closes with a mark still up', () => {
    // Which is why the closing click says so. A toolbar click does not move
    // the pointer off the row, so the mark is up when the panel goes — and a
    // window listener is the one thing in this panel that `remove()` on the
    // host does not take with it.
    const host = pageOf(boxes);
    const win = windowOf(host);
    render(host, rowsFor(host), win);
    dispatch(nameIn(rows(host)[0]), 'focusin');
    expect([...win.listeners.keys()].sort()).toEqual([CLOSING, 'resize', 'scroll']);

    close(host, win);

    expect(host.getElementById(HOST_ID)).toBeNull();
    expect([...win.listeners.keys()]).toEqual([]);
  });
});

/**
 * A row whose image the page has moved, which is what the handle costs.
 *
 * The handle is the index into `document.images` the reading minted, and an
 * insertion before that index shifts every later row onto a neighbouring
 * element. So the index is the fast path and the file the browser loaded is
 * what confirms it: a row marks and scrolls to an element only where that
 * element is still the one the row describes.
 *
 * ## What still gets past
 *
 * - **Two images that loaded the same file.** They are two images no reading
 *   can tell apart. Where the index misses, a row naming a file two images hold
 *   says `not found` rather than guessing between them; where the index hits,
 *   it stands, because refusing to mark the twentieth identical avatar on a
 *   page would be a worse panel than one that marks whichever of them the
 *   index names.
 * - **A row that loaded nothing.** There is no file to confirm against, so the
 *   index is confirmed only as far as "the image here has still loaded
 *   nothing". A lazy image that finished loading in between fails that, and
 *   the row says `not found` — which is the honest word for a row whose
 *   verdict, thumbnail and sentence are all about a file that has since
 *   arrived.
 */
describe('a row whose image the page has moved', () => {
  const boxes = [
    box({ width: 640, height: 360, top: 120, left: 40 }),
    box({ width: 96, height: 96, top: 700, left: 12 }),
  ];

  /** One image, inserted above the fold by the page's own script. */
  const above = (host: Page): El =>
    insertImage(host, { width: 240, height: 135, top: 0 }, 'https://example.com/i/late.png');

  it('marks the image it describes and not the neighbour an insertion shifted onto its index', () => {
    const host = pageOf(boxes);
    render(host, rowsFor(host));
    above(host);

    dispatch(rows(host)[0], 'mouseenter');

    expect(drawn(host)).toBe(
      'div { display: block; top: 120px; left: 40px; width: 640px; height: 360px }',
    );
  });

  it('scrolls to the image it describes and not to the one now sitting at its index', () => {
    const host = pageOf(boxes);
    const win = windowOf(host);
    render(host, rowsFor(host), win);
    above(host);

    dispatch(nameIn(rows(host)[1]), 'click');

    expect(win.scrolled).toEqual([{ top: 700, behavior: 'instant' }]);
  });

  it('says so where the image it describes is no longer on the page', () => {
    // #22's commit message claimed this and the panel did not do it: the row
    // silently marked its neighbour. The word is on the heading, beside the
    // one that says a held copy could explain the figures, and it says what it
    // means where it is.
    const host = pageOf(boxes);
    render(host, rowsFor(host));
    removeImage(host, 0);

    dispatch(rows(host)[0], 'mouseenter');

    expect(flagsIn(rows(host)[0])).toEqual(['cache', NOT_FOUND]);
    expect(drawn(host)).toBe('');
  });

  it('scrolls nowhere for a row whose image it cannot confirm', () => {
    const host = pageOf(boxes);
    const win = windowOf(host);
    render(host, rowsFor(host), win);
    removeImage(host, 0);

    dispatch(nameIn(rows(host)[0]), 'click');

    expect(win.scrolled).toEqual([]);
    expect(win.scrollY).toBe(0);
    expect(flagsIn(rows(host)[0])).toEqual(['cache', NOT_FOUND]);
  });

  it('says so where the file the row names is held by two images it cannot choose between', () => {
    // The limit of confirming on the loaded file, pinned so the search cannot
    // quietly become "take the first". A page with two identical avatars and a
    // hero above them is a page where removing the hero leaves the third row's
    // index past the end and its file held twice — and a box drawn confidently
    // over one of the two is the failure this whole check exists to stop.
    const host = pageOf([]);
    const body = host.documentElement.children[0] as El;
    const avatar = 'https://example.com/i/avatar.png';
    host.images.push(imageIn(host, body, { width: 640, height: 360, top: 120 }, fileAt(0)));
    host.images.push(imageIn(host, body, { width: 48, height: 48, top: 800 }, avatar));
    host.images.push(imageIn(host, body, { width: 48, height: 48, top: 900 }, avatar));
    render(host, rowsFor(host));
    removeImage(host, 0);

    dispatch(rows(host)[2], 'mouseenter');

    expect(flagsIn(rows(host)[2])).toEqual(['cache', NOT_FOUND]);
    expect(drawn(host)).toBe('');
  });

  it('still marks a row whose image had loaded nothing, where nothing has loaded there since', () => {
    // The other half of the same rule, and the one a check written carelessly
    // would break: a lazy image below the fold has no file to be confirmed by,
    // and refusing to mark every one of them would be worse than the defect.
    // The index is confirmed as far as it goes — the image there has still
    // loaded nothing — and the box is drawn.
    const host = pageOf([]);
    const body = host.documentElement.children[0] as El;
    host.images.push(imageIn(host, body, { width: 300, height: 200, top: 1800 }, ''));
    render(host, rowsFor(host));

    dispatch(rows(host)[0], 'mouseenter');

    expect(flagsIn(rows(host)[0])).toEqual([]);
    expect(drawn(host)).toBe(
      'div { display: block; top: 1800px; left: 0px; width: 300px; height: 200px }',
    );
  });

  it('marks one whose src attribute names a file it has not requested, which is every lazy image', () => {
    // The same rule against the image the case above was written without: a
    // lazy image carries a `src`, and confirming the handle against the `src`
    // property rather than the loaded file compared a URL with the empty string
    // and missed on every one of them. So the row for the ordinary lazy image
    // said `not found` and marked nothing, which is the failure the word exists
    // to report rather than to cause.
    const host = pageOf([]);
    const body = host.documentElement.children[0] as El;
    const lazy = imageIn(host, body, { width: 300, height: 200, top: 1800 }, '');
    lazy.srcAttribute = 'https://example.com/i/800x600.png';
    lazy.loading = 'lazy';
    host.images.push(lazy);
    render(host, rowsFor(host));

    dispatch(rows(host)[0], 'mouseenter');

    expect(flagsIn(rows(host)[0])).toEqual([]);
    expect(drawn(host)).toBe(
      'div { display: block; top: 1800px; left: 0px; width: 300px; height: 200px }',
    );
  });

  it('takes the box down when the next row cannot find its image', () => {
    // The sequence a single hover cannot produce: a row that resolves draws a
    // box, and the row after it does not resolve. Without the box being taken
    // down first, the rule the panel wrote for the first row is still in the
    // sheet — a box drawn confidently over an unrelated image, which is the
    // failure the `not found` word exists to replace rather than to accompany.
    const host = pageOf(boxes);
    render(host, rowsFor(host));
    removeImage(host, 1);

    dispatch(rows(host)[0], 'mouseenter');
    expect(drawn(host)).toBe(
      'div { display: block; top: 120px; left: 40px; width: 640px; height: 360px }',
    );

    dispatch(rows(host)[1], 'mouseenter');

    expect(drawn(host)).toBe('');
    expect(flagsIn(rows(host)[1])).toEqual(['cache', NOT_FOUND]);
  });

  it('moves the word to the row that is asking, when two rows in a row cannot find one', () => {
    // The scenario the guard names: a pointer on one row while a keyboard takes
    // focus to another. Both rows have lost their image, so the second reading
    // has a word already up — and a word left on the row the pointer has moved
    // off is a word on the wrong row, which is a reader told the image they are
    // now looking at is fine.
    const host = pageOf(boxes);
    render(host, rowsFor(host));
    removeImage(host, 1);
    removeImage(host, 0);

    dispatch(rows(host)[0], 'mouseenter');
    expect(flagsIn(rows(host)[0])).toEqual(['cache', NOT_FOUND]);

    dispatch(nameIn(rows(host)[1]), 'focusin');

    expect(flagsIn(rows(host)[0])).toEqual(['cache']);
    expect(flagsIn(rows(host)[1])).toEqual(['cache', NOT_FOUND]);
  });

  it('takes the word back off the row when the mark comes down', () => {
    const host = pageOf(boxes);
    render(host, rowsFor(host));
    removeImage(host, 0);

    dispatch(rows(host)[0], 'mouseenter');
    expect(flagsIn(rows(host)[0])).toEqual(['cache', NOT_FOUND]);

    dispatch(rows(host)[0], 'mouseleave');

    expect(flagsIn(rows(host)[0])).toEqual(['cache']);
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
    render(host, rowsFor(host));
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
    render(host, rowsFor(host));

    dispatch(nameIn(rows(host)[0]), 'focusin');

    expect(drawn(host)).toBe(
      'div { display: block; top: 120px; left: 40px; width: 640px; height: 360px }',
    );
  });

  it('takes the mark away when focus leaves the row', () => {
    const host = pageOf(boxes);
    render(host, rowsFor(host));

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
    render(host, rowsFor(host));
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
    render(host, rowsFor(host));
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
    render(host, rowsFor(host));
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

  it('leaves the page exactly as it was found, once the scroll is scrolled back', () => {
    // Criterion 7 as a whole, read off the page rather than off the panel. The
    // marks, the thumbnails and the scroll all happened, and every field of
    // every page element is what it was before the click.
    //
    // The window scroll is the one documented exception, and scrolling back is
    // the argument for it rather than a convenience here: a viewport offset is
    // a position a reader can undo with a wheel, which is exactly what the
    // clipped container the panel refuses to touch is not. Undone, the page is
    // identical field for field — the boxes included, because a scroll moves
    // every one of them and moves them all back.
    const host = pageOf(boxes);
    const win = windowOf(host);
    const before = host.light().map(written);

    render(host, rowsFor(host), win);
    dispatch(rows(host)[0], 'mouseenter');
    dispatch(nameIn(rows(host)[0]), 'click');
    close(host, win);
    win.scrollTo({ top: 0 });

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
    //
    // Both halves are asserted, because they are two different states and one
    // of them is the bug. The attribute was never set, which is what "asks for
    // nothing" means; the property is empty *because* of that. An unconditional
    // assignment would leave the attribute set to `''` and the property reading
    // the page's own address — which is the request, made by a panel that
    // looks, on a stand-in modelling `src` as a plain string, exactly like one
    // that made none.
    const host = pageOf([box()]);
    render(host, [image({ srcset: '/i/640.png 640w, /i/1080.png 1080w', currentSrc: '' })]);
    const [thumb] = of(host, 'img');

    expect(thumb?.srcAttribute).toBeNull();
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

/**
 * A page of lazy images the browser has not requested, read and explained and
 * drawn, which is the one arrangement the defect in #34 could be seen in.
 *
 * Every claim the panel makes about a file rests on there being one, and the
 * reader is where that is decided. So this runs all three steps of the click on
 * a page nobody wrote a reading for: the reader reads it, the worker asks core,
 * the renderer builds the tree. A case that starts from a hand-written reading
 * has already answered the question this asks.
 *
 * The privacy argument is what makes it worth a describe of its own. The
 * thumbnail is allowed to make a request because it asks for "a URL the page
 * has already requested, from a host it has already contacted" — and for an
 * image below the fold that sentence is simply false. A panel that fetched one
 * would provoke a download the page had declined to make, one per row, on a
 * page whose whole point is that it has not made them yet.
 */
describe('a lazy image nothing has requested, from the click through to the thumbnail', () => {
  /** One `<img loading="lazy">` far below the fold: a src attribute, no file. */
  function lazyIn(host: Page, top: number, file: string): El {
    const body = host.documentElement.children[0];
    if (body === undefined) throw new Error('the page has no body');

    const img = imageIn(host, body, { width: 300, height: 200, top }, '');
    img.srcAttribute = file;
    img.srcset = '/i/640.png 640w, /i/1080.png 1080w';
    img.sizes = '33vw';
    img.loading = 'lazy';
    host.images.push(img);
    return img;
  }

  it('reads no file, says not loaded, and asks the network for nothing at all', () => {
    const host = pageOf([]);
    const first = lazyIn(host, 4000, 'https://example.com/i/800x600.png');
    const second = lazyIn(host, 4600, 'https://example.com/i/1200x900.png');
    const before = [written(first), written(second)];

    const found = clickIn(host);

    // What the browser reported, which is the whole of the reproduction: an
    // attribute naming a file, and no file.
    expect(found.images.map((one) => [one.srcAttribute, one.currentSrc])).toEqual([
      ['https://example.com/i/800x600.png', ''],
      ['https://example.com/i/1200x900.png', ''],
    ]);
    // Not one thumbnail carries a `src` attribute, so not one request leaves
    // the page for a file the page itself declined to ask for. The attribute
    // rather than the property, because an absent one is no request and an
    // empty one is a request for the document.
    expect(of(host, 'img').map((thumb) => thumb.srcAttribute)).toEqual([null, null]);
    expect(of(host, 'img').map((thumb) => thumb.alt)).toEqual([
      'nothing loaded',
      'nothing loaded',
    ]);
    // And no row claims a file: the verdict is the one that was already written
    // for this row and never reached, no `cache` mark sits on a heading, and
    // there is no `loaded` address among the ones a row opens to.
    expect(of(host, 'output').map((word) => word.textContent)).toEqual([
      'not loaded',
      'not loaded',
    ]);
    expect(rows(host).map(flagsIn)).toEqual([[], []]);
    expect(of(host, 'dt').map((label) => label.textContent)).not.toContain('loaded');
    // The page is as the click found it, which is the rest of what a reading
    // may cost: nothing written to either element, and nothing scrolled.
    expect([written(first), written(second)]).toEqual(before);
  });

  it('marks the image the row is about, because a row with no file still has one', () => {
    const host = pageOf([]);
    lazyIn(host, 4000, 'https://example.com/i/800x600.png');
    lazyIn(host, 4600, 'https://example.com/i/1200x900.png');

    clickIn(host);
    dispatch(rows(host)[1], 'mouseenter');

    expect(flagsIn(rows(host)[1])).toEqual([]);
    expect(drawn(host)).toBe(
      'div { display: block; top: 4600px; left: 0px; width: 300px; height: 200px }',
    );
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
        'it 33vw, which is 475 px, so it needs 475 device pixels — but the browser loaded 1080w, ' +
        'which is larger. A held copy reused rather than chosen again is the likeliest cause, ' +
        'and a viewport that shrank after load or script that rewrote sizes or srcset would read ' +
        'the same; an empty cache is the only way to see the real pick.',
    ]);
  });
});
