import { describe, expect, it } from 'vitest';
import { parseSrcset } from '../src/index.js';

describe('parseSrcset', () => {
  it('returns nothing for an empty string', () => {
    expect(parseSrcset('')).toEqual([]);
  });

  it('reads w descriptors', () => {
    expect(parseSrcset('a.png 400w, b.png 800w')).toEqual([
      { url: 'a.png', w: 400, x: null, raw: '400w' },
      { url: 'b.png', w: 800, x: null, raw: '800w' },
    ]);
  });

  it('reads x descriptors', () => {
    expect(parseSrcset('a.png 1x, b.png 2x, c.png 3x')).toEqual([
      { url: 'a.png', w: null, x: 1, raw: '1x' },
      { url: 'b.png', w: null, x: 2, raw: '2x' },
      { url: 'c.png', w: null, x: 3, raw: '3x' },
    ]);
  });

  it('reads fractional x descriptors', () => {
    expect(parseSrcset('a.png 1.5x')).toEqual([{ url: 'a.png', w: null, x: 1.5, raw: '1.5x' }]);
  });

  it('treats an absent descriptor as 1x', () => {
    expect(parseSrcset('a.png')).toEqual([{ url: 'a.png', w: null, x: 1, raw: '1x' }]);
  });

  it('treats an absent descriptor as 1x when other candidates follow', () => {
    expect(parseSrcset('a.png, b.png 2x')).toEqual([
      { url: 'a.png', w: null, x: 1, raw: '1x' },
      { url: 'b.png', w: null, x: 2, raw: '2x' },
    ]);
  });

  it('keeps commas that belong to a candidate URL', () => {
    expect(parseSrcset('/i/w_400,c_fill/a.jpg 400w, /i/w_800,c_fill/a.jpg 800w')).toEqual([
      { url: '/i/w_400,c_fill/a.jpg', w: 400, x: null, raw: '400w' },
      { url: '/i/w_800,c_fill/a.jpg', w: 800, x: null, raw: '800w' },
    ]);
  });

  it('keeps commas in query strings', () => {
    expect(parseSrcset('img.php?rect=0,0,10,10 400w, img.php?rect=1,1,20,20 800w')).toEqual([
      { url: 'img.php?rect=0,0,10,10', w: 400, x: null, raw: '400w' },
      { url: 'img.php?rect=1,1,20,20', w: 800, x: null, raw: '800w' },
    ]);
  });

  it('tolerates newlines and repeated whitespace between candidates', () => {
    expect(parseSrcset('\n  a.png 400w,\n  b.png 800w\n')).toEqual([
      { url: 'a.png', w: 400, x: null, raw: '400w' },
      { url: 'b.png', w: 800, x: null, raw: '800w' },
    ]);
  });

  it('keeps an unreadable descriptor verbatim and falls back to 1x', () => {
    expect(parseSrcset('a.png banana')).toEqual([
      { url: 'a.png', w: null, x: 1, raw: 'banana' },
    ]);
  });
});
