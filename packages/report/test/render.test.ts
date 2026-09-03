import type { Capture } from '@imgwhy/core';
import { coreSource, explainSelection } from '@imgwhy/core';
import { describe, expect, it } from 'vitest';
import { renderReport } from '../src/index.js';
import { DEVICES, badge, gallery, hero, logo, on, painting, sourced } from './capture.js';

/** The `<td>` cells of the row whose header holds `id`, in device order. */
const cellsOf = (report: string, id: string): string[] => {
  const rows = report.split('<tr');
  const row = rows.find((one) => one.includes(id));
  if (!row) throw new Error(`no row for ${id} in\n${report}`);
  return [...row.matchAll(/<td[^>]*>.*?<\/td>/g)].map((match) => match[0]);
};

/** The `<th class="image">` of the row whose heading holds `id`. */
const headOf = (report: string, id: string): string => {
  const heads = [...report.matchAll(/<th class="image"[\s\S]*?<\/th>/g)].map((match) => match[0]);
  const head = heads.find((one) => one.includes(id));
  if (!head) throw new Error(`no row heading for ${id} in\n${report}`);
  return head;
};

/** The one block per distinct offer a row heading writes, where it writes any. */
const offersIn = (head: string): string[] => head.split('<div class="offer">').slice(1);

/** The `<section class="panel">` whose heading holds `id`. */
const panelOf = (report: string, id: string): string => {
  const [, ...panels] = report.split('<section class="panel">');
  const panel = panels.find((one) => one.includes(id));
  if (!panel) throw new Error(`no panel for ${id} in\n${report}`);
  return panel;
};

/** The text of the JSON island, which is the only page data the script reads. */
const islandOf = (report: string): string =>
  /<script type="application\/json">([\s\S]*?)<\/script>/.exec(report)?.[1] ?? '';

