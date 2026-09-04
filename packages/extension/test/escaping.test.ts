import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { panelOf } from '../src/explain.js';
import { renderPanel } from '../src/panel.js';
import type { Rules } from './surface.js';
import { modulesIn, surfaceOf, why } from './surface.js';
import type { El, Page } from './dom.js';
import { page } from './dom.js';
import { image, reading } from './reading.js';

const src = fileURLToPath(new URL('../src', import.meta.url));

/** The id the panel gives its host. */
const HOST_ID = '__imgwhy_host__';

/**
 * A descriptor written to forge the panel's own cache mark.
 *
 * `parseSrcset` takes a descriptor as the page wrote it — `raw: desc || '1x'`,
 * with no validation of any kind — so a descriptor is page content exactly as
 * much as a URL is, and it reaches the panel twice: on the `candidates` line,
 * and on the `picked` line where it wins. Forging the mark is the attack worth
 * writing rather than an `alert`, because the mark is what criterion 2 rests
 * on: a page that could draw its own would be a page that could say a figure
 * came from a held copy when it did not, or hide that one did.
 *
 * It carries no `w` and no `x`, so `parseSrcset` reads it as a 1x candidate and
 * a ratio of 1 picks it over a 400w candidate at 800px. Which is the point —
 * the row this lands on is a row where the panel names it as the winner.
 */
const DESCRIPTOR = "</dd><mark>cache</mark><script>alert('descriptor')</script>";

/**
 * A reading whose every string came from a page written to break out of the
 * panel.
 *
 * Every one of these fields is page content. The selector is derived from a
 * DOM path, which carries whatever the page put in a tag name; `sizes`, the
 * descriptors and every candidate URL are attributes off the page's own
 * markup; `currentSrc` is a URL the page chose; and `baseURI` is what a
 * `<base>` tag says. None of it is imgwhy's to trust.
 *
 * Four images, because a page that breaks out once breaks out four times. The
 * second is the one whose prediction and loaded file disagree, which is the row
 * that writes a note as well as a grid. The third is the one whose descriptor
 * is the payload, which is the field that reaches the panel without ever having
 * been a URL.
 *
 * The fourth is the row two paths in this panel had never been walked with page
 * content in them, which on a fixture whose premise is a *closed* list of
 * attribute values means two paths the list did not actually cover:
 *
 * - **The row headline.** It is a `code` token holding the descriptor of the
 *   file that loaded, and on the three rows above it reads `src`, `src` and
 *   `—` — imgwhy's own literals every one. Here the pick is the forged
 *   descriptor and the file loaded, so the page's own text is the headline.
 * - **The collapsed one-file statement.** A `srcset` whose every candidate
 *   resolves to one URL renders one line in place of the list, and no row above
 *   reached it. Both candidates here name one `javascript:` URL, which is also
 *   what the file name beside the headline then reads as.
 */
const hostile = () =>
  reading({
    images: [
      image({
        selector: 'html > body > img[alt="<script>alert(\'alt text\')</script>"]',
        // No whitespace inside either URL, because a `srcset` URL runs to the
        // first space and a payload with one in it is a payload the page never
        // handed the browser either.
        srcset: 'javascript:alert(1) 2000w, /i/300.png"onmouseover="alert(2) 300w',
        sizes: '100vw" onload="alert(\'sizes\')</script><!--<script>alert(\'break out\')</script>',
        // `alt` is page content like every other field here, and it reaches
        // the panel twice: as a line of the grid, and as the thumbnail's own
        // `alt` wherever the page wrote one.
        alt: '</dd><img src=x onerror=alert(\'alt\')>',
        renderedWidth: 640,
        renderedHeight: 360,
        currentSrc: 'data:text/html,<script>alert(\'current src\')</script>',
        loading: 'lazy',
        baseURI: 'https://evil.example/"><script>alert(\'base\')</script>/',
      }),
      image({
        selector: '<img src=x onerror=alert(\'selector\')>',
        srcset: '/i/200.png 200w, /i/300.png 300w',
        sizes: '<script>alert(\'source sizes\')</script>',
        sizesSource: 'source',
        renderedWidth: 100,
        currentSrc: 'https://evil.example/i/300.png',
      }),
      image({
        selector: 'html > body > img:nth-of-type(3)',
        srcset: `/i/400.png 400w, /i/800.png ${DESCRIPTOR}`,
        sizes: '800px',
        renderedWidth: 800,
      }),
      image({
        selector: 'html > body > figure > img',
        // One URL under two descriptors, so every candidate names one file and
        // the row collapses them into a sentence. The forged descriptor wins
        // the pick — no `w` and no `x`, so `parseSrcset` reads it as 1x and a
        // ratio of 1 takes it over 400w at 800px — and the file it names is the
        // file that loaded, which is what puts page text in the headline.
        srcset: `javascript:alert(4) 400w, javascript:alert(4) ${DESCRIPTOR}`,
        sizes: '800px',
        renderedWidth: 800,
        renderedHeight: 450,
        currentSrc: 'javascript:alert(4)',
      }),
    ],
    backgroundImageCount: 2,
  });

