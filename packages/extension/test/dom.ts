/**
 * A page, as much of one as the two injected functions touch.
 *
 * The design's Testing section:
 *
 * > **extension** — test the logic through `core`. Keep the panel thin enough
 * > that it needs no browser test.
 *
 * So there is no browser here, and no headless one either. What there is is
 * the members `readPage` and `renderPanel` reach for, written out with the
 * semantics that matter to the claims about them: that a second click removes
 * what the first added, that nothing the panel adds is reachable from the
 * page, that a `<picture>` puts the `<source>` a browser would read in front
 * of the reader rather than the one written after the tag, and that writing a
 * node's text throws away the children it had.
 *
 * The isolation half is the reason this is a small object graph rather than a
 * pair of spies. "Reachable from the page" is a question about a tree —
 * whether a node the panel made is a descendant of one a page selector could
 * match — and a tree is the only thing that can answer it. `attachShadow`
 * below is written for the one detail the whole isolation claim rests on: a
 * closed root is not reachable from the element that owns it, so
 * `element.shadowRoot` is null, and an open one is.
 *
 * Both functions run through `node:vm` rather than by being called, the way
 * `report/test/in-page.test.ts` runs the report's script. They are shipped by
 * `chrome.scripting.executeScript`, which stringifies them and evaluates the
 * text in the page — so each arrives with none of its module around it. A
 * module constant one of them closed over would be a `ReferenceError` in
 * someone's browser and nothing at all in a test that called it directly.
 *
 * `globals` below is the other half of the same argument. `matchMedia`,
 * `getComputedStyle`, `innerWidth`, `innerHeight` and `devicePixelRatio` are
 * names the reader has because a page has them, and a `vm` context holds
 * nothing that is not put in it — so a reader reaching for a sixth name fails
 * here rather than in somebody's browser.
 */

/** What `attachShadow` is handed, which is one field of interest. */
export type ShadowOptions = { mode: 'open' | 'closed' };

/** An element, and a shadow root, which behaves enough like one here. */
export class El {
  id = '';
  readonly children: El[] = [];
  parent: El | null = null;

  /**
   * The one text node a `textContent` write leaves behind, which is what makes
   * the accessors below a model rather than a field.
   *
   * `textContent` is not a string property, and the difference is load-bearing
   * in exactly one place in the panel: the `dd` that holds a figure and the
   * `<mark>` that says a held copy could explain it. Writing the property
   * *removes every existing child* and replaces the lot with one text node, and
   * reading it concatenates the text of every descendant. So the panel has to
   * write the value before it appends the mark, and the two lines in the other
   * order silently delete the mark — which is criterion 2 unmet, with the
   * footer sentence left pointing at nothing.
   *
   * A plain field cannot fail that way, so a stub with one passes an ordering
   * a browser breaks. This is the same argument `panel.test.ts` makes about
   * `all: initial` and the properties it excludes: a model that is easier than
   * the platform reports a boundary as held when it is not.
   */
  private text = '';

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    for (const child of this.children) child.parent = null;
    this.children.length = 0;
    this.text = value;
  }

  /**
   * The attributes an `<img>` or a `<source>` carries, as the reader reads
   * them. Empty unless a test sets one, so a case says what it means.
   *
   * `rect` is what `getBoundingClientRect().width` reports and `width` is the
   * attribute the reader falls back to, which are two different things: a
   * `display: none` image has a rect of zero and an attribute that still says
   * how wide the page asked for it.
   */
  srcset = '';
  sizes = '';
  media = '';
  currentSrc = '';
  src = '';
  width = 0;
  rect = 0;
  baseURI = '';
  loading: string | null = null;
  /** The computed `background-image`, which is a string and often `none`. */
  background = 'none';

  constructor(readonly name: string) {}

  get tagName(): string {
    return this.name.toUpperCase();
  }

  get parentElement(): El | null {
    return this.parent;
  }

  getBoundingClientRect(): { width: number } {
    return { width: this.rect };
  }

  /** One attribute, and the reader asks about exactly one. */
  getAttribute(name: string): string | null {
    return name === 'loading' ? this.loading : null;
  }

  /** The nearest ancestor with this tag name, itself included. */
  closest(selector: string): El | null {
    let node: El | null = this;
    while (node !== null) {
      if (node.name === selector) return node;
      node = node.parent;
    }
    return null;
  }

  attachShadow(options: ShadowOptions): El {
    if (this.attached !== null) throw new Error(`${this.name} already has a shadow root`);
    const root = new El('#shadow-root');
    root.parent = this;
    this.attached = { mode: options.mode, root };
    this.shadowRoot = options.mode === 'open' ? root : null;
    return root;
  }

  appendChild(child: El): El {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    const held = this.parent?.children;
    if (held !== undefined) held.splice(held.indexOf(this), 1);
    this.parent = null;
  }

  /**
   * The root `attachShadow` made and the mode it was made with, whether or
   * not the page can see it. The test needs to look inside a closed root to
   * check what is in there; a page cannot, and `shadowRoot` is what says so.
   */
  attached: { mode: string; root: El } | null = null;

  /** What the element exposes: null for a closed root, which is the point. */
  shadowRoot: El | null = null;
}

