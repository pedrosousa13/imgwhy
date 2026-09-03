import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordTransfers } from '../src/transfers.js';
import { type FixtureServer, startFixtureServer } from '../../../test/fixture-server.js';

let server: FixtureServer;
beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

describe('recordTransfers', () => {
  it('records no size for a response the browser answered out of its cache', async () => {
    const browser = await chromium.launch();
    try {
      const page = `${server.url}/no-srcset.html`;
      const image = `${server.url}/img/1080.png`;
      const context = await browser.newContext();
      const rendering = await context.newPage();
      const session = await context.newCDPSession(rendering);
      await session.send('Network.enable');

      // The cache is left on here, which `capturePage` never does, because a
      // cache hit is the case this has to get right. The fixture serves its
      // images `immutable` for a year, so the second render answers from the
      // cache — and the protocol then reports zero bytes for a file that
      // plainly is not zero bytes. A second log starts before that render, so
      // it sees the cached response and nothing else.
      const overTheWire = recordTransfers(session);
      await rendering.goto(page, { waitUntil: 'load' });
      const fromCache = recordTransfers(session);
      await rendering.goto(page, { waitUntil: 'load' });

      // The arrangement: the first render did cross the wire for this URL.
      expect(overTheWire.bytesFor(image)).toBeGreaterThan(0);
      // Zero is not a size, so the cached response left no size behind, and
      // did not overwrite the one that was measured either.
      expect(fromCache.bytesFor(image)).toBeNull();
      expect(overTheWire.bytesFor(image)).toBeGreaterThan(0);

      await session.detach();
    } finally {
      await browser.close();
    }
  }, 60_000);
});
