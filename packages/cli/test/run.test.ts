import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Capture, CapturedImage, DeviceRun } from '@imgwhy/core';
import { parseSrcset } from '@imgwhy/core';
import { DEFAULT_PROFILES } from '@imgwhy/runner';
import { beforeEach, describe, expect, it } from 'vitest';
import { type CaptureFn, run } from '../src/run.js';

/** A directory with no `imgwhy.config.json`, so a run takes the defaults. */
let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'imgwhy-run-'));
});

const HERO_SRCSET = '/i/640.png 640w, /i/1080.png 1080w, /i/1920.png 1920w';

const logo = (): CapturedImage => ({
  id: 'html > body > header > img',
  selector: 'html > body > header > img',
  candidates: [],
  sizes: null,
  sizesSource: 'img',
  renderedWidth: 120,
  currentSrc: 'https://example.com/i/logo.png',
  naturalWidth: 120,
  transferBytes: null,
  loading: 'lazy',
});

const hero = (renderedWidth: number, file: string): CapturedImage => ({
  id: 'html > body > main > img:nth-of-type(1)',
  selector: 'html > body > main > img:nth-of-type(1)',
  candidates: parseSrcset(HERO_SRCSET),
  sizes: '(min-width: 1000px) 50vw, 100vw',
  sizesSource: 'img',
  renderedWidth,
  currentSrc: `https://example.com/i/${file}`,
  naturalWidth: renderedWidth,
  transferBytes: null,
  loading: null,
});

const badge = (file: string): CapturedImage => ({
  id: 'html > body > main > img:nth-of-type(2)',
  selector: 'html > body > main > img:nth-of-type(2)',
  candidates: parseSrcset('/i/200.png 1x, /i/300.png 2x'),
  sizes: null,
  sizesSource: 'img',
  renderedWidth: 200,
  currentSrc: `https://example.com/i/${file}`,
  naturalWidth: 200,
  transferBytes: null,
  loading: null,
});

/** The gallery as the five default profiles would have recorded it. */
const gallery = (): Capture => {
  const runs: DeviceRun[] = [
    { deviceId: 'iphone-se', images: [logo(), hero(187, '1080.png'), badge('300.png')] },
    { deviceId: 'iphone-15-pro', images: [logo(), hero(196, '1920.png'), badge('300.png')] },
    { deviceId: 'pixel-8', images: [logo(), hero(206, '1920.png'), badge('300.png')] },
    { deviceId: 'ipad', images: [logo(), hero(410, '1920.png'), badge('300.png')] },
    { deviceId: 'desktop', images: [logo(), hero(720, '1080.png'), badge('200.png')] },
  ];
  return {
    url: 'https://example.com/gallery',
    capturedAt: '2026-09-03T00:00:00.000Z',
    devices: DEFAULT_PROFILES,
    runs,
  };
};

/** The same capture with one device's run replaced, named by its device id. */
const on = (capture: Capture, deviceId: string, images: CapturedImage[]): Capture => ({
  ...capture,
  runs: capture.runs.map((run) => (run.deviceId === deviceId ? { ...run, images } : run)),
});

const returning =
  (capture: Capture): CaptureFn =>
  () =>
    Promise.resolve(capture);

const lines = (stdout: string): string[] => stdout.split('\n');

/** A table row, read back as its cells. Two or more spaces separate them. */
const cells = (line: string): string[] => line.trim().split(/\s{2,}/);

/** The table inside one image's block, header row first. */
const tableUnder = (stdout: string, header: string): string[] => {
  const all = lines(stdout);
  const start = all.findIndex((line) => line.includes(header));
  if (start === -1) throw new Error(`no block for ${header} in\n${stdout}`);
  const next = all.findIndex((line, i) => i > start && line.startsWith('image '));
  const block = all.slice(start, next === -1 ? undefined : next);
  const table = block.findIndex((line) => line.trim().startsWith('device'));
  if (table === -1) throw new Error(`no table under ${header} in\n${stdout}`);
  return block.slice(table).filter((line) => line.trim() !== '');
};

