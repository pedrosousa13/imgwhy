/**
 * One function a module ships into a page as its own source.
 *
 * `source.ts` says what for, and every module's `PARTS` is a list of these.
 * The type is here rather than there because a module that exports a `PARTS`
 * already imports this file, and importing `source.ts` for a type would be a
 * cycle back through the module that reads every list.
 *
 * Not `Function`, which is TypeScript's weakest callable type: it stands for
 * anything callable at all and is assignable from a class constructor, so a
 * list typed with it says only "not a number". This says the two things
 * `coreSource()` actually needs — a `name` to declare the constant with, and a
 * call signature, so a value that is not a function cannot arrive.
 *
 * `never[]` parameters and an `unknown` return are what make every shape of
 * function assignable to it; nothing here ever calls a `Part`, it only reads
 * its name and its text.
 */
export type Part = { readonly name: string } & ((...args: never[]) => unknown);

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
   * Whether the page gives this element a width of its own.
   *
   * True where the element carries a `width` attribute, or a computed
   * `aspect-ratio` other than `auto`, or an inline width. Every one of those is
   * a declaration the page wrote, which is why this is not a measurement and
   * `no-estimate.test.ts` has nothing to say about it.
   *
   * It answers one question and only one: when `sizes` resolves to `auto`, is
   * the box the page's doing or the loaded file's? `explain.ts` says why that
   * matters and what it does with the answer.
   */
  declaresWidth: boolean;
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
  /**
   * How many elements this render painted a CSS background image on.
   *
   * On the run rather than on the Capture, because it is a property of a page
   * as one viewport rendered it: a media query can paint a background on one
   * device and not on the next, so a single figure for the whole capture would
   * be a figure no render produced.
   *
   * A count, and nothing else. A CSS background image has no selection
   * mechanism at all — no `srcset`, no `sizes`, nothing for a browser to choose
   * between — so there is no arithmetic to explain and none is attempted. That
   * is the design's non-goal: "Count them and say they have no selection
   * mechanism. Analyze nothing further."
   */
  backgroundImageCount: number;
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
