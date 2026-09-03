import type { Capture, CapturedImage, DeviceProfile, DeviceRun } from '@imgwhy/core';
import { parseSrcset } from '@imgwhy/core';
import { type Browser, type CDPSession, chromium } from 'playwright';
import { alignImageIds } from './align.js';
import { type RawImage, collectImages } from './collect.js';
import { type TransferLog, recordTransfers } from './transfers.js';

export type CaptureOptions = {
  url: string;
  /** Rendered in order, one browser context each. */
  profiles: DeviceProfile[];
  /**
   * Test seam: how the browser starts. A test hands back a browser it holds,
   * so it can prove the browser closes on every exit path.
   */
  launch?: () => Promise<Browser>;
};

/**
 * Render a page as every profile and record what each image resolved to.
 *
 * One browser, one context per profile. The browser and every context close on
 * every exit path, including a profile that fails after the others rendered.
 */
export async function capturePage({
  url,
  profiles,
  launch = () => chromium.launch(),
}: CaptureOptions): Promise<Capture> {
  const browser = await startBrowser(launch);
  try {
    const runs: DeviceRun[] = [];
    // Every profile lands on the same page, so the last one that got there
    // names it. It differs from the requested URL after a redirect.
    let landedOn = url;

    for (const profile of profiles) {
      const context = await browser.newContext({
        viewport: profile.viewport,
        deviceScaleFactor: profile.dpr,
      });
      try {
        const page = await context.newPage();
        // One session per page, opened before anything navigates: it carries
        // both the instruction that empties the cache and the record of what
        // every response cost, and neither reaches a request already sent.
        const session = await context.newCDPSession(page);
        try {
          await session.send('Network.enable');
          await disableCache(session);
          const transfers = recordTransfers(session);
          await page.goto(url, { waitUntil: 'load' });
          const raw = await page.evaluate(collectImages);
          landedOn = page.url();
          runs.push({
            deviceId: profile.id,
            images: raw.map((image) => toCapturedImage(image, transfers)),
          });
        } finally {
          // Detached here rather than left to the context, so it goes on every
          // exit path — including a page that never loaded, which reaches this
          // with the session still attached.
          await session.detach();
        }
      } finally {
        await context.close();
      }
    }

    return {
      // The URL the page ended on. A redirect makes it differ from the one
      // that was requested, and it is the base every relative candidate
      // resolves against, so the requested URL would misplace them all.
      url: landedOn,
      capturedAt: new Date().toISOString(),
      devices: profiles,
      // Assigned across the whole capture, because an id that holds only
      // inside one run cannot align the runs against each other.
      runs: alignImageIds(runs),
    };
  } finally {
    await browser.close();
  }
}

const toCapturedImage = (image: RawImage, transfers: TransferLog): CapturedImage => ({
  // The DOM path stands in until `alignImageIds` has seen every run. Only then
  // is it known whether the path held.
  id: image.selector,
  selector: image.selector,
  candidates: parseSrcset(image.srcset),
  sizes: image.sizes,
  sizesSource: image.sizesSource,
  renderedWidth: image.renderedWidth,
  currentSrc: image.currentSrc,
  naturalWidth: image.naturalWidth,
  // The response `currentSrc` names, at the size the protocol reported for it.
  // Null where nothing was recorded: unknown is reported as unknown, and never
  // guessed at from the pixels the image turned out to have.
  transferBytes: transfers.bytesFor(image.currentSrc),
  loading: image.loading,
});

/**
 * Take the HTTP cache out of the picture for one page.
 *
 * A held copy is the reason `currentSrc` stops being evidence: a browser that
 * already has a larger variant reuses it and selection never runs at all. A
 * fresh context starts with an empty cache, so it cannot inherit a copy from
 * the profile before it. This closes the rest: nothing on disk from an earlier
 * `imgwhy` run answers either, and the server sees every request the render
 * makes rather than only the ones the cache missed.
 *
 * Playwright exposes no switch for it, so the DevTools Protocol does it — the
 * same instruction the DevTools "Disable cache" checkbox sends, which is also
 * why every request goes out carrying `Cache-Control: no-cache`.
 *
 * It does not reach Blink's per-render memory cache: two elements asking for
 * one URL in the same document are still one request. That is the browser
 * behaviour under study, not a cache to defeat — and it is why one recorded
 * response can be what two images each weigh.
 */
async function disableCache(session: CDPSession): Promise<void> {
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
}

async function startBrowser(launch: () => Promise<Browser>): Promise<Browser> {
  try {
    return await launch();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes("Executable doesn't exist")) {
      throw new Error(
        'Playwright has no Chromium to run. Install it with: npx playwright install chromium',
        { cause },
      );
    }
    throw cause;
  }
}
