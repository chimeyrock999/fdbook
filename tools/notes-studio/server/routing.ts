import type { IncomingMessage, RequestListener, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Handler } from './http.ts';
import { rejectForeignRequest } from './security/guard.ts';

type UpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

// Guard first, then each handler in order, then the fallback (Vite).
export function createRequestListener(port: number, handlers: Handler[], fallback: RequestListener): RequestListener {
  return (request, response) => {
    const reason = rejectForeignRequest(request, port);
    if (reason) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Forbidden: ${reason}\n`);
      return;
    }
    void (async () => {
      for (const handler of handlers) if (await handler(request, response)) return;
      fallback(request, response);
    })().catch((error: unknown) => {
      // A handler failed before answering: report it instead of crashing.
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(`Internal error: ${(error as Error).message}\n`);
    });
  };
}

function refuseUpgrade(socket: Duplex, status: 403 | 404) {
  socket.end(`HTTP/1.1 ${String(status)} ${status === 403 ? 'Forbidden' : 'Not Found'}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

// Takes over the server's websocket upgrades: the guard runs first, each
// route claims its own upgrades, and the rest are closed instead of left
// hanging. Listeners already attached (Vite HMR) become the `existing` route.
export function routeUpgrades(
  server: Server,
  port: number,
  routes: (existing: UpgradeListener) => { matches: (request: IncomingMessage) => boolean; handle: UpgradeListener }[],
) {
  const previous = server.listeners('upgrade') as UpgradeListener[];
  server.removeAllListeners('upgrade');
  const table = routes((request, socket, head) => {
    for (const listener of previous) listener(request, socket, head);
  });
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (rejectForeignRequest(request, port)) {
      refuseUpgrade(socket, 403);
      return;
    }
    const route = table.find((candidate) => candidate.matches(request));
    if (route) route.handle(request, socket, head);
    else refuseUpgrade(socket, 404);
  });
}
