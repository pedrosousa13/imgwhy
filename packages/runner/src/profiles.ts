import type { DeviceProfile } from '@imgwhy/core';

/**
 * The one profile this slice ships.
 *
 * The design names five defaults; issue #2 adds the other four and lets a
 * project replace the set. Until then every run is this desktop.
 */
export const DESKTOP_PROFILE: DeviceProfile = {
  id: 'desktop',
  name: 'Desktop',
  viewport: { width: 1440, height: 900 },
  dpr: 1,
};
