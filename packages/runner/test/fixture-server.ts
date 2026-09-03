import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { encodePng } from './png.js';

/** One request the fixture server answered, for a test that counts them. */
export type FixtureRequest = { path: string; cacheControl: string | undefined };

export type FixtureServer = {
  /** Origin the tests point a browser at, on an ephemeral port. */
  url: string;
  /** Every request in arrival order. A test may empty it to start counting. */
  requests: FixtureRequest[];
  close: () => Promise<void>;
};

const shell = (title: string, body: string): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { margin: 0 }
  img { display: block }
  .hero { width: 100%; height: auto }
  .half { width: 50%; height: auto }
  .logo { width: 120px; height: auto }
  .pixel { width: 1px; height: 1px }
  .hidden { display: none }
  .third { width: 33.33%; height: auto }
</style>
</head>
<body>
${body}
</body>
</html>
`;

/**
 * A 1920 pixel image inlined into the markup, so it reaches the page without
 * a transfer of its own.
 */
const DATA_URL = `data:image/png;base64,${encodePng(1920, 2).toString('base64')}`;

/**
 * Deterministic pages with known `srcset` values. Every asset is served from
 * this server, so no test makes an external request.
 */
const PAGES: Record<string, string> = {
  // The two images at the top are the ones a visual tool would drop: a 1×1
  // tracking pixel and an image the page never shows. Both were still asked
  // for, so both are still bytes on the wire.
  '/w-descriptors.html': shell(
    'w descriptors',
    `<img class="pixel" src="/img/1.png" alt="">
<img class="hidden" src="/img/100.png" alt="">
<header><img class="logo" src="/img/640.png" loading="lazy" alt="logo"></header>
<main><img class="hero" sizes="100vw"
  srcset="/img/640.png 640w, /img/1080.png 1080w, /img/1920.png 1920w"
  src="/img/640.png" alt="hero"></main>`,
  ),

  '/media-clauses.html': shell(
    'media clauses',
    `<main><img class="half" sizes="(min-width: 1000px) 50vw, 100vw"
  srcset="/img/640.png 640w, /img/1080.png 1080w, /img/1920.png 1920w"
  src="/img/640.png" alt="hero"></main>`,
  ),

  // Candidates written relative to the page, so the base a trace resolves them
  // against decides whether they land. Reached through the redirect below.
  '/nested/': shell(
    'relative candidates',
    `<main><img class="hero" sizes="100vw"
  srcset="img/640.png 640w, img/1080.png 1080w, img/1920.png 1920w"
  src="img/640.png" alt="hero"></main>`,
  ),

  '/no-srcset.html': shell(
    'no srcset',
    `<main><img class="hero" src="/img/1080.png" alt="hero"></main>`,
  ),

  '/no-images.html': shell('no images', `<main><p>Nothing to measure here.</p></main>`),

  // `sizes` is on the tag and the browser must ignore it, because nothing here
  // carries a `w` descriptor.
  '/x-descriptors.html': shell(
    'x descriptors',
    `<main><img class="logo" sizes="100vw" srcset="/img/640.png 1x, /img/1080.png 2x"
  src="/img/640.png" alt="logo"></main>`,
  ),

  // One candidate per density in the default set, so `currentSrc` names the
  // `deviceScaleFactor` the context ran with. Nothing but DPR decides here.
  '/densities.html': shell(
    'densities',
    `<main><img class="logo"
  srcset="/img/100.png 1x, /img/200.png 2x, /img/262.png 2.625x, /img/300.png 3x"
  src="/img/100.png" alt="logo"></main>`,
  ),

  // The narrow renders move the hero into a wrapper, the way a responsive
  // layout swaps a stacked shell in. Same element, same `srcset`, different DOM
  // path — which is the case an id derived from the path alone cannot survive.
  '/reparent.html': shell(
    'reparent',
    `<nav><img class="logo" srcset="/img/100.png 1x, /img/200.png 2x"
  src="/img/100.png" alt="logo"></nav>
<main><img class="hero" sizes="100vw"
  srcset="/img/640.png 640w, /img/1080.png 1080w, /img/1920.png 1920w"
  src="/img/640.png" alt="hero"></main>
