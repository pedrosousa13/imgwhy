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
      report: null,
      devices: null,
    });
  });

  it('reads --json as the stdout format', () => {
    expect(parseArgs(['--json', 'https://example.com'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: true,
      out: null,
      report: null,
      devices: null,
    });
  });

  it('reads --out with the path that follows it', () => {
    expect(parseArgs(['--out', 'capture.json', 'https://example.com'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: false,
      out: 'capture.json',
      report: null,
      devices: null,
    });
  });

  it('reads --report with the path that follows it', () => {
    expect(parseArgs(['--report', 'report.html', 'https://example.com'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: false,
      out: null,
      report: 'report.html',
      devices: null,
    });
  });

  it('takes the flags after the URL as readily as before it', () => {
    expect(parseArgs(['https://example.com', '--json', '--out', 'capture.json'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: true,
      out: 'capture.json',
      report: null,
      devices: null,
    });
  });

  it('takes --json and --out together, because they name two different sinks', () => {
    expect(parseArgs(['--json', '--out', 'capture.json', 'https://example.com'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: true,
      out: 'capture.json',
      report: null,
      devices: null,
    });
  });

  it('takes all three sinks at once, because a run may be asked for all of them', () => {
    expect(
      parseArgs([
        '--json',
        '--out',
        'capture.json',
        '--report',
        'report.html',
        'https://example.com',
      ]),
    ).toEqual({
      ok: true,
      url: 'https://example.com',
      json: true,
      out: 'capture.json',
      report: 'report.html',
      devices: null,
    });
  });

  it('leaves a path holding spaces or an equals sign alone', () => {
    expect(parseArgs(['--out', 'my captures/a=b.json', 'https://example.com'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: false,
      out: 'my captures/a=b.json',
      report: null,
      devices: null,
    });
  });

  it('reads --device as the one device the run renders', () => {
    expect(parseArgs(['--device', 'desktop', 'https://example.com'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: false,
      out: null,
      report: null,
      devices: ['desktop'],
    });
  });

  it('reads a comma-separated --device list as the ids it names', () => {
    expect(parseArgs(['--device', 'iphone-se,ipad', 'https://example.com'])).toEqual({
      ok: true,
      url: 'https://example.com',
      json: false,
      out: null,
      report: null,
      devices: ['iphone-se', 'ipad'],
    });
  });

  it('leaves the ids in the order given, because the profile set orders the run', () => {
    // Which is why nothing here sorts them: `run` filters the profile set, so
    // the order this list arrives in never reaches the trace.
    const parsed = parseArgs(['--device', 'ipad,iphone-se', 'https://example.com']);
    expect(parsed.ok && parsed.devices).toEqual(['ipad', 'iphone-se']);
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

  it('refuses a second --out by name, rather than keeping one path and dropping the other', () => {
    expect(rejected(['--out', 'first.json', '--out', 'second.json', 'https://example.com'])).toBe(
      `--out was given twice, and a run writes one file\n${USAGE}`,
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

  it('refuses --report with nothing after it', () => {
    expect(rejected(['https://example.com', '--report'])).toBe(
      `--report needs a file path after it\n${USAGE}`,
    );
  });

  it('refuses a second --report by name, the way it refuses a second --out', () => {
    expect(
      rejected(['--report', 'first.html', '--report', 'second.html', 'https://example.com']),
    ).toBe(`--report was given twice, and a run writes one file\n${USAGE}`);
  });

  it('refuses to treat the next option as the --report path', () => {
    expect(rejected(['--report', '--out', 'capture.json', 'https://example.com'])).toBe(
      `--report needs a file path after it\n${USAGE}`,
    );
  });

  it('refuses --device with nothing after it', () => {
    expect(rejected(['https://example.com', '--device'])).toBe(
      `--device needs one or more device ids after it\n${USAGE}`,
    );
  });

  it('refuses a second --device by name, because a run renders one device set', () => {
    expect(rejected(['--device', 'desktop', '--device', 'ipad', 'https://example.com'])).toBe(
      `--device was given twice, and a run renders one device set\n${USAGE}`,
    );
  });

  it('refuses to treat the next option as the --device list', () => {
    expect(rejected(['--device', '--json', 'https://example.com'])).toBe(
      `--device needs one or more device ids after it\n${USAGE}`,
    );
  });

  it('names --report in the usage line, so the option can be found', () => {
    expect(USAGE).toContain('--report <file>');
  });

  it('names --device in the usage line, so the option can be found', () => {
    expect(USAGE).toContain('--device <ids>');
  });
});
