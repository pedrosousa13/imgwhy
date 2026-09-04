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
  /**
   * Where this image sat in `document.images`, which is the panel's handle
   * back to the element.
   *
   * A number rather than the selector below, and the choice is deliberate. The
   * panel has to point at an element to mark it, and it has two ways to find
   * one: run the DOM path back through `querySelector`, or index the same
   * collection this walk indexed. The path is the weaker of the two — it is
   * built out of tag names and `nth-of-type` positions, so a page that
   * re-orders siblings between the read and the hover resolves it to a
   * different element with no error anywhere, and a path is also a string this
   * package would then have to hand to a selector engine, which is a parse of
   * page content. An index is one number, minted by the walk that read the
   * element, and `document.images` is the same live collection in both
   * functions.
   *
   * What it costs is a page that mutates. An `<img>` inserted or removed
   * between the read and the hover shifts the collection, so the index can
   * resolve to the neighbour of the row a reader pointed at — and an
   * infinite-scroll page that lazy-inserts one image above the fold shifts
   * every row on the panel at once.
   *
   * So the index is the fast path and `currentSrc` below is what confirms it.
   * `renderPanel` marks an element only where the file that element loaded is
   * the file this reading recorded for the row, looks for that file across the
   * collection where the index misses, and says `not found` on the row where
   * it cannot settle which element is meant. An earlier version of this
   * comment rejected exactly that check, on the argument that a lazy image
   * which finished loading in between would fail it while the handle was
   * right; what that argument missed is that such a row is describing a file
   * that has since arrived, so its verdict, its thumbnail and its sentence are
   * all about something else, and saying so is more use than a box drawn
   * confidently over the wrong image.
   */
  at: number;
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
  /**
   * The other half of the box this render laid the image out at.
   *
   * The arithmetic has no use for it — `explainSelection` reads a width and
   * never a height — and it is read anyway, because a reader recognising an
   * image on a page recognises a shape. A row that says `1200×80` is a banner
   * and one that says `24×24` is an icon, and neither is a thing a DOM path
   * tells you.
   *
   * A laid-out height is not the dimension `non-goals.test.ts` refuses. What
   * that check refuses is a guessed weight — pixels in a file, times pixels in
   * a file, times a bytes-per-pixel figure someone invented — and this is a CSS
   * box, which says how large the page drew the image and nothing about what
   * arrived. The package performs no multiplication anywhere either, which
   * `through-core.test.ts` holds, so there is no arithmetic here for a
   * dimension to feed.
   */
  renderedHeight: number;
  /**
   * The width of the file the browser decoded, in CSS pixels, or zero where it
   * has decoded none.
   *
   * This field was refused for a while, and the refusal was right for what it
   * was aimed at: `naturalWidth` is the first ingredient of a guessed byte
   * weight, and a panel that guesses weights is a panel that invents the one
   * figure a reader most wants to trust. `non-goals.test.ts` refuses the guess,
   * and it still does — nothing here multiplies, and a weight is still only
   * ever the recorded transfer or the word `unknown`.
   *
   * What the field is for instead is one comparison, made in `core`, and the
   * comparison decides whether a row may be judged at all. The browser reports
   * an intrinsic width already divided by the density it picked the file at, so
   * an element the page never sized is exactly as wide as this number. A box of
   * any other width was sized by something other than the file — which is what
   * frees the row from `can't tell`, the verdict that had swallowed 15 rows of
   * 23 on an ordinary page.
   *
   * A number the page can see anyway. `naturalWidth` is a DOM property of the
   * page's own image, readable by the page's own scripts, and this reads it and
   * sends it nowhere.
   */
  naturalWidth: number;
  /**
   * Whether the page gives this element a width of its own.
   *
   * A declaration the page wrote, not a figure this took. `core` reads it for
   * the same question `naturalWidth` answers from the other side: when `sizes`
   * resolves to `auto`, was the box the page's doing or the loaded file's?
   */
  declaresWidth: boolean;
  /**
   * The `alt` attribute as the page wrote it, or null where it wrote none.
   *
   * Three states rather than two, and the third is the reason this is not a
   * plain string. An absent attribute is a page that said nothing about the
   * image; `alt=""` is a page that said the image carries no meaning of its
   * own, which is a deliberate and different statement. A reader looking for
   * an accessibility problem needs the two apart, and `img.alt` collapses them
   * — it reads `''` for both — so the attribute is read instead.
   */
  alt: string | null;
  /**
   * The `src` attribute as the page wrote it, or the empty string where it
   * wrote none.
   *
   * Read as well as `currentSrc` below, because the two answer different
   * questions and the panel needs both. `currentSrc` is the file that loaded.
   * This is a *candidate*: HTML's select-an-image-source appends the `src` to
   * the source set when no candidate carries a `w` descriptor and none is
   * already 1x, so on a densities-only `srcset` the ratio decides between the
   * `src` and whatever else is offered. A panel that read only the loaded file
   * told such a row that its device made no difference, which is false at every
   * ratio.
   *
   * The attribute rather than the `src` property, and the difference is the
   * whole of what makes this readable. The property reflects a *resolved* URL,
   * so an absent attribute and an attribute set to the empty string both come
   * back as something: absent reads `''`, and empty resolves against the
   * document and reads the page's own address. The attribute has the three
   * states the spec's condition is written against, and `getAttribute` is what
   * reports them.
   *
   * Not named `src`. `privacy.test.ts` holds that anything given to a `src`
   * arrived whole and unmodified through the reading, and it holds it on the
   * name — a field called `src` here would ask that rule to widen for a value
   * that is not a request at all. This is the text of an attribute; the one
   * value that ever becomes a request is `row.file`, and it still comes from
   * `currentSrc` alone.
   */
  srcAttribute: string;
  /**
   * The file the browser loaded, and the empty string where it has loaded
   * none.
   *
   * `currentSrc` alone, with no fallback to the `src` property behind it, and
   * that is the fix for a defect rather than a preference. The two facts are
   * different facts: `currentSrc` is empty until the browser has selected a
   * source and begun fetching it, while the property reflects the attribute
   * resolved against the document and is something the moment a `src` exists.
   * So an image below the fold that has requested nothing — the ordinary lazy
   * image, `complete: false`, `naturalWidth: 0`, no request in the network
   * panel — arrived here as though it had loaded, and three separate claims
   * were then made about a file the browser did not hold: the verdict read
   * `fit`, which says the browser chose this file and chose well when it chose
   * nothing; the `cache` mark went on a figure whose whole meaning is what the
   * browser has; and the panel pointed a thumbnail at the URL, which provokes
   * the download the page had declined to make, once per row on a page of lazy
   * images.
   *
   * That last one is why this field is the narrow one. The thumbnail's request
   * is allowed on the argument that it asks for "a URL the page has already
   * requested, from a host it has already contacted, so nothing reaches
   * anywhere it had not already reached" — and for a file nothing has requested
   * that argument is simply false. Empty is what keeps it true: `explain.ts`
   * reads `currentSrc !== ''` as the whole of whether there is a file to speak
   * about, and a row with none gets no `loaded` line, no mark, no thumbnail and
   * the `not loaded` verdict that was written for exactly it.
   *
   * What the page asked for is still here, under `srcAttribute` above, and the
   * candidate work is what reads it. Neither field stands in for the other.
   */
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
 * further when it gets one, so a second click costs the page one function
 * call, one event nothing but the panel listens for, and a node removal.
 */
