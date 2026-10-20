import { randomBytes } from 'node:crypto';
import { request } from 'node:http';

export type RawResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };

// node:http instead of fetch, because fetch cannot set Host, Origin or Sec-Fetch-*.
export function rawRequest(
  url: string,
  { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {},
) {
  return new Promise<RawResponse>((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

export function json(response: RawResponse): unknown {
  return JSON.parse(response.body.toString('utf8'));
}

export type UpgradeOutcome = 'upgraded' | `refused ${string}` | 'destroyed' | 'hung';

// Tries a websocket handshake and reports how the server answered it.
export function tryUpgrade(url: string, headers: Record<string, string> = {}, timeoutMs = 1500) {
  return new Promise<UpgradeOutcome>((resolve) => {
    const req = request(url, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        ...headers,
      },
    });
    const timer = setTimeout(() => {
      req.destroy();
      resolve('hung');
    }, timeoutMs);
    const done = (outcome: UpgradeOutcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    req.on('upgrade', (_res, socket) => {
      socket.destroy();
      done('upgraded');
    });
    req.on('response', (res) => {
      res.resume();
      done(`refused ${String(res.statusCode)}`);
    });
    req.on('error', () => {
      done('destroyed');
    });
    req.end();
  });
}
