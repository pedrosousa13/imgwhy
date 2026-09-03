import { describe, expect, it } from 'vitest';
import { parseSrcset, selectCandidate } from '../src/index.js';

describe('selectCandidate', () => {
  it('returns nothing when there are no candidates', () => {
    expect(selectCandidate([], 640, 1)).toBeNull();
  });

  it('takes the smallest w candidate at or above the needed density', () => {
    const candidates = parseSrcset('a-400.png 400w, a-800.png 800w, a-1600.png 1600w');
    expect(selectCandidate(candidates, 400, 2)).toEqual({
      url: 'a-800.png',
      w: 800,
      x: null,
      raw: '800w',
    });
  });

  it('treats the needed density as inclusive', () => {
    const candidates = parseSrcset('a-400.png 400w, a-800.png 800w');
    expect(selectCandidate(candidates, 400, 2)?.raw).toBe('800w');
  });

  it('falls back to the largest candidate when none is dense enough', () => {
    const candidates = parseSrcset('a-400.png 400w, a-800.png 800w');
    expect(selectCandidate(candidates, 640, 2)).toEqual({
      url: 'a-800.png',
      w: 800,
      x: null,
      raw: '800w',
    });
  });

  it('sorts by density, so candidate order in the attribute does not matter', () => {
    const candidates = parseSrcset('a-1600.png 1600w, a-400.png 400w, a-800.png 800w');
    expect(selectCandidate(candidates, 400, 2)?.raw).toBe('800w');
  });

  it('uses x descriptors when there is no resolved sizes width', () => {
    const candidates = parseSrcset('a.png 1x, a@2x.png 2x, a@3x.png 3x');
    expect(selectCandidate(candidates, null, 2)?.raw).toBe('2x');
  });

  it('uses x descriptors even when a sizes width is available', () => {
    const candidates = parseSrcset('a.png 1x, a@2x.png 2x, a@3x.png 3x');
    expect(selectCandidate(candidates, 640, 1.5)?.raw).toBe('2x');
  });

  it('treats a missing descriptor as 1x', () => {
    const candidates = parseSrcset('a.png, a@2x.png 2x');
    expect(selectCandidate(candidates, null, 1)).toEqual({
      url: 'a.png',
      w: null,
      x: 1,
      raw: '1x',
    });
  });

  it('falls back to the largest x candidate for a DPR above every descriptor', () => {
    const candidates = parseSrcset('a.png 1x, a@2x.png 2x');
    expect(selectCandidate(candidates, null, 3)?.raw).toBe('2x');
  });

  it('returns nothing when w candidates have no resolved sizes width', () => {
    const candidates = parseSrcset('a-400.png 400w, a-800.png 800w');
    expect(selectCandidate(candidates, null, 2)).toBeNull();
  });

  it('ignores w candidates without a sizes width and keeps the x candidates', () => {
    const candidates = parseSrcset('a-400.png 400w, a@2x.png 2x');
    expect(selectCandidate(candidates, null, 2)?.raw).toBe('2x');
  });
});
