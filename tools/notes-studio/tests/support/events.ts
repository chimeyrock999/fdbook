import type { FileEvent } from '../../server/files/events';

// Opens /api/events, runs `action` once the watcher is ready, and collects
// events until `stop` says enough (or 5 s pass).
export async function collectEvents(url: string, action: () => Promise<void>, stop: (events: FileEvent[]) => boolean) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  if (!response.body) throw new Error('no event stream');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const events: FileEvent[] = [];
  let buffer = '';
  // The first frame (`retry:`) is sent once the watcher is ready.
  while (!buffer.includes('\n\n')) buffer += (await reader.read()).value ?? '';
  buffer = '';
  await action();
  const deadline = Date.now() + 5000;
  const tick = () =>
    new Promise<{ value: undefined; done: false }>((resolve) =>
      setTimeout(() => {
        resolve({ value: undefined, done: false });
      }, 200),
    );
  while (!stop(events) && Date.now() < deadline) {
    const { value, done } = await Promise.race([reader.read(), tick()]);
    if (done) break;
    buffer += value ?? '';
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const data = buffer
        .slice(0, end)
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      buffer = buffer.slice(end + 2);
      if (data) events.push(JSON.parse(data) as FileEvent);
    }
  }
  controller.abort();
  return events;
}
