import { existsSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promptWith } from '#agents/context.ts';
import { rankMentions } from '#agents/context-api.ts';
import type { Attachment, Conversation, ConversationEvent, MessageContext } from '@fdbook/shared/agents.ts';
import type { ChangeRequest } from '#cr/manager.ts';
import { hunksOutside, linesOnDisk } from '#mcp/note-tools.ts';
import { fakeProfile, messagesOf } from '#tests/support/agents.ts';
import { sender } from '#tests/support/auth.ts';
import { makeGitRepo, startCrStudio, type CrStudio, type GitRepo } from '#tests/support/git-repo.ts';
import { json } from '#tests/support/http.ts';

const NOTE = 'content/docs/guide/first-look.mdx';
const BODY = '---\ntitle: First look\n---\n\nA first look.\n\nA second paragraph.\n\nA third one.\n';

const context = (change: Partial<MessageContext> = {}): MessageContext => ({ note: NOTE, selection: null, caret: null, mentions: [], attachments: [], ...change });

// What goes with a message (#86): checked by the server, kept on the turn,
// and added to what the agent receives.
describe('message context', () => {
  let repo: GitRepo;
  let studio: CrStudio;
  let cr: ChangeRequest;
  const send = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => sender(studio.origin)(path, { method, body, headers });
  const api = (path: string) => `/cr/${cr.slug}/api/agents${path}`;
  const worktree = (path: string) => join(cr.worktree ?? '', path);

  async function settled(id: string) {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const read = json(await send(api(`/conversations/${id}`))) as { conversation: Conversation; events: ConversationEvent[] };
      if (read.conversation.status !== 'running') return { ...read, said: messagesOf(read.events) };
      if (Date.now() > deadline) throw new Error('the turn did not end');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  const attach = async (name: string, text: string) => {
    const response = await send(api('/attachments'), 'POST', text, { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) });
    return { status: response.status, body: json(response) as { attachment: Attachment; error?: string } };
  };

  beforeAll(async () => {
    repo = await makeGitRepo();
    // codex here takes text only: no images, no embedded resources.
    studio = await startCrStudio(repo, { agents: [fakeProfile(), fakeProfile({ FAKE_PROMPT: 'text' }, 'codex')] });
    cr = (json(await send('/api/crs', 'POST', { name: 'Context' })) as { cr: ChangeRequest }).cr;
    await writeFile(worktree(NOTE), BODY);
    await mkdir(worktree('lib'), { recursive: true });
    await writeFile(worktree('lib/helper.ts'), 'export const helper = 1;\n');
  }, 30_000);

  afterAll(async () => {
    await studio.close();
    await repo.remove();
  });

  it('sends the selection, mentions and attachments to the agent, and keeps them on the turn', async () => {
    const { body: { attachment } } = await attach('brief.md', '# Brief\n');
    const sent = context({ selection: { lines: [7, 7], source: 'A second paragraph.', text: 'second' }, mentions: [{ kind: 'file', path: 'lib/helper.ts' }, { kind: 'note', path: 'content/docs/guide/index.mdx' }], attachments: [attachment] });
    const { conversation } = json(await send(api('/conversations'), 'POST', { agent: 'claude', role: 'author', prompt: 'env', context: sent })) as { conversation: Conversation };
    await settled(conversation.id);
    expect((await send(api(`/conversations/${conversation.id}/messages`), 'POST', { prompt: 'recall' })).status).toBe(200);
    const { events, said } = await settled(conversation.id);
    const turns = events.flatMap((event) => (event.type === 'turn' ? [event] : []));
    // The server names each mention's kind itself.
    expect(turns[0]?.context).toEqual({ ...sent, mentions: [{ kind: 'file', path: 'lib/helper.ts' }, { kind: 'note', path: 'content/docs/guide/index.mdx' }], attachments: [{ id: attachment.id, name: 'brief.md', size: 8 }] });
    expect(turns[1]?.context).toBeUndefined();
    const received = said.at(-1) ?? '';
    expect(received).toContain('recall:env\n\n---\nContext the Notes Studio adds');
    expect(received).toContain(`Selected in the editor: ${NOTE}, line 7.`);
    expect(received).toContain('```mdx\nA second paragraph.\n```');
    expect(received).toContain('The text selected within those lines: "second"');
    expect(received).toContain('Mentioned file: lib/helper.ts');
    expect(received).toContain('Attached document: brief.md (it follows this text)');
  });

  it('sends attachments in the prompt: an image as one, a document embedded, as the agent takes them', async () => {
    const text = (await attach('brief.md', '# Brief\n')).body.attachment;
    const pdf = (await attach('spec.pdf', '%PDF-1.4\u0000binary')).body.attachment;
    const png = (await attach('chart.png', '\u0089PNG\u0000')).body.attachment;
    const { conversation } = json(await send(api('/conversations'), 'POST', { agent: 'claude', role: 'author', prompt: 'blocks', context: context({ attachments: [text, pdf, png] }) })) as { conversation: Conversation };
    const { said } = await settled(conversation.id);
    expect(JSON.parse(said.at(-1)?.replace(/^blocks:/, '') ?? 'null')).toEqual([
      { type: 'resource', mimeType: 'text/markdown', text: '# Brief\n' },
      { type: 'resource', mimeType: 'application/pdf', blob: '%PDF-1.4\u0000binary' },
      { type: 'image', mimeType: 'image/png' },
    ]);
    const plain = (json(await send(api('/conversations'), 'POST', { agent: 'codex', role: 'author', prompt: 'blocks', context: context({ attachments: [pdf] }) })) as { conversation: Conversation }).conversation;
    const links = (await settled(plain.id)).said.at(-1)?.replace(/^blocks:/, '') ?? 'null';
    expect(JSON.parse(links)).toEqual([{ type: 'resource_link', name: 'spec.pdf', uri: expect.stringMatching(new RegExp(`^file://.*/attachments/${pdf.id}/spec\\.pdf$`)) as unknown }]);
  });

  it('warns the agent of a proposal outside the selected lines, through the Studio\'s MCP tool', async () => {
    const selection = { lines: [5, 5] as [number, number], source: 'A first look.', text: 'A first look.' };
    const inside = `mcp propose_edit {"path": "${NOTE}", "edits": [{"find": "A first look.", "replace": "A short look."}]}`;
    const outside = `mcp propose_edit {"path": "${NOTE}", "edits": [{"find": "A third one.", "replace": "The third."}]}`;
    const { conversation } = json(await send(api('/conversations'), 'POST', { agent: 'claude', role: 'author', prompt: `${inside}\n${outside}`, context: context({ selection }) })) as { conversation: Conversation };
    const { said } = await settled(conversation.id);
    const answers = said.filter((each) => each.startsWith('mcp'));
    expect(answers[0]).not.toContain('outsideSelection');
    expect(answers[1]).toContain('outsideSelection');
    expect(answers[1]).toContain('outside the selection (5-5)');
  });

  it('refuses a context that names what is not in the change request', async () => {
    await symlink('/etc/hosts', worktree('lib/hosts'));
    const start = (sent: unknown) => send(api('/conversations'), 'POST', { agent: 'claude', role: 'author', prompt: 'env', context: sent });
    expect((await start(context({ note: 'content/docs/guide/nope.mdx' }))).status).toBe(400);
    expect((await start(context({ note: 'lib/helper.ts' }))).status).toBe(400);
    expect((await start(context({ note: null, selection: { lines: [1, 1], source: 'x', text: 'x' } }))).status).toBe(400);
    expect((await start(context({ selection: { lines: [3, 1], source: 'x', text: 'x' } }))).status).toBe(400);
    for (const path of ['../outside.txt', '/etc/hosts', '.git/config', 'lib/hosts', 'lib', 'lib/./helper.ts']) {
      expect((await start(context({ mentions: [{ kind: 'file', path }] }))).status, path).toBe(400);
    }
    expect((await start(context({ attachments: [{ id: 'ffffffffffffffff', name: 'x', size: 1 }] }))).status).toBe(400);
    expect((await start(context({ selection: { lines: [1, 1], source: 'x'.repeat(40_001), text: '' } }))).status).toBe(413);
    expect((await start({ note: 3 })).status).toBe(400);
  });

  it('lists mentions best first, on main too', async () => {
    const { mentions } = json(await send(api('/mentions?q=help'))) as { mentions: { kind: string; path: string }[] };
    expect(mentions).toEqual([{ kind: 'file', path: 'lib/helper.ts' }]);
    const notes = (json(await send(api('/mentions?q=first'))) as { mentions: { kind: string; path: string }[] }).mentions;
    expect(notes[0]).toEqual({ kind: 'note', path: NOTE });
    expect((json(await send('/api/agents/mentions?q=first')) as { mentions: { kind: string; path: string }[] }).mentions[0]).toEqual({ kind: 'note', path: NOTE });
  });

  it('deletes a chat\'s attachments with it, but not one another chat sent too', async () => {
    const { body: { attachment } } = await attach('shared.txt', 'Shared.');
    const start = async () => (json(await send(api('/conversations'), 'POST', { agent: 'claude', role: 'author', prompt: 'env', context: context({ attachments: [attachment] }) })) as { conversation: Conversation }).conversation;
    const [first, second] = [await start(), await start()];
    await Promise.all([settled(first.id), settled(second.id)]);
    const kept = join(repo.home, 'agents', cr.slug, 'attachments', attachment.id);
    expect((await send(api(`/conversations/${first.id}`), 'DELETE')).status).toBe(200);
    expect(existsSync(kept)).toBe(true);
    expect((await send(api(`/conversations/${second.id}`), 'DELETE')).status).toBe(200);
    expect(existsSync(kept)).toBe(false);
  });

  it('keeps an attachment until its conversation is deleted', async () => {
    const empty = await attach('empty.txt', '');
    expect(empty.status).toBe(400);
    const { status, body: { attachment } } = await attach('../../notes.txt', 'Some notes.');
    expect(status).toBe(200);
    expect(attachment.name).toBe('notes.txt');
    const kept = join(repo.home, 'agents', cr.slug, 'attachments', attachment.id, 'notes.txt');
    expect(existsSync(kept)).toBe(true);
    const { conversation } = json(await send(api('/conversations'), 'POST', { agent: 'claude', role: 'author', prompt: 'env', context: context({ attachments: [attachment] }) })) as { conversation: Conversation };
    await settled(conversation.id);
    expect((await send(api(`/conversations/${conversation.id}`), 'DELETE')).status).toBe(200);
    expect(existsSync(kept)).toBe(false);
  });
});

