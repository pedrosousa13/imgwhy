import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse, read, sources } from '../../../test/source.js';

const src = fileURLToPath(new URL('../src', import.meta.url));

/**
 * The fields of a `CapturedImage` that carry pixels.
 *
 * A byte count guessed from a pixel dimension needs a pixel dimension, and
 * these are the only two a Capture offers. So the rule this file holds is not
 * "do not guess" — which is a rule about intent, and unwritable — but "do not
 * have the ingredients", which is a rule about reach.
 */
const DIMENSIONS = ['naturalWidth', 'renderedWidth'];

/** Every read of a pixel dimension in one module, one line each. */
function reads(name: string, text: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && DIMENSIONS.includes(node.name.text)) {
      found.push(`${name} reads ${node.name.text}`);
    }
    // `const { naturalWidth } = image`, which names the field without a dot.
    if (ts.isBindingElement(node)) {
      const bound = node.propertyName ?? node.name;
      if (ts.isIdentifier(bound) && DIMENSIONS.includes(bound.text)) {
        found.push(`${name} reads ${bound.text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return found;
}

const estimating = (modules: Record<string, string>): string[] =>
  Object.entries(modules).flatMap(([name, text]) => reads(name, text));

/**
 * The design's non-goal, as a check rather than an inspection:
 *
 * > **Estimated bytes.** Where `transferBytes` is null, report it as unknown.
 * > Do not guess from pixel dimensions.
 *
 * This is the third place the constraint is held, and the cheapest of them,
 * because this package needs no pixel dimension for anything. The runner's
 * half guards where the figure is measured; the command's half guards the
 * column it prints, and has to be intricate because `trace.ts` legitimately
 * multiplies dimensions by a device ratio — that arithmetic is the whole tool.
 * The report does none of it: the arithmetic happens in `explainSelection`,
 * behind core's door, and what comes back is a candidate. So a dimension in
 * this package would have arrived for some other purpose, and the only one on
 * offer is the guess the design refuses.
 */
describe('the report package, checked against estimating bytes', () => {
  const modules: Record<string, string> = Object.fromEntries(
    sources(src).map((file) => [relative(src, file).split(/[\\/]/).join('/'), read(file)]),
  );

  it('has sources to check, so nothing below passes for want of a file', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });

  it('reads no pixel dimension at all, so it has nothing to guess a weight from', () => {
    expect(estimating(modules)).toEqual([]);
  });

  it('prints unknown where the runner recorded nothing, and no figure', () => {
    expect(modules['report.ts']).toContain("transferBytes === null ? 'unknown'");
  });
});

/**
 * The check, read against a report written to guess anyway.
 *
 * Held here rather than tried on a branch and reverted, so the failure they
 * should cause is a passing test instead of a note in a commit message.
 */
describe('the estimation check, given a report that guesses anyway', () => {
  it('is quiet about the arrangement that ships', () => {
    expect(
      estimating({
        'report.ts': `const bytesArrived = (transferBytes: number | null): string =>
          transferBytes === null ? 'unknown' : \`\${transferBytes} bytes\`;`,
      }),
    ).toEqual([]);
  });

  it('catches a weight computed from the pixels that arrived', () => {
    expect(
      estimating({
        'report.ts': `const bytesArrived = (image) =>
          image.transferBytes ?? \`about \${Math.round(image.naturalWidth * 0.25)} bytes\`;`,
      }),
    ).toEqual(['report.ts reads naturalWidth']);
  });

  it('catches a dimension taken apart by a destructuring, which no dot announces', () => {
    expect(
      estimating({
        'report.ts': 'const weigh = ({ naturalWidth }) => `${naturalWidth * 4} bytes`;',
      }),
    ).toEqual(['report.ts reads naturalWidth']);
  });

  it('catches a dimension renamed on the way out of a destructuring', () => {
    expect(
      estimating({
        'report.ts': 'const weigh = ({ renderedWidth: w }) => `${w * 4} bytes`;',
      }),
    ).toEqual(['report.ts reads renderedWidth']);
  });

  it('catches a second module reaching for one, which one file read cannot', () => {
    expect(
      estimating({
        'weights.ts': 'export const weigh = (image) => image.naturalWidth * 4;',
      }),
    ).toEqual(['weights.ts reads naturalWidth']);
  });

  it('reads nothing out of a comment, which a regex over the text cannot help', () => {
    expect(
      estimating({
        'report.ts': `/** Never \`image.naturalWidth * 0.25\`, and never a guess. */
          export const plain = true;`,
      }),
    ).toEqual([]);
  });
});
