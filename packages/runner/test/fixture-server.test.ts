import { get } from 'node:http';
import { setTimeout as after } from 'node:timers/promises';
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

  it('releases the port on close with a response it never ended still open', async () => {
    const server = await startFixtureServer();
    const url = server.url;

    // `/held-open.png` writes its headers and never a body, which is the whole
    // point of it: the settle-bound test needs a request that stays in flight.
    // A connection like that is also the one thing that keeps `server.close()`
    // waiting — it resolves when the last connection ends, and this one never
    // does — so `closeAllConnections()` is what makes the close finish at all.
    // Nothing else here holds a socket open, so without this the claim above
    // is only ever tested against a server that had already gone quiet.
    // `get` rather than `fetch`, and an outcome rather than a rejection: what
    // this has to watch is a request that never gets an answer, and a promise
    // that never settles is not something a test can assert on. Both endings
    // resolve it, so the assertion below names the one that happened.
    const held = new Promise<string>((resolve) => {
      const asking = get(`${url}/held-open.png`, () => resolve('the server answered'));
      asking.on('error', () => resolve('the connection was torn down'));
    });
    // What says the request is on the wire is the server having logged it.
    // There is nothing else to wait for: Node holds a response's headers until
    // something writes a body, and this handler writes none.
    while (!server.requests.some((request) => request.path === '/held-open.png')) {
      await after(10);
    }

    await server.close();

    await expect(fetch(new URL('/w-descriptors.html', url))).rejects.toThrow();
    // And the held request ended rather than hanging on, because the socket
    // under it was torn down rather than left for the client to time out.
    expect(await held).toBe('the connection was torn down');
  });
});