describe('renderReport', () => {
  it('emits one whole HTML document', () => {
    const report = renderReport(gallery());

    expect(report.startsWith('<!doctype html>')).toBe(true);
    expect(report.trimEnd().endsWith('</html>')).toBe(true);
    expect(report).toContain('<meta charset="utf-8">');
  });

  it('names the page it measured and when', () => {
    const report = renderReport(gallery());

    expect(report).toContain('<title>imgwhy — https://example.com/gallery</title>');
    expect(report).toContain('2026-09-03T00:00:00.000Z');
    expect(report).toContain('3 images on 5 devices');
  });

  it('gives every device profile a column, named with its viewport and ratio', () => {
    const report = renderReport(gallery());

    for (const device of DEVICES) {
      expect(report).toContain(
        `<th class="device" scope="col"><span class="name">${device.name}</span>` +
          `<span class="profile">${device.viewport.width}×${device.viewport.height} · DPR ${device.dpr}</span></th>`,
      );
    }
  });

  it('gives every image a row, keyed by the id that holds across runs', () => {
    const report = renderReport(gallery());

    expect(report).toContain('html &gt; body &gt; header &gt; img');
    expect(report).toContain('html &gt; body &gt; main &gt; img:nth-of-type(1)');
    expect(report).toContain('html &gt; body &gt; main &gt; img:nth-of-type(2)');
  });

  it('names the candidate picked and the bytes that arrived in one cell', () => {
    const report = renderReport(gallery());

    expect(cellsOf(report, 'nth-of-type(1)')[0]).toBe(
      '<td><span class="picked">1080w</span><span class="bytes">118231 bytes</span></td>',
    );
  });

  it('picks a different candidate per device, which is the point of the matrix', () => {
    const report = renderReport(gallery());

    expect(cellsOf(report, 'nth-of-type(1)').map((cell) => /picked">([^<]*)</.exec(cell)?.[1])).toEqual(
      ['1080w', '1920w', '1920w', '1920w', '1080w'],
    );
  });

  it('reads a null transferBytes as unknown, and never as a number', () => {
    const report = renderReport(gallery());

    // The logo carries no recorded transfer on any device.
    for (const cell of cellsOf(report, 'header &gt; img')) {
      expect(cell).toContain('<span class="bytes">unknown</span>');
    }
  });

  it('reports the bytes of an image nothing selected, because they still arrived', () => {
    // A file no candidate list chose still crossed the wire, and a 1×1
    // tracking pixel weighs what it weighs. The command's browser test cannot
    // hold this claim: the only image on its fixture page with nothing to
    // choose is `loading=lazy`, and nothing waits for one of those, so the
    // weight it reports is not the same on every run. A Capture written here
    // is, which is what makes this the place for it.
    const weighed = on(gallery(), 'desktop', [
      { ...logo(), transferBytes: 3204 },
      hero(720, '1080.png', 118_231),
      badge('200.png', 4102),
    ]);

    expect(cellsOf(renderReport(weighed), 'header &gt; img')[4]).toBe(
      '<td><span class="picked">—</span><span class="bytes">3204 bytes</span></td>',
    );
  });

  it('says nothing was selected for an image with no srcset', () => {
    const report = renderReport(gallery());

    expect(cellsOf(report, 'header &gt; img')[0]).toBe(
      '<td><span class="picked">—</span><span class="bytes">unknown</span></td>',
    );
  });

  it('lists what an image offered once, in its row header', () => {
    const report = renderReport(gallery());

    expect(report).toContain(
      '<li><span class="raw">1080w</span><span class="url">/i/1080.png</span></li>',
    );
    expect(report).toContain('<span class="sizes">sizes (min-width: 1000px) 50vw, 100vw</span>');
    expect(report).toContain('<span class="sizes">sizes absent</span>');
    expect(report).toContain('<span class="none">no srcset</span>');
  });

  it('names no device in a row heading where every device was offered the same markup', () => {
    // The rule the command's trace keeps: agreement is written once and names
    // no device, so the four devices that differ nowhere read as they always
    // did and the images that do differ are the ones that stand out.
    const report = renderReport(gallery());

    expect(report).not.toContain('class="offer"');
    expect(report).not.toContain('class="on"');
  });

  it('names the devices where a picture put a different offer in front of each', () => {
    // Desktop resolved the hero against a `<source>` whose `media` matched,
    // which carries its own candidates and its own `sizes`; the four narrower
    // devices fell through to the `<img>`. One heading for the row would be
    // one device's markup written over the other four's — and the first
    // sighting is the narrowest device, so it would be the `<img>`'s.
    const differing = on(gallery(), 'desktop', [
      logo(),
      sourced(720, '1080.png', 118_231),
      badge('200.png', 4102),
    ]);

    const offers = offersIn(headOf(renderReport(differing), 'nth-of-type(1)'));

    expect(offers).toHaveLength(2);
    expect(offers[0]).toContain(
      '<span class="on">on iPhone SE, iPhone 15 Pro, Pixel 8, iPad</span>',
    );
    expect(offers[0]).toContain('<span class="sizes">sizes (min-width: 1000px) 50vw, 100vw</span>');
    expect(offers[0]).toContain('<span class="raw">640w</span>');
    expect(offers[1]).toContain('<span class="on">on Desktop</span>');
    // The `<source>` offers two files and the tag offers three, so the 640w
    // the block above holds is in this one nowhere.
    expect(offers[1]).not.toContain('<span class="raw">640w</span>');
    expect(offers[1]).toContain('<span class="raw">1920w</span>');
  });

  it('says a sizes string came off a matching source rather than off the img', () => {
    // Which element the browser read is the finding. The attribute a reader
    // finds on the tag is not the one that resolved, and a bare string in the
    // heading would send them to the wrong element to check it.
    const differing = on(gallery(), 'desktop', [
      logo(),
      sourced(720, '1080.png', 118_231),
      badge('200.png', 4102),
    ]);

    const offers = offersIn(headOf(renderReport(differing), 'nth-of-type(1)'));

    expect(offers[1]).toContain(
      '<span class="sizes">sizes 50vw, read off the matching &lt;source&gt; rather than ' +
        'the &lt;img&gt;</span>',
    );
  });

  it('marks an image the page asked the browser to defer', () => {
    const report = renderReport(gallery());

    expect(report).toContain('<span class="flag">loading=lazy</span>');
  });

  it('says a device did not render an image rather than leaving the cell blank', () => {
    const missing = on(gallery(), 'iphone-se', [logo(), badge('300.png', 8210)]);

    const report = renderReport(missing);

    expect(cellsOf(report, 'nth-of-type(1)')[0]).toBe('<td class="absent">not rendered</td>');
    expect(cellsOf(report, 'nth-of-type(1)')).toHaveLength(5);
  });

  it('renders a capture of a page with no image at all, which is a capture too', () => {
    const empty: Capture = { ...gallery(), runs: gallery().runs.map((r) => ({ ...r, images: [] })) };

    const report = renderReport(empty);

    expect(report).toContain('0 images on 5 devices');
    expect(report).toContain('carries no &lt;img&gt; element');
  });

  it('counts the CSS background images and says they select nothing', () => {
    const report = renderReport(painting(gallery(), [4, 4, 4, 4, 4]));

    expect(report).toContain(
      '<dt>backgrounds</dt><dd>4 background images. A CSS background image has no selection ' +
        'mechanism at all, so imgwhy counts them and explains nothing further.</dd>',
    );
  });

  it('names the devices when a media query painted a different number on each', () => {
    // The count is a property of a render, not of a page, so one figure for
    // the whole capture would be a figure no device produced.
    const report = renderReport(painting(gallery(), [2, 2, 2, 2, 3]));

    expect(report).toContain(
      '<dd>2 background images on iPhone SE, iPhone 15 Pro, Pixel 8, iPad, ' +
        '3 background images on Desktop. A CSS background image',
    );
  });

  it('says one background image in the singular, because one is what it counted', () => {
    const report = renderReport(painting(gallery(), [1, 1, 1, 1, 1]));

    expect(report).toContain('<dd>1 background image. A CSS background image');
  });

  it('says nothing at all about backgrounds on a page whose CSS paints none', () => {
    // A line reading "0 background images" on every report would bury the
    // pages that have some.
    expect(renderReport(gallery())).not.toContain('background image');
  });

  it('states the framework limit the design names as a non-goal', () => {
    const report = renderReport(gallery());

    expect(report).toContain('candidates this page shipped');
    expect(report).toContain('understates the gain');
  });

  it('says what unknown means, so no reader reads it as zero', () => {
    const report = renderReport(gallery());

    expect(report).toContain('never guessed');
  });

  it('gives every image a panel, which is the detail behind a row of the matrix', () => {
    const report = renderReport(gallery());

    expect(report.match(/<section class="panel">/g)).toHaveLength(3);
    expect(report).toContain('<h3 class="id">html &gt; body &gt; main &gt; img:nth-of-type(1)</h3>');
  });

  it('shows the arithmetic in full, clause to winner, for the device it starts from', () => {
    // The hero on the first device that rendered it: iPhone SE, 375 at DPR 2.
    const report = renderReport(gallery());
    const panel = panelOf(report, 'nth-of-type(1)');

    expect(panel).toContain('<dd class="clause">100vw</dd>');
    expect(panel).toContain('<dd class="css">375px</dd>');
    expect(panel).toContain('<dd class="needed">750px</dd>');
    expect(panel).toContain('<dd class="picked">1080w</dd>');
    expect(panel).toContain(
      '<p class="reason">375 css px × DPR 2 = 750 physical pixels, and 1080w is the ' +
        'smallest candidate at or above that.</p>',
    );
  });

  it('lists the candidates in the panel and marks the one that won', () => {
    const panel = panelOf(renderReport(gallery()), 'nth-of-type(1)');

    expect(panel).toContain(
      '<li><span class="raw">1080w</span><span class="url">/i/1080.png</span>' +
        '<span class="mark">← picked</span></li>',
    );
    expect(panel).toContain(
      '<li><span class="raw">640w</span><span class="url">/i/640.png</span>' +
        '<span class="mark"></span></li>',
    );
  });

  it('names the device the panel starts from, so no number is unexplained', () => {
    // The candidate list is named as that render's too, and not as the page's.
    // A `<picture>` hands a different `<source>` to a different device, so the
    // list a panel lays out is the one this render was offered — the row
    // heading is where the offers are compared.
    expect(panelOf(renderReport(gallery()), 'nth-of-type(1)')).toContain(
      '<p class="from">Starts from iPhone SE: a 375 px viewport at DPR 2, and the candidates ' +
        'that render was offered.</p>',
    );
  });

  it('carries a control for the sizes string, the viewport width and the ratio', () => {
    const panel = panelOf(renderReport(gallery()), 'nth-of-type(1)');

    // A textarea and not an `<input type="text">`, because a text input runs a
    // sanitiser over its value that takes every newline out of it. A `sizes`
    // attribute written across lines would arrive in the control as a string
    // the page never had, and the first keystroke would re-pick against that
    // instead of against the measurement.
    expect(panel).toContain('<textarea class="sizes-input"></textarea>');
    expect(panel).toContain('<input class="viewport-input" type="number" min="1" step="1">');
    expect(panel).toContain('<input class="dpr-input" type="number" min="0.1" step="any">');
  });

  it('leaves every control empty in the markup, because no page string may reach an attribute', () => {
    // The `sizes` string a control starts from came off the page. It reaches
    // the page through the data island, as text a script reads, and never
    // through a `value` attribute — which is what keeps the closed list in
    // `escaping.test.ts` closed.
    expect(renderReport(gallery())).not.toContain('value=');
  });

  it('states the framework limit beside the controls, not only in the notes at the end', () => {
    const panel = panelOf(renderReport(gallery()), 'nth-of-type(1)');

    expect(panel).toContain('candidates this page shipped');
    expect(panel).toContain('understates the gain');
  });

  it('gives an image with nothing to choose a panel that says so, and no controls', () => {
    const panel = panelOf(renderReport(gallery()), 'header &gt; img');

    expect(panel).toContain('The page shipped no srcset, so there was nothing to select.');
    expect(panel).not.toContain('<input');
    expect(panel).not.toContain('<textarea');
  });

  it('shows the same four sums for an image with nothing to choose, rather than none', () => {
    // The design asks every panel for the clause, the CSS width, the pixels
    // needed and the winner. `readPanel` answers all four for an image with no
    // `srcset` — the answer is that there was nothing to resolve — and a panel
    // that dropped them would be hiding a reading it had already taken.
    const panel = panelOf(renderReport(gallery()), 'header &gt; img');

    expect(panel).toContain('<dd class="clause">no srcset</dd>');
    expect(panel).toContain('<dd class="css">—</dd>');
    expect(panel).toContain('<dd class="needed">—</dd>');
    expect(panel).toContain('<dd class="picked">—</dd>');
  });

  it('lists no candidates for an image that shipped none, because there is no list', () => {
    const panel = panelOf(renderReport(gallery()), 'header &gt; img');

    expect(panel).not.toContain('ul class="candidates"');
  });

  it('carries the panel data as one inert JSON island the script reads back', () => {
    const island = islandOf(renderReport(gallery()));

    const data = JSON.parse(island) as { panels: { device: { name: string } }[] };
    expect(data.panels).toHaveLength(3);
    expect(data.panels.map((panel) => panel.device.name)).toEqual([
      'iPhone SE',
      'iPhone SE',
      'iPhone SE',
    ]);
  });

  it('ships core into the file as the source of the functions the command calls', () => {
    const report = renderReport(gallery());

    expect(report).toContain(coreSource());
    expect(report).toContain(String(explainSelection));
  });

  it('refuses a run whose device the capture does not describe', () => {
    const orphaned: Capture = {
      ...gallery(),
      runs: [
        {
          deviceId: 'nokia-3310',
          images: [hero(187, '1080.png', 118_231)],
          backgroundImageCount: 0,
        },
      ],
    };

    expect(() => renderReport(orphaned)).toThrow('"nokia-3310"');
  });

  it('renders the same bytes twice for the same capture, because it is a pure function', () => {
    expect(renderReport(gallery())).toBe(renderReport(gallery()));
  });

  it('matches the recorded snapshot of the whole document', async () => {
    await expect(renderReport(gallery())).toMatchFileSnapshot('./snapshots/gallery.html');
  });
});
