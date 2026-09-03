import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILES } from '../src/index.js';

describe('the default device set', () => {
  it('ships the five profiles the design names, in order', () => {
    expect(DEFAULT_PROFILES).toEqual([
      { id: 'iphone-se', name: 'iPhone SE', viewport: { width: 375, height: 667 }, dpr: 2 },
      {
        id: 'iphone-15-pro',
        name: 'iPhone 15 Pro',
        viewport: { width: 393, height: 852 },
        dpr: 3,
      },
      { id: 'pixel-8', name: 'Pixel 8', viewport: { width: 412, height: 915 }, dpr: 2.625 },
      { id: 'ipad', name: 'iPad', viewport: { width: 820, height: 1180 }, dpr: 2 },
      { id: 'desktop', name: 'Desktop', viewport: { width: 1440, height: 900 }, dpr: 1 },
    ]);
  });
});
