import type { CDPSession } from 'playwright';

/** What one render's responses cost, by the URL the page asked for. */
export type TransferLog = {
  /**
   * The bytes that arrived for `url`, or null where none did.
   *
   * Null is unknown and stays unknown. Nothing here derives a size from
   * anything but a size the protocol reported.
   */
  bytesFor: (url: string) => number | null;
  /**
   * The URLs of the requests that have started and neither finished nor
   * failed, in the order the page asked for them.
   *
   * What it is for is waiting. A run that scrolls a page to trigger its lazy
   * loads has to know when those loads are done before it reads the page, and
   * this is the only account of that there is — and where the wait gives up,
   * these are the URLs it never got, which is what a failure has to say.
   *
   * A redirect chain is one entry, under the first URL, for the reason
   * `bytesFor` keeps the first one: that is the URL `currentSrc` will hold.
   */
  pending: () => string[];
};

/** A request the page started, until it either finishes or does not. */
type Started = {
  /** The URL the page asked for, which is the one `currentSrc` holds. */
  url: string;
  /** Whether the response is still expected to come off the network. */
  overTheWire: boolean;
  /** Whether the protocol has yet said this request finished or failed. */
  outstanding: boolean;
};

/**
 * Record what every response cost, off the DevTools Protocol.
 *
 * This is why the tool drives a browser rather than running inside one.
 * `PerformanceResourceTiming.transferSize` is zero for a cross-origin
 * response that sends no `Timing-Allow-Origin`, and an image CDN does not
 * send it, so an in-page tool cannot report real weight. The protocol reports
 * `encodedDataLength` for every origin, headers included.
 *
 * The session must already have `Network.enable` sent on it, and the listeners
 * must be in place before the page navigates, or the responses go unseen.
 *
 * ## How a response finds its image
 *
 * By URL. An image's `currentSrc` is the URL it actually fetched, and one URL
 * is one resource, so the URL is the join. Three events carry what that needs:
 *
 * - `Network.requestWillBeSent` names the URL. The first one for a request id
 *   is the URL the page asked for; a redirect reuses the id, and the hops
 *   after the first carry a URL that no `currentSrc` holds.
 * - `Network.requestServedFromCache` says the response came out of a cache, so
 *   no bytes crossed the wire for it. Chromium reports this for a memory-cache
 *   hit and leaves `Response.fromDiskCache` false, which is why this event is
 *   the signal read rather than that field.
 * - `Network.loadingFinished` carries `encodedDataLength`.
 * - `Network.loadingFailed` says the request came back with nothing. It leaves
 *   no size behind, and it is read for the sake of `pending`: without it a
 *   request that errored stays outstanding forever, and every run on a page
 *   with one broken image waits out the whole of its settle bound.
 *
 * `Network.requestServedFromCache` is deliberately not one of the two events
 * that end a request. Chromium still sends `Network.loadingFinished` for a
 * cached response, carrying zero, so the cache event arrives while the request
 * is still going — clearing on it would drop a request before it completed.
 *
 * ## What the mapping cannot do
 *
 * **Tell two images on one URL apart.** Two `<img>` asking for the same URL in
 * one document are one request — Blink's per-render memory cache, which
 * `Network.setCacheDisabled` does not reach, and the browser behaviour under
 * study rather than a cache to defeat. Both images then carry what that one
 * response cost, because that is what each of them weighs, and adding the
 * column up over a page counts those bytes once per element.
 *
 * **Report a size for a response that never crossed the wire.** A request that
 * failed sends no `Network.loadingFinished`. A cached response sends one
 * carrying zero, and a zero would read as a measurement rather than as the
 * absence of one. A `data:` URL is the same case: its bytes came inside the
 * document, so it made no transfer of its own. All three are unknown.
 */
export function recordTransfers(session: CDPSession): TransferLog {
  const started = new Map<string, Started>();
  const bytesByUrl = new Map<string, number>();

  // A redirect reuses one request id, so the guard keeps the first URL — and
  // with it, the chain counts as the one pending entry it is.
  session.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (!started.has(requestId)) {
      started.set(requestId, { url: request.url, overTheWire: true, outstanding: true });
    }
  });

  session.on('Network.requestServedFromCache', ({ requestId }) => {
    const request = started.get(requestId);
    if (request) request.overTheWire = false;
  });

  session.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const request = started.get(requestId);
    if (!request) return;
    request.outstanding = false;
    if (request.overTheWire) bytesByUrl.set(request.url, encodedDataLength);
  });

  session.on('Network.loadingFailed', ({ requestId }) => {
    const request = started.get(requestId);
    if (request) request.outstanding = false;
  });

  return {
    bytesFor: (url) => bytesByUrl.get(url) ?? null,
    pending: () =>
      [...started.values()].filter((request) => request.outstanding).map((request) => request.url),
  };
}
