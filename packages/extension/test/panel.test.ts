import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { refuseStaleBuild } from '../../../test/built.js';
import type { Panel } from '../src/explain.js';
import { panelOf } from '../src/explain.js';
import { renderPanel } from '../src/panel.js';
import type { El, Page } from './dom.js';
import { page } from './dom.js';
import { image, reading } from './reading.js';

/** The id the panel gives its host, which is how the next click finds it. */
const HOST_ID = '__imgwhy_host__';

/**
 * A panel of two images: one whose prediction and loaded file agree, and one
 * where they do not.
 *
 * Built through `panelOf` rather than written out, so what the renderer is
 * handed is what the worker actually produces. A hand-written literal would
 * drift from the worker's shape and the drift would look like a passing test.
 */
const PANEL: Panel = panelOf(
  reading({
    images: [
      image({
        at: 0,
        selector: 'html > body > img:nth-of-type(1)',
        srcset: '/i/640.png 640w, /i/1080.png 1080w',
        sizes: '33vw',
        renderedWidth: 475,
        renderedHeight: 317,
        alt: 'A person at a desk',
        currentSrc: 'https://example.com/i/640.png',
      }),
      image({
        at: 1,
        selector: 'html > body > img:nth-of-type(2)',
        srcset: '/i/640.png 640w, /i/1080.png 1080w',
        sizes: '33vw',
        renderedWidth: 475,
        renderedHeight: 317,
        currentSrc: 'https://example.com/i/1080.png',
        loading: 'lazy',
      }),
    ],
    backgroundImageCount: 2,
  }),
);

/**
 * The panel, run the way Chrome runs it: the text of the function, evaluated
 * in a context holding a `document` and nothing else, with its argument
 * serialised on the way in.
 *
 * The header of `src/panel.ts` says why that is the only honest way to run it
 * — `executeScript` sends the source, not the function. Calling `renderPanel`
 * directly would prove nothing about the copy a page gets.
 * `report/test/in-page.test.ts` ships core into a document by the same route.
 *
 * `JSON.stringify` is not a convenience either. `executeScript` serialises its
 * `args`, so anything in a panel that did not survive a round trip through
 * JSON is something the page would never receive — which is what makes the
 * `Panel` type strings and booleans and nothing else.
 */
const inPage = (source: string, host: Page, panel: Panel = PANEL): unknown => {
  const context = vm.createContext({ document: host });
  return vm.runInContext(`(${source})(${JSON.stringify(panel)})`, context);
};

/**
 * What Chrome would actually send, out of the built module rather than the one
 * Vitest transformed.
 *
 * The two are not the same text: this package builds to ES2022 and Vite's
 * transform targets the running Node, so a syntax `tsc` downlevels arrives in
 * `dist` as a call to a helper `tsc` wrote at the top of the module — exactly
 * the kind of name that does not come over with a function.
 *
 * The module is evaluated and the function stringified inside it, rather than
 * the module text being run against the page, because running the module would
 * put such a helper in scope and hide the thing this is for.
 */
function shipped(): string {
  const text = readFileSync(fileURLToPath(new URL('../dist/panel.js', import.meta.url)), 'utf8');
  const context = vm.createContext({});
  return vm.runInContext(
    `${text.replace(/^export /gm, '')}\n;String(renderPanel)`,
    context,
  ) as string;
}

/**
 * Every way one arrangement of the panel is reachable from the page it sits
 * in, one line each. Empty is clean.
 *
 * A page reaches a node two ways and only two: a selector, which stops at a
 * shadow boundary, and `element.shadowRoot`, which is null for a closed root.
 * So a panel is unreachable when everything it made is inside a root, and the
 * root is closed. Both halves are needed — an open root leaves the whole
 * subtree one property access away, and a node left in the light tree is one
 * `document.querySelectorAll('*')` away whatever the root's mode is.
 */
function exposed(host: Page): string[] {
  const element = host.getElementById(HOST_ID);
  if (element === null) return ['adds no host element at all'];

  const attached = element.attached;
  return [
    ...(element.children.length === 0
      ? []
      : [`leaves ${element.children.length} node(s) where a page selector can match them`]),
    ...(attached === null
      ? ['attaches no shadow root, so every node it made is in the page tree']
      : [
          ...(attached.mode === 'closed'
            ? []
            : ['attaches an open shadow root, which page script can reach through shadowRoot']),
          ...(attached.root.children.length === 0 ? ['puts nothing in the shadow root'] : []),
        ]),
  ];
}

