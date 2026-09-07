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
 * This is the argument every other comment about the scroll pass points at.
 *
 * Two halves. `scrollThroughPage` makes the browser want the files;
 * `waitForQuietNetwork` holds the run still until it has seen them arrive, or
 * says which ones it never did.
 *
 * ## What this cannot do
 *
 * **Read a page whose network never goes quiet.** Two shapes reach that, and
 * they do not end the same way.
 *
 * A page can hold one request open forever: a server-sent-events stream, a
 * hanging poll and a streaming video request all stay outstanding for as long
 * as the page lives, because nothing ever reports them finished or failed. The
 * wait always reaches its bound there, so the whole capture fails, one profile
 * at a time. That is a page this tool used to capture — badly, reporting every
 * lazy image as absent, but it produced a Capture — and now does not capture at
 * all. Telling a stream apart from a page still loading needs a request's type,
 * which is a different reading from the one this file takes; failing loudly is
 * the interim answer.
 *
 * Or it can keep starting new ones — media segments, a poll on a short timer, a
 * beacon loop — and what happens then depends on how long each request lasts
 * rather than on how often they start. `QUIET_WINDOW` below says why: the wait
 * reads samples, not the intervals between them. Requests long enough that most
 * polls land inside one leave no run of empty readings, so the wait never gets
 * its stretch and gives up at the bound, whatever the bound is. Requests short
 * enough to fall between polls are mostly not seen at all, so a whole window of
 * empty readings accumulates over a page that is still fetching, and the wait
 * returns a stretch of quiet that was never real. That second outcome is the
 * one to be uneasy about: it is not a loud failure, it is the early reading
 * this file exists to refuse, taken silently.
 *
 * **Reach anything above where the page started.** The pass descends and
 * returns, so a page that loads at a non-zero position — a fragment target, or
 * one that scrolls itself — keeps whatever is above that position out of view
 * throughout, and its lazy images stay untriggered.
 *
 * That is a choice between two things the brief asks for, and it is worth being
 * plain about which one this is. The brief says "return to the top" three
 * times; it also says, in bold, to leave the page as found, "because the read
 * that follows has to describe the same page a reader would see", and its
 * acceptance criterion is that the page is left at the scroll position it
 * started from. This follows the second. The two only differ on a page that
 * opens somewhere other than the top, and there the reader-sees rule governs: a
 * reader who lands on `page.html#section` sees that page, not its top, so a run
 * that ended at the top would be describing a page nobody was looking at. What
 * it costs is the paragraph above — the images above the start stay untriggered
 * — and those are the ones already behind that reader.
 */

/**
 * How long `pending()` has to stay empty before the network counts as quiet.
 *
 * Empty right now is not the same as nothing in flight. A request the scroll
 * provoked reaches Chromium's own network stack before it reaches a listener
 * here, so there is a window in which the page is fetching and this end knows
 * nothing about it — and a run that read the page inside that window would
 * miss the very load the scroll was for. Waiting out a quiet stretch is what
 * narrows it: a list that reads empty every time for a quarter of a second is
 * a better account than one that read empty once.
 *
 * Narrows rather than closes. What the wait sees is samples, not the interval
 * between them, so a request that starts and finishes inside one gap is never
 * seen as pending at all — and if it starts another, that one can slip out the
 * same way. Every one of them is still recorded and still counted; what can
 * escape is the waiting, not the measurement.
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
 *
 * The module docblock says what the pass cannot reach.
 */
