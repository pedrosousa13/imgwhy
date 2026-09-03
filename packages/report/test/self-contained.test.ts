import { describe, expect, it } from 'vitest';
import { renderReport } from '../src/index.js';
import { attributes, elements, namesIn, scripts, stylesheets, unread } from './document.js';
import { gallery } from './capture.js';

/**
 * Every element a report writes.
 *
 * An allowlist rather than a list of elements to refuse, and that is the point
 * of it. `<img>`, `<link>`, `<script src>`, `<iframe>`, `<object>`, `<embed>`
 * and `<use>` all fetch, and so do several nobody thinks of — `<track>`,
 * `<source>`, `<input type=image>`. A list of the ones to refuse is a list
 * someone has to keep complete. This one refuses everything not named, so a
 * fetching element cannot arrive by being forgotten. Adding a name is the
 * deliberate act.
 */
const ELEMENTS = new Set([
  'html',
  'head',
  'meta',
  'title',
  'style',
  'body',
  'main',
  'h1',
  'h2',
  'p',
  'section',
  'dl',
  'dt',
  'dd',
  'div',
  'table',
  'caption',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'ul',
  'li',
  'span',
  'strong',
  'code',
  'h3',
  'script',
  'label',
  'input',
  'textarea',
]);

/** Every attribute a report writes. An allowlist, for the same reason. */
const ATTRIBUTES = new Set([
  'lang',
  'charset',
  'name',
  'content',
  'class',
  'scope',
  'type',
  'min',
  'step',
]);

/**
 * What a `<script>` may be.
 *
 * `type` had to be allowed for the controls — `<input type="number">` — and it
 * is the one attribute in the list above that decides what an element *does*.
 * On a script it decides whether the element runs, and `type="module"` would
 * turn one into something that can `import`, which is a request. So the two
 * this report writes are named and the rest are refused: an empty type, which
 * is the classic script the panel wiring ships in, and the JSON island, which
 * runs nothing at all.
 */
const SCRIPT_TYPES = new Set(['', 'application/json']);

/**
 * Attributes refused by name as well as by absence from the allowlist above.
 *
 * The allowlist already covers the shipped document. This covers the next
 * contributor, who adds a name to the allowlist because one link seemed
 * harmless: a `style` attribute carries `url()`, and every other name here
 * carries a URL a browser goes and gets. Both lists have to be edited to
 * introduce one, and `refused` below says which of them stopped it.
 */
const FETCHING = new Set([
  'src',
  'srcset',
  'href',
  'style',
  'poster',
  'data',
  'action',
  'formaction',
  'background',
  'manifest',
  'ping',
  'cite',
  'longdesc',
  'profile',
  'codebase',
  'usemap',
  'http-equiv',
  'xlink:href',
]);

/**
 * Why one attribute is refused, or null where the report may write it.
 *
 * Two lists in one answer, and the order matters: a name in `FETCHING` is
 * refused whatever `allowed` says, and the line it produces says so. That is
 * the whole of what `FETCHING` buys, so `allowed` is a parameter rather than
 * the constant above — a check that could not be asked about a loosened
 * allowlist could not show that the second list holds on its own.
 */
const refused = (name: string, allowed: Set<string>): string | null => {
  if (FETCHING.has(name)) return `writes a ${name} attribute, which fetches`;
  if (!allowed.has(name)) return `writes a ${name} attribute`;
  return null;
};

/** A URL that names a host: an absolute one, or a protocol-relative one. */
const REMOTE = /(?:https?:)?\/\//i;

