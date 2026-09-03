import type { Capture, CapturedImage, DeviceProfile } from '@imgwhy/core';
import { explainSelection } from '@imgwhy/core';
import { dataScript, html } from './html.js';
import type { Html } from './html.js';
import { readPanel } from './panel.js';
import type { PageData, Panel } from './panel.js';
import { SCRIPT } from './script.js';
import { STYLE } from './style.js';

/** Nothing at all, for a line the image in hand has no reason to carry. */
const NOTHING = html``;

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * The weight of the response that arrived, as the runner recorded it.
 *
 * Unknown stays unknown. Nothing here turns a dimension into a weight: this
 * cell reads exactly like a measurement whatever put it there, which is the
 * design's non-goal — "where `transferBytes` is null, report it as unknown.
 * Do not guess from pixel dimensions."
 */
const bytesArrived = (transferBytes: number | null): string =>
  transferBytes === null ? 'unknown' : `${transferBytes} bytes`;

/**
 * Every image of a Capture, keyed by the id that holds across device runs,
 * and within that by the device that saw it.
 *
 * First-seen order throughout, which is document order on the first device
 * that rendered the image. A row the matrix cannot key to a device is a
 * Capture that cannot be laid out at all, so it is refused rather than drawn
 * with a column missing.
 */
function groupById(capture: Capture): Map<string, Map<string, CapturedImage>> {
  const known = new Set(capture.devices.map((device) => device.id));
  const byId = new Map<string, Map<string, CapturedImage>>();

  for (const run of capture.runs) {
    if (!known.has(run.deviceId)) {
      throw new Error(`the capture has a run for "${run.deviceId}" but no such device`);
    }
    for (const image of run.images) {
      const seen = byId.get(image.id);
      if (seen) seen.set(run.deviceId, image);
      else byId.set(image.id, new Map([[run.deviceId, image]]));
    }
  }

  return byId;
}

/** One column heading: the device, and the two numbers that decide for it. */
const deviceHead = (device: DeviceProfile): Html =>
  html`<th class="device" scope="col"><span class="name">${device.name}</span><span class="profile">${device.viewport.width}×${device.viewport.height} · DPR ${device.dpr}</span></th>`;

/**
 * What one image offered, which is the same on every device and so is written
 * once, in the row's own heading.
 *
 * `sizes` is only shown where there is a candidate list for it to shape. An
 * image with no `srcset` says so instead: it had no choice to make, and a
 * blank row heading would leave a reader looking for the reason.
 */
function imageHead(id: string, image: CapturedImage, lazy: boolean): Html {
  const candidates = image.candidates.length
    ? html`<ul class="candidates">${image.candidates.map(
        (candidate) =>
          html`<li><span class="raw">${candidate.raw}</span><span class="url">${candidate.url}</span></li>`,
      )}</ul>`
    : html`<span class="none">no srcset</span>`;

  return html`<th class="image" scope="row"><span class="id">${id}</span>${
    lazy ? html`<span class="flag">loading=lazy</span>` : NOTHING
  }${
    image.candidates.length
      ? html`<span class="sizes">sizes ${image.sizes ?? 'absent'}</span>`
      : NOTHING
  }${candidates}</th>`;
}

/**
 * One cell: the candidate this device downloads, and what it cost.
 *
 * The candidate comes from `explainSelection` in core, which is the same call
 * the command line makes, so the matrix and the trace cannot disagree about a
 * row. An image no device run holds is one that render never produced, which
 * is a finding of its own and says so.
 */
function cell(image: CapturedImage | undefined, device: DeviceProfile): Html {
  if (image === undefined) return html`<td class="absent">not rendered</td>`;
  const { picked } = explainSelection(image, device);
  return html`<td><span class="picked">${picked ? picked.raw : '—'}</span><span class="bytes">${bytesArrived(image.transferBytes)}</span></td>`;
}

