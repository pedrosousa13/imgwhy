import { describe, expect, it } from 'vitest';
import { USAGE, parseArgs } from '../src/args.js';

const rejected = (argv: string[]): string => {
  const result = parseArgs(argv);
  if (result.ok) throw new Error(`expected ${JSON.stringify(argv)} to be rejected`);
  return result.message;
};

describe('parseArgs', () => {
  it('takes one URL and asks for human text', () => {
    expect(parseArgs(['https://example.com'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: false,
      out: null,
    });
  });

  it('reads --json as the stdout format', () => {
    expect(parseArgs(['--json', 'https://example.com'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: true,
      out: null,
    });
  });

  it('reads --out with the path that follows it', () => {
    expect(parseArgs(['--out', 'capture.json', 'https://example.com'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: false,
      out: 'capture.json',
    });
  });

  it('takes the flags after the URL as readily as before it', () => {
    expect(parseArgs(['https://example.com', '--json', '--out', 'capture.json'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: true,
      out: 'capture.json',
    });
  });

  it('takes --json and --out together, because they name two different sinks', () => {
    expect(parseArgs(['--json', '--out', 'capture.json', 'https://example.com'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: true,
      out: 'capture.json',
    });
  });

  it('leaves a path holding spaces or an equals sign alone', () => {
    expect(parseArgs(['--out', 'my captures/a=b.json', 'https://example.com'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: false,
      out: 'my captures/a=b.json',
    });
  });

  it('prints usage when no URL is given', () => {
    expect(rejected([])).toBe(USAGE);
  });

  it('prints usage when a second URL is given, because a run measures one page', () => {
    expect(rejected(['https://example.com', 'https://example.org'])).toBe(USAGE);
  });

  it('names the option it does not know', () => {
    expect(rejected(['--verbose', 'https://example.com'])).toBe(
      `imgwhy has no --verbose option\n${USAGE}`,
    );
  });

  it('refuses --out with nothing after it', () => {
    expect(rejected(['https://example.com', '--out'])).toBe(
      `--out needs a file path after it\n${USAGE}`,
    );
  });

  it('refuses to treat the next option as the --out path', () => {
    // Without this, `imgwhy --out --json <url>` would quietly write a file
    // named `--json` and print no JSON at all. A real path starting with a
    // dash is still reachable, written as `./-name`.
    expect(rejected(['--out', '--json', 'https://example.com'])).toBe(
      `--out needs a file path after it\n${USAGE}`,
    );
  });
});
