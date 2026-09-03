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
};

/** A request the page started, until it either finishes or does not. */
type Started = {
  /** The URL the page asked for, which is the one `currentSrc` holds. */
  url: string;
  /** Whether the response is still expected to come off the network. */
  overTheWire: boolean;
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

  session.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (!started.has(requestId)) started.set(requestId, { url: request.url, overTheWire: true });
  });

  session.on('Network.requestServedFromCache', ({ requestId }) => {
    const request = started.get(requestId);
    if (request) request.overTheWire = false;
  });

  session.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const request = started.get(requestId);
    if (request?.overTheWire) bytesByUrl.set(request.url, encodedDataLength);
  });

  return { bytesFor: (url) => bytesByUrl.get(url) ?? null };
}
