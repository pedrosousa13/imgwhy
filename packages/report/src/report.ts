import type { Capture, CapturedImage, DeviceProfile } from '@imgwhy/core';
import { explainSelection } from '@imgwhy/core';
import { dataScript, html } from './html.js';
import type { Html } from './html.js';
import { readPanel } from './panel.js';
import type { PageData, Panel, Readout } from './panel.js';
import { SCRIPT } from './script.js';
import { STYLE } from './style.js';

/** Nothing at all, for a line the image in hand has no reason to carry. */
const NOTHING = html``;

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * How many files this page's CSS painted, and why that is all there is to say
 * about them.
 *
 * A CSS background image has no selection mechanism at all: it reaches the
 * browser as a URL in a stylesheet, with no `srcset` beside it and no `sizes`
 * to resolve. There is nothing to select between, so there is no row for one
 * in the matrix and no panel to type into — which is exactly why the count has
 * to be stated rather than left out. A matrix of every `<img>` on a page reads
 * like a matrix of every image on it, and on a page that paints its hero in
 * CSS it is not one.
 *
 * Per device, because the count is a property of a render: a media query can
 * paint a background at one viewport and not at the next. Where the devices
 * agree, the figure is written once and names no device — the same rule the
 * command's trace keeps, kept here in this package's own words because the
 * report cannot reach the command's.
 *
 * Nothing at all where nothing was painted. A line reading `0 background
 * images` on every report would bury the pages that have some.
 */
function backgrounds(capture: Capture): Html {
  if (capture.runs.every((run) => run.backgroundImageCount === 0)) return NOTHING;

  const devicesByCount = new Map<string, string[]>();
  for (const device of capture.devices) {
    // Device order, and a device that never rendered has nothing to report.
    // Every run's device is known by here: `groupById` has already refused a
    // capture whose run names one the capture does not describe.
    const run = capture.runs.find((one) => one.deviceId === device.id);
    if (!run) continue;
    const counted = plural(run.backgroundImageCount, 'background image');
    const painted = devicesByCount.get(counted);
    if (painted) painted.push(device.name);
    else devicesByCount.set(counted, [device.name]);
  }

  const counts = [...devicesByCount]
    .map(([counted, painted]) =>
      devicesByCount.size === 1 ? counted : `${counted} on ${painted.join(', ')}`,
    )
    .join(', ');

  return html`
<dt>backgrounds</dt><dd>${counts}. A CSS background image has no selection mechanism at all, so imgwhy counts them and explains nothing further.</dd>`;
}

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
 * The `sizes` string one device resolved against, and the element it came off
 * where that was not the `<img>`.
 *
 * A `<picture>` can put the `sizes` string on the `<source>` whose `media`
 * matched, and then the attribute a reader finds on the tag is not the one the
 * browser read. Saying so is what sends a reader to the element that decided;
 * a bare string would send them to the tag to check a value it does not hold.
 *
 * Both elements are named rather than only the one that answered, because the
 * finding is the override — `absent` beside a `<source>` alone would read as
 * an attribute missing rather than as one that played no part.
 */
const offered = (image: CapturedImage): Html =>
  image.sizesSource === 'source'
    ? html`<span class="sizes">sizes ${image.sizes ?? 'absent'}, read off the matching &lt;source&gt; rather than the &lt;img&gt;</span>`
    : html`<span class="sizes">sizes ${image.sizes ?? 'absent'}</span>`;

/**
 * What one image offered, and the devices it offered that to.
 *
 * The markup rather than the image, because the markup is what the heading
 * writes and what decides whether two devices were shown the same thing.
 */
type Offer = { markup: Html; devices: string[] };

/**
 * What one image offered, once per distinct offer, in column order.
 *
 * A `<picture>` is why this is a list. The candidates and the `sizes` string
 * come off whichever `<source>` matched, so what an image offered is not one
 * thing a row can write once: it is per device, and a heading written from the
 * first sighting alone would put one device's markup over the others' — the
 * narrowest viewport's, which is the sighting a Capture happens to hold first
 * and the one most likely to have fallen through to the `<img>`.
 *
 * The rule is the command's trace's, kept here in this package's own markup
 * because the report cannot reach the command's: where every device was
 * offered the same thing the heading writes it once and names no device, and
 * where they differ it writes each distinct offer with the devices that were
 * shown it. So the page with no `<picture>` on it — which is most pages —
 * reads exactly as it did.
 *
 * Grouped on the markup itself, which is the same question the heading asks:
 * two devices share a block exactly where writing them apart would write the
 * same block twice.
 *
 * `sizes` is only shown where there is a candidate list for it to shape. An
 * image with no `srcset` says so instead: it had no choice to make, and a
 * blank row heading would leave a reader looking for the reason.
 */
