import type { Resolution } from './types.js';

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

/** Evaluate a media condition. Only `min-width`, `max-width` and `and`. */
function evalCond(cond: string, vw: number): boolean {
  return cond.split(/\s+and\s+/i).every((p) => {
    const m = p.match(/\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)?\s*\)/i);
    if (!m) return false;
    const v = toPx(parseFloat(m[2] as string), (m[3] || 'px').toLowerCase(), vw);
    return (m[1] as string).toLowerCase() === 'max' ? vw <= v : vw >= v;
  });
}

function evalLen(str: string, vw: number): Length | null {
  const s = str.trim();
  if (/^auto$/i.test(s)) return { auto: true };
  const calc = s.match(/^calc\(([\s\S]*)\)$/i);
  const toks = (calc ? (calc[1] as string) : s).match(/[+-]?\s*[\d.]+(?:vw|px|em|rem)/gi);
  if (!toks) return null;
  let t = 0;
  for (const tok of toks) {
    const m = tok.replace(/\s+/g, '').match(/^([+-]?)([\d.]+)(vw|px|em|rem)$/i);
    if (!m) return null;
    t += (m[1] === '-' ? -1 : 1) * toPx(parseFloat(m[2] as string), (m[3] as string).toLowerCase(), vw);
  }
  return { px: t };
}

const asResolution = (len: Length, clause: string, cond: string | null): Resolution =>
  'auto' in len ? { kind: 'auto', clause, cond } : { kind: 'length', px: len.px, clause, cond };

/**
 * Resolve a `sizes` attribute against a viewport width.
 *
 * The first clause whose condition matches wins. A clause without a condition
 * always wins, so nothing after it is consulted.
 */
export function resolveSizes(sizesString: string | null, viewportWidth: number): Resolution {
  if (!sizesString || !sizesString.trim()) {
    return { kind: 'default', px: viewportWidth, clause: 'absent → 100vw default' };
  }
  for (const clause of splitTop(sizesString)) {
    const mm = clause.match(/^(\(.*\))\s+(.+)$/);
    if (mm) {
      const cond = mm[1] as string;
      if (!evalCond(cond, viewportWidth)) continue;
      const len = evalLen(mm[2] as string, viewportWidth);
      return len ? asResolution(len, clause, cond) : { kind: 'error', clause };
    }
    const len = evalLen(clause, viewportWidth);
    return len ? asResolution(len, clause, null) : { kind: 'error', clause };
  }
  return { kind: 'default', px: viewportWidth, clause: 'no condition matched → 100vw default' };
}
