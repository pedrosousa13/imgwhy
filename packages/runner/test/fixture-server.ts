import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { encodePng } from './png.js';

export type FixtureServer = {
  /** Origin the tests point a browser at, on an ephemeral port. */
  url: string;
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
</style>
</head>
<body>
${body}
</body>
</html>
`;

/**
 * Deterministic pages with known `srcset` values. Every asset is served from
 * this server, so no test makes an external request.
 */
const PAGES: Record<string, string> = {
  '/w-descriptors.html': shell(
    'w descriptors',
    `<img class="pixel" src="/img/1.png" alt="">
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

  // `sizes` is on the tag and the browser must ignore it, because nothing here
  // carries a `w` descriptor.
  '/x-descriptors.html': shell(
    'x descriptors',
    `<main><img class="logo" sizes="100vw" srcset="/img/640.png 1x, /img/1080.png 2x"
  src="/img/640.png" alt="logo"></main>`,
  ),
};

/** A missing trailing slash, the plainest redirect a real host performs. */
const REDIRECTS: Record<string, string> = {
  '/nested': '/nested/',
};

export async function startFixtureServer(): Promise<FixtureServer> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://fixture.invalid').pathname;

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
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(body.length) });
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
