import { describe, expect, it } from 'vitest';
import { waitForQuietNetwork } from '../src/settle.js';

/**
 * The wait, read against a log that says what a test tells it to.
 *
 * No browser here on purpose. What this file is about is the arithmetic of two
 * durations — how long the list has read empty, and how long the whole wait has
 * had — and a real render decides both of those for itself. `capture.test.ts`
 * is where the wait is read against a page.
 */

/** A log that reports `urls` until `clearAfter` ms have passed, then nothing. */
const clearing = (urls: string[], clearAfter: number): (() => string[]) => {
  const from = Date.now();
  return () => (Date.now() - from < clearAfter ? urls : []);
};

const A = 'http://127.0.0.1:1/a.png';
const B = 'http://127.0.0.1:1/b.png';

describe('waitForQuietNetwork', () => {
  it('returns once the log has read empty for the whole quiet window', async () => {
    const from = Date.now();

    await waitForQuietNetwork(clearing([A], 100), 5_000);

    // The hundred milliseconds the request took, and then the quarter second
    // of quiet that says it was the last one. Returning at the hundred would
    // be reading the page on one empty poll.
    expect(Date.now() - from).toBeGreaterThanOrEqual(100 + 250);
    expect(Date.now() - from).toBeLessThan(2_000);
  });

  it('names every URL still outstanding when the bound expires', async () => {
    await expect(waitForQuietNetwork(() => [A, B], 300)).rejects.toThrow(
      `Still waiting on: ${A}, ${B}`,
    );
  });

  it('refuses a quiet stretch it ran out of time to finish watching', async () => {
    // The last request clears with less than a quiet window left, so nothing
    // here ever watched the network stay quiet. Returning at the bound would
    // hand back a reading taken inside the very window the wait exists to sit
    // out — and it would do it silently, on any bound, not only a short one.
    const failing = waitForQuietNetwork(clearing([A], 200), 300);

    await expect(failing).rejects.toThrow(/stay quiet/);
    // And it says which failure it was: there is nothing outstanding to name,
    // so a message naming URLs would be naming none.
    await expect(failing).rejects.not.toThrow(/Still waiting on/);
  });
});
