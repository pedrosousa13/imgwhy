import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

/**
 * Reading this repo's own source, for the tests that check a property of the
 * code rather than of a result.
 *
 * Two of those exist: `boundary.test.ts`, which checks what the runner package
 * may reach for, and the `no-estimate.test.ts` pair, which checks that no code
 * path turns a pixel dimension into a byte count. Both need the same three
 * things, and had them written out twice before this file held them once.
 */

/**
 * Every TypeScript file under `dir`, so a file added later is covered by
 * default — whichever of the three extensions it is written with.
 */
export function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.[cm]?ts$/.test(entry.name) ? [path] : [];
  });
}

/** One module's text, whole. */
export const read = (file: string): string => readFileSync(file, 'utf8');

/**
 * One module's syntax tree.
 *
 * A parser rather than a regex over the source text, for two reasons a regex
 * cannot be fixed to cover. A tree holds no comments, so a name or a specifier
 * written inside a doc comment is not a finding in a repo that comments this
 * much. And it holds every form a thing can be written in, rather than the
 * forms whoever wrote the pattern happened to think of.
 */
export const parse = (text: string): ts.SourceFile =>
  ts.createSourceFile('module.ts', text, ts.ScriptTarget.ESNext, true);
