import { createSyncClient, SYNC_ENDPOINT, wsTransport, type SyncClient } from '@fumadocs-editor/core/sync';
import { watchSync } from './connection';
import { checkSeat } from './session';
import { API_BASE } from './workspace';

let client: SyncClient | undefined;

// The notes sync of this page's worktree, at /cr/<slug>/__fde_sync (or
// /__fde_sync on main), one client for every editor on the page. Each
// connection first checks that the browser is still signed in as the
// person the Studio runs for (checkSeat). It reconnects without end, so
// the page's connection watch closes it once the server is gone
// (connection.ts).
export function workspaceSyncClient(): SyncClient {
  if (client === undefined) {
    client = createSyncClient({
      transport: wsTransport(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${API_BASE}${SYNC_ENDPOINT}`),
      auth: checkSeat,
    });
    watchSync(client);
  }
  return client;
}
