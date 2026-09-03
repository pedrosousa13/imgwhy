import { defineConfig } from 'vitest/config';

/**
 * Load the built packages as they ship, rather than as a transform of them.
 *
 * Vitest inlines a workspace package by default and rewrites it on the way in,
 * so a call across two of core's modules arrives as
 * `__vite_ssr_import_0__.selectCandidate(…)` rather than as `selectCandidate(…)`.
 * That is invisible to a test that only calls core, and fatal to the one thing
 * the report does with it: `coreSource()` reads the source of the functions
 * themselves, so a rewritten body is what the report would ship. A test would
 * then be checking a document nobody is ever served — the command runs on Node,
 * against `packages/core/dist`, with no transform anywhere.
 *
 * `report` is here for the same reason and not a different one. `script.ts`
 * writes `String(readPanel)` into the emitted file, so the report's own source
 * text ships too, and the copy a reader gets is the one `tsc` emitted rather
 * than the one Vite rewrote. Without this, `in-page.test.ts` would read the
 * built copy through a transform and prove nothing about it.
 *
 * Naming the paths rather than the packages is deliberate. It sends every
 * importer of `@imgwhy/core` and `@imgwhy/report` to the built package, which
 * is what they resolve to in production, and leaves each package's own unit
 * tests alone: they import `../src`, and testing the source is their job.
 * `pretest` runs the build, so the artifact is always there — and where a test
 * reaches for `dist` directly, `test/built.ts` refuses one that is older than
 * the source it came from.
 */
export default defineConfig({
  test: {
    server: {
      deps: {
        external: [/[\\/]packages[\\/](?:core|report)[\\/]dist[\\/]/],
      },
    },
  },
});
