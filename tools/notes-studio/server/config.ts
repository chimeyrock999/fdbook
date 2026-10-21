import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STUDIO_HOST = '127.0.0.1';
export const DEFAULT_STUDIO_PORT = 4310;

export const studioRoot = fileURLToPath(new URL('../', import.meta.url));
// The repository change requests branch from; `npm run studio` reads main
// and edits in worktrees outside it (server/cr/).
export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Where the change requests' worktrees live: STUDIO_HOME, or ~/.chimey-studio.
export function studioHome(value = process.env.STUDIO_HOME) {
  return value === undefined || value.trim() === '' ? join(homedir(), '.chimey-studio') : value.trim();
}

// The Cloudflare Pages project the preview links point at (STUDIO_PAGES_PROJECT), or null.
export function pagesProject(value = process.env.STUDIO_PAGES_PROJECT) {
  return value === undefined || value.trim() === '' ? null : value.trim();
}

// Empty or unset means the default port; anything else must be a valid port.
export function parseStudioPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_STUDIO_PORT;
  // Decimal digits only: Number() would also take 0x1F, 1e3 or 5000.0.
  const port = /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`STUDIO_PORT must be a port number between 1 and 65535, got "${value}".`);
  }
  return port;
}
