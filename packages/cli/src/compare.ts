import type { Capture, DeviceProfile } from '@imgwhy/core';
import { explainSelection } from '@imgwhy/core';
import { type Line, escape, say } from './say.js';

/**
 * What one device made of one image, on one side of the diff.
 *
 * The descriptor is already a string rather than a `Candidate`, because it is
 * the only part of the pick a row shows and because two Captures are compared
 * on what they said, not on how the arithmetic got there. `explainSelection`
 * ran once, over the device profile that render belonged to, and what is left
 * is two values a reader can check against each other.
 */
type Reading = { picked: string; bytes: number | null };

/** One device's line of one image, with the side it saw nothing on as null. */
export type DeviceChange = {
  device: string;
  before: Reading | null;
  after: Reading | null;
};

/**
 * One image across both captures.
 *
 * `added` and `gone` carry no readings, and that is the alignment decision
 * showing through: an image whose id is in one capture only is never paired
 * with another image, so there is nothing to put on the other side of an
 * arrow. Naming it is the whole of what a diff can honestly say about it.
 */
export type ImageChange = {
  id: string;
  kind: 'same' | 'changed' | 'added' | 'gone';
  devices: DeviceChange[];
};

/**
 * What two Captures say about each other.
 *
 * The counts are here rather than in the formatter, and that is what makes the
 * summary line checkable: the blocks and the figures under them are read off
 * one value, so a count that disagrees with the rows above it is a bug in one
 * place instead of a disagreement between two.
 */
export type Comparison = {
  /** The devices both captures carry, by the name the later one gives them. */
  shared: string[];
  onlyBefore: string[];
  onlyAfter: string[];
  /** Every image either capture carries, in first-seen order, unchanged ones included. */
  images: ImageChange[];
  changed: number;
  smaller: number;
  regressed: number;
  added: number;
  gone: number;
};

/** Every image of one capture, keyed by the id it holds across runs, then by device. */
type Seen = Map<string, Map<string, Reading>>;

/**
 * Read one capture into what each device made of each image.
 *
 * Walked by device rather than by run, which is `backgrounds`'s pattern in
 * `trace.ts` and is here for the same reason: a device the capture describes
 * and never ran has nothing to report, and a run naming a device the capture
 * does not describe cannot arrive — `in.ts` refuses that file at the boundary.
 * So there is no unreachable branch to write and no throw to reach.
 *
 * The first sighting of an id on one device wins. `alignImageIds` gives one
 * render's images distinct ids, so a repeat is a file nothing here wrote, and
 * a row shows one pair of readings: taking the first is what keeps the two
 * halves of a row belonging to each other.
 */
function seenIn(capture: Capture): Seen {
  const seen: Seen = new Map();

  for (const device of capture.devices) {
    const run = capture.runs.find((one) => one.deviceId === device.id);
    if (!run) continue;

    for (const image of run.images) {
      const byDevice = seen.get(image.id) ?? new Map<string, Reading>();
      seen.set(image.id, byDevice);
      if (byDevice.has(device.id)) continue;
      byDevice.set(device.id, {
        picked: explainSelection(image, device).picked?.raw ?? '—',
        bytes: image.transferBytes,
      });
    }
  }

  return seen;
}

/** The devices both captures carry, in the order the earlier one holds them. */
function sharedDevices(before: Capture, after: Capture): { id: string; name: string }[] {
  const now = new Map(after.devices.map((device) => [device.id, device]));
  // The later capture's name, because a device is called whatever it is called
  // now: the id is what matches the two profiles, and a config file that
  // renamed one renamed it for the run a reader is looking at.
  return before.devices.flatMap((device) => {
    const current = now.get(device.id);
    return current ? [{ id: device.id, name: current.name }] : [];
  });
}

const named = (devices: DeviceProfile[], absent: Capture): string[] => {
  const described = new Set(absent.devices.map((device) => device.id));
  return devices.filter((device) => !described.has(device.id)).map((device) => device.name);
};

/** Whether one device saw anything move, which is what a block is written for. */
const moved = ({ before, after }: DeviceChange): boolean =>
  before === null ||
  after === null ||
  before.picked !== after.picked ||
  before.bytes !== after.bytes;

