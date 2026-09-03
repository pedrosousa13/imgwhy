/** One image as the page reported it, before core parses the `srcset`. */
export type RawImage = {
  selector: string;
  srcset: string;
  sizes: string | null;
  sizesSource: 'img' | 'source';
  renderedWidth: number;
  currentSrc: string;
  naturalWidth: number;
  loading: 'lazy' | 'eager' | null;
};

/**
 * Runs inside the page.
 *
 * Playwright sends this function to the browser as source, so it may not
 * reference anything outside itself — including core. Parsing stays in Node.
 */
export function collectImages(): RawImage[] {
  /**
   * Where the image sat in this render. Usually the same string every render,
   * which is why it is where an id starts; `alignImageIds` handles the renders
   * where a responsive layout moved the element.
   */
  const domPath = (element: Element): string => {
    const parts: string[] = [];
    let node: Element | null = element;
    while (node) {
      const current: Element = node;
      const parent: Element | null = current.parentElement;
      const twins = parent
        ? Array.from(parent.children).filter((child) => child.tagName === current.tagName)
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
   * falling back to the tag.
   *
   * That last part is a deliberate divergence from the reference `activeSrcset`
   * in `imgwhy.js`, which falls back to `img.sizes`. A browser does not: the
   * HTML source set is built from the matching source's `sizes` attribute
   * alone. The divergence is measurable, which is why it is not a judgement
   * call — on `/picture-sources.html` at 1440, a `<source>` offering 200w and
   * 300w under an `<img sizes="120px">` loads the 300w file, and 120px predicts
   * the 200w one. The reference could not see that; it runs inside the page and
   * has no recorded transfer to disagree with.
   *
   * `type` is not read here, and no format support is asked about. That is the
   * design's non-goal — "`<picture>` type negotiation. Evaluate `media` only.
   * Do not model AVIF against WebP support" — and it is checked rather than
   * left to a reader, in `no-type-negotiation.test.ts`.
   */
  const active = (
    img: HTMLImageElement,
  ): { srcset: string; sizes: string | null; sizesSource: 'img' | 'source' } => {
    const picture = img.closest('picture');
    if (picture) {
      for (const child of Array.from(picture.children)) {
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

  // Every `<img>`, with nothing filtered out. A 1×1 tracking pixel and an
  // image the page never shows are both bytes the browser went and got, and
  // the runner is the measurement layer: dropping a row here would put it
  // beyond anything downstream can reach. Deciding which images are worth a
  // reader's attention belongs to whatever displays a Capture.
  return Array.from(document.images).map((img): RawImage => {
    const loading = img.getAttribute('loading');
    const { srcset, sizes, sizesSource } = active(img);
    return {
      selector: domPath(img),
      srcset,
      sizes,
      sizesSource,
      renderedWidth: img.getBoundingClientRect().width || img.width || 0,
      currentSrc: img.currentSrc || img.src,
      // The intrinsic width in CSS pixels. The browser has already divided
      // the decoded file by the density it picked it at, so a 1080 pixel
      // file chosen at 1.6875 reports 640.
      naturalWidth: img.naturalWidth,
      loading: loading === 'lazy' ? 'lazy' : loading === 'eager' ? 'eager' : null,
    };
  });
}

/**
 * How many elements this render painted a CSS background image on.
 *
 * Runs inside the page, and keeps the same rule `collectImages` does: it may
 * reference nothing outside itself.
 *
 * A count and no more, which is the whole of what the design asks for. A CSS
 * background image reaches the browser as a URL in a stylesheet, with no
 * `srcset` beside it and no `sizes` to resolve — there is nothing to select
 * between, so there is no arithmetic to show. Saying how many there are is
 * what stops a reader taking a trace of every `<img>` on a page for a trace of
 * every image on it.
 *
 * A gradient is painted the same way and is not a file, so `url(` is what
 * separates them. The computed value is read, rather than the rule as written,
 * because that is the one that says what this viewport actually painted.
 */
export function countBackgroundImages(): number {
  return Array.from(document.querySelectorAll('*')).filter((element) => {
    const painted = getComputedStyle(element).backgroundImage;
    return painted !== 'none' && painted.includes('url(');
  }).length;
}
