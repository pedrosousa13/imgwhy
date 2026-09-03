import { writeFileSync } from 'node:fs';
import type { Capture } from '@imgwhy/core';

export type Written = { ok: true } | { ok: false; message: string };

/**
 * The Capture as the file and the stream both carry it.
 *
 * Indented, because a Capture is a file people keep and diff: a diff of two
 * runs should point at the image that changed, not at one very long line. One
 * function, so `--json` and `--out` cannot drift into two formats.
 */
export const serializeCapture = (capture: Capture): string =>
  `${JSON.stringify(capture, null, 2)}\n`;

/**
 * Write a Capture to the path `--out` named, and to nothing else.
 *
 * Unlike the config file, this boundary needs no confinement, and confining it
 * would be wrong. Reading is where a path check earns its place: the name
 * `imgwhy.config.json` is a name an untrusted repository can control, through
 * a symlink, and imgwhy would read a secret and quote it in an error. Writing
 * runs the other way. The only thing that reaches `path` is an argument the
 * person at the keyboard typed, and `--out ~/captures/today.json` is exactly
 * what the design promises: "The command line writes only to the path you
 * name." Refusing an absolute path would refuse the ordinary use.
 *
 * So the property to hold is not confinement but provenance: no part of the
 * path may come from the page. Nothing from the URL, from `Capture.url` — the
 * URL a redirect chose, which a hostile host controls — from a response, or
 * from the Capture may reach this function. `path` arrives from `parseArgs`
 * and goes to `writeFileSync` unchanged: not joined, not resolved, not
 * defaulted from anything. That is why there is no second parameter here, and
 * why adding one that derives a name would be the bug to watch for.
 *
 * A path that cannot be written is a message, not a throw. The caller has a
 * trace to suppress: a run that failed to produce the file it was asked for
 * should not also print as if it had worked.
 */
export function writeCapture(path: string, capture: Capture): Written {
  try {
    writeFileSync(path, serializeCapture(capture), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `${path} could not be written: ${message}` };
  }
  return { ok: true };
}
