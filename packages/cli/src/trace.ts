import type { Candidate, Capture, CapturedImage, DeviceProfile, Resolution } from '@imgwhy/core';
import { resolveSizes, selectCandidate } from '@imgwhy/core';

/** One image as one device saw it. */
type Sighting = { device: DeviceProfile; image: CapturedImage };

const absolute = (url: string, base: string): string => {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
};

/** The tail of a URL, which is what tells two candidates apart at a glance. */
const fileOf = (url: string, base: string): string => {
  try {
    const parsed = new URL(url, base);
    return (parsed.pathname.split('/').pop() || parsed.hostname) + parsed.search.slice(0, 40);
  } catch {
    return url.slice(-40);
  }
};

/**
 * The CSS width selection ran against.
 *
 * Null where nothing resolved, which is the one case selection cannot run at
 * all. `auto` defers to layout, so the width the element ended up at is the
 * honest answer there.
 */
const resolvedPx = (resolution: Resolution, renderedWidth: number): number | null => {
  switch (resolution.kind) {
    case 'auto':
      return renderedWidth;
    case 'error':
      return null;
    default:
      return resolution.px;
  }
};

/**
 * The weight of the response that arrived, as the runner recorded it.
 *
 * Unknown stays unknown. Nothing here turns a dimension into a weight: a
 * guess would read exactly like a measurement in this column, which is the
 * design's non-goal — "where `transferBytes` is null, report it as unknown".
 */
const bytesArrived = (transferBytes: number | null): string =>
  transferBytes === null ? 'unknown' : String(transferBytes);

/** `label` and value, on the label column every image block shares. */
const field = (label: string, value: string): string => `  ${label.padEnd(10)}  ${value}`;

/**
 * One value where every device agrees, or every value with the devices that
 * measured it.
 *
 * For the image an image block cannot table — nothing was selected, so there
 * is no arithmetic to lay out — this is what keeps the report per device. The
 * devices usually agree, and five lines saying the same thing would bury the
 * images that do differ, so agreement stays one value and names no device.
 * Disagreement is the case that has to: a bare `12345, unknown` says two
 * things were measured and leaves a reader with no way to tell which device
 * measured which.
 */
function perDevice(sightings: Sighting[], of: (image: CapturedImage) => string): string {
  const devicesByValue = new Map<string, string[]>();
  for (const { device, image } of sightings) {
    const value = of(image);
    const measured = devicesByValue.get(value);
    if (measured) measured.push(device.name);
    else devicesByValue.set(value, [device.name]);
  }

  return [...devicesByValue]
    .map(([value, measured]) =>
      devicesByValue.size === 1 ? value : `${value} on ${measured.join(', ')}`,
    )
    .join(', ');
}

/**
 * One device's line of the arithmetic, keyed by the column each value prints
 * under.
 *
 * The keys are the headings, so a row cannot line its values up against the
 * wrong columns and the compiler says so when one is missing.
 */
type Row = {
  device: string;
  viewport: string;
  DPR: string;
  'clause used': string;
  'css px': string;
  needed: string;
  picked: string;
  file: string;
  'bytes arrived': string;
};

/** The columns, left to right. */
const COLUMNS: (keyof Row)[] = [
  'device',
  'viewport',
  'DPR',
  'clause used',
  'css px',
  'needed',
  'picked',
  'file',
  'bytes arrived',
];

/**
 * One row per line, columns padded to the widest cell.
 *
 * Every column is left aligned, so a reader can run an eye straight down one
 * of them and every row breaks in the same place.
 */