/** One row: what the image offered, then what each device did with it. */
function imageRow(
  devices: DeviceProfile[],
  id: string,
  sightings: Map<string, CapturedImage>,
): Html {
  const first = [...sightings.values()][0];
  if (!first) throw new Error(`the capture groups image "${id}" with no sighting to explain`);
  const lazy = [...sightings.values()].some((image) => image.loading === 'lazy');

  // The leading newline is what keeps one row to one line of the file, so a
  // diff of two reports points at the image that changed.
  return html`
<tr>${imageHead(id, first, lazy)}${devices.map((device) =>
    cell(sightings.get(device.id), device),
  )}</tr>`;
}

const matrix = (capture: Capture, images: Map<string, Map<string, CapturedImage>>): Html =>
  html`<div class="scroll">
<table>
<caption>Which candidate each device selected, and what the response cost on the wire.</caption>
<thead>
<tr><th scope="col">image</th>${capture.devices.map(deviceHead)}</tr>
</thead>
<tbody>${[...images].map(([id, sightings]) => imageRow(capture.devices, id, sightings))}
</tbody>
</table>
</div>`;

/**
 * One image and the device whose sighting of it the panel starts from.
 *
 * The first device that rendered the image, which is the same sighting the row
 * heading describes. The candidates and the `sizes` string are the page's and
 * are the same wherever it was seen; the one figure that is not is the width
 * layout ended at, which only a `sizes: auto` reads — so the panel names the
 * device it starts from rather than leaving a reader to wonder whose 375 that
 * was.
 */
function panelsOf(capture: Capture, images: Map<string, Map<string, CapturedImage>>): Panel[] {
  const devices = new Map(capture.devices.map((device) => [device.id, device]));

  return [...images].map(([id, sightings]) => {
    const first = [...sightings][0];
    if (!first) throw new Error(`the capture groups image "${id}" with no sighting to explain`);
    const [deviceId, image] = first;
    const device = devices.get(deviceId);
    if (!device) throw new Error(`the capture has a run for "${deviceId}" but no such device`);
    return { image, device };
  });
}

/**
 * The three controls, empty.
 *
 * Empty in the markup and filled by the script, which is not a detail. A
 * `value` attribute would be the first page string in an attribute anywhere in
 * this document, and the closed list in `escaping.test.ts` — every attribute
 * value the report writes is one of its own words — is what makes the whole
 * escaping argument checkable. The `sizes` string a control starts from
 * reaches the page through the JSON island instead, as text.
 *
 * `step="any"` on the ratio because 2.625 is a real device pixel ratio, and a
 * control that called it invalid would be arguing with the Pixel 8.
 */
const CONTROLS: Html = html`<div class="controls">
<label class="control">sizes<input class="sizes-input" type="text"></label>
<label class="control">viewport<input class="viewport-input" type="number" min="1" step="1"></label>
<label class="control">DPR<input class="dpr-input" type="number" min="0.1" step="any"></label>
</div>
<p class="limit">Re-picked from the candidates this page shipped. A framework reads <code>sizes</code> at build time to decide which files exist at all, so where it would also change the candidate list, this understates the gain.</p>`;

/**
 * One image in full: the arithmetic behind a row of the matrix, and the three
 * controls that run it again.
 *
 * The readout is `readPanel`, which is the same function the page calls when a
 * control changes — shipped into the file as its own source. So the panel a
 * reader types into and the panel written here cannot say the arithmetic
 * differently, because there is only one of them.
 *
 * An image with no `srcset` gets a panel and no controls. There is nothing to
 * recompute — no candidate list to re-pick from — and three boxes that changed
 * nothing would be worse than none.
 */
