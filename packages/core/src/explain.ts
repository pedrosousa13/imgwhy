import type { Candidate, CapturedImage, DeviceProfile, Part, Resolution } from './types.js';
import { selectCandidate } from './select.js';
import { allowsAutoSizes, resolveSizes } from './sizes.js';

/**
 * What one device decided about one image, in the order the arithmetic runs.
 *
 * A union rather than four independently nullable fields, and for the reason
 * `Resolution` is one: the three answers below are the only three, and every
 * other combination of those fields is a state nothing can produce. Written as
 * nullable fields, a reader had to know that a null resolution meant the other
 * three were null too — an invariant nothing stated, which the one consumer
 * paid for by asking about it twice. A reader asks `kind` once instead.
 *
 * Every field is exact. Rounding is presentation, so it belongs to whatever is
 * doing the presenting.
 */
export type Selection =
  /**
   * No candidate carries a `w` descriptor, so the ratio decided alone. A
   * browser reads past `sizes` here however the tag was written, which is why
   * there is no resolution to report rather than an empty one.
   */
  | { kind: 'density'; picked: Candidate | null }
  /** `sizes` resolved to a width, and selection ran against it. */
  | {
      kind: 'width';
      resolution: Resolution;
      /**
       * Where the CSS width came from, which is what says whether a row's own
       * agreement is worth anything.
       *
       * A `sizes` clause is a figure the page wrote and the file had no part
       * in. The other three are all layout answering an `auto`, and they are
       * three different things:
       *
       * - `layout-declared` — the page declares a width for the element, so
       *   the box is the page's doing however the file turned out.
       * - `layout-independent` — the box is not the width the file reports, so
       *   the file cannot have sized it. Something else did.
       * - `layout-intrinsic` — nothing above holds. The box may be the width of
       *   the file that loaded, and a pick that agrees with that file may be
       *   agreeing with itself.
       *
       * Only the last is a width to distrust, and naming the other two is the
       * whole point: `auto` alone used to stand for all three, which put the
       * quietest verdict the panel has on rows that were plainly fine.
       */
      widthFrom: 'sizes' | 'layout-declared' | 'layout-independent' | 'layout-intrinsic';
      /** The CSS width selection ran against. */
      cssPx: number;
      /** Physical pixels the device needed: `cssPx` times the ratio. */
      neededPx: number;
      /** The candidate a browser downloads, or null where none could win. */
      picked: Candidate | null;
    }
  /**
   * A clause applied and its length could not be read, which is the one case
   * selection has no width to run against. `resolution.clause` still names the
   * clause at fault, and an `x` candidate on the same tag can still win.
   */
  | { kind: 'unreadable'; resolution: Resolution; picked: Candidate | null };

/**
 * Where the width came from, for the one resolution that has a question to
 * answer.
 *
 * `auto` defers to layout, and layout is where a file can get its own opinion
 * into the figure that judges it: an element the page gives no width to is as
 * wide as the picture inside it, so a pick made against that width agrees with
 * the loaded file because the loaded file wrote it.
 *
 * Two readings rule that out, and both are the page's own facts rather than
 * anything measured here.
 *
 * `declaresWidth` is a width the page wrote — an attribute, an aspect ratio, or
 * an inline style. A box built from one of those is the page's answer and not
 * the file's.
 *
 * The comparison is the other. `naturalWidth` is already in CSS pixels — the
 * browser divides the decoded file by the density it picked it at — so an
 * element the page never sized is exactly as wide as `naturalWidth` reports.
 * A box that is any other width was sized by something else, and the file
 * cannot have written it.
 *
 * The pixel of slack is what makes that comparison safe on a real layout,
 * where a box arrives as a fraction. A box within a pixel of the file's width
 * is read as the file's. A subtraction rather than a rounding, because core
 * runs in a context with no globals and `Math` is one of them —
 * `no-globals.test.ts` is what says so.
 *
 * A file that loaded nothing has no pixels to compare, so a `naturalWidth` of
 * zero falls through to the honest answer.
 */
const widthSource = (
  resolution: Resolution,
  image: CapturedImage,
): 'sizes' | 'layout-declared' | 'layout-independent' | 'layout-intrinsic' => {
  if (resolution.kind !== 'auto') return 'sizes';
  if (image.declaresWidth) return 'layout-declared';
  const off = image.renderedWidth - image.naturalWidth;
  if (image.naturalWidth > 0 && (off >= 1 || off <= -1)) return 'layout-independent';
  return 'layout-intrinsic';
};

/**
 * The CSS width selection ran against.
 *
 * Null where nothing resolved, which is the one case selection cannot run at
 * all. `auto` defers to layout, so the width the element ended up at is the
 * honest answer there.
 */
const resolvedPx = (resolution: Resolution, renderedWidth: number): number | null => {
  switch (resolution.kind) {
    case 'auto':
      return renderedWidth;
    case 'error':
      return null;
    default:
      return resolution.px;
  }
};

/**
 * The three questions asked in the one order that answers them, for one image
 * as one device saw it.
 *
 * This is here rather than in each front end for the reason `core` exists at
 * all: the command line, the report and the extension all ask this, and a
 * measured answer and a hypothetical answer have to be the same call or they
 * can disagree. `parseSrcset`, `resolveSizes` and `selectCandidate` are the
 * algorithm; this is the two joins between them, and a join reimplemented
 * twice is a join that drifts.
 *
 * Both joins are decisions a caller would otherwise have to make alone:
 *
 * - `sizes` is consulted only where a `w` descriptor makes it relevant. A page
 *   may write `sizes` on a densities-only `srcset`, and a browser ignores it.
 * - `auto` defers to layout, and layout is the one thing a Capture already
 *   measured, so the width the element ended up at is the honest answer there.
 */
export function explainSelection(image: CapturedImage, device: DeviceProfile): Selection {
  const byWidth = image.candidates.some((candidate) => candidate.w != null);
  if (!byWidth) {
    return { kind: 'density', picked: selectCandidate(image.candidates, null, device.dpr) };
  }

  const resolution = resolveSizes(
    image.sizes,
    device.viewport.width,
    allowsAutoSizes(image.sizes, image.loading),
  );
  const cssPx = resolvedPx(resolution, image.renderedWidth);
  const picked = selectCandidate(image.candidates, cssPx, device.dpr);

  if (cssPx === null) return { kind: 'unreadable', resolution, picked };
  return {
    kind: 'width',
    resolution,
    widthFrom: widthSource(resolution, image),
    cssPx,
    neededPx: cssPx * device.dpr,
    picked,
  };
}

/** Every function this module is made of. `srcset.ts` says what for. */
export const PARTS: readonly Part[] = [widthSource, resolvedPx, explainSelection];
