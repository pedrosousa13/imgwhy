import type { Capture } from '@imgwhy/core';
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