/** Every way a stylesheet can fetch, and the font rule the design refuses. */
const IN_CSS: [RegExp, string][] = [
  [/url\s*\(/i, 'a url() in its stylesheet'],
  [/@import/i, 'an @import in its stylesheet'],
  [/@font-face/i, 'an @font-face in its stylesheet'],
  [/image-set\s*\(/i, 'an image-set() in its stylesheet'],
  [/\bsrc\s*:/i, 'a src descriptor in its stylesheet'],
  [REMOTE, 'a host named in its stylesheet'],
];

/**
 * Every name the report's script reaches for outside itself, which is every
 * host thing it can touch at all.
 *
 * An allowlist, like `ELEMENTS` and `ATTRIBUTES` above and for the same
 * reason. `fetch`, `XMLHttpRequest`, `Image`, `WebSocket`, `EventSource`,
 * `importScripts`, `eval` and `Function` are every one of them a name used and
 * never bound — and so is whatever the next of them turns out to be called. A
 * list of the ones to refuse is a list someone has to keep complete; this one
 * refuses everything not named, so a route out cannot arrive by being
 * forgotten.
 *
 * It is short because the script is: eight names, and every one of them is
 * language rather than host except `document`. That is what makes an allowlist
 * tractable here in a way it would not be over arbitrary code — the script is
 * fixed, it interpolates nothing, and two reports of two different pages carry
 * it byte for byte, which `escaping.test.ts` checks.
 *
 * Core's own source is in here too, so adding a name is the deliberate act for
 * core as much as for the wiring. That is the point rather than the cost:
 * core's whole contract is that it reaches for no host at all.
 */
const GLOBALS = new Set([
  'Boolean',
  'JSON',
  'Math',
  'Number',
  'Object',
  'String',
  'document',
  'parseFloat',
]);

/**
 * Every property the script may call, and every property it may write.
 *
 * `WRITTEN` is the escaping argument, re-established for a document that ships
 * a script. Escaping is a claim about what reaches the parser and it holds for
 * the document as written; a script runs afterwards, so `innerHTML = data`
 * would put page content back into the parser with no escaping anywhere in
 * sight. Two names is the whole list, and it is the rule `script.ts` states:
 * the panel writes `textContent` and `value`, which are text however hostile
 * the string is.
 *
 * `CALLED` is the same rule for the routes that are calls rather than
 * assignments — `createElement`, `insertAdjacentHTML`, `write`, `append`.
 *
 * `KEYS` is the third route to the same act, and the one a denylist misses by
 * construction: `Object.assign(el, { src })` writes a `src` with no `.src =`
 * anywhere in the text. Every name in it is the Capture's, the Selection's or
 * the Readout's own vocabulary.
 *
 * A property *read* is deliberately unchecked. Reading `el.innerHTML` fetches
 * nothing and writes nothing, and the field names a report reads are the whole
 * of the data it was handed.
 */
const CALLED = new Set([
  'addEventListener',
  'assign',
  'endsWith',
  'every',
  'filter',
  'find',
  'map',
  'match',
  'parse',
  'push',
  'querySelector',
  'querySelectorAll',
  'replace',
  'round',
  'some',
  'sort',
  'split',
  'test',
  'toLowerCase',
  'trim',
]);

const WRITTEN = new Set(['textContent', 'value']);

const KEYS = new Set([
  'auto',
  'candidate',
  'clause',
  'cond',
  'cssPx',
  'density',
  'dpr',
  'height',
  'id',
  'kind',
  'marks',
  'name',
  'needed',
  'neededPx',
  'picked',
  'px',
  'raw',
  'reason',
  'resolution',
  'sizes',
  'url',
  'viewport',
  'w',
  'width',
  'x',
]);

/**
 * Every way the report's own script could reach the network, and every way it
 * could turn text into markup — named, rather than left to the allowlists.
 *
 * This is `FETCHING` again, one element along, and it earns its place the same
 * way. The four lists above already cover the shipped document, so nothing
 * about the arrangement would change if this were deleted. The edit it exists
 * for is one to `GLOBALS` or `CALLED` — a contributor who adds a name because
 * the one call in front of them seemed harmless — and this is the list that
 * does not move with it. The message differs too, so the reason reaches them.
 *
 * It is a denylist and it is not the primary instrument. `Object.assign(el, {
 * src })` is in the attack table below precisely because nothing here sees it:
 * a list of forbidden spellings cannot be complete, which is why the lists
 * above refuse by absence instead.
 *
 * The host patterns are anchored, unlike the stylesheet's. A bare `//` is a
 * comment in JavaScript, so the CSS rule would refuse every commented script
 * ever written — which is not a rule, it is a trap for whoever writes the next
 * one. A scheme, or a `//host` inside a string literal, is a URL.
 */
const IN_JS: [RegExp, string][] = [
  [/\bfetch\s*\(/, 'a fetch() in its script'],
  [/XMLHttpRequest/, 'an XMLHttpRequest in its script'],
  [/\bimport\s*\(/, 'a dynamic import() in its script'],
  [/importScripts/, 'an importScripts() in its script'],
  [/sendBeacon/, 'a sendBeacon() in its script'],
  [/WebSocket|EventSource/, 'a socket in its script'],
  [/new\s+Image\b/, 'an Image() in its script'],
  [/\.src\s*=/, 'an assignment to a src in its script'],
  [/createElement|setAttribute/, 'an element built in its script'],
  [/innerHTML|outerHTML|insertAdjacentHTML|document\.write/, 'markup written from its script'],
  [/\beval\s*\(|new\s+Function/, 'code built at run time in its script'],
  [/https?:\/\//i, 'a host named in its script'],
  [/['\"]\/\/[a-z0-9.-]/i, 'a protocol-relative host in its script'],
];

/** Every way a data island could stop being data, one line each. */
function inertData(text: string): string[] {
  const found: string[] = [];
  // Every `<` is written as its JSON escape, so one that survived is either a
  // string that reached the island unescaped or an element that is not data.
  if (text.includes('<')) found.push('writes a < inside its data');
  try {
    JSON.parse(text);
  } catch {
    found.push('writes data that does not parse as JSON');
  }
  return found;
}

/**
 * Every way the document could reach the network, one line each. Empty is
 * self-contained.
 *
 * The rule the design states is absolute: `report.html` "loads no remote
 * resource, so opening a report tells no third party that you opened it". So
 * this cannot be a search for `https://` in the text — a report *shows* the
 * URLs a page shipped, as the text of a cell, and must. What it must not do is
 * put one anywhere a browser acts on, and that is a question about position,
 * which is why `document.ts` scans rather than searches.
 */
function reaching(document: string): string[] {
  const found: string[] = [];

  for (const element of elements(document)) {
    if (!ELEMENTS.has(element.name)) found.push(`opens <${element.name}>`);
  }

  for (const attribute of attributes(document)) {
    const why = refused(attribute.name, ATTRIBUTES);
    if (why !== null) found.push(why);
    if (REMOTE.test(attribute.value)) {
      found.push(`names a host in ${attribute.name}="${attribute.value}"`);
    }
  }

  for (const sheet of stylesheets(document)) {
    for (const [pattern, why] of IN_CSS) if (pattern.test(sheet)) found.push(`has ${why}`);
  }

  for (const script of scripts(document)) {
    if (!SCRIPT_TYPES.has(script.type)) found.push(`runs a <script type="${script.type}">`);
    if (script.type === 'application/json') {
      for (const why of inertData(script.text)) found.push(why);
      continue;
    }
    for (const [pattern, why] of IN_JS) if (pattern.test(script.text)) found.push(`has ${why}`);

    const names = namesIn(script.text);
    for (const why of names.refused) found.push(`${why} in its script`);
    for (const name of names.globals) {
      if (!GLOBALS.has(name)) found.push(`reaches ${name} in its script`);
    }
    for (const name of names.called) {
      if (!CALLED.has(name)) found.push(`calls ${name}() in its script`);
    }
    for (const name of names.written) {
      if (!WRITTEN.has(name)) found.push(`writes ${name} in its script`);
    }
    for (const name of names.keys) {
      if (!KEYS.has(name)) found.push(`names ${name} in an object in its script`);
    }
  }

  for (const rest of unread(document)) found.push(`writes markup no scanner read: ${rest}`);

  return [...new Set(found)];
}

describe('the emitted report, as a file that must load nothing', () => {
  const report = renderReport(gallery());

  it('reaches the network in no way at all', () => {
    expect(reaching(report)).toEqual([]);
  });

  it('carries one script that runs and one island of data, and no other', () => {
    expect(scripts(report).map((one) => one.type)).toEqual(['application/json', '']);
  });

  it('carries its whole stylesheet inside itself, in one element', () => {
    expect(stylesheets(report)).toHaveLength(1);
    expect(stylesheets(report)[0]).toContain('font:');
  });

  it('takes its fonts from a system stack, so it names no font host', () => {
    const sheet = stylesheets(report)[0] ?? '';

    expect(sheet).toContain('-apple-system');
    expect(sheet).toContain('BlinkMacSystemFont');
    expect(sheet).toContain('ui-monospace');
    expect(sheet).not.toMatch(/@font-face/i);
  });

  it('shows the URLs the page shipped, which is what it is for', () => {
    // The check above is not passing because the report hides them: they are
    // all there, as the text of a cell, where a browser does nothing with one.
    expect(report).toContain('<span class="url">/i/1080.png</span>');
    expect(report).toContain('<dd class="url">https://example.com/gallery</dd>');
  });

  it('stays self-contained for a page written to break out of the report', () => {
    // The escaping and the self-containment hold each other up: an unescaped
    // `<img src=…>` off the page is a remote request as much as one written
    // here would be, and this is the check that would see it.
    const injected = renderReport({
      ...gallery(),
      url: 'https://evil.example/"><img src="https://evil.example/beacon.png">',
    });

    expect(reaching(injected)).toEqual([]);
  });
});

/**
 * The check, read against reports written to defeat it.
 *
 * Each document below is a real way to put a request back in the file, and
 * they are held here rather than tried on a branch and reverted, so the
 * failure they should cause is a passing test instead of a note in a commit
 * message.
 *
 * ## What still gets past
 *
 * - **A `<meta name="referrer">` or anything else in the allowlists.** Neither
 *   list is a claim about semantics, only about fetching.
 * - **A tag shape the scanner cannot read.** `unread` is what turns that from
 *   a silent pass into a finding, which is why it is one of the rules.
 * - **A host thing reached through a name the script already binds.** The
 *   script's globals are the names it uses and never binds, so a script that
 *   wrote `const document = frames[0].document` would be reaching through
 *   `frames`, which is still a global and still refused — but a name handed to
 *   a function as a parameter is bound, and this reading cannot say where the
 *   argument came from. The wiring takes two, `section` and `panel`, and both
 *   come from the document and the island.
 * - **A property the script only reads.** Reads are unchecked on purpose, so
 *   `IN_JS` is the list that still names `innerHTML` and `.src =`, and the two
 *   `computes at run time` refusals are what stop the reading being dodged by
 *   spelling a name at run time instead.
 */
describe('the self-containment check, given a report that fetches anyway', () => {
  const attacks: [string, string, string[]][] = [
    [
      'a hosted stylesheet, which is how a font arrives',
      '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head></html>',
      [
        'opens <link>',
        'writes a rel attribute',
        'writes a href attribute, which fetches',
        'names a host in href="https://fonts.googleapis.com/css2?family=Inter"',
      ],
    ],
    [
      'a thumbnail of the image the report is about',
      '<td><img class="thumb" src="https://cdn.example/i/1080.png"></td>',
      [
        'opens <img>',
        'writes a src attribute, which fetches',
        'names a host in src="https://cdn.example/i/1080.png"',
      ],
    ],
    [
      'a hosted script, which the element allowlist no longer refuses on its own',
      '<body><script src="https://cdn.example/chart.js"></script></body>',
      [
        'writes a src attribute, which fetches',
        'names a host in src="https://cdn.example/chart.js"',
      ],
    ],
    [
      'a script that fetches, which no attribute in the file would show',
      `<script>fetch('https://example.com/beacon');</script>`,
      [
        'has a fetch() in its script',
        'has a host named in its script',
        'reaches fetch in its script',
      ],
    ],
    [
      'a module script, whose type is what makes an import possible',
      '<script type="module">import x from "https://cdn.example/x.js";</script>',
      ['runs a <script type="module">', 'has a host named in its script'],
    ],
    [
      'markup written after the parser has finished, which no escaping covers',
      '<script>document.body.innerHTML = data.sizes;</script>',
      [
        'has markup written from its script',
        'reaches data in its script',
        'writes innerHTML in its script',
      ],
    ],
    [
      'an image built at run time, which is a request with no element in the file',
      '<script>new Image().src = candidate.url;</script>',
      [
        'has an Image() in its script',
        'has an assignment to a src in its script',
        'reaches Image in its script',
        'reaches candidate in its script',
        'writes src in its script',
      ],
    ],
    [
      'a host in a string, named without a scheme',
      `<script>const beacon = '//cdn.example/i/1080.png';</script>`,
      ['has a protocol-relative host in its script'],
    ],
    [
      'a property sprayed onto an element, which no forbidden spelling appears in',
      '<script>const url = "/i/1.png";\nObject.assign(document.body, { src: url });</script>',
      ['names src in an object in its script'],
    ],
    [
      'a property name the script only has when it runs, which no reading can name',
      `<script>document.body['inner' + 'HTML'] = 'x';</script>`,
      ['writes to a property it computes at run time in its script'],
    ],
    [
      'a beacon through a global the wiring never names',
      `<script>navigator.sendBeacon('/collect', '1');</script>`,
      [
        'has a sendBeacon() in its script',
        'reaches navigator in its script',
        'calls sendBeacon() in its script',
      ],
    ],
    [
      'a data island that ends its own element, which is how a page would break out',
      '<script type="application/json">{"sizes":"</script>"}</script>',
      ['writes data that does not parse as JSON'],
    ],
    [
      'a data island holding an element rather than data',
      '<script type="application/json">{"sizes":"<img src=x>"}</script>',
      ['writes a < inside its data'],
    ],
    [
      'an @font-face, which the design refuses whatever it points at',
      '<style>@font-face { font-family: Inter; src: url(https://f.example/i.woff2) }</style>',
      [
        'has a url() in its stylesheet',
        'has an @font-face in its stylesheet',
        'has a src descriptor in its stylesheet',
        'has a host named in its stylesheet',
      ],
    ],
    [
      'an @import, which fetches without naming an element',
      "<style>@import url('https://cdn.example/reset.css');</style>",
      [
        'has a url() in its stylesheet',
        'has an @import in its stylesheet',
        'has a host named in its stylesheet',
      ],
    ],
    [
      'an @import inside an uppercase STYLE, which HTML treats as the same element',
      '<STYLE>@import url(https://evil.example/a.css)</STYLE>',
      [
        'has a url() in its stylesheet',
        'has an @import in its stylesheet',
        'has a host named in its stylesheet',
      ],
    ],
    [
      'a background in an inline style, which no element allowlist would catch',
      '<div class="hero" style="background: url(https://cdn.example/i.png)">x</div>',
      [
        'writes a style attribute, which fetches',
        'names a host in style="background: url(https://cdn.example/i.png)"',
      ],
    ],
    [
      'a protocol-relative URL, which names a host without naming a scheme',
      '<span class="url" data-of="//cdn.example/i/1080.png">x</span>',
      [
        'writes a data-of attribute',
        'names a host in data-of="//cdn.example/i/1080.png"',
      ],
    ],
    [
      'a link the reader clicks, which leaks on the click rather than on the load',
      '<p><a href="https://example.com/gallery">the page</a></p>',
      [
        'opens <a>',
        'writes a href attribute, which fetches',
        'names a host in href="https://example.com/gallery"',
      ],
    ],
    [
      'a handler that fetches, which is a request with no URL attribute at all',
      `<p class="note" onclick="fetch('https://example.com/beacon')">x</p>`,
      [
        'writes a onclick attribute',
        `names a host in onclick="fetch('https://example.com/beacon')"`,
      ],
    ],
    [
      'a meta refresh, which navigates with no element out of the allowlist',
      '<meta http-equiv="refresh" content="0; url=https://example.com/">',
      [
        'writes a http-equiv attribute, which fetches',
        'names a host in content="0; url=https://example.com/"',
      ],
    ],
  ];

  it.each(attacks)('catches %s', (_route, document, expected) => {
    expect(reaching(document)).toEqual(expected);
  });

  it('refuses a fetching attribute even where the allowlist has been loosened', () => {
    // What `FETCHING` is for, and the only way to show it: the shipped
    // document reaches neither list, so nothing about the arrangement above
    // would change if `FETCHING` were deleted. The edit it exists for is one
    // to `ATTRIBUTES` — a contributor who let a link through because the one
    // in front of them seemed harmless — and this is the list that does not
    // move with it. The message differs too, so the reason reaches them.
    const loosened = new Set([...ATTRIBUTES, 'href', 'style']);

    expect(refused('href', loosened)).toBe('writes a href attribute, which fetches');
    expect(refused('style', loosened)).toBe('writes a style attribute, which fetches');
    expect(refused('class', loosened)).toBeNull();
    expect(refused('data-of', loosened)).toBe('writes a data-of attribute');
  });

  it('is quiet about the markup a report actually writes', () => {
    expect(reaching('<td><span class="picked">1080w</span></td>')).toEqual([]);
  });

  it('reads a comparison and a comment as the code they are, not as markup', () => {
    // The rule a bare `//` would have made unkeepable: every line comment in
    // every script would read as a host, and the `<` of a loop would read as a
    // tag nothing accounted for. Both are in the wiring the report ships.
    const wiring = [
      '<script>',
      '// walk the panels the island describes',
      'const panels = JSON.parse(document.querySelector(".panel").textContent);',
      'const node = document.querySelector(".reason");',
      'for (let i = 0; i < panels.length; i++) node.textContent = String(panels[i]);',
      '</script>',
    ].join('\n');

    expect(reaching(wiring)).toEqual([]);
  });

  it('is quiet about a data island whose every angle bracket is escaped', () => {
    expect(
      reaching('<script type="application/json">{"sizes":"\\u003c/script\\u003e"}</script>'),
    ).toEqual([]);
  });

  it('reads the URL in a cell as text, which is where a report puts one', () => {
    expect(reaching('<span class="url">https://cdn.example/i/1080.png</span>')).toEqual([]);
  });
});
