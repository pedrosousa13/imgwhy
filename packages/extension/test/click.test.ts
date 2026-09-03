import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { panelOf } from '../src/explain.js';
import { renderPanel } from '../src/panel.js';
import type { Reading } from '../src/read.js';
import { readPage } from '../src/read.js';
import type { El } from './dom.js';
import { globals, page } from './dom.js';
import { image, reading } from './reading.js';

/** What the worker hands `executeScript`, which is the whole of what a click does. */
type Injection = {
  target: { tabId: number };
  func: (...args: never[]) => unknown;
  args?: unknown[];
};

/** Every handler the worker registered, and every injection it asked for. */
const registered: ((tab: { id?: number }) => void)[] = [];
const injected: Injection[] = [];

/**
 * What the page returns from the first injection of a click.
 *
 * A reading is the opening click and null is the closing one, which is the
 * whole of the toggle: the state is the page, so the answer to "is a panel
 * open" arrives with the answer to "what is on this page".
 */
let reads: Reading | null = reading();

/**
 * What the browser refuses this injection with, or nothing.
 *
 * Chrome rejects `executeScript` for a page it forbids injection into — a
 * `chrome://` page, the web store, a PDF viewer — and that rejection is the
 * only thing the worker ever has to handle.
 */
let refuse: Error | null = null;

/**
 * The browser, as much of one as the worker touches: the two calls
 * `src/chrome.d.ts` declares and nothing else.
 *
 * It is installed as a global before the worker is imported, because importing
 * the worker *is* running it — the registration is a top-level statement, and
 * has to be, so there is no seam to inject a fake through and no reason to
 * invent one. What the worker does at load is exactly what this observes.
 *
 * The result is shaped the way Chrome shapes one: an array with an entry per
 * frame, each carrying what the injected function returned. Only the first
 * injection of a click returns anything the worker reads, and it returns
 * whatever `reads` holds.
 */
(globalThis as { chrome?: unknown }).chrome = {
  action: {
    onClicked: {
      addListener: (handler: (tab: { id?: number }) => void): void => {
        registered.push(handler);
      },
    },
  },
  scripting: {
    executeScript: (injection: Injection): Promise<{ result: unknown }[]> => {
      injected.push(injection);
      if (refuse !== null) return Promise.reject(refuse);
      return Promise.resolve([{ result: injection.args === undefined ? reads : 'opened' }]);
    },
  },
};

// A dynamic import rather than a static one, because a static import hoists
// above the assignment above and the worker would run against no browser at
// all.
await import('../src/background.js');

/**
 * One click, followed to the end of the promise chain it starts.
 *
 * The chain is why this is awaited rather than asserted straight after the
 * call: the second injection cannot be asked for until the first has come
 * back, and Node runs those continuations on the microtask queue.
 */
async function click(tab: { id?: number }): Promise<void> {
  injected.length = 0;
  registered[0](tab);
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * The click, followed from the toolbar to the panel in the page.
 *
 * `read.test.ts`, `explain.test.ts` and `panel.test.ts` hold the three steps
 * one at a time: the page produces a reading, core turns a reading into a
 * panel, and the panel becomes nodes. What is left is the wiring, and it is
 * the part no reading of the source can answer for — that the handler the
 * worker registered sends *those* functions into *that* tab, in that order,
 * hands the second one what the first one earned, and asks for nothing else
 * while it is there.
 */
describe('the toolbar click', () => {
  it('registers exactly one handler when the worker loads', () => {
    expect(registered.length).toBe(1);
  });

  it('reads the page first, in the tab that was clicked, and passes it nothing', async () => {
    await click({ id: 42 });

    expect(injected[0]).toEqual({ target: { tabId: 42 }, func: readPage });
  });

  it('renders the panel into the same tab, with the computed panel as its argument', async () => {
    reads = reading({
      images: [image({ srcset: '/i/640.png 640w, /i/1080.png 1080w', sizes: '33vw' })],
    });

    await click({ id: 42 });

    expect(injected).toHaveLength(2);
    expect(injected[1]).toEqual({
      target: { tabId: 42 },
      func: renderPanel,
      args: [panelOf(reads)],
    });
    reads = reading();
  });

  it('injects into that tab alone, however many clicks arrive', async () => {
    await click({ id: 1 });
    const first = injected.map((one) => one.target);
    await click({ id: 2 });

    expect([...first, ...injected.map((one) => one.target)]).toEqual([
      { tabId: 1 },
      { tabId: 1 },
      { tabId: 2 },
      { tabId: 2 },
    ]);
  });

  it('asks core nothing and injects nothing further on the click that closes', async () => {
    // The closing click is one round trip. `readPage` found the panel already
    // there, took it away, and returned null — there is no page to explain, so
    // there is nothing to compute and nothing to send back.
    reads = null;

    await click({ id: 42 });

    expect(injected.map((one) => one.func)).toEqual([readPage]);
    reads = reading();
  });

  it('injects nothing at all for a click on a tab with no id', async () => {
    // Chrome hands a tab without an id for surfaces there is nothing to
    // explain about. An injection with no target would be an error to report,
    // and the panel is the only surface there is to report on.
    await click({});

    expect(injected).toEqual([]);
  });

  it('says nothing when the browser refuses the injection, and leaves no rejection behind', async () => {
    // The honest response to a page Chrome forbids injection into is the panel
    // not appearing. Saying nothing is not the same as doing nothing about it:
    // `void` on the call would discard the value and leave the rejection, and
    // an unhandled rejection in a service worker is a red error on the
    // extension's card — a dormant extension that looks broken the first time
    // anyone clicks it on the wrong tab.
    const unhandled: unknown[] = [];
    const watch = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', watch);
    refuse = new Error('Cannot access contents of the page');

    try {
      // Node decides a rejection went unhandled when the microtask queue
      // drains, which is before the check phase `setImmediate` runs in.
      await click({ id: 9 });
    } finally {
      process.off('unhandledRejection', watch);
      refuse = null;
    }

    expect(unhandled).toEqual([]);
  });

  it('sends two functions that put the panel in the page and take it away again', async () => {
    // The loop closed, and closed on the text rather than on the functions:
    // `executeScript` sends `String(func)` and serialises `args`, so this is
    // the form the page receives both halves in. A helper either of them
    // closed over is a `ReferenceError` here.
    reads = reading({ images: [image({ srcset: '/i/640.png 640w, /i/1080.png 1080w' })] });
    const host = page();
    const nodes = (): El[] => {
      const element = host.getElementById('__imgwhy_host__');
      return element === null ? [] : host.shadow(element);
    };

    await click({ id: 7 });
    const [first, second] = injected;

    const world = vm.createContext(globals(host, { width: 1440, height: 900, dpr: 1 }));
    // No panel in the page yet, so the reader reads it rather than closing it.
    expect(vm.runInContext(`(${String(first.func)})()`, world)).not.toBeNull();
    expect(
      vm.runInContext(
        `(${String(second.func)})(${JSON.stringify(second.args?.[0])})`,
        vm.createContext({ document: host }),
      ),
    ).toBe('opened');
    expect(nodes().filter((node) => node.name === 'li')).toHaveLength(1);

    // And the click after that, which is the same first function finding the
    // panel it left behind.
    expect(vm.runInContext(`(${String(first.func)})()`, world)).toBeNull();
    expect(nodes()).toEqual([]);
    reads = reading();
  });
});
