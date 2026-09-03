import { panelOf } from './explain.js';
import { renderPanel } from './panel.js';
import { readPage } from './read.js';

/**
 * The service worker, which is one listener and nothing else.
 *
 * The design's M3:
 *
 * > Done when nothing runs before that click. […] The service worker stays
 * > asleep. There is no passive cost on any page you visit.
 *
 * Manifest V3 makes one demand that reads like a contradiction and is not. The
 * worker has to register its listener synchronously at the top level, every
 * time Chrome starts it, because Chrome reads the registrations when it starts
 * the worker and a listener added inside a callback is one it has already
 * decided the worker does not have — the click would then do nothing at all.
 * So the statement below runs. It runs when Chrome wakes the worker, which is
 * not when a page loads, and registering a handler is not handling anything.
 *
 * What makes the dormancy real is everything that is *not* here. There is no
 * `chrome.runtime.onInstalled`, so nothing runs at install. No
 * `chrome.runtime.onStartup`, so nothing runs when the browser opens. No
 * `chrome.tabs.onUpdated` and no `chrome.webNavigation`, so nothing runs when
 * you navigate. No `self.addEventListener('fetch')`, so the extension is not
 * in front of anybody's requests. And no content script in the manifest, which
 * is the only other thing that could put code on a page. `dormant.test.ts`
 * holds all of that as an allowlist over the `chrome` surface rather than as a
 * list of the events to avoid, because the list of events is Chrome's to grow.
 *
 * `explain.ts` imports core, so waking the worker now evaluates core as well.
 * That is still nothing before a click: the only thing that starts this worker
 * is the click, and a module evaluated in a worker costs the page it was
 * clicked on nothing at all. What it buys is the reason the whole arrangement
 * below is three steps rather than one.
 *
 * After the click the worker goes back to sleep on Chrome's own schedule.
 * Nothing here keeps it awake: there is no state to hold, because the panel's
 * only state is whether the panel is in the page, and the page is what knows
 * that.
 */
chrome.action.onClicked.addListener((tab) => {
  // No tab id means no tab to inject into — Chrome hands one for a click on a
  // real page and can hand a tab without one for surfaces there is nothing to
  // explain about. Nothing to report, so nothing is reported.
  if (tab.id === undefined) return;

  // Bound after the guard, because the narrowing does not survive into the
  // callback below: `tab.id` is optional and a closure reads it again later.
  const tabId = tab.id;

  // `activeTab` is what makes this legal, and it is granted by the click
  // itself rather than at install: the click hands the extension access to
  // this one tab, for this one turn, and to no other tab ever. The design's
  // privacy constraint is that permission and no more of one.
  //
  // Three steps, and the split is forced rather than chosen. `executeScript`
  // sends `String(func)` and the page evaluates the text, so an injected
  // function arrives with no imports and no module around it — and the
  // arithmetic is core, which is a module. So the page is read by a function
  // that only reads, core is asked here where a real `import` works, and the
  // answers go back into the page as `args`. No `eval`, no `new Function`, no
  // bundler, and no copy of the algorithm anywhere in this package.
  //
  // A null reading is the closing click. `readPage` found the panel already
  // there, took it away, and there is nothing to explain — so core is asked
  // nothing and the page is injected into once rather than twice.
  //
  // The rejection is caught and dropped, deliberately and by hand. The error
  // case is a page the browser forbids injection into — `chrome://`, the web
  // store, a PDF viewer — and the honest response there is the panel not
  // appearing: reporting it would need a surface to report on, and the panel
  // is the surface.
  //
  // `void` would not have done. It discards the value and not the rejection,
  // so a click on a forbidden page left an unhandled rejection in the worker
  // and a red error on the extension's card in `chrome://extensions` — a
  // dormant extension that looks broken the first time anyone clicks it on the
  // wrong tab. Saying nothing has to be said explicitly.
  chrome.scripting
    .executeScript({ target: { tabId }, func: readPage })
    .then((results) => {
      const reading = results[0]?.result ?? null;
      if (reading === null) return;

      return chrome.scripting.executeScript({
        target: { tabId },
        func: renderPanel,
        args: [panelOf(reading)],
      });
    })
    .catch(() => {});
});