describe('message context helpers', () => {
  it('ranks a name that starts with the query first, then notes before assets before files', () => {
    const paths = ['lib/first-aid.ts', 'content/docs/a/first.mdx', 'public/docs/first.png', 'content/docs/guide/my-first.mdx', 'docs/other.md'];
    expect(rankMentions(paths, 'FIRST')).toEqual([
      { kind: 'note', path: 'content/docs/a/first.mdx' },
      { kind: 'asset', path: 'public/docs/first.png' },
      { kind: 'file', path: 'lib/first-aid.ts' },
      { kind: 'note', path: 'content/docs/guide/my-first.mdx' },
    ]);
    expect(rankMentions(paths, '', 2)).toHaveLength(2);
  });

  it('fences the selection past any backticks in it, and adds nothing without context', () => {
    expect(promptWith('Hi', null)).toBe('Hi');
    expect(promptWith('Hi', context({ note: null }))).toBe('Hi');
    expect(promptWith('Hi', context({ caret: 4 }))).toBe(`Hi\n\n---\nContext the Notes Studio adds (the person did not type this):\n- Open in the editor: ${NOTE}, caret on line 4.`);
    const fenced = promptWith('Hi', context({ selection: { lines: [2, 4], source: '```js\nx\n```\n', text: '```js\nx\n```' } }));
    expect(fenced).toContain('lines 2-4');
    expect(fenced).toContain('````mdx\n```js\nx\n```\n````');
    expect(fenced).not.toContain('The text selected');
  });

  it('finds the selected lines on disk by their MDX, nearest the lines the editor named', () => {
    const disk = 'x\n\nsame\n\ny\n\nsame\n';
    expect(linesOnDisk(disk, { lines: [6, 6], source: 'same' })).toEqual([7, 7]);
    expect(linesOnDisk(disk, { lines: [2, 2], source: 'same' })).toEqual([3, 3]);
    expect(linesOnDisk(disk, { lines: [1, 3], source: 'x\n\nsame' })).toEqual([1, 3]);
    expect(linesOnDisk(disk, { lines: [1, 1], source: 'not saved yet' })).toBeNull();
    expect(linesOnDisk(disk, { lines: [1, 1], source: '' })).toBeNull();
  });

  it('says a selection too long to carry goes as its lines alone', () => {
    expect(promptWith('Hi', context({ selection: { lines: [3, 900], source: '', text: '' } }))).toContain('lines 3-900. Edits this message asks for go there (propose_edit), unless it says otherwise.\n  (Too long to include here: read those lines from the note.)');
  });

  it('finds the hunks that touch none of the selected lines, give or take a blank line', () => {
    const text = 'a\n\nb\n\nc\n\nd\n';
    const at = (find: string) => text.indexOf(find);
    const hunks = [
      { id: 'on', from: at('b'), to: at('b') + 2 },
      { id: 'next', from: at('c') - 1, to: at('c') },
      { id: 'far', from: at('d'), to: at('d') + 2 },
      { id: 'gone', from: null, to: null },
    ];
    expect(hunksOutside(text, hunks, [3, 3])).toEqual(['far']);
  });
});
