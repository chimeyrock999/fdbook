import type { IncomingMessage } from 'node:http';

// The Studio answers only to its own origin. Host stops DNS rebinding (a
// foreign name resolving to 127.0.0.1); Origin and fetch metadata stop other
// pages, including other local dev servers, from calling the API or opening
// a socket. Requests without an Origin (curl, agents) still pass on Host.
export function rejectForeignRequest(request: IncomingMessage, port: number): string | null {
  const ownHosts = [`127.0.0.1:${String(port)}`, `localhost:${String(port)}`];
  if (!ownHosts.includes(request.headers.host ?? '')) return 'unexpected Host header';
  const origin = request.headers.origin;
  if (origin !== undefined && !ownHosts.some((host) => origin === `http://${host}`)) return 'foreign Origin';
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 'cross-site request';
  return null;
}
