// The Studio API answers JSON. A page instead means the server was started
// before an update that added the endpoint: Vite answers a path it does not
// know with index.html. Say how to fix that rather than fail to parse HTML.
export const STALE_SERVER = 'The Studio server is older than this page. Stop it and run `npm run studio` again.';

const isJson = (response: Response) => (response.headers.get('content-type') ?? '').includes('application/json');

// The error of a failed request: the API's `{ error }`, or the restart hint
// when the answer is not the API's (a POST to an endpoint an older server
// lacks gets Vite's plain 404).
export async function errorOf(response: Response): Promise<Error> {
  if (!isJson(response)) return new Error(STALE_SERVER);
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `HTTP ${String(response.status)}`);
}

export async function readJson<T>(response: Response): Promise<T> {
  if (!isJson(response)) throw new Error(STALE_SERVER);
  return (await response.json()) as T;
}
