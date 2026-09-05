import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Capture, CapturedImage } from '@imgwhy/core';
import { parseSrcset } from '@imgwhy/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { USAGE } from '../src/args.js';
import { runDiff } from '../src/diff.js';
import { writeCapture } from '../src/out.js';

let dir: string;
let before: string;
let after: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'imgwhy-diff-'));
  before = join(dir, 'before.json');
  after = join(dir, 'after.json');
});

const SRCSET = '/i/320.png 320w, /i/640.png 640w, /i/1280.png 1280w';

const hero = (sizes: string, bytes: number): CapturedImage => ({
  id: 'html > body > main > img',
  selector: 'html > body > main > img',
  candidates: parseSrcset(SRCSET),
  sizes,
  sizesSource: 'img',
  renderedWidth: 375,
  declaresWidth: false,
  currentSrc: 'https://example.com/i/1280.png',
  naturalWidth: 1280,
  transferBytes: bytes,
  loading: null,
});

const capture = (sizes: string, bytes: number): Capture => ({
  url: 'https://example.com/',
  capturedAt: '2026-01-01T00:00:00.000Z',
  devices: [{ id: 'iphone-se', name: 'iPhone SE', viewport: { width: 375, height: 667 }, dpr: 2 }],
  runs: [{ deviceId: 'iphone-se', images: [hero(sizes, bytes)], backgroundImageCount: 0 }],
});

/** Both files written, so a run has two Captures to read back. */
function written(one: Capture, two: Capture): void {
  expect(writeCapture(before, one)).toEqual({ ok: true });
  expect(writeCapture(after, two)).toEqual({ ok: true });
}

describe('the diff command', () => {
  it('reads two captures back and says what moved between them', () => {
    written(capture('100vw', 11573), capture('50vw', 6104));

    const outcome = runDiff([before, after]);

    expect(outcome.code).toBe(0);
    expect(outcome.stderr).toBe('');
    expect(outcome.stdout).toBe(
      [
        'image 1 of 1  html > body > main > img',
        '  iPhone SE  1280w → 640w  11573 → 6104 bytes',
        '',
        '1 image changed, 1 got smaller, 0 regressed',
        '',
      ].join('\n'),
    );
  });

  it('leaves 0 behind for a regression, because a finding is not a failure', () => {
    written(capture('50vw', 6104), capture('100vw', 11573));

    const outcome = runDiff([before, after]);

    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain('1 regressed');
  });

  it('leaves 0 behind for two captures that agree, and says so in one line', () => {
    written(capture('100vw', 11573), capture('100vw', 11573));

    expect(runDiff([before, after])).toEqual({
      code: 0,
      stdout: '0 images changed, 0 got smaller, 0 regressed\n',
      stderr: '',
    });
  });

  it('names the field a malformed capture went wrong at, and fails on it', () => {
    written(capture('100vw', 11573), capture('100vw', 11573));
    const broken = JSON.parse(JSON.stringify(capture('100vw', 11573)));
    broken.runs[0].images[0].transferBytes = '11573';
    writeFileSync(after, JSON.stringify(broken), 'utf8');

    const outcome = runDiff([before, after]);

    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toBe(
      `${after}: runs[0].images[0].transferBytes must be a number at or above 0, or null\n`,
    );
  });

  it('names a file it could not read, rather than throwing at its caller', () => {
    written(capture('100vw', 11573), capture('100vw', 11573));
    const absent = join(dir, 'absent.json');

    const outcome = runDiff([absent, after]);

    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain(`${absent} could not be read`);
  });

  it('reads the first file before the second, so the earlier fault is the one named', () => {
    writeFileSync(before, 'not json', 'utf8');
    writeFileSync(after, 'not json either', 'utf8');

    expect(runDiff([before, after]).stderr).toContain(`${before} is not valid JSON`);
  });

  it('quotes nothing it read out of a capture, whatever the page wrote into one', () => {
    const controls = '\u001b]0;imgwhy-pwned\u0007\r\nFORGED LINE\u0000\u202edesrever\u2028';
    const hostile = JSON.parse(JSON.stringify(capture('100vw', 11573)));
    hostile.runs[0].deviceId = `iphone-se${controls}`;
    written(capture('100vw', 11573), capture('100vw', 11573));
    writeFileSync(after, JSON.stringify(hostile), 'utf8');

    const outcome = runDiff([before, after]);

    expect(outcome.stderr).toBe(
      `${after}: runs[0].deviceId names a device the capture does not describe\n`,
    );
    expect(outcome.stderr).not.toContain(controls);
  });

  it('refuses a line that does not name two files, because a diff has two sides', () => {
    for (const argv of [[], [before], [before, after, before]]) {
      expect(runDiff(argv)).toEqual({ code: 1, stdout: '', stderr: `${USAGE}\n` });
    }
  });

  it('refuses an option by name, because the diff takes none', () => {
    expect(runDiff(['--json', before, after]).stderr).toBe(
      `imgwhy diff has no --json option\n${USAGE}\n`,
    );
  });

  it('names the subcommand in the usage, so a reader can find the second form', () => {
    expect(USAGE).toContain('imgwhy diff <before.json> <after.json>');
  });
});
