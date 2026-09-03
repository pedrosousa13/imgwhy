import type { Candidate } from './types.js';

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
 * here when you add one above — `source.test.ts` reads every module's top
 * level and refuses a name that is missing from the list beside it.
 */
export const PARTS: readonly Function[] = [isWhitespace, parseSrcset];
