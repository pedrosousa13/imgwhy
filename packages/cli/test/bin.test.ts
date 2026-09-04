import { execFile } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Capture } from '@imgwhy/core';
import { DEFAULT_PROFILES } from '@imgwhy/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refuseStaleBuild } from '../../../test/built.js';
import { type FixtureServer, startFixtureServer } from '../../../test/fixture-server.js';
import { USAGE } from '../src/args.js';

const run = promisify(execFile);
const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

type Ran = { code: number; stdout: string; stderr: string };

/** Runs in `dir`, which is where the command looks for `imgwhy.config.json`. */
async function imgwhy(dir: string, ...args: string[]): Promise<Ran> {
  try {
    const { stdout, stderr } = await run(process.execPath, [bin, ...args], { cwd: dir });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

const lines = (stdout: string): string[] => stdout.split('\n');

/** A table row, read back as its cells. Two or more spaces separate them. */
const cells = (line: string): string[] => line.trim().split(/\s{2,}/);

/**
 * A table row without its last cell.
 *
 * The bytes that arrived are a real measurement of a real response, headers
 * and all, so the number is not one this file can name. It is checked for
 * being a number, separately, by `arrived` below.
 */
const withoutBytes = (rows: string[][]): string[][] => rows.map((row) => row.slice(0, -1));

/** The bytes column of every data row, as written. */
const arrived = (rows: string[][]): string[] => rows.slice(1).map((row) => row[row.length - 1]);

const tableUnder = (stdout: string, header: string): string[][] => {
  const all = lines(stdout);
  const start = all.findIndex((line) => line.includes(header));
  if (start === -1) throw new Error(`no block for ${header} in\n${stdout}`);
  const next = all.findIndex((line, i) => i > start && line.startsWith('image '));
  const block = all.slice(start, next === -1 ? undefined : next);
  const table = block.findIndex((line) => line.trim().startsWith('device'));
  if (table === -1) throw new Error(`no table under ${header} in\n${stdout}`);
  return block
    .slice(table)
    .filter((line) => line.trim() !== '')
    .map(cells);
};

let server: FixtureServer;
/** No config file, so these runs take the default device set. */
let plain: string;

beforeAll(async () => {
  refuseStaleBuild();
  server = await startFixtureServer();
  plain = mkdtempSync(join(tmpdir(), 'imgwhy-bin-'));
});
afterAll(async () => {
  await server.close();
});

describe('the imgwhy command', () => {
  it('traces every image of a real page across the five default devices', async () => {
    const url = `${server.url}/gallery.html`;

    const ran = await imgwhy(plain, url);

    expect(ran.stderr).toBe('');
    expect(ran.code).toBe(0);
    expect(lines(ran.stdout)[0]).toBe(`url      ${url}`);
    expect(lines(ran.stdout)[1]).toBe('images   3 on 5 devices');

    // The plain `src` logo. Nothing chose it, and no table pretends otherwise.
    expect(ran.stdout).toContain('image 1 of 3  html > body > header > img   loading=lazy');
    expect(ran.stdout).toContain('  no srcset, so nothing was selected — file  640.png');

    // The hero, under a media clause only the desktop viewport matches.
    expect(ran.stdout).toContain('  candidates  640w, 1080w, 1920w');
    expect(ran.stdout).toContain('  sizes       (min-width: 1000px) 50vw, 100vw');
    const hero = tableUnder(ran.stdout, 'image 2 of 3');
    expect(withoutBytes(hero)).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'file'],
      ['iPhone SE', '375×667', '2', '100vw', '375px', '750px', '1080w', '1080.png'],
      ['iPhone 15 Pro', '393×852', '3', '100vw', '393px', '1179px', '1920w', '1920.png'],
      // 1080/412 is 2.621, a hair under this device's 2.625.
      ['Pixel 8', '412×915', '2.625', '100vw', '412px', '1082px', '1920w', '1920.png'],
      ['iPad', '820×1180', '2', '100vw', '820px', '1640px', '1920w', '1920.png'],
      [
        'Desktop',
        '1440×900',
        '1',
        '(min-width: 1000px) 50vw',
        '720px',
        '720px',
        '1080w',
        '1080.png',
      ],
    ]);

    // Every row carries the weight of the response that arrived for it. The
    // 1920 file is heavier than the 1080 one, which is the whole point of the
    // column, and no row reports the zero an in-page tool would.
    expect(arrived(hero).every((cell) => /^[1-9][0-9]*$/.test(cell))).toBe(true);
    const [phone, pro] = arrived(hero);
    expect(Number(pro)).toBeGreaterThan(Number(phone));

    // The badge, where `sizes` plays no part at all.
    expect(withoutBytes(tableUnder(ran.stdout, 'image 3 of 3'))).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'file'],
      ['iPhone SE', '375×667', '2', 'x descriptors only', '—', '—', '2x', '300.png'],
      ['iPhone 15 Pro', '393×852', '3', 'x descriptors only', '—', '—', '2x', '300.png'],
      ['Pixel 8', '412×915', '2.625', 'x descriptors only', '—', '—', '2x', '300.png'],
      ['iPad', '820×1180', '2', 'x descriptors only', '—', '—', '2x', '300.png'],
      ['Desktop', '1440×900', '1', 'x descriptors only', '—', '—', '1x', '200.png'],
    ]);
  }, 120_000);

  it('predicts what every device loaded, with the cache never standing in', async () => {
    const ran = await imgwhy(plain, `${server.url}/nested`);

    expect(ran.stderr).toBe('');
    expect(ran.code).toBe(0);
    // Candidates written relative to the page, resolved against the URL the
    // redirect landed on.
    expect(lines(ran.stdout)[0]).toBe(`url      ${server.url}/nested/`);
    expect(ran.stdout).not.toContain('differs');
    expect(withoutBytes(tableUnder(ran.stdout, 'image 1 of 1'))).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'file'],
      ['iPhone SE', '375×667', '2', '100vw', '375px', '750px', '1080w', '1080.png'],
      ['iPhone 15 Pro', '393×852', '3', '100vw', '393px', '1179px', '1920w', '1920.png'],
      ['Pixel 8', '412×915', '2.625', '100vw', '412px', '1082px', '1920w', '1920.png'],
      ['iPad', '820×1180', '2', '100vw', '820px', '1640px', '1920w', '1920.png'],
      ['Desktop', '1440×900', '1', '100vw', '1440px', '1440px', '1920w', '1920.png'],
    ]);
  }, 120_000);

  it('keeps one image id across the runs when a render moves the element', async () => {
    const ran = await imgwhy(plain, `${server.url}/reparent.html`);

    expect(ran.code).toBe(0);
    expect(ran.stdout).toContain('images   2 on 5 devices');
    // One block for the hero, not one per DOM path it took.
    expect(ran.stdout).toContain('image 2 of 2  html > body > main > div > img');
    expect(ran.stdout).toContain(
      '  also at     html > body > main > img on iPad, Desktop',
    );
  }, 120_000);

  it('resolves a picture per device, and names the source the sizes came from', async () => {
    const ran = await imgwhy(plain, `${server.url}/picture-sources.html`);

    expect(ran.stderr).toBe('');
    expect(ran.code).toBe(0);
    expect(ran.stdout).toContain('images   2 on 5 devices');

    // What the hero offered is three different things, because three
    // different elements answered for it.
    expect(ran.stdout).toContain(
      '  candidates  640w, 1080w, 1920w on iPhone SE, iPhone 15 Pro, Pixel 8',
    );
    expect(ran.stdout).toContain('  candidates  640w, 1080w on iPad');
    expect(ran.stdout).toContain('  candidates  1080w, 1920w on Desktop');
    expect(ran.stdout).toContain('  sizes       100vw on iPhone SE, iPhone 15 Pro, Pixel 8');
    expect(ran.stdout).toContain('  sizes       75vw from a matching <source> on iPad');
    expect(ran.stdout).toContain('  sizes       50vw from a matching <source> on Desktop');

    // Nothing says "differs", so the browser downloaded what the resolved
    // source says it should have — on every device, including the three that
    // fell through to the `<img>`.
    expect(ran.stdout).not.toContain('differs');
    expect(withoutBytes(tableUnder(ran.stdout, 'image 1 of 2'))).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'file'],
      ['iPhone SE', '375×667', '2', '100vw', '375px', '750px', '1080w', '1080.png'],
      ['iPhone 15 Pro', '393×852', '3', '100vw', '393px', '1179px', '1920w', '1920.png'],
      ['Pixel 8', '412×915', '2.625', '100vw', '412px', '1082px', '1920w', '1920.png'],
      // 75vw of 820 is 615, which needs 1230 at DPR 2 — more than the source
      // offers, so its largest wins.
      ['iPad', '820×1180', '2', '75vw', '615px', '1230px', '1080w', '1080.png'],
      ['Desktop', '1440×900', '1', '50vw', '720px', '720px', '1080w', '1080.png'],
    ]);
  }, 120_000);

  it('says a matching source wrote no sizes, so the img\'s played no part', async () => {
    const ran = await imgwhy(plain, `${server.url}/picture-sources.html`);

    expect(ran.code).toBe(0);
    // The three narrow devices matched no source and read the tag's 120px.
    // The two wide ones matched a source that wrote no `sizes` at all, so the
    // 100vw default applied and the tag's 120px played no part — which is what
    // the browser did, and why nothing here says "differs".
    expect(ran.stdout).toContain('  candidates  160w, 480w on iPhone SE, iPhone 15 Pro, Pixel 8');
    expect(ran.stdout).toContain('  candidates  200w, 300w on iPad, Desktop');
    expect(ran.stdout).toContain('  sizes       120px on iPhone SE, iPhone 15 Pro, Pixel 8');
    expect(ran.stdout).toContain(
      '  sizes       (absent) from a matching <source> on iPad, Desktop',
    );
    expect(withoutBytes(tableUnder(ran.stdout, 'image 2 of 2'))).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'file'],
      ['iPhone SE', '375×667', '2', '120px', '120px', '240px', '480w', '480.png'],
      ['iPhone 15 Pro', '393×852', '3', '120px', '120px', '360px', '480w', '480.png'],
      ['Pixel 8', '412×915', '2.625', '120px', '120px', '315px', '480w', '480.png'],
      [
        'iPad',
        '820×1180',
        '2',
        'absent → 100vw default',
        '820px',
        '1640px',
        '300w',
        '300.png',
      ],
      [
        'Desktop',
        '1440×900',
        '1',
        'absent → 100vw default',
        '1440px',
        '1440px',
        '300w',
        '300.png',
      ],
    ]);
  }, 120_000);

  it('counts the CSS background images a page painted and says they select nothing', async () => {
    const ran = await imgwhy(plain, `${server.url}/backgrounds.html`);

    expect(ran.stderr).toBe('');
    expect(ran.code).toBe(0);
    // Two tiles everywhere, and the banner only where the viewport reaches the
    // width its media query asks for. The gradient is painted on all five and
    // counted on none, because it is not a file.
    expect(lines(ran.stdout)[2]).toBe(
      'css      2 background images on iPhone SE, iPhone 15 Pro, Pixel 8, iPad, ' +
        '3 background images on Desktop. A CSS background image has no selection mechanism ' +
        'at all, so imgwhy counts them and explains nothing further.',
    );
  }, 120_000);

  it('says nothing about backgrounds on a page whose CSS paints none', async () => {
    const ran = await imgwhy(plain, `${server.url}/gallery.html`);

    expect(ran.code).toBe(0);
    expect(ran.stdout).not.toContain('background image');
  }, 120_000);

  it('still traces a page whose only image had nothing to choose from', async () => {
    const ran = await imgwhy(plain, `${server.url}/no-srcset.html`);

    expect(ran.code).toBe(0);
    expect(ran.stdout).toContain('images   1 on 5 devices');
    expect(ran.stdout).toContain('  no srcset, so nothing was selected — file  1080.png');
  }, 120_000);

  it('says unknown for an image whose weight nothing recorded', async () => {
    const ran = await imgwhy(plain, `${server.url}/unknown-bytes.html`);

    expect(ran.stderr).toBe('');
    expect(ran.code).toBe(0);
    // One image arrived inside the document and one never arrived at all.
    // Neither is a transfer, and neither is guessed at from its pixels.
    expect(ran.stdout).toContain('images   2 on 5 devices');
    expect(ran.stdout.match(/^ {2}bytes {7}unknown$/gm)).toHaveLength(2);
  }, 120_000);

  it('exits non-zero on a page carrying no image at all', async () => {
    const ran = await imgwhy(plain, `${server.url}/no-images.html`);

    expect(ran.code).toBe(1);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toContain('carries no <img> element');
  }, 120_000);

  it('renders the device set imgwhy.config.json names, and only that set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imgwhy-bin-config-'));
    writeFileSync(
      join(dir, 'imgwhy.config.json'),
      JSON.stringify({
        devices: [{ id: 'kiosk', name: 'Kiosk', viewport: { width: 1024, height: 1280 }, dpr: 1 }],
      }),
      'utf8',
    );

    const ran = await imgwhy(dir, `${server.url}/gallery.html`);

    expect(ran.stderr).toBe('');
    expect(ran.code).toBe(0);
    expect(ran.stdout).toContain('images   3 on 1 devices');
    const hero = tableUnder(ran.stdout, 'image 2 of 3');
    expect(withoutBytes(hero)).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'file'],
      // 1024 matches the media clause, so half of it at DPR 1 needs 512.
      ['Kiosk', '1024×1280', '1', '(min-width: 1000px) 50vw', '512px', '512px', '640w', '640.png'],
    ]);
  }, 120_000);

  it('fails with the parse error when imgwhy.config.json is malformed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imgwhy-bin-bad-'));
    writeFileSync(join(dir, 'imgwhy.config.json'), '{ "devices": [ } ', 'utf8');

    const ran = await imgwhy(dir, `${server.url}/gallery.html`);

    expect(ran.code).toBe(1);
    expect(ran.stdout).toBe('');
    // The parser's own complaint, naming the character at fault. Not a
    // paraphrase, and not a silent fall back to the default device set.
    expect(ran.stderr).toBe(
      'imgwhy.config.json is not valid JSON: Unexpected token \'}\', "{ "devices": [ } " is not valid JSON\n',
    );
  }, 120_000);

  it('refuses a config file that points outside the working directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imgwhy-bin-escape-'));
    const outside = mkdtempSync(join(tmpdir(), 'imgwhy-bin-outside-'));
    writeFileSync(
      join(outside, 'devices.json'),
      JSON.stringify({
        devices: [{ id: 'kiosk', name: 'Kiosk', viewport: { width: 1024, height: 1280 }, dpr: 1 }],
      }),
      'utf8',
    );
    symlinkSync(join(outside, 'devices.json'), join(dir, 'imgwhy.config.json'));

    const ran = await imgwhy(dir, `${server.url}/gallery.html`);

    expect(ran.code).toBe(1);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toBe(
      'imgwhy.config.json resolves outside the working directory, so imgwhy will not read it\n',
    );
  }, 120_000);

  it('refuses a file: URL', async () => {
    const ran = await imgwhy(plain, 'file:///etc/passwd');

    expect(ran.code).toBe(1);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toBe(
      'imgwhy opens http: and https: pages only, and "file:///etc/passwd" is file:\n',
    );
  });

  it('refuses --out with no path after it', async () => {
    const ran = await imgwhy(plain, `${server.url}/gallery.html`, '--out');

    expect(ran.code).toBe(1);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toBe(`--out needs a file path after it\n${USAGE}\n`);
  });
});

