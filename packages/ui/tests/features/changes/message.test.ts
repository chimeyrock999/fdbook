import { describe, expect, it } from 'vitest';
import type { ChangedFile } from '#api/changes.ts';
import { suggestMessage } from '#features/changes/message.ts';

const note = (path: string, status: ChangedFile['status'], from?: string): ChangedFile =>
  ({ path: `content/docs/${path}`, status, ...(from === undefined ? {} : { from: `content/docs/${from}` }) });
const asset = (path: string, status: ChangedFile['status'] = 'A'): ChangedFile => ({ path: `public/docs/${path}`, status });
const diagram = (path: string, status: ChangedFile['status'] = 'M'): ChangedFile => ({ path: `diagrams/${path}.diagram.json`, status });

describe('suggestMessage', () => {
  it.each([
    ['one edited page', [note('k8s/driver-container-first-look.mdx', 'M')], 'docs(notes): update driver-container-first-look'],
    ['one new page and its meta.yaml', [note('streaming/sinks.mdx', 'A'), note('streaming/meta.yaml', 'M')], 'docs(notes): add sinks'],
    ['one deleted page', [note('streaming/old.mdx', 'D')], 'docs(notes): remove old'],
    ['a folder page by its folder', [note('streaming/index.mdx', 'M')], 'docs(notes): update streaming'],
    ['the home page', [note('index.mdx', 'M')], 'docs(notes): update notes home'],
    ['a staged rename', [note('streaming/new.mdx', 'R', 'streaming/old.mdx')], 'docs(notes): rename old to new'],
    ['a Studio rename (a delete and an add)', [note('streaming/old.mdx', 'D'), note('streaming/new.mdx', 'A'), note('streaming/meta.yaml', 'M')], 'docs(notes): rename old to new'],
    ['pages in one folder', [note('streaming/a.mdx', 'M'), note('streaming/index.mdx', 'M')], 'docs(notes): update streaming (2 pages)'],
    ['new pages in one folder', [note('streaming/a.mdx', 'A'), note('streaming/b.mdx', 'A')], 'docs(notes): add streaming (2 pages)'],
    ['pages in several folders', [note('streaming/a.mdx', 'M'), note('database/b.mdx', 'A'), note('c.mdx', 'D')], 'docs(notes): update 3 pages'],
    ['only meta.yaml', [note('streaming/meta.yaml', 'M'), note('meta.yaml', 'M')], 'docs(notes): reorder streaming, notes'],
    ['only meta.json', [note('streaming/meta.json', 'M'), note('meta.json', 'M')], 'docs(notes): reorder streaming, notes'],
    ['one new page and its meta.json', [note('streaming/sinks.mdx', 'A'), note('streaming/meta.json', 'M')], 'docs(notes): add sinks'],
    ['only assets', [asset('streaming/a.png'), asset('streaming/b.svg', 'M')], 'docs(notes): update assets of streaming'],
    ['a page with its images', [note('streaming/a.mdx', 'M'), asset('streaming/a.png')], 'docs(notes): update a'],
    ['one diagram', [diagram('spark/flow')], 'docs(notes): update diagram flow'],
    ['a new diagram and an asset', [diagram('spark/flow', 'A'), asset('spark/a.png')], 'docs(notes): add diagram flow'],
    ['diagrams', [diagram('spark/flow'), diagram('kafka/topics', 'A')], 'docs(notes): update 2 diagrams'],
    ['a page with its diagram', [note('spark/a.mdx', 'M'), diagram('spark/flow', 'A')], 'docs(notes): update a'],
    ['nothing', [], ''],
  ])('%s', (_, files, message) => {
    expect(suggestMessage(files)).toBe(message);
  });
});
