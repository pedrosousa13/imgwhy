import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { refuseStaleBuild } from '../../../test/built.js';
import type { Reading } from '../src/read.js';
import { readPage } from '../src/read.js';
import type { El, Page, World } from './dom.js';
import { box, globals, page } from './dom.js';

/** The id the panel gives its host, which is how a second click finds it. */
const HOST_ID = '__imgwhy_host__';

/** The desktop of the design's default device set. */
const DESKTOP: World = { width: 1440, height: 900, dpr: 1 };

/**
 * The reader, run the way Chrome runs it: the text of the function, evaluated
 * in a context holding a document, a viewport and a ratio, and nothing else.
 *
 * The header of `src/read.ts` says why that is the only honest way to run it —
 * `executeScript` sends the source rather than the function. Calling `readPage`
 * directly would prove nothing about the copy a page gets, and this is the one
 * arrangement that catches a helper it closed over.
 */
const runIn = (source: string, host: Page, world: World = DESKTOP): Reading | null =>
  vm.runInContext(`(${source})()`, vm.createContext(globals(host, world))) as Reading | null;

const inPage = (host: Page, world: World = DESKTOP): Reading | null =>
  runIn(String(readPage), host, world);

/**
 * What Chrome would actually send, out of the built module rather than the one
 * Vitest transformed.
 *
 * The two are not the same text: this package builds to ES2022 and Vite's
 * transform targets the running Node, so a syntax `tsc` downlevels arrives in
 * `dist` as a call to a helper `tsc` wrote at the top of the module — exactly
 * the kind of name that does not come over with a stringified function. Which
 * is the risk this whole module is arranged around, so the built copy is the
 * one that has to be run. `panel.test.ts` reads its half the same way.
 *
 * The module is evaluated and the function stringified inside it, rather than
 * the module text being run against the page, because running the module would
 * put such a helper in scope and hide the thing this is for.
 */
function shipped(): string {
  const text = readFileSync(fileURLToPath(new URL('../dist/read.js', import.meta.url)), 'utf8');
  const context = vm.createContext({});
  return vm.runInContext(`${text.replace(/^export /gm, '')}\n;String(readPage)`, context) as string;
}

/** The reading a page must have produced, or a failure that says it did not. */
function read(host: Page, world: World = DESKTOP): Reading {
  const reading = inPage(host, world);
  if (reading === null) throw new Error('the reader removed a panel instead of reading the page');
  return reading;
}

/** The fields of an element a test may set, which are the ones a page sets. */
type Fields = Partial<
  Pick<
    El,
    | 'id'
    | 'srcset'
    | 'sizes'
    | 'media'
    | 'currentSrc'
    | 'src'
    | 'width'
    | 'height'
    | 'rect'
    | 'baseURI'
    | 'loading'
    | 'alt'
    | 'background'
  >
>;

const body = (host: Page): El => {
  const found = host.documentElement.children[0];
  if (found === undefined) throw new Error('the page has no body');
  return found;
};

/** One element under `parent`, with the fields a case cares about set. */
function el(host: Page, parent: El, name: string, fields: Fields = {}): El {
  const node = host.createElement(name);
  Object.assign(node, fields);
  parent.appendChild(node);
  return node;
}

/**
 * An `<img>`, registered in `document.images` the way a page registers one.
 *
 * Two steps rather than one because `document.images` is live in a browser and
 * a list here, and the reader walks the list rather than the tree — so an
 * element in the tree that is not in the list is an element the reader never
 * sees, which is exactly the arrangement a `<source>` case needs.
 */
function img(host: Page, parent: El, fields: Fields = {}): El {
  const node = el(host, parent, 'img', { baseURI: 'https://example.com/', ...fields });
  host.images.push(node);
  return node;
}

