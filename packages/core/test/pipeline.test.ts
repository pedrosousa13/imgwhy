import { describe, expect, it } from 'vitest';
import { parseSrcset, resolveSizes, selectCandidate } from '../src/index.js';

const NEXT_SRCSET = [
  '/_next/image?w=640 640w',
  '/_next/image?w=750 750w',
  '/_next/image?w=828 828w',
  '/_next/image?w=1080 1080w',
  '/_next/image?w=1200 1200w',
  '/_next/image?w=1920 1920w',
].join(', ');

describe('the trace, end to end', () => {
  it('picks 1080w for a 640px viewport at DPR 1.5', () => {
    const candidates = parseSrcset(NEXT_SRCSET);
    const resolution = resolveSizes('100vw', 640, false);

    expect(resolution).toEqual({ kind: 'length', px: 640, clause: '100vw', cond: null });
    expect(resolution.kind === 'length' && resolution.px * 1.5).toBe(960);
    expect(selectCandidate(candidates, 640, 1.5)?.raw).toBe('1080w');
  });

  it('picks 1080w for a 640px viewport at DPR 1.5 when sizes is absent', () => {
    const candidates = parseSrcset(NEXT_SRCSET);
    const resolution = resolveSizes(null, 640, false);

    expect(resolution).toEqual({
      kind: 'default',
      px: 640,
      clause: 'absent → 100vw default',
    });
    expect(selectCandidate(candidates, 640, 1.5)?.raw).toBe('1080w');
  });

  it('narrows the pick when a sizes clause halves the width', () => {
    const candidates = parseSrcset(NEXT_SRCSET);
    const resolution = resolveSizes('(min-width: 600px) 50vw, 100vw', 640, false);

    expect(resolution).toEqual({
      kind: 'length',
      px: 320,
      clause: '(min-width: 600px) 50vw',
      cond: '(min-width: 600px)',
    });
    expect(selectCandidate(candidates, 320, 1.5)?.raw).toBe('640w');
  });
});
