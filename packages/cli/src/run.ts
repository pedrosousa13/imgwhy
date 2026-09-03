import type { Capture, DeviceProfile } from '@imgwhy/core';
import { loadDeviceProfiles } from './config.js';
import { formatCapture } from './trace.js';
import { parsePageUrl } from './url.js';

export type CaptureFn = (options: { url: string; profiles: DeviceProfile[] }) => Promise<Capture>;

/** What the command writes and the status it leaves behind. */
export type Outcome = { code: number; stdout: string; stderr: string };

const USAGE = 'usage: imgwhy <url>';

const fail = (message: string): Outcome => ({ code: 1, stdout: '', stderr: `${message}\n` });

/**
 * Render one page as every device profile and trace every image on it.
 *
 * The URL and the device set are both checked before anything opens a browser,
 * so a typo in either costs no browser start.
 */
export async function run(
  argv: string[],
  capture: CaptureFn,
  /**
   * The directory the command was run in, defaulted as a relative path rather
   * than through `process.cwd()`. That call throws where the directory has
   * been deleted under the command, and a throw in a default parameter leaves
   * `run` with no Outcome to return; `loadDeviceProfiles` resolves this inside
   * its own try, so the same failure comes back as a message.
   */
  cwd: string = '.',
): Promise<Outcome> {
  const [raw, ...rest] = argv;
  if (raw === undefined || rest.length > 0) return fail(USAGE);

  const target = parsePageUrl(raw);
  if (!target.ok) return fail(target.message);

  const devices = loadDeviceProfiles(cwd);
  if (!devices.ok) return fail(devices.message);

  let captured: Capture;
  try {
    captured = await capture({ url: target.url, profiles: devices.profiles });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  if (!captured.runs.some((deviceRun) => deviceRun.images.length > 0)) {
    return fail(`${captured.url} carries no <img> element, so there is nothing to explain.`);
  }

  return { code: 0, stdout: `${formatCapture(captured)}\n`, stderr: '' };
}
