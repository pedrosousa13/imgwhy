import { describe, expect, it } from 'vitest';
import { dataScript, html, script } from '../src/html.js';

/** What the tag produced, as the document would carry it. */
const text = (markup: { toString: () => string }): string => markup.toString();

describe('the html tag', () => {
  it('writes its own literal parts out untouched, because they are the markup', () => {
    expect(text(html`<p class="note">plain</p>`)).toBe('<p class="note">plain</p>');
  });

  it('escapes an interpolated string, which is the default a contributor gets', () => {
    expect(text(html`<p>${'<script>alert(1)</script>'}</p>`)).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('escapes the quote that would end an attribute value', () => {
    expect(text(html`<td title="${'" onmouseover="alert(1)'}">x</td>`)).toBe(
      '<td title="&quot; onmouseover=&quot;alert(1)">x</td>',
    );
  });

  it('escapes a single quote too, so a single-quoted attribute is no weaker', () => {
    expect(text(html`<td title='${"' onmouseover='alert(1)"}'>x</td>`)).toBe(
      "<td title='&#39; onmouseover=&#39;alert(1)'>x</td>",
    );
  });

  it('escapes the ampersand first, so no escape can be smuggled through one', () => {
    expect(text(html`<p>${'&lt;script&gt;'}</p>`)).toBe('<p>&amp;lt;script&amp;gt;</p>');
  });

  it('writes a number as itself, because a number cannot carry markup', () => {
    expect(text(html`<td>${1080}</td>`)).toBe('<td>1080</td>');
  });

  it('nests markup this tag made without escaping it twice', () => {
    const cell = html`<td>${'<b>'}</td>`;

    expect(text(html`<tr>${cell}</tr>`)).toBe('<tr><td>&lt;b&gt;</td></tr>');
  });

  it('joins a list with nothing between, so a row of cells reads as one', () => {
    const cells = [1, 2, 3].map((n) => html`<td>${n}</td>`);

    expect(text(html`<tr>${cells}</tr>`)).toBe('<tr><td>1</td><td>2</td><td>3</td></tr>');
  });

  it('escapes every string inside a list, not only the first', () => {
    expect(text(html`<p>${['<a>', '<b>']}</p>`)).toBe('<p>&lt;a&gt;&lt;b&gt;</p>');
  });

  it('escapes a string nested through a list of lists', () => {
    expect(text(html`<p>${[['<a>'], ['<b>']]}</p>`)).toBe('<p>&lt;a&gt;&lt;b&gt;</p>');
  });

  it('escapes every interpolation of a template, not only the last', () => {
    expect(text(html`<a>${'<x>'}</a><b>${'<y>'}</b>`)).toBe('<a>&lt;x&gt;</a><b>&lt;y&gt;</b>');
  });

  it('takes an interpolation at the very start and the very end', () => {
    expect(text(html`${'<x>'}|${'<y>'}`)).toBe('&lt;x&gt;|&lt;y&gt;');
  });

  it('writes an empty list as nothing at all', () => {
    expect(text(html`<tr>${[]}</tr>`)).toBe('<tr></tr>');
  });
});

describe('the script tag', () => {
  it('writes JavaScript into a script element, untouched, because it is the code', () => {
    expect(text(script('const picked = 1080;'))).toBe(
      '<script>\nconst picked = 1080;\n</script>',
    );
  });

  it('leaves a comparison alone, which HTML escaping would have broken', () => {
    // The one thing a script must not get is HTML escaping: `&lt;` is not `<`
    // to a JavaScript parser, and core compares indexes with one.
    expect(text(script('while (i < s.length) i++;'))).toContain('i < s.length');
  });

  it('refuses a body carrying the end tag, whatever escaping was applied to it', () => {
    expect(() => script('const end = "</script>";')).toThrow('</script');
  });

  it('refuses the end tag in any case, because HTML reads tags case-insensitively', () => {
    expect(() => script('const end = "</SCRIPT >";')).toThrow('</script');
  });

  it('refuses a comment opener, which changes how the parser reads the rest', () => {
    expect(() => script('const hidden = "<!--";')).toThrow('<!--');
  });

  it('refuses a nested opening tag, the other half of the escaped-text state', () => {
    expect(() => script('const nested = "<script>";')).toThrow('<script');
  });
});

describe('the data script', () => {
  const contents = (markup: { toString: () => string }): string =>
    /<script type="application\/json">([\s\S]*)<\/script>/.exec(text(markup))?.[1] ?? '';

  it('writes a value as JSON inside a script element of its own', () => {
    expect(text(dataScript({ picked: '1080w' }))).toBe(
      '<script type="application/json">{"picked":"1080w"}</script>',
    );
  });

  it('escapes every < , so a page string cannot end the element it sits in', () => {
    const island = contents(dataScript({ sizes: '</script><script>alert(1)</script>' }));

    expect(island).not.toContain('<');
    expect(island).toContain('\\u003c');
  });

  it('escapes the comment opener as well, which ends no tag and still breaks out', () => {
    expect(contents(dataScript({ sizes: '<!--' }))).not.toContain('<');
  });

  it('hands the string back exactly, because escaping a < inside JSON changes nothing', () => {
    const sizes = '100vw" onload="alert(1)</script><!--<script>';

    const read = JSON.parse(contents(dataScript({ sizes }))) as { sizes: string };

    expect(read.sizes).toBe(sizes);
  });

  it('escapes a > too, so no run of characters is left to close a comment', () => {
    expect(contents(dataScript({ sizes: '-->' }))).toBe('{"sizes":"--\\u003e"}');
  });
});
