import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { refuseStaleBuild } from '../../../test/built.js';
import { REFUSED_IMPORT, reaches } from '../../../test/source.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');

/**
 * The emitted output, read as the only thing Chrome ever loads.
 *
 * Every other check in this directory reads `src`, and for the reasons each of
 * them gives: dormancy, privacy and the absence of a second copy of the
 * arithmetic are all properties of the source, and a property of the source is
 * where they belong. This one cannot be. What Chrome loads is `dist`, the
 * specifiers in it are `tsc`'s rather than ours, and the extension shipped
 * unloadable with the whole suite green: `src/explain.ts` imports
 * `@imgwhy/core`, which Node resolves through the workspace and `tsc` resolves
 * through `package.json` — and which a Manifest V3 service worker resolves not
 * at all, because there is no import map for an extension worker to resolve a
 * bare specifier against. The worker failed at load and the toolbar click did
 * nothing.
 *
 * So the reading is over the artifact, and it is the whole import graph rather
 * than the entry alone. A worker fails at load on the first specifier anywhere
 * under it that does not resolve, which makes the interesting file the one two
 * hops down: `scripts/build.mjs` copies core's emitted JavaScript into
 * `dist/core`, and a copy missing one of its own siblings is a worker that
 * fails exactly as loudly as a bare specifier does.
 */

/** A module graph as this reading walks one: a path → its text, or nothing. */
type Read = (path: string) => string | null;

const onDisk: Read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

/** What one walk of a graph found: the modules it read, and the ways it broke. */
type Walk = {
  /** Every module reached, named the way the entry's own directory names it. */
  files: string[];
  /** Every reason Chrome would refuse to load it, one line each. */
  findings: string[];
};

/**
 * Walk one module graph the way a browser loads it, and report every specifier
 * it cannot follow.
 *
 * Two things are refused, and they are the two a loader refuses:
 *
 * - A specifier that is not relative. `'@imgwhy/core'`, `'node:fs'` and
 *   `'./core/index.js'` are three different things to a resolver, and only the
 *   third is one an extension worker has. A bare specifier is refused by
 *   shape rather than by name, so the next one cannot arrive by being
 *   forgotten — which is how this one arrived.
 * - A specifier that resolves to no file. `tsc` writes the extension's own
 *   imports and they are always there; the copy of core is written by the
 *   build script, and a copy is a thing that can be incomplete.
 *
 * `reaches` reads the specifiers out of a syntax tree rather than out of the
 * text, which is what keeps the `@imgwhy/core` written in `explain.js`'s own
 * doc comment from reading as an import — the emitted files keep their
 * comments.
 *
 * `at` is a reader rather than the filesystem so the table below can hold a
 * broken graph without writing one to disk.
 */
function walk(entry: string, at: Read): Walk {
  const named = (path: string): string => relative(dirname(entry), path).split(sep).join('/');

  const files: string[] = [];
  const findings: string[] = [];
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (seen.has(path)) continue;
    seen.add(path);

    const text = at(path);
    if (text === null) {
      findings.push(`${named(path)} is imported and is not there`);
      continue;
    }
    files.push(named(path));

    const { specifiers, refused } = reaches(text);
    findings.push(...refused.map((why) => `${named(path)} ${why}`));

    for (const specifier of specifiers) {
      if (!/^\.\.?\//.test(specifier)) {
        findings.push(
          `${named(path)} imports ${specifier}, which is bare, and a service worker resolves none`,
        );
        continue;
      }
      queue.push(resolve(dirname(path), specifier));
    }
  }

  return { files, findings };
}

/** The worker Chrome is pointed at, taken from the manifest rather than named here. */
function workerPath(): string {
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as {
    background: { service_worker: string };
  };
  return resolve(root, manifest.background.service_worker);
}

/**
 * The built extension, as the browser resolves it.
 *
 * `manifest.test.ts` already reads the manifest, and holds that the path it
 * declares is a file that exists. This starts from the same path rather than
 * from a `dist/background.js` written out again, so the two cannot drift: a
 * renamed output is one failure there and this walk reading a different file
 * is not one of the ways it can go wrong.
 */
