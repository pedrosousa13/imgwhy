import type { Capture, CapturedImage } from '@imgwhy/core';
import { parseSrcset } from '@imgwhy/core';
import { DESKTOP_PROFILE } from '@imgwhy/runner';
import { describe, expect, it } from 'vitest';
import { type CaptureFn, run } from '../src/run.js';

const logo: CapturedImage = {
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
};

const hero: CapturedImage = {
  id: 'html > body > main > img',
  selector: 'html > body > main > img',
  candidates: parseSrcset(
    '/i/hero-640.png 640w, /i/hero-1080.png 1080w, /i/hero-1920.png 1920w',
  ),
  sizes: '(min-width: 1000px) 50vw, 100vw',
  sizesSource: 'img',
  renderedWidth: 720,
  currentSrc: 'https://example.com/i/hero-1080.png',
  naturalWidth: 720,
  transferBytes: null,
  loading: null,
};

const captureOf = (...images: CapturedImage[]): Capture => ({
  url: 'https://example.com/page',
  capturedAt: '2026-09-03T00:00:00.000Z',
  devices: [DESKTOP_PROFILE],
  runs: [{ deviceId: DESKTOP_PROFILE.id, images }],
});

const returning =
  (capture: Capture): CaptureFn =>
  () =>
    Promise.resolve(capture);

describe('run', () => {
  it('traces the first image carrying more than one candidate', async () => {
    const outcome = await run(['https://example.com/page'], returning(captureOf(logo, hero)));

    expect(outcome.stderr).toBe('');
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toBe(
      [
        'url        https://example.com/page',
        'device     Desktop — 1440×900 at DPR 1',
        'element    html > body > main > img',
        'candidates 640w, 1080w, 1920w',
        'rendered   720 css px',
        '',
        'sizes (min-width: 1000px) 50vw, 100vw',
        '  clause used  (min-width: 1000px) 50vw',
        '  resolves to  720px at viewport 1440',
        '  × DPR 1  =  720 physical pixels needed',
        '  smallest candidate ≥ that  →  1080w',
        'predicted  hero-1080.png',
        'actual     hero-1080.png',
        '',
      ].join('\n'),
    );
  });

  it('names the absent sizes attribute in the reference wording', async () => {
    const bare: CapturedImage = { ...hero, sizes: null, renderedWidth: 1440 };

    const outcome = await run(['https://example.com/page'], returning(captureOf(bare)));

    expect(outcome.stdout).toContain('sizes (absent)');
    expect(outcome.stdout).toContain('  clause used  absent → 100vw default');
    expect(outcome.stdout).toContain('  resolves to  1440px at viewport 1440');
    expect(outcome.stdout).toContain('  × DPR 1  =  1440 physical pixels needed');
    expect(outcome.stdout).toContain('  smallest candidate ≥ that  →  1920w');
  });

  it('says sizes is ignored when the candidates carry x descriptors', async () => {
    const density: CapturedImage = {
      ...hero,
      candidates: parseSrcset('/i/logo.png 1x, /i/logo@2x.png 2x'),
      currentSrc: 'https://example.com/i/logo.png',
    };

    const outcome = await run(['https://example.com/page'], returning(captureOf(density)));

    expect(outcome.stdout).toContain('x descriptors only — sizes ignored. Device DPR 1 → 1x');
  });

  it('flags a picked candidate the page did not load', async () => {
    const cached: CapturedImage = { ...hero, currentSrc: 'https://example.com/i/hero-1920.png' };

    const outcome = await run(['https://example.com/page'], returning(captureOf(cached)));

    expect(outcome.stdout).toContain(
      'actual     hero-1920.png   ← differs: a larger variant was already cached, so no new pick ran',
    );
  });

  it('says plainly when no image on the page has a choice to make', async () => {
    const outcome = await run(['https://example.com/page'], returning(captureOf(logo)));

    expect(outcome.code).toBe(1);
    expect(outcome.stdout).toBe('');
    expect(outcome.stderr).toContain('more than one srcset candidate');
  });

  it('reports what the runner could not do', async () => {
    const failing: CaptureFn = () => Promise.reject(new Error('Playwright has no Chromium to run'));

    const outcome = await run(['https://example.com/page'], failing);

    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('Playwright has no Chromium to run');
  });

  it('prints usage when no URL is given', async () => {
    let started = 0;
    const capture: CaptureFn = () => {
      started++;
      return Promise.reject(new Error('the browser must not start'));
    };

    const outcome = await run([], capture);

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

      const outcome = await run([raw], capture);

      expect(started).toBe(0);
      expect(outcome.code).toBe(1);
      expect(outcome.stdout).toBe('');
      expect(outcome.stderr.trim().length).toBeGreaterThan(0);
    },
  );
});
