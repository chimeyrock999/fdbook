import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_STUDIO_HOST = '127.0.0.1';
export const DEFAULT_STUDIO_PORT = 4310;

// Where FdBook itself is installed, with its lockfile. The project it edits
// is another folder (project.ts).
export const installRoot = fileURLToPath(new URL('../../../', import.meta.url));
// The UI the server serves through Vite: @fdbook/ui, with its vite.config.ts.
export const uiRoot = dirname(createRequire(import.meta.url).resolve('@fdbook/ui/package.json'));

// Where the change requests' worktrees live: STUDIO_HOME, or ~/.chimey-studio.
export function studioHome(value = process.env.STUDIO_HOME) {
  return value === undefined || value.trim() === '' ? join(homedir(), '.chimey-studio') : value.trim();
}

// The Cloudflare Pages project the preview links point at (STUDIO_PAGES_PROJECT), or null.
export function pagesProject(value = process.env.STUDIO_PAGES_PROJECT) {
  return value === undefined || value.trim() === '' ? null : value.trim();
}

// After how many days without a commit or an edit an open change request
// reads as stale (STUDIO_STALE_DAYS): a whole number, 30 when unset.
export const DEFAULT_STALE_DAYS = 30;

export function parseStaleDays(value = process.env.STUDIO_STALE_DAYS): number {
  if (value === undefined || value.trim() === '') return DEFAULT_STALE_DAYS;
  const days = /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isInteger(days) || days < 1) throw new Error(`STUDIO_STALE_DAYS must be a whole number of days, 1 or more, got "${value}".`);
  return days;
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

// The address to bind: empty or unset means 127.0.0.1. Only an IP address,
// so the Host check still stops DNS rebinding, and not a wildcard, which
// would answer on every network the machine is on. IPv6 comes back in the
// form browsers send in Host (lowercase, compressed), so ::0 or
// 0:0:0:0:0:0:0:0 is refused like ::. A zone id (fe80::1%en0) is refused
// too: it binds, but no browser sends it.
export function parseStudioHost(value: string | undefined): string {
  if (value === undefined || value.trim() === '') return DEFAULT_STUDIO_HOST;
  const host = value.trim();
  const version = isIP(host);
  const address = version === 6 && !host.includes('%') ? new URL(`http://[${host}]/`).hostname.slice(1, -1) : version === 4 ? host : null;
  if (address === null || ['0.0.0.0', '::', '::ffff:0:0'].includes(address)) {
    throw new Error(`STUDIO_HOST must be one IP address of this machine, not a name, a wildcard such as 0.0.0.0 or an IPv6 zone id, got "${value}".`);
  }
  return address;
}

// What to tell the user when the server cannot bind.
export function listenFailure(error: NodeJS.ErrnoException, host: string): string {
  if (error.code === 'EADDRINUSE') return 'The Notes Studio port is already in use. Stop the other process or set STUDIO_PORT.';
  if (error.code === 'EADDRNOTAVAIL') return `STUDIO_HOST ${host} is not an address of this machine; is the interface up?`;
  return error.message;
}
