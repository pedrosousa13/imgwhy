/**
 * The reader, and the one function a click sends into the page first.
 *
 * Everything below is inside `readPage`, and that is a requirement rather than
 * a style. `chrome.scripting.executeScript` does not send the function: it
 * sends `String(func)` and the page evaluates that text. A constant declared
 * beside the function, a helper it called, an import it named are all gone by
 * the time the text runs, and every one of them is a `ReferenceError` in
 * someone's browser. `read.test.ts` runs the text in a context holding a
 * document, a viewport and a ratio, which is the only arrangement that can
 * catch it.
 *
 * That constraint is the whole reason this module exists as its own step.
 * `core` is a module, so a function that runs in the page cannot have it — and
 * the arithmetic is not something to reimplement here, because a reimplemented
 * join is a join that drifts. So the click is three steps: this reads the page
 * and returns plain data, the service worker asks `core` about that data with a
 * real `import`, and `renderPanel` is injected with the answers as `args`.
 * Nothing is stringified but the two functions that touch the DOM.
 *
 * `runner/src/collect.ts` does the same work under exactly the same
 * constraint, and this follows it closely on purpose. Two readers that
 * disagreed about which `<source>` a browser reads would be two tools that
 * disagree about the same page.
 */

/** One image as the page reported it, before core parses the `srcset`. */
export type RawImage = {
  selector: string;
  srcset: string;
  sizes: string | null;
  /**
   * Which element `sizes` was read off: the `<img>`, or the `<source>` of a
   * `<picture>` whose `media` matched.
   *
   * `source` with a null `sizes` is a real combination and says something: a
   * source matched and wrote no `sizes`, so the 100vw default applied and
   * whatever the `<img>` asked for played no part.
   */
  sizesSource: 'img' | 'source';
  renderedWidth: number;
  currentSrc: string;
  loading: 'lazy' | 'eager' | null;
  /**
   * The document base every candidate URL resolves against.
   *
   * Read off the element rather than out of `location`, which is the same
   * answer and a narrower reach: `baseURI` honours a `<base>` tag, and the
   * worker needs it to compare a relative candidate with an absolute
   * `currentSrc`. A panel that named `location` would be a panel holding the
   * page's address for no reason the arithmetic asked for.
   */
  baseURI: string;
};

/**
 * A live page as one click found it: the browser it is being looked at in, and
 * every image on it.
 *
 * Plain data, because it crosses a process boundary as JSON. Nothing here is
 * an element, and nothing here is a decision — the decisions are core's, and
 * core is in the worker.
 */
export type Reading = {
  viewport: { width: number; height: number };
  dpr: number;
  images: RawImage[];
  /**
   * How many elements this render painted a CSS background image on.
   *
   * A count, and nothing else. A CSS background image has no selection
   * mechanism at all — no `srcset`, no `sizes`, nothing for a browser to
   * choose between — so there is no arithmetic to explain and none is
   * attempted. That is the design's non-goal: "Count them and say they have no
   * selection mechanism. Analyze nothing further."
   */
  backgroundImageCount: number;
};

/**
 * Read the page, or take the panel away if it is already there.
 *
 * The state is the page. There is no flag anywhere in the extension saying
 * which tabs have a panel open, and there is nowhere to put one that is not
 * `chrome.storage` — which the design rules out:
 *
 * > The extension holds `activeTab` only. It stores no page data and sends
 * > nothing anywhere.
 *
 * Reading the page instead is not a workaround. It is the only answer that
 * cannot go stale: the page navigated, the panel went with it, and the next
 * click opens rather than trying to close something that is no longer there.
 *
 * Null is the closing click. The worker asks core nothing and injects nothing
 * further when it gets one, so a second click costs the page one function call
 * and a node removal.
 */
