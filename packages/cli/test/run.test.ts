import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Capture, CapturedImage, DeviceRun } from '@imgwhy/core';
import { parseSrcset } from '@imgwhy/core';
import { renderReport } from '@imgwhy/report';
import { DEFAULT_PROFILES } from '@imgwhy/runner';
import { beforeEach, describe, expect, it } from 'vitest';
import { USAGE } from '../src/args.js';
import { type CaptureFn, run } from '../src/run.js';

/** A directory with no `imgwhy.config.json`, so a run takes the defaults. */
let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'imgwhy-run-'));
});

const HERO_SRCSET = '/i/640.png 640w, /i/1080.png 1080w, /i/1920.png 1920w';

/**
 * The logo weighs whatever it weighs: no transfer was recorded for it, which
 * is the case the trace has to report as unknown rather than as a number.
 */
const logo = (): CapturedImage => ({
  id: 'html > body > header > img',
  selector: 'html > body > header > img',
  candidates: [],
  sizes: null,
  sizesSource: 'img',
  renderedWidth: 120,
  currentSrc: 'https://example.com/i/logo.png',
  naturalWidth: 120,
  declaresWidth: false,
  transferBytes: null,
  loading: 'lazy',
});

/**
 * What one response cost, named at the call site.
 *
 * `null` is the case that matters most here — no transfer was recorded, so the
 * trace has to say unknown — and as a bare third argument it read as nothing
 * in particular.
 */
type Weighed = { bytes: number | null };

const hero = (renderedWidth: number, file: string, { bytes }: Weighed): CapturedImage => ({
  id: 'html > body > main > img:nth-of-type(1)',
  selector: 'html > body > main > img:nth-of-type(1)',
  candidates: parseSrcset(HERO_SRCSET),
  sizes: '(min-width: 1000px) 50vw, 100vw',
  sizesSource: 'img',
  renderedWidth,
  currentSrc: `https://example.com/i/${file}`,
  naturalWidth: renderedWidth,
  declaresWidth: false,
  transferBytes: bytes,
  loading: null,
});

const badge = (file: string, { bytes }: Weighed): CapturedImage => ({
  id: 'html > body > main > img:nth-of-type(2)',
  selector: 'html > body > main > img:nth-of-type(2)',
  candidates: parseSrcset('/i/200.png 1x, /i/300.png 2x'),
  sizes: null,
  sizesSource: 'img',
  renderedWidth: 200,
  currentSrc: `https://example.com/i/${file}`,
  naturalWidth: 200,
  declaresWidth: false,
  transferBytes: bytes,
  loading: null,
});

/** The gallery as the five default profiles would have recorded it. */
const gallery = (): Capture => {
  const runs: DeviceRun[] = [
    {
      deviceId: 'iphone-se',
      images: [logo(), hero(187, '1080.png', { bytes: 118231 }), badge('300.png', { bytes: 8210 })],
      backgroundImageCount: 0,
    },
    {
      deviceId: 'iphone-15-pro',
      images: [logo(), hero(196, '1920.png', { bytes: 342016 }), badge('300.png', { bytes: 8210 })],
      backgroundImageCount: 0,
    },
    {
      deviceId: 'pixel-8',
      images: [logo(), hero(206, '1920.png', { bytes: 342016 }), badge('300.png', { bytes: 8210 })],
      backgroundImageCount: 0,
    },
    {
      deviceId: 'ipad',
      images: [logo(), hero(410, '1920.png', { bytes: 342016 }), badge('300.png', { bytes: 8210 })],
      backgroundImageCount: 0,
    },
    {
      deviceId: 'desktop',
      images: [logo(), hero(720, '1080.png', { bytes: 118231 }), badge('200.png', { bytes: 4102 })],
      backgroundImageCount: 0,
    },
  ];
  return {
    url: 'https://example.com/gallery',
    capturedAt: '2026-09-03T00:00:00.000Z',
    devices: DEFAULT_PROFILES,
    runs,
  };
};

