import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLintClient } from '#api/lint.ts';
import { startTestStudio, type TestStudio } from '@fdbook/testing/studio.ts';

describe('lint client', () => {
  let studio: TestStudio;
  let client: ReturnType<typeof createLintClient>;

  beforeAll(async () => {
    studio = await startTestStudio();
    client = createLintClient(studio.url.slice(0, -1));
  });

  afterAll(async () => {
    await studio.close();
  });

  it('returns the issues of the text it sends', async () => {
    const issues = await client.lintNote('content/docs/index.mdx', ':::nope\nx\n:::\n');
    expect(issues).toMatchObject([{ rule: 'directive-unknown', severity: 'error', start: { line: 1, offset: 0 } }]);
  });

  it('throws the server error', async () => {
    await expect(client.lintNote('content/docs/meta.yaml', '')).rejects.toThrow('not a note');
  });
});