export function readPage(): Reading | null {
  // Underscored and prefixed, because it lands in the page's id namespace and
  // has to not collide with anything a site happens to have called its own.
  // Declared twice, here and in `panel.ts`, because neither copy can see the
  // other: a shared constant is exactly the kind of name that does not come
  // over with a stringified function.
  const HOST_ID = '__imgwhy_host__';

  const open = document.getElementById(HOST_ID);
  if (open !== null) {
    open.remove();
    return null;
  }

  /**
   * Where the image sat in this render, which is what a reader looks for when
   * they go to find it in the Elements panel.
   */
  const domPath = (element: Element): string => {
    const parts: string[] = [];
    let node: Element | null = element;
    while (node) {
      const current: Element = node;
      const parent: Element | null = current.parentElement;
      const twins = parent
        ? [...parent.children].filter((child) => child.tagName === current.tagName)
        : [];
      const tag = current.tagName.toLowerCase();
      parts.unshift(twins.length > 1 ? `${tag}:nth-of-type(${twins.indexOf(current) + 1})` : tag);
      node = parent;
    }
    return parts.join(' > ');
  };

  /**
   * The `srcset` and the `sizes` a `<picture>` actually put in front of the
   * browser, and which element each of them came off.
   *
   * A `<source>` applies when its `media` matches, and the first one that does
   * wins — document order, the way a browser reads them. A source with no
   * `media` at all always applies, which is why the loop stops at the first
   * match rather than preferring a later one.
   *
   * The walk is over the `<picture>`'s own children and it stops at the
   * `<img>`, because that is where a browser's stops. A source written after
   * the tag is in the DOM and a query for every source in the element finds
   * it, and no browser ever reads it — so the identity check against the tag
   * is what keeps this from resolving against markup nothing rendered.
   *
   * One element answers for both, which is what `sizesSource` records. Where a
   * source matched, its own `srcset` and its own `sizes` are what the browser
   * read, and the `sizes` on the `<img>` played no part at all — including
   * where the source wrote none, which leaves the 100vw default rather than
   * falling back to the tag. That is a deliberate divergence from the
   * reference `activeSrcset` in `imgwhy.js`, and it is the divergence with a
   * measurement behind it: on the runner's `/picture-sources.html` at 1440, a
   * source offering 200w and 300w under an `<img sizes="120px">` loads the
   * 300w file, and 120px predicts the 200w one. The reference cannot see that,
   * because it runs in the page with no recorded transfer to disagree with.
   *
   * `type` is not read here, and no format support is asked about. That is the
   * design's non-goal — "`<picture>` type negotiation. Evaluate `media` only.
   * Do not model AVIF against WebP support" — and it is checked rather than
   * left to a reader, in `non-goals.test.ts`.
   */
  const active = (
    img: HTMLImageElement,
  ): { srcset: string; sizes: string | null; sizesSource: 'img' | 'source' } => {
    const picture = img.closest('picture');
    if (picture) {
      for (const child of [...picture.children]) {
        if (child === img) break;
        if (child.tagName.toLowerCase() !== 'source') continue;
        const source = child as HTMLSourceElement;
        if (source.media && !matchMedia(source.media).matches) continue;
        if (!source.srcset) continue;
        return { srcset: source.srcset, sizes: source.sizes || null, sizesSource: 'source' };
      }
    }

    return { srcset: img.srcset, sizes: img.sizes || null, sizesSource: 'img' };
  };

  // Every `<img>` this collection holds, with nothing filtered out. A 1×1
  // tracking pixel and an image the page never shows are both bytes the browser
  // went and got, and dropping a row here would put it beyond anything
  // downstream can reach. The reference filtered by rendered size; the runner
  // does not, and deciding which images are worth a reader's attention belongs
  // to whatever displays a reading rather than to the thing that takes it.
  //
  // What the collection holds is the light tree, and that is a limit rather
  // than a filter. `document.images` does not enter a shadow root, so an
  // `<img>` a web component renders inside one is an image no row here
  // mentions — a page built that way gets a panel that is short and says
  // nothing about why. Closing it means walking every open `shadowRoot` on the
  // page and accepting that a closed one will never be walked at all, which is
  // a reader this slice did not ask for. Written down because a reader looking
  // at an empty panel on a page full of images should not have to find this
  // out from the source.
  const images = [...document.images].map((img): RawImage => {
    const loading = img.getAttribute('loading');
    const offered = active(img);
    return {
      selector: domPath(img),
      srcset: offered.srcset,
      sizes: offered.sizes,
      sizesSource: offered.sizesSource,
      renderedWidth: img.getBoundingClientRect().width || img.width || 0,
      currentSrc: img.currentSrc || img.src,
      loading: loading === 'lazy' ? 'lazy' : loading === 'eager' ? 'eager' : null,
      baseURI: img.baseURI,
    };
  });

  // A gradient is painted the same way as a file and is not one, so the token
  // separates them. `url` rather than `url(` because the whole of this package
  // is read against a list of the shapes a destination takes as text, and a
  // string carrying `url(` is one of them — that is how a stylesheet loads
  // something, and the panel ships a stylesheet. Looser here costs nothing and
  // catches one more form: `image-set(url(…))` carries the token too.
  const backgroundImageCount = [...document.querySelectorAll('*')].filter((element) => {
    const painted = getComputedStyle(element).backgroundImage;
    return painted !== 'none' && painted.includes('url');
  }).length;

  return {
    viewport: { width: innerWidth, height: innerHeight },
    dpr: devicePixelRatio,
    images,
    backgroundImageCount,
  };
}
