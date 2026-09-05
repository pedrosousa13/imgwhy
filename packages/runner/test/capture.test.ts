import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceProfile } from '@imgwhy/core';
import { type Browser, type Download, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PROFILES, capturePage } from '../src/index.js';
import { type FixtureServer, startFixtureServer } from '../../../test/fixture-server.js';
import { encodePng } from '../../../test/png.js';

/** The case from the design: 640 CSS px at DPR 1.5 needs 960, so 1080w wins. */
const canonical: DeviceProfile = {
  id: 'canonical',
  name: 'Canonical',
  viewport: { width: 640, height: 800 },
  dpr: 1.5,
};

/** The widest of the default profiles, which is the last of them. */
const desktop = DEFAULT_PROFILES[4];
/** The narrowest, at 375, and the one in the middle, at 820. */
const phone = DEFAULT_PROFILES[0];
const tablet = DEFAULT_PROFILES[3];

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
 *
 * `instead` stands in for what detaching does, so a test can have it fail the
 * way a crashed target's does. Detaching is still recorded when it fails: it
 * was attempted, which is what the order is there to show.
 */
function recording(order: string[], instead?: () => Promise<void>): () => Promise<Browser> {
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
          await (instead ? instead() : detach());
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

/**
 * What detaching a crashed target's session does: a gone target cannot be
 * asked to let go of anything, and Playwright says so.
 *
 * In a plain `finally` this rejection is the one that leaves `capturePage`,
 * and whatever brought the run there — a page that would not load — is never
 * reported at all.
 */
const crashed = (): Promise<void> =>
  Promise.reject(new Error('cdpSession.detach: Target page, context or browser has been closed'));

/**
 * A browser whose downloads land in a directory of the test's own, listed at
 * the last moment anything can still be in it.
 *
 * Playwright empties a context's downloads when the context closes, so a
 * listing taken after `capturePage` has returned is empty whatever the context
 * allowed, and would pass against a browser that saved every byte. The close
 * the runner performs is the only moment inside a run that a test can reach,
 * so the listing is taken there.
 */
function watchingDownloads(): {
  launch: () => Promise<Browser>;
  /** The downloads directory as it stood when the context closed. */
  files: string[];
  /** Every download the page announced, saved or refused. */
  announced: Download[];
} {
  const directory = mkdtempSync(join(tmpdir(), 'imgwhy-downloads-'));
  const files: string[] = [];
  const announced: Download[] = [];
  let arrived = (): void => {};
  const download = new Promise<void>((resolve) => {
    arrived = resolve;
  });

  const launch = async (): Promise<Browser> => {
    const browser = await chromium.launch({ downloadsPath: directory });
    const openContext = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const context = await openContext(options);
      const openPage = context.newPage.bind(context);
      const closeContext = context.close.bind(context);
      context.newPage = async () => {
        const page = await openPage();
        page.on('download', (each) => {
          announced.push(each);
          arrived();
        });
        return page;
      };
      context.close = async (options) => {
        // Chromium announces a download after the load event, so the run is
        // already past `goto` by the time one arrives. Waiting for it is what
        // makes the listing evidence: a directory read before the browser had
        // decided anything would be empty either way.
        await download;
        files.push(...readdirSync(directory));
        await closeContext(options);
      };
      return context;
    };
    return browser;
  };

  return { launch, files, announced };
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

  it('resolves a picture against the first source whose media matches', async () => {
    const capture = await capturePage({
      url: `${server.url}/picture-sources.html`,
      profiles: [desktop],
    });

    // Both conditions hold at 1440. Document order decides, so the first one
    // does: 50vw, and not the 75vw the second source asks for.
    const hero = capture.runs[0]?.images[0];
    expect(hero?.candidates.map((c) => c.raw)).toEqual(['1080w', '1920w']);
    expect(hero?.sizes).toBe('50vw');
    expect(hero?.sizesSource).toBe('source');
    // 720 css px at DPR 1 needs 720, so the browser took the 1080 file — which
    // is what the resolved source says it should have.
    expect(hero?.currentSrc).toBe(`${server.url}/img/1080.png`);
  });

  it('resolves a picture against a later source where the first does not match', async () => {
    const capture = await capturePage({
      url: `${server.url}/picture-sources.html`,
      profiles: [tablet],
    });

    const hero = capture.runs[0]?.images[0];
    expect(hero?.candidates.map((c) => c.raw)).toEqual(['640w', '1080w']);
    expect(hero?.sizes).toBe('75vw');
    expect(hero?.sizesSource).toBe('source');
  });

  it('falls through to the img where no source media matches', async () => {
    const capture = await capturePage({
      url: `${server.url}/picture-sources.html`,
      profiles: [phone],
    });

    // 375 matches neither condition, so the tag itself answers for both the
    // candidates and the `sizes`.
    const hero = capture.runs[0]?.images[0];
    expect(hero?.candidates.map((c) => c.raw)).toEqual(['640w', '1080w', '1920w']);
    expect(hero?.sizes).toBe('100vw');
    expect(hero?.sizesSource).toBe('img');
    expect(hero?.currentSrc).toBe(`${server.url}/img/1080.png`);
  });

  it('leaves the sizes null where the matching source wrote none, and says source', async () => {
    const capture = await capturePage({
      url: `${server.url}/picture-sources.html`,
      profiles: [desktop],
    });

    // The source wrote no `sizes`, so the 100vw default applied and the
    // `<img sizes="120px">` played no part. `sizesSource` says which element
    // answered; the null says it wrote nothing.
    const badge = capture.runs[0]?.images[1];
    expect(badge?.candidates.map((c) => c.raw)).toEqual(['200w', '300w']);
    expect(badge?.sizes).toBeNull();
    expect(badge?.sizesSource).toBe('source');
    // The measurement that settles it. 100vw of 1440 at DPR 1 needs 1440, so
    // the source's largest wins; the tag's 120px would have needed 120 and
    // taken the 200 file. The browser took the 300 one.
    expect(badge?.currentSrc).toBe(`${server.url}/img/300.png`);
  });

  it('reads the img sizes only where no source matched at all', async () => {
    const capture = await capturePage({
      url: `${server.url}/picture-sources.html`,
      profiles: [phone],
    });

    const badge = capture.runs[0]?.images[1];
    expect(badge?.candidates.map((c) => c.raw)).toEqual(['160w', '480w']);
    expect(badge?.sizes).toBe('120px');
    expect(badge?.sizesSource).toBe('img');
    // 120 css px at DPR 2 needs 240, so the larger of the tag's two wins.
    expect(badge?.currentSrc).toBe(`${server.url}/img/480.png`);
  });

  it('reads no source written after the img, because a browser stops at the tag', async () => {
    const capture = await capturePage({
      url: `${server.url}/source-after-img.html`,
      profiles: [desktop],
    });

    // The source's `media` matches at 1440 and it is still not consulted. A
    // browser walks the `<picture>`'s children in tree order and stops when it
    // reaches the `<img>`, so a source written after the tag is out of reach —
    // however easily a query for every source in the element finds it.
    const badge = capture.runs[0]?.images[0];
    expect(badge?.candidates.map((c) => c.raw)).toEqual(['160w', '480w']);
    expect(badge?.sizes).toBe('120px');
    expect(badge?.sizesSource).toBe('img');
    // The measurement that settles it. 120 css px at DPR 1 needs 120, so the
    // tag's smaller file wins; the source's 90vw of 1440 would have needed
    // 1296 and taken the 300 file. The browser took the 160 one.
    expect(badge?.currentSrc).toBe(`${server.url}/img/160.png`);
  });

  it('counts the elements a render painted a CSS background image on', async () => {
    const capture = await capturePage({
      url: `${server.url}/backgrounds.html`,
      profiles: [tablet, desktop],
    });

    // Two tiles on both, and the banner only where the viewport reaches the
    // width its media query asks for. A figure for the whole capture would be
    // a figure neither render produced, which is why this sits on the run.
    expect(capture.runs.map((run) => run.backgroundImageCount)).toEqual([2, 3]);
  }, 60_000);

  it('counts a painted file and not a painted gradient, which is no file at all', async () => {
    const capture = await capturePage({
      url: `${server.url}/backgrounds.html`,
      profiles: [tablet],
    });

    // The page paints four backgrounds at this width: two tiles, the banner's
    // empty rule, and a gradient. Only the two that name a file are counted.
    expect(capture.runs[0]?.backgroundImageCount).toBe(2);
  });

  it('counts nothing on a page whose CSS paints no file', async () => {
    const capture = await capturePage({
      url: `${server.url}/gallery.html`,
      profiles: [desktop],
    });

    expect(capture.runs[0]?.backgroundImageCount).toBe(0);
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
    // One request served both elements, for the reason `recordTransfers` gives
    // under "What the mapping cannot do". Both carry what that one response
    // cost, so adding the column up over a page counts it once per element.
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

  it('refuses the download a page starts, so no page can write to the disk', async () => {
    const watched = watchingDownloads();

    await capturePage({
      url: `${server.url}/attachment.html`,
      profiles: [canonical],
      launch: watched.launch,
    });

    // Chromium announced the download either way: the event fires whether the
    // context keeps the bytes or throws them away, so it says only that the
    // page really did ask. The directory is what separates the two. A context
    // on Playwright's defaults holds the file by the time the run closes it —
    // whole, or part-written under a `.crdownload` name — and this one holds
    // nothing, because the browser was told to refuse.
    expect(watched.announced.map((each) => each.suggestedFilename())).toEqual(['report.csv']);
    expect(watched.files).toEqual([]);
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

    // Named, not merely counted. A run that ends in some other error has not
    // reported the page that would not load, whatever it detached on the way.
    await expect(
      capturePage({
        url: 'http://127.0.0.1:1/nothing-listens-here',
        profiles: [canonical],
        launch: recording(order),
      }),
    ).rejects.toThrow(/net::ERR_UNSAFE_PORT/);

    expect(order).toEqual(['detach', 'close']);
  });

  it('reports the failure that came first when detaching fails on top of it', async () => {
    const order: string[] = [];

    const failing = capturePage({
      url: 'http://127.0.0.1:1/nothing-listens-here',
      profiles: [canonical],
      launch: recording(order, crashed),
    });

    await expect(failing).rejects.toThrow(/net::ERR_UNSAFE_PORT/);
    await expect(failing).rejects.not.toThrow(/cdpSession\.detach/);
    // Detaching was still attempted, and the context still closed after it.
    expect(order).toEqual(['detach', 'close']);
  });

  it('reports a detach that fails when nothing else did, rather than swallowing it', async () => {
    const order: string[] = [];

    // Nothing else went wrong on this run, so the detach is the only failure
    // there is to report. Preferring the first failure is not the same as
    // having none.
    await expect(
      capturePage({
        url: `${server.url}/w-descriptors.html`,
        profiles: [canonical],
        launch: recording(order, crashed),
      }),
    ).rejects.toThrow(/cdpSession\.detach/);

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