/** Where a declaration was written, which the cascade calls its context. */
type Context = 'page' | 'panel';

type Declaration = { property: string; value: string; important: boolean; context: Context };

/**
 * How far up the cascade one declaration sits: origin and importance first,
 * then encapsulation context, which reverses with importance — the outer tree
 * wins for normal declarations and the inner tree wins for important ones.
 *
 * The page is the outer tree and the panel's stylesheet is the inner one. The
 * comment above the stylesheet in `src/panel.ts` argues why that shape is the
 * defence; this is the same rule as a number, so the argument can be checked
 * rather than believed.
 */
const rank = (declaration: Declaration): number =>
  declaration.important
    ? declaration.context === 'panel'
      ? 4
      : 3
    : declaration.context === 'panel'
      ? 1
      : 2;

/**
 * The properties `all` is not a shorthand for.
 *
 * `all` resets every property there is *except* these. Two are named in the
 * spec — `direction` and `unicode-bidi`, left out because resetting them would
 * break bidirectional text in ways an author almost never means — and custom
 * properties are excluded because `all` is defined over the properties the
 * spec knows, and a custom property is by definition not one of them.
 *
 * This list is the reason the exclusion is written out rather than assumed. A
 * model that let `all` stand in for everything reported a boundary as
 * defending `direction` when a page setting `direction: rtl !important` on the
 * host mirrors the whole panel, and that is a real hole a passing test hid.
 */
const NOT_RESET_BY_ALL = (property: string): boolean =>
  property === 'direction' || property === 'unicode-bidi' || property.startsWith('--');

/**
 * The declaration a browser applies for one property, or nothing where
 * neither side named it.
 *
 * `all` counts as a declaration of every property it actually resets, which is
 * every property but the three above. It is how one line defends the ones
 * nobody thought to list, and why `weak` below insists it come first — a later
 * `all` resets the declarations written above it. What it is not is a licence
 * to skip the three it excludes: those have to be declared by name or they are
 * undefended.
 *
 * Later wins on a tie, as the cascade's last criterion does.
 */
function wins(declarations: Declaration[], property: string): Declaration | null {
  const covers = (one: Declaration): boolean =>
    one.property === property || (one.property === 'all' && !NOT_RESET_BY_ALL(property));

  return declarations
    .filter(covers)
    .reduce<Declaration | null>(
      (best, one) => (best === null || rank(one) >= rank(best) ? one : best),
      null,
    );
}

const HOST_BLOCK = /:host\s*\{([^}]*)\}/;

/**
 * The first block of any stylesheet, whatever its selector.
 *
 * The page's attack sheet is read with this rather than with `HOST_BLOCK`,
 * because a page targets the host by its id and not by `:host` — `:host` is a
 * selector that only exists inside a shadow tree. Which selector reached the
 * host does not enter the cascade comparison below; only where the declaration
 * was written does.
 */
const BLOCK = /\{([^}]*)\}/;

const declarationsOf = (block: string, context: Context): Declaration[] =>
  block
    .split(';')
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text) => {
      const important = /!\s*important$/.test(text);
      const [property, ...value] = text.replace(/!\s*important$/, '').split(':');
      return { property: property.trim(), value: value.join(':').trim(), important, context };
    });

/** The `:host` block of one stylesheet, as declarations. */
const hostRule = (css: string): Declaration[] =>
  declarationsOf(HOST_BLOCK.exec(css)?.[1] ?? '', 'panel');

/**
 * Every way one panel stylesheet is written too weakly to hold its boundary,
 * one line each. Empty is clean.
 */
