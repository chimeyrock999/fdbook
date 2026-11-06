import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { json, rawRequest } from '../../support/http';
import { startTestStudio, type TestStudio } from '../../support/studio';

let studio: TestStudio;

beforeAll(async () => {
  studio = await startTestStudio();
});

afterAll(async () => {
  await studio.close();
});

function postLint(body: unknown, headers: Record<string, string> = {}) {
  return rawRequest(`${studio.url}api/lint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/lint', () => {
  it('lints the text it is sent, against the worktree', async () => {
    const content = '# T\n\n[a](./missing.mdx)\n\n<HtmlEmbed src="/docs/demo/pixel.png" />\n\n:::exmaple\nx\n:::\n';
    const response = await postLint({ path: 'content/docs/index.mdx', content });
    expect(response.status).toBe(200);
    const body = json(response) as { path: string; issues: { rule: string; start: { line: number } }[] };
    expect(body.path).toBe('content/docs/index.mdx');
    expect(body.issues.map((issue) => `${issue.rule}@${String(issue.start.line)}`)).toEqual(['link-broken@3', 'directive-unknown@7']);
  });

  it('refuses paths that are not notes', async () => {
    expect((await postLint({ path: 'content/docs/meta.yaml', content: '' })).status).toBe(403);
    expect((await postLint({ path: '../etc/passwd.mdx', content: '' })).status).toBe(403);
  });

  it('refuses bad bodies, other methods and other content types', async () => {
    expect((await postLint({ path: 'content/docs/index.mdx' })).status).toBe(400);
    expect((await rawRequest(`${studio.url}api/lint`)).status).toBe(405);
    const text = await rawRequest(`${studio.url}api/lint`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    expect(text.status).toBe(415);
  });

  it('is behind the origin guard', async () => {
    const response = await postLint({ path: 'content/docs/index.mdx', content: '' }, { Origin: 'http://evil.example' });
    expect(response.status).toBe(403);
  });
});
