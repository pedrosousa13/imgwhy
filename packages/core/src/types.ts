/** One entry of a `srcset` attribute. */
export type Candidate = {
  url: string;
  /** Set for a `w` descriptor. */
  w: number | null;
  /** Set for an `x` descriptor, or 1 when absent. */
  x: number | null;
  /** The descriptor as written, for display. */
  raw: string;
};

/**
 * What a `sizes` attribute resolves to at one viewport width.
 *
 * `clause` always carries the text a trace should show: the clause that
 * matched, or the wording of the fallback that stood in for it.
 */
export type Resolution =
  /** A clause matched and gave a usable length. */
  | { kind: 'length'; px: number; clause: string; cond: string | null }
  /** A clause matched and asked for `auto`. Only layout can resolve it. */
  | { kind: 'auto'; clause: string; cond: string | null }
  /** No clause applied, so the 100vw default stood in. */
  | { kind: 'default'; px: number; clause: string }
  /** A clause applied but its length could not be read. */
  | { kind: 'error'; clause: string };

/** One device the runner renders the page as. */
export type DeviceProfile = {
  id: string;
  name: string;
  viewport: { width: number; height: number };
  dpr: number;
};

/** One image as it was found on the page during one device run. */
export type CapturedImage = {
  /** Stable across device runs, so the matrix can align rows. */
  id: string;
  selector: string;
  candidates: Candidate[];
  sizes: string | null;
  sizesSource: 'img' | 'source';
  renderedWidth: number;
  currentSrc: string;
  naturalWidth: number;
  /** Null where the transfer size is unknown. Never guessed. */
  transferBytes: number | null;
  loading: 'lazy' | 'eager' | null;
};

/** What one device profile saw. `deviceId` names a `DeviceProfile.id`. */
export type DeviceRun = {
  deviceId: string;
  images: CapturedImage[];
};

/**
 * The seam between the runner and the report. A Capture is JSON on disk: the
 * runner writes one, the report reads one, and neither knows about the other.
 */
export type Capture = {
  /**
   * The page that was measured, as it ended up: the URL after every redirect.
   * Every relative candidate URL resolves against it.
   */
  url: string;
  capturedAt: string;
  devices: DeviceProfile[];
  runs: DeviceRun[];
};
