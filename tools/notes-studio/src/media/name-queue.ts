import type { NameRequest } from './asset-media';

export type Asking = NameRequest & { id: number };

// One name dialog at a time: requests wait their turn in order. `show` puts
// a request on screen (null clears it); `answer` settles the one shown.
// After `close`, the shown request and every waiting one answer null.
export function createNameQueue(show: (asking: Asking | null) => void) {
  let queue: Promise<unknown> = Promise.resolve();
  let open: { asking: Asking; resolve: (stem: string | null) => void } | null = null;
  let asked = 0;
  let closed = false;

  return {
    ask: (request: NameRequest): Promise<string | null> => {
      const next = queue.then(
        () =>
          new Promise<string | null>((resolve) => {
            if (closed) {
              resolve(null);
              return;
            }
            open = { asking: { ...request, id: ++asked }, resolve };
            show(open.asking);
          }),
      );
      queue = next;
      return next;
    },
    answer: (stem: string | null) => {
      const current = open;
      open = null;
      show(null);
      current?.resolve(stem);
    },
    close: () => {
      closed = true;
      open?.resolve(null);
      open = null;
    },
    reopen: () => {
      closed = false;
    },
  };
}