/**
 * The reader, which is the only half of the extension that runs in the page.
 *
 * It carries no arithmetic, and that is the architecture rather than an
 * accident. `chrome.scripting.executeScript` does not send a function: it
 * sends `String(func)` and the page evaluates the text, so an injected
 * function arrives with no imports, no module constants and no helpers — and
 * core is a module. So core stays in the service worker, only data crosses
 * into the page, and this function's whole job is to produce that data.
 *
 * `runner/src/collect.ts` does the same work under exactly the same
 * constraint, and this follows it closely on purpose. The `<picture>` walk in
 * particular is a decision with a measured answer behind it, and two readers
 * that disagreed about which `<source>` a browser reads would be two tools
 * that disagree about the same page.
 */
describe('the reader a click sends into the page', () => {
  it('reads the viewport and the ratio off the browser it is running in', () => {
    const reading = read(page(), { width: 393, height: 852, dpr: 3 });

    expect(reading.viewport).toEqual({ width: 393, height: 852 });
    expect(reading.dpr).toBe(3);
  });

  it('reads every image on the page, with nothing filtered out', () => {
    // A 1×1 tracking pixel and an image the page never shows are both bytes
    // the browser went and got. The reference filtered them by size and the
    // runner does not; dropping a row here would put it beyond anything
    // downstream can reach, and deciding what is worth a reader's attention
    // belongs to whatever displays the reading.
    const host = page();
    img(host, body(host), { rect: box({ width: 640 }) });
    img(host, body(host), { rect: box({ width: 1, height: 1 }), width: 1 });

    expect(read(host).images).toHaveLength(2);
  });

  it('names where each image sat, and counts twins so two rows cannot collide', () => {
    const host = page();
    img(host, body(host));
    img(host, body(host));
    img(host, el(host, body(host), 'figure'));

    expect(read(host).images.map((one) => one.selector)).toEqual([
      'html > body > img:nth-of-type(1)',
      'html > body > img:nth-of-type(2)',
      'html > body > figure > img',
    ]);
  });

  it('reads the srcset and the sizes off the img where there is no picture', () => {
    const host = page();
    img(host, body(host), {
      srcset: '/i/640.png 640w, /i/1080.png 1080w',
      sizes: '33vw',
      currentSrc: 'https://example.com/i/640.png',
      rect: box({ width: 475, height: 317 }),
    });

    expect(read(host).images[0]).toMatchObject({
      srcset: '/i/640.png 640w, /i/1080.png 1080w',
      sizes: '33vw',
      sizesSource: 'img',
      renderedWidth: 475,
      renderedHeight: 317,
      currentSrc: 'https://example.com/i/640.png',
      baseURI: 'https://example.com/',
    });
  });

  it('reads the whole box, because a shape is what a reader recognises', () => {
    // The arithmetic reads a width and never a height. The height is read for
    // the reader instead: a row saying `1200×80` is a banner and one saying
    // `24×24` is an icon, and a DOM path says neither.
    const host = page();
    img(host, body(host), { rect: box({ width: 1200, height: 80 }) });

    expect(read(host).images[0]).toMatchObject({ renderedWidth: 1200, renderedHeight: 80 });
  });

  it('falls back to the width and height attributes where the element has no box', () => {
    const host = page();
    img(host, body(host), { rect: box(), width: 300, height: 200 });

    expect(read(host).images[0]).toMatchObject({ renderedWidth: 300, renderedHeight: 200 });
  });

  it('hands each image its index into the collection, which is the panel’s handle', () => {
    // The panel has to point at an element to mark it, and this is what it
    // points with. `read.ts` argues why an index beats running the DOM path
    // back through a selector, and what it costs on a page that mutates.
    const host = page();
    img(host, body(host));
    img(host, el(host, body(host), 'figure'));
    img(host, body(host));

    expect(read(host).images.map((one) => one.at)).toEqual([0, 1, 2]);
  });

  it('reads alt as three states, because an empty one is a statement', () => {
    // No attribute is a page that said nothing about the image. `alt=""` is a
    // page that said the image carries no meaning of its own, which is right
    // for a spacer and a bug on a hero. `img.alt` reads `''` for both, so the
    // attribute is what gets read.
    const host = page();
    img(host, body(host), { alt: 'A person at a desk' });
    img(host, body(host), { alt: '' });
    img(host, body(host));

    expect(read(host).images.map((one) => one.alt)).toEqual(['A person at a desk', '', null]);
  });

  it('reports no file at all where the browser has chosen none, src attribute or not', () => {
    // The reproduction, and the one character it was: `currentSrc || src`. A
    // lazy image below the fold has a `src` attribute and has requested
    // nothing — the browser reports `currentSrc: ''`, `complete: false`,
    // `naturalWidth: 0`, and the page makes no image request at all. Falling
    // back to the property put that file on the `loaded` line of a row whose
    // browser held nothing, marked it as a copy the browser has, read the
    // verdict as `fit`, and pointed the thumbnail at a URL the page had never
    // asked for. Three claims about a file, none of them true, and the last of
    // them provokes the download the page declined to make.
    //
    // Both images report the same thing, because they are the same finding:
    // nothing has loaded here yet. Which of them wrote a `src` is
    // `srcAttribute`'s answer, below, and nothing about it says a request was
    // made.
    const host = page();
    img(host, body(host), {
      src: 'https://example.com/i/800x600.png',
      loading: 'lazy',
      rect: box({ width: 300, height: 200, top: 4000 }),
    });
    img(host, body(host));

    expect(read(host).images.map((one) => one.currentSrc)).toEqual(['', '']);
    expect(read(host).images[0]).toMatchObject({
      currentSrc: '',
      srcAttribute: 'https://example.com/i/800x600.png',
      loading: 'lazy',
    });
  });

  it('reads the src attribute as written, and tells an absent one from an empty one', () => {
    // Two states the `src` *property* cannot report, because it reflects a
    // resolved URL: an absent attribute reads as the empty string there, and an
    // empty one resolves against the document and reads as the page's own
    // address — which is the request the panel's thumbnail guard exists to
    // prevent. The attribute has the three states HTML's candidate rule is
    // written against, so the attribute is what is read.
    const host = page();
    img(host, body(host), { src: 'https://example.com/one.png' });
    img(host, body(host), { src: '/i/640.png' });
    img(host, body(host), { src: '' });
    img(host, body(host));

    expect(read(host).images.map((one) => one.srcAttribute)).toEqual([
      'https://example.com/one.png',
      '/i/640.png',
      '',
      '',
    ]);
    // The property beside it, which differs from the attribute on three of the
    // four: a path arrives resolved, an empty attribute arrives as the page,
    // and no attribute at all arrives as the empty string. Asserted here
    // because the stand-in has to be the browser on exactly this point — a
    // model where the two read alike is a model where reading the wrong one of
    // them looks correct.
    expect(host.images.map((one) => one.src)).toEqual([
      'https://example.com/one.png',
      'https://example.com/i/640.png',
      'https://example.com/',
      '',
    ]);
  });

  it('prefers the file the browser chose to the src the page wrote', () => {
    // The two differ on exactly the images this panel exists to explain: an
    // `<img srcset>` carries a `src` as the fallback for a browser that reads
    // no `srcset`, and a browser that reads one loads something else. Reading
    // the attribute in its place would put a file nothing loaded on the
    // `loaded` line of every such row, and fire the disagreement note on all
    // of them.
    const host = page();
    img(host, body(host), {
      src: 'https://example.com/fallback.png',
      currentSrc: 'https://example.com/i/1080.png',
    });

    expect(read(host).images[0].currentSrc).toBe('https://example.com/i/1080.png');
  });

  it('reads loading, and reads it as lazy, eager or nothing at all', () => {
    const host = page();
    img(host, body(host), { loading: 'lazy' });
    img(host, body(host), { loading: 'eager' });
    img(host, body(host), { loading: 'auto' });
    img(host, body(host));

    expect(read(host).images.map((one) => one.loading)).toEqual(['lazy', 'eager', null, null]);
  });

  it('takes the first source whose media matches, in document order', () => {
    const host = page();
    const picture = el(host, body(host), 'picture');
    el(host, picture, 'source', { media: '(min-width: 2000px)', srcset: '/i/wide.png 2000w' });
    el(host, picture, 'source', { media: '(min-width: 1000px)', srcset: '/i/mid.png 1200w' });
    el(host, picture, 'source', { srcset: '/i/narrow.png 600w' });
    img(host, picture, { srcset: '/i/fallback.png 400w' });

    expect(read(host).images[0]).toMatchObject({
      srcset: '/i/mid.png 1200w',
      sizesSource: 'source',
    });
  });

  it('takes a source with no media at all, which always applies', () => {
    const host = page();
    const picture = el(host, body(host), 'picture');
    el(host, picture, 'source', { srcset: '/i/any.png 600w' });
    img(host, picture, { srcset: '/i/fallback.png 400w' });

    expect(read(host).images[0].srcset).toBe('/i/any.png 600w');
  });

  it('stops at the img, so a source written after the tag is one no browser reads', () => {
    // The source is in the DOM and a query for every source in the element
    // finds it, and no browser ever reads it. Stopping at the tag is what
    // keeps this from resolving against markup nothing rendered.
    const host = page();
    const picture = el(host, body(host), 'picture');
    img(host, picture, { srcset: '/i/fallback.png 400w' });
    el(host, picture, 'source', { srcset: '/i/late.png 900w' });

    expect(read(host).images[0]).toMatchObject({
      srcset: '/i/fallback.png 400w',
      sizesSource: 'img',
    });
  });

  it('skips a source with no srcset, which offers the browser nothing', () => {
    const host = page();
    const picture = el(host, body(host), 'picture');
    el(host, picture, 'source', { media: '(min-width: 1000px)' });
    el(host, picture, 'source', { media: '(min-width: 1000px)', srcset: '/i/mid.png 1200w' });
    img(host, picture, { srcset: '/i/fallback.png 400w' });

    expect(read(host).images[0].srcset).toBe('/i/mid.png 1200w');
  });

  it('reads sizes off the matching source alone, and never off the img', () => {
    // The divergence from the reference, and the one with a measured answer
    // behind it: a browser builds the source set from the matching source's
    // own `sizes` and leaves the 100vw default where it has none. On the
    // runner's `/picture-sources.html` at 1440 a source offering 200w and 300w
    // under an `<img sizes="120px">` loads the 300w file, and 120px predicts
    // the 200w one.
    const host = page();
    const picture = el(host, body(host), 'picture');
    el(host, picture, 'source', { srcset: '/i/200.png 200w, /i/300.png 300w' });
    img(host, picture, { srcset: '/i/fallback.png 400w', sizes: '120px' });

    expect(read(host).images[0]).toMatchObject({ sizes: null, sizesSource: 'source' });
  });

  it('reads a matching source’s own sizes where it wrote one', () => {
    const host = page();
    const picture = el(host, body(host), 'picture');
    el(host, picture, 'source', { srcset: '/i/300.png 300w', sizes: '50vw' });
    img(host, picture, { srcset: '/i/fallback.png 400w', sizes: '120px' });

    expect(read(host).images[0]).toMatchObject({ sizes: '50vw', sizesSource: 'source' });
  });

  it('falls through to the img where no source matched at this viewport', () => {
    const host = page();
    const picture = el(host, body(host), 'picture');
    el(host, picture, 'source', { media: '(min-width: 2000px)', srcset: '/i/wide.png 2000w' });
    img(host, picture, { srcset: '/i/fallback.png 400w', sizes: '120px' });

    expect(read(host).images[0]).toMatchObject({
      srcset: '/i/fallback.png 400w',
      sizes: '120px',
      sizesSource: 'img',
    });
  });

  it('counts the elements painting a CSS background image, and counts no gradient', () => {
    // A gradient is painted the same way and is not a file. The computed value
    // is what says what this viewport actually painted, rather than the rule
    // as written.
    const host = page();
    el(host, body(host), 'div', { background: 'url("https://example.com/hero.jpg")' });
    el(host, body(host), 'div', { background: 'linear-gradient(#fff, #000)' });
    el(host, body(host), 'div', {
      background: 'linear-gradient(#fff, #000), url("https://example.com/tile.png")',
    });

    expect(read(host).backgroundImageCount).toBe(2);
  });

  it('takes the panel away and reads nothing at all when one is already open', () => {
    // The state is the page. There is no flag anywhere in the extension saying
    // which tabs have a panel open, and there is nowhere to put one that is
    // not `chrome.storage`, which the design rules out. Reading the page
    // cannot go stale: the page navigated, the panel went with it, and the
    // next click opens rather than closing something that is gone.
    const host = page();
    img(host, body(host), { srcset: '/i/640.png 640w' });
    const open = el(host, host.documentElement, 'div', { id: HOST_ID });

    expect(inPage(host)).toBeNull();
    expect(host.getElementById(HOST_ID)).toBeNull();
    expect(open.parent).toBeNull();
  });

  it('reads the page again on the click after that', () => {
    const host = page();
    img(host, body(host));
    el(host, host.documentElement, 'div', { id: HOST_ID });

    expect(inPage(host)).toBeNull();
    expect(read(host).images).toHaveLength(1);
  });
});