/**
 * Whether a file weighed more after than before, on one device.
 *
 * The whole of the regression rule, and it is one comparison of two numbers
 * both captures recorded. A weight that was never recorded is not a smaller
 * file and not a bigger one — `transferBytes` is null where the transfer size
 * is unknown, and reading an unknown as a zero would turn a lazy image still
 * in flight into a finding.
 */
const grew = ({ before, after }: DeviceChange): boolean =>
  before !== null && after !== null && before.bytes !== null && after.bytes !== null
    ? after.bytes > before.bytes
    : false;

const shrank = ({ before, after }: DeviceChange): boolean =>
  before !== null && after !== null && before.bytes !== null && after.bytes !== null
    ? after.bytes < before.bytes
    : false;

/**
 * Compare two Captures of a page, image by image and device by device.
 *
 * ## How the two are aligned
 *
 * On the id `alignImageIds` wrote, and on nothing else. That id is the DOM
 * path, falling back to the candidate URL family, and it is the one thing both
 * files carry that says which element a row is about. An id in one capture and
 * not the other is reported as added or gone.
 *
 * Nothing is guessed at, and that is the decision rather than a limitation. A
 * redesign moves elements and a rebuild renames files, so a diff that paired
 * images on a resemblance would pair the wrong two exactly when a page changed
 * most — and would say so in the same voice it uses for a pair it is sure of.
 * A wall of added and gone is a legible answer to a page that was rebuilt; a
 * confident row about two unrelated images is not.
 *
 * ## Which devices
 *
 * The ones both captures describe, matched on the profile id. A device only
 * one side carries is named and nothing else: it rendered once, so there is no
 * before and after of it to write down.
 */
export function compareCaptures(before: Capture, after: Capture): Comparison {
  const shared = sharedDevices(before, after);
  const seenBefore = seenIn(before);
  const seenAfter = seenIn(after);

  const images = [...new Set([...seenBefore.keys(), ...seenAfter.keys()])].map(
    (id): ImageChange => {
      if (!seenAfter.has(id)) return { id, kind: 'gone', devices: [] };
      if (!seenBefore.has(id)) return { id, kind: 'added', devices: [] };

      const devices = shared.flatMap(({ id: deviceId, name }) => {
        const was = seenBefore.get(id)?.get(deviceId) ?? null;
        const is = seenAfter.get(id)?.get(deviceId) ?? null;
        // A device that saw the image on neither side writes no row: the image
        // is simply not on it, and an empty row would say otherwise.
        return was === null && is === null ? [] : [{ device: name, before: was, after: is }];
      });

      return { id, kind: devices.some(moved) ? 'changed' : 'same', devices };
    },
  );

  const count = (of: (image: ImageChange) => boolean): number => images.filter(of).length;
  return {
    shared: shared.map((device) => device.name),
    onlyBefore: named(before.devices, after),
    onlyAfter: named(after.devices, before),
    images,
    changed: count((image) => image.kind === 'changed'),
    // A file that grew for one device is a regression whatever it did for
    // another, so the two counts cannot both claim one image: an image that
    // grew somewhere is counted there and nowhere else.
    smaller: count((image) => image.devices.some(shrank) && !image.devices.some(grew)),
    regressed: count((image) => image.devices.some(grew)),
    added: count((image) => image.kind === 'added'),
    gone: count((image) => image.kind === 'gone'),
  };
}

/** The pick a row shows, or the word for a device that saw nothing to pick. */
const pickedIn = (reading: Reading | null): string => (reading ? reading.picked : '(not seen)');

/** What arrived, as the trace words it, or the word for a render that never happened. */
const weight = (reading: Reading | null): string => {
  if (reading === null) return '(not seen)';
  return reading.bytes === null ? 'unknown' : String(reading.bytes);
};

/**
 * The two weights, or the word for a pair that did not move.
 *
 * The unit is written only where both sides are numbers. `unknown` and
 * `(not seen)` are not weights, so a `bytes` after one of them would be
 * labelling a word rather than a figure.
 */
