import type { Part, Resolution } from './types.js';

type Length = { auto: true } | { px: number };

const toPx = (n: number, u: string, vw: number): number =>
  u === 'vw' ? (n / 100) * vw : u === 'em' || u === 'rem' ? n * 16 : n;

/** Split on commas that sit outside parentheses, so `calc()` stays whole. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * Evaluate a media condition. Only `min-width`, `max-width` and `and`.
 *
 * Collapse the whitespace, then cut on a literal, rather than splitting on
 * `\s+and\s+` — which at every position inside a run of spaces swallowed the
 * rest of the run, found no `and` behind it, and gave the run back a space at a
 * time.
 *
 * Collapsing is also what holds the verdict, where trimming each part would
 * not. `\s+and\s+` ate the whitespace on both sides of the word, so a second
 * `and` written straight after the first stayed glued to the part behind it and
 * the unanchored read below still found the condition there. ` and ` cuts in
 * the same places for the same reason: it eats the space the second `and` would
 * otherwise be cut on. Cutting on the word alone hands `every` a part with no
 * condition in it, and reads a condition a browser calls true as false.
 * `sizes.test.ts` pins both the verdict and the timing.
 */
function evalCond(cond: string, vw: number): boolean {
  return cond
    .replace(/\s+/g, ' ')
    .split(/ and /i)
    .every((p) => {
      const m = p.match(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)?\s*\)/i);
      if (!m) return false;
      const v = toPx(parseFloat(m[2]), (m[3] || 'px').toLowerCase(), vw);
      return m[1].toLowerCase() === 'max' ? vw <= v : vw >= v;
    });
}

/**
 * Read a length: a sign, a number, a unit, summed across a `calc()`.
 *
 * The unit is optional here, where `[+-]?\s*[\d.]+(?:vw|px|em|rem)` asked for
 * the whole token and failed without one. Same grammar, and the failure is the
 * difference: `[\d.]+` read a run of digits to its end before the unit could
 * fail, and `/g` then began again one character along and read the same run
 * over, so n digits cost n².
 *
 * The claim to make about `\s*` is narrower than that it cannot backtrack,
 * because `[\d.]+` is behind it and on `-   x` it does give the spaces back one
 * at a time. What bounds it is which positions pay: only one holding a sign,
 * once each, in proportion to the run behind that sign — and a run of
 * whitespace follows at most one sign. So the cost is the string's length
 * rather than its square.
 *
 * `sizes.test.ts` says why that length is the page's to pick, and pins it.
 */
function evalLen(str: string, vw: number): Length | null {
  const s = str.trim();
  if (/^auto$/i.test(s)) return { auto: true };
  const calc = s.match(/^calc\(([\s\S]*)\)$/i);
  let t = 0;
  let read = false;
  for (const { groups } of (calc ? calc[1] : s).matchAll(
    /(?:(?<sign>[+-])\s*)?(?<num>[\d.]+)(?<unit>vw|px|em|rem)?/gi,
  )) {
    // A number no unit completed is not a length, and skipping it here is the
    // clause the earlier shape wrote as a failed match. It is also what makes
    // the read below safe: an optional group that took no part is `undefined`
    // at run time, whatever a match's index type says, so the two have to stay
    // together.
    if (!groups?.unit) continue;
    const px = toPx(parseFloat(groups.num), groups.unit.toLowerCase(), vw);
    t += groups.sign === '-' ? -px : px;
    read = true;
  }
  return read ? { px: t } : null;
}

const asResolution = (len: Length, clause: string, cond: string | null): Resolution =>
  'auto' in len ? { kind: 'auto', clause, cond } : { kind: 'length', px: len.px, clause, cond };

/**
 * Whether the browser reads `auto` as a width at all.
 *
 * The standard's own condition, and both halves of it are load-bearing. An
 * `img` allows auto-sizes when "its `loading` attribute is in the Lazy state,
 * and its `sizes` attribute's value is `auto` … or starts with `auto,`".
 * Where it does not, "the `auto` value is ignored and the next source size is
 * used instead, if any".
 *
 * So `sizes="auto, 66vw"` on an image the page did not mark lazy resolves to
 * `66vw`, and the browser never asks layout anything. Reading it as a layout
 * width was the bug this answers: the width was wrong, so the candidate the
 * arithmetic picked could be wrong too, and not only the word above the row.
 *
 * The first-entry half is what makes `(min-width: 400px) auto, 100vw` a
 * `sizes` with no auto in it at all. `auto` there is not the value and does
 * not start it, so the element does not allow auto-sizes, and every clause
 * asking for `auto` is skipped rather than the whole attribute being refused.
 */
export const allowsAutoSizes = (sizes: string | null, loading: string | null): boolean =>
  loading === 'lazy' && sizes !== null && /^\s*auto\s*(,|$)/i.test(sizes);

/**
 * Resolve a `sizes` attribute against a viewport width.
 *
 * The first clause whose condition matches wins. A clause without a condition
 * always wins, so nothing after it is consulted.
 *
 * `allowsAuto` is the standard's auto-sizes condition, which the helper above
 * answers. False makes every `auto` clause invisible: the loop skips it and
 * carries on, which is what a browser does with one.
 */
export function resolveSizes(
  sizesString: string | null,
  viewportWidth: number,
  allowsAuto: boolean,
): Resolution {
  if (!sizesString || !sizesString.trim()) {
    return { kind: 'default', px: viewportWidth, clause: 'absent → 100vw default' };
  }
  // The one entry a browser may read as a layout width is the first one, and
  // only where the element allows auto-sizes. Anywhere else `auto` is a value
  // the browser passes over, so this passes over it too and the next clause
  // answers — including the 100vw default, where no clause is left.
  let skippedAuto = false;
  const readsAsLayout = (length: Length | null, at: number, hasCond: boolean): boolean => {
    // The standard's condition is on the attribute's value, not on a clause:
    // it is `auto`, or it starts with `auto,`. So the entry a browser may read
    // is the first one and it carries no media condition. An `auto` behind
    // `(min-width: …)` is one a browser passes over however early it is
    // written.
    const honored = allowsAuto && at === 0 && !hasCond;
    const ignored = length !== null && 'auto' in length && !honored;
    if (ignored) skippedAuto = true;
    return ignored;
  };

  for (const [at, clause] of splitTop(sizesString).entries()) {
    const mm = clause.match(/^(\(.*\))\s+(.+)$/);
    if (mm) {
      const cond = mm[1];
      if (!evalCond(cond, viewportWidth)) continue;
      const len = evalLen(mm[2], viewportWidth);
      if (readsAsLayout(len, at, true)) continue;
      return len ? asResolution(len, clause, cond) : { kind: 'error', clause };
    }
    const len = evalLen(clause, viewportWidth);
    if (readsAsLayout(len, at, false)) continue;
    return len ? asResolution(len, clause, null) : { kind: 'error', clause };
  }
  // The wording separates the two ways a sizes list runs out. A skipped `auto`
  // is a clause that was there and that a browser passed over, and a trace
  // saying no condition matched would be describing a different attribute.
  return {
    kind: 'default',
    px: viewportWidth,
    clause: skippedAuto ? 'auto ignored → 100vw default' : 'no condition matched → 100vw default',
  };
}

/** Every function this module is made of. `srcset.ts` says what for. */
export const PARTS: readonly Part[] = [
  toPx,
  splitTop,
  evalCond,
  evalLen,
  asResolution,
  allowsAutoSizes,
  resolveSizes,
];
