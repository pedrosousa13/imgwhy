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
 * `getComputedStyle`, `innerWidth`, `innerHeight`, `devicePixelRatio`,
 * `window` and `Event` are names the injected functions have because a page
 * has them, and a `vm` context holds nothing that is not put in it — so a
 * function reaching for a name that is not one of those eight fails here
 * rather than in somebody's browser.
 *
 * `windowOf` is the newest of them and the one with the most semantics in it:
 * a scroll offset that moves, every box on the page moving with it, and a
 * listener a second registration of the same function does not duplicate. All
 * three are what a mark that follows its image rests on, and a window that
 * only recorded the calls made to it would report a mark drawn once from a
 * stale rect as a mark that follows.
 */

/** What `attachShadow` is handed, which is one field of interest. */
export type ShadowOptions = { mode: 'open' | 'closed' };

/**
 * The box `getBoundingClientRect` reports, which is four numbers and not one.
 *
 * All four, because the two halves of the extension read different ones. The
 * reader takes the width and the height, which is the shape a person
 * recognises an image by. The panel takes the top and the left as well, which
 * is where it puts the box it draws over the image — and viewport coordinates
 * are what makes that a `position: fixed` rule with no scroll offset in it.
 *
 * A stub that reported the width alone would let a panel place its mark at the
 * origin of the screen on every image on the page and still pass.
 */
export type Box = { width: number; height: number; top: number; left: number };

/** One box, with the numbers a case cares about set and the rest at zero. */
export const box = (fields: Partial<Box> = {}): Box => ({
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  ...fields,
});

/**
 * How `scrollIntoView` was asked for, kept so a case can read it back.
 *
 * The options are not decoration. `behavior: 'instant'` is what overrides a
 * page's own `scroll-behavior: smooth`, and without it the rect the panel
 * reads on the next line is the box's position before the animation — a mark
 * drawn where the image used to be.
 */
export type ScrollAsked = { block?: string; behavior?: string };

/**
 * How the window was asked to scroll, which is the one change a click makes.
 *
 * `top` is a document coordinate where a rect is a viewport one, which is the
 * whole reason `scrollY` is on the window below: a panel that handed
 * `scrollTo` a rect's own `top` would scroll to the right place only while the
 * page happened to be at the top of itself.
 */
export type ScrollToAsked = { top?: number; left?: number; behavior?: string };

/**
 * An event, as much of one as a dispatch needs.
 *
 * Named `Ev` here and handed to the reader as `Event`, the way `El` is handed
 * over as an element: what the injected functions have is the page's globals,
 * and `readPage` reaches for that one to say the panel is closing.
 */
export class Ev {
  constructor(readonly type: string) {}
}

/**
 * Which events bubble.
 *
 * The panel's listeners come in pairs that turn on exactly this: `mouseenter`
 * and `mouseleave` do not bubble, which is why they are the pair a row uses
 * for a pointer, and `focusin` and `focusout` do, which is why they are the
 * pair it uses for a keyboard — the thing that takes focus is the button
 * inside the row rather than the row. A stub that bubbled everything would
 * pass a panel listening for `focus` on the row, which fires never.
 *
 * A closed table rather than a default, so `dispatch` throws on an event
 * nobody wrote down instead of quietly deciding it does not bubble.
 */
