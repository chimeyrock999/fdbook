// Client for the icon names (server/icons/api.ts).

import { readJson } from './json';

export async function fetchIconNames(base = ''): Promise<readonly string[]> {
  const response = await fetch(`${base}/api/icons`);
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  return (await readJson<{ names: string[] }>(response)).names;
}
