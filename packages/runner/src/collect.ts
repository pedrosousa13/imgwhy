/** One image as the page reported it, before core parses the `srcset`. */
export type RawImage = {
  id: string;
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
  /** The DOM path doubles as the id, because it survives a second render. */
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

  return Array.from(document.images)
    .filter((img) => img.getBoundingClientRect().width > 8 || img.naturalWidth > 8)
    .map((img): RawImage => {
      const path = domPath(img);
      const loading = img.getAttribute('loading');
      return {
        id: path,
        selector: path,
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
