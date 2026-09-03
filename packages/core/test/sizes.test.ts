import { describe, expect, it } from 'vitest';
import { resolveSizes } from '../src/index.js';

describe('resolveSizes', () => {
  describe('when sizes is absent', () => {
    it('falls back to 100vw for null', () => {
      expect(resolveSizes(null, 640)).toEqual({
        kind: 'default',
        px: 640,
        clause: 'absent → 100vw default',
      });
    });

    it('falls back to 100vw for an empty string', () => {
      expect(resolveSizes('', 640)).toEqual({
        kind: 'default',
        px: 640,
        clause: 'absent → 100vw default',
      });
    });

    it('falls back to 100vw for whitespace only', () => {
      expect(resolveSizes('   ', 640)).toEqual({
        kind: 'default',
        px: 640,
        clause: 'absent → 100vw default',
      });
    });
  });

  describe('units', () => {
    it('resolves vw against the viewport', () => {
      expect(resolveSizes('50vw', 640)).toEqual({
        kind: 'length',
        px: 320,
        clause: '50vw',
        cond: null,
      });
    });

    it('resolves px verbatim', () => {
      expect(resolveSizes('320px', 640)).toEqual({
        kind: 'length',
        px: 320,
        clause: '320px',
        cond: null,
      });
    });

    it('resolves em at 16px', () => {
      expect(resolveSizes('20em', 640)).toEqual({
        kind: 'length',
        px: 320,
        clause: '20em',
        cond: null,
      });
    });

    it('resolves rem at 16px', () => {
      expect(resolveSizes('20rem', 640)).toEqual({
        kind: 'length',
        px: 320,
        clause: '20rem',
        cond: null,
      });
    });
  });

  describe('calc()', () => {
    it('subtracts a px term from a vw term', () => {
      expect(resolveSizes('calc(100vw - 32px)', 640)).toEqual({
        kind: 'length',
        px: 608,
        clause: 'calc(100vw - 32px)',
        cond: null,
      });
    });

    it('adds terms', () => {
      expect(resolveSizes('calc(50vw + 2rem)', 640)).toEqual({
        kind: 'length',
        px: 352,
        clause: 'calc(50vw + 2rem)',
        cond: null,
      });
    });

    it('does not split the comma-free calc clause on its inner parentheses', () => {
      expect(resolveSizes('(min-width: 600px) calc(100vw - 40px), 100vw', 640)).toEqual({
        kind: 'length',
        px: 600,
        clause: '(min-width: 600px) calc(100vw - 40px)',
        cond: '(min-width: 600px)',
      });
    });
  });

  describe('media conditions', () => {
    it('uses a clause whose min-width matches', () => {
      expect(resolveSizes('(min-width: 800px) 50vw, 100vw', 900)).toEqual({
        kind: 'length',
        px: 450,
        clause: '(min-width: 800px) 50vw',
        cond: '(min-width: 800px)',
      });
    });

    it('skips a clause whose min-width does not match', () => {
      expect(resolveSizes('(min-width: 800px) 50vw, 100vw', 640)).toEqual({
        kind: 'length',
        px: 640,
        clause: '100vw',
        cond: null,
      });
    });

    it('honours max-width', () => {
      expect(resolveSizes('(max-width: 600px) 100vw, 50vw', 640)).toEqual({
        kind: 'length',
        px: 320,
        clause: '50vw',
        cond: null,
      });
    });

    it('resolves em inside a media condition at 16px', () => {
      expect(resolveSizes('(min-width: 40em) 50vw, 100vw', 640)).toEqual({
        kind: 'length',
        px: 320,
        clause: '(min-width: 40em) 50vw',
        cond: '(min-width: 40em)',
      });
    });

    it('requires every part of an and combinator', () => {
      const sizes = '(min-width: 400px) and (max-width: 800px) 50vw, 100vw';
      expect(resolveSizes(sizes, 640)).toEqual({
        kind: 'length',
        px: 320,
        clause: '(min-width: 400px) and (max-width: 800px) 50vw',
        cond: '(min-width: 400px) and (max-width: 800px)',
      });
    });

    it('rejects an and combinator when one part fails', () => {
      const sizes = '(min-width: 400px) and (max-width: 800px) 50vw, 25vw';
      expect(resolveSizes(sizes, 900)).toEqual({
        kind: 'length',
        px: 225,
        clause: '25vw',
        cond: null,
      });
    });

    it('takes the first matching clause and never consults a later one', () => {
      const sizes = '(min-width: 400px) 25vw, (min-width: 800px) 50vw';
      expect(resolveSizes(sizes, 900)).toEqual({
        kind: 'length',
        px: 225,
        clause: '(min-width: 400px) 25vw',
        cond: '(min-width: 400px)',
      });
    });

    it('falls back to 100vw when no condition matches', () => {
      expect(resolveSizes('(min-width: 800px) 50vw', 640)).toEqual({
        kind: 'default',
        px: 640,
        clause: 'no condition matched → 100vw default',
      });
    });
  });

  describe('auto', () => {
    it('reports a bare auto', () => {
      expect(resolveSizes('auto', 640)).toEqual({ kind: 'auto', clause: 'auto', cond: null });
    });

    it('reports auto behind a matching condition', () => {
      expect(resolveSizes('(min-width: 400px) auto, 100vw', 640)).toEqual({
        kind: 'auto',
        clause: '(min-width: 400px) auto',
        cond: '(min-width: 400px)',
      });
    });
  });

  describe('unparseable lengths', () => {
    it('reports an error for a bare length it cannot read', () => {
      expect(resolveSizes('banana', 640)).toEqual({ kind: 'error', clause: 'banana' });
    });

    it('reports an error for a length behind a matching condition', () => {
      expect(resolveSizes('(min-width: 400px) banana, 100vw', 640)).toEqual({
        kind: 'error',
        clause: '(min-width: 400px) banana',
      });
    });

    it('reports an error rather than skipping to the next clause', () => {
      expect(resolveSizes('banana, 100vw', 640)).toEqual({ kind: 'error', clause: 'banana' });
    });
  });
});
