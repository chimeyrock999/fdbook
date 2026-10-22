import type { IncomingMessage } from 'node:http';

// The Studio answers only to its own origin. Host stops DNS rebinding (a
// foreign name resolving to 127.0.0.1); Origin and fetch metadata stop other
// pages, including other local dev servers, from calling the API or opening
// a socket. Requests without an Origin (curl, agents) still pass on Host.
export function rejectForeignRequest(request: IncomingMessage, hosts: string[]): string | null {
  if (!hosts.includes(request.headers.host ?? '')) return 'unexpected Host header';
  const origin = request.headers.origin;
  if (origin !== undefined && !hosts.some((host) => origin === `http://${host}`)) return 'foreign Origin';
  const site = request.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 'cross-site request';
  return null;
}

// The Host headers the Studio answers to when bound to `address`: on
// loopback, 127.0.0.1 and localhost; elsewhere (STUDIO_HOST), that address,
// IPv6 in the bracketed, lowercase, compressed form browsers send.
export function ownHosts(address: string, port: number) {
  const host = address.includes(':') ? new URL(`http://[${address}]/`).hostname : address;
  return address === '127.0.0.1' ? [`127.0.0.1:${String(port)}`, `localhost:${String(port)}`] : [`${host}:${String(port)}`];
}
