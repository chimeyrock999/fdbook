import { createSyncClient, SYNC_ENDPOINT, wsTransport, type SyncClient } from '@fumadocs-editor/core/sync';
import { API_BASE } from './workspace';

let client: SyncClient | undefined;

// The notes sync of this page's change request, at /cr/<slug>/__fde_sync,
// one client for every editor on the page. Undefined on main: the editor's
// own shared client connects to /__fde_sync.
export function workspaceSyncClient(): SyncClient | undefined {
  if (API_BASE === '') return undefined;
  client ??= createSyncClient({
    transport: wsTransport(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${API_BASE}${SYNC_ENDPOINT}`),
  });
  return client;
}
