#!/usr/bin/env node
// Build every workspace, in dependency order.
//
// `npm run build --workspaces` is not topologically sorted — it follows the
// order the `packages/*` glob resolves in, which is alphabetical, and that put
// the command before the packages it imports. So the order lives here instead.
//
// ADDING A PACKAGE: put its name in BUILD_ORDER, after every package it
// imports. The check below refuses to build until you do, so a new package
// cannot be silently skipped the way `--workspaces` would skip nothing and
// build it too early.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Dependency order. `imgwhy` imports every other package, so it goes last. */
const BUILD_ORDER = ['@imgwhy/core', '@imgwhy/runner', '@imgwhy/report', 'imgwhy'];

const root = new URL('../', import.meta.url);
const packages = new URL('packages/', root);

const named = readdirSync(packages, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map(
    (entry) =>
      JSON.parse(readFileSync(new URL(`${entry.name}/package.json`, packages), 'utf8')).name,
  );

const unordered = named.filter((name) => !BUILD_ORDER.includes(name));
if (unordered.length > 0) {
  console.error(
    `scripts/build.mjs: ${unordered.join(', ')} ${unordered.length === 1 ? 'is a workspace' : 'are workspaces'} that BUILD_ORDER does not name.\n` +
      'Add it to BUILD_ORDER, after every package it imports, and build again.',
  );
  process.exit(1);
}

// `--if-present` so a package without a build script is skipped rather than
// failing the build. npm runs the `-w` filters in the order they are given.
const build = BUILD_ORDER.filter((name) => named.includes(name)).flatMap((name) => ['-w', name]);
execFileSync('npm', ['run', 'build', '--if-present', ...build], {
  cwd: fileURLToPath(root),
  stdio: 'inherit',
});
