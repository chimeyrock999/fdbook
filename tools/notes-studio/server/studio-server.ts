import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SYNC_ENDPOINT } from '@fumadocs-editor/core/sync';
import { createServer as createViteServer } from 'vite';
import { DEFAULT_STUDIO_HOST, DEFAULT_STUDIO_PORT, repoRoot, studioRoot } from './config.ts';
import { createChangeRequestsApi } from './cr/api.ts';
import { openChangeRequests, type ChangeRequestOptions, type ChangeRequests } from './cr/manager.ts';
import { apiNotFound, pathnameOf } from './http.ts';
import { createIconsApi } from './icons/api.ts';
import { createBuildReader, ghCheckRun } from './preview/check-runs.ts';
import { createRequestListener, routeUpgrades } from './routing.ts';
import { ownHosts } from './security/guard.ts';
import { createWorkspace, createWorkspaceRouter } from './workspace.ts';
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
// events and the notes sync socket share <host>:<port>, behind one
// Host/Origin guard that runs on every request and every websocket upgrade.
// With `changeRequests` the Studio opens main read-only (unprefixed /api/…
// and /__fde_sync) and each change request's worktree under /cr/<slug>/
// (see workspace.ts). Without it, it edits the one worktree at `root`.
export async function startStudioServer({ host = DEFAULT_STUDIO_HOST, port = DEFAULT_STUDIO_PORT, root = repoRoot, changeRequests }: {
  host?: string;
  port?: number;
  root?: string;
  changeRequests?: ChangeRequestOptions;
} = {}): Promise<StudioServer> {
  const server = createServer();
  // Bind first so a busy port fails before Vite starts its watcher.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  // The address as bound, not as given: Node reports it canonically.
  const { address, port: boundPort } = server.address() as AddressInfo;
  const hosts = ownHosts(address, boundPort);

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
  let crs: ChangeRequests | null = null;
  try {
    if (changeRequests) crs = await openChangeRequests(changeRequests);
  } catch (error) {
    await vite.close();
    await closeServer(server);
    throw error;
  }
  // One reader for every workspace, so its cache and push times are shared.
  const preview = { builds: changeRequests?.builds ?? createBuildReader(ghCheckRun), pagesProject: changeRequests?.pagesProject ?? null };
  const main = createWorkspace(crs?.mainRoot ?? root, hosts, { readOnly: crs !== null, preview });
  const shared = [createIconsApi(), apiNotFound];
  const workspaces = createWorkspaceRouter(hosts, (slug) => crs?.worktreeOf(slug) ?? Promise.resolve(null), shared, preview);
  // A discarded change request's watchers and sync close before its worktree goes.
  crs?.onDiscard((slug) => workspaces.close(slug));

  server.on('request', createRequestListener(hosts, [workspaces.handle, createChangeRequestsApi(crs), ...main.handlers, ...shared], vite.middlewares));
  routeUpgrades(server, hosts, (viteHmr) => [
    {
      matches: (request) => pathnameOf(request) === SYNC_ENDPOINT,
      handle: main.handleUpgrade,
    },
    workspaces.syncRoute(SYNC_ENDPOINT),
    {
      // Vite only answers on its base path; elsewhere it would leave the socket open.
      matches: (request) =>
        pathnameOf(request) === '/' && ['vite-hmr', 'vite-ping'].includes(request.headers['sec-websocket-protocol'] ?? ''),
      handle: viteHmr,
    },
  ]);

  return {
    server,
    url: `http://${hosts[0]}/`,
    close: async () => {
      try {
        await workspaces.closeAll();
        await main.close();
        await vite.close();
      } finally {
        await closeServer(server);
      }
    },
  };
}