describe('the built extension, walked the way a service worker loads it', () => {
  const { files, findings } = walk(workerPath(), onDisk);

  it('read the worker and the whole graph under it, so nothing below passes for want of a file', () => {
    // `pretest` runs the build, so the artifact is there; `refuseStaleBuild`
    // is what refuses one older than the source, which is how a single-file
    // `npx vitest run` would otherwise read last week's output.
    refuseStaleBuild();

    expect(files).toContain('background.js');
    expect(files.length).toBeGreaterThan(1);
  });

  it('resolves every import to a file that is there, all the way down', () => {
    expect(findings).toEqual([]);
  });

  it('reaches core through the copy in its own directory, which is the point of the copy', () => {
    // The specifier the worker's graph names for core is a relative path into
    // `dist`, not the package name the source writes. If this stops holding,
    // either the build step stopped running or something bundled instead.
    expect(files).toContain('core/index.js');
  });
});

/**
 * The reading, given the emitted outputs it exists to refuse.
 *
 * Each entry is a real way the built extension fails to load, and they are
 * held here rather than tried in Chrome and reverted, so the failure each one
 * should cause is a passing test instead of a note in a commit message. The
 * first is the bug this file was written for.
 */
describe('the emitted reading, given output a service worker cannot load', () => {
  /** A graph in memory, keyed the way `dist` names its own files. */
  const graph = (files: Record<string, string>): Read => {
    const held = new Map(Object.entries(files).map(([name, text]) => [resolve(dist, name), text]));
    return (path) => held.get(path) ?? null;
  };

  const entry = resolve(dist, 'background.js');

  const attacks: [string, Record<string, string>, string[]][] = [
    [
      'the package name, which is what shipped and what nothing before this noticed',
      {
        'background.js': "import { panelOf } from './explain.js';",
        'explain.js': "import { explainSelection } from '@imgwhy/core';",
      },
      ['explain.js imports @imgwhy/core, which is bare, and a service worker resolves none'],
    ],
    [
      'a Node built-in, bare by the same shape and absent for a second reason',
      { 'background.js': "import { readFileSync } from 'node:fs';" },
      ['background.js imports node:fs, which is bare, and a service worker resolves none'],
    ],
    [
      'a copy of core missing one of its own siblings, two hops under the worker',
      {
        'background.js': "import { panelOf } from './explain.js';",
        'explain.js': "import { explainSelection } from './core/index.js';",
        'core/index.js': "export { selectCandidate } from './select.js';",
      },
      ['core/select.js is imported and is not there'],
    ],
    [
      'a worker the manifest names and the build did not write',
      { 'explain.js': 'export const panelOf = () => null;' },
      ['background.js is imported and is not there'],
    ],
    [
      'a specifier computed at run time, which no reading of the text can follow',
      { 'background.js': "const at = './pan' + 'el.js';\nawait import(at);" },
      [`background.js ${REFUSED_IMPORT}`],
    ],
    [
      'the arrangement that ships: relative all the way down, and every file there',
      {
        'background.js': "import { panelOf } from './explain.js';",
        'explain.js': "import { explainSelection } from './core/index.js';",
        'core/index.js': "export { selectCandidate } from './select.js';",
        'core/select.js': 'export const selectCandidate = () => null;',
      },
      [],
    ],
  ];

  it.each(attacks)('catches %s', (_route, files, expected) => {
    expect(walk(entry, graph(files)).findings).toEqual(expected);
  });

  it('reads no import out of a comment, which the emitted files keep', () => {
    const commented = [
      "/** `explain.ts` imports `@imgwhy/core` and this is the copy of it. */",
      "// A bare one would read `from '@imgwhy/core'`.",
      'export const panelOf = () => null;',
      '//# sourceMappingURL=background.js.map',
    ].join('\n');

    expect(walk(entry, graph({ 'background.js': commented })).findings).toEqual([]);
  });
});