function weak(css: string): string[] {
  const declarations = hostRule(css);
  return [
    ...(declarations.length === 0 ? ['declares no :host rule at all'] : []),
    ...(declarations[0]?.property === 'all' ? [] : ['does not reset every property first']),
    ...declarations
      .filter((one) => !one.important)
      .map((one) => `declares ${one.property} without !important, so a page rule outranks it`),
    // `all` resets every property but a custom one. A `var()` in here would
    // read a value the page can still set on the host and inherit in, which is
    // the one hole in the reset and the reason nothing here reads one.
    ...(/var\(/.test(css) ? ['reads a custom property, which no reset covers'] : []),
  ];
}

/** Every property a page stylesheet still reshapes, one line each. */
function reshapable(css: string, hostile: string): string[] {
  const page = declarationsOf(BLOCK.exec(hostile)?.[1] ?? '', 'page');
  const declarations = [...hostRule(css), ...page];

  return page
    .map((one) => one.property)
    .filter((property, at, all) => all.indexOf(property) === at)
    .filter((property) => wins(declarations, property)?.context === 'page')
    .map((property) => `loses ${property} to the page`);
}

/**
 * A page stylesheet written to break the panel: hide it, move it, make it
 * unreadable, mirror it.
 *
 * Every line is important, because an unimportant one loses to nothing — a
 * normal page rule already outranks a normal `:host` rule, so the honest
 * attack is the one that has already won that round.
 *
 * The last two lines are the ones that matter most. `direction` and
 * `unicode-bidi` inherit *and* `all` excludes them, so a reset that looks
 * complete leaves the panel mirrorable, and they have to be declared by name.
 */
const HOSTILE = `#${HOST_ID} {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  clip-path: inset(100%) !important;
  position: static !important;
  width: 0 !important;
  height: 0 !important;
  z-index: -1 !important;
  transform: scale(0) !important;
  pointer-events: none !important;
  font-size: 200px !important;
  font-family: Webdings !important;
  color: transparent !important;
  letter-spacing: 3em !important;
  text-transform: uppercase !important;
  direction: rtl !important;
  unicode-bidi: bidi-override !important;
}`;

/** The stylesheet the panel put in its shadow root. */
const stylesheetIn = (host: Page): string => {
  const element = host.getElementById(HOST_ID);
  if (element === null) throw new Error('the panel added no host element');
  const style = host.shadow(element).find((node: El) => node.name === 'style');
  if (style === undefined) throw new Error('the panel added no stylesheet');
  return style.textContent;
};

/** Every node the panel made, in the order it made them. */
const nodesIn = (host: Page): El[] => {
  const element = host.getElementById(HOST_ID);
  if (element === null) throw new Error('the panel added no host element');
  return host.shadow(element);
};

/**
 * Every grid the panel made, each as its own children in the order it appended
 * them, one line per node.
 *
 * The children rather than the `dt`s and the `dd`s collected separately, and
 * that is the whole point of it. A `dl` in two columns pairs by position: a
 * `dd` that arrived between two `dt`s puts every value after it against the
 * wrong label, and two `filter` passes counted against each other cannot see
 * that — the counts match either way. Walking the children in order can.
 */
const gridsIn = (host: Page): string[][] =>
  nodesIn(host)
    .filter((node) => node.name === 'dl')
    .map((grid) => grid.children.map((node) => `${node.name}: ${node.textContent}`));

/** One node per line, as `tag: the words it holds`. */
const said = (host: Page): string[] =>
  nodesIn(host)
    .filter((node) => node.name !== 'style' && node.textContent !== '')
    .map((node) => `${node.name}: ${node.textContent}`);

/**
 * The panel, checked as a rendering of an already-computed arithmetic.
 *
 * There is no arithmetic in this file, and that is the point of the split. The
 * renderer is handed strings and booleans and puts them in nodes; the numbers
 * are `explain.test.ts`'s, and the numbers came from core. What is left to
 * check here is what only a rendering can get wrong: an element per figure, a
 * mark on every held one, and the boundary holding while it does that.
 */
describe('the panel a click injects', () => {
  const source = String(renderPanel);

  it('opens and says so', () => {
    const host = page();

    expect(inPage(source, host)).toBe('opened');
    expect(host.getElementById(HOST_ID)).not.toBeNull();
  });

  it('hangs the host off the document element rather than the body', () => {
    // `position: fixed` is resolved against the nearest ancestor that made a
    // containing block, and a transform or a filter on `body` makes one. A
    // page that animates its body would otherwise drag the panel around with
    // it. `html` can do the same and rarely does.
    const host = page();
    inPage(source, host);

    expect(host.getElementById(HOST_ID)?.parent?.name).toBe('html');
  });

  it('writes the head, one item per image, and the footer', () => {
    const host = page();
    inPage(source, host);
    const nodes = nodesIn(host);

    expect(nodes.filter((node) => node.name === 'li')).toHaveLength(2);
    // The row is named after the file the browser loaded, which is what a
    // reader recognises it by. The DOM path that used to head it is a line of
    // the grid now.
    expect(nodes.filter((node) => node.name === 'h2').map((node) => node.textContent)).toEqual([
      '/i/640.png',
      '/i/1080.png',
    ]);
    expect(said(host)).toContain('p: viewport 1440×900 · DPR 1 · 2 images');
  });

  it('writes a term and then its own description, all the way down the grid', () => {
    const host = page();
    inPage(source, host);
    const [first] = gridsIn(host);

    // The pairing asserted as an order rather than as two counts, because the
    // grid pairs by position: the label a reader reads a value against is the
    // node before it, and nothing about the number of each kind says which one
    // that was.
    //
    // `loaded` comes back as the file and the mark's word run together, and
    // that is a real `textContent` read rather than a quirk of the stub: the
    // mark is a child of the `dd`, and reading a node's text concatenates its
    // descendants. It is what says the mark is inside the value it qualifies.
    expect(first).toEqual([
      'dt: alt',
      'dd: A person at a desk',
      'dt: rendered box',
      'dd: 475×317',
      'dt: selector',
      'dd: html > body > img:nth-of-type(1)',
      'dt: candidates',
      'dd: 640w, 1080w',
      'dt: sizes',
      'dd: 33vw',
      'dt: clause used',
      'dd: 33vw',
      'dt: css px',
      'dd: 475px',
      'dt: needed',
      'dd: 475px',
      'dt: picked',
      'dd: 640w  /i/640.png',
      'dt: loaded',
      'dd: /i/640.pngcache',
      'dt: bytes',
      'dd: unknown',
    ]);
  });

  it('marks every figure a held copy could explain, and marks nothing else', () => {
    // The design's requirement as a rendering rather than as a field: a mark
    // is drawn beside the value it qualifies, so a reader sees which figures
    // it covers without reading the footer first.
    const host = page();
    inPage(source, host);
    const marks = nodesIn(host).filter((node) => node.name === 'mark');

    expect(marks.map((node) => node.textContent)).toEqual([
      'cache',
      'cache',
      'cache',
      'cache',
    ]);
    // One chip on each row's compact line, where the loaded file is named
    // while a reader is scanning, and one on the `loaded` figure inside the
    // row's own grid.
    expect(marks.map((node) => node.parent?.name)).toEqual(['p', 'dd', 'p', 'dd']);
    // The figure and the mark's word as one string, which is what a real
    // `textContent` read of the `dd` returns — the mark is a child of it, and
    // reading a node's text concatenates its descendants. Asserting the figure
    // alone here would be asserting that the mark is not in the `dd`, and it
    // is the write order in `renderPanel` that keeps it there: `textContent`
    // removes every existing child, so the value has to be written before the
    // mark is appended and never after.
    expect(marks.map((node) => node.parent?.textContent)).toEqual([
      'picked 640w, and that is what loadedcache',
      '/i/640.pngcache',
      'picked 640w, loaded a different filecache',
      '/i/1080.pngcache',
    ]);
    // And every chip says what it means, where the mark is. The row's own
    // note carries the same reasoning in a form a keyboard reaches.
    expect([...new Set(marks.map((node) => node.title))]).toEqual([
      'what the browser has, not what it chose',
    ]);
  });

  it('says why the second image loaded a file the arithmetic did not pick', () => {
    const host = page();
    inPage(source, host);

    expect(said(host).some((line) => line.includes('not necessarily a bug'))).toBe(true);
  });

  it('says bytes are unknown, and shows no figure in their place', () => {
    const host = page();
    inPage(source, host);
    const values = nodesIn(host)
      .filter((node) => node.name === 'dd')
      .map((node) => node.textContent);

    expect(values.filter((value) => value === 'unknown')).toHaveLength(2);
    expect(said(host).some((line) => line.includes('never guesses a weight from pixels'))).toBe(
      true,
    );
  });

  it('says how many CSS background images it counted, and no more about them', () => {
    const host = page();
    inPage(source, host);

    expect(said(host)).toContain(
      'p: 2 elements on this page paint a CSS background image. A CSS background image has no ' +
        'selection mechanism at all, so imgwhy counts them and explains nothing further.',
    );
  });

  it('renders a page with no image at all, and claims nothing about one', () => {
    const host = page();
    inPage(source, host, panelOf(reading()));

    expect(nodesIn(host).filter((node) => node.name === 'li')).toEqual([]);
    expect(said(host)).toContain('p: viewport 1440×900 · DPR 1 · 0 images');
  });

  it('says every word as text rather than as markup', () => {
    // Every word arrives through `textContent`, so a page cannot get a tag out
    // of it however the words are chosen. `escaping.test.ts` holds that
    // against a page written to try.
    const host = page();
    inPage(source, host);

    expect(said(host).some((line) => line.startsWith('h1: imgwhy'))).toBe(true);
  });
});

/**
 * The panel as a boundary, and the boundary's limits.
 *
 * ## What still gets past
 *
 * - **An ancestor that reshapes it.** A page rule on `html` — a `transform`,
 *   a `filter`, `contain: paint` — makes a containing block or a paint
 *   container, and a `position: fixed` descendant is moved, clipped or hidden
 *   by it no matter what `:host !important` says. No declaration inside a
 *   shadow tree can reach an ancestor of its own host. Nothing here defends
 *   against it, and the choice of `documentElement` over `body` narrows it
 *   rather than closing it: a page that transforms its `body` is common and a
 *   page that transforms `html` is rare, which is the only reason to prefer
 *   one. Closing it properly means an iframe, which is a different panel and a
 *   different slice.
 * - **A custom property.** `all` does not reset one, and there is no finite
 *   list of them to declare. `weak` refuses a `var()` so nothing in the panel
 *   reads a value the page can set.
 * - **A page that plants the host id itself.** A page carrying its own
 *   `#__imgwhy_host__` makes the first click remove that element and open no
 *   panel, because the toggle reads its state off the page and the page is
 *   lying. It is the page's own element and its own footgun, it costs a
 *   visitor nothing, and it is the price of the state decision in `read.ts` —
 *   which is the right decision, because the alternative is storing something.
 *   A marker only the extension could recognise would have to be kept
 *   somewhere, and there is nowhere.
 */
describe('the panel, checked as a boundary against page styles', () => {
  const source = String(renderPanel);

  it('is reachable from the page by no route at all', () => {
    const host = page();
    inPage(source, host);

    expect(exposed(host)).toEqual([]);
  });

  it('closes the shadow root, so page script cannot read what is in it', () => {
    const host = page();
    inPage(source, host);
    const element = host.getElementById(HOST_ID) as El;

    expect(element.attached?.mode).toBe('closed');
    expect(element.shadowRoot).toBeNull();
    // The nodes exist; they are simply not reachable from the element.
    expect(host.shadow(element).length).toBeGreaterThan(1);
  });

  it('leaves nothing in the light tree but the host, which holds no words', () => {
    const host = page();
    inPage(source, host);
    const element = host.getElementById(HOST_ID) as El;

    expect(element.children).toEqual([]);
    expect(element.textContent).toBe('');
  });

  it('writes its boundary strongly enough to hold it', () => {
    const host = page();
    inPage(source, host);

    expect(weak(stylesheetIn(host))).toEqual([]);
  });

  it('loses no property to a page stylesheet written to break it', () => {
    const host = page();
    inPage(source, host);

    expect(reshapable(stylesheetIn(host), HOSTILE)).toEqual([]);
  });

  it('resets every property at the boundary before it sets any of its own', () => {
    const host = page();
    inPage(source, host);
    const declarations = hostRule(stylesheetIn(host));

    expect(declarations[0]).toMatchObject({ property: 'all', value: 'initial', important: true });
  });

  it('names a system font stack, which the design asks for and a reset undoes', () => {
    // > `report.html` inlines every style, script and font. […] Use a system
    // > font stack.
    //
    // The same reason applies here and more sharply: a webfont is a request,
    // and this extension makes none. `all: initial` would otherwise leave the
    // panel in the UA's default serif.
    const host = page();
    inPage(source, host);
    const css = stylesheetIn(host);

    expect(css).toContain('system-ui');
    expect(css).not.toContain('@font-face');
    expect(css).not.toContain('url(');
  });

  it('selects on tag names alone, so the panel writes no class to any element', () => {
    // Which is why the elements are semantic ones. `privacy.test.ts` allows
    // this package two written properties — an id and the words it says — and
    // a class name would be a third for no gain a `dl` does not already give.
    const host = page();
    inPage(source, host);

    // A selector, not a full stop: `rgba(16, 18, 22, 0.18)` has one of those
    // and is not a class. What this refuses is a rule whose selector opens
    // with a dot, which is the only shape a class selector takes.
    expect(stylesheetIn(host)).not.toMatch(/^\s*\.[a-z]/im);
  });
});

/**
 * The same panel, out of the built module rather than out of the one Vitest
 * transformed, because the built one is what Chrome stringifies and sends.
 */
describe('the panel as the built module ships it, which is the copy a page gets', () => {
  beforeAll(refuseStaleBuild);

  it('is self-contained, so nothing it needs was left behind in its module', () => {
    const host = page();

    expect(inPage(shipped(), host)).toBe('opened');
    expect(nodesIn(host).filter((node) => node.name === 'li')).toHaveLength(2);
  });

  it('holds its boundary, the same as the source does', () => {
    const host = page();
    inPage(shipped(), host);

    expect(exposed(host)).toEqual([]);
    expect(weak(stylesheetIn(host))).toEqual([]);
    expect(reshapable(stylesheetIn(host), HOSTILE)).toEqual([]);
  });
});

/**
 * The checks, read against panels written the ways that would fail.
 *
 * Each entry below is a real way to lose the isolation, and they are held here
 * rather than tried in a browser and reverted, so the failure they should
 * cause is a passing test instead of a note in a commit message.
 */
describe('the isolation checks, given panels that do not isolate', () => {
  const attacks: [string, string, string[]][] = [
    [
      'a panel appended straight to the page, with no shadow root anywhere',
      `function () {
        const host = document.createElement('div');
        host.id = '${HOST_ID}';
        host.appendChild(document.createElement('section'));
        document.documentElement.appendChild(host);
        return 'opened';
      }`,
      [
        'leaves 1 node(s) where a page selector can match them',
        'attaches no shadow root, so every node it made is in the page tree',
      ],
    ],
    [
      'an open shadow root, which the page reads through element.shadowRoot',
      `function () {
        const host = document.createElement('div');
        host.id = '${HOST_ID}';
        host.attachShadow({ mode: 'open' }).appendChild(document.createElement('section'));
        document.documentElement.appendChild(host);
        return 'opened';
      }`,
      ['attaches an open shadow root, which page script can reach through shadowRoot'],
    ],
    [
      'a shadow root with the panel next to it rather than inside it',
      `function () {
        const host = document.createElement('div');
        host.id = '${HOST_ID}';
        host.attachShadow({ mode: 'closed' });
        host.appendChild(document.createElement('section'));
        document.documentElement.appendChild(host);
        return 'opened';
      }`,
      [
        'leaves 1 node(s) where a page selector can match them',
        'puts nothing in the shadow root',
      ],
    ],
  ];

  it.each(attacks)('catches %s', (_route, panel, expected) => {
    const host = page();
    inPage(panel, host);

    expect(exposed(host)).toEqual(expected);
  });

  /**
   * Three ways a boundary fails, which is what separates a sound one from a
   * weak one: no importance, no reset, and a reset that stops short of the
   * properties `all` excludes.
   *
   * What each loses to the page is asserted by the count and by the property
   * that makes the argument, rather than by naming all seventeen. The count is
   * what says the rest were held.
   */
  const sheets: [string, string, string[], number, string[]][] = [
    [
      'a boundary with no importance on it, which a normal page rule already beats',
      ':host { all: initial; position: fixed; z-index: 2147483647; }',
      [
        'declares all without !important, so a page rule outranks it',
        'declares position without !important, so a page rule outranks it',
        'declares z-index without !important, so a page rule outranks it',
      ],
      // Everything, including the properties it named: a normal inner-tree
      // declaration is the bottom of the author cascade, not the top.
      17,
      ['loses position to the page'],
    ],
    [
      'a boundary that pins what someone thought of and resets nothing else',
      ':host { position: fixed !important; display: block !important; z-index: 2147483647 !important; }',
      ['does not reset every property first'],
      // The three it named are held; the fourteen nobody listed get through,
      // and they are the inherited ones. This is the argument for `all`.
      14,
      ['loses font-size to the page'],
    ],
    [
      'a reset that leaves out the two properties the real shorthand excludes',
      ':host { all: initial !important; position: fixed !important; }',
      // `weak` is quiet, because the rule it checks is satisfied — and the
      // panel is still mirrored. This is the case that was passing while the
      // shipped panel had the same hole, and the reason `wins` models the
      // exclusion rather than assuming `all` covers everything.
      [],
      2,
      ['loses direction to the page', 'loses unicode-bidi to the page'],
    ],
  ];

  it.each(sheets)('catches %s', (_route, css, weakly, count, named) => {
    const found = reshapable(css, HOSTILE);

    expect(weak(css)).toEqual(weakly);
    expect(found).toHaveLength(count);
    for (const line of named) expect(found).toContain(line);
  });

  it('is quiet about the boundary that ships', () => {
    const host = page();
    inPage(String(renderPanel), host);

    expect(weak(stylesheetIn(host))).toEqual([]);
    expect(reshapable(stylesheetIn(host), HOSTILE)).toEqual([]);
  });
});
