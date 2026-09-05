import { USAGE } from './args.js';
import { compareCaptures, formatComparison } from './compare.js';
import { readCapture } from './in.js';
import type { Outcome } from './run.js';

const fail = (message: string): Outcome => ({ code: 1, stdout: '', stderr: `${message}\n` });

/** The two files a diff has, or the message that says the line named something else. */
type Sides = { ok: true; before: string; after: string } | { ok: false; message: string };

/**
 * Read the diff's own command line: two paths, and nothing else.
 *
 * Its own parser rather than a mode of `parseArgs`, which is the decision the
 * issue records and the reason `parseArgs`'s comment gives for hand-parsing in
 * the first place: "the surface is three arguments". That stays true of the
 * command that comment describes only if a second command reads its own line,
 * and a parser answering to two grammars is a parser whose messages have to
 * name which one they are refusing against.
 *
 * The two rules are the whole of it. Both paths are positional, so an argument
 * beginning with `-` is refused by name rather than opened — a diff takes no
 * options, and a typo read as a file name would be reported as a file that
 * could not be read. Two paths and no more: a third would leave a reader to
 * guess which two of the three were compared.
 */
function sides(argv: string[]): Sides {
  for (const arg of argv) {
    if (arg.startsWith('-')) return { ok: false, message: `imgwhy diff has no ${arg} option` };
  }
  if (argv.length !== 2) return { ok: false, message: '' };
  return { ok: true, before: argv[0], after: argv[1] };
}

/**
 * Read two Captures back and say what changed between them.
 *
 * Every field of both files is checked before anything reads one, which is
 * `readCapture`'s job and stated there: a Capture is a file a person may have
 * been sent, and every string in it came off somebody's page. A file that
 * fails a check ends the run at the message naming the field, and the earlier
 * of the two is read first so that a reader fixing two broken files is told
 * about the first of them rather than the second.
 *
 * ## The status
 *
 * Always 0 where both files read, and a regression does not change that. Non-
 * zero is what a caller reads as "this command could not do its job", and the
 * job here is to report: a Capture that would not parse or a path that would
 * not open is a failure, and a bigger file is a finding. A caller wanting the
 * gate today has it in one line, `imgwhy diff a.json b.json | grep -q
 * regressed`, and it becomes worth building in once the tool can say why
 * something regressed rather than only that it did.
 *
 * ## The paths
 *
 * Both come off the command line and go to `readCapture` unchanged. Nothing
 * read out of either Capture is joined, resolved or opened, and this module
 * names no module that could build a path to try it with — `compare.test.ts`
 * reads that off the source rather than trusting the sentence, which is the
 * check `in.test.ts` makes of the reader for the same reason.
 */
export function runDiff(argv: string[]): Outcome {
  const named = sides(argv);
  if (!named.ok) return fail(named.message ? `${named.message}\n${USAGE}` : USAGE);

  const before = readCapture(named.before);
  if (!before.ok) return fail(before.message);

  const after = readCapture(named.after);
  if (!after.ok) return fail(after.message);

  const comparison = compareCaptures(before.capture, after.capture);
  return { code: 0, stdout: `${formatComparison(comparison)}\n`, stderr: '' };
}
