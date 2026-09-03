import type { Capture, DeviceProfile } from '@imgwhy/core';
import { DESKTOP_PROFILE } from '@imgwhy/runner';
import { formatTrace } from './trace.js';
import { parsePageUrl } from './url.js';

export type CaptureFn = (options: { url: string; profile: DeviceProfile }) => Promise<Capture>;

/** What the command writes and the status it leaves behind. */
export type Outcome = { code: number; stdout: string; stderr: string };

const USAGE = 'usage: imgwhy <url>';

const fail = (message: string): Outcome => ({ code: 1, stdout: '', stderr: `${message}\n` });

/**
 * Render one page as one device and trace the first image that has a choice to
 * make. The URL is checked before anything opens a browser.
 */
export async function run(argv: string[], capture: CaptureFn): Promise<Outcome> {
  const [raw, ...rest] = argv;
  if (raw === undefined || rest.length > 0) return fail(USAGE);

  const target = parsePageUrl(raw);
  if (!target.ok) return fail(target.message);

  let captured: Capture;
  try {
    captured = await capture({ url: target.url, profile: DESKTOP_PROFILE });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  const traced = captured.runs[0]?.images.find((image) => image.candidates.length > 1);
  if (!traced) {
    return fail(
      `No image on ${captured.url} carries more than one srcset candidate, so nothing selects a file.`,
    );
  }

  return { code: 0, stdout: `${formatTrace(captured, traced)}\n`, stderr: '' };
}
