import type { Part } from './types.js';
import { PARTS as EXPLAIN } from './explain.js';
import { PARTS as SELECT } from './select.js';
import { PARTS as SRCSET } from './srcset.js';
import { PARTS as SIZES } from './sizes.js';

/**
 * Every function core is made of, in the order a script declares them.
 *
 * Order is presentation rather than necessity: each declaration is a `const`,
 * and none of them calls another until a caller does, by which time all of
 * them are bound. Reading order is the algorithm's own — parse, select,
 * resolve, then the joins between them.
 */
const PARTS: readonly Part[] = [...SRCSET, ...SELECT, ...SIZES, ...EXPLAIN];

/**
 * Core, as JavaScript a page can run.
 *
 * The design asks the report for a counterfactual that cannot disagree with a
 * measurement: "A measured result and a hypothetical result use the same call."
 * A report is one file with no server behind it, so the same call has to be
 * *in* the file — and the honest way to put it there is to hand over the
 * functions themselves rather than a copy of them.
 *
 * That is what this is. `Function.prototype.toString` returns the source of
 * the function it is called on, so the text below is read out of the very
 * function objects the command line calls a moment later. There is no second
 * copy of the algorithm to keep in step, and nothing to regenerate: a reader
 * checking that a report ships the real core compares the file against
 * `String(explainSelection)`, and `source.test.ts` does exactly that.
 *
 * ## What this asks of core
 *
 * A function shipped this way arrives with none of its module around it, so it
 * can only reach the other functions shipped beside it. `PARTS` is what makes
 * that true — every module lists the functions it is made of, all of them come
 * over together, and each becomes a `const` of the same name in the page.
 *
 * A helper added to a module and left out of its list is the failure to watch
 * for, and it would show as a `ReferenceError` in someone's browser rather
 * than here. Three checks in `source.test.ts` stand between it and a reader,
 * and none covers another's ground:
 *
 * - It reads every top-level binding every core module declares — whatever
 *   keyword or shape it was written with — and refuses any name the string
 *   below does not declare. Two names are left out of that comparison:
 *   `PARTS`, which is how the shipping happens rather than a thing shipped,
 *   and `CAPTURE_SCHEMA`, the shape number of a file on disk. So the rule it
 *   enforces is that a core module's top level may hold functions, its own
 *   `PARTS`, and a constant no shipped function reads.
 * - It reads the string below for both exempted names, and every core module's
 *   imports for either under any alias. That is what holds the last clause of
 *   the rule to its word: a constant is allowed up there because nothing ships
 *   it, and these fail if anything shipped names it — directly, or aliased,
 *   which an import binds without declaring and the comparison above cannot
 *   see.
 * - It runs the whole of this in a context with no globals and compares every
 *   branch against the imported functions. That is the only instrument for a
 *   name no core module declares at all — something reached through a global
 *   that Node has and a page does not — and it reaches a branch only if the
 *   `CASES` table there covers it.
 *
 * This adds nothing to core's dependencies. `Function.prototype.toString` and
 * `Array.prototype.join` are language, not host: the string below is built the
 * same way in Node, in a page and in a service worker.
 */
export const coreSource = (): string =>
  PARTS.map((part) => `const ${part.name} = ${String(part)};`).join('\n');
