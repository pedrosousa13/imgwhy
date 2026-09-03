import type { RawImage, Reading } from '../src/read.js';

/**
 * A reading of a live page, built up field by field.
 *
 * The two builders exist for the reason `report/test/capture.ts` does: every
 * check here cares about two or three fields and a literal would write out
 * nine, so the fields that matter to a case are the fields a reader sees. The
 * defaults are deliberately boring — no `srcset`, nothing loaded, no
 * background painted — so a case that means something has to say so.
 *
 * The base URL is a real absolute one, because that is what a page has: every
 * candidate URL resolves against it, and `example.com` is what the design's
 * own worked example uses.
 */
export const image = (fields: Partial<RawImage> = {}): RawImage => ({
  selector: 'html > body > img',
  srcset: '',
  sizes: null,
  sizesSource: 'img',
  renderedWidth: 0,
  currentSrc: '',
  loading: null,
  baseURI: 'https://example.com/',
  ...fields,
});

/** The desktop of the design's default device set, which is DPR 1 at 1440. */
export const reading = (fields: Partial<Reading> = {}): Reading => ({
  viewport: { width: 1440, height: 900 },
  dpr: 1,
  images: [],
  backgroundImageCount: 0,
  ...fields,
});