function panelSection({ image, device }: Panel): Html {
  const readout = readPanel(explainSelection(image, device), image.candidates, device.dpr);
  const heading = html`<h3 class="id">${image.id}</h3>`;

  if (image.candidates.length === 0) {
    return html`
<section class="panel">${heading}<p class="reason">${readout.reason}</p></section>`;
  }

  const candidates = image.candidates.map(
    (candidate, index) =>
      html`<li><span class="raw">${candidate.raw}</span><span class="url">${candidate.url}</span><span class="mark">${readout.marks[index]}</span></li>`,
  );

  return html`
<section class="panel">${heading}<p class="from">Starts from ${device.name}: a ${device.viewport.width} px viewport at DPR ${device.dpr}.</p>${CONTROLS}
<dl class="sums">
<dt>clause used</dt><dd class="clause">${readout.clause}</dd>
<dt>css px</dt><dd class="css">${readout.cssPx}</dd>
<dt>needed</dt><dd class="needed">${readout.needed}</dd>
<dt>picked</dt><dd class="picked">${readout.picked}</dd>
</dl>
<ul class="candidates">${candidates}</ul>
<p class="reason">${readout.reason}</p></section>`;
}

/**
 * Every panel, in the order the matrix lists the rows.
 *
 * The same list the page is handed, walked the same way. A panel carries the
 * image it is about, so the markup and the data cannot come apart — the script
 * pairs the two by position, and the two are one array here.
 */
const panels = (data: PageData): Html =>
  html`<section class="panels">
<h2>Each image, in full</h2>
<p class="lead">The arithmetic behind one row, and the controls to run it again. Type a different <code>sizes</code> string, viewport width or device pixel ratio, and the selection is recomputed here — by the same code the command ran, against the candidates this page shipped.</p>${data.panels.map(panelSection)}
</section>`;

/**
 * How to read the matrix, and the two things it will not do.
 *
 * The framework limit is here because the design asks for it in the report
 * rather than only in the documentation: "The report changes `sizes` and
 * re-picks from the candidates a page actually shipped. It does not model what
 * Next.js would emit for a different `sizes` string. State this limit in the
 * report: where a framework would also change the candidate list, the
 * counterfactual understates the gain."
 */
const NOTES: Html = html`<section class="notes">
<h2>How to read this</h2>
<ul>
<li><strong>picked</strong> is the candidate this device downloads: <code>sizes</code> resolved against the viewport, multiplied by the device pixel ratio, then the smallest candidate at or above that many physical pixels. Where no candidate carries a <code>w</code> descriptor, the ratio decides alone and <code>sizes</code> is read past.</li>
<li><strong>bytes</strong> is what the response cost on the wire, as the run recorded it. <strong>unknown</strong> means nothing recorded a transfer size for that response — never guessed from the pixels that arrived.</li>
<li>imgwhy re-picks from the candidates this page shipped. It does not model what a framework would emit for a different <code>sizes</code> string: a framework reads <code>sizes</code> at build time to decide which files exist at all, so where it would also change the candidate list, a counterfactual understates the gain.</li>
</ul>
</section>`;

/**
 * Turn a Capture into one self-contained HTML document.
 *
 * A pure function of its input: the same Capture always renders the same
 * bytes, which is what makes a Capture worth keeping and two of them worth
 * diffing. Nothing is read from a clock, an environment or a disk.
 *
 * The document loads no remote resource. The stylesheet is inlined, the fonts
 * are a system stack, and no URL out of the page reaches a `src` or an `href`
 * — every one of them is written as text. So opening a report tells no third
 * party that it was opened, which is the design's privacy constraint rather
 * than a preference.
 */
export function renderReport(capture: Capture): string {
  const images = groupById(capture);
  const data: PageData = { panels: panelsOf(capture, images) };
  const body = images.size
    ? html`${matrix(capture, images)}
${panels(data)}`
    : html`<p class="empty">${capture.url} carries no &lt;img&gt; element, so there is nothing to explain.</p>`;

  return `${html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>imgwhy — ${capture.url}</title>
${STYLE}
</head>
<body>
<main>
<h1>imgwhy</h1>
<dl class="head">
<dt>page</dt><dd class="url">${capture.url}</dd>
<dt>captured</dt><dd>${capture.capturedAt}</dd>
<dt>found</dt><dd>${plural(images.size, 'image')} on ${plural(capture.devices.length, 'device')}</dd>
</dl>
${body}
${NOTES}
</main>
${dataScript(data)}
${SCRIPT}
</body>
</html>
`}`;
}
