import type { IncomingMessage, RequestListener, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Auth } from '#auth/auth.ts';
import { CALLBACK_PATH } from '#auth/config.ts';
import { pathnameOf, type Handler } from '#http/http.ts';
import type { Role } from '@fdbook/shared/auth.ts';
import { rejectForeignRequest } from '#security/guard.ts';

type UpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

// Guard first, then the sign-in gate (auth/auth.ts), then each handler in
// order, then the fallback (Vite). Only the web sign-in's callback may be
// a cross-site page load: GitHub redirects the browser there.
export function createRequestListener(hosts: string[], handlers: Handler[], fallback: RequestListener, auth: Pick<Auth, 'gate' | 'enabled'> | null = null): RequestListener {
  return (request, response) => {
    const reason = rejectForeignRequest(request, hosts, { navigation: auth?.enabled === true && pathnameOf(request) === CALLBACK_PATH });
    if (reason) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Forbidden: ${reason}\n`);
      return;
    }
    void (async () => {
      if (auth !== null && (await auth.gate(request, response))) return;
      for (const handler of handlers) if (await handler(request, response)) return;
      fallback(request, response);
    })().catch((error: unknown) => {
      // A handler failed before answering: report it instead of crashing.
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(`Internal error: ${(error as Error).message}\n`);
    });
  };
}

const REASONS: Record<number, string> = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 503: 'Service Unavailable' };

export function refuseUpgrade(socket: Duplex, status: number) {
  socket.end(`HTTP/1.1 ${String(status)} ${REASONS[status] ?? 'Error'}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

// Takes over the server's websocket upgrades: the guard runs first, each
// route claims its own upgrades, and the rest are closed instead of left
// hanging. Listeners already attached (Vite HMR) become the `existing` route.
// A route's `needs` is the role the sign-in gate asks for (none by default).
export function routeUpgrades(
  server: Server,
  hosts: string[],
  routes: (existing: UpgradeListener) => { matches: (request: IncomingMessage) => boolean; handle: UpgradeListener; needs?: Role }[],
  auth: Pick<Auth, 'gateUpgrade'> | null = null,
) {
  const previous = server.listeners('upgrade') as UpgradeListener[];
  server.removeAllListeners('upgrade');
  const table = routes((request, socket, head) => {
    for (const listener of previous) listener(request, socket, head);
  });
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (rejectForeignRequest(request, hosts)) {
      refuseUpgrade(socket, 403);
      return;
    }
    const route = table.find((candidate) => candidate.matches(request));
    if (!route) {
      refuseUpgrade(socket, 404);
      return;
    }
    if (auth === null) {
      route.handle(request, socket, head);
      return;
    }
    auth.gateUpgrade(request, route.needs ?? 'none').then(
      (status) => {
        if (status === null) route.handle(request, socket, head);
        else refuseUpgrade(socket, status);
      },
      () => { refuseUpgrade(socket, 503); },
    );
  });
}
