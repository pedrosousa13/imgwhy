import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Rules } from './surface.js';
import { modulesIn, surfaceOf, topLevelEffects, why } from './surface.js';

const src = fileURLToPath(new URL('../src', import.meta.url));

/** The service worker, which is the only module Chrome ever loads on its own. */
const WORKER = 'background.ts';

/** The one call the worker is allowed to make when it loads. */
const REGISTRATION = 'chrome.action.onClicked.addListener';

/**
 * Every path off `chrome` this package may name.
 *
 * An allowlist rather than a list of APIs to refuse, and that is the point of
 * it. `chrome.tabs.onUpdated` is one way to make the worker wake on a page you
 * did not click; `chrome.webNavigation.onCommitted`,
 * `chrome.runtime.onInstalled`, `chrome.webRequest.onBeforeRequest`,
 * `chrome.alarms.onAlarm` and `chrome.declarativeContent` are five more, and
 * so is whatever the next release of Chrome adds. A list of the ones to refuse
 * is a list someone has to keep complete against an API surface Google owns.
 * This one refuses everything not named, so a listener that fires without a
 * click cannot arrive by being forgotten. Adding a name is the deliberate act.
 *
 * Two names is the whole extension. One is the click. The other is what the
 * click does.
 */
const CHROME = new Set(['chrome.action.onClicked.addListener', 'chrome.scripting.executeScript']);

/**
 * Paths refused by name as well as by absence from the allowlist above.
 *
 * The allowlist already covers the shipped worker. This covers the next
 * contributor, who adds a path to it because one listener seemed harmless.
 * Both lists have to be edited to give the extension a passive cost, and the
 * line this produces says which of them stopped it.
 *
 * The reasons are grouped by what makes each one fatal to dormancy, because
 * they are not all fatal for the same reason: an event fires the worker
 * awake, and an API like `storage` keeps something after it goes back to
 * sleep.
 */
const WAKES: Rules = [
  [
    /\.on(?:Updated|Created|Removed|Activated|Replaced|Moved|Attached|Detached|Highlighted|ZoomChange)\b/,
    'a tab event, which fires on navigation with nothing clicked',
  ],
  [
    /\.on(?:Installed|Startup|Suspend|SuspendCanceled|Connect|ConnectExternal|Message|MessageExternal|Alarm|StateChanged|Committed|BeforeNavigate|Completed|BeforeRequest|HeadersReceived|Determining|Changed)\b/,
    'an event that fires without a click',
  ],
  [
    /^chrome\.webNavigation\b/,
    'the navigation API, whose every event is a page load',
  ],
  [
    /^chrome\.webRequest\b/,
    'the request API, which sees every request every page makes',
  ],
  [
    /^chrome\.(?:alarms|idle|declarativeContent|declarativeNetRequest|contextMenus|commands|omnibox|notifications|offscreen)\b/,
    'an API that runs the worker without a click',
  ],
  [
    /^chrome\.(?:storage|cookies|history|bookmarks|downloads|topSites|browsingData|sessions|management|permissions|debugger)\b/,
    'an API that reads or keeps something outside the tab you clicked on',
  ],
  [
    /^chrome\.tabs\b/,
    'the tabs API, which needs a permission that reads every URL you visit',
  ],
];

/**
 * Events refused by name wherever a listener is registered for them.
 *
 * A service worker is still a service worker: `self.addEventListener('fetch')`
 * puts the extension in front of requests, and `install` and `activate` run
 * the moment Chrome installs the worker rather than when anyone clicks. None
 * of them goes through `chrome`, so the allowlist above cannot see them.
 *
 * A listener inside the injected panel is a different thing and is not
 * refused. The panel does not exist until a click has already happened, so a
 * `click` handler in it costs a page nothing — which is why this is a list of
 * event names rather than a ban on `addEventListener`, a ban the next slice
 * would have to loosen and might loosen carelessly.
 */
const WORKER_EVENTS: Rules = [
  [
    /^(?:install|activate|fetch|push|sync|periodicsync|notificationclick|notificationclose|pushsubscriptionchange)$/,
    'a service worker lifecycle event, which fires without a click',
  ],
  [/^(?:message|messageerror)$/, 'a message, which is a way in that no click opens'],
  [/^(?:DOMContentLoaded|load|readystatechange|pageshow|beforeunload)$/, 'a page load'],
];

