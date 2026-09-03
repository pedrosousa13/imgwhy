import type { DeviceProfile } from '@imgwhy/core';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILES, capturePage } from '../src/index.js';
import { type FixtureServer, startFixtureServer } from './fixture-server.js';
import { encodePng } from './png.js';

/** The case from the design: 640 CSS px at DPR 1.5 needs 960, so 1080w wins. */
const canonical: DeviceProfile = {
  id: 'canonical',
  name: 'Canonical',
  viewport: { width: 640, height: 800 },
  dpr: 1.5,
};

/** The widest of the default profiles, which is the last of them. */
const desktop = DEFAULT_PROFILES[4];

let server: FixtureServer;
/** A second origin, because `127.0.0.1:A` and `127.0.0.1:B` are two of them. */
let elsewhere: FixtureServer;
beforeAll(async () => {
  server = await startFixtureServer();
  elsewhere = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
  await elsewhere.close();
});

/**
 * A browser that records the order it detached CDP sessions and closed
 * contexts in, so a test can prove the session went first.
 *
 * Playwright announces neither, and a session that outlived its context would
 * look the same from the outside as one that did not: sending on it fails
 * either way once the context is gone. The order is the observable difference.
 */
function recording(order: string[]): () => Promise<Browser> {
  return async () => {
    const browser = await chromium.launch();
    const openContext = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await openContext(options);
      const openSession = context.newCDPSession.bind(context);
      const closeContext = context.close.bind(context);
      context.newCDPSession = async (target) => {
        const session = await openSession(target);
        const detach = session.detach.bind(session);
        session.detach = async () => {
          order.push('detach');
          await detach();
        };
        return session;
      };
      context.close = async (options) => {
        order.push('close');
        await closeContext(options);
      };
      return context;
    };
    return browser;
  };
}

