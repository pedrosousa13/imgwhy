import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse } from '../../../test/source.js';
import type { Modules, Rules } from './surface.js';
import { modulesIn, why } from './surface.js';

const src = fileURLToPath(new URL('../src', import.meta.url));

/**
 * Two of the design's non-goals, as checks rather than as inspections.
 *
 * > **`<picture>` type negotiation.** Evaluate `media` only. Do not model AVIF
 * > against WebP support.
 * >
 * > **Estimated bytes.** Where `transferBytes` is null, report it as unknown.
 * > Do not guess from pixel dimensions.
 *
 * Both are refusals, and a refusal is the one kind of property that cannot be
 * demonstrated by running the thing. A panel that negotiates a format looks
 * exactly like one that does not until you find the page where they differ,
 * and a byte figure guessed from a dimension reads exactly like a measured
 * one — which is the whole reason the design writes the second one down.
 *
 * So the source is read. The runner holds the same two claims over its own
 * page-side module, and the report holds the estimate half over all of its; the
 * extension is the third front end and the only one that runs in a page it did
 * not open, which makes the second claim sharper here than anywhere: the
 * command line can measure a transfer and this cannot, so `unknown` is not a
 * fallback in this package. It is the only value there is.
 */

/**
 * Names refused wherever the package reads one.
 *
 * A reason per route, because the two non-goals fail differently. A format
 * read is a question the design says not to ask. A weight read is a question
 * the platform answers wrongly — `transferSize` is zero for a cross-origin
 * response without `Timing-Allow-Origin`, which most image CDNs do not send —
 * and a dimension read is the ingredient of the guess that would fill the gap.
 *
 * `renderedWidth` is not here, and that is the entry worth arguing. Core asks
 * for it: `sizes: auto` defers to layout, and the width the element ended up at
 * is the honest answer there, so the reader has to take it. A dimension the
 * arithmetic needs is not an ingredient lying around.
 *
 * `naturalWidth` was here and is not any more, and the narrowing is deliberate
 * rather than a loosening. Core asks for it too: it is the width an element the
 * page never sized ends up at, so comparing it with the box is how a row learns
 * whether its own width came from the file that loaded — the difference between
 * a row that can be judged and a row that says `can't tell`. Refusing it cost
 * 15 rows of 23 on an ordinary page.
 *
 * What guards the non-goal instead is what the guess actually needs, and it
 * needs three things this package cannot get. A second dimension, which is
 * refused below: one width is a length and never an area. A multiplication,
 * which `through-core.test.ts` refuses anywhere in this package. And a
 * bytes-per-pixel figure, which is a number somebody would have to invent and
 * write down here. The check now names the ingredients rather than the first
 * one to hand.
 */
const REFUSED: Rules = [
  [/^type$/, 'the type attribute, which the design says not to read'],
  [
    /^(?:toDataURL|canPlayType|createImageBitmap)$/,
    'a probe for what a format decodes to',
  ],
  [
    /^naturalHeight$/,
    'the second dimension of a decoded file, which is what turns the first one into an area and ' +
      'an area into a guessed weight',
  ],
  [
    /^(?:transferSize|encodedBodySize|decodedBodySize)$/,
    'a weight a page cannot read for a cross-origin response, so a figure from it says nothing',
  ],
  [
    /^(?:performance|getEntriesByType|getEntriesByName|PerformanceObserver)$/,
    'the timing API, whose transfer size is zero for most of the images on a page',
  ],
];

/**
 * Strings refused, which is the half no reading of names can see.
 *
 * A negotiation takes two shapes that name no property: `getAttribute('type')`,
 * and a selector that filters the sources — `source:not([type])` — which asks
 * the same question with no `.type` anywhere in the file.
 */