/** The subtree under one node, itself excluded, shadow roots not entered. */
export const descendants = (node: El): El[] =>
  node.children.flatMap((child) => [child, ...descendants(child)]);

/** A document, and the readings the two injected functions take of one. */
export type Page = {
  documentElement: El;
  /**
   * `document.images`, which is live in a browser and filled by hand here.
   * The order is document order, because that is the order the panel lists.
   */
  images: El[];
  createElement(name: string): El;
  getElementById(id: string): El | null;
  querySelectorAll(selector: string): El[];
  /** Every node a page selector could match, which is the light tree alone. */
  light(): El[];
  /** Every node under one element's shadow root, closed or not. */
  shadow(host: El): El[];
};

export function page(): Page {
  const documentElement = new El('html');
  documentElement.appendChild(new El('body'));

  const light = (): El[] => [documentElement, ...descendants(documentElement)];

  return {
    documentElement,
    images: [],
    createElement: (name) => new El(name),
    // A shadow boundary is exactly where `getElementById` stops, which is
    // both correct and the reason the toggle can use it: the host is in the
    // light tree, and everything the panel is made of is not.
    getElementById: (id) => light().find((node) => node.id === id) ?? null,
    // `*` is the only selector the reader writes, and the light tree is what
    // it matches — a query does not enter a shadow root, which is why the
    // panel's own nodes never turn up in the background count.
    querySelectorAll: (selector) => (selector === '*' ? light() : []),
    light,
    shadow: (host) => {
      const root = host.attached?.root;
      return root === undefined ? [] : [root, ...descendants(root)];
    },
  };
}

/** The browser around the page: the viewport it renders at and its ratio. */
export type World = { width: number; height: number; dpr: number };

/**
 * A media condition, evaluated the way a `<source media>` is evaluated.
 *
 * `min-width` and `max-width` joined by `and`, which is the whole of what
 * `core`'s own condition reader understands and the whole of what the design
 * asks for — `<picture>` type negotiation is a non-goal, and no other feature
 * appears in any fixture. Anything else is treated as not matching, which is
 * how a browser treats a condition it cannot parse.
 */
const matches = (query: string, width: number): boolean =>
  query
    .split(/\s+and\s+/i)
    .every((part) => {
      const read = /\(\s*(min|max)-width\s*:\s*([\d.]+)px\s*\)/i.exec(part);
      if (read === null) return false;
      const at = Number(read[2]);
      return read[1].toLowerCase() === 'max' ? width <= at : width >= at;
    });

/**
 * The `vm` context an injected function runs in: a document and the five
 * names a page supplies that the reader reads.
 *
 * Nothing else is here, deliberately. The context is the claim — a function
 * that reaches for a sixth global is a function whose stringified copy would
 * throw in a browser, and the only way to catch that is to hand it a world
 * with nothing in it that was not written down.
 */
export const globals = (host: Page, world: World): Record<string, unknown> => ({
  document: host,
  innerWidth: world.width,
  innerHeight: world.height,
  devicePixelRatio: world.dpr,
  matchMedia: (query: string) => ({ matches: matches(query, world.width) }),
  getComputedStyle: (element: El) => ({ backgroundImage: element.background }),
});
