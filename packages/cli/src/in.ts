import { readFileSync } from 'node:fs';
import type { Candidate, Capture, CapturedImage, DeviceProfile, DeviceRun } from '@imgwhy/core';
import { messageOf } from './message.js';
import { escape } from './say.js';

export type LoadedCapture = { ok: true; capture: Capture } | { ok: false; message: string };

/** One value read out of the file, or the message that says why it was not. */
type Read<T> = { ok: true; value: T } | { ok: false; message: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isName = (value: unknown): value is string => typeof value === 'string' && value !== '';

/**
 * A viewport of zero pixels renders nothing, so a size has to be above 0. The
 * device ratio is here too: a page rendered at a ratio of zero needs no pixels.
 *
 * `Number.isFinite` is not a formality here. JSON has no word for infinity and
 * `JSON.parse('1e999')` still returns one, so a check that only compared would
 * take a device ratio of Infinity and multiply every width by it.
 */
const isSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * A measurement or a weight, which zero is a real value of: an image the page
 * hid is 0px wide, and a response can arrive empty.
 */
const isMeasure = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isMeasureOrNull = (value: unknown): value is number | null =>
  value === null || isMeasure(value);

/** A count of elements, which is whole or it counted something else. */
const isCount = (value: unknown): value is number => isMeasure(value) && Number.isInteger(value);

const isTextOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isSizesSource = (value: unknown): value is CapturedImage['sizesSource'] =>
  value === 'img' || value === 'source';

const isLoading = (value: unknown): value is CapturedImage['loading'] =>
  value === null || value === 'lazy' || value === 'eager';

/**
 * One entry of a recorded `srcset`.
 *
 * `w` and `x` are checked against null as well as against a number, and a
 * missing field is neither: `parseSrcset` writes both keys on every candidate,
 * so a candidate short of one was not written by this tool and is not read as
 * though the descriptor had been absent.
 *
 * `url` and `raw` may be empty, and that is not laxity. Both are text the page
 * wrote, an empty one says the page wrote nothing there, and refusing it would
 * refuse a Capture over a string nothing downstream reads as a name.
 */
function readCandidate(at: string, value: unknown): Read<Candidate> {
  const fail = (message: string): Read<Candidate> => ({ ok: false, message: `${at}${message}` });

  if (!isObject(value)) return fail(' must be an object describing one candidate');
  if (typeof value['url'] !== 'string') return fail('.url must be a string');
  if (!isMeasureOrNull(value['w'])) return fail('.w must be a number at or above 0, or null');
  if (!isMeasureOrNull(value['x'])) return fail('.x must be a number at or above 0, or null');
  if (typeof value['raw'] !== 'string') return fail('.raw must be a string');

  return {
    ok: true,
    value: { url: value['url'], w: value['w'], x: value['x'], raw: value['raw'] },
  };
}

/**
 * One image as one device saw it, field by field in the order the type names
 * them, so the file and the checks read alike.
 *
 * `currentSrc` may be empty, because an image that never loaded has none, and
 * `trace.ts` already prints that case as `(none)`. `id` and `selector` may
 * not: they are what an image is known by, and an empty one names nothing.
 */
function readImage(at: string, value: unknown): Read<CapturedImage> {
  const fail = (message: string): Read<CapturedImage> => ({
    ok: false,
    message: `${at}${message}`,
  });

  if (!isObject(value)) return fail(' must be an object describing one image');
  if (!isName(value['id'])) return fail('.id must be a non-empty string');
  if (!isName(value['selector'])) return fail('.selector must be a non-empty string');
  if (!Array.isArray(value['candidates'])) return fail('.candidates must be an array');

  const candidates: Candidate[] = [];
  for (const [index, entry] of value['candidates'].entries()) {
    const candidate = readCandidate(`${at}.candidates[${index}]`, entry);
    if (!candidate.ok) return candidate;
    candidates.push(candidate.value);
  }

  if (!isTextOrNull(value['sizes'])) return fail('.sizes must be a string or null');
  if (!isSizesSource(value['sizesSource'])) return fail('.sizesSource must be "img" or "source"');
  if (!isMeasure(value['renderedWidth'])) {
    return fail('.renderedWidth must be a number at or above 0');
  }
  if (typeof value['declaresWidth'] !== 'boolean') {
    return fail('.declaresWidth must be true or false');
  }
  if (typeof value['currentSrc'] !== 'string') return fail('.currentSrc must be a string');
  if (!isMeasure(value['naturalWidth'])) {
    return fail('.naturalWidth must be a number at or above 0');
  }
  if (!isMeasureOrNull(value['transferBytes'])) {
    return fail('.transferBytes must be a number at or above 0, or null');
  }
  if (!isLoading(value['loading'])) return fail('.loading must be "lazy", "eager" or null');

  return {
    ok: true,
    value: {
      id: value['id'],
      selector: value['selector'],
      candidates,
      sizes: value['sizes'],
      sizesSource: value['sizesSource'],
      renderedWidth: value['renderedWidth'],
      declaresWidth: value['declaresWidth'],
      currentSrc: value['currentSrc'],
      naturalWidth: value['naturalWidth'],
      transferBytes: value['transferBytes'],
      loading: value['loading'],
    },
  };
}

/**
 * One device profile as the Capture describes it.
 *
 * The checks are `loadDeviceProfiles`'s, several of the messages word for
 * word, and they are re-derived here rather than shared with it. What the two
 * readers differ on is the thing a check mostly is — the sentence it hands a
 * reader — because they answer to files of different provenance. A config file
 * is one the project wrote, so `loadDeviceProfiles` quotes it back: `.id
 * repeats "kiosk"` names the id at fault. A Capture is a file somebody may
 * have been sent, so this reader quotes nothing, and `readParsed` says why. A
 * shared check would have to hold both rules at once, and the strict one costs
 * the config file a message that is better for being able to quote.
 *
 * The predicates stay with the checks they belong to. `isObject`, `isName` and
 * `isSize` are a line each, and two checks that owe their readers different
 * sentences are not made one check by sharing the three lines under them.
 */
function readDevice(at: string, value: unknown): Read<DeviceProfile> {
  const fail = (message: string): Read<DeviceProfile> => ({
    ok: false,
    message: `${at}${message}`,
  });

  if (!isObject(value)) return fail(' must be an object describing one device');
  // A viewport that is not an object is reported as the width it does not
  // carry, the way the config file's is: the field a reader has to fix is the
  // measurement, whether the object around it was written or not.
  const viewport = isObject(value['viewport']) ? value['viewport'] : {};

  if (!isName(value['id'])) return fail('.id must be a non-empty string');
  if (!isName(value['name'])) return fail('.name must be a non-empty string');
  if (!isSize(viewport['width'])) return fail('.viewport.width must be a number above 0');
  if (!isSize(viewport['height'])) return fail('.viewport.height must be a number above 0');
  if (!isSize(value['dpr'])) return fail('.dpr must be a number above 0');

  return {
    ok: true,
    value: {
      id: value['id'],
      name: value['name'],
      viewport: { width: viewport['width'], height: viewport['height'] },
      dpr: value['dpr'],
    },
  };
}

/**
 * What one device saw, and the device it claims to be.
 *
 * The id is checked against the set the Capture describes here rather than
 * later, because a run naming a device nothing describes is a file that cannot
 * be read at all: every reader of a Capture keys the devices by that id, and
 * `trace.ts` throws where it finds one it cannot. A message is what this
 * boundary owes instead.
 */
function readRun(at: string, value: unknown, described: ReadonlySet<string>): Read<DeviceRun> {
  const fail = (message: string): Read<DeviceRun> => ({ ok: false, message: `${at}${message}` });

  if (!isObject(value)) return fail(' must be an object describing one device run');
  if (!isName(value['deviceId'])) return fail('.deviceId must be a non-empty string');
  if (!described.has(value['deviceId'])) {
    return fail('.deviceId names a device the capture does not describe');
  }
  if (!Array.isArray(value['images'])) return fail('.images must be an array');

  const images: CapturedImage[] = [];
  for (const [index, entry] of value['images'].entries()) {
    const image = readImage(`${at}.images[${index}]`, entry);
    if (!image.ok) return image;
    images.push(image.value);
  }

  if (!isCount(value['backgroundImageCount'])) {
    return fail('.backgroundImageCount must be a whole number at or above 0');
  }

  return {
    ok: true,
    value: {
      deviceId: value['deviceId'],
      images,
      backgroundImageCount: value['backgroundImageCount'],
    },
  };
}

/**
 * Read a parsed Capture, or say which field stopped it.
 *
 * The devices come first because the runs are checked against them, and a run
 * naming a device the file does not carry is refused rather than dropped: an
 * id that went missing is the sort of thing a reader has to see, and a reader
 * shown four of five devices would answer a question nobody put.
 *
 * Two profiles sharing an id, and two runs claiming one device, are refused
 * for the same reason in the other direction. Either one leaves a device with
 * two answers and no way to tell which is its own, and the writer produces
 * neither: one profile per id, one run per profile.
 *
 * Every message names the field and the index it sat at, and none of them
 * quotes what the field held. That is the boundary's own rule and not a
 * stylistic one: every string in a Capture came off somebody's page, a message
 * goes to stderr unescaped, and a value quoted into one is a page choosing
 * what a terminal does. The index is what a reader needs to find the field in
 * a long file, and it is a number this code counted.
 */
function readParsed(file: string, parsed: unknown): LoadedCapture {
  const fail = (message: string): LoadedCapture => ({ ok: false, message: `${file}${message}` });

  if (!isObject(parsed)) return fail(' must be an object describing one capture');
  if (!isName(parsed['url'])) return fail(': url must be a non-empty string');
  // Not parsed as a date, and deliberately. Nothing reads it as one, and a
  // Capture refused over the spelling of a timestamp would be a Capture
  // refused for a field no answer depends on.
  if (!isName(parsed['capturedAt'])) return fail(': capturedAt must be a non-empty string');

  const devices = parsed['devices'];
  if (!Array.isArray(devices) || devices.length === 0) {
    return fail(' must carry a "devices" array holding at least one profile');
  }
  const runs = parsed['runs'];
  if (!Array.isArray(runs)) return fail(' must carry a "runs" array');

  const profiles: DeviceProfile[] = [];
  const describedAt = new Map<string, number>();
  for (const [index, entry] of devices.entries()) {
    const device = readDevice(`${file}: devices[${index}]`, entry);
    if (!device.ok) return device;
    const first = describedAt.get(device.value.id);
    if (first !== undefined) {
      return fail(
        `: devices[${index}].id repeats the id devices[${first}] carries, ` +
          'and every profile needs its own',
      );
    }
    describedAt.set(device.value.id, index);
    profiles.push(device.value);
  }

  const rendered: DeviceRun[] = [];
  const ranAt = new Map<string, number>();
  for (const [index, entry] of runs.entries()) {
    const run = readRun(`${file}: runs[${index}]`, entry, new Set(describedAt.keys()));
    if (!run.ok) return run;
    const first = ranAt.get(run.value.deviceId);
    if (first !== undefined) {
      return fail(
        `: runs[${index}].deviceId repeats the device runs[${first}] carries, ` +
          'and every device runs once',
      );
    }
    ranAt.set(run.value.deviceId, index);
    rendered.push(run.value);
  }

  return {
    ok: true,
    capture: {
      url: parsed['url'],
      capturedAt: parsed['capturedAt'],
      devices: profiles,
      runs: rendered,
    },
  };
}

/**
 * Read a Capture back off disk, or say why it is not one.
 *
 * `out.ts` writes a Capture and this reads one, and the two are not mirror
 * images. A Capture the runner wrote is a file the person at the keyboard
 * kept; a Capture handed to this function is a file they may have been sent,
 * and every string in it came off somebody's page — the URL a redirect chose,
 * a `sizes` attribute, a DOM selector, a candidate URL. So nothing is trusted
 * because it parsed. Every field is checked for its type and its range before
 * anything reads it, the way `loadDeviceProfiles` checks a config file, and a
 * file that fails one check is a message rather than a throw or a wrong answer.
 *
 * The Capture that comes back is built field by field out of values that
 * passed a check. Nothing from the file is spread or kept whole, so a key the
 * type does not name — `__proto__` included — reaches no caller.
 *
 * ## The path
 *
 * `out.ts` states the provenance rule for writing: no part of the path may
 * come from the page. A Capture arriving as input is the second way that rule
 * can break, and this is where it would break. So the filesystem is touched
 * once, here, at the path the caller named, and before a byte of the file has
 * been parsed. Nothing read out of the Capture is joined, resolved or opened,
 * and this module names no path module to do it with — `in.test.ts` reads that
 * off the source rather than trusting the sentence.
 *
 * Confinement is not the property to hold, and adding it would be wrong for
 * the reason `out.ts` gives about writing. `imgwhy diff ~/captures/before.json`
 * is the ordinary use, and the path is an argument the person at the keyboard
 * typed. The config file is the case that earns a confinement check, because
 * its name is one an untrusted repository controls; a path on the command line
 * is not.
 *
 * ## What is not normalised
 *
 * Nothing here escapes, strips or refuses a string for its content. A page can
 * legitimately put a control character in an `alt` or a `sizes` attribute, and
 * a tool whose subject is what the page said may not quietly drop part of it —
 * a Capture is machine input, and a reader typing a recorded `sizes` string
 * into the report has to get the string the page wrote. `trace.ts` already
 * settles where the spelling out belongs: at the point a string is displayed,
 * once, so that one page produces one spelling across a run's outputs.
 * Escaping at this boundary would give the same attribute a second spelling
 * and still leave every later writer to escape its own output.
 *
 * What this boundary owes instead is that nothing it writes lets a page act on
 * a terminal: `readParsed` says why no message quotes a value, and the one
 * message that does carry bytes off the file — the JSON parser's own — is
 * spelled out where it is built. Whatever displays a Capture this returns owes
 * the same care `trace.ts` takes.
 */
export function readCapture(path: string): LoadedCapture {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { ok: false, message: `${path} could not be read: ${messageOf(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // The one message here that carries bytes off the file, so the one that
    // is escaped. `JSON.parse` quotes the character it stopped at and the
    // bytes around it into what it throws, so a file opening with an ESC
    // hands this message a whole terminal sequence: the quoting `readParsed`
    // refuses to do, done by the parser instead and reaching stderr all the
    // same.
    //
    // Written out rather than dropped, for the reason `say.ts` gives about
    // writing a control character rather than discarding it: the position and
    // the character at fault are what a reader with a large broken file has to
    // work from, and they are the one thing the parser knows that this module
    // does not. The path is left as it came, because it is the argument the
    // person at the keyboard typed rather than anything the file said.
    return { ok: false, message: `${path} is not valid JSON: ${escape(messageOf(error))}` };
  }

  return readParsed(path, parsed);
}
