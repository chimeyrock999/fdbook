import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { HttpError } from '#http.ts';
import { classifyPath } from '#security/paths.ts';
import type { AttachedFile } from './attachment-blocks.ts';
import type { Attachments } from './attachments.ts';
import { SELECTION_MAX, type Mention, type MentionKind, type MessageContext } from '@fdbook/shared/agents.ts';
const MENTIONS_MAX = 20;
const ATTACHMENTS_MAX = 5;

const line = z.number().int().min(1);
const schema = z.object({
  note: z.string().min(1).max(1024).nullable().default(null),
  selection: z.object({ lines: z.tuple([line, line]), source: z.string(), text: z.string() }).nullable().default(null),
  caret: line.nullable().default(null),
  mentions: z.array(z.object({ path: z.string().min(1).max(1024) })).max(MENTIONS_MAX).default([]),
  attachments: z.array(z.object({ id: z.string() })).max(ATTACHMENTS_MAX).default([]),
});

// What a mention or the open note may name: a file of the worktree, by a
// plain relative path, outside .git, reached without a symlink.
async function worktreeFile(root: string, path: string) {
  const segments = path.split('/');
  if (path.includes('\\') || segments.some((segment) => segment === '' || segment === '.' || segment === '..') || segments[0] === '.git') return false;
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (info === null || info.isSymbolicLink()) return false;
    if (index === segments.length - 1 ? !info.isFile() : !info.isDirectory()) return false;
  }
  return true;
}

export function mentionKindOf(path: string): MentionKind {
  const kind = classifyPath(path);
  return kind === 'note' || kind === 'asset' ? kind : 'file';
}

// A message's context as the client sent it, checked against the worktree
// at `root`: every path a file there, the attachments kept for `slug`.
// Answers it with the attachments' files, for the agent.
export async function contextOf(value: unknown, root: string, slug: string, attachments: Attachments | null): Promise<{ context: MessageContext; attached: AttachedFile[] } | null> {
  if (value === undefined || value === null) return null;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, `context: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`);
  const { note, selection, caret, mentions, attachments: wanted } = parsed.data;
  if (note !== null && (classifyPath(note) !== 'note' || !(await worktreeFile(root, note)))) throw new HttpError(400, `context: no such note in this change request: ${note}`);
  if (selection !== null) {
    if (note === null) throw new HttpError(400, 'context: a selection needs its note');
    if (selection.lines[0] > selection.lines[1]) throw new HttpError(400, 'context: selection lines must run from first to last');
    if (selection.source.length > SELECTION_MAX || selection.text.length > SELECTION_MAX) throw new HttpError(413, `context: a selection must be at most ${String(SELECTION_MAX)} characters`);
  }
  const checked: Mention[] = [];
  for (const { path } of mentions) {
    if (!(await worktreeFile(root, path))) throw new HttpError(400, `context: no such file in this change request: ${path}`);
    if (!checked.some((each) => each.path === path)) checked.push({ kind: mentionKindOf(path), path });
  }
  const found = [];
  for (const { id } of wanted) {
    const attachment = attachments === null ? null : await attachments.find(slug, id);
    if (attachment === null) throw new HttpError(400, `context: no such attachment: ${id}`);
    found.push(attachment);
  }
  return {
    context: {
      note,
      selection: selection === null ? null : { lines: [selection.lines[0], selection.lines[1]], source: selection.source, text: selection.text },
      caret: selection === null ? caret : null,
      mentions: checked,
      attachments: found.map(({ id, name, size }) => ({ id, name, size })),
    },
    attached: found.map(({ absolute, name }) => ({ absolute, name })),
  };
}

// A fence longer than any run of backticks in `text`.
function fenceOf(text: string) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

const linesOf = ([first, last]: [number, number]) => (first === last ? `line ${String(first)}` : `lines ${String(first)}-${String(last)}`);

// What the agent receives for a message: the person's text, then what the
// Studio adds, marked as such. The selection's lines are where its
// suggestions should go (propose_edit warns when they do not). The
// attachments themselves follow the text (attachment-blocks.ts).
export function promptWith(prompt: string, context: MessageContext | null) {
  if (context === null) return prompt;
  const parts: string[] = [];
  const { note, selection, caret } = context;
  if (note !== null && selection !== null) {
    parts.push(`- Selected in the editor: ${note}, ${linesOf(selection.lines)}. Edits this message asks for go there (propose_edit), unless it says otherwise.`);
    if (selection.source === '') parts.push('  (Too long to include here: read those lines from the note.)');
    else {
      const fence = fenceOf(selection.source);
      parts.push(`${fence}mdx\n${selection.source.replace(/\n+$/, '')}\n${fence}`);
    }
    const text = selection.text.trim();
    if (text !== '' && text !== selection.source.trim()) parts.push(`- The text selected within those lines: ${JSON.stringify(text)}`);
  } else if (note !== null) parts.push(`- Open in the editor: ${note}${caret === null ? '' : `, caret on line ${String(caret)}`}.`);
  for (const mention of context.mentions) parts.push(`- Mentioned ${mention.kind}: ${mention.path}`);
  for (const attachment of context.attachments) parts.push(`- Attached document: ${attachment.name} (it follows this text)`);
  if (parts.length === 0) return prompt;
  return `${prompt}\n\n---\nContext the Notes Studio adds (the person did not type this):\n${parts.join('\n')}`;
}
