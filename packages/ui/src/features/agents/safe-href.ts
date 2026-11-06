const SAFE_URL = /^(?:https?:|mailto:)/i;

// The link a URL in an agent's reply may be: one to the web or an email
// address, or null (javascript:, data:, a relative path).
export function safeHref(url: string): string | null {
  const trimmed = url.trim();
  return SAFE_URL.test(trimmed) ? trimmed : null;
}
