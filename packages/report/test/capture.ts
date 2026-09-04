import type { Capture, CapturedImage, DeviceProfile, DeviceRun } from '@imgwhy/core';
import { parseSrcset } from '@imgwhy/core';

/**
 * A Capture to render, built here rather than measured.
 *
 * The report is a pure function of a Capture, so its tests need no browser and
 * no runner — which is also the boundary the package holds. These are the five
 * profiles the runner ships, written out, because a fixture that imported them
 * would import the runner.
 */
export const DEVICES: DeviceProfile[] = [
  { id: 'iphone-se', name: 'iPhone SE', viewport: { width: 375, height: 667 }, dpr: 2 },
  { id: 'iphone-15-pro', name: 'iPhone 15 Pro', viewport: { width: 393, height: 852 }, dpr: 3 },
  { id: 'pixel-8', name: 'Pixel 8', viewport: { width: 412, height: 915 }, dpr: 2.625 },
  { id: 'ipad', name: 'iPad', viewport: { width: 820, height: 1180 }, dpr: 2 },
  { id: 'desktop', name: 'Desktop', viewport: { width: 1440, height: 900 }, dpr: 1 },
];

const HERO_SRCSET = '/i/640.png 640w, /i/1080.png 1080w, /i/1920.png 1920w';

/** No `srcset` and no transfer recorded: nothing to select, weight unknown. */
export const logo = (): CapturedImage => ({
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

export const hero = (renderedWidth: number, file: string, bytes: number): CapturedImage => ({
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

/**
 * The hero as a `<picture>` offered it to one device: the candidates and the
 * `sizes` string off the `<source>` whose `media` matched, not off the tag.
 *
 * The same id, because it is the same element — one row of the matrix, whose
 * heading has two things to say about what was offered.
 */
export const sourced = (renderedWidth: number, file: string, bytes: number): CapturedImage => ({
  ...hero(renderedWidth, file, bytes),
  candidates: parseSrcset('/i/1080.png 1080w, /i/1920.png 1920w'),
  sizes: '50vw',
  sizesSource: 'source',
});

export const badge = (file: string, bytes: number): CapturedImage => ({
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

/** Three images with three reasons to pick a file, across the five profiles. */
export const gallery = (): Capture => {
  const runs: DeviceRun[] = [
    {
      deviceId: 'iphone-se',
      images: [logo(), hero(187, '1080.png', 118_231), badge('300.png', 8210)],
      backgroundImageCount: 0,
    },
    {
      deviceId: 'iphone-15-pro',
      images: [logo(), hero(196, '1920.png', 342_016), badge('300.png', 8210)],
      backgroundImageCount: 0,
    },
    {
      deviceId: 'pixel-8',
      images: [logo(), hero(206, '1920.png', 342_016), badge('300.png', 8210)],
      backgroundImageCount: 0,
    },
    {
      deviceId: 'ipad',
      images: [logo(), hero(410, '1920.png', 342_016), badge('300.png', 8210)],
      backgroundImageCount: 0,
    },
    {
      deviceId: 'desktop',
      images: [logo(), hero(720, '1080.png', 118_231), badge('200.png', 4102)],
      backgroundImageCount: 0,
    },
  ];
  return {
    url: 'https://example.com/gallery',
    capturedAt: '2026-09-03T00:00:00.000Z',
    devices: DEVICES,
    runs,
  };
};

/** The same capture with one device's run replaced, named by its device id. */
export const on = (capture: Capture, deviceId: string, images: CapturedImage[]): Capture => ({
  ...capture,
  runs: capture.runs.map((run) => (run.deviceId === deviceId ? { ...run, images } : run)),
});

/** The same capture with a background image count per run, in device order. */
export const painting = (capture: Capture, counts: number[]): Capture => {
  if (counts.length !== capture.runs.length) {
    throw new Error(`${capture.runs.length} runs and ${counts.length} counts to paint them with`);
  }
  return {
    ...capture,
    runs: capture.runs.map((run, index) => ({ ...run, backgroundImageCount: counts[index] })),
  };
};
