import type { Candidate } from './types.js';

/**
 * Pick the candidate a browser would download.
 *
 * A `w` candidate's density is its width over the resolved `sizes` width; an
 * `x` candidate carries its density directly. The smallest density at or above
 * the device pixel ratio wins, and the largest stands in when none reaches it.
 */
export function selectCandidate(
  candidates: Candidate[],
  sizesPx: number | null,
  dpr: number,
): Candidate | null {
  const withDensity = candidates
    .map((c) => ({
      candidate: c,
      density: c.w != null ? (sizesPx ? c.w / sizesPx : null) : c.x,
    }))
    .filter((c): c is { candidate: Candidate; density: number } => c.density != null)
    .sort((a, b) => a.density - b.density);
  if (!withDensity.length) return null;
  const picked = withDensity.find((c) => c.density >= dpr) ?? withDensity[withDensity.length - 1];
  return picked.candidate;
}
