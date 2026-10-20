import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSyncClient, SYNC_ENDPOINT, wsTransport, type DocumentEditor } from '@fumadocs-editor/core/sync';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestStudio, type TestStudio } from '../../support/studio';

// The smallest editor the sync client accepts: plain text, no Tiptap.
class TextEditor implements DocumentEditor {
  text = '';
  external: string[] = [];
  getMarkdown() {
    return this.text;
  }
  applyExternalMarkdown(text: string) {
    this.external.push(text);
    this.text = text;
    return Promise.resolve([]);
  }
  setMarkdown(text: string) {
    this.text = text;
    return Promise.resolve();
  }
  markSaved() {
    // keeps no base
  }
}

describe('notes sync', () => {
  let studio: TestStudio;
  let client: ReturnType<typeof createSyncClient>;

  beforeAll(async () => {
    studio = await startTestStudio();
    await writeFile(join(studio.root, 'content/notes/readme.md'), '# plain markdown\n');
    await mkdir(join(studio.root, 'outside'));
    await writeFile(join(studio.root, 'outside/secret.mdx'), 'secret\n');
    await symlink(join(studio.root, 'outside/secret.mdx'), join(studio.root, 'content/notes/leak.mdx'));
  });

  afterEach(() => {
    client.close();
  });

  afterAll(async () => {
    await studio.close();
  });

  const connect = () => {
    client = createSyncClient({ transport: wsTransport(`ws://127.0.0.1:${studio.port}${SYNC_ENDPOINT}`) });
    return client;
  };

  it('serves real notes and merges writes made through the file API', async () => {
    const editor = new TextEditor();
    const doc = connect().open('database/index.mdx', { editor });
    const opened = await doc.opened;
    const path = 'content/notes/database/index.mdx';
    expect(opened.text).toBe(await readFile(join(studio.root, path), 'utf8'));
    expect(opened.writable).toBe(true);
    editor.text = opened.text;

    // An agent saves through the file API; the open document follows.
    const { mtimeMs } = (await (await fetch(studio.fileUrl(path))).json()) as { mtimeMs: number };
    const saved = await fetch(studio.fileUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `${opened.text}\nfrom the API\n`, baseMtime: mtimeMs }),
    });
    expect(saved.status).toBe(200);
    await expect.poll(() => editor.external.at(-1), { timeout: 5000 }).toBe(`${opened.text}\nfrom the API\n`);
  });

  it('refuses files outside the notes policy', async () => {
    const sync = connect();
    await expect(sync.open('readme.md', { editor: new TextEditor() }).opened).rejects.toThrow(/denied/);
    await expect(sync.open('../../package.json', { editor: new TextEditor() }).opened).rejects.toThrow();
    // Same check as the file API: a symlink out of the notes is not followed.
    await expect(sync.open('leak.mdx', { editor: new TextEditor() }).opened).rejects.toThrow(/denied/);
  });

  // Tree commands write files the scope never sees (mkdir also writes
  // meta.json) and skip meta.yaml, so new pages go through the file API.
  it('refuses to create pages or folders', async () => {
    const sync = connect();
    sync.onTree(() => undefined);
    await expect.poll(() => sync.tree() !== null).toBe(true);
    await expect(sync.run({ type: 'mkdir', dir: 'zz-new', title: 'Zz' })).rejects.toThrow(/denied/);
    await expect(sync.run({ type: 'create', path: 'streaming/zz-page.mdx', title: 'Zz' })).rejects.toThrow(/denied/);
    await expect(stat(join(studio.root, 'content/notes/zz-new'))).rejects.toThrow();
    await expect(stat(join(studio.root, 'content/notes/streaming/zz-page.mdx'))).rejects.toThrow();
  });
});
