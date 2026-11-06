import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectEvents } from '../../support/events';
import { DEMO_DIAGRAM, startTestStudio, type TestStudio } from '../../support/studio';

describe('file events (SSE)', () => {
  let studio: TestStudio;
  const events = () => `${studio.url}api/events`;

  beforeAll(async () => {
    studio = await startTestStudio();
  });

  afterAll(async () => {
    await studio.close();
  });

  it('streams text/event-stream', async () => {
    const controller = new AbortController();
    const response = await fetch(events(), { signal: controller.signal });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    controller.abort();
  });

  it('reports a file changed outside the Studio', async () => {
    const path = 'content/docs/streaming/index.mdx';
    const seen = await collectEvents(
      events(),
      () => writeFile(join(studio.root, path), 'changed by obsidian\n'),
      (list) => list.some((event) => event.path === path),
    );
    const event = seen.find((candidate) => candidate.path === path);
    expect(event).toMatchObject({ type: 'change', path });
    expect(typeof event?.mtimeMs).toBe('number');
  });

  it('reports a diagram changed outside the Studio, and not the schema beside it', async () => {
    const seen = await collectEvents(
      events(),
      async () => {
        await writeFile(join(studio.root, 'diagrams/diagram.schema.json'), '{}');
        await writeFile(join(studio.root, DEMO_DIAGRAM), '{ "changed": "by an agent" }\n');
      },
      (list) => list.some((event) => event.path === DEMO_DIAGRAM),
    );
    expect(seen).toMatchObject([{ type: 'change', path: DEMO_DIAGRAM }]);
  });

  it('reports added assets and skips hidden or unknown files', async () => {
    const seen = await collectEvents(
      events(),
      async () => {
        await writeFile(join(studio.root, 'content/docs/.obsidian-tmp.mdx'), 'x');
        await writeFile(join(studio.root, 'content/docs/notes.txt'), 'x');
        await writeFile(join(studio.root, 'public/docs/demo/added.png'), 'x');
      },
      (list) => list.some((event) => event.path === 'public/docs/demo/added.png'),
    );
    expect(seen).toMatchObject([{ type: 'add', path: 'public/docs/demo/added.png' }]);
  });

  it('reports a deleted file', async () => {
    const path = 'content/docs/database/meta.yaml';
    const seen = await collectEvents(
      events(),
      () => rm(join(studio.root, path)),
      (list) => list.some((event) => event.path === path),
    );
    expect(seen).toContainEqual({ type: 'unlink', path, mtimeMs: null });
  });

  it('reports the files of a renamed folder', async () => {
    const before = 'content/docs/personal-reflections';
    const after = 'content/docs/reflections';
    const seen = await collectEvents(
      events(),
      () => rename(join(studio.root, before), join(studio.root, after)),
      (list) =>
        list.some((event) => event.type === 'unlink' && event.path === `${before}/meta.yaml`) &&
        list.some((event) => event.type === 'add' && event.path === `${after}/meta.yaml`),
    );
    expect(seen).toContainEqual({ type: 'unlink', path: `${before}/meta.yaml`, mtimeMs: null });
    expect(seen).toContainEqual(expect.objectContaining({ type: 'add', path: `${after}/meta.yaml` }));
  });
});