describe('capturePage', () => {
  it('captures the candidate a 640px viewport at DPR 1.5 downloads', async () => {
    const url = `${server.url}/w-descriptors.html`;

    const capture = await capturePage({ url, profiles: [canonical] });

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

    // The bytes the protocol reported for the response the hero displays.
    // `encodedDataLength` counts the response headers too, so it sits a little
    // above the file, and nowhere near the 1080 pixels a guess would use.
    const file = encodePng(1080, 2).length;
    expect(hero?.transferBytes).toBeGreaterThanOrEqual(file);
    expect(hero?.transferBytes).toBeLessThan(file + 500);
  });

  it('captures every image, including ones no one can see, and reads loading', async () => {
    const capture = await capturePage({
      url: `${server.url}/w-descriptors.html`,
      profiles: [canonical],
    });

    const images = capture.runs[0]?.images ?? [];
    // A 1×1 tracking pixel and a `display: none` image are bytes the page
    // asked for, so the runner records them beside the logo and the hero, in
    // document order.
    expect(images.map((i) => i.selector)).toEqual([
      'html > body > img:nth-of-type(1)',
      'html > body > img:nth-of-type(2)',
      'html > body > header > img',
      'html > body > main > img',
    ]);
    expect(images[0]?.currentSrc).toBe(`${server.url}/img/1.png`);
    expect(images[1]?.currentSrc).toBe(`${server.url}/img/100.png`);
    expect(images[2]?.loading).toBe('lazy');
    expect(images[2]?.candidates).toEqual([]);
  });

  it('runs every profile in its own context, each with its own deviceScaleFactor', async () => {
    const capture = await capturePage({
      url: `${server.url}/densities.html`,
      profiles: DEFAULT_PROFILES,
    });

    expect(capture.devices).toEqual(DEFAULT_PROFILES);
    expect(capture.runs.map((r) => r.deviceId)).toEqual([
      'iphone-se',
      'iphone-15-pro',
      'pixel-8',
      'ipad',
      'desktop',
    ]);

    // The page offers one file per density, so the file each run loaded is the
    // `deviceScaleFactor` its context actually ran with.
    expect(capture.runs.map((r) => r.images[0]?.currentSrc)).toEqual([
      `${server.url}/img/200.png`,
      `${server.url}/img/300.png`,
      `${server.url}/img/262.png`,
      `${server.url}/img/200.png`,
      `${server.url}/img/100.png`,
    ]);
  }, 60_000);

  it('renders every profile with the HTTP cache disabled', async () => {
    server.requests.length = 0;

    await capturePage({ url: `${server.url}/densities.html`, profiles: DEFAULT_PROFILES });

    // The fixture serves its images `immutable` for a year, so a browser left
    // to itself would hold them. Every request says otherwise, which is the
    // instruction reaching Chromium — the document's and each image's, on all
    // five profiles.
    expect(server.requests.length).toBeGreaterThanOrEqual(10);
    expect(server.requests.every((r) => r.cacheControl === 'no-cache')).toBe(true);
    expect(server.requests.filter((r) => r.path === '/densities.html')).toHaveLength(5);
  }, 60_000);

  it('keeps an image id stable when a render reparents the image', async () => {
    const capture = await capturePage({
      url: `${server.url}/reparent.html`,
      profiles: DEFAULT_PROFILES,
    });

    // The narrow renders moved the hero into a wrapper, so the DOM path the
    // page reports differs run to run.
    expect(capture.runs.map((r) => r.images.at(-1)?.selector)).toEqual([
      'html > body > main > div > img',
      'html > body > main > div > img',
      'html > body > main > div > img',
      'html > body > main > img',
      'html > body > main > img',
    ]);

    // The id does not, so the matrix can still align the rows.
    const ids = capture.runs.map((r) => r.images.map((i) => i.id));
    expect(ids).toEqual([
      ['html > body > nav > img', 'html > body > main > div > img'],
      ['html > body > nav > img', 'html > body > main > div > img'],
      ['html > body > nav > img', 'html > body > main > div > img'],
      ['html > body > nav > img', 'html > body > main > div > img'],
      ['html > body > nav > img', 'html > body > main > div > img'],
    ]);
  }, 60_000);

  it('lets DPR alone decide when the candidates carry x descriptors', async () => {
    const capture = await capturePage({
      url: `${server.url}/x-descriptors.html`,
      profiles: [canonical],
    });

    const logo = capture.runs[0]?.images[0];
    expect(logo?.candidates.map((c) => c.raw)).toEqual(['1x', '2x']);
    // The tag carries `sizes`, and the browser read past it: a 120 CSS px logo
    // needs 180 physical pixels, so a resolved `sizes` would have taken the
    // 640 pixel file. DPR 1.5 took the 2x one instead.
    expect(logo?.sizes).toBe('100vw');
    expect(logo?.renderedWidth).toBe(120);
    expect(logo?.currentSrc).toBe(`${server.url}/img/1080.png`);
  });

  it('records the URL the page ended on, not the one that was requested', async () => {
    const capture = await capturePage({ url: `${server.url}/nested`, profiles: [desktop] });

    // A relative candidate resolves against this, so the requested URL would
    // send every one of them to the wrong directory.
    expect(capture.url).toBe(`${server.url}/nested/`);
  });

  it('reports real bytes for a cross-origin response with no Timing-Allow-Origin', async () => {
    const url = `${server.url}/cross-origin.html?origin=${encodeURIComponent(elsewhere.url)}`;

    const capture = await capturePage({ url, profiles: [desktop] });

    const hero = capture.runs[0]?.images[0];
    expect(hero?.currentSrc).toBe(`${elsewhere.url}/img/1920.png`);
    const file = encodePng(1920, 2).length;
    expect(hero?.transferBytes).toBeGreaterThanOrEqual(file);
    expect(hero?.transferBytes).toBeLessThan(file + 500);

    // Why the protocol, and not the page: the same response, measured from
    // inside the same render, reports nothing at all. `transferSize` is zero
    // for a cross-origin response that sends no `Timing-Allow-Origin`, which
    // is every image CDN, so an in-page tool cannot report real weight.
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: desktop.viewport,
        deviceScaleFactor: desktop.dpr,
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      const inPage = await page.evaluate((src) => {
        const entry = performance.getEntriesByType('resource').find((e) => e.name === src);
        return entry instanceof PerformanceResourceTiming ? entry.transferSize : null;
      }, hero?.currentSrc ?? '');

      expect(inPage).toBe(0);
    } finally {
      await browser.close();
    }
  }, 60_000);

  it('gives every image that displays one response the bytes that response cost', async () => {
    server.requests.length = 0;

    const capture = await capturePage({
      url: `${server.url}/shared-url.html`,
      profiles: [desktop],
    });

    const images = capture.runs[0]?.images ?? [];
    expect(images.map((i) => i.currentSrc)).toEqual([
      `${server.url}/img/640.png`,
      `${server.url}/img/640.png`,
    ]);
    // One request served both elements, which is Blink's memory cache and the
    // browser behaviour under study rather than a cache to defeat. So the
    // mapping cannot say which element the bytes belong to, and it does not
    // try: both carry what the response cost. Adding this column up over a
    // page counts a shared response once per element.
    expect(server.requests.filter((r) => r.path === '/img/640.png')).toHaveLength(1);
    expect(images[0]?.transferBytes).toBeGreaterThan(0);
    expect(images[1]?.transferBytes).toBe(images[0]?.transferBytes);
  });

  it('reports unknown where nothing crossed the wire, however many pixels arrived', async () => {
    const capture = await capturePage({
      url: `${server.url}/unknown-bytes.html`,
      profiles: [desktop],
    });

    const [inline, refused] = capture.runs[0]?.images ?? [];
    // 1920 pixels wide and no transfer of its own, because the bytes came
    // inside the document. A guess from pixels would answer here; nothing does.
    expect(inline?.naturalWidth).toBe(1920);
    expect(inline?.transferBytes).toBeNull();
    // A request that never finished, so there is no size to report.
    expect(refused?.currentSrc).toBe('http://127.0.0.1:1/img/640.png');
    expect(refused?.naturalWidth).toBe(0);
    expect(refused?.transferBytes).toBeNull();
  });

  it('detaches the CDP session of every profile before closing its context', async () => {
    const order: string[] = [];

    await capturePage({
      url: `${server.url}/w-descriptors.html`,
      profiles: [canonical, desktop],
      launch: recording(order),
    });

    expect(order).toEqual(['detach', 'close', 'detach', 'close']);
  }, 60_000);

  it('detaches the CDP session when the page fails to load', async () => {
    const order: string[] = [];

    await expect(
      capturePage({
        url: 'http://127.0.0.1:1/nothing-listens-here',
        profiles: [canonical],
        launch: recording(order),
      }),
    ).rejects.toThrow();

    expect(order).toEqual(['detach', 'close']);
  });

  it('closes the browser when the page fails to load', async () => {
    let opened: Browser | undefined;
    const launch = async (): Promise<Browser> => {
      opened = await chromium.launch();
      return opened;
    };

    await expect(
      capturePage({
        url: 'http://127.0.0.1:1/nothing-listens-here',
        profiles: [canonical],
        launch,
      }),
    ).rejects.toThrow();

    expect(opened).toBeDefined();
    expect(opened?.isConnected()).toBe(false);
  });

  it('closes the browser when a later profile fails, not only the first', async () => {
    let opened: Browser | undefined;
    const launch = async (): Promise<Browser> => {
      opened = await chromium.launch();
      return opened;
    };
    // Chromium refuses a negative device scale factor, and it refuses it when
    // the page opens — after the context exists and has to be closed again.
    const impossible: DeviceProfile = { ...canonical, id: 'impossible', dpr: -1 };

    await expect(
      capturePage({
        url: `${server.url}/w-descriptors.html`,
        profiles: [desktop, impossible],
        launch,
      }),
    ).rejects.toThrow();

    expect(opened?.isConnected()).toBe(false);
  }, 60_000);

  it('names the missing browser rather than crashing cryptically', async () => {
    const launch = (): Promise<Browser> =>
      Promise.reject(
        new Error("browserType.launch: Executable doesn't exist at /nowhere/headless_shell"),
      );

    await expect(
      capturePage({ url: `${server.url}/w-descriptors.html`, profiles: [canonical], launch }),
    ).rejects.toThrow(/npx playwright install chromium/);
  });
});