/**
 * Properties refused by name, whatever an allowlist elsewhere says.
 *
 * `privacy.test.ts` allows this package six written properties, none of which
 * parses anything — so `innerHTML` is refused there by absence. This
 * is the second reading of the same claim, and it exists for the edit that
 * widens that list: a contributor who allowed one name because the markup in
 * front of them was their own. Every route below turns a string into markup,
 * and the panel's whole defence is that there is no parser in the path.
 */
const MARKUP: Rules = [
  [/^(?:innerHTML|outerHTML|srcdoc)$/, 'a property that parses its value as markup'],
  [
    /^(?:insertAdjacentHTML|createContextualFragment|parseFromString|write|writeln)$/,
    'a call that parses a string as markup',
  ],
  [/^(?:DOMParser|Range|createRange)$/, 'a parser, which is how a string becomes a tree'],
];

/**
 * The panel, rendered against that page, as `tag: the words it holds`.
 *
 * Rendered through `node:vm` and out of `String(renderPanel)`, because that is
 * the copy a page gets. There is no HTML anywhere in this file for the same
 * reason there is none in the panel: the panel is a tree of nodes it built,
 * and a string never becomes one.
 */
function rendered(): { nodes: El[]; host: Page } {
  const host = page();
  const context = vm.createContext({ document: host });
  vm.runInContext(
    `(${String(renderPanel)})(${JSON.stringify(panelOf(hostile()))})`,
    context,
  );
  const element = host.getElementById(HOST_ID);
  if (element === null) throw new Error('the panel added no host element');
  return { nodes: host.shadow(element), host };
}

/**
 * Every element the panel is allowed to make.
 *
 * The mirror of `report/test/escaping.test.ts`'s list of allowed attribute
 * values, and it works for the same reason: the list is closed. The report
 * puts no page string in an attribute, so anything else found in one came from
 * somewhere it should not have; the panel names no tag from page content, so
 * anything else found as an element is a tag the page talked it into making.
 *
 * Twenty-two names is the whole panel. `mark` is the cache flag, `div` is the
 * box drawn over an image, the two `style` elements are the stylesheet and the
 * one rule that positions that box, and the rest are the shape of the thing: a
 * card, a disclosure and its summary, a title, a count, a list, an item, a row
 * header, a thumbnail, a name button, a grid of terms and values, a sentence,
 * and a footer. Three arrived with the redesigned row: `output` is the
 * verdict, the platform's element for the result of a calculation; `code` is
 * the descriptor that loaded, a token out of the `srcset` attribute; `small`
 * is the file name beside it, and the size that stands in for a thumbnail too
 * small to show one.
 */
const TAGS = [
  '#shadow-root',
  'button',
  'code',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'footer',
  'h1',
  'h2',
  'header',
  'img',
  'li',
  'mark',
  'ol',
  'output',
  'p',
  'section',
  'small',
  'style',
  'summary',
];

/**
 * The panel, given a page written to break out of it.
 *
 * The report's half of this claim is intricate because the report emits a
 * string: it has to escape, and `escaping.test.ts` there reads the document
 * back with a scanner to prove it did. The panel emits nodes, so the claim is
 * a different one and simpler to state — no page string is ever parsed, so
 * there is nothing to escape and nothing that could be escaped wrongly. What
 * has to be checked is that the property is real: that every word goes in
 * through `textContent`, that no tag name comes off the page, and that nothing
 * in this package can reach a route back into a parser.
 *
 * ## What still gets past
 *
 * - **A property named at run time.** `element[field] = value` names nothing
 *   this reading can see, and `surfaceOf` refuses it rather than reading it,
 *   which is what `privacy.test.ts` reports as a refusal.
 * - **A module reached at run time.** `boundary.test.ts` refuses a computed
 *   `import()` for the whole package, which is the backstop.
 */