/**
 * Every way one module costs a page something before a click, one line each.
 * Empty is clean.
 *
 * `exempt` is the registration, and it is passed only for the worker. Every
 * other module in the package must have a top level that does nothing at all,
 * because the worker imports them and an effect in one of them is an effect
 * the worker runs on load just the same.
 */
function findings(text: string, exempt?: string): string[] {
  const surface = surfaceOf(text);
  const found = [
    ...surface.refused,
    ...topLevelEffects(text, exempt),
    ...surface.chrome.map((path) => {
      const reason = why(WAKES, path);
      if (reason !== undefined) return `names ${path}, which is ${reason}`;
      return CHROME.has(path) ? null : `names ${path}`;
    }),
    ...surface.events.map((event) => {
      const reason = why(WORKER_EVENTS, event);
      return reason === undefined ? null : `listens for "${event}", which is ${reason}`;
    }),
  ];
  return [...new Set(found.filter((line): line is string => line !== null))];
}

/**
 * The design's M3, as a check rather than as an inspection:
 *
 * > Done when nothing runs before that click. […] The service worker stays
 * > asleep. There is no passive cost on any page you visit.
 *
 * Manifest V3 makes one demand that reads like a contradiction and is not:
 * the worker has to register its listener synchronously, at the top level,
 * every time Chrome starts it. A listener added inside a callback is a
 * listener Chrome has already decided the worker does not have, and the click
 * would do nothing. So the registration is the one statement that runs, and it
 * runs when Chrome wakes the worker rather than when a page loads. Registering
 * a handler is not handling anything.
 *
 * Everything else at that top level is a passive cost, and small ones are the
 * dangerous kind: a `console.log`, a cached lookup, a `chrome.storage.local`
 * read. None of them is visible from a running extension — a worker that woke,
 * did something and went back to sleep leaves the same nothing behind as one
 * that never woke — so this is checked in the source. `manifest.test.ts`
 * carries the other half, which is that the manifest gives Chrome no reason to
 * start the worker in the first place.
 */
describe('the extension, checked against anything that runs before a click', () => {
  const modules = modulesIn(src);

  it('has the worker to check, so nothing below passes for want of a file', () => {
    expect(Object.keys(modules)).toContain(WORKER);
    // The check reads the module it meant to read, rather than passing on a
    // renamed file whose top level happens to be empty.
    expect(surfaceOf(modules[WORKER] ?? '').chrome).toContain(REGISTRATION);
  });

  it('runs one statement when the worker loads, and that statement is the registration', () => {
    expect(topLevelEffects(modules[WORKER] ?? '', REGISTRATION)).toEqual([]);
    // Without the exemption the registration is the only thing reported, which
    // is what says the line above is exempting one statement rather than
    // finding none.
    expect(topLevelEffects(modules[WORKER] ?? '')).toEqual([
      `calls ${REGISTRATION} at its top level`,
    ]);
  });

  it('runs nothing at all when the modules the worker imports load', () => {
    const found = Object.entries(modules)
      .filter(([name]) => name !== WORKER)
      .flatMap(([name, text]) => topLevelEffects(text).map((line) => `${name} ${line}`));

    expect(found).toEqual([]);
  });

  it('names two extension APIs across the whole package, and no others', () => {
    const named = new Set(Object.values(modules).flatMap((text) => surfaceOf(text).chrome));

    expect([...named].sort()).toEqual([...CHROME].sort());
  });

  it('registers no listener anywhere for an event a page load fires', () => {
    const found = Object.entries(modules).flatMap(([name, text]) =>
      findings(text, name === WORKER ? REGISTRATION : undefined).map((line) => `${name} ${line}`),
    );

    expect(found).toEqual([]);
  });
});

