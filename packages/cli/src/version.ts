import { readFileSync } from 'node:fs';

/**
 * Which release of imgwhy is running, read off the manifest npm installed.
 *
 * One module for it because two things need the same string and a second copy
 * is a second thing to forget: a Capture records it as `version.producedBy`,
 * so a diff can say it crossed a release boundary, and it is what `--version`
 * will print.
 *
 * `imgwhy`'s own `package.json` and not the workspace root's. This package is
 * the thing a user installs, so its `version` field is the number they have,
 * and the root manifest is private and stays at `0.0.0`.
 *
 * The URL resolves against this module rather than against the working
 * directory, so it names the package root from `src/` and from the emitted
 * `dist/` alike — one directory up from either. `files: ["dist"]` puts
 * `package.json` beside `dist` in the published package, which is what makes
 * the same path hold there.
 *
 * Read once, at load. A read per call would open the file on every capture,
 * and the version of a running process does not change under it.
 *
 * Nothing here defaults. A package with no readable `package.json` is a broken
 * install rather than a release with no number, and a throw at load says so
 * where a fallback string would put an untrue number in every Capture the
 * install went on to write.
 */
export const VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
