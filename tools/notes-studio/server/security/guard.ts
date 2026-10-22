import type { IncomingMessage } from 'node:http';

// The Studio answers only to its own origin. Host stops DNS rebinding (a
// foreign name resolving to 127.0.0.1); Origin and fetch metadata stop other
// pages, including other local dev servers, from calling the API or opening
// a socket. Requests without an Origin (curl, agents) still pass on Host.
// `navigation` lets a cross-site page load through (a GET the browser makes
// for the address bar, not a script): GitHub sending the web sign-in back.
export function rejectForeignRequest(request: IncomingMessage, hosts: string[], { navigation = false } = {}): string | null {
  if (!hosts.includes(request.headers.host ?? '')) return 'unexpected Host header';
  const origin = request.headers.origin;
  if (origin !== undefined && !hosts.some((host) => origin === `http://${host}`)) return 'foreign Origin';
  const site = request.headers['sec-fetch-site'];
  const navigating = navigation && request.method === 'GET' && request.headers['sec-fetch-mode'] === 'navigate';
  if (site !== undefined && site !== 'same-origin' && site !== 'none' && !navigating) return 'cross-site request';
  return null;
}

// The Host headers the Studio answers to when bound to `address`: on
// loopback, 127.0.0.1 and localhost; elsewhere (STUDIO_HOST), that address,
// IPv6 in the bracketed, lowercase, compressed form browsers send.
export function ownHosts(address: string, port: number) {
  const host = address.includes(':') ? new URL(`http://[${address}]/`).hostname : address;
  return address === '127.0.0.1' ? [`127.0.0.1:${String(port)}`, `localhost:${String(port)}`] : [`${host}:${String(port)}`];
}
