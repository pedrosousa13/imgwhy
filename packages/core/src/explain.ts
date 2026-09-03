import type { Candidate, CapturedImage, DeviceProfile, Resolution } from './types.js';
import { selectCandidate } from './select.js';
import { resolveSizes } from './sizes.js';

/**
 * What one device decided about one image, in the order the arithmetic runs.
 *
 * Every field is exact. Rounding is presentation, so it belongs to whatever is
 * doing the presenting.
 */
export type Selection = {
  /**
   * What `sizes` resolved to, or null where no candidate carries a `w`
   * descriptor — a browser reads past `sizes` there, however the tag was
   * written, so there is no resolution to report rather than an empty one.
   */
  resolution: Resolution | null;
  /**
   * The CSS width selection ran against, or null where nothing resolved,
   * which is the one case selection cannot run at all.
   */
  cssPx: number | null;
  /** Physical pixels the device needed: `cssPx` times the ratio. */
  neededPx: number | null;
  /** The candidate a browser downloads, or null where none could win. */
  picked: Candidate | null;
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
    return {
      resolution: null,
      cssPx: null,
      neededPx: null,
      picked: selectCandidate(image.candidates, null, device.dpr),
    };
  }

  const resolution = resolveSizes(image.sizes, device.viewport.width);
  const cssPx =
    resolution.kind === 'auto'
      ? image.renderedWidth
      : resolution.kind === 'error'
        ? null
        : resolution.px;

  return {
    resolution,
    cssPx,
    neededPx: cssPx === null ? null : cssPx * device.dpr,
    picked: selectCandidate(image.candidates, cssPx, device.dpr),
  };
}