/** The same capture with every device rendering nothing at all. */
const withNoImages = (capture: Capture): Capture => ({
  ...capture,
  runs: capture.runs.map((run) => ({ ...run, images: [] })),
});

/** The same capture with one device's run replaced, named by its device id. */
const on = (capture: Capture, deviceId: string, images: CapturedImage[]): Capture => ({
  ...capture,
  runs: capture.runs.map((run) => (run.deviceId === deviceId ? { ...run, images } : run)),
});

/** The same capture with a background image count per run, in device order. */
const painting = (capture: Capture, counts: number[]): Capture => {
  if (counts.length !== capture.runs.length) {
    throw new Error(`${capture.runs.length} runs and ${counts.length} counts to paint them with`);
  }
  return {
    ...capture,
    runs: capture.runs.map((run, index) => ({ ...run, backgroundImageCount: counts[index] })),
  };
};

const returning =
  (capture: Capture): CaptureFn =>
  () =>
    Promise.resolve(capture);

/**
 * The gallery as the runner would have recorded it for the profiles it was
 * handed: a Capture reports the devices that rendered it and no others, so a
 * double that answered with all five whatever it was asked for could not show
 * what `--device` does.
 */
const rendering = (): CaptureFn => (options) => {
  const full = gallery();
  return Promise.resolve({
    ...full,
    devices: options.profiles,
    runs: full.runs.filter((run) => options.profiles.some((p) => p.id === run.deviceId)),
  });
};

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
      [
        'device',
        'viewport',
        'DPR',
        'clause used',
        'css px',
        'needed',
        'picked',
        'file',
        'bytes arrived',
      ],
      ['iPhone SE', '375×667', '2', '100vw', '375px', '750px', '1080w', '1080.png', '118231'],
      ['iPhone 15 Pro', '393×852', '3', '100vw', '393px', '1179px', '1920w', '1920.png', '342016'],
      // 1080/412 is 2.621, just under this device's 2.625, so the 1920 file it
      // is — the case a rounded DPR would get wrong.
      ['Pixel 8', '412×915', '2.625', '100vw', '412px', '1082px', '1920w', '1920.png', '342016'],
      ['iPad', '820×1180', '2', '100vw', '820px', '1640px', '1920w', '1920.png', '342016'],
      [
        'Desktop',
        '1440×900',
        '1',
        '(min-width: 1000px) 50vw',
        '720px',
        '720px',
        '1080w',
        '1080.png',
        '118231',
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
      [
        'device',
        'viewport',
        'DPR',
        'clause used',
        'css px',
        'needed',
        'picked',
        'file',
        'bytes arrived',
      ],
      ['iPhone SE', '375×667', '2', 'x descriptors only', '—', '—', '2x', '300.png', '8210'],
      ['iPhone 15 Pro', '393×852', '3', 'x descriptors only', '—', '—', '2x', '300.png', '8210'],
      ['Pixel 8', '412×915', '2.625', 'x descriptors only', '—', '—', '2x', '300.png', '8210'],
      ['iPad', '820×1180', '2', 'x descriptors only', '—', '—', '2x', '300.png', '8210'],
      ['Desktop', '1440×900', '1', 'x descriptors only', '—', '—', '1x', '200.png', '4102'],
    ]);
  });

  it('flags the row where the file that loaded is not the one picked', async () => {
    const capture = on(gallery(), 'desktop', [
      logo(),
      hero(720, '1920.png', { bytes: 342016 }),
      badge('200.png', { bytes: 4102 }),
    ]);

    const outcome = await run(['https://example.com/gallery'], returning(capture), cwd);

    const desktop = tableUnder(outcome.stdout, 'image 2 of 3')[5];
    expect(cells(desktop).at(-2)).toBe('1920.png ← differs');
  });

  it('prints unknown in the bytes column where no transfer was recorded', async () => {
    const capture = on(gallery(), 'desktop', [
      logo(),
      hero(720, '1080.png', { bytes: null }),
      badge('200.png', { bytes: 4102 }),
    ]);

    const outcome = await run(['https://example.com/gallery'], returning(capture), cwd);

    // 720 rendered pixels and a 1080 pixel file, and the column still says
    // unknown: nothing in the trace turns a dimension into a weight.
    const desktop = tableUnder(outcome.stdout, 'image 2 of 3')[5];
    expect(cells(desktop).at(-1)).toBe('unknown');
  });

  it('names the devices when an image with nothing to choose weighed different things', async () => {
    const capture = on(gallery(), 'iphone-se', [
      { ...logo(), transferBytes: 3120 },
      hero(187, '1080.png', { bytes: 118231 }),
      badge('300.png', { bytes: 8210 }),
    ]);

    const outcome = await run(['https://example.com/gallery'], returning(capture), cwd);

    // One line rather than a table, because there is nothing to explain — but
    // the bytes still arrived, so they are still reported. One device measured
    // them and four recorded none, and the line says which was which: a pair
    // of figures with no device against either is not per-device reporting.
    expect(outcome.stdout).toContain('  no srcset, so nothing was selected — file  logo.png');
    expect(outcome.stdout).toContain(
      '  bytes       3120 on iPhone SE, unknown on iPhone 15 Pro, Pixel 8, iPad, Desktop',
    );
  });

  it('keeps one figure for an image every device weighed the same', async () => {
    const weighed = { ...logo(), transferBytes: 3120 };
    let capture = gallery();
    for (const device of DEFAULT_PROFILES) {
      capture = on(capture, device.id, [
        weighed,
        hero(187, '1080.png', { bytes: 118231 }),
        badge('300.png', { bytes: 8210 }),
      ]);
    }

    const outcome = await run(['https://example.com/gallery'], returning(capture), cwd);

    // Where the devices agree, one figure is the whole truth, and five rows
    // saying 3120 would bury the images that do differ. That is what this
    // branch of the trace exists to avoid, so agreement names no device.
    expect(outcome.stdout).toContain('  bytes       3120\n');
    expect(outcome.stdout).not.toContain('3120 on');
  });

  it('names the devices for the file too, when an image with no srcset differs', async () => {
    // A plain `src` a script swapped per viewport: nothing selected it, and the
    // devices still fetched different files at different weights.
    const small = { ...logo(), currentSrc: 'https://example.com/i/100.png', transferBytes: 812 };
    const large = { ...logo(), currentSrc: 'https://example.com/i/1920.png', transferBytes: 342016 };
    let capture = gallery();
    for (const device of DEFAULT_PROFILES) {
      const narrow = device.viewport.width < 700;
      capture = on(capture, device.id, [
        narrow ? small : large,
        hero(187, '1080.png', { bytes: 118231 }),
        badge('300.png', { bytes: 8210 }),
      ]);
    }

    const outcome = await run(['https://example.com/gallery'], returning(capture), cwd);

    expect(outcome.stdout).toContain(
      '  no srcset, so nothing was selected — file  ' +
        '100.png on iPhone SE, iPhone 15 Pro, Pixel 8, 1920.png on iPad, Desktop',
    );
    expect(outcome.stdout).toContain(
      '  bytes       812 on iPhone SE, iPhone 15 Pro, Pixel 8, 342016 on iPad, Desktop',
    );
  });

  it('names the absent sizes attribute and the 100vw default that stood in', async () => {
    const desktopOnly = on(gallery(), 'desktop', [
      { ...hero(1440, '1920.png', { bytes: 342016 }), sizes: null },
    ]);
    const capture: Capture = {
      ...desktopOnly,
      devices: DEFAULT_PROFILES.filter((profile) => profile.id === 'desktop'),
      runs: desktopOnly.runs.filter((run) => run.deviceId === 'desktop'),
    };

    const outcome = await run(['https://example.com/gallery'], returning(capture), cwd);

    expect(outcome.stdout).toContain('  sizes       (absent)');
    expect(tableUnder(outcome.stdout, 'image 1 of 1').map(cells)).toEqual([
      [
        'device',
        'viewport',
        'DPR',
        'clause used',
        'css px',
        'needed',
        'picked',
        'file',
        'bytes arrived',
      ],
      [
        'Desktop',
        '1440×900',
        '1',
        'absent → 100vw default',
        '1440px',
        '1440px',
        '1920w',
        '1920.png',
        '342016',
      ],
    ]);
  });

  it('names the source a matching picture resolved the sizes string from', async () => {
    const resolved: CapturedImage = {
      ...hero(720, '1080.png', { bytes: 118231 }),
      candidates: parseSrcset('/i/1080.png 1080w, /i/1920.png 1920w'),
      sizes: '50vw',
      sizesSource: 'source',
    };
    const capture = on(gallery(), 'desktop', [
      logo(),
      resolved,
      badge('200.png', { bytes: 4102 }),
    ]);

    const outcome = await run(['https://example.com/gallery'], returning(capture), cwd);

    // What the image offered is not the same on every device once a `<source>`
    // is in play, so the block says which device offered what.
    expect(outcome.stdout).toContain(
      '  candidates  640w, 1080w, 1920w on iPhone SE, iPhone 15 Pro, Pixel 8, iPad',
    );
    expect(outcome.stdout).toContain('  candidates  1080w, 1920w on Desktop');
    expect(outcome.stdout).toContain(
      '  sizes       (min-width: 1000px) 50vw, 100vw on iPhone SE, iPhone 15 Pro, Pixel 8, iPad',
    );
    expect(outcome.stdout).toContain(
      '  sizes       50vw from a matching <source> on Desktop',
    );
  });

  it('says nothing about a source where every device read the img itself', async () => {
    // Which is every page with no `<picture>` on it, so the line a reader sees
    // most often is the one it has always been.
    const outcome = await run(['https://example.com/gallery'], returning(gallery()), cwd);

    expect(outcome.stdout).toContain('  candidates  640w, 1080w, 1920w\n');
    expect(outcome.stdout).toContain('  sizes       (min-width: 1000px) 50vw, 100vw\n');
    expect(outcome.stdout).not.toContain('<source>');
  });

  it('names the source once where every device resolved the same one', async () => {
    const capture: Capture = {
      ...gallery(),
      runs: gallery().runs.map((deviceRun) => ({
        ...deviceRun,
        images: deviceRun.images.map((image): CapturedImage =>
          image.candidates.length > 2 ? { ...image, sizesSource: 'source' } : image,
        ),
      })),
    };

    const outcome = await run(['https://example.com/gallery'], returning(capture), cwd);

    expect(outcome.stdout).toContain(
      '  sizes       (min-width: 1000px) 50vw, 100vw from a matching <source>\n',
    );
  });

  it('reports where an image sat when a render moved it', async () => {
    const moved = {
      ...hero(187, '1080.png', { bytes: 118231 }),
      selector: 'html > body > main > div > img',
    };
    let capture = gallery();
    for (const deviceId of ['iphone-se', 'iphone-15-pro', 'pixel-8']) {
      capture = on(capture, deviceId, [logo(), moved, badge('300.png', { bytes: 8210 })]);
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

  it('counts the CSS background images and says they select nothing', async () => {
    const painted = painting(gallery(), [4, 4, 4, 4, 4]);

    const outcome = await run(['https://example.com/gallery'], returning(painted), cwd);

    expect(lines(outcome.stdout)[2]).toBe(
      'css      4 background images. A CSS background image has no selection mechanism at ' +
        'all, so imgwhy counts them and explains nothing further.',
    );
  });

  it('names the devices when a media query painted a different number on each', async () => {
    // The count is a property of a render, not of a page, so one figure for
    // the whole capture would be a figure no device produced.
    const painted = painting(gallery(), [2, 2, 2, 2, 3]);

    const outcome = await run(['https://example.com/gallery'], returning(painted), cwd);

    expect(lines(outcome.stdout)[2]).toBe(
      'css      2 background images on iPhone SE, iPhone 15 Pro, Pixel 8, iPad, ' +
        '3 background images on Desktop. A CSS background image has no selection mechanism ' +
        'at all, so imgwhy counts them and explains nothing further.',
    );
  });

  it('says one background image in the singular, because one is what it counted', async () => {
    const outcome = await run(
      ['https://example.com/gallery'],
      returning(painting(gallery(), [1, 1, 1, 1, 1])),
      cwd,
    );

    expect(lines(outcome.stdout)[2]).toContain('1 background image. A CSS background image');
  });

  it('says nothing at all about backgrounds on a page whose CSS paints none', async () => {
    const outcome = await run(['https://example.com/gallery'], returning(gallery()), cwd);

    // A line reading "0 background images" on every page would bury the pages
    // that have some.
    expect(outcome.stdout).not.toContain('background image');
    expect(lines(outcome.stdout)[2]).toBe('');
  });

  it('says plainly when the page carries no image at all', async () => {
    const outcome = await run(
      ['https://example.com/gallery'],
      returning(withNoImages(gallery())),
      cwd,
    );

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
    expect(outcome.stderr).toContain(USAGE);
    expect(started).toBe(0);
  });
});

/**
 * `--device` picks from the set a run would otherwise have rendered whole. It
 * names no device of its own, so what a name means is still the config file's
 * to say, and what order the names render in is still the profile set's.
 */
describe('run, asked for some of the devices', () => {
  it('renders the one device --device names, and the Capture records only it', async () => {
    let asked: string[] = [];
    const capture: CaptureFn = (options) => {
      asked = options.profiles.map((p) => p.id);
      return rendering()(options);
    };

    const outcome = await run(
      ['--json', '--device', 'desktop', 'https://example.com/gallery'],
      capture,
      cwd,
    );

    expect(outcome.code).toBe(0);
    expect(asked).toEqual(['desktop']);
    const captured: Capture = JSON.parse(outcome.stdout);
    expect(captured.devices).toEqual([DEFAULT_PROFILES[4]]);
    expect(captured.runs.map((deviceRun) => deviceRun.deviceId)).toEqual(['desktop']);
  });

  it('renders the devices a comma-separated list names', async () => {
    let asked: string[] = [];
    const capture: CaptureFn = (options) => {
      asked = options.profiles.map((p) => p.id);
      return Promise.resolve(gallery());
    };

    await run(['--device', 'iphone-se,ipad', 'https://example.com/gallery'], capture, cwd);

    expect(asked).toEqual(['iphone-se', 'ipad']);
  });

  it('renders them in profile-set order, whatever order the flag named them in', async () => {
    // Two runs of one page print the same trace, because the order small to
    // large is the profile set's to decide and the flag only says which of
    // them run.
    let asked: string[] = [];
    const capture: CaptureFn = (options) => {
      asked = options.profiles.map((p) => p.id);
      return Promise.resolve(gallery());
    };

    await run(['--device', 'desktop,ipad,iphone-se', 'https://example.com/gallery'], capture, cwd);

    expect(asked).toEqual(['iphone-se', 'ipad', 'desktop']);
  });

  it('stops before the browser when no profile carries the id given', async () => {
    let started = 0;
    const capture: CaptureFn = () => {
      started++;
      return Promise.reject(new Error('the browser must not start'));
    };

    const outcome = await run(
      ['--device', 'nosuch', 'https://example.com/gallery'],
      capture,
      cwd,
    );

    expect(started).toBe(0);
    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toBe('');
    // The id that was not found, and the ids that were there to find. The set
    // is configurable, so a reader cannot be expected to know it.
    expect(outcome.stderr).toBe(
      'no device is called "nosuch", and this run can render ' +
        'iphone-se, iphone-15-pro, pixel-8, ipad, desktop\n',
    );
  });

  it('takes the ids imgwhy.config.json names, and renders the profile it named', async () => {
    writeFileSync(
      join(cwd, 'imgwhy.config.json'),
      JSON.stringify({
        devices: [
          { id: 'kiosk', name: 'Kiosk', viewport: { width: 1080, height: 1920 }, dpr: 1 },
          { id: 'till', name: 'Till', viewport: { width: 800, height: 480 }, dpr: 1 },
        ],
      }),
      'utf8',
    );
    let asked: string[] = [];
    const capture: CaptureFn = (options) => {
      asked = options.profiles.map((p) => p.id);
      return Promise.resolve(gallery());
    };

    await run(['--device', 'till', 'https://example.com/gallery'], capture, cwd);

    expect(asked).toEqual(['till']);
  });

  it('refuses a built-in id where the config file replaced the set', async () => {
    writeFileSync(
      join(cwd, 'imgwhy.config.json'),
      JSON.stringify({
        devices: [{ id: 'kiosk', name: 'Kiosk', viewport: { width: 1080, height: 1920 }, dpr: 1 }],
      }),
      'utf8',
    );
    let started = 0;
    const capture: CaptureFn = () => {
      started++;
      return Promise.reject(new Error('the browser must not start'));
    };

    const outcome = await run(['--device', 'desktop', 'https://example.com/gallery'], capture, cwd);

    expect(started).toBe(0);
    expect(outcome.code).toBe(1);
    // A config file replaces the set outright, so `desktop` is a name this run
    // does not have, and the ids listed are the ones the file gave.
    expect(outcome.stderr).toBe(
      'no device is called "desktop", and this run can render kiosk\n',
    );
  });

  it('writes every sink asked for from the filtered run', async () => {
    const out = join(cwd, 'capture.json');
    const report = join(cwd, 'report.html');

    const outcome = await run(
      [
        '--json',
        '--out',
        out,
        '--report',
        report,
        '--device',
        'desktop',
        'https://example.com/gallery',
      ],
      rendering(),
      cwd,
    );

    expect(outcome.stderr).toBe('');
    expect(outcome.code).toBe(0);
    const desktopOnly: Capture = {
      ...gallery(),
      devices: [DEFAULT_PROFILES[4]],
      runs: gallery().runs.filter((deviceRun) => deviceRun.deviceId === 'desktop'),
    };
    expect(JSON.parse(outcome.stdout)).toStrictEqual(desktopOnly);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toStrictEqual(desktopOnly);
    expect(readFileSync(report, 'utf8')).toBe(renderReport(desktopOnly));
  });

  it('prints the trace of the one device it rendered', async () => {
    const outcome = await run(
      ['--device', 'desktop', 'https://example.com/gallery'],
      rendering(),
      cwd,
    );

    expect(outcome.code).toBe(0);
    expect(lines(outcome.stdout)[1]).toBe('images   3 on 1 devices');
    expect(tableUnder(outcome.stdout, 'image 2 of 3').map((row) => cells(row)[0])).toEqual([
      'device',
      'Desktop',
    ]);
  });
});

describe('run, asked for the capture itself', () => {
  it('prints the capture as JSON, and nothing else on that stream', async () => {
    const outcome = await run(
      ['--json', 'https://example.com/gallery'],
      returning(gallery()),
      cwd,
    );

    expect(outcome.stderr).toBe('');
    expect(outcome.code).toBe(0);
    // No banner, no trailing note: the whole stream is the document.
    expect(JSON.parse(outcome.stdout)).toEqual(gallery());
  });

  it('keeps human text the default when no format is asked for', async () => {
    const outcome = await run(['https://example.com/gallery'], returning(gallery()), cwd);

    expect(outcome.stdout.startsWith('url      ')).toBe(true);
  });

  it('writes the capture to the path --out names', async () => {
    const out = join(cwd, 'capture.json');

    const outcome = await run(
      ['--out', out, 'https://example.com/gallery'],
      returning(gallery()),
      cwd,
    );

    expect(outcome.code).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(gallery());
  });

  it('still prints the trace when --out is given without --json', async () => {
    const out = join(cwd, 'capture.json');

    const outcome = await run(
      ['--out', out, 'https://example.com/gallery'],
      returning(gallery()),
      cwd,
    );

    expect(outcome.stdout.startsWith('url      ')).toBe(true);
    expect(outcome.stdout).toContain('image 2 of 3');
  });

  it('writes the same bytes to the file and to stdout when both are asked', async () => {
    const out = join(cwd, 'capture.json');

    const outcome = await run(
      ['--json', '--out', out, 'https://example.com/gallery'],
      returning(gallery()),
      cwd,
    );

    expect(readFileSync(out, 'utf8')).toBe(outcome.stdout);
  });

  it('parses a written capture back to structurally identical data', async () => {
    const out = join(cwd, 'capture.json');
    const original = gallery();

    await run(['--out', out, 'https://example.com/gallery'], returning(original), cwd);
    const readBack: Capture = JSON.parse(readFileSync(out, 'utf8'));

    // Through a real file, so anything JSON cannot carry is caught here.
    // Strictly, because `toEqual` counts a field `JSON.stringify` dropped as
    // equal to one that was never there.
    expect(readBack).toStrictEqual(original);
    expect(readBack.runs[0].images[1].candidates).toStrictEqual(parseSrcset(HERO_SRCSET));
    expect(readBack.devices).toStrictEqual(DEFAULT_PROFILES);
  });

  it('writes no file at all when --out is not given', async () => {
    const before = readdirSync(cwd);

    await run(['--json', 'https://example.com/gallery'], returning(gallery()), cwd);

    expect(readdirSync(cwd)).toEqual(before);
  });

  it('writes the one file --out names and no other', async () => {
    const out = join(cwd, 'capture.json');

    await run(['--out', out, 'https://example.com/gallery'], returning(gallery()), cwd);

    expect(readdirSync(cwd)).toEqual(['capture.json']);
  });

  it('reports a path it could not write to, rather than printing the trace', async () => {
    const out = join(cwd, 'no-such-directory', 'capture.json');

    const outcome = await run(
      ['--out', out, 'https://example.com/gallery'],
      returning(gallery()),
      cwd,
    );

    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain(out);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it('writes the capture of a page with no image, which is a capture like any other', async () => {
    const out = join(cwd, 'capture.json');
    const empty = withNoImages(gallery());

    const outcome = await run(['--out', out, 'https://example.com/gallery'], returning(empty), cwd);

    // The artifact was asked for and produced, so the run worked. An image
    // that has gone missing from a page is the diff a kept Capture is for.
    expect(outcome.code).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toStrictEqual(empty);
    expect(readdirSync(cwd)).toEqual(['capture.json']);
    // The trace is the one output with nothing to say, and it says so.
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain('carries no <img> element');
  });

  it('prints the capture of a page carrying no image', async () => {
    const empty = withNoImages(gallery());

    const outcome = await run(['--json', 'https://example.com/gallery'], returning(empty), cwd);

    expect(outcome.code).toBe(0);
    expect(JSON.parse(outcome.stdout)).toStrictEqual(empty);
    expect(outcome.stderr).toContain('carries no <img> element');
  });
});

describe('run, asked for the report', () => {
  it('writes the report to the path --report names', async () => {
    const report = join(cwd, 'report.html');

    const outcome = await run(
      ['--report', report, 'https://example.com/gallery'],
      returning(gallery()),
      cwd,
    );

    expect(outcome.code).toBe(0);
    // Byte for byte the report of that Capture: the command chooses the path
    // and nothing else about the file.
    expect(readFileSync(report, 'utf8')).toBe(renderReport(gallery()));
  });

  it('writes one HTML file and no sidecar asset beside it', async () => {
    const report = join(cwd, 'report.html');

    await run(['--report', report, 'https://example.com/gallery'], returning(gallery()), cwd);

    expect(readdirSync(cwd)).toEqual(['report.html']);
  });

  it('writes no file at all when --report is not given', async () => {
    const before = readdirSync(cwd);

    await run(['https://example.com/gallery'], returning(gallery()), cwd);

    expect(readdirSync(cwd)).toEqual(before);
  });

  it('still prints the trace when --report is given', async () => {
    const report = join(cwd, 'report.html');

    const outcome = await run(
      ['--report', report, 'https://example.com/gallery'],
      returning(gallery()),
      cwd,
    );

    expect(outcome.stdout.startsWith('url      ')).toBe(true);
    expect(outcome.stdout).toContain('image 2 of 3');
  });

  it('writes the Capture and the report from one run when both are asked', async () => {
    const out = join(cwd, 'capture.json');
    const report = join(cwd, 'report.html');

    const outcome = await run(
      ['--out', out, '--report', report, 'https://example.com/gallery'],
      returning(gallery()),
      cwd,
    );

    expect(outcome.code).toBe(0);
    expect(readdirSync(cwd).sort()).toEqual(['capture.json', 'report.html']);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(gallery());
    expect(readFileSync(report, 'utf8')).toBe(renderReport(gallery()));
  });

  it('reports a path it could not write to, rather than printing the trace', async () => {
    const report = join(cwd, 'no-such-directory', 'report.html');

    const outcome = await run(
      ['--report', report, 'https://example.com/gallery'],
      returning(gallery()),
      cwd,
    );

    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain(report);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it('writes the report of a page with no image, which is a report like any other', async () => {
    const report = join(cwd, 'report.html');
    const empty = withNoImages(gallery());

    const outcome = await run(
      ['--report', report, 'https://example.com/gallery'],
      returning(empty),
      cwd,
    );

    // The artifact was asked for and produced, so the run did its job. An
    // image that has gone missing is the diff a kept report is for.
    expect(outcome.code).toBe(0);
    expect(readFileSync(report, 'utf8')).toBe(renderReport(empty));
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain('carries no <img> element');
  });

  it('renders the report the report package renders, and does not build one itself', async () => {
    const report = join(cwd, 'report.html');
    const capture = on(gallery(), 'desktop', [hero(1440, '1920.png', { bytes: 342_016 })]);

    await run(['--report', report, 'https://example.com/gallery'], returning(capture), cwd);

    expect(readFileSync(report, 'utf8')).toBe(renderReport(capture));
  });
});

/**
 * The path `--report` names is the only thing that decides where the report
 * lands, for every reason the same is true of `--out`.
 *
 * The report is the worse of the two to get wrong: it is the artifact people
 * mail to each other, so a page that could choose its name could choose what
 * a colleague opens.
 */
describe('run, given a URL that reads like a path, asked for a report', () => {
  const traversal = [
    'https://example.com/../../etc/passwd',
    'https://../x',
    'https://example.com/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  ];

  it.each(traversal)('writes to the path --report names, not one derived from %s', async (raw) => {
    const report = join(cwd, 'report.html');
    // The capture reports the URL the page ended on, which a redirect chooses.
    const landed: Capture = { ...gallery(), url: '../../../../etc/passwd.html' };

    const outcome = await run(['--report', report, raw], returning(landed), cwd);

    expect(outcome.code).toBe(0);
    expect(readdirSync(cwd)).toEqual(['report.html']);
    expect(readFileSync(report, 'utf8')).toBe(renderReport(landed));
  });
});

/**
 * The path `--out` names is the only thing that decides where a file lands.
 *
 * The page is the untrusted half of a run: the URL is typed by whoever asked,
 * and `Capture.url` is worse than that — it is the URL a redirect chose, so a
 * hostile host names it. Neither may reach the filesystem. These runs give the
 * page every path-shaped string that could be mistaken for one and check that
 * the file lands where it was told to and the directory holds nothing else.
 */
describe('run, given a URL that reads like a path', () => {
  const traversal = [
    'https://example.com/../../etc/passwd',
    'https://../x',
    'https://example.com/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  ];

  it.each(traversal)('writes to the path --out names, not one derived from %s', async (raw) => {
    const out = join(cwd, 'capture.json');
    // The capture reports the URL the page ended on, which a redirect chooses.
    const landed: Capture = { ...gallery(), url: '../../../../etc/passwd' };

    const outcome = await run(['--out', out, raw], returning(landed), cwd);

    expect(outcome.code).toBe(0);
    expect(readdirSync(cwd)).toEqual(['capture.json']);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(landed);
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
