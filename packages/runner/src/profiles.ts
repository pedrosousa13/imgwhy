import type { DeviceProfile } from '@imgwhy/core';

/**
 * The device set every run uses unless `imgwhy.config.json` replaces it.
 *
 * Ordered small to large, because that is the order a trace reads best in: the
 * narrow phones need the most pixels per CSS pixel and pick the largest files.
 */
export const DEFAULT_PROFILES: DeviceProfile[] = [
  { id: 'iphone-se', name: 'iPhone SE', viewport: { width: 375, height: 667 }, dpr: 2 },
  { id: 'iphone-15-pro', name: 'iPhone 15 Pro', viewport: { width: 393, height: 852 }, dpr: 3 },
  { id: 'pixel-8', name: 'Pixel 8', viewport: { width: 412, height: 915 }, dpr: 2.625 },
  { id: 'ipad', name: 'iPad', viewport: { width: 820, height: 1180 }, dpr: 2 },
  { id: 'desktop', name: 'Desktop', viewport: { width: 1440, height: 900 }, dpr: 1 },
];