describe('the imgwhy command, asked for the capture itself', () => {
  it('prints a capture that parses straight off stdout, with nothing around it', async () => {
    const url = `${server.url}/gallery.html`;

    const ran = await imgwhy(plain, '--json', url);

    expect(ran.stderr).toBe('');
    expect(ran.code).toBe(0);
    // No banner and no trailing note, so a pipe into a parser needs no help.
    const capture: Capture = JSON.parse(ran.stdout);
    expect(capture.url).toBe(url);
    expect(capture.devices.map((device) => device.id)).toEqual(DEFAULT_PROFILES.map((d) => d.id));
    expect(capture.runs.map((deviceRun) => deviceRun.images.length)).toEqual([3, 3, 3, 3, 3]);
    expect(new Date(capture.capturedAt).toISOString()).toBe(capture.capturedAt);
    // The load event waits for an eager image, so every render finished with
    // the hero and the badge in hand and carries the real size of each
    // response — two images across five devices. The logo is `loading=lazy`
    // and nothing waited for it, so a render can end with it still in flight
    // and no size to report, which is a genuine unknown rather than a zero.
    const eager = capture.runs
      .flatMap((r) => r.images)
      .filter((image) => image.loading !== 'lazy')
      .map((image) => image.transferBytes);
    expect(eager).toHaveLength(10);
    expect(eager.every((size) => typeof size === 'number' && size > 0)).toBe(true);
  }, 120_000);

  it('writes the capture to the file --out names, and writes no other file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imgwhy-bin-out-'));
    const out = join(dir, 'capture.json');
    expect(readdirSync(dir)).toEqual([]);

    const ran = await imgwhy(dir, '--json', '--out', out, `${server.url}/gallery.html`);

    expect(ran.stderr).toBe('');
    expect(ran.code).toBe(0);
    expect(readdirSync(dir)).toEqual(['capture.json']);
    // The same Capture reached both sinks, byte for byte. Whether a written
    // Capture parses back unchanged is `run.test.ts`'s to check, where the
    // original is in hand to compare against.
    expect(readFileSync(out, 'utf8')).toBe(ran.stdout);
  }, 120_000);

  it('writes the capture of a page carrying no image, and calls the run done', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imgwhy-bin-empty-'));
    const out = join(dir, 'capture.json');
    const url = `${server.url}/no-images.html`;

    const ran = await imgwhy(dir, '--out', out, url);

    // The file was asked for and written, so the run worked. Only the trace
    // had nothing to say, and it says so on the other stream.
    expect(ran.code).toBe(0);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toContain('carries no <img> element');
    expect(readdirSync(dir)).toEqual(['capture.json']);
    const capture: Capture = JSON.parse(readFileSync(out, 'utf8'));
    expect(capture.url).toBe(url);
    expect(capture.runs.map((deviceRun) => deviceRun.images.length)).toEqual([0, 0, 0, 0, 0]);
  }, 120_000);

  it('writes where --out points even when the URL reads like a path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imgwhy-bin-traversal-'));
    const out = join(dir, 'capture.json');

    const ran = await imgwhy(dir, '--out', out, `${server.url}/nested/../gallery.html`);

    expect(ran.code).toBe(0);
    expect(readdirSync(dir)).toEqual(['capture.json']);
    const capture: Capture = JSON.parse(readFileSync(out, 'utf8'));
    expect(capture.url).toBe(`${server.url}/gallery.html`);
  }, 120_000);
});

