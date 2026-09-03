import { readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Refusing a build that is older than the source it was built from.
 *
 * A few tests read `dist` rather than `src`, and they have to: the command is
 * a program on disk, and the source a report ships is read out of the built
 * package rather than out of a transform of it. What they check is the
 * artifact, which means a stale artifact is a test checking last week's code.
 *
 * `npm test` cannot hit that — `pretest` builds first — and that is exactly
 * what makes it a trap. `npx vitest run <one file>` skips `pretest`, which is
 * how anyone reruns a single test while working on it, and a `dist` from
 * before the edit passes quietly. So the artifact's age is checked here rather
 * than assumed, and a run against a stale build fails saying so.
 *
 * It sits at the root, beside `source.ts` and `fixture-server.ts`, for the
 * reason those do: its readers are in two packages, and a check on the whole
 * workspace's build has no package to belong to.
 */

const packages = fileURLToPath(new URL('../packages/', import.meta.url));
const root = fileURLToPath(new URL('../', import.meta.url));

/** The file under `dir` written last, or null where `dir` holds nothing. */
function newest(dir: string): { path: string; at: number } | null {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  let found: { path: string; at: number } | null = null;
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    const at = entry.isDirectory() ? newest(path) : { path, at: statSync(path).mtimeMs };
    if (at !== null && (found === null || at.at > found.at)) found = at;
  }
  return found;
}

/**
 * Refuse to run against a build that does not match the source.
 *
 * Per package rather than across the workspace, because that is the comparison
 * that answers: `packages/report/dist` older than `packages/report/src` is a
 * stale report however recently core was built.
 *
 * Newest against newest, so a build that rewrote every output — which is what
 * `tsc` does — reads as current. A source file touched afterwards is what
 * fails, and touching one without changing it is a loud failure rather than a
 * quiet pass, which is the right way round for this.
 */
export function refuseStaleBuild(): void {
  for (const entry of readdirSync(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = newest(resolve(packages, entry.name, 'src'));
    if (src === null) continue;

    const dist = newest(resolve(packages, entry.name, 'dist'));
    if (dist === null) {
      throw new Error(
        `packages/${entry.name}/dist is missing, and this test reads it — run \`npm run build\``,
      );
    }
    if (src.at > dist.at) {
      throw new Error(
        `${relative(root, src.path)} is newer than packages/${entry.name}/dist, and this test ` +
          'reads the build rather than the source — run `npm run build`',
      );
    }
  }
}