const BUBBLES: Record<string, boolean> = {
  click: true,
  focusin: true,
  focusout: true,
  focus: false,
  blur: false,
  mouseenter: false,
  mouseleave: false,
};

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
   * `rect` is what `getBoundingClientRect()` reports and `width` and `height`
   * are the attributes the reader falls back to, which are two different
   * things: a `display: none` image has a rect of zeros and attributes that
   * still say how large the page asked for it.
   */
  srcset = '';
  sizes = '';
  media = '';
  currentSrc = '';
  src = '';
  width = 0;
  height = 0;
  rect: Box = box();
  baseURI = '';
  loading: string | null = null;
  /**
   * The `alt` attribute, one field for both halves of the extension.
   *
   * One rather than two because a browser has one. `getAttribute('alt')` reads
   * the attribute — null where the page wrote none, which is the state the
   * reader needs and `img.alt` collapses to `''` — and writing the `alt`
   * property writes that same attribute, which is what the panel does to its
   * thumbnail. So a write here is visible to a read here, exactly as it would
   * be in a page.
   */
  alt: string | null = null;
  /** The tooltip the panel writes on the cache mark. */
  title = '';
  /**
   * The one class the panel writes: the verdict's tone, on its `output`.
   *
   * A string property, the way the platform's is, so a test can read back
   * exactly the word the panel gave it and nothing about how it was styled —
   * the stylesheet is checked separately, as text.
   */
  className = '';
  /** Whether a `details` is open, which the panel writes once. */
  open = false;
  /** The computed `background-image`, which is a string and often `none`. */
  background = 'none';

  /**
   * How this element clips what overflows it, which is what makes it a scroll
   * container.
   *
   * `visible` is not one; every other value is, and `hidden` is the value that
   * matters. A `hidden` box has no scrollbar for a reader to drag and is
   * scrollable all the same — a carousel's track is one, held at an offset its
   * own script chose — so it is a position a panel can move and nobody can put
   * back.
   */
  overflow = 'visible';

  /**
   * Where this element is scrolled to, which is the page's own state.
   *
   * A field rather than nothing, because "the panel changed a scroll offset it
   * cannot restore" is a claim about a number that moved, and a stand-in with
   * no number cannot fail it. `scrollIntoView` below is what moves it, which
   * is the defect it exists to show.
   */
  scrollTop = 0;

  /**
   * Every listener registered on this element, by event name.
   *
   * Kept rather than counted, because the claim they answer is about where
   * they are: the panel registers every one of them on a node it made inside
   * its own closed root, so removing the host removes the lot and no page
   * element is left carrying anything. A test can only say that by walking the
   * page and finding none.
   */
  readonly listeners: Map<string, (() => void)[]> = new Map();

  /** Every `scrollIntoView` this element was asked for, in order. */
  readonly scrolled: ScrollAsked[] = [];

  constructor(readonly name: string) {}

  get tagName(): string {
    return this.name.toUpperCase();
  }

  get parentElement(): El | null {
    return this.parent;
  }

  getBoundingClientRect(): Box {
    return this.rect;
  }

  /** The two attributes the reader asks for, and null for anything else. */
  getAttribute(name: string): string | null {
    if (name === 'loading') return this.loading;
    if (name === 'alt') return this.alt;
    return null;
  }

  addEventListener(type: string, handler: () => void): void {
    const held = this.listeners.get(type) ?? [];
    held.push(handler);
    this.listeners.set(type, held);
  }

  /**
   * Bring this element into view the way a browser does, which is by scrolling
   * every scroll container between it and the viewport.
   *
   * The ancestors are the reason this is modelled rather than recorded. The
   * spec has `scrollIntoView` scroll the element's ancestor scroll boxes, and
   * an `overflow: hidden` container is one of them — so a call meant to move
   * the viewport moves a carousel's track with it, the carousel's own index
   * and dot indicator still say otherwise, and nothing in the page or the
   * panel puts the track back. A stand-in that only pushed the options onto a
   * list would report all of that as no change at all.
   *
   * The offset written brings the element to the container's top rather than
   * to the figure a browser lands on for `block: 'center'`. What a case here
   * asks is whether a container the panel has no business touching moved; how
   * far it moved is a number no claim in this package rests on.
   *
   * The viewport half is deliberately not here. The panel's route to the
   * window scroll is `window.scrollTo`, so the window models its own offset
   * and a case reads it off the thing that owns it.
   */
  scrollIntoView(asked: ScrollAsked = {}): void {
    this.scrolled.push(asked);
    for (let node = this.parent; node !== null; node = node.parent) {
      if (node.overflow !== 'visible') node.scrollTop += this.rect.top - node.rect.top;
    }
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

/**
 * Fire one event at one element, the way a browser fires it.
 *
 * Bubbling is modelled rather than assumed, and it is the whole reason this is
 * a function and not a loop over one element's handlers. The panel's four row
 * listeners are two deliberate pairs — a non-bubbling one for the pointer and
 * a bubbling one for focus — and a dispatcher that ran only the target's own
 * handlers would report a working panel for one written the other way round.
 * `focusin` on the button has to reach the row; `mouseenter` on the button
 * must not.
 *
 * An event nobody wrote down throws, so a listener registered for a fifth
 * event is modelled before it is trusted.
 */
export function dispatch(target: El, type: string): void {
  const bubbles = BUBBLES[type];
  if (bubbles === undefined) throw new Error(`no test models the "${type}" event`);

  let node: El | null = target;
  while (node !== null) {
    for (const handler of node.listeners.get(type) ?? []) handler();
    node = bubbles ? node.parent : null;
  }
}

/**
 * Every listener on a node the page can reach, as `tag: event`.
 *
 * The page and not the panel, which is the point of it. "Listeners are removed
 * when the panel closes" is a claim about the page, and the strongest form of
 * it is that no page element ever carried one — so this walks the light tree,
 * where a shadow root is exactly where it stops.
 */
export const listenersIn = (host: Page): string[] =>
  host
    .light()
    .flatMap((node) => [...node.listeners.keys()].map((type) => `${node.name}: ${type}`));

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

/**
 * The window a panel is injected into: the one scroll offset a click may
 * change, and the events a mark listens for.
 *
 * A model rather than a pair of spies, for the reason `El` is one. Both claims
 * this exists for are about a number that moves and a box that moves with it:
 * a `scrollTo` that only recorded its argument would pass a mark that read the
 * rect once and wrote fixed viewport coordinates into the sheet, because
 * nothing in the page would have moved between the two reads.
 */
export type Win = {
  /**
   * Where the document is scrolled to, which is the panel's one sanctioned
   * change to the page and the one a reader can undo with a scroll.
   */
  scrollX: number;
  scrollY: number;
  /** Every scroll the panel asked the window for, in order. */
  readonly scrolled: ScrollToAsked[];
  /** Every listener on the window, by event name. */
  readonly listeners: Map<string, (() => void)[]>;
  addEventListener(type: string, handler: () => void): void;
  removeEventListener(type: string, handler: () => void): void;
  scrollTo(asked: ScrollToAsked): void;
  dispatchEvent(event: { type: string }): void;
};

/**
 * The window around one page.
 *
 * Three details are modelled rather than stubbed, and each of them is a way a
 * green test could otherwise ship a broken panel:
 *
 * - **A duplicate registration is ignored.** A browser keeps one listener per
 *   event, function and phase, which is what lets the panel add its two on
 *   every mark without counting the marks before. A stub that appended would
 *   fire a handler once per hover and pass a panel that leaked one listener a
 *   row.
 * - **A scroll moves every box on the page.** A rect is measured against the
 *   viewport, so scrolling the document down by 300 puts every element 300
 *   nearer the top of it. That coupling is the whole of what "the mark follows
 *   its image" means, and a stub that moved the offset alone would let a
 *   cached rect pass.
 * - **The scroll event fires from the scroll.** Synchronously here, where a
 *   browser fires it on the next frame. The difference does not reach any
 *   claim below: what is asserted is that a listener was registered and that
 *   what it draws comes from a fresh reading.
 *
 * Every box is moved, which is a simplification worth naming: a page's own
 * `position: fixed` element does not move with a scroll, and nothing here
 * knows which elements those are. No case in this directory has one.
 */
export function windowOf(host: Page): Win {
  const listeners = new Map<string, (() => void)[]>();

  const win: Win = {
    scrollX: 0,
    scrollY: 0,
    scrolled: [],
    listeners,
    addEventListener: (type, handler) => {
      const held = listeners.get(type) ?? [];
      if (!held.includes(handler)) held.push(handler);
      listeners.set(type, held);
    },
    removeEventListener: (type, handler) => {
      const held = (listeners.get(type) ?? []).filter((one) => one !== handler);
      if (held.length === 0) listeners.delete(type);
      else listeners.set(type, held);
    },
    dispatchEvent: (event) => {
      for (const handler of [...(listeners.get(event.type) ?? [])]) handler();
    },
    scrollTo: (asked) => {
      win.scrolled.push(asked);
      const top = asked.top ?? win.scrollY;
      const left = asked.left ?? win.scrollX;
      // A new box per element rather than a mutated one, because a case builds
      // its page out of shared `box()` literals and a scroll is not allowed to
      // reach back into the next case's fixture.
      for (const node of host.light()) {
        node.rect = { ...node.rect, top: node.rect.top - (top - win.scrollY) };
      }
      win.scrollY = top;
      win.scrollX = left;
      win.dispatchEvent(new Ev('scroll'));
    },
  };

  return win;
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
 * The `vm` context an injected function runs in: a document, the five names a
 * page supplies that the reader reads, and the two more the panel's mark and
 * the closing click need — the window, and the event fired on it.
 *
 * Nothing else is here, deliberately. The context is the claim — a function
 * that reaches for a ninth global is a function whose stringified copy would
 * throw in a browser, and the only way to catch that is to hand it a world
 * with nothing in it that was not written down.
 *
 * `win` is a parameter rather than a fresh window every time because the panel
 * and the click that closes it are two injections into one page: a case that
 * asks whether the closing click took the panel's window listeners down has to
 * hand both halves the same window.
 */
export const globals = (
  host: Page,
  world: World,
  win: Win = windowOf(host),
): Record<string, unknown> => ({
  document: host,
  innerWidth: world.width,
  innerHeight: world.height,
  devicePixelRatio: world.dpr,
  matchMedia: (query: string) => ({ matches: matches(query, world.width) }),
  getComputedStyle: (element: El) => ({ backgroundImage: element.background }),
  window: win,
  Event: Ev,
});
