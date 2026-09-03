import type { Capture, DeviceProfile } from '@imgwhy/core';
import { parseArgs } from './args.js';
import { loadDeviceProfiles } from './config.js';
import { messageOf } from './message.js';
import { serializeCapture, writeCapture, writeReport } from './out.js';
import { formatCapture } from './trace.js';
import { parsePageUrl } from './url.js';

export type CaptureFn = (options: { url: string; profiles: DeviceProfile[] }) => Promise<Capture>;

/** What the command writes and the status it leaves behind. */
export type Outcome = { code: number; stdout: string; stderr: string };

const fail = (message: string): Outcome => ({ code: 1, stdout: '', stderr: `${message}\n` });

/**
 * Render one page as every device profile and trace every image on it.
 *
 * The command line, the URL and the device set are all checked before anything
 * opens a browser, so a typo in any of them costs no browser start.
 *
 * The Capture goes wherever the line asked and nowhere else. `--out` and
 * `--report` write their files before anything is printed, because a run that
 * could not produce a file it was told to produce has failed, and printing a
 * trace first would say otherwise.
 *
 * A page carrying no `<img>` is still a page, and a Capture of it is still a
 * Capture — an image that has gone missing is exactly the diff someone keeps
 * Captures to see. So the artifacts are produced as asked. The human trace is
 * the only output with nothing to write, so it is the only one that reports
 * the absence and leaves a failing status behind.
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
  const args = parseArgs(argv);
  if (!args.ok) return fail(args.message);

  const target = parsePageUrl(args.url);
  if (!target.ok) return fail(target.message);

  const devices = loadDeviceProfiles(cwd);
  if (!devices.ok) return fail(devices.message);

  let captured: Capture;
  try {
    captured = await capture({ url: target.url, profiles: devices.profiles });
  } catch (error) {
    return fail(messageOf(error));
  }

  if (args.out !== null) {
    const written = writeCapture(args.out, captured);
    if (!written.ok) return fail(written.message);
  }

  if (args.report !== null) {
    const written = writeReport(args.report, captured);
    if (!written.ok) return fail(written.message);
  }

  if (!captured.runs.some((deviceRun) => deviceRun.images.length > 0)) {
    // An artifact asked for and produced is a run that did its job, whatever
    // the page turned out to hold.
    const asked = args.json || args.out !== null || args.report !== null;
    return {
      code: asked ? 0 : 1,
      stdout: args.json ? serializeCapture(captured) : '',
      stderr: `${captured.url} carries no <img> element, so there is nothing to explain.\n`,
    };
  }

  const stdout = args.json ? serializeCapture(captured) : `${formatCapture(captured)}\n`;
  return { code: 0, stdout, stderr: '' };
}
