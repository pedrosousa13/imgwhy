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

  // Every `<img>`, with nothing filtered out. A 1×1 tracking pixel and an
  // image the page never shows are both bytes the browser went and got, and
  // the runner is the measurement layer: dropping a row here would put it
  // beyond anything downstream can reach. Deciding which images are worth a
  // reader's attention belongs to whatever displays a Capture.
  return Array.from(document.images).map((img): RawImage => {
    const loading = img.getAttribute('loading');
    return {
      selector: domPath(img),
      srcset: img.srcset,
      sizes: img.sizes || null,
      // The `<img>` is the only source this slice reads. Issue #5 resolves a
      // `<picture>` to the `<source>` whose `media` matched.
      sizesSource: 'img',
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
