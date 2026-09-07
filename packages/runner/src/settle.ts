/**
 * Making the page finish loading before anything reads it.
 *
 * A browser fetches an image when it is about to be seen, not when the
 * document loads, so `load` is not the moment a page is done. On a page that
 * lazily loads — which is most of them — the images below the fold have asked
 * for nothing by then, and a run that reads the document there finds elements
 * whose `currentSrc` is empty and whose transfer nobody recorded. That reads
 * as "this image loaded no file", which is a claim about the page rather than
 * an admission about the reading, and it is wrong about exactly the images
 * that carry a page's weight.
 *
 * Two halves. The scroll pass makes the browser want the files; the wait makes
 * the run hold still until it has them.
 */

/**
 * How long `pending()` has to stay empty before the network counts as quiet.
 *
 * Empty right now is not the same as nothing in flight. A request the scroll
 * provoked reaches Chromium's own network stack before it reaches a listener
 * here, so there is a window in which the page is fetching and this end knows
 * nothing about it — and a run that read the page inside that window would
 * miss the very load the scroll was for. Waiting out a quiet stretch is what
 * closes it: an empty list that stays empty is the observation, one empty
 * reading is not.
 */
const QUIET_WINDOW = 250;

/**
 * How often the wait looks. It decides nothing but how sharply the two
 * durations it measures are read: the quiet window above, and the bound the
 * caller set.
 */
const LOOK_EVERY = 25;

/**
 * Scroll the whole page and come back to where the reader left it.
 *
 * Runs inside the page, and keeps the rule `collectImages` does: Playwright
 * sends this to the browser as source, so it may reference nothing outside
 * itself.
 *
 * Stepping and waiting, rather than one jump to the bottom. Both of the things
 * this is trying to provoke — Chromium's own lazy-load heuristic and any
 * `IntersectionObserver` the page installed — are driven off the browser's
 * frame timing, so a synchronous loop that ends where it started passes
 * through every position without the browser ever painting one, and triggers
 * nothing at all.
 *
 * Coming back matters because the position is part of what the page is. A
 * reader may be looking at it, and a Capture taken of a page is not a licence
 * to leave it somewhere else.
 */
export async function scrollThroughPage(): Promise<void> {
  const startX = window.scrollX;
  const startY = window.scrollY;

  // A painted frame, then a moment for what the frame started. The frame is
  // what makes the browser notice the new position; the delay after it is for
  // an observer whose callback runs on the next task rather than in the frame.
  // Fifty milliseconds because it is a pause and not a wait — nothing is being
  // waited for here, the settle that follows does that.
  const step = (): Promise<void> =>
    new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(() => resolve(), 50));
    });

  // A page that appends another screenful every time one is read never stops
  // advancing, and a run with no cap would scroll it until someone killed the
  // process. This is a bound, not a budget: at a screen a step it is far more
  // page than anything worth measuring, so a real page ends the loop by
  // reaching its own bottom long before this does.
  const MOST_STEPS = 200;

  let previous = -1;
  for (let taken = 0; taken < MOST_STEPS && window.scrollY !== previous; taken += 1) {
    previous = window.scrollY;
    window.scrollTo(startX, window.scrollY + window.innerHeight);
    await step();
  }

  window.scrollTo(startX, startY);
  await step();
}

/**
 * Wait until nothing is in flight, and say what was if it never happens.
 *
 * Giving up is a failure and not a shrug. The images this waits for are the
 * ones the run exists to measure, so a run that fell through here would report
 * them as images that chose no file and cost nothing — a wrong answer wearing
 * the same clothes as a right one. Throwing names the URLs instead, and
 * `packages/cli/src/message.ts` puts that sentence on the command's stderr.
 */
export async function waitForQuietNetwork(
  pending: () => string[],
  timeout: number,
): Promise<void> {
  const giveUpAt = Date.now() + timeout;
  let quietSince: number | null = null;

  for (;;) {
    const outstanding = pending();
    if (outstanding.length === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= QUIET_WINDOW) return;
    } else {
      quietSince = null;
    }

    if (Date.now() >= giveUpAt) {
      // Quiet, and out of time to confirm it. Only a bound shorter than the
      // quiet window arrives here, and there is nothing outstanding to name,
      // so a failure would be a sentence about no URLs at all.
      if (outstanding.length === 0) return;
      throw new Error(
        `The page was still loading after ${timeout}ms, so nothing here can say what it ` +
          `weighs. Still waiting on: ${outstanding.join(', ')}`,
      );
    }

    await new Promise<void>((resolve) => setTimeout(() => resolve(), LOOK_EVERY));
  }
}
