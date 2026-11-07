/**
 * MDX directives (`::svg{...}`) can only pass strings, so component props that
 * are booleans/numbers in JSX arrive as strings from that path.
 */
export function coerceBoolean(value: boolean | string | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === undefined) return undefined;

  const normalized = value.trim().toLowerCase();
  if (normalized === '' || normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;

  return undefined;
}

export function coerceNumber(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (value === undefined) return undefined;

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