function weighed({ before, after }: DeviceChange): string {
  if (before !== null && after !== null && before.bytes === after.bytes) return 'unchanged';
  const both = before?.bytes != null && after?.bytes != null;
  return `${weight(before)} → ${weight(after)}${both ? ' bytes' : ''}`;
}

/**
 * One device per line, in three columns padded to the widest cell.
 *
 * Measured after the escape, for the reason `trace.ts` gives about its own
 * table: a control character is one character in the string the page wrote and
 * six in the string a terminal shows, so a column measured before the escape
 * is a column the next row does not line up under. Only the measuring happens
 * here — every cell reaches its line through an interpolation, so `say` is
 * what writes it out, once.
 */
function rows(changes: DeviceChange[]): Line[] {
  const cells = changes.map((change) => [
    change.device,
    `${pickedIn(change.before)} → ${pickedIn(change.after)}`,
    weighed(change),
  ]);
  const printed = (cell: string): number => escape(cell).length;
  const widths = [0, 1].map((column) => Math.max(...cells.map((row) => printed(row[column]))));

  return cells.map(
    (row) =>
      say`  ${row.flatMap((cell, i) =>
        i === row.length - 1 ? [cell] : [cell, ' '.repeat(widths[i] - printed(cell) + 2)],
      )}`,
  );
}

/**
 * The devices only one capture carried, which is the sentence a reader needs
 * before the blocks make sense.
 *
 * Where nothing is in both, the second line says so rather than leaving the
 * summary to imply it. A diff over an empty intersection compares nothing and
 * would otherwise read `0 images changed`, which is a different claim: one
 * says nothing moved, and the other that nothing was looked at.
 */
function head(comparison: Comparison): Line[] {
  const only = [
    ...comparison.onlyBefore.map((name) => `${name} only in before`),
    ...comparison.onlyAfter.map((name) => `${name} only in after`),
  ];
  if (only.length === 0) return [];

  const lines = [say`devices  ${only.join(', ')}`];
  if (comparison.shared.length === 0) {
    lines.push(say`         no device is in both captures, so no image could be compared`);
  }
  return lines;
}

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * The counts, read off the same comparison the blocks above were.
 *
 * Added and gone are named only where there are some. Every image either of
 * them counts has a block of its own, so the figure is there to be checked
 * against a wall a reader cannot miss — and a line that read `0 added, 0 gone`
 * on every unremarkable diff would bury the three counts that are always worth
 * reading.
 */
function summary(comparison: Comparison): Line {
  const counted = [
    `${plural(comparison.changed, 'image')} changed`,
    `${comparison.smaller} got smaller`,
    `${comparison.regressed} regressed`,
    ...(comparison.added ? [`${comparison.added} added`] : []),
    ...(comparison.gone ? [`${comparison.gone} gone`] : []),
  ];
  return say`${counted.join(', ')}`;
}

/**
 * Write a comparison out for a terminal: what moved, per image and per device,
 * and the counts under it.
 *
 * An image both captures agree on gets no block. A page has a dozen images and
 * a change touches two of them, so a block per image would bury the answer
 * under the images that were fine — which is the same reason `trace.ts` keeps
 * an image with nothing to select to one line. The numbering still counts
 * every image either capture carries, so `image 4 of 10` says where in the
 * page the block sits rather than where in this list.
 *
 * Every string here reaches its line through `say`, and `say` escapes every
 * interpolation. A Capture is page content — a selector, a device name out of
 * a config file, a descriptor as the page wrote it — so the alternative is a
 * page choosing what a terminal does.
 */
export function formatComparison(comparison: Comparison): string {
  const total = comparison.images.length;
  const blocks = comparison.images.flatMap((image, index): Line[][] => {
    if (image.kind === 'same') return [];
    const at = index + 1;
    if (image.kind === 'changed') {
      return [[say`image ${at} of ${total}  ${image.id}`, ...rows(image.devices)]];
    }
    return [[say`image ${at} of ${total}  ${image.id}  ${image.kind}`]];
  });

  const sections = [head(comparison), ...blocks, [summary(comparison)]];
  return sections
    .filter((section) => section.length > 0)
    .map((section) => section.join('\n'))
    .join('\n\n');
}