function offersOf(devices: DeviceProfile[], sightings: Map<string, CapturedImage>): Offer[] {
  const byMarkup = new Map<string, Offer>();

  for (const device of devices) {
    const image = sightings.get(device.id);
    // Column order, and a device that never rendered the image offered it
    // nothing. Its cell says so; there is no markup of its own to write.
    if (!image) continue;

    const markup = image.candidates.length
      ? html`${offered(image)}<ul class="candidates">${image.candidates.map(
          (candidate) =>
            html`<li><span class="raw">${candidate.raw}</span><span class="url">${candidate.url}</span></li>`,
        )}</ul>`
      : html`<span class="none">no srcset</span>`;

    const written = String(markup);
    const shown = byMarkup.get(written);
    if (shown) shown.devices.push(device.name);
    else byMarkup.set(written, { markup, devices: [device.name] });
  }

  return [...byMarkup.values()];
}

/**
 * What one image offered, in the row's own heading.
 *
 * One offer is written bare, the way a single offer always was. Several are
 * written one block each, and the devices come first: a block is three or four
 * lines tall, and an attribution underneath would leave a reader working back
 * up the list to find out whose candidates they had just read.
 *
 * `loading=lazy` stays outside the blocks. It is an attribute of the `<img>`,
 * which no `<source>` overrides, so it is the one thing here that is the same
 * offer to offer.
 */
function imageHead(id: string, offers: Offer[], lazy: boolean): Html {
  const blocks = offers.map((offer) =>
    offers.length === 1
      ? offer.markup
      : html`<div class="offer"><span class="on">on ${offer.devices.join(', ')}</span>${offer.markup}</div>`,
  );

  return html`<th class="image" scope="row"><span class="id">${id}</span>${
    lazy ? html`<span class="flag">loading=lazy</span>` : NOTHING
  }${blocks}</th>`;
}

/**
 * One cell: the candidate this device downloads, and what it cost.
 *
 * The candidate comes from `explainSelection` in core, which is the same call
 * the command line makes, so the matrix and the trace cannot disagree about
 * what a device picked. An image no device run holds is one that render never
 * produced, which is a finding of its own and says so.
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
  const offers = offersOf(devices, sightings);
  if (!offers.length) {
    throw new Error(`the capture groups image "${id}" with no sighting to explain`);
  }
  const lazy = [...sightings.values()].some((image) => image.loading === 'lazy');

  // The leading newline is what keeps one row to one line of the file, so a
  // diff of two reports points at the image that changed.
  return html`
<tr>${imageHead(id, offers, lazy)}${devices.map((device) =>
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
 * The first device that rendered the image, and everything the panel shows is
 * that one sighting's: the candidates, the `sizes` string, and the width
 * layout ended at. None of the three is a property of the page. A `<picture>`
 * hands a different `<source>` to a different device, so the candidate list
 * and the `sizes` string belong to the render they were measured on as much as
 * the 375 does — which is why the panel names that device, and says the list
 * is the one that render was offered.
 *
 * One panel per image, and not one per sighting. The matrix is where the
 * devices are compared; a panel is the arithmetic in full for one of them,
 * with the controls to type another device's numbers in. Five panels per image
 * would be five of everything to read past, and the row heading already says
 * where the offers differ.
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
 *
 * The `sizes` control is a `<textarea>` and not an `<input type="text">`,
 * which is a correctness decision rather than a layout one. A text input runs
 * the HTML value sanitisation algorithm over whatever is assigned to it, and
 * that algorithm strips every carriage return and line feed. A `sizes`
 * attribute written across lines — which is how anyone writes a long one —
 * would then start the control at a string the page never carried:
 * `(min-width:1000px)\nSPACE50vw` survives as two clauses, and
 * `(min-width:1000px)\n50vw` becomes `(min-width:1000px)50vw`, one clause
 * whose media condition no longer parses and whose lengths add up to a width
 * nothing measured. The panel would then re-pick against a string of the
 * browser's invention and show a failure the page never had. A textarea holds
 * a newline, so the control cannot disagree with the measurement.
 *
 * It stays empty in the markup for the reason every control does, and the rule
 * matters slightly more here: a textarea's content is text rather than markup,
 * so `</textarea` in a page's `sizes` string would end the element. Nothing
 * from the page is written into one — the string arrives through the island.
 */
