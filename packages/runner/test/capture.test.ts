import type { DeviceProfile } from '@imgwhy/core';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DESKTOP_PROFILE, capturePage } from '../src/index.js';
import { type FixtureServer, startFixtureServer } from './fixture-server.js';

/** The case from the design: 640 CSS px at DPR 1.5 needs 960, so 1080w wins. */
const canonical: DeviceProfile = {
  id: 'canonical',
  name: 'Canonical',
  viewport: { width: 640, height: 800 },
  dpr: 1.5,
};

let server: FixtureServer;
beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

describe('capturePage', () => {
  it('captures the candidate a 640px viewport at DPR 1.5 downloads', async () => {
    const url = `${server.url}/w-descriptors.html`;

    const capture = await capturePage({ url, profile: canonical });

    expect(capture.url).toBe(url);
    expect(new Date(capture.capturedAt).toISOString()).toBe(capture.capturedAt);
    expect(capture.devices).toEqual([canonical]);
    expect(capture.runs).toHaveLength(1);
    expect(capture.runs[0]?.deviceId).toBe('canonical');

    const hero = capture.runs[0]?.images.at(-1);
    expect(hero?.selector).toBe('html > body > main > img');
    expect(hero?.candidates.map((c) => c.raw)).toEqual(['640w', '1080w', '1920w']);
    expect(hero?.sizes).toBe('100vw');
    expect(hero?.sizesSource).toBe('img');
    expect(hero?.renderedWidth).toBe(640);
    expect(hero?.currentSrc).toBe(`${server.url}/img/1080.png`);
    // `naturalWidth` is the intrinsic width in CSS pixels, so the browser has
    // already divided the 1080 pixel file by the density it picked it at.
    expect(hero?.naturalWidth).toBe(640);
    expect(hero?.loading).toBeNull();
    expect(hero?.transferBytes).toBeNull();
  });

  it('skips images too small to have been chosen, and reads loading', async () => {
    const capture = await capturePage({
      url: `${server.url}/w-descriptors.html`,
      profile: canonical,
    });

    const images = capture.runs[0]?.images ?? [];
    // The 1x1 pixel is gone; the logo and the hero remain, in document order.
    expect(images.map((i) => i.selector)).toEqual([
      'html > body > header > img',
      'html > body > main > img',
    ]);
    expect(images[0]?.loading).toBe('lazy');
    expect(images[0]?.candidates).toEqual([]);
  });

  it('gives an image the same id under a different device profile', async () => {
    const url = `${server.url}/w-descriptors.html`;

    const small = await capturePage({ url, profile: canonical });
    const desktop = await capturePage({ url, profile: DESKTOP_PROFILE });

    expect(desktop.runs[0]?.images.map((i) => i.id)).toEqual(
      small.runs[0]?.images.map((i) => i.id),
    );
    expect(desktop.runs[0]?.images.at(-1)?.renderedWidth).toBe(1440);
  });

  it('reads the srcset of the <source> whose media matches', async () => {
    const capture = await capturePage({ url: `${server.url}/picture.html`, profile: canonical });

    const hero = capture.runs[0]?.images[0];
    expect(hero?.sizesSource).toBe('source');
    expect(hero?.candidates.map((c) => c.raw)).toEqual(['640w', '1080w']);
    expect(hero?.currentSrc).toBe(`${server.url}/img/1080.png`);
  });

  it('falls back to the <img> when no <source> media matches', async () => {
    const capture = await capturePage({
      url: `${server.url}/picture.html`,
      profile: DESKTOP_PROFILE,
    });

    const hero = capture.runs[0]?.images[0];
    expect(hero?.sizesSource).toBe('img');
    expect(hero?.candidates.map((c) => c.raw)).toEqual(['1920w']);
  });

  it('closes the browser when the page fails to load', async () => {
    let opened: Browser | undefined;
    const launch = async (): Promise<Browser> => {
      opened = await chromium.launch();
      return opened;
    };

    await expect(
      capturePage({ url: 'http://127.0.0.1:1/nothing-listens-here', profile: canonical, launch }),
    ).rejects.toThrow();

    expect(opened).toBeDefined();
    expect(opened?.isConnected()).toBe(false);
  });

  it('names the missing browser rather than crashing cryptically', async () => {
    const launch = (): Promise<Browser> =>
      Promise.reject(
        new Error("browserType.launch: Executable doesn't exist at /nowhere/headless_shell"),
      );

    await expect(
      capturePage({ url: `${server.url}/w-descriptors.html`, profile: canonical, launch }),
    ).rejects.toThrow(/npx playwright install chromium/);
  });
});
