import type { Capture } from '@imgwhy/core';
import { coreSource, explainSelection } from '@imgwhy/core';
import { describe, expect, it } from 'vitest';
import { renderReport } from '../src/index.js';
import { DEVICES, badge, gallery, hero, logo, on } from './capture.js';

/** The `<td>` cells of the row whose header holds `id`, in device order. */
const cellsOf = (report: string, id: string): string[] => {
  const rows = report.split('<tr');
  const row = rows.find((one) => one.includes(id));
  if (!row) throw new Error(`no row for ${id} in\n${report}`);
  return [...row.matchAll(/<td[^>]*>.*?<\/td>/g)].map((match) => match[0]);
};

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
    expect(panelOf(renderReport(gallery()), 'nth-of-type(1)')).toContain(
      '<p class="from">Starts from iPhone SE: a 375 px viewport at DPR 2.</p>',
    );
  });

  it('carries a control for the sizes string, the viewport width and the ratio', () => {
    const panel = panelOf(renderReport(gallery()), 'nth-of-type(1)');

    expect(panel).toContain('<input class="sizes-input" type="text">');
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
      runs: [{ deviceId: 'nokia-3310', images: [hero(187, '1080.png', 118_231)] }],
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
