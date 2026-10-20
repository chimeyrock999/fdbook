import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';

// Frontmatter and meta.yaml schemas for content/notes, shared by the site
// (source.config.ts) and Notes Studio (tools/notes-studio).

export const graphKeywordSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
});

export const graphSectionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  keywords: z.array(graphKeywordSchema).optional(),
});

export const pageGraphSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  keywords: z.array(graphKeywordSchema).optional(),
  sections: z.array(graphSectionSchema).optional(),
});

export const notesPageSchema = pageSchema.extend({
  graph: pageGraphSchema.optional(),
  visible: z.boolean().optional(),
});

export const notesMetaSchema = metaSchema.extend({
  visible: z.boolean().optional(),
});

export type NotesPageFrontmatter = z.infer<typeof notesPageSchema>;
export type NotesMeta = z.infer<typeof notesMetaSchema>;
