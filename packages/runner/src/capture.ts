import type { Capture, CapturedImage, DeviceProfile, DeviceRun } from '@imgwhy/core';
import { parseSrcset } from '@imgwhy/core';
import { type Browser, type BrowserContext, type Page, chromium } from 'playwright';
import { alignImageIds } from './align.js';
import { type RawImage, collectImages } from './collect.js';

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
        await disableCache(context, page);
        await page.goto(url, { waitUntil: 'load' });
        const raw = await page.evaluate(collectImages);
        landedOn = page.url();
        runs.push({ deviceId: profile.id, images: raw.map(toCapturedImage) });
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

const toCapturedImage = (image: RawImage): CapturedImage => ({
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
  // Real transfer bytes need the DevTools Protocol, which issue #3 wires.
  // Unknown is reported as unknown, never guessed.
  transferBytes: null,
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
 * behaviour under study, not a cache to defeat.
 */
async function disableCache(context: BrowserContext, page: Page): Promise<void> {
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
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
