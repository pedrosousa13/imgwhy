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

/** `label` and value, on the label column every image block shares. */
const field = (label: string, value: string): string => `  ${label.padEnd(10)}  ${value}`;

/**
 * One row per line, columns padded to the widest cell.
 *
 * Every column is left aligned, so a reader can run an eye straight down one
 * of them and every row breaks in the same place.
 */
function table(heads: string[], rows: string[][]): string[] {
  const widths = heads.map((head, i) =>
    Math.max(head.length, ...rows.map((row) => (row[i] ?? '').length)),
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(heads), ...rows.map(line)];
}

const HEADS = ['device', 'viewport', 'DPR', 'clause used', 'css px', 'needed', 'picked', 'arrived'];

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
    ...imageBlock(capture, id, sightings, index + 1, groups.length),
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
  capture: Capture,
  id: string,
  sightings: Sighting[],
  index: number,
  total: number,
): string[] {
  const [first] = sightings as [Sighting, ...Sighting[]];
  const { candidates, sizes } = first.image;
  const lazy = sightings.some((s) => s.image.loading === 'lazy');
  const lines = [`image ${index} of ${total}  ${id}${lazy ? '   loading=lazy' : ''}`];

  // Nothing to select means nothing to explain, and a table of five identical
  // rows would only bury the images that do choose.
  if (candidates.length < 2) {
    const arrived = [
      ...new Set(sightings.map((s) => fileOf(s.image.currentSrc, capture.url))),
    ].join(', ');
    const why = candidates.length === 0 ? 'no srcset' : 'one candidate only';
    lines.push(`  ${why}, so nothing was selected — arrived  ${arrived}`);
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

  const absent = capture.devices.filter((d) => !sightings.some((s) => s.device.id === d.id));
  if (absent.length) lines.push(field('not on', absent.map((d) => d.name).join(', ')));

  lines.push('');
  lines.push(...table(HEADS, sightings.map((s) => row(capture, s, byWidth))).map((l) => `  ${l}`));
  return lines;
}

function row(capture: Capture, { device, image }: Sighting, byWidth: boolean): string[] {
  const viewport = `${device.viewport.width}×${device.viewport.height}`;
  const head = [device.name, viewport, String(device.dpr)];

  if (!byWidth) {
    const picked = selectCandidate(image.candidates, null, device.dpr);
    return [...head, 'x descriptors only', '—', '—', ...tail(capture, image, picked)];
  }

  const resolution = resolveSizes(image.sizes, device.viewport.width);
  const px = resolvedPx(resolution, image.renderedWidth);
  const picked = selectCandidate(image.candidates, px, device.dpr);
  return [
    ...head,
    resolution.clause,
    px === null ? 'unreadable' : `${Math.round(px)}px`,
    px === null ? '—' : `${Math.round(px * device.dpr)}px`,
    ...tail(capture, image, picked),
  ];
}

/** The picked descriptor and the file that arrived, which should agree. */
function tail(capture: Capture, image: CapturedImage, picked: Candidate | null): string[] {
  const arrived = image.currentSrc ? fileOf(image.currentSrc, capture.url) : '(none)';
  // The cache is disabled for every render, so a disagreement is not a held
  // copy standing in. It is the prediction to question.
  const differs =
    picked !== null &&
    image.currentSrc !== '' &&
    absolute(picked.url, capture.url) !== image.currentSrc;
  return [picked ? picked.raw : '—', differs ? `${arrived} ← differs` : arrived];
}
