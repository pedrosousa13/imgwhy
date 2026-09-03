import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FixtureServer, startFixtureServer } from '../../runner/test/fixture-server.js';

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
  expect(existsSync(bin), `${bin} is missing — run \`npm run build\` first`).toBe(true);
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
    expect(ran.stdout).toContain('  no srcset, so nothing was selected — arrived  640.png');

    // The hero, under a media clause only the desktop viewport matches.
    expect(ran.stdout).toContain('  candidates  640w, 1080w, 1920w');
    expect(ran.stdout).toContain('  sizes       (min-width: 1000px) 50vw, 100vw');
    expect(tableUnder(ran.stdout, 'image 2 of 3')).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'arrived'],
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

    // The badge, where `sizes` plays no part at all.
    expect(tableUnder(ran.stdout, 'image 3 of 3')).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'arrived'],
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
    expect(tableUnder(ran.stdout, 'image 1 of 1')).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'arrived'],
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

  it('still traces a page whose only image had nothing to choose from', async () => {
    const ran = await imgwhy(plain, `${server.url}/no-srcset.html`);

    expect(ran.code).toBe(0);
    expect(ran.stdout).toContain('images   1 on 5 devices');
    expect(ran.stdout).toContain('  no srcset, so nothing was selected — arrived  1080.png');
  }, 120_000);

  it('exits non-zero on a page carrying no image at all', async () => {
    const ran = await imgwhy(plain, `${server.url}/no-images.html`);

    expect(ran.code).toBe(1);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toContain('carries no image big enough to have been chosen');
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
    expect(tableUnder(ran.stdout, 'image 2 of 3')).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'arrived'],
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
});