describe('the panel, given a page written to break out of it', () => {
  it('makes only its own elements, because a page string is never a tag name', () => {
    const { nodes } = rendered();

    expect([...new Set(nodes.map((node) => node.name))].sort()).toEqual(TAGS);
  });

  it('hands every page string straight through, byte for byte', () => {
    // Escaping that changed a string would be a different bug. A reader is
    // looking at what the page shipped, and `<script>` in a `sizes` attribute
    // is a page with a `<script>` in its `sizes` attribute — that is the
    // finding, not something to sand off.
    const { nodes } = rendered();
    const words = nodes.map((node) => node.textContent);
    const live = hostile().images;

    expect(words).toContain(live[0].selector);
    expect(words).toContain(live[0].sizes);
    expect(words).toContain(live[0].alt);
    expect(words).toContain(live[1].selector);
    expect(words).toContain(`${live[1].sizes} from a matching <source>`);
  });

  it('writes a javascript: candidate URL as a word and never as a target', () => {
    // Every candidate URL in this panel lands as the text of a `dd` in the
    // row's files, labelled by its descriptor. A candidate is never assigned
    // to anything: the one property this package gives a URL to is the
    // thumbnail's `src`, and the only URL it may have is the file the browser
    // already loaded.
    const { nodes } = rendered();
    const words = nodes.map((node) => node.textContent);
    const targets = nodes.filter((node) => node.src !== '' || node.srcset !== '');

    expect(words).toContain('2000w');
    expect(words).toContain('javascript:alert(1)');
    expect(targets.map((node) => node.src)).toEqual(
      hostile()
        .images.filter((one) => one.currentSrc !== '')
        .map((one) => one.currentSrc),
    );
    expect(nodes.filter((node) => node.srcset !== '')).toEqual([]);
  });

  it('heads a row with a descriptor the page invented, as the text of a code token', () => {
    // The headline is the one place a `code` element holds page content, and on
    // a page that writes its own descriptors that content is whatever stood
    // where a `640w` should have. A token, not markup: the `<mark>` and the
    // `<script>` in it are words in a `code`, and the count of elements the
    // panel made is what says so.
    const { nodes } = rendered();
    const headlines = nodes.filter((node) => node.name === 'code');

    expect(headlines.map((node) => node.textContent)).toEqual(['src', 'src', '—', DESCRIPTOR]);
  });

  it('collapses a page’s many descriptors onto its one file, as one sentence of text', () => {
    // The `srcset` whose every candidate resolves to one URL, which is a
    // statement rather than a list — and the URL in it is the page's. The
    // label is the count, which is imgwhy's; the value is the page's, whole.
    const { nodes } = rendered();
    const words = nodes.map((node) => node.textContent);

    expect(words).toContain('2 candidates');
    expect(words).toContain('one file: javascript:alert(4)');
    expect(words).toContain(
      'All 2 candidates name one file, so your device made no difference here — the descriptors ' +
        'differ and the bytes do not.',
    );
  });

  it('names each row after the page’s own file name, however little of one there is', () => {
    // The `small` beside each headline, which is page content on every row and
    // was asserted on none. A `data:text/html,<script>` URL has no path to take
    // a name from, so the scheme is what a reader gets; a `javascript:` URL is
    // the same shape; the ordinary one is a file name; and a row that loaded
    // nothing is named by the verdict beside it rather than by a file.
    const { nodes } = rendered();
    const names = nodes.filter((node) => node.name === 'small');

    expect(names.map((node) => node.textContent)).toEqual([
      "data:text/html,<script>alert('current src')</script>",
      '300.png',
      '',
      'javascript:alert(4)',
    ]);
  });

  it('says what the page called the image in the thumbnail’s own alt, and nowhere else', () => {
    // `alt` is page content that reaches the panel twice, and the second of the
    // two is the one nothing asserted: the thumbnail's own `alt`, which is what
    // a reader is read out where the picture will not draw. The first image's
    // is markup, and it lands as an attribute value that no browser parses.
    const { nodes } = rendered();
    const thumbs = nodes.filter((node) => node.name === 'img');
    const live = hostile().images;

    expect(thumbs.map((node) => node.alt)).toEqual([
      live[0].alt,
      '300.png',
      'nothing loaded',
      'javascript:alert(4)',
    ]);
  });

  it('hands a hostile currentSrc to a thumbnail whole, and it stays a broken image', () => {
    // The narrowed rule, read against a page written to abuse it. The first
    // image's `currentSrc` is `data:text/html,<script>…`, which is not a URL a
    // browser would ever report for an `<img>` and is exactly the string a
    // page would try. It arrives byte for byte, because the value the panel
    // may assign is the whole value the reading handed over and nothing else —
    // and byte for byte is the safe answer here: an `<img>` fetches its `src`,
    // it never navigates to it and never parses the response as markup, so a
    // `data:text/html` payload and a `javascript:` URL are both a picture that
    // will not draw. The `alt` beside it is what says which image failed.
    const { nodes } = rendered();
    const thumbs = nodes.filter((node) => node.name === 'img');
    const live = hostile().images;

    expect(thumbs.map((node) => node.src)).toEqual([
      live[0].currentSrc,
      live[1].currentSrc,
      '',
      live[3].currentSrc,
    ]);
    // And the row that loaded nothing is pointed at nothing at all rather than
    // at the empty string, which a browser resolves against the document.
    expect(thumbs[2]?.srcAttribute).toBeNull();
    expect(thumbs[2]?.alt).toBe('nothing loaded');
  });

  it('writes a descriptor the page invented as a word, forged mark and all', () => {
    // The descriptor is the field with no validation behind it at all —
    // `parseSrcset` keeps whatever text stood where a `640w` should have — and
    // it lands on the candidates line, in the sentence, and as the label of a
    // file. The count of marks is what says the forgery made no element: two
    // rows loaded a file and carry a chip in the heading and a chip on the
    // `loaded` URL, one loaded nothing and carries none, and the
    // `<mark>` the page asked for is a word in a `dd`. Three rows loaded a
    // file, so six is two chips each and none of them the page's.
    const { nodes } = rendered();
    const words = nodes.map((node) => node.textContent);

    expect(words).toContain(`400w, ${DESCRIPTOR} (picked)`);
    expect(words).toContain(DESCRIPTOR);
    expect(words.some((word) => word.startsWith(`Nothing has loaded yet; when it does, the arithmetic picks ${DESCRIPTOR} —`))).toBe(true);
    expect(nodes.filter((node) => node.name === 'mark')).toHaveLength(6);
  });

  it('says the sentence with the page’s hostile sizes string in it, as text', () => {
    // The one sentence a collapsed row shows is a `p` in the row's `header`,
    // and the second image's names the clause at fault — which is the page's
    // own `<script>` — byte for byte, as the text of that `p`.
    const { nodes } = rendered();
    const sentences = nodes.filter((node) => node.name === 'p' && node.parent?.name === 'header');

    expect(sentences).toHaveLength(4);
    expect(sentences[1]?.textContent).toBe(
      "The sizes clause <script>alert('source sizes')</script> could not be read as a length, so " +
        'there is no width to select against and nothing was picked; fix the sizes attribute.',
    );
  });

  it('leaves nothing in the light tree, so nothing the page wrote is in the page', () => {
    const { host } = rendered();
    const element = host.getElementById(HOST_ID);

    expect(element?.children).toEqual([]);
    expect(element?.textContent).toBe('');
  });

  it('reaches no route back into a parser, by any name', () => {
    const modules = modulesIn(src);
    const found = Object.entries(modules).flatMap(([name, text]) => {
      const surface = surfaceOf(text);
      return [...surface.called, ...surface.written, ...surface.globals]
        .map((named) => {
          const reason = why(MARKUP, named);
          return reason === undefined ? null : `${name} names ${named}, which is ${reason}`;
        })
        .filter((line): line is string => line !== null);
    });

    expect(found).toEqual([]);
  });
});

describe('the markup check, given a panel that builds its own', () => {
  it('catches an assignment that parses its value, which no escaping undoes', () => {
    // What the check earns its keep on. `textContent` and `innerHTML` differ
    // by one property name and by everything else, and the second is the
    // shortest route from a page's `sizes` attribute to a page's own script
    // running inside a panel it was never given.
    const surface = surfaceOf('export const say = (el, text) => { el.innerHTML = text; };');

    expect(surface.written.map((named) => why(MARKUP, named))).toEqual([
      'a property that parses its value as markup',
    ]);
  });

  it('catches a call that parses one, which names no property at all', () => {
    const surface = surfaceOf(
      "export const say = (el, text) => el.insertAdjacentHTML('beforeend', text);",
    );

    expect(surface.called.map((named) => why(MARKUP, named))).toContain(
      'a call that parses a string as markup',
    );
  });

  it('is quiet about the one route the panel uses', () => {
    const surface = surfaceOf('export const say = (el, text) => { el.textContent = text; };');

    expect(surface.written.map((named) => why(MARKUP, named))).toEqual([undefined]);
  });
});