const NAMES_A_FORMAT: Rules = [
  [/^type$/, 'the type attribute'],
  [/\[\s*type\b/, 'a selector that reads the type attribute'],
  [/\bimage\/[a-z0-9]/i, 'a MIME image type'],
  [/\b(?:avif|webp|jxl|heic)\b/i, 'an image format'],
  [/\bcanvas\b/i, 'a canvas, which is how a page probes a format'],
];

/**
 * Every name one module reads, and every string it writes.
 *
 * Reads rather than every mention of a name, and the distinction is the point.
 * `explain.ts` writes `naturalWidth: 0` into the shape core takes, because the
 * type has the field and the arithmetic never looks at it — a key holding a
 * literal is not a dimension, it is the absence of one. A read is what carries
 * a value, and `{ naturalWidth: img.naturalWidth }` is a read on its right
 * hand side whatever the key says.
 *
 * A syntax tree rather than a regex over the text, for the reason
 * `test/source.ts` gives: a tree holds no comments, so the word `type` in a
 * doc comment explaining that no `type` is read is not itself a finding, and
 * it holds every form a name can be read in rather than the forms whoever
 * wrote the pattern thought of. Four of those forms read one:
 *
 * ```ts
 * source.type              // a property access
 * source['type']           // an element access
 * const { type } = source  // a destructuring
 * const { type: kind } = source
 * ```
 */
function surface(text: string): { reads: string[]; strings: string[] } {
  const reads = new Set<string>();
  const strings: string[] = [];

  /** Whether one identifier is the key of a property rather than a value. */
  const isKey = (node: ts.Identifier): boolean => {
    const parent = node.parent;
    return (
      (ts.isPropertyAssignment(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isMethodSignature(parent)) &&
      parent.name === node
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) reads.add(node.name.text);
    else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      reads.add(node.argumentExpression.text);
    } else if (ts.isBindingElement(node)) {
      const bound = node.propertyName ?? node.name;
      if (ts.isIdentifier(bound)) reads.add(bound.text);
    } else if (ts.isIdentifier(node) && !isKey(node)) reads.add(node.text);

    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      strings.push(node.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(parse(text));
  // A set, and sorted, because a name reached two ways is one read: a property
  // access and the identifier inside it are the same `.type`, and a finding per
  // node would count it twice and say nothing more.
  return { reads: [...reads].sort(), strings };
}

/** Every way one module asks a refused question, one line each. Empty is clean. */
function findings(modules: Modules): string[] {
  return Object.entries(modules).flatMap(([name, text]) => {
    const { reads, strings } = surface(text);
    return [
      ...reads.map((read) => {
        const reason = why(REFUSED, read);
        return reason === undefined ? null : `${name} reads ${read}, which is ${reason}`;
      }),
      ...strings.map((value) => {
        const reason = why(NAMES_A_FORMAT, value);
        return reason === undefined ? null : `${name} writes "${value}", which names ${reason}`;
      }),
    ].filter((line): line is string => line !== null);
  });
}

describe('the extension, checked against negotiating a format or guessing a weight', () => {
  const modules = modulesIn(src);

  it('has sources to check, so nothing below passes for want of a file', () => {
    expect(Object.keys(modules).sort()).toEqual([
      'background.ts',
      'chrome.d.ts',
      'explain.ts',
      'panel.ts',
      'read.ts',
    ]);
  });

  it('asks nothing about a format and reads no weight it could guess one from', () => {
    expect(findings(modules)).toEqual([]);
  });

  it('says unknown where nothing measured a transfer, and shows no figure', () => {
    // The value is checked as behaviour in `explain.test.ts` and as source
    // here, because the two say different things. There the panel prints the
    // word; here nothing in the package holds anything else it could print.
    expect(modules['explain.ts']).toContain("const UNKNOWN = 'unknown'");
  });
});

/**
 * The check, read against an extension that asks anyway.
 *
 * Held here rather than tried on a branch and reverted, so the failure each
 * route should cause is a passing test instead of a note in a commit message.
 */
describe('the non-goal checks, given a panel that negotiates or guesses', () => {
  it('is quiet about the arrangement that ships', () => {
    expect(
      findings({
        'read.ts': [
          'export const active = (img: HTMLImageElement) => {',
          '  for (const child of [...img.children]) {',
          '    const source = child as HTMLSourceElement;',
          '    if (source.media && !matchMedia(source.media).matches) continue;',
          '    return source.srcset;',
          '  }',
          '  return img.srcset;',
          '};',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('catches a type read, which is the negotiation the design refuses', () => {
    expect(findings({ 'read.ts': 'export const of = (s: HTMLSourceElement) => s.type;' })).toEqual([
      'read.ts reads type, which is the type attribute, which the design says not to read',
    ]);
  });

  it('catches a type asked for by attribute name, which no dot announces', () => {
    expect(
      findings({ 'read.ts': "export const of = (s: Element) => s.getAttribute('type');" }),
    ).toEqual(['read.ts writes "type", which names the type attribute']);
  });

  it('catches a format probe, which names no attribute at all', () => {
    expect(
      findings({
        'read.ts': [
          'export const supports = (kind: string) =>',
          "  document.createElement('canvas').toDataURL(kind).startsWith('data:');",
        ].join('\n'),
      }),
    ).toEqual([
      'read.ts reads toDataURL, which is a probe for what a format decodes to',
      'read.ts writes "canvas", which names a canvas, which is how a page probes a format',
    ]);
  });

  it('catches a weight read off the timing API, which reads zero and looks like a number', () => {
    expect(
      findings({
        'explain.ts': [
          'export const weigh = (url: string) =>',
          "  performance.getEntriesByName(url)[0]?.transferSize ?? null;",
        ].join('\n'),
      }),
    ).toEqual([
      'explain.ts reads getEntriesByName, which is the timing API, whose transfer size is zero ' +
        'for most of the images on a page',
      'explain.ts reads performance, which is the timing API, whose transfer size is zero for ' +
        'most of the images on a page',
      'explain.ts reads transferSize, which is a weight a page cannot read for a cross-origin ' +
        'response, so a figure from it says nothing',
    ]);
  });

  it('catches a weight guessed from the pixels that arrived', () => {
    // The area is the guess. One dimension is a length core asks for, and the
    // second is the one that turns it into pixels-in-a-file.
    expect(
      findings({
        'explain.ts':
          'export const weigh = (img: HTMLImageElement) => ' +
          '`${img.naturalWidth * img.naturalHeight} b`;',
      }),
    ).toEqual([
      'explain.ts reads naturalHeight, which is the second dimension of a decoded file, which is ' +
        'what turns the first one into an area and an area into a guessed weight',
    ]);
  });

  it('catches a dimension taken apart by a destructuring, which no dot announces', () => {
    expect(
      findings({ 'explain.ts': 'export const weigh = ({ naturalHeight: h }) => `${h} b`;' }),
    ).toEqual([
      'explain.ts reads naturalHeight, which is the second dimension of a decoded file, which is ' +
        'what turns the first one into an area and an area into a guessed weight',
    ]);
  });

  it('lets the width through, which core asks for and one number cannot make an area of', () => {
    expect(
      findings({ 'read.ts': 'export const wide = (img: HTMLImageElement) => img.naturalWidth;' }),
    ).toEqual([]);
  });

  it('reads nothing out of a comment, which a regex over the text cannot help', () => {
    expect(
      findings({
        'read.ts': [
          '/** Never `source.type`, and never an image/avif question. */',
          '// A guess would read `img.naturalWidth * 0.25` and be a number.',
          'export const plain = true;',
        ].join('\n'),
      }),
    ).toEqual([]);
  });
});
