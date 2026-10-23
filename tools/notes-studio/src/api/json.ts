// The Studio API answers JSON. A page instead means the server was started
// before an update that added the endpoint: Vite answers a path it does not
// know with index.html. Say how to fix that rather than fail to parse HTML.
export const STALE_SERVER = 'The Studio server is older than this page. Stop it and run `npm run studio` again.';

const isJson = (response: Response) => (response.headers.get('content-type') ?? '').includes('application/json');

// The error of a failed request: the API's `{ error }`, or the restart hint
// when the answer is not the API's (a POST to an endpoint an older server
// lacks gets Vite's plain 404). `status` is the HTTP status the API gave.
export type ApiError = Error & { status?: number };

export async function errorOf(response: Response): Promise<ApiError> {
  if (!isJson(response)) return new Error(STALE_SERVER);
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return Object.assign(new Error(body.error ?? `HTTP ${String(response.status)}`), { status: response.status });
}

// A refusal that only says it is done already (409): a repeat of an answer
// or a cancel another click or page sent first.
export const isConflict = (reason: unknown) => reason instanceof Error && (reason as ApiError).status === 409;

export async function readJson<T>(response: Response): Promise<T> {
  if (!isJson(response)) throw new Error(STALE_SERVER);
  return (await response.json()) as T;
}
