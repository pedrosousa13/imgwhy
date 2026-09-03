import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { togglePanel } from '../src/panel.js';
import { page } from './dom.js';

/** What the worker hands `executeScript`, which is the whole of what a click does. */
type Injection = { target: { tabId: number }; func: () => unknown };

/** Every handler the worker registered, and every injection it asked for. */
const registered: ((tab: { id?: number }) => void)[] = [];
const injected: Injection[] = [];

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
    executeScript: (injection: Injection): Promise<unknown> => {
      injected.push(injection);
      return refuse === null ? Promise.resolve([]) : Promise.reject(refuse);
    },
  },
};

// A dynamic import rather than a static one, because a static import hoists
// above the assignment above and the worker would run against no browser at
// all.
await import('../src/background.js');

/**
 * The click, followed from the toolbar to the panel in the page.
 *
 * The issue's criteria:
 *
 * > - Clicking the toolbar icon injects a panel into the current tab
 * > - A second click removes the panel
 *
 * `panel.test.ts` holds the second of those and half of the first: the panel
 * opens and closes when its function runs. What is left is the wiring, and it
 * is the part no reading of the source can answer for — that the handler the
 * worker registered injects *that* function, into *that* tab, and asks for
 * nothing else while it is there.
 */
describe('the toolbar click', () => {
  it('registers exactly one handler when the worker loads', () => {
    expect(registered.length).toBe(1);
  });

  it('injects the panel into the tab that was clicked, and asks for nothing else', () => {
    injected.length = 0;

    registered[0]({ id: 42 });

    expect(injected).toEqual([{ target: { tabId: 42 }, func: togglePanel }]);
  });

  it('injects into that tab alone, however many clicks arrive', () => {
    injected.length = 0;

    registered[0]({ id: 1 });
    registered[0]({ id: 2 });

    expect(injected.map((one) => one.target)).toEqual([{ tabId: 1 }, { tabId: 2 }]);
  });

  it('injects nothing at all for a click on a tab with no id', () => {
    // Chrome hands a tab without an id for surfaces there is nothing to
    // explain about. An injection with no target would be an error to report,
    // and this slice's panel is the only surface there is to report on.
    injected.length = 0;

    registered[0]({});

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
      registered[0]({ id: 9 });
      // Node decides a rejection went unhandled when the microtask queue
      // drains, which is before the check phase `setImmediate` runs in.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', watch);
      refuse = null;
    }

    expect(unhandled).toEqual([]);
  });

  it('injects a function that puts the panel in the page and takes it away again', () => {
    // The loop closed: what the worker sends is the source of a function, and
    // that source, run against a page, is the panel. `executeScript` sends
    // `String(func)` rather than the function, so this is the form the page
    // receives it in.
    injected.length = 0;
    registered[0]({ id: 7 });
    const source = String(injected[0].func);
    const host = page();

    const context = vm.createContext({ document: host });
    expect(vm.runInContext(`(${source})()`, context)).toBe('opened');
    expect(host.getElementById('__imgwhy_host__')).not.toBeNull();
    expect(vm.runInContext(`(${source})()`, context)).toBe('removed');
    expect(host.getElementById('__imgwhy_host__')).toBeNull();
  });
});
