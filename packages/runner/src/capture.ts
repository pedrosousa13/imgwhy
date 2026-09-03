import type { Capture, CapturedImage, DeviceProfile } from '@imgwhy/core';
import { parseSrcset } from '@imgwhy/core';
import { type Browser, chromium } from 'playwright';
import { collectImages } from './collect.js';

export type CaptureOptions = {
  url: string;
  profile: DeviceProfile;
  /**
   * Test seam: how the browser starts. A test hands back a browser it holds,
   * so it can prove the browser closes on every exit path.
   */
  launch?: () => Promise<Browser>;
};

/**
 * Render a page as one device and record what each image resolved to.
 *
 * The browser and its context close on every exit path, including a page that
 * never loads.
 */
export async function capturePage({
  url,
  profile,
  launch = () => chromium.launch(),
}: CaptureOptions): Promise<Capture> {
  const browser = await startBrowser(launch);
  try {
    // A fresh context carries an empty cache, so no earlier download can stand
    // in for a selection. Issue #3 disables the HTTP cache outright.
    const context = await browser.newContext({
      viewport: profile.viewport,
      deviceScaleFactor: profile.dpr,
    });
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load' });
      const raw = await page.evaluate(collectImages);

      const images: CapturedImage[] = raw.map((image) => ({
        id: image.id,
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
      }));

      return {
        // The URL the page ended on. A redirect makes it differ from the one
        // that was requested, and it is the base every relative candidate
        // resolves against, so the requested URL would misplace them all.
        url: page.url(),
        capturedAt: new Date().toISOString(),
        devices: [profile],
        runs: [{ deviceId: profile.id, images }],
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
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
