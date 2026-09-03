import type { Candidate, CapturedImage, DeviceProfile, Part, Resolution } from './types.js';
import { selectCandidate } from './select.js';
import { resolveSizes } from './sizes.js';

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

  const resolution = resolveSizes(image.sizes, device.viewport.width);
  const cssPx = resolvedPx(resolution, image.renderedWidth);
  const picked = selectCandidate(image.candidates, cssPx, device.dpr);

  if (cssPx === null) return { kind: 'unreadable', resolution, picked };
  return { kind: 'width', resolution, cssPx, neededPx: cssPx * device.dpr, picked };
}

/** Every function this module is made of. `srcset.ts` says what for. */
export const PARTS: readonly Part[] = [resolvedPx, explainSelection];