/**
 * The same reader, out of the built module rather than out of the one Vitest
 * transformed, because the built one is what Chrome stringifies and sends.
 */
describe('the reader as the built module ships it, which is the copy a page gets', () => {
  beforeAll(refuseStaleBuild);

  it('is self-contained, so nothing it needs was left behind in its module', () => {
    const host = page();
    const picture = el(host, body(host), 'picture');
    el(host, picture, 'source', { media: '(min-width: 1000px)', srcset: '/i/mid.png 1200w' });
    img(host, picture, {
      srcset: '/i/fallback.png 400w',
      // The `src` a `<picture>`'s `<img>` carries for a browser that reads no
      // `srcset` at all, which is also the candidate a densities-only `srcset`
      // offers alongside itself — so the built copy is run over an attribute
      // that is there rather than only over one that is not.
      src: 'https://example.com/i/fallback.png',
      // And the file the browser went and got, which is the matching source's
      // and not the attribute's. Both are set because they are two facts and
      // the built copy has to carry each of them to its own field.
      currentSrc: 'https://example.com/i/mid.png',
      sizes: '120px',
      rect: box({ width: 475, height: 317 }),
    });
    el(host, body(host), 'div', { background: 'url("https://example.com/hero.jpg")' });

    // The whole reading rather than one field of it, because a name the module
    // left behind is a `ReferenceError` at whichever line reaches for it — so
    // the arrangement that catches one is the one that runs every branch the
    // reader has.
    expect(runIn(shipped(), host)).toEqual({
      viewport: { width: 1440, height: 900 },
      dpr: 1,
      images: [
        {
          at: 0,
          selector: 'html > body > picture > img',
          srcset: '/i/mid.png 1200w',
          sizes: null,
          sizesSource: 'source',
          renderedWidth: 475,
          renderedHeight: 317,
          naturalWidth: 0,
          declaresWidth: false,
          alt: null,
          srcAttribute: 'https://example.com/i/fallback.png',
          currentSrc: 'https://example.com/i/mid.png',
          loading: null,
          baseURI: 'https://example.com/',
        },
      ],
      backgroundImageCount: 1,
    });
  });

  it('takes the panel away on the click after that, the same as the source does', () => {
    const host = page();
    img(host, body(host));
    const open = el(host, host.documentElement, 'div', { id: HOST_ID });

    expect(runIn(shipped(), host)).toBeNull();
    expect(open.parent).toBeNull();
  });
});
