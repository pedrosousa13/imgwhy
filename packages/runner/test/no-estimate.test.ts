import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('../src', import.meta.url));

/** Every TypeScript file under `src`, so a file added later is covered too. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.[cm]?ts$/.test(entry.name) ? [path] : [];
  });
}

const parse = (text: string): ts.SourceFile =>
  ts.createSourceFile('module.ts', text, ts.ScriptTarget.ESNext, true);

/** Every expression a property of this name is given, as written. */
function given(name: string, text: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText() === name) {
      found.push(node.initializer.getText());
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return found;
}

/** Every name one module writes, whether declared, read or reached through. */
function names(text: string): Set<string> {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) found.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return found;
}

/** Every `*` and `/` one module performs, as written. */
function scaling(text: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken ||
        node.operatorToken.kind === ts.SyntaxKind.SlashToken)
    ) {
      found.push(node.getText());
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(text));
  return found;
}

/**
 * Every measurement of an image that is not a byte count. A guess at weight
 * is built out of these, so a module that produces byte counts must name none
 * of them.
 */
const DIMENSIONS = [
  'naturalWidth',
  'naturalHeight',
  'renderedWidth',
  'width',
  'height',
  'dpr',
  'deviceScaleFactor',
  'viewport',
];

/**
 * The design's non-goal, as a check rather than an inspection:
 *
 * > **Estimated bytes.** Where `transferBytes` is null, report it as unknown.
 * > Do not guess from pixel dimensions.
 *
 * A guess would read exactly like a measurement in the output, which is why
 * this is checked in the source and not only in a result. Two properties hold
 * it: `transferBytes` takes its value in one place, and that one place is a
 * module with no pixel dimension in it and no arithmetic to scale one by.
 */
describe('the transfer size, checked against estimation', () => {
  const read = (file: string): string => readFileSync(file, 'utf8');
  const transfers = resolve(src, 'transfers.ts');

  it('gives transferBytes one source across the package, the recorded transfer', () => {
    const sourced = sources(src).flatMap((file) =>
      given('transferBytes', read(file)).map(
        (expression) => `${relative(src, file)}: ${expression}`,
      ),
    );

    expect(sourced).toEqual(['capture.ts: transfers.bytesFor(image.currentSrc)']);
  });

  it('names no measurement but bytes in the module that records them', () => {
    const named = names(read(transfers));

    expect(DIMENSIONS.filter((dimension) => named.has(dimension))).toEqual([]);
    // The check reads the module it meant to read, rather than passing on a
    // renamed file it never opened.
    expect(named.has('encodedDataLength')).toBe(true);
  });

  it('scales nothing in the module that records them', () => {
    expect(scaling(read(transfers))).toEqual([]);
  });
});
