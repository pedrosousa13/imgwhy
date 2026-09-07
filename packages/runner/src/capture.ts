import type { Capture, CapturedImage, DeviceProfile, DeviceRun } from '@imgwhy/core';
import { CAPTURE_SCHEMA, parseSrcset } from '@imgwhy/core';
import { type Browser, type CDPSession, type Page, chromium } from 'playwright';
import { alignImageIds } from './align.js';
import { type RawImage, collectImages, countBackgroundImages } from './collect.js';
import { scrollThroughPage, waitForQuietNetwork } from './settle.js';
import { type TransferLog, recordTransfers } from './transfers.js';

/**
 * How long one profile may spend waiting for its page to go quiet.
 *
 * Whole seconds, because it is a bound on a person's patience rather than a
 * measurement of anything. Ten of them is far longer than a page that is going
 * to settle takes, and short enough that a page which never will says so while
 * whoever ran the command is still watching.
 */
const SETTLE_TIMEOUT = 10_000;

export type CaptureOptions = {
  url: string;
  /** Rendered in order, one browser context each. */
  profiles: DeviceProfile[];
  /**
   * The release of imgwhy the Capture records as having written it.
   *
   * Required, and supplied by the caller, because this package is a library
   * and its own release is not a thing it can read: the version a user has is
   * the command's, and `packages/cli/src/version.ts` reads it there. Required
   * rather than defaulted, because every default that could be written here —
   * an empty string, a `0.0.0`, the word unknown — is a number that would go
   * into a file and be read back as a release later.
   *
   * This is where that requirement is enforced, so it is where the argument is
   * written out. `docs/adr/0002-capture-version-two-fields.md` records it too,
   * with the shape it was chosen over: a runner reading its own
   * `package.json`, which would record `@imgwhy/runner`'s version — a number
   * nobody installs.
   */
  producedBy: string;
  /**
   * Test seam: how the browser starts. A test hands back a browser it holds,
   * so it can prove the browser closes on every exit path — and one that hands
   * back an instrumented browser can watch what a context and its session do
   * in between, which nothing outside the run can otherwise observe.
   */
  launch?: () => Promise<Browser>;
  /**
   * How long one profile waits for its page's network to go quiet, in
   * milliseconds.
   *
   * An option rather than a constant for two reasons that pull the same way. A
   * page that never settles must not hold a run open indefinitely, and what
   * counts as too long is a property of the page and the network rather than
   * of this code — a slow origin needs more than the default and a local
   * fixture needs far less. The tests are the second reason: a run that is
   * meant to give up should cost the suite a couple of seconds rather than the
   * full default.
   *
   * There is a floor, and it is 250ms: the bound has to be longer than the
   * quiet window a page is measured against, because a bound no longer than
   * that window leaves no time in which the window could ever complete. That
   * window is `QUIET_WINDOW` in `settle.ts`, which is where the number is
   * decided and where the refusal lives, so the two cannot come apart; it is
   * repeated here because a caller reading this line should not have to open
   * that file to learn what they may not pass.
   *
   * A bound at or under it fails the run rather than being clamped up to
   * something workable, and it fails partway through: the wait is what refuses
   * it, and the wait comes after the navigation and the scroll pass, so a bound
   * this small still costs a page load per profile before anything says so.
   * That is the only figure treated this way — nothing else here is checked,
   * because nothing else here has an answer that is wrong for every page. The
   * floor is not a performance figure either: anything in the seconds is well
   * clear of it, and the suite's shortest is two of them.
   *
   * It bounds the wait and not the scroll pass that comes before it, and the
   * two are worth adding up. The scroll pass carries its own bound —
   * `MOST_STEPS` steps of about 66ms in `settle.ts`, so around thirteen
   * seconds, and only ever that on a page that keeps growing as it is read —
   * which is spent before this one starts counting. A page that settles takes
   * a step per screenful and none of the rest.
   */
  settleTimeout?: number;
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
  producedBy,
  launch = () => chromium.launch(),
  settleTimeout = SETTLE_TIMEOUT,
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
        // Playwright accepts downloads unless it is told not to, and a page
        // under measurement is not a page anyone here trusts. A
        // `Content-Disposition: attachment` response, or a script that clicks
        // an `<a download>`, writes bytes to the disk of whoever ran imgwhy
        // for as long as the context is open — once per profile, since each
        // one renders the page again. imgwhy reads images out of a render and
        // downloads nothing, so the capability is off.
        acceptDownloads: false,
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
          // `load` is not the end of a page's loading; `settle.ts` says what
          // reading it there would report. A page that never goes quiet throws
          // out of this block, and the existing catch below takes the document
          // away and detaches the session on the way past. The listeners that
          // make the wait possible went on above, before the navigation, which
          // is what makes a request that starts during the scroll visible.
          await page.evaluate(scrollThroughPage);
          await waitForQuietNetwork(transfers.pending, settleTimeout);
          const raw = await page.evaluate(collectImages);
          // A second call rather than one that answers both, so each function
          // sent into the page stays one that references nothing outside
          // itself. The page is not navigating between them, so the two read
          // the same render.
          const backgroundImageCount = await page.evaluate(countBackgroundImages);
          landedOn = page.url();
          runs.push({
            deviceId: profile.id,
            images: raw.map((image) => toCapturedImage(image, transfers)),
            backgroundImageCount,
          });
        } catch (failure) {
          // Discarding is attempted here too, for the same reason as below: a
          // run that failed after the page loaded still leaves a page that can
          // fetch. Its failure is dropped, like the detach's, because it can
          // reject on its own — a crashed target cannot be navigated either.
          await discardDocument(page).catch(() => {});
          // Detaching is attempted here too — a page that never loaded reaches
          // this with the session still attached — but its own failure is
          // dropped, because `detach()` can reject by itself. A crashed target
          // is gone, and asking a gone target to detach fails. In a `finally`
          // that rejection replaces the failure that brought the run here, so
          // the page that would not load goes unreported and the caller is
          // told about a session instead.
          await session.detach().catch(() => {});
          throw failure;
        }
        // Held rather than thrown, because the detach has to run whatever the
        // discard did. Throwing here would skip it and leave the session
        // attached until the context closed it, which is the exit this block
        // is shaped to avoid. Boxed rather than compared against a sentinel,
        // so a rejection carrying `undefined` still reads as one.
        const discard = await discardDocument(page).then(
          () => undefined,
          (failure: unknown) => ({ failure }),
        );
        if (discard) {
          // Both halves can fail here, and the discard failed first. The rule
          // is the one the block above follows: the failure that came first is
          // the one reported, so the detach is still attempted and its own
          // rejection is dropped rather than allowed to replace this one.
          await session.detach().catch(() => {});
          throw discard.failure;
        }
        // The discard succeeded, so a detach that fails is the only failure
        // there is, and it is reported. Outside a `finally` on purpose, which
        // is why the block above has to stay straight-line: an early exit from
        // it would leave the session attached until the context closed it.
        await session.detach();
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
      // The shape is core's constant, so the writer and every reader of a
      // Capture key on one number. The release is the caller's, because this
      // package cannot read its own.
      version: { schema: CAPTURE_SCHEMA, producedBy },
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
  declaresWidth: image.declaresWidth,
  currentSrc: image.currentSrc,
  naturalWidth: image.naturalWidth,
  // The response `currentSrc` names, at the size the protocol reported for it.
  // Null where nothing was recorded: unknown is reported as unknown, and never
  // guessed at from the pixels the image turned out to have.
  transferBytes: transfers.bytesFor(image.currentSrc),
  loading: image.loading,
});

