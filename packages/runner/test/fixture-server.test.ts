import { describe, expect, it } from 'vitest';
import { startFixtureServer } from '../../../test/fixture-server.js';

describe('the fixture server', () => {
  it('serves a page and real image bytes on an ephemeral port', async () => {
    const server = await startFixtureServer();
    try {
      expect(new URL(server.url).port).not.toBe('');

      const page = await fetch(new URL('/w-descriptors.html', server.url));
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('srcset');

      const image = await fetch(new URL('/img/1080.png', server.url));
      expect(image.headers.get('content-type')).toBe('image/png');
      const bytes = new Uint8Array(await image.arrayBuffer());
      expect(Array.from(bytes.subarray(1, 4), (b) => String.fromCharCode(b)).join('')).toBe('PNG');
    } finally {
      await server.close();
    }
  });

  it('releases the port on close, so no test leaks a listening socket', async () => {
    const server = await startFixtureServer();
    const url = server.url;
    await server.close();

    await expect(fetch(new URL('/w-descriptors.html', url))).rejects.toThrow();
  });
});
