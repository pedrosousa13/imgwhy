import { readFileSync } from 'node:fs';

/**
 * Which release of imgwhy is running, read off the manifest npm installed.
 *
 * What reads it today is `run.ts`, which hands it to the runner: a Capture
 * records the string as `version.producedBy`, so a diff can say it crossed a
 * release boundary. A module rather than a literal in `run.ts` because #73's
 * `--version` needs the same string, and a second copy of it is a second thing
 * to forget.
 *
 * `imgwhy`'s own `package.json` and not the workspace root's. `imgwhy` is the
 * package that gets published, so its `version` field is the number a release
 * would bump; the root manifest is private and is never published. No release
 * has been cut yet, so what a Capture records today is `0.0.0` — and a diff
 * can only say two Captures crossed a boundary once that number moves.
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
