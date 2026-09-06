import { describe, expect, it } from 'vitest';
import { allowsAutoSizes, resolveSizes } from '../src/index.js';

describe('resolveSizes', () => {
  describe('when sizes is absent', () => {
    it('falls back to 100vw for null', () => {
      expect(resolveSizes(null, 640, false)).toEqual({
        kind: 'default',
        px: 640,
        clause: 'absent → 100vw default',
      });
    });

    it('falls back to 100vw for an empty string', () => {
      expect(resolveSizes('', 640, false)).toEqual({
        kind: 'default',
        px: 640,
        clause: 'absent → 100vw default',
      });
    });

    it('falls back to 100vw for whitespace only', () => {
      expect(resolveSizes('   ', 640, false)).toEqual({
        kind: 'default',
        px: 640,
        clause: 'absent → 100vw default',
      });
    });
  });

  describe('units', () => {
    it('resolves vw against the viewport', () => {
      expect(resolveSizes('50vw', 640, false)).toEqual({
        kind: 'length',
        px: 320,
        clause: '50vw',
        cond: null,
      });
    });

    it('resolves px verbatim', () => {
      expect(resolveSizes('320px', 640, false)).toEqual({
        kind: 'length',
        px: 320,
        clause: '320px',
        cond: null,
      });
    });

    it('resolves em at 16px', () => {
      expect(resolveSizes('20em', 640, false)).toEqual({
        kind: 'length',
        px: 320,
        clause: '20em',
        cond: null,
      });
    });

    it('resolves rem at 16px', () => {
      expect(resolveSizes('20rem', 640, false)).toEqual({
        kind: 'length',
        px: 320,
        clause: '20rem',
        cond: null,
      });
    });
  });

  describe('calc()', () => {
    it('subtracts a px term from a vw term', () => {
      expect(resolveSizes('calc(100vw - 32px)', 640, false)).toEqual({
        kind: 'length',
        px: 608,
        clause: 'calc(100vw - 32px)',
        cond: null,
      });
    });

    it('adds terms', () => {
      expect(resolveSizes('calc(50vw + 2rem)', 640, false)).toEqual({
        kind: 'length',
        px: 352,
        clause: 'calc(50vw + 2rem)',
        cond: null,
      });
    });

    it('does not split the comma-free calc clause on its inner parentheses', () => {
      expect(resolveSizes('(min-width: 600px) calc(100vw - 40px), 100vw', 640, false)).toEqual({
        kind: 'length',
        px: 600,
        clause: '(min-width: 600px) calc(100vw - 40px)',
        cond: '(min-width: 600px)',
      });
    });
  });

  describe('media conditions', () => {
    it('uses a clause whose min-width matches', () => {
      expect(resolveSizes('(min-width: 800px) 50vw, 100vw', 900, false)).toEqual({
        kind: 'length',
        px: 450,
        clause: '(min-width: 800px) 50vw',
        cond: '(min-width: 800px)',
      });
    });

    it('skips a clause whose min-width does not match', () => {
      expect(resolveSizes('(min-width: 800px) 50vw, 100vw', 640, false)).toEqual({
        kind: 'length',
        px: 640,
        clause: '100vw',
        cond: null,
      });
    });

    it('honours max-width', () => {
      expect(resolveSizes('(max-width: 600px) 100vw, 50vw', 640, false)).toEqual({
        kind: 'length',
        px: 320,
        clause: '50vw',
        cond: null,
      });
    });

    it('resolves em inside a media condition at 16px', () => {
      expect(resolveSizes('(min-width: 40em) 50vw, 100vw', 640, false)).toEqual({
        kind: 'length',
        px: 320,
        clause: '(min-width: 40em) 50vw',
        cond: '(min-width: 40em)',
      });
    });

    it('requires every part of an and combinator', () => {
      const sizes = '(min-width: 400px) and (max-width: 800px) 50vw, 100vw';
      expect(resolveSizes(sizes, 640, false)).toEqual({
        kind: 'length',
        px: 320,
        clause: '(min-width: 400px) and (max-width: 800px) 50vw',
        cond: '(min-width: 400px) and (max-width: 800px)',
      });
    });

    it('rejects an and combinator when one part fails', () => {
      const sizes = '(min-width: 400px) and (max-width: 800px) 50vw, 25vw';
      expect(resolveSizes(sizes, 900, false)).toEqual({
        kind: 'length',
        px: 225,
        clause: '25vw',
        cond: null,
      });
    });

    it('reads a second and that combines nothing, rather than failing on it', () => {
      // `and and` is what the splitting of a condition on that word has to
      // survive. Whatever splits it leaves the second `and` at the head of the
      // part behind it, and the check that reads each part is unanchored, so it
      // finds the condition there and the verdict is the one a browser gives.
      // A split that instead cut at both words would hand the check a part
      // holding nothing but whitespace, which matches no condition and fails
      // the `every` — a true condition read as false, and the wrong clause
      // chosen with no sign that anything went wrong.
      const sizes = '(min-width:1px)  and  and  (min-width:1px) 50vw';
      expect(resolveSizes(sizes, 1000, false)).toEqual({
        kind: 'length',
        px: 500,
        clause: sizes,
        cond: '(min-width:1px)  and  and  (min-width:1px)',
      });
    });

    it('takes the first matching clause and never consults a later one', () => {
      const sizes = '(min-width: 400px) 25vw, (min-width: 800px) 50vw';
      expect(resolveSizes(sizes, 900, false)).toEqual({
        kind: 'length',
        px: 225,
        clause: '(min-width: 400px) 25vw',
        cond: '(min-width: 400px)',
      });
    });

    it('falls back to 100vw when no condition matches', () => {
      expect(resolveSizes('(min-width: 800px) 50vw', 640, false)).toEqual({
        kind: 'default',
        px: 640,
        clause: 'no condition matched → 100vw default',
      });
    });
  });

  /**
   * `auto`, which a browser reads only where the standard says it may.
   *
   * An `img` allows auto-sizes when its `loading` attribute is lazy and its
   * `sizes` is `auto` or starts with `auto,`. Otherwise "the `auto` value is
   * ignored and the next source size is used instead, if any". Both halves are
   * checked here, because reading `auto` where a browser does not is a wrong
   * width rather than a wrong label: selection then runs against a figure the
   * browser never used.
   */
  describe('auto, where the element allows auto-sizes', () => {
    it('reports a bare auto', () => {
      expect(resolveSizes('auto', 640, true)).toEqual({ kind: 'auto', clause: 'auto', cond: null });
    });

    it('reports auto written first, ahead of a fallback', () => {
      expect(resolveSizes('auto, 66vw', 640, true)).toEqual({
        kind: 'auto',
        clause: 'auto',
        cond: null,
      });
    });

    it('reads auto case-insensitively, the way the attribute is matched', () => {
      expect(resolveSizes('AUTO', 640, true)).toEqual({ kind: 'auto', clause: 'AUTO', cond: null });
    });

    it('skips an auto that is not the first entry, which the standard does not allow', () => {
      // The element allows auto-sizes only where `sizes` starts with it, so an
      // `auto` further down is a value a browser passes over even here.
      expect(resolveSizes('(min-width: 400px) auto, 100vw', 640, true)).toEqual({
        kind: 'length',
        px: 640,
        clause: '100vw',
        cond: null,
      });
    });
  });

  describe('auto, where the element does not allow auto-sizes', () => {
    it('uses the next source size instead', () => {
      expect(resolveSizes('auto, 66vw', 1000, false)).toEqual({
        kind: 'length',
        px: 660,
        clause: '66vw',
        cond: null,
      });
    });

    it('falls to the 100vw default where auto was the only entry', () => {
      expect(resolveSizes('auto', 640, false)).toEqual({
        kind: 'default',
        px: 640,
        clause: 'auto ignored → 100vw default',
      });
    });

    it('says the auto was ignored rather than that no condition matched', () => {
      // Two different attributes end at the same width, and a trace that
      // worded them alike would describe one of them wrongly.
      expect(resolveSizes('(min-width: 900px) 50vw', 640, false).clause).toBe(
        'no condition matched → 100vw default',
      );
    });

    it('skips auto behind a matching condition and reads the next clause', () => {
      expect(resolveSizes('(min-width: 400px) auto, 100vw', 640, false)).toEqual({
        kind: 'length',
        px: 640,
        clause: '100vw',
        cond: null,
      });
    });
  });

  /**
   * The condition itself, which decides which of the two blocks above applies.
   */
  describe('allowsAutoSizes', () => {
    const cases: [string, string | null, string | null, boolean][] = [
      ['lazy and a bare auto', 'auto', 'lazy', true],
      ['lazy and auto written first', 'auto, 66vw', 'lazy', true],
      ['lazy and auto in capitals', 'AUTO, 66vw', 'lazy', true],
      ['lazy and leading whitespace', '  auto, 66vw', 'lazy', true],
      ['lazy and auto written second', '(min-width: 400px) auto, 100vw', 'lazy', false],
      ['lazy and no auto at all', '100vw', 'lazy', false],
      ['auto first but the image is eager', 'auto, 66vw', 'eager', false],
      ['auto first and no loading attribute', 'auto, 66vw', null, false],
      ['no sizes at all', null, 'lazy', false],
      ['a word that merely starts with auto', 'automatic, 66vw', 'lazy', false],
    ];

    it.each(cases)('is %s → %s', (_shape, sizes, loading, expected) => {
      expect(allowsAutoSizes(sizes, loading)).toBe(expected);
    });
  });

  /**
   * A clause at a length no author writes, which the page chooses anyway.
   *
   * `sizes` is an author attribute, so its length is the page's to pick, and a
   * scan over it costing more than linear is a hang a page can ask for: in the
   * extension it stops the one service worker a toolbar click runs in, and on
   * the command line it stops the run. This is the one place that reason is
   * written down; `sizes.ts` points here rather than repeating it.
   *
   * Four runs the page can lengthen without bound, across two scans. The digits
   * of a number and the whitespace a sign may sit ahead of belong to the length
   * scan, and are read twice over — once where nothing completes a token, and
   * once where a unit does, which is a different path through the same scan.
   * The whitespace either side of an `and` belongs to the condition scan
   * instead. Each is pinned on its own, because a rewrite of one scan leaves
   * the other standing and a rewrite of one path leaves the other.
   *
   * ## The ceiling is loose on purpose
   *
   * These separate linear from quadratic, not one implementation from another.
   * Reading any of these strings once is a few milliseconds; the backtracking
   * scans they replaced took 18.7, 6.0 and 20.7 seconds. A ceiling of 250ms is
   * well above the work and well below the failure, so a loaded machine stays
   * green and a scan that restarts along the string cannot.
   */
  describe('a clause long enough to hang a backtracking scan', () => {
    const CEILING_MS = 250;

    const msToResolve = (sizes: string): number => {
      const started = performance.now();
      resolveSizes(sizes, 640, false);
      return performance.now() - started;
    };

    it('reads 200 000 digits with no unit behind them in milliseconds', () => {
      expect(msToResolve('1'.repeat(200_000))).toBeLessThan(CEILING_MS);
    });

    it('reads a sign with 100 000 spaces behind it in milliseconds', () => {
      expect(msToResolve(`-${' '.repeat(100_000)}x`)).toBeLessThan(CEILING_MS);
    });

    it('reads a media condition holding 200 000 spaces in milliseconds', () => {
      expect(msToResolve(`(min-width:${' '.repeat(200_000)}1px) 50vw`)).toBeLessThan(CEILING_MS);
    });

    it('reads 200 000 digits a unit does complete, in milliseconds and correctly', () => {
      // The other side of the first test. There the scan runs out looking for a
      // unit that never arrives; here it finds one, and a rewrite could make
      // either path superlinear without touching the other. The value is
      // asserted beside the time because a scan that was quick by reading less
      // of the number than it should would pass a timing check on its own — so
      // the digits are written to carry a value a `double` can hold exactly.
      const sizes = `${'0'.repeat(199_996)}1234px`;
      const started = performance.now();

      expect(resolveSizes(sizes, 640, false)).toEqual({
        kind: 'length',
        px: 1234,
        clause: sizes,
        cond: null,
      });
      expect(performance.now() - started).toBeLessThan(CEILING_MS);
    });

    it('still reports the long clause as one it cannot read', () => {
      const sizes = '1'.repeat(200_000);

      expect(resolveSizes(sizes, 640, false)).toEqual({ kind: 'error', clause: sizes });
    });
  });

  describe('unparseable lengths', () => {
    it('reports an error for a bare length it cannot read', () => {
      expect(resolveSizes('banana', 640, false)).toEqual({ kind: 'error', clause: 'banana' });
    });

    it('reports an error for a length behind a matching condition', () => {
      expect(resolveSizes('(min-width: 400px) banana, 100vw', 640, false)).toEqual({
        kind: 'error',
        clause: '(min-width: 400px) banana',
      });
    });

    it('reports an error rather than skipping to the next clause', () => {
      expect(resolveSizes('banana, 100vw', 640, false)).toEqual({ kind: 'error', clause: 'banana' });
    });
  });
});
