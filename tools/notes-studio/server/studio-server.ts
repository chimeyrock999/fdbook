import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

export const STUDIO_HOST = '127.0.0.1';
export const DEFAULT_STUDIO_PORT = 4310;

export type StudioServer = {
  server: Server;
  url: string;
  close: () => Promise<void>;
};

const studioRoot = fileURLToPath(new URL('../', import.meta.url));

// Empty or unset means the default port; anything else must be a valid port.
export function parseStudioPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_STUDIO_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`STUDIO_PORT must be a port number between 1 and 65535, got "${value}".`);
  }
  return port;
}

function closeServer(server: Server) {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

// One process, one origin: the UI (Vite middleware) and, later, the file API
// share 127.0.0.1:<port>, so Host/Origin checks live in a single place.
export async function startStudioServer({ port = DEFAULT_STUDIO_PORT } = {}): Promise<StudioServer> {
  const server = createServer();
  // Bind first so a busy port fails before Vite starts its watcher.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, STUDIO_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port: boundPort } = server.address() as AddressInfo;

  let vite;
  try {
    vite = await createViteServer({
      root: studioRoot,
      appType: 'spa',
      server: { middlewareMode: true, port: boundPort, ws: { server } },
    });
  } catch (error) {
    await closeServer(server);
    throw error;
  }
  server.on('request', vite.middlewares);

  return {
    server,
    url: `http://${STUDIO_HOST}:${String(boundPort)}/`,
    close: async () => {
      try {
        await vite.close();
      } finally {
        await closeServer(server);
      }
    },
  };
}
