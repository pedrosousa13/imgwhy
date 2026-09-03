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
    while (i < s.length && (isWhitespace(s[i] as string) || s[i] === ',')) i++;
    if (i >= s.length) break;
    let url = '';
    while (i < s.length && !isWhitespace(s[i] as string)) {
      url += s[i];
      i++;
    }
    let desc = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      let depth = 0;
      while (i < s.length) {
        const c = s[i] as string;
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
      w: m && m[2] === 'w' ? parseFloat(m[1] as string) : null,
      x: m && m[2] === 'x' ? parseFloat(m[1] as string) : m ? null : 1,
      raw: desc || '1x',
    });
  }
  return out;
}