export async function scrollThroughPage(): Promise<void> {
  const startX = window.scrollX;
  const startY = window.scrollY;

  /**
   * Put the page here, now, whatever the page would rather do about it.
   *
   * The two-argument `scrollTo(x, y)` resolves its behaviour against the
   * scrolling box's computed `scroll-behavior`, so on a page carrying
   * `html { scroll-behavior: smooth }` — which is a common line to write —
   * every one of these animates. Both halves of the pass break there: a step
   * re-aims from a position still in motion, so it advances a fraction of a
   * screen and a tall page runs out of steps before it runs out of page, and
   * the restore at the end leaves the page mid-animation somewhere it was
   * never asked to be. `instant` is the option form saying so explicitly.
   */
  const jumpTo = (top: number): void => {
    window.scrollTo({ left: startX, top, behavior: 'instant' });
  };

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
  // reaching its own bottom long before this does. What the bound costs where
  // it is reached is written out on `CaptureOptions.settleTimeout`, which does
  // not cover it.
  const MOST_STEPS = 200;

  let previous = -1;
  for (let taken = 0; taken < MOST_STEPS && window.scrollY !== previous; taken += 1) {
    previous = window.scrollY;
    jumpTo(window.scrollY + window.innerHeight);
    await step();
  }

  jumpTo(startY);
  await step();
}

/**
 * Refuse a settle bound no page could ever satisfy.
 *
 * `waitForQuietNetwork` cannot accumulate a window of quiet inside a bound no
 * longer than the window, so every run under one fails — and the sentence it
 * fails with is about the page, when the fault is in the bound. Saying so
 * outright is the difference between a caller learning what they asked for and
 * a caller reading a complaint about every page they point at.
 *
 * One function rather than a rule written twice, and asked in two places on
 * purpose. `capturePage` asks it before it opens a browser, so a bound this
 * small costs nothing; `waitForQuietNetwork` asks it too, because the rule is
 * that function's and a caller reaching for it directly is owed the same
 * answer. Both read `QUIET_WINDOW` from here, so neither can drift from it.
 *
 * `<=` and not `<`: at exactly the window the loop's two checks race inside one
 * iteration, so whether it succeeded would come down to scheduling.
 */
export function refuseUnreachableBound(timeout: number): void {
  if (timeout <= QUIET_WINDOW) {
    throw new Error(
      `A settle bound of ${timeout}ms is no longer than the ${QUIET_WINDOW}ms of quiet that ` +
        `says a page has finished loading, so no page could ever satisfy it.`,
    );
  }
}

/**
 * Wait until nothing has been in flight for a while, or say what still is.
 *
 * Giving up is a failure and not a shrug, for the reason the module docblock
 * gives: falling through would put those images in the Capture as images that
 * chose no file. Throwing names them instead, and the command puts that
 * sentence on its stderr: `run.ts` catches what `capturePage` threw and hands
 * it to `fail(messageOf(error))`, whose `stderr` `bin.ts` writes out.
 *
 * `timeout` bounds confirming that the page settled, which is not the same as
 * bounding the page. Reaching it with nothing outstanding is its own failure
 * and reads as one — but the message stops at what was observed. What this end
 * knows there is that the list read empty every time it looked since the last
 * request it saw, and that the run of empty readings was short of a whole
 * window. It does not know the page finished: a page starting a new short
 * request every hundred milliseconds is empty between any two of them, and a
 * bound that expires in one of those gaps has watched a gap, not an ending.
 *
 * A bound this cannot work with is `refuseUnreachableBound`'s to say so about,
 * and it is asked here as well as at the top of a run: this is the function the
 * rule belongs to, and a direct caller gets the same answer as one that came
 * through `capturePage`.
 */
export async function waitForQuietNetwork(
  pending: () => string[],
  timeout: number,
): Promise<void> {
  refuseUnreachableBound(timeout);

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
      throw new Error(
        outstanding.length === 0
          ? `Nothing was outstanding when the ${timeout}ms bound expired, but the page had ` +
            `not been quiet for the ${QUIET_WINDOW}ms that says it has finished — so this ` +
            `is as likely a gap between two of its requests as an ending.`
          : `The page was still loading after ${timeout}ms, so nothing here can say what it ` +
            `weighs. Still waiting on: ${outstanding.join(', ')}`,
      );
    }

    await new Promise<void>((resolve) => setTimeout(() => resolve(), LOOK_EVERY));
  }
}
