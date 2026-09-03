/**
 * A page, as much of one as the panel touches.
 *
 * The design's Testing section:
 *
 * > **extension** — test the logic through `core`. Keep the panel thin enough
 * > that it needs no browser test.
 *
 * So there is no browser here, and no headless one either. What there is is
 * the eight members `togglePanel` reaches for, written out with the semantics
 * that matter to the two claims about it: that a second click removes what the
 * first added, and that nothing it adds is reachable from the page.
 *
 * The second of those is the reason this is a small object graph rather than a
 * pair of spies. "Reachable from the page" is a question about a tree —
 * whether a node the panel made is a descendant of one a page selector could
 * match — and a tree is the only thing that can answer it. `attachShadow`
 * below is written for the one detail the whole isolation claim rests on: a
 * closed root is not reachable from the element that owns it, so
 * `element.shadowRoot` is null, and an open one is.
 *
 * The panel runs through `node:vm` rather than by being called, the way
 * `report/test/in-page.test.ts` runs the report's script. The function is
 * shipped by `chrome.scripting.executeScript`, which stringifies it and
 * evaluates the text in the page — so it arrives with none of its module
 * around it. A module constant it closed over would be a `ReferenceError` in
 * someone's browser and nothing at all in a test that called it directly.
 */

/** What `attachShadow` is handed, which is one field of interest. */
export type ShadowOptions = { mode: 'open' | 'closed' };

/** An element, and a shadow root, which behaves enough like one here. */
export class El {
  id = '';
  textContent = '';
  readonly children: El[] = [];
  parent: El | null = null;

  /**
   * The root `attachShadow` made and the mode it was made with, whether or
   * not the page can see it. The test needs to look inside a closed root to
   * check what is in there; a page cannot, and `shadowRoot` is what says so.
   */
  attached: { mode: string; root: El } | null = null;

  /** What the element exposes: null for a closed root, which is the point. */
  shadowRoot: El | null = null;

  constructor(readonly name: string) {}

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
}

/** The subtree under one node, itself excluded, shadow roots not entered. */
export const descendants = (node: El): El[] =>
  node.children.flatMap((child) => [child, ...descendants(child)]);

/** A document, and the two readings the panel's tests take of one. */
export type Page = {
  documentElement: El;
  createElement(name: string): El;
  getElementById(id: string): El | null;
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
    createElement: (name) => new El(name),
    // A shadow boundary is exactly where `getElementById` stops, which is
    // both correct and the reason the toggle can use it: the host is in the
    // light tree, and everything the panel is made of is not.
    getElementById: (id) => light().find((node) => node.id === id) ?? null,
    light,
    shadow: (host) => {
      const root = host.attached?.root;
      return root === undefined ? [] : [root, ...descendants(root)];
    },
  };
}
