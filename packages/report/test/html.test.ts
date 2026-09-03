import { describe, expect, it } from 'vitest';
import { html } from '../src/html.js';

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
