import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse, reaches, read, sources } from '../../../test/source.js';
import type { Modules } from './surface.js';
import { modulesIn } from './surface.js';

const src = fileURLToPath(new URL('../src', import.meta.url));

/**
 * The one module that may ask core anything, which is the one that can.
 *
 * `chrome.scripting.executeScript` sends `String(func)` and the page evaluates
 * the text, so an injected function arrives with no imports. Core is a module,
 * so the arithmetic cannot go into the page — and a copy of it that could
 * would be the thing this file exists to refuse.
 */
const WORKER_SIDE = 'explain.ts';

/** The calls the design names as the whole of what core answers. */
const ASKS = ['explainSelection', 'parseSrcset'];

/**
 * The operators selection is made of.
 *
 * A `w` candidate's density is its width divided by the resolved `sizes`
 * width. The physical pixels a device needs are the CSS width multiplied by
 * the ratio. Those two lines are the algorithm, and neither operator has any
 * other use in a package that reads a DOM, groups a `<picture>`'s children and
 * lays out text — the one sum anything here does is an `nth-of-type` index,
 * which is an addition.
 *
 * So this is a denylist where every other check in this directory is an
 * allowlist, and it is the right way round for once: the set of operators is
 * closed and small, TypeScript owns no more of them, and naming them is exact
 * where "no arithmetic" would be a rule about intent.
 *
 * The shifts are here because they are the same two operations spelled in
 * binary: `n >> 1` is a halving, `n << 1` a doubling, and a density is a
 * halving away from a `2x`. They reached no allowlist and performed no
 * multiplication or division as TypeScript names one, so a selection written
 * with them was a selection this check read as no arithmetic at all.
 */
const SELECTION: [ts.SyntaxKind, string][] = [
  [ts.SyntaxKind.SlashToken, 'a division, which is how a w candidate becomes a density'],
  [ts.SyntaxKind.SlashEqualsToken, 'a division'],
  [
    ts.SyntaxKind.AsteriskToken,
    'a multiplication, which is how a CSS width becomes physical pixels',
  ],
  [ts.SyntaxKind.AsteriskEqualsToken, 'a multiplication'],
  [ts.SyntaxKind.AsteriskAsteriskToken, 'an exponentiation'],
  [ts.SyntaxKind.AsteriskAsteriskEqualsToken, 'an exponentiation'],
  [ts.SyntaxKind.PercentToken, 'a remainder'],
  [ts.SyntaxKind.PercentEqualsToken, 'a remainder'],
  [ts.SyntaxKind.GreaterThanGreaterThanToken, 'a right shift, which is a division by two'],
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken, 'a right shift'],
  [
    ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
    'an unsigned right shift, which is a division by two',
  ],
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, 'an unsigned right shift'],
  [ts.SyntaxKind.LessThanLessThanToken, 'a left shift, which is a multiplication by two'],
  [ts.SyntaxKind.LessThanLessThanEqualsToken, 'a left shift'],
];

/** Every arithmetic operation one module performs, one line each. */
function arithmetic(name: string, text: string): string[] {
  const found: string[] = [];
  const reasons = new Map(SELECTION);

  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      const reason = reasons.get(node.operatorToken.kind);
      if (reason !== undefined) found.push(`${name} performs ${reason}`);
    }
    ts.forEachChild(node, visit);
  };

  visit(parse(text));
  return found;
}

const computing = (modules: Modules): string[] =>
  Object.entries(modules).flatMap(([name, text]) => arithmetic(name, text));

/**
 * Every name one module calls, as a call and not as a mention.
 *
 * A syntax tree for the reason `arithmetic` above needs one, and here it earns
 * it twice over. The reading this replaced was a substring search over the
 * source text, and `import { explainSelection, parseSrcset } from
 * '@imgwhy/core'` satisfies one with no call site anywhere — as does the doc
 * comment at the top of `explain.ts`, which names both. So the check that was
 * meant to refuse a package with no answers was satisfied by the import that
 * would let it have some.
 */
