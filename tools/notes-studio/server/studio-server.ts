import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SYNC_ENDPOINT } from '@fumadocs-editor/core/sync';
import { createServer as createViteServer } from 'vite';
import { DEFAULT_STUDIO_PORT, repoRoot, STUDIO_HOST, studioRoot } from './config.ts';
import { createFilesApi } from './files/api.ts';
import { createFileEvents } from './files/events.ts';
import { pathnameOf } from './http.ts';
import { createIconsApi } from './icons/api.ts';
import { createLintApi } from './lint/api.ts';
import { createRequestListener, routeUpgrades } from './routing.ts';
import { createNotesSync } from './sync/notes-sync.ts';

export type StudioServer = {
  server: Server;
  url: string;
  close: () => Promise<void>;
};

function closeServer(server: Server) {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

// One process, one origin: the UI (Vite middleware), the file API, file
// events and the notes sync socket share 127.0.0.1:<port>, behind one
// Host/Origin guard that runs on every request and every websocket upgrade.
export async function startStudioServer({ port = DEFAULT_STUDIO_PORT, root = repoRoot } = {}): Promise<StudioServer> {
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
  const filesApi = createFilesApi(root);
  const lintApi = createLintApi(root);
  const iconsApi = createIconsApi();
  const fileEvents = createFileEvents(root);
  const notesSync = createNotesSync(root, boundPort);

  server.on('request', createRequestListener(boundPort, [fileEvents.handle, filesApi, lintApi, iconsApi], vite.middlewares));
  routeUpgrades(server, boundPort, (viteHmr) => [
    {
      matches: (request) => pathnameOf(request) === SYNC_ENDPOINT,
      handle: (request, socket, head) => {
        notesSync.handleUpgrade(request, socket, head);
      },
    },
    {
      // Vite only answers on its base path; elsewhere it would leave the socket open.
      matches: (request) =>
        pathnameOf(request) === '/' && ['vite-hmr', 'vite-ping'].includes(request.headers['sec-websocket-protocol'] ?? ''),
      handle: viteHmr,
    },
  ]);

  return {
    server,
    url: `http://${STUDIO_HOST}:${String(boundPort)}/`,
    close: async () => {
      fileEvents.close();
      try {
        await notesSync.close();
        await vite.close();
      } finally {
        await closeServer(server);
      }
    },
  };
}
