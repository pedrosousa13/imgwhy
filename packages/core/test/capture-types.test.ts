import { describe, expect, it } from 'vitest';
import type { Capture, CapturedImage, DeviceProfile, DeviceRun } from '../src/index.js';
import { CAPTURE_SCHEMA, parseSrcset, resolveSizes, selectCandidate } from '../src/index.js';

const desktop: DeviceProfile = {
  id: 'desktop',
  name: 'Desktop',
  viewport: { width: 1440, height: 900 },
  dpr: 1,
};

const hero: CapturedImage = {
  id: 'body>main>img:nth-of-type(1)',
  selector: 'main > img',
  candidates: parseSrcset('/i/a-640.png 640w, /i/a-1080.png 1080w'),
  sizes: '100vw',
  sizesSource: 'img',
  renderedWidth: 640,
  declaresWidth: false,
  currentSrc: 'https://example.com/i/a-1080.png',
  naturalWidth: 1080,
  transferBytes: 41_233,
  loading: 'eager',
};

const run: DeviceRun = { deviceId: 'desktop', images: [hero], backgroundImageCount: 0 };

const capture: Capture = {
  url: 'https://example.com',
  capturedAt: '2026-09-03T00:00:00.000Z',
  // `capturedAt` is when, `readAs` is how. The one method there is names
  // itself rather than reading as a flag, so a later reading taken some other
  // way is a second name here and not a second boolean.
  readAs: 'scrolled',
  version: { schema: CAPTURE_SCHEMA, producedBy: '0.0.0' },
  devices: [desktop],
  runs: [run],
};

describe('the Capture seam', () => {
  it('survives a JSON round trip, because a Capture is a file on disk', () => {
    expect(JSON.parse(JSON.stringify(capture)) as Capture).toEqual(capture);
  });

  it('carries enough to replay the trace through core', () => {
    const image = capture.runs[0].images[0];
    const device = capture.devices[0];
    const resolution = resolveSizes(image.sizes, device.viewport.width, false);

    expect(resolution.kind).toBe('length');
    expect(selectCandidate(image.candidates, 1440, device.dpr)?.raw).toBe('1080w');
  });

  it('says what shape it is and which release wrote it, on two separate numbers', () => {
    // The schema is the shape, so it is the constant these types describe. The
    // release is a string a writer supplies, because core cannot know it: a
    // change to the arithmetic here alters the numbers a Capture carries
    // without altering one field of it.
    expect(capture.version.schema).toBe(CAPTURE_SCHEMA);
    expect(CAPTURE_SCHEMA).toBe(2);
    expect(typeof capture.version.producedBy).toBe('string');
  });

  it('allows a missing transfer size and a missing loading attribute', () => {
    const unknown: CapturedImage = { ...hero, transferBytes: null, loading: null };
    expect(unknown.transferBytes).toBeNull();
  });
});
