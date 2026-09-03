import { writeFileSync } from 'node:fs';
import type { Capture } from '@imgwhy/core';
import { renderReport } from '@imgwhy/report';
import { messageOf } from './message.js';

export type WrittenFile = { ok: true } | { ok: false; message: string };

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
 * Write text to the path an option named, and to nothing else.
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
 * defaulted from anything. The name comes from `path` and from nowhere else:
 * no other parameter here feeds it, and adding one that derived a name from
 * the page would be the bug to watch for.
 *
 * It is one function for both artifacts so that the property is held in one
 * place. A second writer would be a second place to get it wrong, and the
 * report is the artifact people mail to each other — so a page that could
 * choose its name could choose what a colleague opens.
 *
 * A path that cannot be written is a message, not a throw. The caller has a
 * trace to suppress: a run that failed to produce the file it was asked for
 * should not also print as if it had worked.
 */
function write(path: string, contents: string): WrittenFile {
  try {
    writeFileSync(path, contents, 'utf8');
  } catch (error) {
    return { ok: false, message: `${path} could not be written: ${messageOf(error)}` };
  }
  return { ok: true };
}

/** Write a Capture to the path `--out` named. */
export const writeCapture = (path: string, capture: Capture): WrittenFile =>
  write(path, serializeCapture(capture));

/**
 * Write the report to the path `--report` named.
 *
 * One file and no sidecar asset, because the report has none: `renderReport`
 * returns a whole document with every style inlined. The command's part is the
 * path and the bytes reaching disk, and nothing about the markup — that is the
 * report package's, which the command never second-guesses.
 */
export const writeReport = (path: string, capture: Capture): WrittenFile =>
  write(path, renderReport(capture));
