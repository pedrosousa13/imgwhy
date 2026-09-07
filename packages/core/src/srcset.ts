import type { Candidate, Part } from './types.js';

const isWhitespace = (c: string): boolean => /\s/.test(c);

/**
 * Split a `srcset` attribute into candidates.
 *
 * A URL runs to the first whitespace, so commas inside a URL survive. The
 * descriptor that follows runs to the first comma outside parentheses.
 */
export function parseSrcset(raw: string): Candidate[] {
  const out: Candidate[] = [];
  const s = raw || '';
  let i = 0;
  while (i < s.length) {
    while (i < s.length && (isWhitespace(s[i]) || s[i] === ',')) i++;
    if (i >= s.length) break;
    let url = '';
    while (i < s.length && !isWhitespace(s[i])) {
      url += s[i];
      i++;
    }
    let desc = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      let depth = 0;
      while (i < s.length) {
        const c = s[i];
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (c === ',' && depth === 0) {
          i++;
          break;
        }
        desc += c;
        i++;
      }
      desc = desc.trim();
    }
    const m = desc.match(/^([\d.]+)([wx])$/);
    out.push({
      url,
      w: m && m[2] === 'w' ? parseFloat(m[1]) : null,
      x: m && m[2] === 'x' ? parseFloat(m[1]) : m ? null : 1,
      raw: desc || '1x',
    });
  }
  return out;
}

/**
 * Every function this module is made of.
 *
 * `source.ts` says what this is for: core ships into a page as source, and a
 * function left out of this list is a function the page does not have. Add one
 * here when you add one above.
 *
 * What checks that, exactly: `source.test.ts` reads every top-level binding
 * every core module declares — a function declaration, a `const` holding an
 * arrow or anything else, a `let`, a `var`, a class, a name out of a
 * destructuring, in a block or not — and refuses any that the shipped source
 * does not declare. Two names are passed over: `PARTS` itself, because the
 * list is not part of what ships, and `CAPTURE_SCHEMA`, which is the shape
 * number of a file on disk and no business of a page.
 *
 * So the rule it enforces is stronger than "add your function here": a core
 * module's top level may hold functions, its own `PARTS`, and a constant no
 * shipped function reads. A constant cannot go in a list of functions, which
 * is what makes the last of those safe — and what checks it is a second
 * reading in the same file, of the shipped string for both exempted names and
 * of every core module's imports for either under any alias.
 *
 * What it cannot see is a name no core module declares — a global the shipped
 * copy reached for and a page does not have. The `CASES` table in
 * `source.test.ts` is the instrument for that one, and it says so.
 */
export const PARTS: readonly Part[] = [isWhitespace, parseSrcset];
