import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { DeviceProfile } from '@imgwhy/core';
import { DEFAULT_PROFILES } from '@imgwhy/runner';
import { messageOf } from './message.js';

export const CONFIG_FILE = 'imgwhy.config.json';

export type LoadedProfiles =
  | { ok: true; profiles: DeviceProfile[] }
  | { ok: false; message: string };

/**
 * Resolve imgwhy's one config file against the working directory, or refuse it.
 *
 * imgwhy reads one file from the directory it was run in, and nothing else.
 * The check is here rather than left implicit because the name is not the only
 * way out of a directory: `imgwhy.config.json` can itself be a symlink, and a
 * repository you cloned can carry one that points at your home directory. The
 * error message quotes the file, so reading the wrong file leaks it.
 *
 * The name is `CONFIG_FILE` and nothing else — there is no parameter for it,
 * so no caller can hand this an untrusted name. Both the joined path and what
 * it really points at still have to land inside the directory, which is what
 * rules out `../`, an absolute path, and a symlink that leaves. The absent
 * branch returns `target` unresolved, and that is safe only because `target`
 * was already checked to be inside; keep the check above it. Null means
 * refused.
 *
 * One escape remains that no path check can see: a hard link inside the
 * directory to a file outside it, which `realpathSync` reports as the path
 * inside.
 *
 * Throws when `dir` itself cannot be resolved, which is a deleted or
 * unreadable working directory. The caller turns that into a message.
 */
export function configPathInside(dir: string): string | null {
  const root = realpathSync(dir);
  const inside = (path: string): boolean => path === root || path.startsWith(root + sep);

  const target = resolve(root, CONFIG_FILE);
  if (!inside(target)) return null;

  let real: string;
  try {
    real = realpathSync(target);
  } catch {
    // Nothing there to follow. The caller's read reports the absence.
    return target;
  }
  return inside(real) ? real : null;
}

/**
 * Read the device set for a run.
 *
 * No config file means the default set. A config file replaces that set
 * outright — it does not merge, because a project that names its devices has
 * said which devices it cares about.
 *
 * A file that is there but unreadable is an error, never a quiet fall back to
 * the defaults: a run that silently ignored the config would report the wrong
 * devices and look right doing it. So is a working directory that is not
 * there: every failure here leaves the command with something to print.
 */
export function loadDeviceProfiles(dir: string): LoadedProfiles {
  let path: string | null;
  try {
    path = configPathInside(dir);
  } catch (error) {
    return { ok: false, message: `the working directory could not be read: ${messageOf(error)}` };
  }

  if (path === null) {
    return {
      ok: false,
      message: `${CONFIG_FILE} resolves outside the working directory, so imgwhy will not read it`,
    };
  }

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: true, profiles: DEFAULT_PROFILES };
    }
    return { ok: false, message: `${CONFIG_FILE} could not be read: ${messageOf(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, message: `${CONFIG_FILE} is not valid JSON: ${messageOf(error)}` };
  }

  return readDevices(parsed);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A viewport of zero pixels renders nothing, so a size has to be above 0. */
const isSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isName = (value: unknown): value is string => typeof value === 'string' && value !== '';

function readDevices(parsed: unknown): LoadedProfiles {
  const devices = isObject(parsed) ? parsed['devices'] : undefined;
  if (!Array.isArray(devices) || devices.length === 0) {
    return {
      ok: false,
      message: `${CONFIG_FILE} must carry a "devices" array holding at least one profile`,
    };
  }

  const profiles: DeviceProfile[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of devices.entries()) {
    const at = `${CONFIG_FILE}: devices[${index}]`;
    const fail = (message: string): LoadedProfiles => ({ ok: false, message: `${at}${message}` });

    if (!isObject(entry)) return fail(' must be an object describing one device');
    const viewport = isObject(entry['viewport']) ? entry['viewport'] : {};

    if (!isName(entry['id'])) return fail('.id must be a non-empty string');
    if (seen.has(entry['id'])) {
      return fail(`.id repeats "${entry['id']}", and every profile needs its own`);
    }
    if (!isName(entry['name'])) return fail('.name must be a non-empty string');
    if (!isSize(viewport['width'])) return fail('.viewport.width must be a number above 0');
    if (!isSize(viewport['height'])) return fail('.viewport.height must be a number above 0');
    if (!isSize(entry['dpr'])) return fail('.dpr must be a number above 0');

    seen.add(entry['id']);
    profiles.push({
      id: entry['id'],
      name: entry['name'],
      viewport: { width: viewport['width'], height: viewport['height'] },
      dpr: entry['dpr'],
    });
  }

  return { ok: true, profiles };
}
