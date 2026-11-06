import { posix } from 'node:path';
import { z } from 'zod';
import { HttpError } from '#http.ts';
import { pageUrl } from '#lint/rules/links.ts';
import { NOTES_DIR } from '#security/paths.ts';
import { graphKeywordEntriesOf, graphKeywordsOf, json, linksOf, notePath, notesOf, strings, text } from './note-tools.ts';
import type { StudioTool } from './tool.ts';

// Tools for writing with an agent (#86): the words the notes already use,
// to fill a note's frontmatter with, and the notes a note could link to.

type Note = Awaited<ReturnType<typeof notesOf>>[number];

// How often each value is used, most used first, then by name.
function counted(values: string[][]) {
  const counts = new Map<string, number>();
  for (const each of values) for (const value of new Set(each)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([value, notes]) => ({ value, notes }));
}

// Words that say nothing of what a title is about, English and Vietnamese.
const STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'into', 'that', 'this', 'are', 'how', 'what', 'why', 'when', 'its', 'your', 'about', 'using', 'use',
  'của', 'các', 'cho', 'với', 'trong', 'những', 'này', 'một', 'không', 'được', 'khi', 'thế', 'nào', 'gì', 'như', 'hay', 'cách', 'dùng',
]);

// Lowercase words of three letters or more, for matching titles in text.
const wordsOf = (value: string) => new Set(value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3 && !STOP_WORDS.has(word)));

// The link from the note at `from` to the note at `to`, both relative to
// content/notes, as notes write it (./x.mdx, ../y/z.mdx).
export function hrefFrom(from: string, to: string) {
  const relative = posix.relative(posix.dirname(from), to);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

// Why `other` relates to `self`, and how much: shared tags and keywords
// weigh most, a link either way next, then words of the other's title
// found in the note's text (`words`, wordsOf it).
export function relation(self: Note, other: Note, words: Set<string>, links: { to: boolean; from: boolean }) {
  const reasons: string[] = [];
  let score = 0;
  const tags = strings(self.data.tags);
  for (const tag of new Set(strings(other.data.tags))) if (tags.includes(tag)) { score += 3; reasons.push(`tag ${tag}`); }
  const keywords = [...strings(self.data.keywords), ...graphKeywordsOf(self.data)];
  for (const keyword of new Set([...strings(other.data.keywords), ...graphKeywordsOf(other.data)])) if (keywords.includes(keyword)) { score += 2; reasons.push(`keyword ${keyword}`); }
  if (links.to) { score += 2; reasons.push('this note links to it'); }
  if (links.from) { score += 2; reasons.push('it links to this note'); }
  const shared = [...wordsOf(text(other.data.title) ?? '')].filter((word) => words.has(word));
  if (shared.length > 0) { score += shared.length; reasons.push(`its title's words in this note: ${shared.join(', ')}`); }
  return { score, reasons };
}

const path = z.string().min(1).describe(`The note: ${NOTES_DIR}/<path>.mdx, or <path>.mdx relative to ${NOTES_DIR}`);

export const writingTools: StudioTool[] = [
  {
    name: 'note_vocabulary',
    description: 'The words the notes already use, to fill a note\'s frontmatter with: every tag, keyword and graph keyword (id and display name), each with how many notes use it, most used first. Reuse these before making up new ones.',
    input: z.object({}),
    access: 'read',
    async run(_args, ctx) {
      const notes = await notesOf(ctx.root);
      const names = new Map<string, string>();
      for (const note of notes) for (const { id, displayName } of graphKeywordEntriesOf(note.data)) if (!names.has(id)) names.set(id, displayName);
      return json({
        notes: notes.length,
        tags: counted(notes.map((note) => strings(note.data.tags))).map(({ value, notes: used }) => ({ tag: value, notes: used })),
        keywords: counted(notes.map((note) => strings(note.data.keywords))).map(({ value, notes: used }) => ({ keyword: value, notes: used })),
        graphKeywords: counted(notes.map((note) => graphKeywordsOf(note.data))).map(({ value, notes: used }) => ({ id: value, displayName: names.get(value) ?? value, notes: used })),
      });
    },
  } satisfies StudioTool<z.ZodObject<Record<string, never>>>,
  {
    name: 'related_notes',
    description: 'The notes most related to a note, to suggest links to: ranked by shared tags and keywords, links either way, and words of their title found in the note. Each answers its path, title, description, the href to write in this note, why it relates, and whether this note already links to it.',
    input: z.object({ path, limit: z.number().int().min(1).max(30).optional() }),
    access: 'read',
    async run({ path: given, limit = 10 }, ctx) {
      const at = notePath(given);
      const page = at.slice(NOTES_DIR.length + 1);
      const notes = await notesOf(ctx.root);
      const self = notes.find((note) => note.path === page);
      if (self === undefined) throw new HttpError(404, `no such note: ${at}`);
      const pages = new Set(notes.map((note) => note.path));
      const byUrl = new Map(notes.map((note) => [pageUrl(note.path), note.path]));
      const texts = await Promise.all(notes.map((note) => ctx.files.read(`${NOTES_DIR}/${note.path}`)));
      const links = new Map(notes.map((note, index) => [note.path, linksOf(texts[index]?.content ?? '', note.path, pages, byUrl)]));
      const words = wordsOf(texts[notes.indexOf(self)]?.content ?? '');
      const ranked = notes
        .filter((note) => note.path !== page)
        .map((note) => {
          const linked = (links.get(page) ?? []).includes(note.path);
          return { note, linked, ...relation(self, note, words, { to: linked, from: (links.get(note.path) ?? []).includes(page) }) };
        })
        .filter((each) => each.score > 0)
        .sort((a, b) => b.score - a.score || a.note.path.localeCompare(b.note.path))
        .slice(0, limit);
      return json({
        path: at,
        related: ranked.map(({ note, score, reasons, linked }) => ({
          path: `${NOTES_DIR}/${note.path}`,
          title: text(note.data.title),
          description: text(note.data.description),
          href: hrefFrom(page, note.path),
          score,
          reasons,
          linked,
        })),
      });
    },
  } satisfies StudioTool<z.ZodObject<{ path: typeof path; limit: z.ZodOptional<z.ZodNumber> }>>,
];
