import { describe, expect, it } from 'vitest';
import { parsePageUrl } from '../src/url.js';

describe('parsePageUrl', () => {
  it('accepts an http URL', () => {
    expect(parsePageUrl('http://127.0.0.1:8080/page.html')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:8080/page.html',
    });
  });

  it('accepts an https URL and keeps its query', () => {
    expect(parsePageUrl('https://example.com/a?b=1')).toEqual({
      ok: true,
      url: 'https://example.com/a?b=1',
    });
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(document.cookie)',
    'data:text/html,<script>1</script>',
    'ftp://example.com/x.png',
    'chrome://settings',
    'view-source:https://example.com',
  ])('refuses %s, because only http and https may be opened', (raw) => {
    const result = parsePageUrl(raw);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('http:');
  });

  it('refuses a string that is not a URL at all', () => {
    const result = parsePageUrl('example.com');

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('example.com');
  });

  it('refuses an empty argument', () => {
    expect(parsePageUrl('').ok).toBe(false);
  });
});