/**
 * The check, read against an extension written to wake on its own anyway.
 *
 * Each module below is a real way to give the extension a passive cost, and
 * they are held here rather than tried in a browser and reverted, so the
 * failure they should cause is a passing test instead of a note in a commit
 * message.
 *
 * ## What still gets past
 *
 * - **A listener registered from a module reached at run time.**
 *   `boundary.test.ts` refuses a computed `import()` for the whole package,
 *   which is the backstop.
 * - **An API name the code only has when it runs.** `chrome['ta' + 'bs']`
 *   names nothing this reading can see, and is refused rather than read for
 *   exactly that reason — as is binding `chrome` to a name of its own.
 * - **A worker Chrome starts for its own reasons.** Chrome may start a worker
 *   to deliver an event nothing registered for, and it stops again with
 *   nothing having run. The manifest is what keeps that list to one entry.
 */
describe('the dormancy check, given an extension that wakes on its own', () => {
  const worker = (lines: string[]): string[] => findings(lines.join('\n'), REGISTRATION);

  it('is quiet about the arrangement that ships', () => {
    expect(
      worker([
        "import { togglePanel } from './panel.js';",
        'chrome.action.onClicked.addListener((tab) => {',
        '  if (tab.id === undefined) return;',
        '  void chrome.scripting.executeScript({ target: { tabId: tab.id }, func: togglePanel });',
        '});',
      ]),
    ).toEqual([]);
  });

  const attacks: [string, string[], string[]][] = [
    [
      'a tab listener, which fires on every navigation in every tab',
      ['chrome.tabs.onUpdated.addListener((id, change) => { void id; void change; });'],
      [
        'calls chrome.tabs.onUpdated.addListener at its top level',
        'names chrome.tabs.onUpdated.addListener, which is a tab event, which fires on navigation with nothing clicked',
      ],
    ],
    [
      'a navigation listener, which is the same thing under another API',
      ['chrome.webNavigation.onCommitted.addListener((details) => { void details; });'],
      [
        'calls chrome.webNavigation.onCommitted.addListener at its top level',
        'names chrome.webNavigation.onCommitted.addListener, which is an event that fires without a click',
      ],
    ],
    [
      'an install listener, which runs once at install and never again',
      ['chrome.runtime.onInstalled.addListener(() => {});'],
      [
        'calls chrome.runtime.onInstalled.addListener at its top level',
        'names chrome.runtime.onInstalled.addListener, which is an event that fires without a click',
      ],
    ],
    [
      'a startup listener, which runs every time the browser opens',
      ['chrome.runtime.onStartup.addListener(() => {});'],
      [
        'calls chrome.runtime.onStartup.addListener at its top level',
        'names chrome.runtime.onStartup.addListener, which is an event that fires without a click',
      ],
    ],
    [
      'a request listener, which sees every request before it is sent',
      ['chrome.webRequest.onBeforeRequest.addListener((d) => { void d; }, { urls: [] });'],
      [
        'calls chrome.webRequest.onBeforeRequest.addListener at its top level',
        'names chrome.webRequest.onBeforeRequest.addListener, which is an event that fires without a click',
      ],
    ],
    [
      'a fetch handler on the worker itself, which goes nowhere near chrome',
      ["self.addEventListener('fetch', (event) => { void event; });"],
      [
        'calls self.addEventListener at its top level',
        'listens for "fetch", which is a service worker lifecycle event, which fires without a click',
      ],
    ],
    [
      'an install handler, which runs the moment Chrome installs the worker',
      ["addEventListener('install', () => {});"],
      [
        'calls addEventListener at its top level',
        'listens for "install", which is a service worker lifecycle event, which fires without a click',
      ],
    ],
    [
      'work done at load, with no listener anywhere in it',
      [
        "import { togglePanel } from './panel.js';",
        'const source = String(togglePanel);',
        'chrome.action.onClicked.addListener(() => { void source; });',
      ],
      ['initialises source with something that runs at its top level'],
    ],
    [
      'a log line, which is the smallest passive cost there is',
      ["console.log('imgwhy: worker up');", 'chrome.action.onClicked.addListener(() => {});'],
      ['calls console.log at its top level'],
    ],
    [
      'a read at load, which is a passive cost that also keeps something',
      [
        'chrome.storage.local.get(null);',
        'chrome.action.onClicked.addListener(() => {});',
      ],
      [
        'calls chrome.storage.local.get at its top level',
        'names chrome.storage.local.get, which is an API that reads or keeps something outside the tab you clicked on',
      ],
    ],
    [
      'a loop at load, which no allowlist over chrome would ever see',
      [
        'for (const key of Object.keys(globalThis)) void key;',
        'chrome.action.onClicked.addListener(() => {});',
      ],
      ['runs a for of at its top level'],
    ],
    [
      'an await at load, which keeps the worker alive past its registration',
      ['await chrome.scripting.executeScript({ target: { tabId: 1 }, func: () => {} });'],
      ['awaits something at its top level'],
    ],
    [
      'an API taken off chrome under a name of its own, which hides the path',
      [
        'const { tabs } = chrome;',
        'chrome.action.onClicked.addListener(() => { void tabs.query({}); });',
      ],
      [
        'binds the whole of chrome to a name of its own',
        'initialises { tabs } with something that runs at its top level',
      ],
    ],
    [
      'an API reached under a name it computes, which nothing static can read',
      [
        "chrome.action.onClicked.addListener(() => { void chrome['ta' + 'bs']; });",
      ],
      ['reaches an extension API through a name it computes at run time'],
    ],
    [
      'a listener for an event named at run time',
      [
        'chrome.action.onClicked.addListener(() => {});',
        'export const watch = (name: string) => addEventListener(name, () => {});',
      ],
      ['registers a listener for an event it names at run time'],
    ],
    [
      'a message listener, which is a way in that no click opens',
      ['chrome.runtime.onMessage.addListener(() => {});'],
      [
        'calls chrome.runtime.onMessage.addListener at its top level',
        'names chrome.runtime.onMessage.addListener, which is an event that fires without a click',
      ],
    ],
    [
      'an API with no wake in it at all, refused by absence from the allowlist',
      ['chrome.action.onClicked.addListener((tab) => { void chrome.i18n.getUILanguage(); void tab; });'],
      ['names chrome.i18n.getUILanguage'],
    ],
  ];

  it.each(attacks)('catches %s', (_route, lines, expected) => {
    expect(worker(lines)).toEqual(expected);
  });

  it('catches a second registration, which the exemption cannot see by itself', () => {
    // Both statements are the registration, so both are exempt and `findings`
    // is quiet about them. What catches it is the count: two listeners toggle
    // the panel twice and the click does nothing at all. `topLevelEffects`
    // reports one line per statement rather than one per distinct finding for
    // this reason, and the shipped worker's check asserts the unexempted
    // reading is exactly one line long.
    const twice = [
      'chrome.action.onClicked.addListener(() => {});',
      'chrome.action.onClicked.addListener(() => {});',
    ].join('\n');

    expect(worker(twice.split('\n'))).toEqual([]);
    expect(topLevelEffects(twice)).toEqual([
      `calls ${REGISTRATION} at its top level`,
      `calls ${REGISTRATION} at its top level`,
    ]);
  });

  it('refuses a waking API even where the allowlist has been loosened', () => {
    // What `WAKES` is for, and the only way to show it: the shipped worker
    // reaches neither list, so nothing about the arrangement above would
    // change if it were deleted. The edit it exists for is one to `CHROME` — a
    // contributor who allowed a path because the listener in front of them
    // seemed harmless — and this is the list that does not move with it.
    const loosened = new Set([...CHROME, 'chrome.tabs.onUpdated.addListener']);
    const named = surfaceOf('const f = () => chrome.tabs.onUpdated.addListener(() => {});').chrome;

    expect(named.filter((path) => !loosened.has(path))).toEqual([]);
    expect(named.map((path) => why(WAKES, path))).toEqual([
      'a tab event, which fires on navigation with nothing clicked',
    ]);
  });

  it('reads no listener out of a comment, which a regex over the text cannot help', () => {
    expect(
      worker([
        '/** Never `chrome.tabs.onUpdated`, and never an addEventListener("install"). */',
        '// A page-load cost would read `chrome.webNavigation.onCommitted.addListener(…)`.',
        'chrome.action.onClicked.addListener(() => {});',
      ]),
    ).toEqual([]);
  });
});