/**
 * The page from #41's reproduction, served on loopback and rendered by a real
 * Chromium.
 *
 * This owns the premise the finding rests on, which is the one claim no
 * hand-written Capture can make: that a page can get an escape sequence as far
 * as a Capture in the first place. `escaping.test.ts` owns the other half —
 * it writes its Capture by hand, so it can carry a bare CR and a NUL that no
 * HTML parser would pass, and it reads the whole rendered trace back for any
 * control character at all. Neither test covers the other's claim.
 *
 * So what is asserted here is what a browser leaves intact rather than what a
 * Capture can hold. ESC and BEL arrive as the page wrote them. The CR does
 * not: the HTML parser normalises it to a newline in the input stream, and a
 * newline inside a descriptor is exactly what ended a line of the trace early.
 * A NUL would arrive as U+FFFD, so the page writes none, and that character
 * stays the unit check's to cover.
 */
describe('the imgwhy command, given a page written to break the trace', () => {
  it('takes the page control characters into the capture and none of them to the terminal', async () => {
    const url = `${server.url}/control-characters.html`;

    // One run per output, because the command writes one or the other — and
    // the two outputs are the one thing this case needs to disagree about.
    const asJson = await imgwhy(plain, '--json', url);
    const ran = await imgwhy(plain, url);

    expect(asJson.code).toBe(0);
    const capture: Capture = JSON.parse(asJson.stdout);
    const image = capture.runs[0].images[0];

    // What the page delivered. The `sizes` string retitles a terminal window
    // and the descriptor erases the line it lands on before writing its own,
    // and both of them reached the runner as the markup had them.
    expect(image.sizes).toBe('100vw\u001b]0;imgwhy-pwned\u0007');
    expect(image.candidates.map((candidate) => candidate.raw)).toEqual([
      '640w\u001b[2K\nFORGED CANDIDATE LINE',
      '1080w',
    ]);

    // And what the terminal was asked to print of it: nothing it obeys, and
    // no line the page wrote.
    expect(ran.code).toBe(0);
    expect(lines(ran.stdout).filter((line) => /\p{Cc}/u.test(line))).toEqual([]);
    expect(lines(ran.stdout).filter((line) => line.trimStart().startsWith('FORGED'))).toEqual([]);
    expect(ran.stdout).toContain(String.raw`  sizes       100vw\u001b]0;imgwhy-pwned\u0007`);
    expect(ran.stdout).toContain(
      String.raw`  candidates  640w\u001b[2K\nFORGED CANDIDATE LINE, 1080w`,
    );
  }, 120_000);
});
