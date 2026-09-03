export const USAGE = 'usage: imgwhy [--json] [--out <file>] <url>';

export type ParsedArgs =
  | { ok: true; url: string; json: boolean; out: string | null }
  | { ok: false; message: string };

const fail = (message: string): ParsedArgs => ({ ok: false, message: `${message}\n${USAGE}` });

/**
 * Read the command line: one URL, and two options that say where the Capture
 * goes.
 *
 * The surface is three arguments, so it is read here rather than through a
 * parsing library. The rules are the whole of it:
 *
 * - Options may sit either side of the URL. Nothing here is positional except
 *   the URL itself and the path `--out` takes.
 * - `--json` and `--out` are independent. One names the format stdout gets,
 *   the other names a file, and asking for both writes the same Capture to
 *   both. Neither is the default: text on stdout is.
 * - `--out` takes the next argument, which may not be missing and may not look
 *   like another option. Consuming an option there would write a file named
 *   `--json` and leave the run looking like it worked.
 * - An unrecognised `-` argument is refused by name. It is a typo far more
 *   often than it is a URL, and guessing would open a browser on it.
 *
 * The URL itself is not checked here. `parsePageUrl` does that, so a run
 * rejects a `file:` URL with the same words whatever else was on the line.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let url: string | null = null;
  let json = false;
  let out: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--out') {
      const path = argv[i + 1];
      if (path === undefined || path.startsWith('-')) {
        return fail('--out needs a file path after it');
      }
      out = path;
      i++;
      continue;
    }
    if (arg.startsWith('-')) return fail(`imgwhy has no ${arg} option`);
    if (url !== null) return { ok: false, message: USAGE };
    url = arg;
  }

  if (url === null) return { ok: false, message: USAGE };
  return { ok: true, url, json, out };
}
