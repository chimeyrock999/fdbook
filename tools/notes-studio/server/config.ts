import { fileURLToPath } from 'node:url';

export const STUDIO_HOST = '127.0.0.1';
export const DEFAULT_STUDIO_PORT = 4310;

export const studioRoot = fileURLToPath(new URL('../', import.meta.url));
// Until change requests open their own worktrees (#16), edit this checkout.
export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

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
