// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFilesClient, type FileEvent } from '#api/files.ts';

class FakeEventSource {
  static opened: FakeEventSource[] = [];
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.opened.push(this);
  }
  close() {
    this.closed = true;
  }
  send(event: FileEvent) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.opened = [];
});

describe('subscribeFileEvents', () => {
  it('shares one connection between subscribers and closes it with the last', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const files = createFilesClient();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = files.subscribeFileEvents(first);
    const stopSecond = files.subscribeFileEvents(second);
    expect(FakeEventSource.opened).toHaveLength(1);
    const event: FileEvent = { type: 'add', path: 'content/docs/x.mdx', mtimeMs: 1 };
    FakeEventSource.opened[0]?.send(event);
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);
    stopFirst();
    expect(FakeEventSource.opened[0]?.closed).toBe(false);
    stopSecond();
    expect(FakeEventSource.opened[0]?.closed).toBe(true);
    files.subscribeFileEvents(first);
    expect(FakeEventSource.opened).toHaveLength(2);
  });
});
