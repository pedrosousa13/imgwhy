import { describe, expect, it } from 'vitest';
import { renderReport } from '../src/index.js';
import { attributes, elements, stylesheets, unread } from './document.js';
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
]);

/** Every attribute a report writes. An allowlist, for the same reason. */
const ATTRIBUTES = new Set(['lang', 'charset', 'name', 'content', 'class', 'scope']);

/**
 * Attributes refused by name as well as by absence from the allowlist above.
 *
 * The allowlist already covers the shipped document. This covers the next
 * contributor, who adds a name to the allowlist because one link seemed
 * harmless: a `style` attribute carries `url()`, and every other name here
 * carries a URL a browser goes and gets. Both lists have to be edited to
 * introduce one, and this one says why it is refused.
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
    if (FETCHING.has(attribute.name)) found.push(`writes a ${attribute.name} attribute`);
    else if (!ATTRIBUTES.has(attribute.name)) found.push(`writes a ${attribute.name} attribute`);
    if (REMOTE.test(attribute.value)) {
      found.push(`names a host in ${attribute.name}="${attribute.value}"`);
    }
  }

  for (const sheet of stylesheets(document)) {
    for (const [pattern, why] of IN_CSS) if (pattern.test(sheet)) found.push(`has ${why}`);
  }

  for (const rest of unread(document)) found.push(`writes markup no scanner read: ${rest}`);

  return [...new Set(found)];
}

describe('the emitted report, as a file that must load nothing', () => {
  const report = renderReport(gallery());

  it('reaches the network in no way at all', () => {
    expect(reaching(report)).toEqual([]);
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
 */
describe('the self-containment check, given a report that fetches anyway', () => {
  const attacks: [string, string, string[]][] = [
    [
      'a hosted stylesheet, which is how a font arrives',
      '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head></html>',
      [
        'opens <link>',
        'writes a rel attribute',
        'writes a href attribute',
        'names a host in href="https://fonts.googleapis.com/css2?family=Inter"',
      ],
    ],
    [
      'a thumbnail of the image the report is about',
      '<td><img class="thumb" src="https://cdn.example/i/1080.png"></td>',
      [
        'opens <img>',
        'writes a src attribute',
        'names a host in src="https://cdn.example/i/1080.png"',
      ],
    ],
    [
      'a hosted script',
      '<body><script src="https://cdn.example/chart.js"></script></body>',
      ['opens <script>', 'writes a src attribute', 'names a host in src="https://cdn.example/chart.js"'],
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
      'a background in an inline style, which no element allowlist would catch',
      '<div class="hero" style="background: url(https://cdn.example/i.png)">x</div>',
      [
        'writes a style attribute',
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
        'writes a href attribute',
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
        'writes a http-equiv attribute',
        'names a host in content="0; url=https://example.com/"',
      ],
    ],
  ];

  it.each(attacks)('catches %s', (_route, document, expected) => {
    expect(reaching(document)).toEqual(expected);
  });

  it('is quiet about the markup a report actually writes', () => {
    expect(reaching('<td><span class="picked">1080w</span></td>')).toEqual([]);
  });

  it('reads the URL in a cell as text, which is where a report puts one', () => {
    expect(reaching('<span class="url">https://cdn.example/i/1080.png</span>')).toEqual([]);
  });
});
