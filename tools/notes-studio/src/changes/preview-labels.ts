import type { BuildState } from '../api/preview';

// A preview's build as the Changes view and the header name it.
export const BUILD_LABELS: Record<BuildState | 'unpushed', string> = {
  unpushed: 'Not pushed',
  waiting: 'Waiting for Cloudflare',
  building: 'Building',
  ready: 'Ready',
  failed: 'Failed',
  none: 'No build',
  unknown: 'Status unknown',
};
