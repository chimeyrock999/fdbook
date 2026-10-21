// The Studio API answers JSON. A page instead means the server was started
// before an update that added the endpoint: Vite answers a path it does not
// know with index.html. Say how to fix that rather than fail to parse HTML.
export const STALE_SERVER = 'The Studio server is older than this page. Stop it and run `npm run studio` again.';

export async function readJson<T>(response: Response): Promise<T> {
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) throw new Error(STALE_SERVER);
  return (await response.json()) as T;
}