function table(rows: Row[]): string[] {
  const widths = COLUMNS.map((column) =>
    Math.max(column.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  return [line(COLUMNS), ...rows.map((row) => line(COLUMNS.map((column) => row[column])))];
}

/**
 * Explain every image on a page across every device, as arithmetic a reader
 * can check.
 *
 * An image gets one block: what it offered, which is the same on every device,
 * and then one table row per device, which is where the devices disagree. That
 * way a page with a dozen images stays a page you can scan, and the interesting
 * column — the file each device picked — reads straight down.
 */
export function formatCapture(capture: Capture): string {
  const groups = groupById(capture);
  const head = [
    `url      ${capture.url}`,
    `images   ${groups.length} on ${capture.devices.length} devices`,
  ];
  const blocks = groups.flatMap(([id, sightings], index) => [
    '',
    ...imageBlock(capture.url, capture.devices, id, sightings, index + 1, groups.length),
  ]);
  return [...head, ...blocks].join('\n');
}

/** Every image, keyed by the id that holds across runs, in first-seen order. */
function groupById(capture: Capture): [string, Sighting[]][] {
  const devices = new Map(capture.devices.map((device) => [device.id, device]));
  const byId = new Map<string, Sighting[]>();

  for (const run of capture.runs) {
    const device = devices.get(run.deviceId);
    if (!device) throw new Error(`the capture has a run for "${run.deviceId}" but no such device`);
    for (const image of run.images) {
      const sightings = byId.get(image.id);
      if (sightings) sightings.push({ device, image });
      else byId.set(image.id, [{ device, image }]);
    }
  }

  return [...byId];
}

function imageBlock(
  base: string,
  devices: DeviceProfile[],
  id: string,
  sightings: Sighting[],
  index: number,
  total: number,
): string[] {
  const first = sightings[0];
  if (!first) throw new Error(`the capture groups image "${id}" with no sighting to explain`);
  const { candidates, sizes } = first.image;
  const lazy = sightings.some((s) => s.image.loading === 'lazy');
  const lines = [`image ${index} of ${total}  ${id}${lazy ? '   loading=lazy' : ''}`];

  // Nothing to select means nothing to explain, and a table of five identical
  // rows would only bury the images that do choose. This is also what keeps a
  // 1×1 tracking pixel to one line: the runner records every image, and the
  // ones with no choice to make say so and stop.
  if (candidates.length < 2) {
    const files = perDevice(sightings, (image) => fileOf(image.currentSrc, base));
    const why = candidates.length === 0 ? 'no srcset' : 'one candidate only';
    lines.push(`  ${why}, so nothing was selected — file  ${files}`);
    // Bytes still arrived for it, so they are still reported. A 1×1 tracking
    // pixel weighs what it weighs whether or not anything chose it.
    //
    // Per device, the way the file above is, and for the same reason: a lazy
    // image still in flight when one render finished loading reads as a size
    // on the devices that got it and unknown on the ones that did not, rather
    // than as two figures with nothing to attach either of them to.
    lines.push(field('bytes', perDevice(sightings, (image) => bytesArrived(image.transferBytes))));
    return lines;
  }

  // `w` and `x` descriptors are answered by different questions, and a page
  // may carry both. `sizes` only enters the `w` case; a browser reads past it
  // otherwise, however the tag was written.
  const byWidth = candidates.some((c) => c.w != null);

  lines.push(field('candidates', candidates.map((c) => c.raw).join(', ')));
  if (byWidth || sizes !== null) lines.push(field('sizes', sizes ?? '(absent)'));

  // A responsive layout can move an image, and then the id names where it sat
  // on some devices only. Say where it sat on the others.
  const moved = new Map<string, string[]>();
  for (const { device, image } of sightings) {
    if (image.selector === id) continue;
    const names = moved.get(image.selector);
    if (names) names.push(device.name);
    else moved.set(image.selector, [device.name]);
  }
  for (const [selector, names] of moved) {
    lines.push(field('also at', `${selector} on ${names.join(', ')}`));
  }

  const absent = devices.filter((d) => !sightings.some((s) => s.device.id === d.id));
  if (absent.length) lines.push(field('not on', absent.map((d) => d.name).join(', ')));

  lines.push('');
  lines.push(...table(sightings.map((s) => row(base, s, byWidth))).map((l) => `  ${l}`));
  return lines;
}

function row(base: string, { device, image }: Sighting, byWidth: boolean): Row {
  const head = {
    device: device.name,
    viewport: `${device.viewport.width}×${device.viewport.height}`,
    DPR: String(device.dpr),
  };

  if (!byWidth) {
    const picked = selectCandidate(image.candidates, null, device.dpr);
    return {
      ...head,
      'clause used': 'x descriptors only',
      'css px': '—',
      needed: '—',
      ...chosen(base, image, picked),
    };
  }

  const resolution = resolveSizes(image.sizes, device.viewport.width);
  const px = resolvedPx(resolution, image.renderedWidth);
  const picked = selectCandidate(image.candidates, px, device.dpr);
  return {
    ...head,
    'clause used': resolution.clause,
    'css px': px === null ? 'unreadable' : `${Math.round(px)}px`,
    needed: px === null ? '—' : `${Math.round(px * device.dpr)}px`,
    ...chosen(base, image, picked),
  };
}

/**
 * The picked descriptor, the file the browser went and got — which should
 * agree — and what that file cost on the wire.
 */
function chosen(
  base: string,
  image: CapturedImage,
  picked: Candidate | null,
): Pick<Row, 'picked' | 'file' | 'bytes arrived'> {
  const file = image.currentSrc ? fileOf(image.currentSrc, base) : '(none)';
  // The cache is disabled for every render, so a disagreement is not a held
  // copy standing in. It is the prediction to question.
  const differs =
    picked !== null && image.currentSrc !== '' && absolute(picked.url, base) !== image.currentSrc;
  return {
    picked: picked ? picked.raw : '—',
    file: differs ? `${file} ← differs` : file,
    'bytes arrived': bytesArrived(image.transferBytes),
  };
}
