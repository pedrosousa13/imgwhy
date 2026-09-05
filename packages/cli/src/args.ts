/**
 * Both forms, because either parser prints this and a reader refused by one of
 * them has no way to know the other exists.
 */
export const USAGE =
  'usage: imgwhy [--json] [--device <ids>] [--out <file>] [--report <file>] <url>\n' +
  '       imgwhy diff <before.json> <after.json>';

export type ParsedArgs =
  | {
      ok: true;
      url: string;
      json: boolean;
      out: string | null;
      report: string | null;
      /**
       * The device ids the line asked for, or null for the whole set. The ids
       * are not checked here: what ids exist is the config file's to say, and
       * this parser reads no file.
       */
      devices: string[] | null;
    }
  | { ok: false; message: string };

const fail = (message: string): ParsedArgs => ({ ok: false, message: `${message}\n${USAGE}` });

/** The options that name a file, and the file each one has been given. */
type Paths = Record<'--out' | '--report', string | null>;

/**
 * Read the command line: one URL, two options that say where the Capture goes,
 * and one that says which devices render it.
 *
 * The surface is four arguments, so it is read here rather than through a
 * parsing library. The rules are the whole of it:
 *
 * - Options may sit either side of the URL. Nothing here is positional except
 *   the URL itself and the value an option takes.
 * - `--json`, `--out` and `--report` are independent. One names the format
 *   stdout gets, the other two name files, and asking for all three produces
 *   all three from the one run. None is the default: text on stdout is.
 * - `--device` names a comma-separated list of device ids, which `run` reads
 *   as a filter over the set it loaded. Absent, every device renders.
 * - `--out` and `--report` each take the next argument, which may not be
 *   missing and may not look like another option. Consuming an option there
 *   would write a file named `--json` and leave the run looking like it
 *   worked.
 * - Each is given once, and a second one is refused by name. A line naming
 *   two paths asks for two files; keeping the last of them would drop a file
 *   the person asked for and say nothing, which is the one thing this parser
 *   does nowhere else.
 * - An unrecognised `-` argument is refused by name. It is a typo far more
 *   often than it is a URL, and guessing would open a browser on it.
 *
 * The URL itself is not checked here. `parsePageUrl` does that, so a run
 * rejects a `file:` URL with the same words whatever else was on the line.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  let url: string | null = null;
  let json = false;
  let devices: string[] | null = null;
  const paths: Paths = { '--out': null, '--report': null };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    // One branch for both, because the two rules are the same rules and a
    // second copy of them is a second place for them to drift apart.
    if (arg === '--out' || arg === '--report') {
      if (paths[arg] !== null) return fail(`${arg} was given twice, and a run writes one file`);
      const path = argv[i + 1];
      if (path === undefined || path.startsWith('-')) {
        return fail(`${arg} needs a file path after it`);
      }
      paths[arg] = path;
      i++;
      continue;
    }
    // Beside that branch rather than inside it. The mechanics look the same —
    // take the next argument, refuse a second one — but the words are not: a
    // path option refuses a second path because a run writes one file, and
    // this one because a run renders one device set. Folding them together
    // would cost both messages their reason and leave one that names neither.
    if (arg === '--device') {
      if (devices !== null) {
        return fail('--device was given twice, and a run renders one device set');
      }
      const ids = argv[i + 1];
      if (ids === undefined || ids.startsWith('-')) {
        return fail('--device needs one or more device ids after it');
      }
      devices = ids.split(',');
      i++;
      continue;
    }
    if (arg.startsWith('-')) return fail(`imgwhy has no ${arg} option`);
    if (url !== null) return { ok: false, message: USAGE };
    url = arg;
  }

  if (url === null) return { ok: false, message: USAGE };
  return { ok: true, url, json, out: paths['--out'], report: paths['--report'], devices };
}
