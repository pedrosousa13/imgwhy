import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type FixtureServer, startFixtureServer } from '../../../test/fixture-server.js';

const execFileAsync = promisify(execFile);
const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

/**
 * `--report`, end to end and then opened.
 *
 * This is the one check the report package cannot make for itself. Its own
 * tests read the emitted HTML and prove that nothing in it names a host —
 * which is a claim about the text. The claim the design actually makes is
 * about a browser: the file "opens correctly from disk, makes zero network
 * requests, and renders the same in a browser that has never seen the site".
 * Only a browser can answer that, and the report package must never depend on
 * one, so the check lives with the command that writes the file.
 *
 * Zero requests is observed twice over, from both ends. The browser reports
 * every request it makes, and the fixture server reports every request it
 * receives — so a request the page made to the site it describes would have to
 * escape both a listener and a log to pass.
 */
let server: FixtureServer;
let browser: Browser;
let dir: string;

beforeAll(async () => {
  expect(existsSync(bin), `${bin} is missing — run \`npm run build\` first`).toBe(true);
  server = await startFixtureServer();
  browser = await chromium.launch();
  dir = mkdtempSync(join(tmpdir(), 'imgwhy-report-'));
});
afterAll(async () => {
  await browser.close();
  await server.close();
});

/** Runs in `dir`, which is where the command looks for `imgwhy.config.json`. */
const imgwhy = (...args: string[]): Promise<{ stdout: string; stderr: string }> =>
  execFileAsync(process.execPath, [bin, ...args], { cwd: dir });

describe('imgwhy --report', () => {
  it('writes one self-contained HTML file that a browser opens with no network at all', async () => {
    const url = `${server.url}/gallery.html`;
    const path = join(dir, 'report.html');

    const ran = await imgwhy('--report', path, url);

    expect(ran.stderr).toBe('');
    // The trace still goes to stdout: the report is another sink, not a mode.
    expect(ran.stdout).toContain('image 2 of 3');

    // One file, no sidecar assets. Every style is inside the document.
    expect(readdirSync(dir)).toEqual(['report.html']);
    // Not named `document`: the page's own `document` is what the evaluate
    // below reaches for, and a local of that name would shadow it.
    const emitted = readFileSync(path, 'utf8');
    expect(emitted.startsWith('<!doctype html>')).toBe(true);
    expect(emitted).toContain('<style>');

    // A context that has never seen the site: a fresh one, and the run above
    // was a different browser process entirely.
    const context = await browser.newContext();
    const page = await context.newPage();
    const asked: string[] = [];
    page.on('request', (request) => asked.push(request.url()));
    page.on('requestfailed', (request) => asked.push(`failed ${request.url()}`));

    // Everything the fixture server was asked for during the run above is
    // already logged, so the count starts here.
    server.requests.length = 0;

    const file = pathToFileURL(path).href;
    await page.goto(file);
    await page.waitForLoadState('load');

    // The document itself, and nothing else — no stylesheet, no font, no
    // image, and nothing at all from the site the report is about.
    expect(asked).toEqual([file]);
    expect(server.requests).toEqual([]);

    // And it rendered: three images, five devices, laid out as a table.
    expect(await page.locator('table tbody tr').count()).toBe(3);
    expect(await page.locator('table thead th').count()).toBe(6);
    const box = await page.locator('table').boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);

    // The hero row, as the browser reads it back out of the matrix.
    const hero = page.locator('tbody tr').nth(1);
    expect(await hero.locator('th .id').textContent()).toBe(
      'html > body > main > img:nth-of-type(1)',
    );
    expect(await hero.locator('td .picked').allTextContents()).toEqual([
      '1080w',
      '1920w',
      '1920w',
      '1920w',
      '1080w',
    ]);

    // The logo had nothing to choose, and says so.
    const logo = page.locator('tbody tr').nth(0);
    expect(await logo.locator('td .picked').allTextContents()).toEqual(['—', '—', '—', '—', '—']);

    // What every response cost, on every device — for the two images the load
    // event waited for. The logo is the third, and it is `loading=lazy`: the
    // load event does not wait for one of those, so a render can finish with
    // it still in flight and no transfer size recorded for it, which reads as
    // a genuine unknown rather than as a zero. So the strong claim is scoped
    // to the eager images, the way `bin.test.ts` scopes the same claim, and a
    // no-srcset image whose bytes *were* recorded is checked in the report
    // package, where a Capture is written rather than measured.
    for (const eager of [1, 2]) {
      const row = page.locator('tbody tr').nth(eager);
      const bytes = await row.locator('td .bytes').allTextContents();

      expect(bytes).toHaveLength(5);
      for (const cell of bytes) expect(cell).toMatch(/^\d+ bytes$/);
    }

    // A system font, resolved by the browser rather than fetched.
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(font).toContain('-apple-system');

    await context.close();
  }, 60_000);

  it('reports a page with no image as a page with no image, and still writes the file', async () => {
    const path = join(dir, 'empty.html');

    // The artifact was asked for and produced, so the run did its job — an
    // image that has gone missing from a page is the diff a kept report is
    // for. The trace is the one output with nothing to say, and it says so.
    const ran = await imgwhy('--report', path, `${server.url}/no-images.html`);

    expect(ran.stdout).toBe('');
    expect(ran.stderr).toContain('carries no <img> element');

    const context = await browser.newContext();
    const page = await context.newPage();
    const asked: string[] = [];
    page.on('request', (request) => asked.push(request.url()));
    server.requests.length = 0;

    const file = pathToFileURL(path).href;
    await page.goto(file);

    expect(asked).toEqual([file]);
    expect(server.requests).toEqual([]);
    expect(await page.locator('.empty').textContent()).toContain('carries no <img> element');

    await context.close();
  }, 60_000);

  it('reads a weight nothing recorded as unknown, in the browser as in the file', async () => {
    const path = join(dir, 'unknown.html');

    // One image carries its bytes inside the document and the other names a
    // port Chromium refuses, so no protocol event reports a size for either.
    // Both have pixels to be tempted by, and the first has 1920 of them.
    await imgwhy('--report', path, `${server.url}/unknown-bytes.html`);

    const context = await browser.newContext();
    const page = await context.newPage();
    const asked: string[] = [];
    page.on('request', (request) => asked.push(request.url()));
    server.requests.length = 0;

    const file = pathToFileURL(path).href;
    await page.goto(file);

    expect(asked).toEqual([file]);
    expect(server.requests).toEqual([]);
    const bytes = await page.locator('tbody .bytes').allTextContents();
    expect(bytes.length).toBeGreaterThan(0);
    expect([...new Set(bytes)]).toEqual(['unknown']);

    await context.close();
  }, 60_000);
});