function asks(text: string): string[] {
  const found = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      found.add(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(parse(text));
  return [...found].sort();
}

/**
 * The design's load-bearing decision, as a check rather than as a promise:
 *
 * > `core` imports nothing. It declares no DOM types and no Node built-ins. It
 * > runs unchanged in Node, in a page, and in a service worker.
 * >
 * > A measured result and a hypothetical result use the same call. The CLI
 * > passes numbers it recorded. The report passes numbers you typed into a
 * > control. The extension passes numbers it read from the live DOM. None of
 * > them reimplements the algorithm, so none of them can disagree with the
 * > others.
 *
 * The issue asks for the same thing in one line — "Selection logic comes from
 * `core`. No selection code lives in the extension" — and it is the criterion
 * a test suite can be least trusted on, because a reimplementation that agrees
 * with core today passes every behavioural check there is. It fails later, on
 * the page where the two happen to differ, and by then two front ends are
 * telling one reader two things about one page.
 *
 * So the property is held over the shape of the source rather than over an
 * answer: the extension performs no multiplication and no division anywhere,
 * which is the whole of the selection algorithm as arithmetic, and
 * `boundary.test.ts` holds that core is the only package it may reach for one.
 *
 * ## What still gets past
 *
 * - **A density computed some other way.** `Math.pow`, a lookup table, a
 *   division written as a repeated subtraction. Nothing here would see it, and
 *   nothing reasonable would either. The reason this check is worth having
 *   anyway is that the way a reimplementation actually arrives is a copy of
 *   `imgwhy.js`, which is at the root of this repo and full of both operators.
 *   The bit shifts used to be in this list by omission — `n >> 1` is a halving
 *   and passed — and they are refused above now, because a shift is an operator
 *   TypeScript names and a check that can see one has no excuse for a note
 *   saying it cannot.
 * - **A decision that is not arithmetic.** Choosing the first candidate, or
 *   the largest, needs no operator at all. `explain.test.ts` is what catches
 *   that: it asserts the panel's answers against `explainSelection` called
 *   directly.
 */
describe('the extension, checked against holding a copy of the selection algorithm', () => {
  const modules = modulesIn(src);

  it('has sources to check, so nothing below passes for want of a file', () => {
    expect(Object.keys(modules).sort()).toEqual([
      'background.ts',
      'chrome.d.ts',
      WORKER_SIDE,
      'panel.ts',
      'read.ts',
    ]);
  });

  it('performs no multiplication and no division, which is the algorithm as arithmetic', () => {
    expect(computing(modules)).toEqual([]);
  });

  it('asks core the questions the design says core answers', () => {
    // The other half of the same claim, and the half that would otherwise let
    // an extension pass by doing nothing at all: a package that computes no
    // density and calls nothing has no arithmetic and also no answers.
    const named = reaches(read(`${src}/${WORKER_SIDE}`));
    const called = asks(modules[WORKER_SIDE] ?? '');

    expect(named.specifiers).toContain('@imgwhy/core');
    for (const ask of ASKS) expect(called).toContain(ask);
  });

  it('asks it from the worker alone, because the page cannot import anything', () => {
    // An `import` in an injected module is a name the page does not have.
    // `panel.ts` names `explain.ts` for a type, which is erased before `tsc`
    // emits anything — so the built module holds one function and no import,
    // and `panel.test.ts` runs that built copy to prove it.
    const injected = ['read.ts', 'panel.ts'];
    const importing = injected.flatMap((name) =>
      reaches(modules[name] ?? '')
        .specifiers.filter((specifier) => !specifier.startsWith('.'))
        .map((specifier) => `${name} imports ${specifier}`),
    );

    expect(importing).toEqual([]);
    expect(sources(src).map((file) => file.split(/[\\/]/).pop())).toContain(WORKER_SIDE);
  });
});

/**
 * The check, read against an extension that does the arithmetic itself.
 *
 * Each entry below is the reference implementation, or a line of it. They are
 * held here rather than tried on a branch and reverted, so the failure a
 * ported copy should cause is a passing test instead of a note in a commit
 * message.
 */
describe('the arithmetic check, given a panel that computes a selection', () => {
  const attacks: [string, string, string[]][] = [
    [
      'a density, which is the line `select` in the reference is built on',
      'export const density = (w: number, sizesPx: number) => w / sizesPx;',
      ['panel.ts performs a division, which is how a w candidate becomes a density'],
    ],
    [
      'the pixels a device needs, which is the other half of the same sum',
      'export const needed = (cssPx: number, dpr: number) => cssPx * dpr;',
      [
        'panel.ts performs a multiplication, which is how a CSS width becomes physical pixels',
      ],
    ],
    [
      'a vw token resolved by hand, which is `toPx` in the reference',
      'export const toPx = (n: number, vw: number) => (n / 100) * vw;',
      // The multiplication first, because the outer expression is the one the
      // walk reads first — `(n / 100) * vw` is a product of a quotient.
      [
        'panel.ts performs a multiplication, which is how a CSS width becomes physical pixels',
        'panel.ts performs a division, which is how a w candidate becomes a density',
      ],
    ],
    [
      'a ratio dressed up as a compound assignment',
      'export const waste = (delivered: number, needed: number) => { let r = delivered; r /= needed; return r; };',
      ['panel.ts performs a division'],
    ],
    [
      'a halving spelled as a shift, which no allowlist of operators used to name',
      'export const half = (needed: number) => needed >> 1;',
      ['panel.ts performs a right shift, which is a division by two'],
    ],
    [
      'a doubling spelled the other way, which is the pixels a retina screen needs',
      'export const retina = (cssPx: number) => cssPx << 1;',
      ['panel.ts performs a left shift, which is a multiplication by two'],
    ],
    [
      'a shift dressed up as a compound assignment, both ways round',
      'export const both = (n: number) => { let d = n; d >>>= 1; d <<= 1; return d; };',
      ['panel.ts performs an unsigned right shift', 'panel.ts performs a left shift'],
    ],
    [
      'an nth-of-type index, which is the one sum the reader legitimately does',
      "export const nth = (at: number) => `img:nth-of-type(${at + 1})`;",
      [],
    ],
    [
      'a rounded figure off a Selection, which is presentation and not arithmetic',
      'export const cell = (neededPx: number) => `${Math.round(neededPx)}px`;',
      [],
    ],
  ];

  it.each(attacks)('catches %s', (_route, source, expected) => {
    expect(arithmetic('panel.ts', source)).toEqual(expected);
  });

  it('reads a name that is imported and never called as a question nobody asked', () => {
    // The other half of the same claim, and the half a substring search could
    // not hold: a module that names both calls and calls neither has no
    // arithmetic of its own *and* no answers, which is a package that agrees
    // with core by saying nothing.
    const quiet = [
      "import { explainSelection, parseSrcset } from '@imgwhy/core';",
      '/** Every figure is `explainSelection` over `parseSrcset` candidates. */',
      'export const rows: string[] = [];',
    ].join('\n');

    // Both names are in the text — which is what the reading this replaced
    // asked, and why it passed on a module that asks core nothing.
    for (const ask of ASKS) expect(quiet).toContain(ask);
    expect(asks(quiet)).toEqual([]);
  });

  it('reads no operator out of a comment, which a regex over the text cannot help', () => {
    expect(
      arithmetic(
        'panel.ts',
        [
          '/** Never `c.w / sizesPx`, and never `cssPx * device.dpr`. */',
          '// The reference computes `n / 100 * vw` and this does not.',
          'export const plain = true;',
        ].join('\n'),
      ),
    ).toEqual([]);
  });
});
