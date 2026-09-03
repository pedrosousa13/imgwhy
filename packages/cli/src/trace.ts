import type { Candidate, Capture, CapturedImage, Resolution } from '@imgwhy/core';
import { resolveSizes, selectCandidate } from '@imgwhy/core';

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

const describe = (resolution: Resolution, renderedWidth: number): string => {
  switch (resolution.kind) {
    case 'auto':
      return `${Math.round(renderedWidth)}px (real layout width)`;
    case 'error':
      return 'a length nothing could read';
    default:
      return `${Math.round(resolution.px)}px`;
  }
};

/** The CSS width selection runs against, or null where nothing resolved. */
const sizesPxOf = (resolution: Resolution, renderedWidth: number): number | null => {
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
 * Explain one image as arithmetic a reader can check, in the wording of the
 * reference implementation.
 */
export function formatTrace(capture: Capture, image: CapturedImage): string {
  // One profile in this slice, so one device explains the whole capture.
  const device = capture.devices[0];
  if (!device) throw new Error('a capture with no device profile explains nothing');
  const viewportWidth = device.viewport.width;
  const { dpr } = device;

  const lines = [
    `url        ${capture.url}`,
    `device     ${device.name} — ${viewportWidth}×${device.viewport.height} at DPR ${dpr}`,
    `element    ${image.selector}${image.sizesSource === 'source' ? ' (srcset from <source>)' : ''}`,
    `candidates ${image.candidates.map((c) => c.raw).join(', ')}`,
    `rendered   ${Math.round(image.renderedWidth)} css px${image.loading === 'lazy' ? ' · loading=lazy' : ''}`,
    '',
  ];

  let picked: Candidate | null;
  if (image.candidates.some((c) => c.w != null)) {
    const resolution = resolveSizes(image.sizes, viewportWidth);
    const sizesPx = sizesPxOf(resolution, image.renderedWidth);
    picked = selectCandidate(image.candidates, sizesPx, dpr);

    lines.push(`sizes ${image.sizes ?? '(absent)'}`);
    lines.push(`  clause used  ${resolution.clause}`);
    lines.push(
      `  resolves to  ${describe(resolution, image.renderedWidth)} at viewport ${viewportWidth}`,
    );
    if (sizesPx !== null) {
      lines.push(`  × DPR ${dpr}  =  ${Math.round(sizesPx * dpr)} physical pixels needed`);
    }
    lines.push(`  smallest candidate ≥ that  →  ${picked ? picked.raw : '—'}`);
  } else {
    picked = selectCandidate(image.candidates, null, dpr);
    lines.push(
      `x descriptors only — sizes ignored. Device DPR ${dpr} → ${picked ? picked.raw : '—'}`,
    );
  }

  const differs =
    picked !== null &&
    image.currentSrc !== '' &&
    absolute(picked.url, capture.url) !== image.currentSrc;

  lines.push(`predicted  ${picked ? fileOf(picked.url, capture.url) : '—'}`);
  lines.push(
    `actual     ${image.currentSrc ? fileOf(image.currentSrc, capture.url) : '(none)'}` +
      (differs ? '   ← differs: a larger variant was already cached, so no new pick ran' : ''),
  );

  return lines.join('\n');
}
