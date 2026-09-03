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
 * Three images, because a page that breaks out once breaks out three times.
 * The second is the one whose prediction and loaded file disagree, which is the
 * row that writes a note as well as a grid. The third is the one whose
 * descriptor is the payload, which is the field that reaches the panel without
 * ever having been a URL.
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
        renderedWidth: 640,
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
    ],
    backgroundImageCount: 2,
  });

/**
 * Properties refused by name, whatever an allowlist elsewhere says.
 *
 * `privacy.test.ts` already allows this package two written properties — an
 * id and the words it says — so `innerHTML` is refused there by absence. This
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
 * Eleven names is the whole panel. `mark` is the cache flag and the rest are
 * the shape of the thing: a card, a title, a head line, a list, an item, a
 * heading, a grid of terms and values, a note, and a footer.
 */
const TAGS = [
  '#shadow-root',
  'dd',
  'dl',
  'dt',
  'footer',
  'h1',
  'h2',
  'li',
  'mark',
  'ol',
  'p',
  'section',
  'style',
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

    expect(words).toContain(`${live[0].selector}   loading=lazy`);
    expect(words).toContain(live[0].sizes);
    expect(words).toContain(live[1].selector);
    expect(words).toContain(`${live[1].sizes} from a matching <source>`);
  });

  it('writes a javascript: candidate URL as a word and never as a target', () => {
    // The 2000w candidate is the one the arithmetic picks at this viewport, so
    // it is the one the panel names — as the text of a `dd`, which is the only
    // place any URL in this panel ever lands. A URL written to a property is
    // a request made by assignment, and this package writes two properties: an
    // id, and the words it says.
    const { nodes } = rendered();
    const words = nodes.map((node) => node.textContent);

    expect(words.some((word) => word.includes('2000w  javascript:alert(1)'))).toBe(true);
    expect(nodes.filter((node) => node.src !== '' || node.srcset !== '')).toEqual([]);
  });

  it('writes a descriptor the page invented as a word, forged mark and all', () => {
    // The descriptor is the field with no validation behind it at all —
    // `parseSrcset` keeps whatever text stood where a `640w` should have — and
    // it lands on two lines of the grid. The count of marks is what says the
    // forgery made no element: three rows, three `loaded` lines, three marks,
    // and the fourth `<mark>` the page asked for is a word in a `dd`.
    const { nodes } = rendered();
    const words = nodes.map((node) => node.textContent);

    expect(words).toContain(`400w, ${DESCRIPTOR}`);
    expect(words).toContain(`${DESCRIPTOR}  /i/800.png`);
    expect(nodes.filter((node) => node.name === 'mark')).toHaveLength(3);
  });

  it('says why the prediction and a hostile loaded URL disagree, and says only that', () => {
    const { nodes } = rendered();
    const notes = nodes.filter((node) => node.parent?.name === 'li' && node.name === 'p');

    expect(notes.map((node) => node.textContent.slice(0, 25))).toEqual([
      'picked and loaded disagre',
    ]);
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
