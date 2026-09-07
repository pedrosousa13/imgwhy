import { type CDPSession, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordTransfers } from '../src/transfers.js';
import { type FixtureServer, startFixtureServer } from '../../../test/fixture-server.js';

/**
 * A session that emits protocol events and answers nothing, so a test can send
 * the three events that decide whether a request is still outstanding.
 *
 * A browser is what the other test here drives, and for `bytesFor` that is the
 * only honest arrangement: the figure has to come off a real response. Pending
 * is different. It is a state that exists between two events, and a browser
 * emits both of them within a millisecond of each other with nothing in
 * between for a test to read — so a run that watched a real page could only
 * ever observe the state it happened to catch. The cache case is worse: the
 * event that must *not* clear pending arrives on the same request as the one
 * that must, so no real render can separate them.
 *
 * `recordTransfers` reads nothing off the session but `on`, which is what makes
 * this stand in for one at all.
 */
function fakeSession(): { session: CDPSession; emit: (event: string, payload: unknown) => void } {
  const listeners = new Map<string, ((payload: never) => void)[]>();
  const session = {
    on: (event: string, listener: (payload: never) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return session;
    },
  } as unknown as CDPSession;

  return {
    session,
    emit: (event, payload) => {
      for (const listener of listeners.get(event) ?? []) listener(payload as never);
    },
  };
}

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

describe('what recordTransfers reports as still outstanding', () => {
  const URL = 'http://127.0.0.1:1/img/640.png';
  const started = { requestId: '1', request: { url: URL } };

  it('names a request that has started and not yet come back', () => {
    const { session, emit } = fakeSession();
    const log = recordTransfers(session);

    expect(log.pending()).toEqual([]);
    emit('Network.requestWillBeSent', started);

    expect(log.pending()).toEqual([URL]);
  });

  it('drops a request the protocol says finished loading', () => {
    const { session, emit } = fakeSession();
    const log = recordTransfers(session);

    emit('Network.requestWillBeSent', started);
    emit('Network.loadingFinished', { requestId: '1', encodedDataLength: 1_234 });

    expect(log.pending()).toEqual([]);
    // Finishing is still what records the size. Pending is a second reading of
    // the same events, not a replacement for the first.
    expect(log.bytesFor(URL)).toBe(1_234);
  });

  it('drops a request the protocol says failed, so one broken image ends no wait', () => {
    const { session, emit } = fakeSession();
    const log = recordTransfers(session);

    emit('Network.requestWillBeSent', started);
    emit('Network.loadingFailed', { requestId: '1', errorText: 'net::ERR_UNSAFE_PORT' });

    expect(log.pending()).toEqual([]);
    // A request that failed transferred nothing anyone can report.
    expect(log.bytesFor(URL)).toBeNull();
  });

  it('keeps a request served from cache, which is the event that looks done', () => {
    const { session, emit } = fakeSession();
    const log = recordTransfers(session);

    emit('Network.requestWillBeSent', started);
    emit('Network.requestServedFromCache', { requestId: '1' });

    // The negative control. Chromium sends `Network.loadingFinished` for a
    // cached response too, so this event arrives before the request is done
    // and clearing on it would drop a request that is still in flight.
    expect(log.pending()).toEqual([URL]);

    emit('Network.loadingFinished', { requestId: '1', encodedDataLength: 0 });

    expect(log.pending()).toEqual([]);
    // And it is still the cache event that decides there is no size to report.
    expect(log.bytesFor(URL)).toBeNull();
  });

  it('counts a redirect chain as the one request it is, under the first URL', () => {
    const { session, emit } = fakeSession();
    const log = recordTransfers(session);

    emit('Network.requestWillBeSent', started);
    emit('Network.requestWillBeSent', {
      requestId: '1',
      request: { url: 'http://127.0.0.1:1/img/1080.png' },
    });

    expect(log.pending()).toEqual([URL]);
  });
});