<script>
  if (window.matchMedia('(max-width: 700px)').matches) {
    const hero = document.querySelector('.hero');
    const stack = document.createElement('div');
    hero.parentElement.appendChild(stack);
    stack.appendChild(hero);
  }
</script>`,
  ),

  // Two elements asking for one URL. Blink's per-render memory cache answers
  // the second from the first, so one response has to account for both rows.
  '/shared-url.html': shell(
    'shared url',
    `<main><img class="half" src="/img/640.png" alt="one">
<img class="third" src="/img/640.png" alt="two"></main>`,
  ),

  // Two images whose weight no protocol event can report. The first carries
  // its bytes inside the document, so it makes no transfer of its own; the
  // second names a port Chromium refuses, so its request never finishes.
  // Both have pixels to be tempted by, and the first has 1920 of them.
  '/unknown-bytes.html': shell(
    'unknown bytes',
    `<main><img class="logo" src="${DATA_URL}" alt="inline">
<img class="logo" src="http://127.0.0.1:1/img/640.png" alt="refused"></main>`,
  ),

  // Three images with three different reasons to pick a file: `w` descriptors
  // under a media clause, `x` descriptors, and no choice at all.
  '/gallery.html': shell(
    'gallery',
    `<header><img class="logo" src="/img/640.png" loading="lazy" alt="logo"></header>
<main><img class="half" sizes="(min-width: 1000px) 50vw, 100vw"
  srcset="/img/640.png 640w, /img/1080.png 1080w, /img/1920.png 1920w"
  src="/img/640.png" alt="hero">
<img class="third" srcset="/img/200.png 1x, /img/300.png 2x"
  src="/img/200.png" alt="badge"></main>`,
  ),
};

/** A missing trailing slash, the plainest redirect a real host performs. */
const REDIRECTS: Record<string, string> = {
  '/nested': '/nested/',
};

/**
 * A page whose image comes from somewhere else, which is what an image CDN is.
 *
 * The other origin is a second fixture server on its own ephemeral port —
 * `127.0.0.1:A` and `127.0.0.1:B` are different origins — and no port is known
 * until that server listens. So this page is generated per request from the
 * `origin` query parameter rather than held in `PAGES`.
 *
 * The image server sends no `Timing-Allow-Origin`, exactly as an image CDN
 * does not, which is what makes the in-page timing API report zero for it.
 */
const crossOriginPage = (origin: string): string =>
  shell(
    'cross origin',
    `<main><img class="hero" sizes="100vw"
  srcset="${origin}/img/640.png 640w, ${origin}/img/1080.png 1080w, ${origin}/img/1920.png 1920w"
  src="${origin}/img/640.png" alt="hero"></main>`,
  );

/** Another loopback fixture server, and nothing else, may name the origin. */
const PEER_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;

export async function startFixtureServer(): Promise<FixtureServer> {
  const requests: FixtureRequest[] = [];

  const server = createServer((req, res) => {
    const requested = new URL(req.url ?? '/', 'http://fixture.invalid');
    const path = requested.pathname;
    requests.push({ path, cacheControl: req.headers['cache-control'] });

    if (path === '/cross-origin.html') {
      const origin = requested.searchParams.get('origin') ?? '';
      if (PEER_ORIGIN.test(origin)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(crossOriginPage(origin));
        return;
      }
    }

    const redirect = REDIRECTS[path];
    if (redirect !== undefined) {
      res.writeHead(302, { location: redirect });
      res.end();
      return;
    }

    const page = PAGES[path];
    if (page !== undefined) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page);
      return;
    }

    // Every page's images sit in an `img/` directory beside it, so a nested
    // page can name them relatively.
    const image = /\/img\/(\d+)\.png$/.exec(path);
    if (image) {
      const width = Number(image[1]);
      const body = encodePng(width, 2);
      // The header a real image CDN sends. It is what makes a browser hold a
      // copy, so a run that still fetches has genuinely bypassed its cache.
      //
      // What is deliberately absent is `Timing-Allow-Origin`, which an image
      // CDN also does not send. Served to another origin, this response is one
      // the in-page timing API reports as zero bytes.
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(body.length),
        'cache-control': 'public, max-age=31536000, immutable',
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