const CONTROLS: Html = html`<div class="controls">
<label class="control">sizes<textarea class="sizes-input"></textarea></label>
<label class="control">viewport<input class="viewport-input" type="number" min="1" step="1"></label>
<label class="control">DPR<input class="dpr-input" type="number" min="0.1" step="any"></label>
</div>
<p class="limit">Re-picked from the candidates this page shipped. A framework reads <code>sizes</code> at build time to decide which files exist at all, so where it would also change the candidate list, this understates the gain.</p>`;

/**
 * The four figures behind one row, whatever the image had to choose between.
 *
 * Written once and shown on every panel, including the one for an image with
 * no `srcset`. `readPanel` answers all four for that case — "no srcset", and
 * three em dashes — and the design asks a panel for "the matched clause,
 * resolved CSS width, pixels needed, candidate list, and the selection
 * reason". Computing an answer and then dropping it would leave four fields of
 * a `Readout` dead on that path, which is an invitation to wire them back up
 * wrongly later.
 */
const sums = (readout: Readout): Html =>
  html`<dl class="sums">
<dt>clause used</dt><dd class="clause">${readout.clause}</dd>
<dt>css px</dt><dd class="css">${readout.cssPx}</dd>
<dt>needed</dt><dd class="needed">${readout.needed}</dd>
<dt>picked</dt><dd class="picked">${readout.picked}</dd>
</dl>`;

/**
 * One image in full: the arithmetic behind a row of the matrix, and the three
 * controls that run it again.
 *
 * The readout is `readPanel`, which is the same function the page calls when a
 * control changes — shipped into the file as its own source. So the panel a
 * reader types into and the panel written here cannot say the arithmetic
 * differently, because there is only one of them.
 *
 * An image with no `srcset` gets the sums and the reason, and no controls and
 * no candidate list. There is nothing to recompute — no candidate list to
 * re-pick from — and three boxes that changed nothing would be worse than
 * none. The sums stay because they were taken: the reading exists, and it says
 * there was nothing to resolve.
 */
function panelSection({ image, device }: Panel): Html {
  const readout = readPanel(explainSelection(image, device), image.candidates, device.dpr);
  const heading = html`<h3 class="id">${image.id}</h3>`;

  if (image.candidates.length === 0) {
    return html`
<section class="panel">${heading}${sums(readout)}
<p class="reason">${readout.reason}</p></section>`;
  }

  const candidates = image.candidates.map(
    (candidate, index) =>
      html`<li><span class="raw">${candidate.raw}</span><span class="url">${candidate.url}</span><span class="mark">${readout.marks[index]}</span></li>`,
  );

  return html`
<section class="panel">${heading}<p class="from">Starts from ${device.name}: a ${device.viewport.width} px viewport at DPR ${device.dpr}, and the candidates that render was offered.</p>${CONTROLS}
${sums(readout)}
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
 * What leaves with this file, said where somebody about to send it will read
 * it.
 *
 * Beside the page URL rather than in `NOTES`, and that placement is the whole
 * point of the sentence. A report is the artifact people mail each other, the
 * README says so, and a note at the foot of the file is a note the sender
 * reads after they have sent it. This one sits under the URL it is about.
 *
 * It states a fact rather than offering a setting, because there is no setting
 * to offer. Naming the file the browser fetched is the report's whole claim,
 * and a URL with its query stripped cannot be pasted into a browser to check
 * that claim — two variants of one image can differ in nothing else. Whoever
 * sends a report knows whether the page was sensitive; this package does not.
 */
const CARRIES: Html = html`<p class="carries">Every URL here — the page above, and each candidate below — is written exactly as the page offered it, query strings included. Naming the file the browser fetched is this report's whole claim, and a redacted URL cannot be pasted back into a browser to check it. So a signed URL leaves with the file, whether it is a CDN transformation token or a presigned bucket link, and whoever sends this report on is the only one who knows whether that matters.</p>`;

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
<dt>found</dt><dd>${plural(images.size, 'image')} on ${plural(capture.devices.length, 'device')}</dd>${backgrounds(capture)}
</dl>
${CARRIES}
${body}
${NOTES}
</main>
${dataScript(data)}
${SCRIPT}
</body>
</html>
`}`;
}
