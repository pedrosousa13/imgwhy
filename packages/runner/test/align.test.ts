import type { CapturedImage, DeviceRun } from '@imgwhy/core';
import { parseSrcset } from '@imgwhy/core';
import { describe, expect, it } from 'vitest';
import { alignImageIds, familyKey } from '../src/align.js';

const imageAt = (path: string, srcset: string): CapturedImage => ({
  id: path,
  selector: path,
  candidates: parseSrcset(srcset),
  sizes: '100vw',
  sizesSource: 'img',
  renderedWidth: 320,
  currentSrc: '',
  naturalWidth: 320,
  transferBytes: null,
  loading: null,
});

/** `backgroundImageCount` plays no part in aligning ids, so it is always zero. */
const runOf = (deviceId: string, ...images: CapturedImage[]): DeviceRun => ({
  deviceId,
  images,
  backgroundImageCount: 0,
});

const HERO = '/i/hero-640.png 640w, /i/hero-1080.png 1080w';
const PROMO = '/i/promo-640.png 640w, /i/promo-1080.png 1080w';

describe('familyKey', () => {
  it('is the set of URLs a srcset offers, so the same offer keys the same', () => {
    expect(familyKey(parseSrcset(HERO))).toBe(
      familyKey(parseSrcset('/i/hero-1080.png 1080w, /i/hero-640.png 640w')),
    );
  });

  it('separates two images that offer different URLs', () => {
    expect(familyKey(parseSrcset(HERO))).not.toBe(familyKey(parseSrcset(PROMO)));
  });

  it('ignores the descriptors, because a render may re-describe the same files', () => {
    expect(familyKey(parseSrcset('/i/a.png 1x, /i/b.png 2x'))).toBe(
      familyKey(parseSrcset('/i/a.png 640w, /i/b.png 1280w')),
    );
  });

  it('has no family for an image with no srcset', () => {
    expect(familyKey([])).toBeNull();
  });
});

describe('alignImageIds', () => {
  it('keeps the DOM path as the id while the path holds', () => {
    const aligned = alignImageIds([
      runOf('desktop', imageAt('html > body > main > img', HERO)),
      runOf('iphone-se', imageAt('html > body > main > img', HERO)),
    ]);

    expect(aligned.map((run) => run.images.map((i) => i.id))).toEqual([
      ['html > body > main > img'],
      ['html > body > main > img'],
    ]);
  });

  it('holds the id when a render reparents the image, and leaves the selector local', () => {
    const aligned = alignImageIds([
      runOf('desktop', imageAt('html > body > main > img', HERO)),
      runOf('iphone-se', imageAt('html > body > main > div > img', HERO)),
    ]);

    expect(aligned[1]?.images[0]?.id).toBe('html > body > main > img');
    // The selector still says where the image was in *this* render.
    expect(aligned[1]?.images[0]?.selector).toBe('html > body > main > div > img');
  });

  it('does not merge two images that only happen to move to the same place', () => {
    const aligned = alignImageIds([
      runOf('desktop', imageAt('html > body > main > img', HERO)),
      runOf('iphone-se', imageAt('html > body > nav > img', PROMO)),
    ]);

    expect(aligned[1]?.images[0]?.id).toBe('html > body > nav > img');
  });

  it('keeps two images that offer the same files apart within one render', () => {
    const aligned = alignImageIds([
      runOf(
        'desktop',
        imageAt('html > body > img:nth-of-type(1)', HERO),
        imageAt('html > body > img:nth-of-type(2)', HERO),
      ),
    ]);

    expect(aligned[0]?.images.map((i) => i.id)).toEqual([
      'html > body > img:nth-of-type(1)',
      'html > body > img:nth-of-type(2)',
    ]);
  });

  it('takes the id of an image first seen in a later run from that run', () => {
    const aligned = alignImageIds([
      runOf('desktop', imageAt('html > body > main > img', HERO)),
      runOf('iphone-se', imageAt('html > body > main > img', HERO), imageAt('html > body > aside > img', PROMO)),
      runOf('ipad', imageAt('html > body > main > img', HERO), imageAt('html > body > footer > img', PROMO)),
    ]);

    expect(aligned[2]?.images.map((i) => i.id)).toEqual([
      'html > body > main > img',
      'html > body > aside > img',
    ]);
  });

  it('leaves an image with no srcset on its DOM path, because it has no family', () => {
    const aligned = alignImageIds([
      runOf('desktop', imageAt('html > body > header > img', '')),
      runOf('iphone-se', imageAt('html > body > nav > img', '')),
    ]);

    expect(aligned[1]?.images[0]?.id).toBe('html > body > nav > img');
  });
});