describe('run', () => {
  it('traces every image on the page, not only the first', async () => {
    const outcome = await run(['https://example.com/gallery'], returning(gallery()), cwd);

    expect(outcome.stderr).toBe('');
    expect(outcome.code).toBe(0);
    expect(lines(outcome.stdout)[0]).toBe('url      https://example.com/gallery');
    expect(lines(outcome.stdout)[1]).toBe('images   3 on 5 devices');
    expect(outcome.stdout).toContain('image 1 of 3  html > body > header > img');
    expect(outcome.stdout).toContain(
      'image 2 of 3  html > body > main > img:nth-of-type(1)',
    );
    expect(outcome.stdout).toContain(
      'image 3 of 3  html > body > main > img:nth-of-type(2)',
    );
  });

  it('gives every device a row of the arithmetic for one image', async () => {
    const outcome = await run(['https://example.com/gallery'], returning(gallery()), cwd);

    expect(tableUnder(outcome.stdout, 'image 2 of 3').map(cells)).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'file'],
      ['iPhone SE', '375×667', '2', '100vw', '375px', '750px', '1080w', '1080.png'],
      ['iPhone 15 Pro', '393×852', '3', '100vw', '393px', '1179px', '1920w', '1920.png'],
      // 1080/412 is 2.621, just under this device's 2.625, so the 1920 file it
      // is — the case a rounded DPR would get wrong.
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
  });

  it('lines the table up, so a column can be read down', async () => {
    const outcome = await run(['https://example.com/gallery'], returning(gallery()), cwd);

    const rows = tableUnder(outcome.stdout, 'image 2 of 3');
    const columnStarts = (line: string): number[] =>
      [...line.matchAll(/(?<= {2}|^)\S/g)].map((m) => m.index);

    // Every row breaks its cells at the same offsets as the header.
    const [header, ...rest] = rows;
    for (const row of rest) {
      expect(columnStarts(row)).toEqual(columnStarts(header));
    }
  });

  it('names the candidates and the sizes attribute once per image', async () => {
    const outcome = await run(['https://example.com/gallery'], returning(gallery()), cwd);

    expect(outcome.stdout).toContain('  candidates  640w, 1080w, 1920w');
    expect(outcome.stdout).toContain('  sizes       (min-width: 1000px) 50vw, 100vw');
  });

  it('says an image with no srcset chose nothing, and does not table it', async () => {
    const outcome = await run(['https://example.com/gallery'], returning(gallery()), cwd);

    expect(outcome.stdout).toContain('image 1 of 3  html > body > header > img   loading=lazy');
    expect(outcome.stdout).toContain('  no srcset, so nothing was selected — file  logo.png');
  });

  it('says sizes played no part when the candidates carry x descriptors', async () => {
    const outcome = await run(['https://example.com/gallery'], returning(gallery()), cwd);

    expect(tableUnder(outcome.stdout, 'image 3 of 3').map(cells)).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'file'],
      ['iPhone SE', '375×667', '2', 'x descriptors only', '—', '—', '2x', '300.png'],
      ['iPhone 15 Pro', '393×852', '3', 'x descriptors only', '—', '—', '2x', '300.png'],
      ['Pixel 8', '412×915', '2.625', 'x descriptors only', '—', '—', '2x', '300.png'],
      ['iPad', '820×1180', '2', 'x descriptors only', '—', '—', '2x', '300.png'],
      ['Desktop', '1440×900', '1', 'x descriptors only', '—', '—', '1x', '200.png'],
    ]);
  });

  it('flags the row where the file that loaded is not the one picked', async () => {
    const capture = on(gallery(), 'desktop', [logo(), hero(720, '1920.png'), badge('200.png')]);

    const outcome = await run(['https://example.com/gallery'], returning(capture), cwd);

    const desktop = tableUnder(outcome.stdout, 'image 2 of 3')[5];
    expect(cells(desktop).at(-1)).toBe('1920.png ← differs');
  });

  it('names the absent sizes attribute and the 100vw default that stood in', async () => {
    const desktopOnly = on(gallery(), 'desktop', [{ ...hero(1440, '1920.png'), sizes: null }]);
    const capture: Capture = {
      ...desktopOnly,
      devices: DEFAULT_PROFILES.filter((profile) => profile.id === 'desktop'),
      runs: desktopOnly.runs.filter((run) => run.deviceId === 'desktop'),
    };

    const outcome = await run(['https://example.com/gallery'], returning(capture), cwd);

    expect(outcome.stdout).toContain('  sizes       (absent)');
    expect(tableUnder(outcome.stdout, 'image 1 of 1').map(cells)).toEqual([
      ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'file'],
      [
        'Desktop',
        '1440×900',
        '1',
        'absent → 100vw default',
        '1440px',
        '1440px',
        '1920w',
        '1920.png',
      ],
    ]);
  });

  it('reports where an image sat when a render moved it', async () => {
    const moved = { ...hero(187, '1080.png'), selector: 'html > body > main > div > img' };
    let capture = gallery();
    for (const deviceId of ['iphone-se', 'iphone-15-pro', 'pixel-8']) {
      capture = on(capture, deviceId, [logo(), moved, badge('300.png')]);
    }

    const outcome = await run(['https://example.com/gallery'], returning(capture), cwd);

    expect(outcome.stdout).toContain(
      '  also at     html > body > main > div > img on iPhone SE, iPhone 15 Pro, Pixel 8',
    );
  });

  it('leaves out the devices that never rendered an image', async () => {
    const capture = on(gallery(), 'iphone-se', [logo()]);

    const outcome = await run(['https://example.com/gallery'], returning(capture), cwd);

    expect(outcome.stdout).toContain('  not on      iPhone SE');
    expect(tableUnder(outcome.stdout, 'image 2 of 3').map((row) => cells(row)[0])).toEqual([
      'device',
      'iPhone 15 Pro',
      'Pixel 8',
      'iPad',
      'Desktop',
    ]);
  });

  it('says plainly when the page carries no image at all', async () => {
    const empty = gallery();
    empty.runs = empty.runs.map((r) => ({ ...r, images: [] }));

    const outcome = await run(['https://example.com/gallery'], returning(empty), cwd);

    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain('carries no <img> element');
  });

  it('renders the page as every default profile', async () => {
    let asked: string[] = [];
    const capture: CaptureFn = (options) => {
      asked = options.profiles.map((p) => p.id);
      return Promise.resolve(gallery());
    };

    await run(['https://example.com/gallery'], capture, cwd);

    expect(asked).toEqual(['iphone-se', 'iphone-15-pro', 'pixel-8', 'ipad', 'desktop']);
  });

  it('renders the set imgwhy.config.json names instead of the default one', async () => {
    writeFileSync(
      join(cwd, 'imgwhy.config.json'),
      JSON.stringify({
        devices: [{ id: 'kiosk', name: 'Kiosk', viewport: { width: 1080, height: 1920 }, dpr: 1 }],
      }),
      'utf8',
    );
    let asked: string[] = [];
    const capture: CaptureFn = (options) => {
      asked = options.profiles.map((p) => p.id);
      return Promise.resolve(gallery());
    };

    await run(['https://example.com/gallery'], capture, cwd);

    expect(asked).toEqual(['kiosk']);
  });

  it('stops before the browser when the working directory is gone', async () => {
    const gone = mkdtempSync(join(tmpdir(), 'imgwhy-gone-'));
    rmSync(gone, { recursive: true });
    let started = 0;
    const capture: CaptureFn = () => {
      started++;
      return Promise.reject(new Error('the browser must not start'));
    };

    const outcome = await run(['https://example.com/gallery'], capture, gone);

    expect(started).toBe(0);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain('the working directory could not be read');
  });

  it('stops before the browser when the config file is malformed', async () => {
    writeFileSync(join(cwd, 'imgwhy.config.json'), '{ "devices": [ } ', 'utf8');
    let started = 0;
    const capture: CaptureFn = () => {
      started++;
      return Promise.reject(new Error('the browser must not start'));
    };

    const outcome = await run(['https://example.com/gallery'], capture, cwd);

    expect(started).toBe(0);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain('imgwhy.config.json is not valid JSON');
  });

  it('reports what the runner could not do', async () => {
    const failing: CaptureFn = () => Promise.reject(new Error('Playwright has no Chromium to run'));

    const outcome = await run(['https://example.com/page'], failing, cwd);

    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('Playwright has no Chromium to run');
  });

  it('prints usage when no URL is given', async () => {
    let started = 0;
    const capture: CaptureFn = () => {
      started++;
      return Promise.reject(new Error('the browser must not start'));
    };

    const outcome = await run([], capture, cwd);

    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('usage: imgwhy <url>');
    expect(started).toBe(0);
  });
});

describe('run, given a URL it must not open', () => {
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'not a url'])(
    'refuses %s without starting a browser',
    async (raw) => {
      let started = 0;
      const capture: CaptureFn = () => {
        started++;
        return Promise.reject(new Error('the browser must not start'));
      };

      const outcome = await run([raw], capture, cwd);

      expect(started).toBe(0);
      expect(outcome.code).toBe(1);
      expect(outcome.stdout).toBe('');
      expect(outcome.stderr.trim().length).toBeGreaterThan(0);
    },
  );
});
