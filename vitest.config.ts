import { defineConfig } from 'vitest/config';

/**
 * Load the built `@imgwhy/core` as it ships, rather than as a transform of it.
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
 * Naming the path rather than the package is deliberate. It sends every
 * importer of `@imgwhy/core` to the built package, which is what they resolve
 * to in production, and leaves core's own unit tests alone: they import
 * `../src`, and testing the source is their job. `pretest` runs the build, so
 * the artifact is always there and always current.
 */
export default defineConfig({
  test: {
    server: {
      deps: {
        external: [/[\\/]packages[\\/]core[\\/]dist[\\/]/],
      },
    },
  },
});
