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
 * The shape a Capture has as these types describe it, which is the number a
 * reader keys forward-compatibility on.
 *
 * `packages/cli/src/in.ts` refuses a file carrying any other number, in either
 * direction: a lower one is a shape that build no longer reads, and a higher
 * one a shape it does not read yet. So this changes when the shape of a
 * Capture changes and at no other time — a release that alters what the
 * numbers say alters no field, and `version.producedBy` is what carries that.
 *
 * A literal rather than a figure read off a package: core names no import at
 * all, which is what lets the same functions run in Node, in a page and in a
 * service worker, and `test/no-globals.test.ts` holds that.
 */
export const CAPTURE_SCHEMA = 1;

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
  /**
   * What wrote this file, on two numbers that move on different clocks.
   *
   * `schema` is the shape, and `CAPTURE_SCHEMA` above says what a reader does
   * with it. `producedBy` is the release of `imgwhy` that wrote the file, and
   * it is what a diff of two Captures needs: a change to core's arithmetic
   * moves the figures in a Capture without moving one field of the shape, so a
   * difference between two files written by two releases can be this tool's
   * rather than the page's. `docs/adr/0002-capture-version-two-fields.md`
   * records why the two are not one field.
   *
   * Nested under one key so that a Capture written before either existed is
   * one check rather than two. Every Capture written before this field is that
   * case, and `in.ts` refuses one.
   *
   * The runner cannot fill `producedBy` in, because a library does not know
   * which release of the command shipped it: `CaptureOptions` requires it of
   * the caller, and `packages/cli/src/version.ts` is where the command reads it.
   */
  version: { schema: number; producedBy: string };
  devices: DeviceProfile[];
  runs: DeviceRun[];
};