/**
 * Replace the page that was measured with a blank one, so nothing of it is
 * left to make a request.
 *
 * Everything the session carries is the session's: the instruction that
 * disables the cache and the listeners that record what each response cost
 * both end when it detaches. The page does not — it lives until its context
 * closes — so between the detach and the close there is a document that can
 * still fetch, and a fetch started there arrives at the server with no
 * `Cache-Control` header and reaches no listener. Both halves of what the
 * session was for are gone, and the request is neither refused a cached copy
 * nor counted.
 *
 * Discarding the document ends that window rather than narrowing it. A
 * navigation to `about:blank` destroys the old document and its pending loads,
 * and resolves once the blank one has loaded, so by the time this returns the
 * page that was measured cannot ask for anything.
 *
 * `about:blank` rather than `page.close()`, because closing the page destroys
 * the target the session is attached to. Measured against Playwright 1.62,
 * detaching after the page closes rejects with "Target page, context or
 * browser has been closed", which would make the detach fail on every run, and
 * a failure that always happens reports nothing. That is what was observed
 * rather than something the suite pins, so a version that changed it would go
 * unnoticed here.
 *
 * What it covers is the document. A service worker the page registered belongs
 * to the context instead, so this does not stop one, and a fetch it makes
 * before the context closes still goes out under no instruction and reaches no
 * listener. Closing the context is what bounds that.
 */
async function discardDocument(page: Page): Promise<void> {
  // `about:blank` asks the network for nothing, so the only thing this waits
  // on is the renderer answering. Playwright's default would spend thirty
  // seconds per profile on one that is not answering — turning a capture that
  // already succeeded into a throw, long after the measurement was taken — and
  // a renderer that is answering needs none of them.
  await page.goto('about:blank', { timeout: 5_000 });
}

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
 * why every request the page's document makes goes out carrying
 * `Cache-Control: no-cache`.
 *
 * Every one of them, and not only the ones made while the page is being read.
 * The instruction belongs to the session, so it is withdrawn the moment the
 * session detaches; `discardDocument` takes the document away first, which is
 * what makes the claim hold for the whole of the document's life rather than
 * up to the detach.
 *
 * The document is the bound. A service worker the page registered outlives it,
 * and `discardDocument` says why nothing here covers that.
 *
 * It does not reach Blink's per-render memory cache. `recordTransfers` says
 * what that leaves, under "What the mapping cannot do".
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
