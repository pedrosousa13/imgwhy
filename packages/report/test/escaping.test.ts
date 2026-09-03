import type { Capture } from '@imgwhy/core';
import { describe, expect, it } from 'vitest';
import { renderReport } from '../src/index.js';
import { attributes, elements, unread } from './document.js';

/**
 * A Capture whose every string came from a page written to break out of the
 * report.
 *
 * Every one of these fields is page content. The URL is the one a redirect
 * chose, so a hostile host names it; `sizes`, the selector, the descriptor and
 * every candidate URL are attributes off the page's own markup; and the id is
 * derived from a DOM path, which carries whatever the page put in an
 * attribute selector. None of it is imgwhy's to trust.
 */
const hostile = (): Capture => ({
  url: 'https://evil.example/"><script>alert(\'page url\')</script>',
  capturedAt: '2026-09-03T00:00:00.000Z"><script>alert(\'captured at\')</script>',
  devices: [
    {
      id: 'desktop',
      name: '<img src=x onerror=alert(\'device name\')>',
      viewport: { width: 1440, height: 900 },
      dpr: 1,
    },
  ],
  runs: [
    {
      deviceId: 'desktop',
      images: [
        {
          id: 'html > body > img[alt="<script>alert(\'alt text\')</script>"]',
          selector: 'html > body > img[alt="<script>alert(\'alt text\')</script>"]',
          candidates: [
            { url: 'javascript:alert(\'candidate url\')', w: 640, x: null, raw: '640w' },
            {
              url: '/i/1080.png" onmouseover="alert(\'candidate quote\')',
              w: 1080,
              x: null,
              raw: '1080w\' onfocus=\'alert(1)',
            },
          ],
          sizes: '100vw" onload="alert(\'sizes\')',
          sizesSource: 'img',
          renderedWidth: 640,
          currentSrc: 'data:text/html,<script>alert(\'current src\')</script>',
          naturalWidth: 1080,
          transferBytes: 41_233,
          loading: 'lazy',
        },
      ],
    },
  ],
});

/**
 * Every attribute value the report is allowed to write.
 *
 * The report puts no page string in an attribute at all: page content is
 * element text, every time. So this list is closed, and it is the check —
 * anything else in an attribute came from somewhere it should not have.
 */
const OWN_VALUES = new Set([
  '',
  'en',
  'utf-8',
  'width=device-width, initial-scale=1',
  'viewport',
  'head',
  'image',
  'device',
  'name',
  'profile',
  'row',
  'col',
  'id',
  'flag',
  'sizes',
  'none',
  'candidates',
  'raw',
  'url',
  'picked',
  'bytes',
  'absent',
  'empty',
  'notes',
  'scroll',
  'html',
]);

describe('a report of a page written to break out of it', () => {
  const report = renderReport(hostile());

  it('opens no element the page asked for', () => {
    // `<script>` is the one the alt text and the page URL both wrote. There
    // is no script element in a report at all, so any at all is an injection.
    expect(report).not.toContain('<script');
    expect(elements(report).map((element) => element.name)).not.toContain('script');
  });

  it('leaves no handler attribute anywhere in the document', () => {
    const handlers = attributes(report).filter((attribute) => attribute.name.startsWith('on'));

    expect(handlers).toEqual([]);
  });

  it('writes only its own values into attributes, because page text is never one', () => {
    const foreign = attributes(report).filter(
      (attribute) => !OWN_VALUES.has(attribute.value.trim()),
    );

    expect(foreign).toEqual([]);
  });

  it('escapes the quote that would have ended an attribute and started a handler', () => {
    // The `sizes` string carries `" onload="`. Escaped, it is text.
    expect(report).toContain('sizes 100vw&quot; onload=&quot;alert(&#39;sizes&#39;)');
    expect(report).not.toContain('onload="alert');
  });

  it('escapes the descriptor, which is markup off the page like anything else', () => {
    expect(report).toContain('<span class="raw">1080w&#39; onfocus=&#39;alert(1)</span>');
  });

  it('writes a javascript: candidate URL as text and never as a target', () => {
    expect(report).toContain('javascript:alert(&#39;candidate url&#39;)');

    const targets = attributes(report).filter((attribute) =>
      attribute.value.toLowerCase().includes('javascript:'),
    );
    expect(targets).toEqual([]);
  });

  it('escapes the page URL in the title as well as in the body', () => {
    expect(report).toContain(
      '<title>imgwhy — https://evil.example/&quot;&gt;&lt;script&gt;' +
        'alert(&#39;page url&#39;)&lt;/script&gt;</title>',
    );
  });

  it('escapes the id, which carries whatever the page put in an alt attribute', () => {
    expect(report).toContain(
      'html &gt; body &gt; img[alt=&quot;&lt;script&gt;alert(&#39;alt text&#39;)' +
        '&lt;/script&gt;&quot;]',
    );
  });

  it('escapes the timestamp and the device name, which no reader would suspect', () => {
    expect(report).toContain('&lt;script&gt;alert(&#39;captured at&#39;)&lt;/script&gt;');
    expect(report).toContain('&lt;img src=x onerror=alert(&#39;device name&#39;)&gt;');
  });

  it('leaves no angle bracket the scanner above cannot account for', () => {
    // Which is also what makes every other check here sound: the allowlists
    // only cover tags the scanner read, so an unread `<` would slip past them.
    expect(unread(report)).toEqual([]);
  });

  it('escapes a hostile page URL in the message for a page with no image', () => {
    const empty: Capture = { ...hostile(), runs: [{ deviceId: 'desktop', images: [] }] };

    const report = renderReport(empty);

    expect(report).not.toContain('<script');
    expect(unread(report)).toEqual([]);
  });
});
