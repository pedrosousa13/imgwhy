import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { sources } from '../../../test/source.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = resolve(root, 'src');

/** The two projects `npm run typecheck` runs, in the order it runs them. */
const PROJECTS = ['tsconfig.json', 'tsconfig.test.json'];

/**
 * Every file one project makes a *root* of its program.
 *
 * Roots rather than the whole program, and the distinction is the point. A
 * module arrives in a program two ways: by being named in `files` or
 * `include`, or by being imported from something that was. An ambient
 * declaration can only arrive the first way, because nothing imports it — that
 * is what makes it ambient — so a project that does not name one simply does
 * not have it, and every global it declares is missing with no import anywhere
 * to explain why.
 *
 * `tsconfig.test.json` shipped like that. It included `test` alone, which is
 * what the other packages' test projects include and is right for all of them:
 * their `src` arrives through the imports their tests write. This package's
 * `src/chrome.d.ts` does not, so `src/background.ts` came in through
 * `click.test.ts` while the declaration of `chrome` stayed out, and the project
 * failed with `Cannot find name 'chrome'` on a clean checkout while passing
 * whenever a build had left a `dist` behind to resolve against.
 */
function rootsOf(name: string): string[] {
  const path = resolve(root, name);
  const file = ts.readConfigFile(path, (at) => readFileSync(at, 'utf8'));
  if (file.error !== undefined) throw new Error(String(file.error.messageText));

  const parsed = ts.parseJsonConfigFileContent(file.config, ts.sys, root, undefined, path);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((error) => String(error.messageText)).join('\n'));
  }
  return parsed.fileNames.map((at) => resolve(at));
}

/** Every ambient declaration under `src`, which nothing imports by design. */
const ambient = (): string[] => sources(src).filter((file) => file.endsWith('.d.ts'));

/**
 * The two projects, checked against the one way this package's typecheck can
 * quietly stop being a check.
 *
 * It failed here, and it failed after passing: build-then-typecheck was green
 * and typecheck alone was not, because a `dist` left behind by an earlier
 * build was there to resolve against. That is the shape of bug the rest of
 * this directory exists to catch — a property that holds today and holds for a
 * reason nobody wrote down — so it is written down.
 *
 * The check is over the projects' own file lists rather than over a `tsc` run,
 * because a run needs a compilation and the question is only which files reach
 * one.
 */
describe('the two projects the typecheck runs', () => {
  it('has an ambient declaration to check, so nothing below passes for want of one', () => {
    expect(ambient().map((file) => relative(src, file))).toEqual(['chrome.d.ts']);
  });

  it.each(PROJECTS)('makes every ambient declaration a root of %s', (name) => {
    const roots = rootsOf(name);
    const unseen = ambient()
      .filter((file) => !roots.includes(file))
      .map((file) => relative(root, file).split(sep).join('/'));

    expect(unseen).toEqual([]);
  });

  it.each(PROJECTS)('names no file under dist in %s, so neither leans on a build', (name) => {
    const dist = resolve(root, 'dist') + sep;

    expect(rootsOf(name).filter((file) => file.startsWith(dist))).toEqual([]);
  });
});