export function readPage(): Reading | null {
  // Underscored and prefixed, because it lands in the page's id namespace and
  // has to not collide with anything a site happens to have called its own.
  // Declared twice, here and in `panel.ts`, because neither copy can see the
  // other: a shared constant is exactly the kind of name that does not come
  // over with a stringified function.
  const HOST_ID = '__imgwhy_host__';

  /**
   * What the panel is told before it goes.
   *
   * The panel keeps a mark on the image a row is about, and a box in viewport
   * coordinates has to be redrawn when the viewport moves — so while a mark is
   * up the panel holds a `scroll` and a `resize` listener on the window, and
   * the window is the one thing in the arrangement that removing the host does
   * not take with it. A page closed with the pointer still on a row would
   * otherwise leave a handler holding a shadow tree that is in no document.
   *
   * So the closing click says so out loud, and the panel's own handler takes
   * the listeners down. Declared twice, here and in `panel.ts`, for the same
   * reason `HOST_ID` is: neither copy can see the other.
   */
  const CLOSING = '__imgwhy_closing__';

  const open = document.getElementById(HOST_ID);
  if (open !== null) {
    window.dispatchEvent(new Event(CLOSING));
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
   *
   * This function is written twice. The other copy is `active` in the command
   * line's `collect.ts`, and `test/no-drift.test.ts` refuses any difference
   * between the two — a change here that is not made there is the two front
   * ends naming different files as the one a browser read.
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

  /**
   * Whether the page gives this element a width of its own.
   *
   * Three declarations, and every one of them is something the page wrote
   * rather than something this measured. A `width` attribute is a width. An
   * inline `width` is a width. A computed `aspect-ratio` other than `auto` ties
   * one dimension to the other, which is the page deciding the box as surely as
   * a length does — and Chrome reports the attributes as `auto 3 / 2` there, so
   * this read covers the first case a second time rather than missing it.
   *
   * `core` asks for one thing only: when `sizes` resolves to `auto`, was the
   * box the page's doing or the loaded file's? A declared width settles it,
   * because a box built from a declaration is the same box whichever file
   * arrived.
   *
   * What it does not reach is a width set from a stylesheet with no attribute,
   * no inline style and no ratio. The cascade is not read here, so that page
   * keeps the verdict it had before.
   *
   * This function is written twice. The other copy is `declaresWidth` in the
   * command line's `collect.ts`, and `test/no-drift.test.ts` refuses any
   * difference between the two.
   */
  const declaresWidth = (img: HTMLImageElement): boolean => {
    if (img.getAttribute('width') !== null) return true;
    if (img.style.width !== '') return true;
    return getComputedStyle(img).aspectRatio !== 'auto';
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
  const images = [...document.images].map((img, at): RawImage => {
    const loading = img.getAttribute('loading');
    const offered = active(img);
    // One reading of the box rather than two, because two are two layouts: a
    // rect is measured when it is asked for, and a page that moves between the
    // two calls answers a width from one frame and a height from another.
    const box = img.getBoundingClientRect();
    return {
      // The index into the collection this walk is over, which is the panel's
      // handle back to this element. Nothing is filtered out of the walk, so
      // the row's position and the element's position are the same number, and
      // the field says so rather than leaving the panel to infer it from an
      // array index two modules away.
      at,
      selector: domPath(img),
      srcset: offered.srcset,
      sizes: offered.sizes,
      sizesSource: offered.sizesSource,
      renderedWidth: box.width || img.width || 0,
      renderedHeight: box.height || img.height || 0,
      naturalWidth: img.naturalWidth,
      declaresWidth: declaresWidth(img),
      alt: img.getAttribute('alt'),
      // The attribute and not the property, because the property reflects a
      // resolved URL and resolves an empty one against the document — so an
      // `<img>` that was never given a `src` and one given an empty one are
      // one value there and two findings here.
      srcAttribute: img.getAttribute('src') ?? '',
      // The file the browser loaded, and nothing standing in for it. Empty is
      // the answer for an image that has requested nothing, and the field above
      // is where "what the page asked for" lives.
      currentSrc: img.currentSrc,
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
